import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Secp256k1Keypair } from "@atproto/crypto";
import { describe, expect, it } from "vitest";
import {
  ALL_NSIDS,
  LEXICON_AUTHORITIES,
  LEXICON_AUTHORITY_DID,
  LEXICON_SCHEMA_COLLECTION,
  LEXICON_TXT_RECORD_NAMES,
  LEXICON_TXT_RECORD_VALUE,
  NSID_REFERENCE_REGEX,
  authorityHostnameForNsid,
  buildAllLexiconSchemaRecords,
  buildLexiconSchemaRecord,
  deriveLexiconAuthorities,
  loadCompiledSchema,
  schemaFilePathForNsid,
  validateNsid,
} from "./authority.js";
import {
  buildAuthorityRepo,
  deterministicRev,
  multikeyToDidKey,
  readAuthorityRepo,
  verifyAuthorityRepoSig,
} from "./authorityRepo.js";
import { AUTHORITY_CAR, AUTHORITY_DID_DOCUMENT, AUTHORITY_MANIFEST } from "./authorityArtifact.generated.js";
import { classifyLexiconSchemaChange, compareToGolden } from "./backCompat.js";
import { NSID } from "./nsids.js";

const PKG_ROOT = fileURLToPath(new URL("..", import.meta.url));

describe("NSID validity (https://atproto.com/specs/nsid)", () => {
  it("every NSID in NSID matches the spec's reference regex and prose rules", () => {
    for (const nsid of Object.values(NSID)) {
      const result = validateNsid(nsid);
      expect(result, `${nsid}: ${result.reason ?? ""}`).toEqual({ valid: true });
      expect(NSID_REFERENCE_REGEX.test(nsid), nsid).toBe(true);
      expect(nsid.length).toBeLessThanOrEqual(317);
      expect(nsid.split(".").length).toBeGreaterThanOrEqual(3);
    }
  });

  it("rejects malformed NSIDs", () => {
    expect(validateNsid("").valid).toBe(false);
    expect(validateNsid("fans.foryour").valid).toBe(false); // < 3 segments
    expect(validateNsid("fans.foryour.").valid).toBe(false); // empty name
    expect(validateNsid("fans.foryour.1post").valid).toBe(false); // name starts with a digit
    expect(validateNsid("fans.foryour.po-st").valid).toBe(false); // hyphen in name segment
    expect(validateNsid("fans.foryour.pоst").valid).toBe(false); // Cyrillic 'о', non-ASCII
    expect(validateNsid(`fans.foryour.${"x".repeat(64)}`).valid).toBe(false); // segment > 63
    expect(validateNsid(`a.${"b".repeat(64)}.c`).valid).toBe(false);
  });
});

describe("authority derivation", () => {
  it("computes the right authority + _lexicon.* name for the current namespace", () => {
    expect(LEXICON_AUTHORITIES).toEqual([
      {
        authorityHostname: "embed.foryour.fans",
        txtRecordName: "_lexicon.embed.foryour.fans",
        nsids: ["fans.foryour.embed.images"],
      },
      {
        authorityHostname: "foryour.fans",
        txtRecordName: "_lexicon.foryour.fans",
        nsids: [
          "fans.foryour.accessPolicy",
          "fans.foryour.media",
          "fans.foryour.post",
          "fans.foryour.profile",
          "fans.foryour.serviceConfig",
          "fans.foryour.tier",
        ],
      },
    ]);
    expect(LEXICON_TXT_RECORD_NAMES).toEqual(["_lexicon.embed.foryour.fans", "_lexicon.foryour.fans"]);
    expect(LEXICON_TXT_RECORD_VALUE).toBe("did=did:web:foryour.fans");
  });

  it("the name is the LAST segment — nested + sibling nesting each get their own authority", () => {
    // A hypothetical future namespace: a deeper nest and a sibling nest.
    const future = [
      "fans.foryour.post",
      "fans.foryour.embed.images",
      "fans.foryour.embed.video", // same authority as embed.images
      "fans.foryour.chat.message", // NEW authority: chat.foryour.fans
    ];
    expect(authorityHostnameForNsid("fans.foryour.embed.video")).toBe("embed.foryour.fans");
    expect(authorityHostnameForNsid("fans.foryour.chat.message")).toBe("chat.foryour.fans");
    expect(deriveLexiconAuthorities(future)).toEqual([
      {
        authorityHostname: "chat.foryour.fans",
        txtRecordName: "_lexicon.chat.foryour.fans",
        nsids: ["fans.foryour.chat.message"],
      },
      {
        authorityHostname: "embed.foryour.fans",
        txtRecordName: "_lexicon.embed.foryour.fans",
        nsids: ["fans.foryour.embed.images", "fans.foryour.embed.video"],
      },
      {
        authorityHostname: "foryour.fans",
        txtRecordName: "_lexicon.foryour.fans",
        nsids: ["fans.foryour.post"],
      },
    ]);
  });

  it("resolution is not hierarchical: embed.foryour.fans does not inherit from foryour.fans", () => {
    const embed = LEXICON_AUTHORITIES.find((a) => a.authorityHostname === "embed.foryour.fans")!;
    expect(embed.nsids).toEqual(["fans.foryour.embed.images"]);
    // The nested authority carries ONLY its own NSID — no fallback set.
  });
});

describe("round-trip fidelity — builder output vs compiled schema", () => {
  for (const nsid of ALL_NSIDS) {
    it(nsid, () => {
      const record = buildLexiconSchemaRecord(nsid);
      const source = loadCompiledSchema(nsid);
      expect(record.$type).toBe("com.atproto.lexicon.schema");
      expect(record.lexicon).toBe(1);
      expect(record.id).toBe(nsid);
      expect(record.defs).toEqual(source.defs);
      if (typeof source.description === "string") {
        expect(record.description).toBe(source.description);
      } else {
        expect(record).not.toHaveProperty("description");
      }
    });
  }
});

describe("no-drift guard — schema files vs NSID", () => {
  it("the set of lexicons/fans/foryour/**/*.json files equals Object.values(NSID)", () => {
    const base = fileURLToPath(new URL("../lexicons/fans/foryour", import.meta.url));
    const found: string[] = [];
    const walk = (dir: string, prefix: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          walk(`${dir}/${entry.name}`, `${prefix}${entry.name}.`);
        } else if (entry.name.endsWith(".json")) {
          found.push(`fans.foryour.${prefix}${entry.name.replace(/\.json$/, "")}`);
        }
      }
    };
    walk(base, "");
    expect(found.sort()).toEqual([...Object.values(NSID)].sort());
  });

  it("schemaFilePathForNsid round-trips to a readable file for every NSID", () => {
    for (const nsid of ALL_NSIDS) {
      const rel = schemaFilePathForNsid(nsid);
      expect(rel).toBe(`${nsid.split(".").join("/")}.json`);
      expect(() => readFileSync(new URL(`../lexicons/${rel}`, import.meta.url))).not.toThrow();
    }
  });
});

describe("signed authority repo (CAR) — the resolver's proof path", () => {
  it("round-trips every record and is deterministic", async () => {
    const keypair = await Secp256k1Keypair.import(Uint8Array.from(Buffer.from("11".repeat(32), "hex")), {
      exportable: true,
    });
    const a = await buildAuthorityRepo({ keypair });
    const b = await buildAuthorityRepo({ keypair });
    expect(Buffer.from(a.car).equals(Buffer.from(b.car))).toBe(true);
    expect(a.rev).toBe(deterministicRev(LEXICON_AUTHORITY_DID, ALL_NSIDS));

    const read = await readAuthorityRepo(a.car);
    const built = buildAllLexiconSchemaRecords();
    expect(Object.keys(read.records).sort()).toEqual([...ALL_NSIDS].sort());
    for (const nsid of ALL_NSIDS) {
      expect(read.records[nsid]!.record).toEqual(built[nsid]);
      expect(read.records[nsid]!.cid).toBe(a.recordCids[nsid]);
    }
    expect(read.did).toBe(LEXICON_AUTHORITY_DID);
  });

  it("verifyAuthorityRepoSig accepts the signing key and rejects any other", async () => {
    const keypair = await Secp256k1Keypair.import(Uint8Array.from(Buffer.from("22".repeat(32), "hex")), {
      exportable: true,
    });
    const other = await Secp256k1Keypair.import(Uint8Array.from(Buffer.from("33".repeat(32), "hex")), {
      exportable: true,
    });
    const { car } = await buildAuthorityRepo({ keypair });
    await expect(verifyAuthorityRepoSig(car, keypair.did())).resolves.toBeUndefined();
    await expect(verifyAuthorityRepoSig(car, other.did())).rejects.toThrow(/not signed by/);
  });
});

describe("committed authority artifact (packages/lexicons/authority/)", () => {
  const car = new Uint8Array(readFileSync(`${PKG_ROOT}authority/authority-repo.car`));
  const didDoc = JSON.parse(readFileSync(`${PKG_ROOT}authority/did.json`, "utf8"));
  const manifest = JSON.parse(readFileSync(`${PKG_ROOT}authority/manifest.json`, "utf8"));

  it("did.json advertises the #atproto_pds service and an #atproto Multikey", () => {
    expect(didDoc.id).toBe(LEXICON_AUTHORITY_DID);
    const service = didDoc.service.find((s: { id: string }) => s.id === "#atproto_pds");
    expect(service.type).toBe("AtprotoPersonalDataServer");
    expect(service.serviceEndpoint).toMatch(/^https:\/\//);
    const vm = didDoc.verificationMethod.find((m: { id: string }) => m.id.endsWith("#atproto"));
    expect(vm.type).toBe("Multikey");
    expect(vm.publicKeyMultibase).toMatch(/^z/);
    expect(didDoc.alsoKnownAs).toBeUndefined(); // a schema authority, never a handle
  });

  it("the committed CAR is signed by the did.json key and matches the compiled schemas", async () => {
    const didKey = multikeyToDidKey(
      didDoc.verificationMethod.find((m: { id: string }) => m.id.endsWith("#atproto")).publicKeyMultibase,
    );
    await expect(verifyAuthorityRepoSig(car, didKey)).resolves.toBeUndefined();

    const read = await readAuthorityRepo(car);
    const built = buildAllLexiconSchemaRecords();
    for (const nsid of ALL_NSIDS) {
      expect(read.records[nsid]!.record, `${nsid} — run \`pnpm --filter @foryour-fans/lexicons authority:regen\``).toEqual(
        built[nsid],
      );
      expect(manifest.records[nsid]).toBe(read.records[nsid]!.cid);
    }
    expect(manifest.did).toBe(LEXICON_AUTHORITY_DID);
    expect(manifest.collection).toBe(LEXICON_SCHEMA_COLLECTION);
    expect(manifest.nsids.sort()).toEqual([...ALL_NSIDS].sort());
  });

  it("the embedded authorityArtifact.generated.ts matches the committed files (run `authority:regen`)", () => {
    expect(AUTHORITY_DID_DOCUMENT).toEqual(didDoc);
    expect(AUTHORITY_MANIFEST).toEqual(manifest);
    expect(Buffer.from(AUTHORITY_CAR).equals(car)).toBe(true);
  });
});

describe("back-compat guard (Non-negotiable Rule 5)", () => {
  const golden = JSON.parse(readFileSync(`${PKG_ROOT}src/__fixtures__/published-schemas.json`, "utf8"));
  const current = buildAllLexiconSchemaRecords();

  it("no published fans.foryour.* schema has a BREAKING change vs the golden snapshot", () => {
    const report = compareToGolden(golden, current);
    expect(
      report.breaking,
      "A breaking change to a published Lexicon requires a NEW NSID, not an edit — see " +
        "prompts/lexicon-authority.md Non-negotiable Rule 5.\n" +
        JSON.stringify(report.breaking, null, 2),
    ).toEqual([]);
    expect(report.removedNsids, "removing a published NSID is breaking").toEqual([]);
  });

  it("the golden snapshot is current (regenerate with `authority:snapshot` after an additive change)", () => {
    const report = compareToGolden(golden, current);
    const pending = [...report.additive.map((a) => `${a.nsid}: ${a.change.detail}`), ...report.addedNsids];
    expect(
      pending,
      "Additive schema changes detected. If intended, run " +
        "`pnpm --filter @foryour-fans/lexicons authority:snapshot` and commit.",
    ).toEqual([]);
  });

  it("classifyLexiconSchemaChange labels the change kinds", () => {
    const base = {
      $type: "com.atproto.lexicon.schema",
      lexicon: 1,
      id: "x.y.z",
      defs: {
        main: {
          type: "record",
          record: {
            type: "object",
            required: ["a"],
            properties: {
              a: { type: "string", maxLength: 100 },
              b: { type: "integer" },
            },
          },
        },
      },
    };
    const clone = () => JSON.parse(JSON.stringify(base));

    // additive: new optional property
    let next = clone();
    next.defs.main.record.properties.c = { type: "string" };
    expect(classifyLexiconSchemaChange(base, next).map((c) => c.kind)).toContain("additive");
    expect(classifyLexiconSchemaChange(base, next).some((c) => c.kind === "breaking")).toBe(false);

    // breaking: removed property
    next = clone();
    delete next.defs.main.record.properties.b;
    expect(classifyLexiconSchemaChange(base, next).some((c) => c.kind === "breaking")).toBe(true);

    // breaking: field became required
    next = clone();
    next.defs.main.record.required = ["a", "b"];
    expect(classifyLexiconSchemaChange(base, next).some((c) => c.kind === "breaking")).toBe(true);

    // breaking: type change
    next = clone();
    next.defs.main.record.properties.b.type = "string";
    expect(classifyLexiconSchemaChange(base, next).some((c) => c.kind === "breaking")).toBe(true);

    // breaking: tightened upper bound
    next = clone();
    next.defs.main.record.properties.a.maxLength = 50;
    expect(classifyLexiconSchemaChange(base, next).some((c) => c.kind === "breaking")).toBe(true);

    // benign: loosened upper bound
    next = clone();
    next.defs.main.record.properties.a.maxLength = 500;
    expect(classifyLexiconSchemaChange(base, next).every((c) => c.kind !== "breaking")).toBe(true);
  });
});
