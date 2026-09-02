import { randomUUID } from "node:crypto";
import { getPrismaClient, type PrismaClient } from "@foryour-fans/database";
import { afterAll, describe, expect, it } from "vitest";
import { listDiscoverableCreators, searchCreators } from "./discover.js";

const prisma: PrismaClient = getPrismaClient();

function newDid(): string {
  return `did:plc:test${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

async function seedProfile(fields: { handle?: string; displayName?: string; bio?: string }): Promise<string> {
  const did = newDid();
  await prisma.indexedCreatorProfile.create({ data: { did, ...fields } });
  return did;
}

/** Scoped to specific dids, never a blanket deleteMany — see indexer.test.ts's cleanup() doc comment for why (this table is shared across 3 parallel test files). */
async function cleanup(...dids: string[]): Promise<void> {
  await prisma.indexedCreatorProfile.deleteMany({ where: { did: { in: dids } } });
}

afterAll(async () => {
  await prisma.$disconnect();
});

describe("listDiscoverableCreators", () => {
  it("returns indexed profiles, respecting limit", async () => {
    const dids = [await seedProfile({ handle: "alice.test" }), await seedProfile({ handle: "bob.test" }), await seedProfile({ handle: "carol.test" })];

    const page = await listDiscoverableCreators(prisma, { limit: 2 });
    expect(page.length).toBeLessThanOrEqual(2);

    await cleanup(...dids);
  });

  it("cursor pagination returns every profile exactly once", async () => {
    const dids = [await seedProfile({ handle: "dave.test" }), await seedProfile({ handle: "erin.test" }), await seedProfile({ handle: "frank.test" })];

    const page1 = await listDiscoverableCreators(prisma, { limit: 2 });
    const page1Dids = page1.map((p) => p.did).filter((d) => dids.includes(d));

    const page2 = await listDiscoverableCreators(prisma, { limit: 20, cursor: page1[page1.length - 1]!.did });
    const page2Dids = page2.map((p) => p.did).filter((d) => dids.includes(d));

    const allSeen = [...page1Dids, ...page2Dids];
    expect(new Set(allSeen).size).toBe(dids.length);
    // No overlap between pages — a real repeat would mean cursor pagination is broken.
    expect(page1Dids.filter((d) => page2Dids.includes(d))).toHaveLength(0);

    await cleanup(...dids);
  });
});

describe("searchCreators", () => {
  it("matches on handle, case-insensitively", async () => {
    const did = await seedProfile({ handle: "GamerGrace.test" });
    const results = await searchCreators(prisma, { query: "gamergrace" });
    expect(results.map((r) => r.handle)).toContain("GamerGrace.test");
    await cleanup(did);
  });

  it("matches on displayName", async () => {
    const did = await seedProfile({ handle: "someone.test", displayName: "Cosplay Queen" });
    const results = await searchCreators(prisma, { query: "cosplay" });
    expect(results.map((r) => r.displayName)).toContain("Cosplay Queen");
    await cleanup(did);
  });

  it("matches on bio", async () => {
    const did = await seedProfile({ handle: "another.test", bio: "I paint miniatures" });
    const results = await searchCreators(prisma, { query: "miniatures" });
    expect(results.map((r) => r.bio)).toContain("I paint miniatures");
    await cleanup(did);
  });

  it("returns no results for a non-matching query", async () => {
    const did = await seedProfile({ handle: "irrelevant.test" });
    const results = await searchCreators(prisma, { query: "nonexistent-search-term-xyz" });
    expect(results).toHaveLength(0);
    await cleanup(did);
  });

  it("returns no results for an empty/whitespace query, without hitting the database", async () => {
    const results = await searchCreators(prisma, { query: "   " });
    expect(results).toEqual([]);
  });
});
