import { FakePaymentProvider, FakePayoutProvider } from "@foryour-fans/subscriptions";
import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import {
  createFakeOAuthClient,
  fakeContentRepository,
  fakeDeleteAtRecord,
  fakeFetchProfile,
  fakePublishAtRecord,
  failingPublishAtRecord,
} from "./fakes.js";
import { cleanupUser as cleanup, env, loginNewUser, newDid, prisma, redis, uniqueSlug } from "./helpers.js";

afterAll(async () => {
  await prisma.$disconnect();
  redis.disconnect();
});

describe("POST /creators", () => {
  it("requires authentication", async () => {
    const publish = fakePublishAtRecord();
    const app = buildApp({
      env,
      checkDatabaseConnection: async () => {},
      redis,
      prisma,
      oauthClient: createFakeOAuthClient(),
      fetchProfile: fakeFetchProfile({ did: "did:plc:unused", handle: "unused" }),
      publishAtRecord: publish.publish,
      deleteAtRecord: fakeDeleteAtRecord().del,
      paymentProvider: new FakePaymentProvider(),
      payoutProvider: new FakePayoutProvider(),
      contentRepository: fakeContentRepository(prisma),
    });
    const response = await app.inject({ method: "POST", url: "/creators", payload: { slug: uniqueSlug("x") } });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("requires a matching CSRF token", async () => {
    const { app, did, sessionId } = await loginNewUser("alice.test");
    const response = await app.inject({
      method: "POST",
      url: "/creators",
      cookies: { ff_session: sessionId },
      headers: { "x-csrf-token": "wrong" },
      payload: { slug: uniqueSlug("alice") },
    });
    expect(response.statusCode).toBe(403);
    await app.close();
    await cleanup(did);
  });

  it("creates a creator, publishing the AT record before the DB row", async () => {
    const { app, did, sessionId, csrfToken, publishCalls } = await loginNewUser("bob.test");
    const slug = uniqueSlug("bob");

    const response = await app.inject({
      method: "POST",
      url: "/creators",
      cookies: { ff_session: sessionId },
      headers: { "x-csrf-token": csrfToken },
      payload: { slug, displayName: "Bob", bio: "hello", website: "https://bob.example" },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ did, slug, displayName: "Bob", bio: "hello", website: "https://bob.example" });

    expect(publishCalls).toHaveLength(1);
    expect(publishCalls[0]).toMatchObject({
      did,
      collection: "fans.foryour.profile",
      rkey: "self",
      record: { displayName: "Bob", bio: "hello", website: "https://bob.example" },
    });

    const creator = await prisma.creator.findUnique({ where: { did } });
    expect(creator).not.toBeNull();
    expect(creator?.slug).toBe(slug);

    await app.close();
    await cleanup(did);
  });

  it("rejects becoming a creator twice", async () => {
    const { app, did, sessionId, csrfToken } = await loginNewUser("carol.test");

    const first = await app.inject({
      method: "POST",
      url: "/creators",
      cookies: { ff_session: sessionId },
      headers: { "x-csrf-token": csrfToken },
      payload: { slug: uniqueSlug("carol") },
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: "POST",
      url: "/creators",
      cookies: { ff_session: sessionId },
      headers: { "x-csrf-token": csrfToken },
      payload: { slug: uniqueSlug("carol-2") },
    });
    expect(second.statusCode).toBe(409);

    await app.close();
    await cleanup(did);
  });

  it("rejects a taken slug", async () => {
    const a = await loginNewUser("dave-a.test");
    const slug = uniqueSlug("dave");
    const created = await a.app.inject({
      method: "POST",
      url: "/creators",
      cookies: { ff_session: a.sessionId },
      headers: { "x-csrf-token": a.csrfToken },
      payload: { slug },
    });
    expect(created.statusCode).toBe(201);

    const b = await loginNewUser("dave-b.test");
    const conflict = await b.app.inject({
      method: "POST",
      url: "/creators",
      cookies: { ff_session: b.sessionId },
      headers: { "x-csrf-token": b.csrfToken },
      payload: { slug },
    });
    expect(conflict.statusCode).toBe(409);

    await a.app.close();
    await b.app.close();
    await cleanup(a.did);
    await cleanup(b.did);
  });

  it("rejects an invalid slug", async () => {
    const { app, did, sessionId, csrfToken } = await loginNewUser("eve.test");
    const response = await app.inject({
      method: "POST",
      url: "/creators",
      cookies: { ff_session: sessionId },
      headers: { "x-csrf-token": csrfToken },
      payload: { slug: "Not_Valid!" },
    });
    expect(response.statusCode).toBe(400);
    await app.close();
    await cleanup(did);
  });

  it("rejects a reserved slug", async () => {
    const { app, did, sessionId, csrfToken } = await loginNewUser("frank.test");
    const response = await app.inject({
      method: "POST",
      url: "/creators",
      cookies: { ff_session: sessionId },
      headers: { "x-csrf-token": csrfToken },
      payload: { slug: "admin" },
    });
    expect(response.statusCode).toBe(400);
    await app.close();
    await cleanup(did);
  });

  it("does not create a DB row if the AT record publish fails", async () => {
    const did = newDid();
    const app = buildApp({
      env,
      checkDatabaseConnection: async () => {},
      redis,
      prisma,
      oauthClient: createFakeOAuthClient(),
      fetchProfile: fakeFetchProfile({ did, handle: "grace.test" }),
      publishAtRecord: failingPublishAtRecord(),
      deleteAtRecord: fakeDeleteAtRecord().del,
      paymentProvider: new FakePaymentProvider(),
      payoutProvider: new FakePayoutProvider(),
      contentRepository: fakeContentRepository(prisma),
    });
    const loginResponse = await app.inject({ method: "GET", url: "/auth/atproto/callback?code=fake&state=fake" });
    const sessionId = loginResponse.cookies.find((c) => c.name === "ff_session")!.value;
    const csrfToken = loginResponse.cookies.find((c) => c.name === "ff_csrf")!.value;

    const response = await app.inject({
      method: "POST",
      url: "/creators",
      cookies: { ff_session: sessionId },
      headers: { "x-csrf-token": csrfToken },
      payload: { slug: uniqueSlug("grace") },
    });

    expect(response.statusCode).toBe(502);
    expect(await prisma.creator.findUnique({ where: { did } })).toBeNull();

    await app.close();
    await cleanup(did);
  });
});

describe("GET /creators/me and PATCH /creators/me", () => {
  it("GET /creators/me is 404 before becoming a creator", async () => {
    const { app, did, sessionId } = await loginNewUser("henry.test");
    const response = await app.inject({ method: "GET", url: "/creators/me", cookies: { ff_session: sessionId } });
    expect(response.statusCode).toBe(404);
    await app.close();
    await cleanup(did);
  });

  it("PATCH only updates the caller's own creator, never another user's", async () => {
    const a = await loginNewUser("iris-a.test");
    const aSlug = uniqueSlug("iris-a");
    await a.app.inject({
      method: "POST",
      url: "/creators",
      cookies: { ff_session: a.sessionId },
      headers: { "x-csrf-token": a.csrfToken },
      payload: { slug: aSlug, displayName: "Iris A" },
    });

    const b = await loginNewUser("iris-b.test");
    const bSlug = uniqueSlug("iris-b");
    await b.app.inject({
      method: "POST",
      url: "/creators",
      cookies: { ff_session: b.sessionId },
      headers: { "x-csrf-token": b.csrfToken },
      payload: { slug: bSlug, displayName: "Iris B" },
    });

    // B patches "their own" /creators/me — must never be able to reach A's row,
    // since the route never accepts a creator id from the client at all.
    const patchResponse = await b.app.inject({
      method: "PATCH",
      url: "/creators/me",
      cookies: { ff_session: b.sessionId },
      headers: { "x-csrf-token": b.csrfToken },
      payload: { displayName: "Iris B Updated" },
    });
    expect(patchResponse.statusCode).toBe(200);
    expect(patchResponse.json()).toMatchObject({ displayName: "Iris B Updated" });

    const aCreator = await prisma.creator.findUnique({ where: { did: a.did } });
    expect(aCreator?.displayName).toBe("Iris A");
    const bCreator = await prisma.creator.findUnique({ where: { did: b.did } });
    expect(bCreator?.displayName).toBe("Iris B Updated");

    await a.app.close();
    await b.app.close();
    await cleanup(a.did);
    await cleanup(b.did);
  });

  it("updating only the slug does not touch the AT record", async () => {
    const { app, did, sessionId, csrfToken, publishCalls } = await loginNewUser("jack.test");
    await app.inject({
      method: "POST",
      url: "/creators",
      cookies: { ff_session: sessionId },
      headers: { "x-csrf-token": csrfToken },
      payload: { slug: uniqueSlug("jack") },
    });
    publishCalls.length = 0;

    const newSlug = uniqueSlug("jack-new");
    const response = await app.inject({
      method: "PATCH",
      url: "/creators/me",
      cookies: { ff_session: sessionId },
      headers: { "x-csrf-token": csrfToken },
      payload: { slug: newSlug },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ slug: newSlug });
    expect(publishCalls).toHaveLength(0);

    await app.close();
    await cleanup(did);
  });

  it("rejects a second slug change within the cooldown window", async () => {
    const { app, did, sessionId, csrfToken } = await loginNewUser("kate.test");
    await app.inject({
      method: "POST",
      url: "/creators",
      cookies: { ff_session: sessionId },
      headers: { "x-csrf-token": csrfToken },
      payload: { slug: uniqueSlug("kate") },
    });

    const firstChange = await app.inject({
      method: "PATCH",
      url: "/creators/me",
      cookies: { ff_session: sessionId },
      headers: { "x-csrf-token": csrfToken },
      payload: { slug: uniqueSlug("kate-2") },
    });
    expect(firstChange.statusCode).toBe(200);

    const secondChange = await app.inject({
      method: "PATCH",
      url: "/creators/me",
      cookies: { ff_session: sessionId },
      headers: { "x-csrf-token": csrfToken },
      payload: { slug: uniqueSlug("kate-3") },
    });
    expect(secondChange.statusCode).toBe(429);

    await app.close();
    await cleanup(did);
  });
});

describe("GET /creators/:identifier", () => {
  it("resolves by slug, by DID, and by cached handle", async () => {
    const { app, did, sessionId, csrfToken } = await loginNewUser("liam.test");
    const slug = uniqueSlug("liam");
    await app.inject({
      method: "POST",
      url: "/creators",
      cookies: { ff_session: sessionId },
      headers: { "x-csrf-token": csrfToken },
      payload: { slug, displayName: "Liam" },
    });

    const bySlug = await app.inject({ method: "GET", url: `/creators/${slug}` });
    expect(bySlug.statusCode).toBe(200);
    expect(bySlug.json()).toMatchObject({ did, slug });

    const byDid = await app.inject({ method: "GET", url: `/creators/${did}` });
    expect(byDid.statusCode).toBe(200);
    expect(byDid.json()).toMatchObject({ slug });

    const byHandle = await app.inject({ method: "GET", url: "/creators/liam.test" });
    expect(byHandle.statusCode).toBe(200);
    expect(byHandle.json()).toMatchObject({ slug });

    // Public response never leaks internal fields.
    expect(bySlug.json()).not.toHaveProperty("status");
    expect(bySlug.json()).not.toHaveProperty("verificationStatus");

    await app.close();
    await cleanup(did);
  });

  it("returns 404 for an unknown identifier", async () => {
    const { app, did } = await loginNewUser("mia.test");
    const response = await app.inject({ method: "GET", url: "/creators/no-such-creator-slug" });
    expect(response.statusCode).toBe(404);
    await app.close();
    await cleanup(did);
  });

  it("hides a suspended creator from public lookup", async () => {
    const { app, did, sessionId, csrfToken } = await loginNewUser("nora.test");
    const slug = uniqueSlug("nora");
    await app.inject({
      method: "POST",
      url: "/creators",
      cookies: { ff_session: sessionId },
      headers: { "x-csrf-token": csrfToken },
      payload: { slug },
    });
    await prisma.creator.update({ where: { did }, data: { status: "SUSPENDED" } });

    const response = await app.inject({ method: "GET", url: `/creators/${slug}` });
    expect(response.statusCode).toBe(404);

    await app.close();
    await cleanup(did);
  });
});
