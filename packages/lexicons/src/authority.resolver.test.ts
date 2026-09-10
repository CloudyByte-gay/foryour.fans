import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { Secp256k1Keypair, formatMultikey } from "@atproto/crypto";
import { LexResolver } from "@atproto/lex-resolver";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ALL_NSIDS, buildLexiconSchemaRecord } from "./authority.js";
import { buildAuthorityRepo } from "./authorityRepo.js";

/**
 * End-to-end: resolve `fans.foryour.*` NSIDs through the REAL reference resolver
 * (`@atproto/lex-resolver` — DID-document resolution, `com.atproto.sync.getRecord`,
 * signed-commit + MST proof verification, `lexiconDocumentSchema` validation) and
 * assert the resolved schema equals the locally compiled one.
 *
 * This is the Phase-2/Phase-8 analogue: the one check that talks to a genuinely
 * external contract (the resolver's exact fetch + proof-check behaviour) rather
 * than a fake. It is hermetic — a `did:web:localhost:<port>` DID document + a
 * tiny HTTP server standing in for `apps/web`'s served surface, no DNS, no
 * deploy. The live-DNS variant runs post-deploy via
 * `pnpm --filter @foryour-fans/lexicons authority:check`.
 */
describe("LexResolver resolves fans.foryour.* end to end (hermetic)", () => {
  let server: Server;
  let did: `did:web:${string}`;
  let didDoc: unknown;
  let car: Uint8Array;

  beforeAll(async () => {
    server = createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    // did:web with a port uses %3A for the colon.
    did = `did:web:localhost%3A${port}`;
    const endpoint = `http://localhost:${port}`;

    const keypair = await Secp256k1Keypair.import(Uint8Array.from(Buffer.from("ab".repeat(32), "hex")), {
      exportable: true,
    });
    ({ car } = await buildAuthorityRepo({ keypair, did }));

    didDoc = {
      "@context": ["https://www.w3.org/ns/did/v1", "https://w3id.org/security/multikey/v1"],
      id: did,
      verificationMethod: [
        {
          id: `${did}#atproto`,
          type: "Multikey",
          controller: did,
          publicKeyMultibase: formatMultikey(keypair.jwtAlg, keypair.publicKeyBytes()),
        },
      ],
      service: [{ id: "#atproto_pds", type: "AtprotoPersonalDataServer", serviceEndpoint: endpoint }],
    };

    server.on("request", (req, res) => {
      const url = new URL(req.url ?? "/", endpoint);
      if (url.pathname === "/.well-known/did.json") {
        res.writeHead(200, { "content-type": "application/did+ld+json" });
        res.end(JSON.stringify(didDoc));
        return;
      }
      if (url.pathname === "/xrpc/com.atproto.sync.getRecord") {
        if (!ALL_NSIDS.includes(url.searchParams.get("rkey") ?? "")) {
          res.writeHead(404, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "RecordNotFound" }));
          return;
        }
        res.writeHead(200, { "content-type": "application/vnd.ipld.car" });
        res.end(Buffer.from(car));
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "MethodNotImplemented" }));
    });
  });

  afterAll(() => {
    server?.close();
  });

  for (const nsid of ["fans.foryour.post", "fans.foryour.embed.images"]) {
    it(`resolves ${nsid} and it deep-equals the compiled schema`, async () => {
      const resolver = new LexResolver({
        hooks: { onResolveAuthority: async () => did }, // stand in for the _lexicon.* DNS TXT lookup
      });
      const { lexicon, uri, cid } = await resolver.get(nsid);
      expect(uri.toString()).toBe(`at://${did}/com.atproto.lexicon.schema/${nsid}`);
      expect(cid).toBeTruthy();

      const local = buildLexiconSchemaRecord(nsid);
      expect(lexicon.id).toBe(nsid);
      expect(lexicon.lexicon).toBe(1);
      expect(lexicon.defs).toEqual(local.defs);
      if ("description" in local) {
        expect((lexicon as { description?: string }).description).toBe(local.description);
      }
    });
  }

  it("a nonexistent NSID fails resolution", async () => {
    const resolver = new LexResolver({ hooks: { onResolveAuthority: async () => did } });
    await expect(resolver.get("fans.foryour.doesNotExist")).rejects.toThrow();
  });
});
