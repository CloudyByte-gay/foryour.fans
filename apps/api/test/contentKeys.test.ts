import {
  CreatorOwnedContentRepository,
  FakePds,
  type ContentCrypto,
} from "@foryour-fans/content";
import { NSID } from "@foryour-fans/lexicons";
import {
  decryptText,
  encryptText,
  generateContentKey,
  unwrapContentKey,
  wrapContentKey,
} from "@foryour-fans/media";
import { KeyGrantService } from "@foryour-fans/subscriptions";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupUser,
  createPostFor,
  createTierFor,
  loginAndBecomeCreator,
  loginNewUser,
  prisma,
  redis,
  subscribeAndActivate,
  uniqueHandle,
  type TestSession,
} from "./helpers.js";

const WRAP_SECRET = "content-keys-route-test-wrap-secret";
const crypto: ContentCrypto = {
  generateContentKey,
  encryptText,
  wrapKey: (key) => wrapContentKey(key, WRAP_SECRET),
};

let pds: FakePds;
let creator: TestSession;
let subscriber: TestSession;
let stranger: TestSession;
let tierId: string;

function creatorOwnedRepo(): CreatorOwnedContentRepository {
  return new CreatorOwnedContentRepository(prisma, {
    publishAtRecord: pds.publish,
    deleteAtRecord: pds.delete,
    readAtRecord: pds.read,
    listAtRecords: pds.list,
    crypto,
    config: { sourceApp: "foryour.fans", gatedContentEnabled: true },
  });
}

function keyGrantService(): KeyGrantService {
  return new KeyGrantService(prisma, (wrapped) => unwrapContentKey(wrapped, WRAP_SECRET));
}

beforeEach(async () => {
  pds = new FakePds();
  creator = await loginAndBecomeCreator(uniqueHandle("cok-creator"), {
    contentRepository: creatorOwnedRepo(),
    keyGrantService: keyGrantService(),
  });
  subscriber = await loginNewUser(uniqueHandle("cok-sub"), {
    contentRepository: creatorOwnedRepo(),
    keyGrantService: keyGrantService(),
  });
  stranger = await loginNewUser(uniqueHandle("cok-str"), {
    contentRepository: creatorOwnedRepo(),
    keyGrantService: keyGrantService(),
  });
  tierId = await createTierFor(creator, { name: "Members", priceCents: 700 });
});

afterEach(async () => {
  await cleanupUser(creator.did);
  await cleanupUser(subscriber.did);
  await cleanupUser(stranger.did);
});

afterAll(async () => {
  await prisma.$disconnect();
  redis.disconnect();
});

async function gatedPost(text: string): Promise<{ id: string; subjectUri: string }> {
  const id = await createPostFor(creator, { visibility: "SUBSCRIBERS", text });
  const row = await prisma.post.findUniqueOrThrow({ where: { id } });
  return { id, subjectUri: row.sourceUri! };
}

describe("POST /content-keys/grant", () => {
  it("gives an ACTIVE subscriber a key that decrypts the post's PDS ciphertext", async () => {
    const { subjectUri } = await gatedPost("the real subscriber-only words");
    await subscribeAndActivate(subscriber, creator, tierId);

    const res = await subscriber.app.inject({
      method: "POST",
      url: "/content-keys/grant",
      cookies: { ff_session: subscriber.sessionId },
      headers: { "x-csrf-token": subscriber.csrfToken },
      payload: { subjectUri },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { contentKey: string; algorithm: string };
    expect(body.algorithm).toBe("AES-256-GCM");

    const rkey = subjectUri.split("/").pop()!;
    const record = pds.get(creator.did, NSID.post, rkey) as {
      encryptedBody: { ciphertext: string; iv: string; algorithm: "AES-256-GCM" };
    };
    const key = Buffer.from(body.contentKey, "base64");
    expect(decryptText(record.encryptedBody, key)).toBe("the real subscriber-only words");
  });

  it("denies a viewer with no subscription (403 + reason)", async () => {
    const { subjectUri } = await gatedPost("secret");

    const res = await stranger.app.inject({
      method: "POST",
      url: "/content-keys/grant",
      cookies: { ff_session: stranger.sessionId },
      headers: { "x-csrf-token": stranger.csrfToken },
      payload: { subjectUri },
    });

    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: { reason: string } }).error.reason).toBe("no-subscription");
  });

  it("denies after the subscription is canceled, and a cancel revokes outstanding grants", async () => {
    const { subjectUri } = await gatedPost("secret");
    await subscribeAndActivate(subscriber, creator, tierId);

    const first = await subscriber.app.inject({
      method: "POST",
      url: "/content-keys/grant",
      cookies: { ff_session: subscriber.sessionId },
      headers: { "x-csrf-token": subscriber.csrfToken },
      payload: { subjectUri },
    });
    expect(first.statusCode).toBe(200);

    const sub = await prisma.subscription.findFirstOrThrow({ where: { subscriberUser: { did: subscriber.did } } });
    await prisma.subscription.update({ where: { id: sub.id }, data: { status: "CANCELED" } });
    await keyGrantService().revokeGrantsForSubscription(sub.id);

    const second = await subscriber.app.inject({
      method: "POST",
      url: "/content-keys/grant",
      cookies: { ff_session: subscriber.sessionId },
      headers: { "x-csrf-token": subscriber.csrfToken },
      payload: { subjectUri },
    });
    expect(second.statusCode).toBe(403);
    expect((second.json() as { error: { reason: string } }).error.reason).toBe("subscription-canceled");
    expect(await keyGrantService().hasUsableGrant(subscriber.did, subjectUri)).toBe(false);
  });

  it("requires a session", async () => {
    const { subjectUri } = await gatedPost("secret");
    const res = await subscriber.app.inject({
      method: "POST",
      url: "/content-keys/grant",
      payload: { subjectUri },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 501 when gated creator-owned content is not enabled on the deployment", async () => {
    const plain = await loginNewUser(uniqueHandle("cok-plain"));
    const res = await plain.app.inject({
      method: "POST",
      url: "/content-keys/grant",
      cookies: { ff_session: plain.sessionId },
      headers: { "x-csrf-token": plain.csrfToken },
      payload: { subjectUri: "at://did:plc:x/fans.foryour.post/y" },
    });
    expect(res.statusCode).toBe(501);
    await cleanupUser(plain.did);
  });

  it("never publishes a gated post as a normal public Bluesky post", async () => {
    await gatedPost("private");
    expect(pds.publishCalls.map((c) => c.collection)).not.toContain("app.bsky.feed.post");
    expect(pds.all(creator.did).map((r) => r.value.$type).sort()).toEqual(
      [NSID.accessPolicy, NSID.post].sort(),
    );
  });
});

describe("GET /creators/me/portability", () => {
  it("reports PDS ownership, record collections, and that no export/import is needed to move", async () => {
    await createPostFor(creator, { visibility: "PUBLIC", text: "public one" });
    await gatedPost("gated one");

    const res = await creator.app.inject({
      method: "GET",
      url: "/creators/me/portability",
      cookies: { ff_session: creator.sessionId },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      did: string;
      recordCollections: string[];
      exportImportNeededToMove: boolean;
      counts: { pdsOwnedPosts: number; appAuthoritativePosts: number };
    };
    expect(body.did).toBe(creator.did);
    expect(body.recordCollections).toContain(NSID.post);
    expect(body.recordCollections).toContain(NSID.accessPolicy);
    expect(body.exportImportNeededToMove).toBe(false);
    expect(body.counts.pdsOwnedPosts).toBe(2);
    expect(body.counts.appAuthoritativePosts).toBe(0);
  });
});
