import { afterAll, describe, expect, it } from "vitest";
import { cleanupUser, createTierFor, loginAndBecomeCreator, loginNewUser, newDid, prisma, redis, uniqueHandle } from "./helpers.js";

afterAll(async () => {
  await prisma.$disconnect();
  redis.disconnect();
});

/**
 * These are the only apps/api tests touching `indexed_creator_profiles` —
 * unlike packages/discovery's own test suite, no cross-file collision risk
 * here — but every cleanup below is still did-scoped, not a blanket
 * `deleteMany({})`, to stay consistent with the rule that bit Phase 10
 * development (see docs/architecture.md and
 * packages/discovery/src/indexer.test.ts).
 */
async function seedIndexedProfile(fields: { handle?: string; displayName?: string; bio?: string } = {}): Promise<string> {
  const did = newDid();
  await prisma.indexedCreatorProfile.create({ data: { did, ...fields } });
  return did;
}

async function cleanupIndexed(...dids: string[]): Promise<void> {
  await prisma.indexedCreatorProfile.deleteMany({ where: { did: { in: dids } } });
}

describe("GET /discover", () => {
  it("returns indexed creator profiles", async () => {
    const { app, did: sessionDid } = await loginNewUser(uniqueHandle("alice"));
    const did = await seedIndexedProfile({ handle: "someone.test", displayName: "Someone" });

    const response = await app.inject({ method: "GET", url: "/discover" });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { creators: Array<{ did: string }> };
    expect(body.creators.map((c) => c.did)).toContain(did);

    await app.close();
    await cleanupIndexed(did);
    await cleanupUser(sessionDid);
  });

  it("marks isRegisteredCreator true only for a DID with a local, ACTIVE Creator row", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("bob"));
    // The real creator's own AT profile also gets indexed via ingestion in
    // production — simulate that here directly rather than running a real
    // ingestor, since this route only ever reads the index.
    await prisma.indexedCreatorProfile.create({ data: { did: creator.did, handle: creator.handle } });
    const strangerDid = await seedIndexedProfile({ handle: "unregistered.test" });

    const response = await creator.app.inject({ method: "GET", url: "/discover" });
    const body = response.json() as { creators: Array<{ did: string; isRegisteredCreator: boolean }> };
    const registeredEntry = body.creators.find((c) => c.did === creator.did);
    const strangerEntry = body.creators.find((c) => c.did === strangerDid);
    expect(registeredEntry?.isRegisteredCreator).toBe(true);
    expect(strangerEntry?.isRegisteredCreator).toBe(false);

    await creator.app.close();
    await cleanupIndexed(creator.did, strangerDid);
    await cleanupUser(creator.did);
  });

  it("enriches a registered creator with avatar, tier count and from-price; leaves an unregistered profile null/zero", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("fiona"));
    await prisma.indexedCreatorProfile.create({ data: { did: creator.did, handle: creator.handle } });
    await createTierFor(creator, { name: "Cheap", priceCents: 900, currency: "usd" });
    await createTierFor(creator, { name: "Pricier", priceCents: 1500, currency: "usd" });
    const strangerDid = await seedIndexedProfile({ handle: "noTiers.test" });

    const response = await creator.app.inject({ method: "GET", url: "/discover" });
    const body = response.json() as {
      creators: Array<{
        did: string;
        tierCount: number;
        fromPriceCents: number | null;
        fromPriceCurrency: string | null;
        avatarUrl: string | null;
      }>;
    };
    const registeredEntry = body.creators.find((c) => c.did === creator.did);
    const strangerEntry = body.creators.find((c) => c.did === strangerDid);

    expect(registeredEntry?.tierCount).toBe(2);
    expect(registeredEntry?.fromPriceCents).toBe(900);
    expect(registeredEntry?.fromPriceCurrency).toBe("usd");

    expect(strangerEntry?.tierCount).toBe(0);
    expect(strangerEntry?.fromPriceCents).toBeNull();
    expect(strangerEntry?.avatarUrl).toBeNull();

    await creator.app.close();
    await cleanupIndexed(creator.did, strangerDid);
    await cleanupUser(creator.did);
  });

  it("respects the limit query param", async () => {
    const { app, did: sessionDid } = await loginNewUser(uniqueHandle("carol"));
    const dids = [await seedIndexedProfile(), await seedIndexedProfile(), await seedIndexedProfile()];

    const response = await app.inject({ method: "GET", url: "/discover?limit=1" });
    const body = response.json() as { creators: unknown[] };
    expect(body.creators.length).toBeLessThanOrEqual(1);

    await app.close();
    await cleanupIndexed(...dids);
    await cleanupUser(sessionDid);
  });

  it("rejects an invalid limit", async () => {
    const { app, did: sessionDid } = await loginNewUser(uniqueHandle("dave"));
    const response = await app.inject({ method: "GET", url: "/discover?limit=not-a-number" });
    expect(response.statusCode).toBe(400);
    await app.close();
    await cleanupUser(sessionDid);
  });

  it("cursor pagination returns every seeded profile exactly once", async () => {
    const { app, did: sessionDid } = await loginNewUser(uniqueHandle("erin"));
    const dids = [await seedIndexedProfile(), await seedIndexedProfile(), await seedIndexedProfile()];

    const page1 = await app.inject({ method: "GET", url: "/discover?limit=2" });
    const body1 = page1.json() as { creators: Array<{ did: string }>; nextCursor: string };
    const page1Dids = body1.creators.map((c) => c.did).filter((d) => dids.includes(d));

    const page2 = await app.inject({ method: "GET", url: `/discover?limit=20&cursor=${body1.nextCursor}` });
    const body2 = page2.json() as { creators: Array<{ did: string }> };
    const page2Dids = body2.creators.map((c) => c.did).filter((d) => dids.includes(d));

    expect(new Set([...page1Dids, ...page2Dids]).size).toBe(dids.length);
    expect(page1Dids.some((d) => page2Dids.includes(d))).toBe(false);

    await app.close();
    await cleanupIndexed(...dids);
    await cleanupUser(sessionDid);
  });
});

describe("GET /search", () => {
  it("requires a query", async () => {
    const { app, did: sessionDid } = await loginNewUser(uniqueHandle("frank"));
    const response = await app.inject({ method: "GET", url: "/search" });
    expect(response.statusCode).toBe(400);
    await app.close();
    await cleanupUser(sessionDid);
  });

  it("matches by handle, displayName, or bio, case-insensitively", async () => {
    const { app, did: sessionDid } = await loginNewUser(uniqueHandle("gwen"));
    const did = await seedIndexedProfile({ handle: "PixelPainter.test", bio: "digital art" });

    const response = await app.inject({ method: "GET", url: "/search?q=pixelpainter" });
    const body = response.json() as { creators: Array<{ did: string }> };
    expect(body.creators.map((c) => c.did)).toContain(did);

    await app.close();
    await cleanupIndexed(did);
    await cleanupUser(sessionDid);
  });

  it("returns an empty list for a non-matching query", async () => {
    const { app, did: sessionDid } = await loginNewUser(uniqueHandle("henry"));
    const response = await app.inject({ method: "GET", url: "/search?q=nonexistent-xyz-term" });
    expect(response.statusCode).toBe(200);
    expect((response.json() as { creators: unknown[] }).creators).toEqual([]);
    await app.close();
    await cleanupUser(sessionDid);
  });
});
