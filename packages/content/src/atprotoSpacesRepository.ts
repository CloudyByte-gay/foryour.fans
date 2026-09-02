import type { ContentRepository, CreatePostInput, GetCreatorFeedOptions, GetFeedOptions, PostRecord, UpdatePostInput } from "./types.js";

/**
 * Experimental placeholder for an AT Protocol "Spaces" (or equivalent
 * future private-repo primitive) backed ContentRepository — see
 * prompts/full.md PHASE 7 ("define, but DO NOT make production-dependent")
 * and PHASE 11 ("AtprotoSpacesContentRepository, gated by
 * ATPROTO_SPACES_ENABLED=false"). No production code constructs or wires
 * this class anywhere (see apps/api/src/server.ts, which only ever
 * instantiates PrivateContentRepository) — it exists purely so
 * ContentRepository has a second implementation on paper, proving the
 * interface isn't accidentally shaped around Postgres-only assumptions.
 *
 * Genuinely implementing this (an actual Spaces-like storage mechanism)
 * doesn't exist as stable, documented AT Protocol infrastructure as of this
 * phase — per prompts/full.md's standing instruction to research current
 * mechanisms before implementing anything AT-Protocol-specific, inventing
 * fake wire behavior now would be worse than an honest stub. Phase 11 is
 * where that research and a real implementation belong.
 */
export class AtprotoSpacesContentRepository implements ContentRepository {
  createPost(_input: CreatePostInput): Promise<PostRecord> {
    throw new Error("AtprotoSpacesContentRepository is an experimental Phase 11 placeholder and is not implemented.");
  }

  updatePost(_postId: string, _creatorId: string, _patch: UpdatePostInput): Promise<PostRecord> {
    throw new Error("AtprotoSpacesContentRepository is an experimental Phase 11 placeholder and is not implemented.");
  }

  deletePost(_postId: string, _creatorId: string): Promise<void> {
    throw new Error("AtprotoSpacesContentRepository is an experimental Phase 11 placeholder and is not implemented.");
  }

  getPost(_postId: string): Promise<PostRecord | null> {
    throw new Error("AtprotoSpacesContentRepository is an experimental Phase 11 placeholder and is not implemented.");
  }

  getCreatorFeed(_creatorId: string, _options?: GetCreatorFeedOptions): Promise<PostRecord[]> {
    throw new Error("AtprotoSpacesContentRepository is an experimental Phase 11 placeholder and is not implemented.");
  }

  getFeed(_options?: GetFeedOptions): Promise<PostRecord[]> {
    throw new Error("AtprotoSpacesContentRepository is an experimental Phase 11 placeholder and is not implemented.");
  }
}
