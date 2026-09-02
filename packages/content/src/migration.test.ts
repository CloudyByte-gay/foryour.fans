import { randomUUID } from "node:crypto";
import { getPrismaClient, type PrismaClient } from "@foryour-fans/database";
import { NSID } from "@foryour-fans/lexicons";
import { afterAll, describe, expect, it } from "vitest";
import { FakePds } from "./fakePds.js";
import { migrateCreatorContentToPds, type MigrationDeps } from "./migration.js";

const prisma: PrismaClient = getPrismaClient();

function newDid(): string {
  return `did:plc:test${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

async function makeCreatorWithContent(): Promise<{ id: string; did: string; publicPostId: string; gatedPostId: string }> {
  const did = newDid();
  const user = await prisma.user.create({ data: { did, handle: `${randomUUID().slice(0, 8)}.test` } });
  const creator = await prisma.creator.create({
    data: { userId: user.id, did, displayName: "Old App Name", bio: "migrated bio" },
  });
  await prisma.subscriptionTier.create({
    data: { creatorId: creator.id, name: "Fans", priceCents: 500, currency: "usd", atRkey: randomUUID() },
  });
  const publicPost = await prisma.post.create({
    data: { creatorId: creator.id, visibility: "PUBLIC", text: "an old public post", isAuthoritative: true },
  });
  const gatedPost = await prisma.post.create({
    data: { creatorId: creator.id, visibility: "SUBSCRIBERS", text: "an old paid post", isAuthoritative: true },
  });
  return { id: creator.id, did, publicPostId: publicPost.id, gatedPostId: gatedPost.id };
}

async function cleanup(did: string): Promise<void> {
  await prisma.post.deleteMany({ where: { creator: { did } } });
  await prisma.subscriptionTier.deleteMany({ where: { creator: { did } } });
  await prisma.creator.deleteMany({ where: { did } });
  await prisma.user.deleteMany({ where: { did } });
}

function deps(pds: FakePds, overrides: Partial<MigrationDeps> = {}): MigrationDeps {
  return {
    prisma,
    publishAtRecord: pds.publish,
    readAtRecord: pds.read,
    hasOAuthSession: async () => true,
    sourceApp: "foryour.fans",
    appEndpoint: "https://foryour.fans",
    ...overrides,
  };
}

afterAll(async () => {
  await prisma.$disconnect();
});

describe("migrateCreatorContentToPds", () => {
  it("does nothing and reports migration_required when the creator has no OAuth session", async () => {
    const c = await makeCreatorWithContent();
    const pds = new FakePds();

    const result = await migrateCreatorContentToPds(deps(pds, { hasOAuthSession: async () => false }), c.did);

    expect(result.status).toBe("migration_required");
    expect(pds.publishCalls).toHaveLength(0);
    const post = await prisma.post.findUniqueOrThrow({ where: { id: c.publicPostId } });
    expect(post.isAuthoritative).toBe(true);
    expect(post.sourceUri).toBeNull();

    await cleanup(c.did);
  });

  it("publishes profile/serviceConfig/tiers/public-posts and de-authoritizes their local rows", async () => {
    const c = await makeCreatorWithContent();
    const pds = new FakePds();

    const result = await migrateCreatorContentToPds(deps(pds), c.did);

    expect(result.status).toBe("migrated");
    expect(result.profilePublished).toBe(true);
    expect(result.serviceConfigPublished).toBe(true);
    expect(result.tiersMigrated).toBe(1);
    expect(result.postsMigrated).toBe(1);
    expect(result.gatedDeferred).toBe(1);

    const published = pds.all(c.did).map((r) => r.value.$type);
    expect(published).toEqual(expect.arrayContaining([NSID.profile, NSID.serviceConfig, NSID.tier, NSID.post, "app.bsky.feed.post"]));

    const publicPost = await prisma.post.findUniqueOrThrow({ where: { id: c.publicPostId } });
    expect(publicPost.isAuthoritative).toBe(false);
    expect(publicPost.sourceUri).toMatch(new RegExp(`^at://${c.did}/${NSID.post}/`));
    expect(publicPost.bskyUri).toContain("app.bsky.feed.post");

    // Gated post untouched — the documented protocol gap.
    const gatedPost = await prisma.post.findUniqueOrThrow({ where: { id: c.gatedPostId } });
    expect(gatedPost.isAuthoritative).toBe(true);
    expect(gatedPost.text).toBe("an old paid post");

    await cleanup(c.did);
  });

  it("leaves a row authoritative when the post-write round-trip read fails (status: partial)", async () => {
    const c = await makeCreatorWithContent();
    const pds = new FakePds();

    const result = await migrateCreatorContentToPds(deps(pds, { readAtRecord: async () => null }), c.did);

    expect(result.status).toBe("partial");
    expect(result.verifyFailures.length).toBeGreaterThan(0);
    const publicPost = await prisma.post.findUniqueOrThrow({ where: { id: c.publicPostId } });
    expect(publicPost.isAuthoritative).toBe(true);
    expect(publicPost.sourceUri).toBeNull();

    await cleanup(c.did);
  });

  it("is idempotent — a second run migrates nothing new", async () => {
    const c = await makeCreatorWithContent();
    const pds = new FakePds();
    await migrateCreatorContentToPds(deps(pds), c.did);
    const second = await migrateCreatorContentToPds(deps(pds), c.did);

    expect(second.postsMigrated).toBe(0);
    expect(second.tiersMigrated).toBe(0);
    expect(second.profilePublished).toBe(false);

    await cleanup(c.did);
  });
});
