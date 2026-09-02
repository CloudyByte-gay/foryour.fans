import { syncUserFromProfile } from "@foryour-fans/auth";
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
import { cleanupUser as cleanup, env, loginNewUser, newDid, prisma, redis } from "./helpers.js";

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
    const response = await app.inject({ method: "POST", url: "/creators", payload: {} });
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
      payload: {},
    });
    expect(response.statusCode).toBe(403);
    await app.close();
    await cleanup(did);
  });

  it("creates a creator from an empty body, publishing the AT record before the DB row", async () => {
    const { app, did, handle, sessionId, csrfToken, publishCalls } = await loginNewUser("bob.test");

    const response = await app.inject({
      method: "POST",
      url: "/creators",
      cookies: { ff_session: sessionId },
      headers: { "x-csrf-token": csrfToken },
      payload: {},
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ did, handle });
    expect(response.json()).not.toHaveProperty("slug");

    expect(publishCalls).toHaveLength(1);
    expect(publishCalls[0]).toMatchObject({ did, collection: "fans.foryour.profile", rkey: "self" });

    const creator = await prisma.creator.findUnique({ where: { did } });
    expect(creator).not.toBeNull();

    await app.close();
    await cleanup(did);
  });

  it("creates a creator with profile fields", async () => {
    const { app, did, handle, sessionId, csrfToken, publishCalls } = await loginNewUser("bella.test");

    const response = await app.inject({
      method: "POST",
      url: "/creators",
      cookies: { ff_session: sessionId },
      headers: { "x-csrf-token": csrfToken },
      payload: { displayName: "Bella", bio: "hello", website: "https://bella.example" },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      did,
      handle,
      displayName: "Bella",
      bio: "hello",
      website: "https://bella.example",
    });
    expect(publishCalls[0]).toMatchObject({
      record: { displayName: "Bella", bio: "hello", website: "https://bella.example" },
    });

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
      payload: {},
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: "POST",
      url: "/creators",
      cookies: { ff_session: sessionId },
      headers: { "x-csrf-token": csrfToken },
      payload: {},
    });
    expect(second.statusCode).toBe(409);

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
      payload: {},
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
    await a.app.inject({
      method: "POST",
      url: "/creators",
      cookies: { ff_session: a.sessionId },
      headers: { "x-csrf-token": a.csrfToken },
      payload: { displayName: "Iris A" },
    });

    const b = await loginNewUser("iris-b.test");
    await b.app.inject({
      method: "POST",
      url: "/creators",
      cookies: { ff_session: b.sessionId },
      headers: { "x-csrf-token": b.csrfToken },
      payload: { displayName: "Iris B" },
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

  it("an empty PATCH body does not touch the AT record", async () => {
    const { app, did, sessionId, csrfToken, publishCalls } = await loginNewUser("jack.test");
    await app.inject({
      method: "POST",
      url: "/creators",
      cookies: { ff_session: sessionId },
      headers: { "x-csrf-token": csrfToken },
      payload: {},
    });
    publishCalls.length = 0;

    const response = await app.inject({
      method: "PATCH",
      url: "/creators/me",
      cookies: { ff_session: sessionId },
      headers: { "x-csrf-token": csrfToken },
      payload: {},
    });
    expect(response.statusCode).toBe(200);
    expect(publishCalls).toHaveLength(0);

    await app.close();
    await cleanup(did);
  });

  it("a profile PATCH republishes the AT record", async () => {
    const { app, did, sessionId, csrfToken, publishCalls } = await loginNewUser("kate.test");
    await app.inject({
      method: "POST",
      url: "/creators",
      cookies: { ff_session: sessionId },
      headers: { "x-csrf-token": csrfToken },
      payload: {},
    });
    publishCalls.length = 0;

    const response = await app.inject({
      method: "PATCH",
      url: "/creators/me",
      cookies: { ff_session: sessionId },
      headers: { "x-csrf-token": csrfToken },
      payload: { bio: "updated bio" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ bio: "updated bio" });
    expect(publishCalls).toHaveLength(1);
    expect(publishCalls[0]).toMatchObject({ record: { bio: "updated bio" } });

    await app.close();
    await cleanup(did);
  });
});

describe("GET /creators/:identifier", () => {
  it("resolves by handle and by DID", async () => {
    const { app, did, handle, sessionId, csrfToken } = await loginNewUser("liam.test");
    await app.inject({
      method: "POST",
      url: "/creators",
      cookies: { ff_session: sessionId },
      headers: { "x-csrf-token": csrfToken },
      payload: { displayName: "Liam" },
    });

    const byHandle = await app.inject({ method: "GET", url: `/creators/${handle}` });
    expect(byHandle.statusCode).toBe(200);
    expect(byHandle.json()).toMatchObject({ did, handle });

    const byDid = await app.inject({ method: "GET", url: `/creators/${encodeURIComponent(did)}` });
    expect(byDid.statusCode).toBe(200);
    expect(byDid.json()).toMatchObject({ did, handle });

    // Public response never leaks internal fields.
    expect(byHandle.json()).not.toHaveProperty("status");
    expect(byHandle.json()).not.toHaveProperty("verificationStatus");
    expect(byHandle.json()).not.toHaveProperty("slug");

    await app.close();
    await cleanup(did);
  });

  it("returns 404 for an unknown identifier", async () => {
    const { app, did } = await loginNewUser("mia.test");
    const response = await app.inject({ method: "GET", url: "/creators/no-such-creator.test" });
    expect(response.statusCode).toBe(404);
    await app.close();
    await cleanup(did);
  });

  it("hides a suspended creator from public lookup", async () => {
    const { app, did, handle, sessionId, csrfToken } = await loginNewUser("nora.test");
    await app.inject({
      method: "POST",
      url: "/creators",
      cookies: { ff_session: sessionId },
      headers: { "x-csrf-token": csrfToken },
      payload: {},
    });
    await prisma.creator.update({ where: { did }, data: { status: "SUSPENDED" } });

    const response = await app.inject({ method: "GET", url: `/creators/${handle}` });
    expect(response.statusCode).toBe(404);

    await app.close();
    await cleanup(did);
  });

  it("301-redirects an old handle to the current one after a handle change", async () => {
    const { app, did, handle: oldHandle, sessionId, csrfToken } = await loginNewUser("opal-old.test");
    await app.inject({
      method: "POST",
      url: "/creators",
      cookies: { ff_session: sessionId },
      headers: { "x-csrf-token": csrfToken },
      payload: {},
    });

    // Simulate the PDS reporting a new handle on the next login: the real
    // login-time sync path appends a CreatorHandleHistory row for the old
    // handle and overwrites User.handle.
    const newHandle = "opal-new.test";
    await syncUserFromProfile(prisma, { did, handle: newHandle });

    const history = await prisma.creatorHandleHistory.findMany({ where: { did } });
    expect(history).toHaveLength(1);
    expect(history[0]?.previousHandle).toBe(oldHandle);

    const stale = await app.inject({ method: "GET", url: `/creators/${oldHandle}` });
    expect(stale.statusCode).toBe(301);
    expect(stale.headers.location).toBe(`/creators/${newHandle}`);
    expect(stale.json()).toMatchObject({ movedTo: newHandle, did });

    const byNew = await app.inject({ method: "GET", url: `/creators/${newHandle}` });
    expect(byNew.statusCode).toBe(200);
    expect(byNew.json()).toMatchObject({ did, handle: newHandle });

    const byDid = await app.inject({ method: "GET", url: `/creators/${encodeURIComponent(did)}` });
    expect(byDid.statusCode).toBe(200);
    expect(byDid.json()).toMatchObject({ did, handle: newHandle });

    await app.close();
    await cleanup(did);
  });

  it("does not record handle history for a non-creator, and a former non-creator handle 404s", async () => {
    const { app, did } = await loginNewUser("pat-old.test");

    await syncUserFromProfile(prisma, { did, handle: "pat-new.test" });
    expect(await prisma.creatorHandleHistory.findMany({ where: { did } })).toHaveLength(0);

    const stale = await app.inject({ method: "GET", url: "/creators/pat-old.test" });
    expect(stale.statusCode).toBe(404);

    await app.close();
    await cleanup(did);
  });
});
