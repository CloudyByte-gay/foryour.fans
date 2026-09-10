import type { PrismaClient } from "@foryour-fans/database";
import { BSKY_NSID, NSID } from "@foryour-fans/lexicons";
import {
  AtRecordDeleteError,
  AtRecordPublishError,
  buildBskyLikeRecord,
  buildForyourLikeRecord,
  nextTid,
  parseAtUri,
  type DeleteAtRecord,
  type PublishAtRecord,
  type ReadAtRecord,
  type StrongRef,
} from "@foryour-fans/atproto";
import { getLikeState, getLikeSummary, type LikeState, type LikeSummary } from "./likes.js";
import type { PostRecord } from "./types.js";

export type { LikeState, LikeSummary };

/** One entry in a "liked by" list — a bsky `app.bsky.feed.getLikes`-shaped actor. */
export interface LikeActor {
  did: string;
  handle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  /** When the like was created (local row `createdAt`, or the AT record's `createdAt`). */
  createdAt: Date;
}

export interface LikedByPage {
  likes: LikeActor[];
  /** Opaque cursor for the next page, or null when the list is exhausted. */
  nextCursor: string | null;
}

export interface LikeServiceDeps {
  publishAtRecord: PublishAtRecord;
  deleteAtRecord: DeleteAtRecord;
  readAtRecord: ReadAtRecord;
  /**
   * `env.CREATOR_OWNED_PDS_ENABLED`. When false, every method here is exactly
   * the Phase 12 Postgres-only behavior (it delegates to `./likes.ts`), and no
   * AT record is ever written, deleted, or read.
   */
  atEnabled: boolean;
}

export interface LikeActorRef {
  userId: string;
  did: string;
}

const CURSOR_SEP = "|";

function encodeCursor(createdAt: Date, key: string): string {
  return Buffer.from(`${createdAt.toISOString()}${CURSOR_SEP}${key}`, "utf8").toString("base64url");
}

function decodeCursor(cursor: string): { iso: string; key: string } | null {
  let decoded: string;
  try {
    decoded = Buffer.from(cursor, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const i = decoded.indexOf(CURSOR_SEP);
  if (i < 0) return null;
  return { iso: decoded.slice(0, i), key: decoded.slice(i + 1) };
}

function isRecordNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { status?: number; error?: string; message?: string };
  if (e.status === 404) return true;
  if (typeof e.error === "string" && /RecordNotFound/i.test(e.error)) return true;
  if (typeof e.message === "string" && /(could not locate record|record not found)/i.test(e.message)) return true;
  return false;
}

function uniqueSubjectUris(post: PostRecord): string[] {
  return [...new Set([post.canonicalUri, post.foryourAtUri, post.bskyAtUri].filter((u): u is string => !!u))];
}

/**
 * Bluesky-style "likes" backed by AT Protocol records.
 *
 * A like is a `fans.foryour.like` record in the LIKER's own PDS repo that
 * strong-refs the post; for a like on a PUBLIC post it is paired with an
 * `app.bsky.feed.like` so Bluesky's AppView counts it too. Unlike deletes the
 * record(s). The local `Like` row becomes a rebuildable cache
 * (`isAuthoritative = false`); network-observed likes from other repos are
 * aggregated separately in `IndexedLike` (see packages/discovery). Public like
 * counts and "liked by" lists are the union of the two, deduped by liker DID —
 * the same model the bsky AppView uses over the firehose.
 *
 * Match a like to its subject post by `subject.uri` ONLY — a post edit re-mints
 * its CID under the same rkey, so an older like's `cid` is a stale integrity
 * anchor, never a join key.
 *
 * Constructed once in apps/api/src/server.ts and injected into the routes that
 * need it, the same shape as `KeyGrantService`.
 */
export class LikeService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly deps: LikeServiceDeps,
  ) {}

  /**
   * Idempotent: liking an already-liked post is a no-op that returns current
   * state and never writes a second AT record. On the flag-off path, or for a
   * post with no canonical `fans.foryour.post` record (gated content is still
   * Postgres-only — the documented protocol gap), the like stays a plain
   * Postgres row exactly as in Phase 12.
   */
  async like(post: PostRecord, liker: LikeActorRef): Promise<LikeState> {
    const existing = await this.prisma.like.findUnique({
      where: { postId_userId: { postId: post.id, userId: liker.userId } },
      select: { id: true },
    });
    if (existing) return this.stateFor(post, liker);

    const canDualPublish = this.deps.atEnabled && post.visibility === "PUBLIC" && !!post.foryourAtUri;
    const foryourSubject = canDualPublish ? await this.resolveSubject(post.foryourAtUri!, post.foryourAtCid, liker.did) : null;

    if (!foryourSubject) {
      await this.prisma.like.create({ data: { postId: post.id, userId: liker.userId } });
      return this.stateFor(post, liker);
    }

    const atRkey = nextTid();
    let published: { uri: string; cid: string };
    try {
      published = await this.deps.publishAtRecord(liker.did, {
        collection: NSID.like,
        rkey: atRkey,
        record: buildForyourLikeRecord({ subject: foryourSubject }),
      });
    } catch (error) {
      throw new AtRecordPublishError("Failed to publish fans.foryour.like.", error);
    }

    let bsky: { rkey: string; uri: string; cid: string } | null = null;
    if (post.bskyAtUri) {
      const bskySubject = await this.resolveSubject(post.bskyAtUri, post.bskyAtCid, liker.did).catch(() => null);
      if (bskySubject) {
        const bskyRkey = nextTid();
        try {
          const r = await this.deps.publishAtRecord(liker.did, {
            collection: BSKY_NSID.feedLike,
            rkey: bskyRkey,
            record: buildBskyLikeRecord({ subject: bskySubject }),
          });
          bsky = { rkey: bskyRkey, uri: r.uri, cid: r.cid };
        } catch (error) {
          // Never leave a half-published pair — retract the fans.foryour.like.
          await this.deps.deleteAtRecord(liker.did, { collection: NSID.like, rkey: atRkey }).catch(() => undefined);
          throw new AtRecordPublishError("Failed to publish app.bsky.feed.like; rolled back fans.foryour.like.", error);
        }
      }
    }

    await this.prisma.like.create({
      data: {
        postId: post.id,
        userId: liker.userId,
        atRkey,
        sourceUri: published.uri,
        sourceCid: published.cid,
        bskyRkey: bsky?.rkey ?? null,
        bskyUri: bsky?.uri ?? null,
        bskyCid: bsky?.cid ?? null,
        isAuthoritative: false,
        indexedAt: new Date(),
      },
    });
    return this.stateFor(post, liker);
  }

  /**
   * Safe no-op when the caller never liked the post. When the like was
   * AT-backed, the records are deleted from the liker's repo first; a
   * already-gone record (deleted from another client) is tolerated, any other
   * PDS error surfaces as `AtRecordDeleteError` and the local row is kept.
   */
  async unlike(post: PostRecord, liker: LikeActorRef): Promise<LikeState> {
    const row = await this.prisma.like.findUnique({
      where: { postId_userId: { postId: post.id, userId: liker.userId } },
      select: { id: true, sourceUri: true, atRkey: true, bskyRkey: true },
    });
    if (!row) return this.stateFor(post, liker);

    if (this.deps.atEnabled && row.sourceUri && row.atRkey) {
      await this.tolerantDelete(liker.did, NSID.like, row.atRkey);
      if (row.bskyRkey) await this.tolerantDelete(liker.did, BSKY_NSID.feedLike, row.bskyRkey);
    }

    await this.prisma.like.delete({ where: { id: row.id } });
    return this.stateFor(post, liker);
  }

  /** `{likeCount, likedByViewer, likedByCreator}` for `GET /posts/:id`. */
  async getSummary(
    post: PostRecord,
    viewer: LikeActorRef | null,
    creator: LikeActorRef,
  ): Promise<LikeSummary> {
    if (!this.deps.atEnabled) {
      return getLikeSummary(this.prisma, post.id, viewer?.userId ?? null, creator.userId);
    }
    const dids = await this.likerDidSet(post);
    return {
      likeCount: dids.size,
      likedByViewer: !!viewer && dids.has(viewer.did),
      likedByCreator: dids.has(creator.did),
    };
  }

  /** Batched `{likeCount, likedByViewer}` per post id — for feed / profile cards. */
  async getSummariesForPosts(
    posts: PostRecord[],
    viewer: { userId: string } | null,
  ): Promise<Map<string, LikeState>> {
    const out = new Map<string, LikeState>();
    if (posts.length === 0) return out;
    const postIds = posts.map((p) => p.id);

    if (!this.deps.atEnabled) {
      const [counts, viewerRows] = await Promise.all([
        this.prisma.like.groupBy({ by: ["postId"], where: { postId: { in: postIds } }, _count: { _all: true } }),
        viewer
          ? this.prisma.like.findMany({
              where: { postId: { in: postIds }, userId: viewer.userId },
              select: { postId: true },
            })
          : Promise.resolve([]),
      ]);
      const countByPost = new Map(counts.map((c) => [c.postId, c._count._all]));
      const likedByViewer = new Set(viewerRows.map((r) => r.postId));
      for (const p of posts) {
        out.set(p.id, { likeCount: countByPost.get(p.id) ?? 0, likedByViewer: likedByViewer.has(p.id) });
      }
      return out;
    }

    // Flag on: union local + IndexedLike, deduped by liker DID, per post.
    const subjectToPostId = new Map<string, string>();
    for (const p of posts) for (const u of uniqueSubjectUris(p)) subjectToPostId.set(u, p.id);
    const allSubjectUris = [...subjectToPostId.keys()];

    const [localRows, indexedRows] = await Promise.all([
      this.prisma.like.findMany({
        where: { postId: { in: postIds } },
        select: { postId: true, user: { select: { did: true } } },
      }),
      allSubjectUris.length
        ? this.prisma.indexedLike.findMany({
            where: { subjectUri: { in: allSubjectUris } },
            select: { subjectUri: true, did: true },
          })
        : Promise.resolve([]),
    ]);

    const didsByPost = new Map<string, Set<string>>();
    const forPost = (id: string) => {
      let s = didsByPost.get(id);
      if (!s) didsByPost.set(id, (s = new Set()));
      return s;
    };
    for (const r of localRows) forPost(r.postId).add(r.user.did);
    for (const r of indexedRows) {
      const postId = subjectToPostId.get(r.subjectUri);
      if (postId) forPost(postId).add(r.did);
    }

    // `likedByViewer` is membership of the viewer's DID in the merged set.
    const viewerDid = viewer
      ? (await this.prisma.user.findUnique({ where: { id: viewer.userId }, select: { did: true } }))?.did ?? null
      : null;
    for (const p of posts) {
      const s = didsByPost.get(p.id) ?? new Set<string>();
      out.set(p.id, { likeCount: s.size, likedByViewer: !!viewerDid && s.has(viewerDid) });
    }
    return out;
  }

  /**
   * The "liked by" list — `app.bsky.feed.getLikes`-shaped. Newest first, opaque
   * cursor. Callers gate visibility (a gated post's likers are only listed to
   * viewers entitled to the post).
   */
  async listLikedBy(post: PostRecord, opts: { limit: number; cursor?: string }): Promise<LikedByPage> {
    const actors = new Map<string, LikeActor & { key: string }>();

    const localRows = await this.prisma.like.findMany({
      where: { postId: post.id },
      select: {
        id: true,
        createdAt: true,
        user: { select: { did: true, handle: true, displayName: true, avatarUrl: true } },
      },
    });
    for (const r of localRows) {
      actors.set(r.user.did, {
        did: r.user.did,
        handle: r.user.handle,
        displayName: r.user.displayName,
        avatarUrl: r.user.avatarUrl,
        createdAt: r.createdAt,
        key: `L:${r.id}`,
      });
    }

    if (this.deps.atEnabled) {
      const subjectUris = uniqueSubjectUris(post);
      if (subjectUris.length) {
        const indexed = await this.prisma.indexedLike.findMany({
          where: { subjectUri: { in: subjectUris } },
          select: { uri: true, did: true, atCreatedAt: true, indexedAt: true },
        });
        const needIdentity = [...new Set(indexed.map((r) => r.did))].filter((did) => !actors.has(did));
        const [users, profiles] = await Promise.all([
          needIdentity.length
            ? this.prisma.user.findMany({
                where: { did: { in: needIdentity } },
                select: { did: true, handle: true, displayName: true, avatarUrl: true },
              })
            : Promise.resolve([]),
          needIdentity.length
            ? this.prisma.indexedCreatorProfile.findMany({
                where: { did: { in: needIdentity } },
                select: { did: true, handle: true, displayName: true },
              })
            : Promise.resolve([]),
        ]);
        const userByDid = new Map(users.map((u) => [u.did, u]));
        const profileByDid = new Map(profiles.map((p) => [p.did, p]));
        for (const r of indexed) {
          if (actors.has(r.did)) continue; // a local row always wins (it has an avatar)
          const u = userByDid.get(r.did);
          const p = profileByDid.get(r.did);
          actors.set(r.did, {
            did: r.did,
            handle: u?.handle ?? p?.handle ?? null,
            displayName: u?.displayName ?? p?.displayName ?? null,
            avatarUrl: u?.avatarUrl ?? null,
            createdAt: r.atCreatedAt ?? r.indexedAt,
            key: `I:${r.uri}`,
          });
        }
      }
    }

    const sorted = [...actors.values()].sort((a, b) => {
      const t = b.createdAt.getTime() - a.createdAt.getTime();
      if (t !== 0) return t;
      // Same timestamp: descending by key for a deterministic order.
      return a.key < b.key ? 1 : a.key > b.key ? -1 : 0;
    });

    const start = opts.cursor ? decodeCursor(opts.cursor) : null;
    const afterCursor = start
      ? sorted.filter((x) => {
          const iso = x.createdAt.toISOString();
          if (iso < start.iso) return true;
          if (iso > start.iso) return false;
          return x.key < start.key;
        })
      : sorted;

    const page = afterCursor.slice(0, opts.limit);
    const nextCursor =
      afterCursor.length > opts.limit && page.length > 0
        ? encodeCursor(page[page.length - 1]!.createdAt, page[page.length - 1]!.key)
        : null;

    return {
      likes: page.map(({ key: _key, ...actor }) => actor),
      nextCursor,
    };
  }

  // --- internals ----------------------------------------------------------

  private async stateFor(post: PostRecord, liker: LikeActorRef | null): Promise<LikeState> {
    if (!this.deps.atEnabled) {
      return getLikeState(this.prisma, post.id, liker?.userId ?? null);
    }
    const dids = await this.likerDidSet(post);
    return { likeCount: dids.size, likedByViewer: !!liker && dids.has(liker.did) };
  }

  private async likerDidSet(post: PostRecord): Promise<Set<string>> {
    const subjectUris = uniqueSubjectUris(post);
    const [local, indexed] = await Promise.all([
      this.prisma.like.findMany({ where: { postId: post.id }, select: { user: { select: { did: true } } } }),
      subjectUris.length
        ? this.prisma.indexedLike.findMany({ where: { subjectUri: { in: subjectUris } }, select: { did: true } })
        : Promise.resolve([]),
    ]);
    const s = new Set<string>();
    for (const r of local) s.add(r.user.did);
    for (const r of indexed) s.add(r.did);
    return s;
  }

  /**
   * Build a `com.atproto.repo.strongRef` for the post record. Uses the CID the
   * repository already resolved; only falls back to a live `getRecord` when it
   * is missing (a `PrivateContentRepository`-shaped `PostRecord` has no CID).
   */
  private async resolveSubject(uri: string, cid: string | null, likerDid: string): Promise<StrongRef | null> {
    if (cid) return { uri, cid };
    const parsed = parseAtUri(uri);
    if (!parsed) return null;
    const rec = await this.deps.readAtRecord(likerDid, {
      repo: parsed.did,
      collection: parsed.collection,
      rkey: parsed.rkey,
    });
    if (!rec?.cid) throw new AtRecordPublishError("Could not resolve the subject CID for a like.", null);
    return { uri, cid: rec.cid };
  }

  private async tolerantDelete(did: string, collection: string, rkey: string): Promise<void> {
    try {
      await this.deps.deleteAtRecord(did, { collection, rkey });
    } catch (error) {
      if (isRecordNotFound(error)) return;
      throw new AtRecordDeleteError(`Failed to delete ${collection} record.`, error);
    }
  }
}
