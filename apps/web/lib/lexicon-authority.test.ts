import { vi } from "vitest";

vi.mock("server-only", () => ({}));

import { describe, expect, it } from "vitest";
import { corsPreflight, didDocumentResponse, xrpcResponse } from "./lexicon-authority";

const AUTHORITY_DID = "did:web:foryour.fans";
const COLLECTION = "com.atproto.lexicon.schema";
const KNOWN = "fans.foryour.post";
const NESTED = "fans.foryour.embed.images";

function xrpcUrl(method: string, params: Record<string, string> = {}) {
  const u = new URL(`https://foryour.fans/xrpc/${method}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u;
}

describe("/.well-known/did.json", () => {
  it("serves the did:web document a resolver can consume", async () => {
    const res = didDocumentResponse();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/did+ld+json");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("cache-control")).toMatch(/max-age=300/);

    const doc = JSON.parse(await res.text());
    expect(doc.id).toBe(AUTHORITY_DID);
    const service = doc.service.find((s: { id: string }) => s.id === "#atproto_pds");
    expect(service.type).toBe("AtprotoPersonalDataServer");
    expect(service.serviceEndpoint).toMatch(/^https:\/\//);
    const vm = doc.verificationMethod.find((m: { id: string }) => m.id.endsWith("#atproto"));
    expect(vm.type).toBe("Multikey");
    expect(vm.publicKeyMultibase).toMatch(/^z/);
    expect(doc.alsoKnownAs).toBeUndefined();
  });
});

describe("com.atproto.sync.getRecord", () => {
  it("returns the signed CAR for a known NSID", () => {
    const res = xrpcResponse("com.atproto.sync.getRecord", xrpcUrl("com.atproto.sync.getRecord", {
      did: AUTHORITY_DID,
      collection: COLLECTION,
      rkey: KNOWN,
    }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/vnd.ipld.car");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("works for the nested-authority NSID too", () => {
    const res = xrpcResponse(
      "com.atproto.sync.getRecord",
      xrpcUrl("com.atproto.sync.getRecord", { collection: COLLECTION, rkey: NESTED }),
    );
    expect(res.status).toBe(200);
  });

  it("404s an unknown rkey with an atproto error body", async () => {
    const res = xrpcResponse(
      "com.atproto.sync.getRecord",
      xrpcUrl("com.atproto.sync.getRecord", { collection: COLLECTION, rkey: "fans.foryour.nope" }),
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "RecordNotFound" });
  });

  it("400s a wrong collection", async () => {
    const res = xrpcResponse(
      "com.atproto.sync.getRecord",
      xrpcUrl("com.atproto.sync.getRecord", { collection: "app.bsky.feed.post", rkey: KNOWN }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "InvalidRequest" });
  });

  it("400s a wrong repo/did", async () => {
    const res = xrpcResponse(
      "com.atproto.sync.getRecord",
      xrpcUrl("com.atproto.sync.getRecord", { did: "did:web:evil.example", collection: COLLECTION, rkey: KNOWN }),
    );
    expect(res.status).toBe(400);
  });
});

describe("com.atproto.repo.* JSON reads (lenient clients)", () => {
  it("getRecord returns { uri, cid, value } with the schema body", async () => {
    const res = xrpcResponse(
      "com.atproto.repo.getRecord",
      xrpcUrl("com.atproto.repo.getRecord", { repo: AUTHORITY_DID, collection: COLLECTION, rkey: KNOWN }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.uri).toBe(`at://${AUTHORITY_DID}/${COLLECTION}/${KNOWN}`);
    expect(body.cid).toMatch(/^bafy/);
    expect(body.value.$type).toBe(COLLECTION);
    expect(body.value.id).toBe(KNOWN);
    expect(body.value.lexicon).toBe(1);
    expect(body.value.defs).toBeTypeOf("object");
  });

  it("listRecords returns every fans.foryour.* schema", async () => {
    const res = xrpcResponse(
      "com.atproto.repo.listRecords",
      xrpcUrl("com.atproto.repo.listRecords", { repo: AUTHORITY_DID, collection: COLLECTION }),
    );
    const body = await res.json();
    expect(body.records).toHaveLength(7);
    expect(body.records.map((r: { value: { id: string } }) => r.value.id)).toContain(NESTED);
  });

  it("describeRepo lists only the lexicon-schema collection", async () => {
    const res = xrpcResponse("com.atproto.repo.describeRepo", xrpcUrl("com.atproto.repo.describeRepo", { repo: AUTHORITY_DID }));
    const body = await res.json();
    expect(body.did).toBe(AUTHORITY_DID);
    expect(body.collections).toEqual([COLLECTION]);
    expect(body.handleIsCorrect).toBe(false);
  });

  it("getRecord 404s an unknown rkey", async () => {
    const res = xrpcResponse(
      "com.atproto.repo.getRecord",
      xrpcUrl("com.atproto.repo.getRecord", { repo: AUTHORITY_DID, collection: COLLECTION, rkey: "x.y.z" }),
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "RecordNotFound" });
  });
});

describe("sync repo-level reads", () => {
  it("getRepo returns the full CAR", () => {
    const res = xrpcResponse("com.atproto.sync.getRepo", xrpcUrl("com.atproto.sync.getRepo", { did: AUTHORITY_DID }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/vnd.ipld.car");
  });

  it("listRepos advertises the one authority repo", async () => {
    const res = xrpcResponse("com.atproto.sync.listRepos", xrpcUrl("com.atproto.sync.listRepos"));
    const body = await res.json();
    expect(body.repos).toHaveLength(1);
    expect(body.repos[0].did).toBe(AUTHORITY_DID);
    expect(body.repos[0].head).toMatch(/^bafy/);
  });
});

describe("everything else", () => {
  it("unknown method 404s with MethodNotImplemented", async () => {
    const res = xrpcResponse("com.atproto.repo.createRecord", xrpcUrl("com.atproto.repo.createRecord"));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "MethodNotImplemented" });
  });

  it("CORS preflight is a 204 with permissive headers", () => {
    const res = corsPreflight();
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toMatch(/GET/);
  });
});
