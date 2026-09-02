import type { Post, PrismaClient } from "@foryour-fans/database";
import { NSID } from "@foryour-fans/lexicons";
import {
  AtRecordDeleteError,
  AtRecordPublishError,
  nextTid,
  type DeleteAtRecord,
  type ListAtRecords,
  type PublishAtRecord,
  type ReadAtRecord,
} from "@foryour-fans/atproto";
import type {
  ContentCrypto,
  ContentRepository,
  CreatePostInput,
  GetCreatorFeedOptions,
  GetFeedOptions,
  PortabilityStatus,
  PostRecord,
  UpdatePostInput,
} from "./types.js";
import { PostNotFoundError } from "./repository.js";
import { PostValidationError, validatePostFields } from "./validation.js";

const BSKY_FEED_POST = "app.bsky.feed.post";

/** All collections this app writes into a creator's repo. */
export const CREATOR_OWNED_COLLECTIONS = [
  NSID.profile,
  NSID.tier,
  NSID.post,
  NSID.media,
  NSID.accessPolicy,
  NSID.serviceConfig,
] as const;

export interface CreatorOwnedContentRepositoryConfig {
  /** Identifier written to `fans.foryour.post.sourceApp`. */
  sourceApp: string;
  /**
   * When false, SUBSCRIBERS/TIER posts are NOT written to the creator's PDS
   * — they fall back to a Postgres-only row (same as PrivateContentRepository)
   * and are flagged app-authoritative. This is the spec's "Stop and Defer"
   * behaviour: the encrypted-creator-owned path is proven by tests but not
   * on by default, because encrypted-blob-on-PDS is not production-safe yet
   * (see docs/creator-owned-pds.md §4, §7).
   */
  gatedContentEnabled: boolean;
}

export interface CreatorOwnedContentRepositoryDeps {
  publishAtRecord: PublishAtRecord;
  deleteAtRecord: DeleteAtRecord;
  readAtRecord: ReadAtRecord;
  listAtRecords: ListAtRecords;
  /** Required iff `config.gatedContentEnabled`. */
  crypto: ContentCrypto | null;
  config: CreatorOwnedContentRepositoryConfig;
}

function atUri(did: string, collection: string, rkey: string): string {
  return `at://${did}/${collection}/${rkey}`;
}

function toPostRecord(post: Post): PostRecord {
  return {
    id: post.id,
    creatorId: post.creatorId,
    visibility: post.visibility,
    minimumTierId: post.minimumTierId,
    text: post.text,
    media: [],
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
  };
}

function isGated(visibility: PostRecord["visibility"]): boolean {
  return visibility === "SUBSCRIBERS" || visibility === "TIER";
}

function lexVisibility(visibility: PostRecord["visibility"]): "public" | "subscribers" | "tier" {
  switch (visibility) {
    case "PUBLIC":
      return "public";
    case "SUBSCRIBERS":
      return "subscribers";
    case "TIER":
      return "tier";
  }
}

/**
 * The creator-owned-PDS content repository (see prompts/creator-owned-pds.md,
 * docs/creator-owned-pds.md). foryour.fans is NOT the system of record here:
 *
 * - **Public posts** are dual-published to the creator's own PDS as
 *   `app.bsky.feed.post` + `fans.foryour.post` (linked by AT URI/CID), then
 *   cached in Postgres with `isAuthoritative = false`. A compatible service
 *   can reconstruct them from the PDS alone.
 * - **Gated posts** (SUBSCRIBERS/TIER): when `gatedContentEnabled`, the body
 *   is AES-256-GCM-encrypted before it is written to the creator's PDS as a
 *   `fans.foryour.post` with an `encryptedBody` + an `accessPolicy` record;
 *   the per-post content key is envelope-wrapped and stored in `ContentKey`,
 *   handed out only by the entitlement-checked key-grant flow
 *   (`packages/subscriptions`). When the flag is off, gated posts stay
 *   Postgres-only and app-authoritative — the documented protocol gap.
 *
 * Postgres rows are a rebuildable cache/index; `rebuildFromPds` proves it.
 */
export class CreatorOwnedContentRepository implements ContentRepository {
  private readonly publishAtRecord: PublishAtRecord;
  private readonly deleteAtRecord: DeleteAtRecord;
  private readonly readAtRecord: ReadAtRecord;
  private readonly listAtRecords: ListAtRecords;
  private readonly crypto: ContentCrypto | null;
  private readonly config: CreatorOwnedContentRepositoryConfig;

  constructor(
    private readonly prisma: PrismaClient,
    deps: CreatorOwnedContentRepositoryDeps,
  ) {
    this.publishAtRecord = deps.publishAtRecord;
    this.deleteAtRecord = deps.deleteAtRecord;
    this.readAtRecord = deps.readAtRecord;
    this.listAtRecords = deps.listAtRecords;
    this.crypto = deps.crypto;
    this.config = deps.config;
    if (this.config.gatedContentEnabled && !this.crypto) {
      throw new Error("CreatorOwnedContentRepository: gatedContentEnabled requires a ContentCrypto implementation");
    }
  }

  async createPost(input: CreatePostInput): Promise<PostRecord> {
    validatePostFields(input);
    const creator = await this.prisma.creator.findUniqueOrThrow({ where: { id: input.creatorId } });
    const now = new Date();

    if (input.visibility === "PUBLIC") {
      const published = await this.publishPublicPost(creator.did, input.text, now, now);
      const post = await this.prisma.post.create({
        data: {
          creatorId: input.creatorId,
          visibility: "PUBLIC",
          minimumTierId: null,
          text: input.text,
          atRkey: published.postRkey,
          sourceUri: published.postUri,
          sourceCid: published.postCid,
          bskyUri: published.bskyUri,
          bskyCid: published.bskyCid,
          isAuthoritative: false,
          indexedAt: now,
          createdAt: now,
        },
      });
      return toPostRecord(post);
    }

    // Gated (SUBSCRIBERS / TIER).
    if (!this.config.gatedContentEnabled || !this.crypto) {
      // Stop-and-defer: Postgres-only, app-authoritative. Identical shape to
      // PrivateContentRepository so switching the flag later is seamless.
      const post = await this.prisma.post.create({
        data: {
          creatorId: input.creatorId,
          visibility: input.visibility,
          minimumTierId: input.minimumTierId,
          text: input.text,
          atRkey: null,
          isAuthoritative: true,
          createdAt: now,
        },
      });
      return toPostRecord(post);
    }

    const gated = await this.publishGatedPost(creator.did, input, now);
    const post = await this.prisma.post.create({
      data: {
        creatorId: input.creatorId,
        visibility: input.visibility,
        minimumTierId: input.minimumTierId,
        // Cleartext is NOT retained locally for a PDS-owned gated post — the
        // ciphertext on the creator's PDS is the only copy; the cache row
        // carries pointers + a locked stub.
        text: "",
        atRkey: null,
        sourceUri: gated.postUri,
        sourceCid: gated.postCid,
        accessPolicyUri: gated.policyUri,
        isAuthoritative: false,
        indexedAt: now,
        createdAt: now,
      },
    });
    await this.prisma.contentKey.create({
      data: {
        creatorId: input.creatorId,
        postId: post.id,
        subjectUri: gated.postUri,
        subjectType: "post",
        algorithm: gated.algorithm,
        wrappedKey: gated.wrappedKey,
        audience: input.visibility === "TIER" ? "TIER" : "SUBSCRIBERS",
        requiredTierId: input.minimumTierId ?? null,
        accessPolicyUri: gated.policyUri,
      },
    });
    return toPostRecord(post);
  }

  private async publishPublicPost(
    did: string,
    text: string,
    createdAt: Date,
    updatedAt: Date,
    reusePostRkey?: string,
  ): Promise<{ postRkey: string; postUri: string; postCid: string; bskyUri: string; bskyCid: string }> {
    const bskyRkey = nextTid();
    let bsky: { uri: string; cid: string };
    try {
      bsky = await this.publishAtRecord(did, {
        collection: BSKY_FEED_POST,
        rkey: bskyRkey,
        record: { $type: BSKY_FEED_POST, text, createdAt: createdAt.toISOString() },
      });
    } catch (error) {
      throw new AtRecordPublishError("Failed to publish app.bsky.feed.post to the creator's PDS.", error);
    }

    const postRkey = reusePostRkey ?? nextTid();
    const postUri = atUri(did, NSID.post, postRkey);
    try {
      const result = await this.publishAtRecord(did, {
        collection: NSID.post,
        rkey: postRkey,
        record: {
          $type: NSID.post,
          text,
          visibility: "public",
          createdAt: createdAt.toISOString(),
          updatedAt: updatedAt.toISOString(),
          sourceApp: this.config.sourceApp,
          bskyUri: bsky.uri,
          bskyCid: bsky.cid,
          canonicalUri: postUri,
        },
      });
      return { postRkey, postUri, postCid: result.cid, bskyUri: bsky.uri, bskyCid: bsky.cid };
    } catch (error) {
      // Roll back the Bluesky record so we never leave a half-published pair.
      await this.deleteAtRecord(did, { collection: BSKY_FEED_POST, rkey: bskyRkey }).catch(() => undefined);
      throw new AtRecordPublishError("Failed to publish fans.foryour.post; rolled back the paired Bluesky post.", error);
    }
  }

  private async publishGatedPost(
    did: string,
    input: CreatePostInput,
    createdAt: Date,
  ): Promise<{ postUri: string; postCid: string; policyUri: string; algorithm: string; wrappedKey: string }> {
    const crypto = this.crypto!;
    const policyRkey = nextTid();
    const policyUri = atUri(did, NSID.accessPolicy, policyRkey);

    let minimumTierRef: { uri: string; rkey: string } | undefined;
    if (input.visibility === "TIER" && input.minimumTierId) {
      const tier = await this.prisma.subscriptionTier.findUniqueOrThrow({ where: { id: input.minimumTierId } });
      minimumTierRef = {
        uri: tier.sourceUri ?? atUri(did, NSID.tier, tier.atRkey),
        rkey: tier.atRkey,
      };
    }

    try {
      await this.publishAtRecord(did, {
        collection: NSID.accessPolicy,
        rkey: policyRkey,
        record: {
          $type: NSID.accessPolicy,
          audience: lexVisibility(input.visibility),
          ...(minimumTierRef ? { minimumTier: minimumTierRef } : {}),
          keyGrant: { protocol: "foryour.fans/keygrant-v1", algorithm: "AES-256-GCM" },
          createdAt: createdAt.toISOString(),
        },
      });
    } catch (error) {
      throw new AtRecordPublishError("Failed to publish fans.foryour.accessPolicy to the creator's PDS.", error);
    }

    const postRkey = nextTid();
    const postUri = atUri(did, NSID.post, postRkey);
    const contentKey = crypto.generateContentKey();
    const enc = crypto.encryptText(input.text, contentKey);

    try {
      const result = await this.publishAtRecord(did, {
        collection: NSID.post,
        rkey: postRkey,
        record: {
          $type: NSID.post,
          text: "",
          visibility: lexVisibility(input.visibility),
          createdAt: createdAt.toISOString(),
          sourceApp: this.config.sourceApp,
          accessPolicy: { uri: policyUri },
          encryptedBody: {
            algorithm: enc.algorithm,
            keyRef: postUri,
            iv: enc.iv,
            ciphertext: enc.ciphertext,
          },
        },
      });
      return {
        postUri,
        postCid: result.cid,
        policyUri,
        algorithm: enc.algorithm,
        wrappedKey: crypto.wrapKey(contentKey),
      };
    } catch (error) {
      await this.deleteAtRecord(did, { collection: NSID.accessPolicy, rkey: policyRkey }).catch(() => undefined);
      throw new AtRecordPublishError("Failed to publish the gated fans.foryour.post; rolled back its access policy.", error);
    }
  }

  private async getOwnedRow(postId: string, creatorId: string): Promise<Post> {
    const post = await this.prisma.post.findUnique({ where: { id: postId } });
    if (!post || post.creatorId !== creatorId || post.deletedAt) {
      throw new PostNotFoundError("Post not found.");
    }
    return post;
  }

  async updatePost(postId: string, creatorId: string, patch: UpdatePostInput): Promise<PostRecord> {
    const existing = await this.getOwnedRow(postId, creatorId);

    // A PDS-owned gated post keeps no local plaintext, so it cannot be
    // re-encrypted from the server without the new body being supplied.
    const bodyHeldRemotely = !existing.isAuthoritative && isGated(existing.visibility);
    if (bodyHeldRemotely && patch.text === undefined) {
      throw new PostValidationError(
        "Editing a gated creator-owned post requires the new text — its body is encrypted on the creator's PDS.",
      );
    }

    const newText = patch.text ?? existing.text;
    const merged = {
      visibility: patch.visibility ?? existing.visibility,
      minimumTierId: patch.minimumTierId === undefined ? existing.minimumTierId : patch.minimumTierId,
      text: newText,
    };
    validatePostFields(merged);

    const creator = await this.prisma.creator.findUniqueOrThrow({ where: { id: creatorId } });

    // Simplest correct model for the PoC: retract whatever PDS records this
    // post currently has, then (re)publish for the target visibility. Cache
    // rows are rewritten to match. Documented in docs/creator-owned-pds.md.
    await this.retractPdsRecords(creator.did, existing);
    await this.prisma.contentKey.deleteMany({ where: { postId } });

    const now = new Date();
    if (merged.visibility === "PUBLIC") {
      const published = await this.publishPublicPost(creator.did, newText, existing.createdAt, now);
      const updated = await this.prisma.post.update({
        where: { id: postId },
        data: {
          visibility: "PUBLIC",
          minimumTierId: null,
          text: newText,
          atRkey: published.postRkey,
          sourceUri: published.postUri,
          sourceCid: published.postCid,
          bskyUri: published.bskyUri,
          bskyCid: published.bskyCid,
          accessPolicyUri: null,
          isAuthoritative: false,
          indexedAt: now,
        },
      });
      return toPostRecord(updated);
    }

    if (!this.config.gatedContentEnabled || !this.crypto) {
      const updated = await this.prisma.post.update({
        where: { id: postId },
        data: {
          visibility: merged.visibility,
          minimumTierId: merged.minimumTierId,
          text: newText,
          atRkey: null,
          sourceUri: null,
          sourceCid: null,
          bskyUri: null,
          bskyCid: null,
          accessPolicyUri: null,
          isAuthoritative: true,
          indexedAt: null,
        },
      });
      return toPostRecord(updated);
    }

    const gated = await this.publishGatedPost(
      creator.did,
      { creatorId, visibility: merged.visibility, minimumTierId: merged.minimumTierId ?? undefined, text: newText },
      now,
    );
    const updated = await this.prisma.post.update({
      where: { id: postId },
      data: {
        visibility: merged.visibility,
        minimumTierId: merged.minimumTierId,
        text: "",
        atRkey: null,
        sourceUri: gated.postUri,
        sourceCid: gated.postCid,
        bskyUri: null,
        bskyCid: null,
        accessPolicyUri: gated.policyUri,
        isAuthoritative: false,
        indexedAt: now,
      },
    });
    await this.prisma.contentKey.create({
      data: {
        creatorId,
        postId,
        subjectUri: gated.postUri,
        subjectType: "post",
        algorithm: gated.algorithm,
        wrappedKey: gated.wrappedKey,
        audience: merged.visibility === "TIER" ? "TIER" : "SUBSCRIBERS",
        requiredTierId: merged.minimumTierId ?? null,
        accessPolicyUri: gated.policyUri,
      },
    });
    return toPostRecord(updated);
  }

  private async retractPdsRecords(did: string, post: Post): Promise<void> {
    const deletes: Array<{ collection: string; rkey: string }> = [];
    if (post.sourceUri || post.atRkey) {
      const rkey = post.sourceUri ? rkeyOf(post.sourceUri) : post.atRkey!;
      deletes.push({ collection: NSID.post, rkey });
    }
    if (post.bskyUri) {
      deletes.push({ collection: BSKY_FEED_POST, rkey: rkeyOf(post.bskyUri) });
    }
    if (post.accessPolicyUri) {
      deletes.push({ collection: NSID.accessPolicy, rkey: rkeyOf(post.accessPolicyUri) });
    }
    for (const params of deletes) {
      try {
        await this.deleteAtRecord(did, params);
      } catch (error) {
        throw new AtRecordDeleteError(`Failed to retract ${params.collection} from the creator's PDS.`, error);
      }
    }
  }

  async deletePost(postId: string, creatorId: string): Promise<void> {
    const existing = await this.getOwnedRow(postId, creatorId);
    const creator = await this.prisma.creator.findUniqueOrThrow({ where: { id: creatorId } });
    await this.retractPdsRecords(creator.did, existing);
    await this.prisma.contentKey.deleteMany({ where: { postId } });
    await this.prisma.post.update({ where: { id: postId }, data: { deletedAt: new Date() } });
  }

  async getPost(postId: string): Promise<PostRecord | null> {
    const post = await this.prisma.post.findUnique({ where: { id: postId } });
    if (!post || post.deletedAt) {
      return null;
    }
    return toPostRecord(post);
  }

  async getCreatorFeed(creatorId: string, options: GetCreatorFeedOptions = {}): Promise<PostRecord[]> {
    const posts = await this.prisma.post.findMany({
      where: { creatorId, deletedAt: null },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: options.limit,
      ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    });
    return posts.map(toPostRecord);
  }

  async getFeed(options: GetFeedOptions = {}): Promise<PostRecord[]> {
    const posts = await this.prisma.post.findMany({
      where: {
        deletedAt: null,
        creator: { status: "ACTIVE" },
        OR: [
          { visibility: "PUBLIC" },
          ...(options.unlockedCreatorIds && options.unlockedCreatorIds.length > 0
            ? [
                {
                  creatorId: { in: options.unlockedCreatorIds },
                  visibility: { in: ["SUBSCRIBERS", "TIER"] as ("SUBSCRIBERS" | "TIER")[] },
                },
              ]
            : []),
        ],
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: options.limit,
    });
    return posts.map(toPostRecord);
  }

  /**
   * Rebuilds this creator's local cache rows from their PDS records alone —
   * the operation a competing fan-service app performs on first sight of a
   * creator, and the proof that Postgres holds nothing authoritative for
   * public content. Returns a per-collection count of records seen.
   *
   * Gated posts are re-indexed as locked stubs (no plaintext, no keys) —
   * their bodies stay encrypted on the PDS and only the key-grant flow can
   * unlock them.
   */
  async rebuildFromPds(did: string): Promise<Record<string, number>> {
    const creator = await this.prisma.creator.findUnique({ where: { did } });
    if (!creator) {
      throw new PostNotFoundError(`No local creator row for ${did}`);
    }
    const counts: Record<string, number> = {};

    for (const collection of CREATOR_OWNED_COLLECTIONS) {
      const seen = await this.listAll(did, collection);
      counts[collection] = seen.length;
    }

    // Profile
    const profile = await this.readAtRecord(did, { collection: NSID.profile, rkey: "self", repo: did });
    if (profile) {
      const v = profile.value as { displayName?: string; bio?: string; website?: string };
      await this.prisma.creator.update({
        where: { did },
        data: {
          displayName: v.displayName ?? null,
          bio: v.bio ?? null,
          website: v.website ?? null,
          profileSourceUri: profile.uri,
          profileSourceCid: profile.cid ?? null,
          pdsSyncedAt: new Date(),
        },
      });
    }

    // Service config
    const serviceConfig = await this.readAtRecord(did, { collection: NSID.serviceConfig, rkey: "self", repo: did });
    if (serviceConfig) {
      await this.prisma.creator.update({ where: { did }, data: { serviceConfigUri: serviceConfig.uri } });
    }

    // Tiers
    for (const rec of await this.listAll(did, NSID.tier)) {
      const v = rec.value as {
        name?: string;
        description?: string;
        monthlyPrice?: number;
        currency?: string;
        sortOrder?: number;
      };
      await this.prisma.subscriptionTier.upsert({
        where: { sourceUri: rec.uri },
        create: {
          creatorId: creator.id,
          name: v.name ?? "Tier",
          description: v.description ?? null,
          priceCents: v.monthlyPrice ?? 0,
          currency: v.currency ?? "usd",
          sortOrder: v.sortOrder ?? 0,
          atRkey: rkeyOf(rec.uri),
          sourceUri: rec.uri,
          sourceCid: rec.cid,
          isAuthoritative: false,
        },
        update: {
          name: v.name ?? "Tier",
          description: v.description ?? null,
          priceCents: v.monthlyPrice ?? 0,
          currency: v.currency ?? "usd",
          sortOrder: v.sortOrder ?? 0,
          sourceCid: rec.cid,
          isAuthoritative: false,
        },
      });
    }

    // Posts
    for (const rec of await this.listAll(did, NSID.post)) {
      const v = rec.value as {
        text?: string;
        visibility?: string;
        createdAt?: string;
        bskyUri?: string;
        bskyCid?: string;
        accessPolicy?: { uri?: string };
        encryptedBody?: unknown;
      };
      const gatedRecord = Boolean(v.encryptedBody) || v.visibility === "subscribers" || v.visibility === "tier";
      const visibility = v.visibility === "subscribers" ? "SUBSCRIBERS" : v.visibility === "tier" ? "TIER" : "PUBLIC";
      await this.prisma.post.upsert({
        where: { sourceUri: rec.uri },
        create: {
          creatorId: creator.id,
          visibility,
          text: gatedRecord ? "" : (v.text ?? ""),
          atRkey: visibility === "PUBLIC" ? rkeyOf(rec.uri) : null,
          sourceUri: rec.uri,
          sourceCid: rec.cid,
          bskyUri: v.bskyUri ?? null,
          bskyCid: v.bskyCid ?? null,
          accessPolicyUri: v.accessPolicy?.uri ?? null,
          isAuthoritative: false,
          indexedAt: new Date(),
          createdAt: v.createdAt ? new Date(v.createdAt) : new Date(),
        },
        update: {
          visibility,
          text: gatedRecord ? "" : (v.text ?? ""),
          sourceCid: rec.cid,
          bskyUri: v.bskyUri ?? null,
          bskyCid: v.bskyCid ?? null,
          accessPolicyUri: v.accessPolicy?.uri ?? null,
          isAuthoritative: false,
          indexedAt: new Date(),
        },
      });
    }

    return counts;
  }

  private async listAll(
    did: string,
    collection: string,
  ): Promise<Array<{ uri: string; cid: string; value: Record<string, unknown> }>> {
    const out: Array<{ uri: string; cid: string; value: Record<string, unknown> }> = [];
    let cursor: string | undefined;
    do {
      const page = await this.listAtRecords(did, { collection, repo: did, limit: 100, cursor });
      out.push(...page.records);
      cursor = page.cursor;
    } while (cursor);
    return out;
  }

  async portabilityStatus(did: string): Promise<PortabilityStatus> {
    const creator = await this.prisma.creator.findUniqueOrThrow({
      where: { did },
      include: { user: true, posts: { where: { deletedAt: null } }, tiers: true },
    });
    const appAuthoritativePosts = creator.posts.filter((p) => p.isAuthoritative).length;
    const appAuthoritativeTiers = creator.tiers.filter((t) => t.isAuthoritative && t.isActive).length;
    return {
      did,
      handle: creator.user.handle,
      pdsUrl: creator.pdsUrl,
      collections: [...CREATOR_OWNED_COLLECTIONS],
      profileSourceUri: creator.profileSourceUri,
      serviceConfigUri: creator.serviceConfigUri,
      lastSyncedAt: creator.pdsSyncedAt,
      fullyPortable: appAuthoritativePosts === 0 && appAuthoritativeTiers === 0,
    };
  }
}

function rkeyOf(uri: string): string {
  const parts = uri.split("/");
  return parts[parts.length - 1] ?? uri;
}
