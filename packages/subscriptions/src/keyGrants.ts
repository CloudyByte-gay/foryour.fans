import type { PrismaClient } from "@foryour-fans/database";
import { canAccess } from "./entitlements.js";

/**
 * The entitlement → decryption-key boundary for creator-owned GATED content
 * (see prompts/creator-owned-pds.md "Entitlement and Key Grants",
 * docs/creator-owned-pds.md).
 *
 * A subscriber gets the (unwrapped) per-post content key ONLY when every one
 * of these holds:
 *  - they are authenticated by DID (the caller supplies a verified DID)
 *  - a subscription of theirs targets this content's creator
 *  - that subscription's status is ACTIVE
 *  - it is paid/current (period not lapsed)
 *  - its tier satisfies the content's access policy (sortOrder hierarchy)
 * The creator themselves always passes.
 *
 * PENDING / PAST_DUE / CANCELED / EXPIRED / refunded / missing provider
 * state all DENY. The unwrapped key never leaves this service except as the
 * return value of a successful `requestContentKeyGrant`, and the caller
 * (apps/api) must only forward it to a viewer who just passed this check.
 */

const DEFAULT_GRANT_TTL_MS = 24 * 60 * 60 * 1000;

export type KeyGrantDenialReason =
  | "not-authenticated"
  | "unknown-content"
  | "no-subscription"
  | "subscription-not-active"
  | "subscription-past-due"
  | "subscription-canceled"
  | "subscription-expired"
  | "subscription-lapsed"
  | "tier-too-low";

export class ContentKeyNotFoundError extends Error {
  readonly reason: KeyGrantDenialReason = "unknown-content";
}

export class KeyGrantDeniedError extends Error {
  constructor(readonly reason: KeyGrantDenialReason) {
    super(`Key grant denied: ${reason}`);
    this.name = "KeyGrantDeniedError";
  }
}

export interface KeyUnwrapper {
  /** Envelope-unwrap a `ContentKey.wrappedKey` back to raw 32 key bytes. */
  (wrappedKey: string): Buffer;
}

export interface RequestContentKeyGrantParams {
  /** The viewer's DID, already verified by the caller (session/DPoP). */
  subscriberDid: string;
  /** AT URI of the gated `fans.foryour.post` (or `fans.foryour.media`) record. */
  subjectUri: string;
}

export interface ContentKeyGrantResult {
  subjectUri: string;
  algorithm: string;
  /** Base64 raw content key. Give ONLY to a viewer who just passed the check. */
  contentKeyBase64: string;
  expiresAt: Date;
}

export interface KeyGrantServiceOptions {
  grantTtlMs?: number;
}

export class KeyGrantService {
  private readonly grantTtlMs: number;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly unwrapKey: KeyUnwrapper,
    options: KeyGrantServiceOptions = {},
  ) {
    this.grantTtlMs = options.grantTtlMs ?? DEFAULT_GRANT_TTL_MS;
  }

  async requestContentKeyGrant(params: RequestContentKeyGrantParams): Promise<ContentKeyGrantResult> {
    if (!params.subscriberDid) {
      throw new KeyGrantDeniedError("not-authenticated");
    }

    const contentKey = await this.prisma.contentKey.findUnique({
      where: { subjectUri: params.subjectUri },
      include: { creator: true },
    });
    if (!contentKey) {
      throw new ContentKeyNotFoundError(`No content key registered for ${params.subjectUri}`);
    }

    const creatorDid = contentKey.creator.did;
    const isCreator = params.subscriberDid === creatorDid;

    const subscriber = await this.prisma.user.findUnique({ where: { did: params.subscriberDid } });
    if (!subscriber && !isCreator) {
      throw new KeyGrantDeniedError("no-subscription");
    }

    let subscriptionId: string | null = null;

    if (!isCreator) {
      // Most-specific denial reason first, for honest errors and for the
      // spec's "PENDING/PAST_DUE/CANCELED/EXPIRED must deny" test.
      const anySub = await this.prisma.subscription.findFirst({
        where: { subscriberUserId: subscriber!.id, creatorId: contentKey.creatorId },
        orderBy: { createdAt: "desc" },
      });
      if (!anySub) {
        throw new KeyGrantDeniedError("no-subscription");
      }
      switch (anySub.status) {
        case "PENDING":
          throw new KeyGrantDeniedError("subscription-not-active");
        case "PAST_DUE":
          throw new KeyGrantDeniedError("subscription-past-due");
        case "CANCELED":
          throw new KeyGrantDeniedError("subscription-canceled");
        case "EXPIRED":
          throw new KeyGrantDeniedError("subscription-expired");
        case "ACTIVE":
          break;
      }
      if (anySub.currentPeriodEnd && anySub.currentPeriodEnd.getTime() <= Date.now()) {
        throw new KeyGrantDeniedError("subscription-lapsed");
      }
      subscriptionId = anySub.id;

      // Tier hierarchy + the canonical ACTIVE re-check, reusing the one
      // authority (canAccess) rather than re-deriving it here.
      const allowed = await canAccess(this.prisma, {
        subscriberDid: params.subscriberDid,
        creatorDid,
        requiredTierId: contentKey.audience === "TIER" ? (contentKey.requiredTierId ?? undefined) : undefined,
      });
      if (!allowed) {
        throw new KeyGrantDeniedError("tier-too-low");
      }
    }

    const contentKeyBytes = this.unwrapKey(contentKey.wrappedKey);
    const expiresAt = new Date(Date.now() + this.grantTtlMs);

    if (subscriber) {
      await this.prisma.contentKeyGrant.upsert({
        where: { contentKeyId_subscriberUserId: { contentKeyId: contentKey.id, subscriberUserId: subscriber.id } },
        create: {
          contentKeyId: contentKey.id,
          subscriberUserId: subscriber.id,
          subscriptionId,
          expiresAt,
          revokedAt: null,
        },
        update: { subscriptionId, issuedAt: new Date(), expiresAt, revokedAt: null },
      });
    }

    return {
      subjectUri: params.subjectUri,
      algorithm: contentKey.algorithm,
      contentKeyBase64: contentKeyBytes.toString("base64"),
      expiresAt,
    };
  }

  /**
   * Revoke every outstanding grant issued on the strength of a subscription
   * that has now lapsed. Honest about its limit: this stops the viewer from
   * getting a fresh key / renewing, but cannot un-download plaintext they
   * already decrypted (see docs/creator-owned-pds.md §10 Q4).
   */
  async revokeGrantsForSubscription(subscriptionId: string): Promise<number> {
    const { count } = await this.prisma.contentKeyGrant.updateMany({
      where: { subscriptionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return count;
  }

  /** A grant a client may still use to decrypt from cache. */
  async hasUsableGrant(subscriberDid: string, subjectUri: string): Promise<boolean> {
    const subscriber = await this.prisma.user.findUnique({ where: { did: subscriberDid } });
    if (!subscriber) {
      return false;
    }
    const grant = await this.prisma.contentKeyGrant.findFirst({
      where: {
        subscriberUserId: subscriber.id,
        revokedAt: null,
        expiresAt: { gt: new Date() },
        contentKey: { subjectUri },
      },
    });
    return grant !== null;
  }
}
