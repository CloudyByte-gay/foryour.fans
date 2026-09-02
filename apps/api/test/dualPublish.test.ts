import { CreatorOwnedContentRepository, FakePds } from "@foryour-fans/content";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupUser,
  loginAndBecomeCreator,
  prisma,
  redis,
  uniqueHandle,
  type TestSession,
} from "./helpers.js";

/**
 * The Bluesky-public-posts refactor at the API level
 * (prompts/bluesky-public-posts.md): a PUBLIC post authored through
 * foryour.fans is dual-published to the creator's PDS as BOTH
 * `app.bsky.feed.post` and `fans.foryour.post`, and the API response
 * exposes both AT URIs; a gated post is never dual-published.
 *
 * These run against a real `CreatorOwnedContentRepository` over an
 * in-memory `FakePds` (the same wiring contentKeys.test.ts uses), i.e. the
 * `CREATOR_OWNED_PDS_ENABLED` path.
 */

let pds: FakePds;
let creator: TestSession;

function repo(): CreatorOwnedContentRepository {
  return new CreatorOwnedContentRepository(prisma, {
    publishAtRecord: pds.publish,
    deleteAtRecord: pds.delete,
    readAtRecord: pds.read,
    listAtRecords: pds.list,
    crypto: null,
    resolveHandleToDid: async (h) => (h === "friend.test" ? "did:plc:friend" : null),
    config: { sourceApp: "foryour.fans", gatedContentEnabled: false },
  });
}

beforeEach(async () => {
  pds = new FakePds();
  creator = await loginAndBecomeCreator(uniqueHandle("dp-creator"), { contentRepository: repo() });
});

afterEach(async () => {
  await creator.app.close();
  await cleanupUser(creator.did);
});

afterAll(async () => {
  await prisma.$disconnect();
  redis.disconnect();
});

function post(payload: Record<string, unknown>) {
  return creator.app.inject({
    method: "POST",
    url: "/creators/me/posts",
    cookies: { ff_session: creator.sessionId },
    headers: { "x-csrf-token": creator.csrfToken },
    payload,
  });
}

describe("POST /creators/me/posts — dual publish", () => {
  it("writes app.bsky.feed.post + fans.foryour.post and returns both AT URIs", async () => {
    const res = await post({ visibility: "PUBLIC", text: "hello open network at example.com", langs: ["en"], tags: ["hi"] });
    expect(res.statusCode).toBe(201);
    const body = res.json() as Record<string, unknown>;

    expect(body.foryourAtUri).toMatch(/^at:\/\/.+\/fans\.foryour\.post\//);
    expect(body.bskyAtUri).toMatch(/^at:\/\/.+\/app\.bsky\.feed\.post\//);
    expect(body.canonicalUri).toBe(body.foryourAtUri);
    expect(body.sourceCollections).toEqual(["fans.foryour.post", "app.bsky.feed.post"]);

    const collections = pds.publishCalls.map((c) => c.collection);
    expect(collections).toContain("app.bsky.feed.post");
    expect(collections).toContain("fans.foryour.post");

    const bsky = pds.all(creator.did).find((r) => r.value.$type === "app.bsky.feed.post")!;
    expect(bsky.value.langs).toEqual(["en"]);
    const facetKinds = (bsky.value.facets as Array<{ features: Array<{ $type: string }> }> | undefined)?.flatMap((f) =>
      f.features.map((x) => x.$type),
    );
    expect(facetKinds).toContain("app.bsky.richtext.facet#link");
  });

  it("a SUBSCRIBERS post is never written as app.bsky.feed.post", async () => {
    const res = await post({ visibility: "SUBSCRIBERS", text: "subscribers only" });
    expect(res.statusCode).toBe(201);
    const body = res.json() as Record<string, unknown>;

    expect(body.bskyAtUri).toBeNull();
    expect(body.sourceCollections).toEqual([]); // flag-off gated post is Postgres-only
    expect(pds.publishCalls.map((c) => c.collection)).not.toContain("app.bsky.feed.post");
  });

  it("rejects langs/tags on a non-PUBLIC post", async () => {
    const res = await post({ visibility: "SUBSCRIBERS", text: "x", tags: ["nope"] });
    expect(res.statusCode).toBe(400);
  });
});

describe("PATCH /creators/me/posts/:id", () => {
  it("edits a PUBLIC post in place, keeping both AT records", async () => {
    const created = (await post({ visibility: "PUBLIC", text: "v1" })).json() as { id: string; bskyAtUri: string };
    // PATCH is full-replace (the composer always sends every field).
    const res = await creator.app.inject({
      method: "PATCH",
      url: `/creators/me/posts/${created.id}`,
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
      payload: { visibility: "PUBLIC", text: "v2 edited" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body.text).toBe("v2 edited");
    expect(body.bskyAtUri).toBe(created.bskyAtUri); // same rkey reused
    expect(pds.deleteCalls).toHaveLength(0);
  });

  it("moving PUBLIC -> SUBSCRIBERS retracts the app.bsky.feed.post", async () => {
    const created = (await post({ visibility: "PUBLIC", text: "was public" })).json() as { id: string };
    const res = await creator.app.inject({
      method: "PATCH",
      url: `/creators/me/posts/${created.id}`,
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
      payload: { visibility: "SUBSCRIBERS", text: "now gated" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body.bskyAtUri).toBeNull();
    expect(pds.deleteCalls.map((c) => c.collection)).toContain("app.bsky.feed.post");
  });
});

describe("DELETE /creators/me/posts/:id", () => {
  it("retracts both AT records", async () => {
    const created = (await post({ visibility: "PUBLIC", text: "goodbye" })).json() as { id: string };
    const res = await creator.app.inject({
      method: "DELETE",
      url: `/creators/me/posts/${created.id}`,
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
    });
    expect(res.statusCode).toBe(204);
    expect(pds.deleteCalls.map((c) => c.collection).sort()).toEqual(
      ["app.bsky.feed.post", "fans.foryour.post"].sort(),
    );
  });
});

describe("GET /posts/:id — resolve by AT URI", () => {
  it("resolves by the fans.foryour.post and app.bsky.feed.post URIs to the same post", async () => {
    const created = (await post({ visibility: "PUBLIC", text: "find me" })).json() as {
      id: string;
      foryourAtUri: string;
      bskyAtUri: string;
    };

    const byLocal = await creator.app.inject({ method: "GET", url: `/posts/${created.id}` });
    const byFoyur = await creator.app.inject({
      method: "GET",
      url: `/posts/${encodeURIComponent(created.foryourAtUri)}`,
    });
    const byBsky = await creator.app.inject({
      method: "GET",
      url: `/posts/${encodeURIComponent(created.bskyAtUri)}`,
    });

    expect(byLocal.statusCode).toBe(200);
    expect(byFoyur.json()).toMatchObject({ id: created.id });
    expect(byBsky.json()).toMatchObject({ id: created.id });
  });
});

describe("GET /feed — dedupe", () => {
  it("a dual-published post appears exactly once", async () => {
    await post({ visibility: "PUBLIC", text: "one authored post" });
    const res = await creator.app.inject({ method: "GET", url: "/feed" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ text: string; bskyAtUri: string | null }>;
    const mine = body.filter((p) => p.text === "one authored post");
    expect(mine).toHaveLength(1);
    expect(mine[0]!.bskyAtUri).toMatch(/app\.bsky\.feed\.post/);
  });
});
