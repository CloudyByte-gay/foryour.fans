import type { PrismaClient } from "@foryour-fans/database";
import {
  ContentKeyNotFoundError,
  KeyGrantDeniedError,
  type KeyGrantService,
} from "@foryour-fans/subscriptions";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireCsrf, requireSession } from "../plugins/session.js";

export interface ContentKeysRoutesOptions {
  prisma: PrismaClient;
  /** Absent unless CREATOR_OWNED_GATED_CONTENT_ENABLED — see app.ts. */
  keyGrantService?: KeyGrantService;
}

const grantBodySchema = z.object({
  /** AT URI of the gated fans.foryour.post (or fans.foryour.media) record. */
  subjectUri: z.string().min(1).startsWith("at://"),
});

/**
 * `POST /content-keys/grant` — the browser-facing side of the
 * entitlement→decryption-key boundary (prompts/creator-owned-pds.md
 * "Entitlement and Key Grants"). The viewer's DID comes from their session,
 * never the request body. A key is returned ONLY for a currently-paid,
 * tier-sufficient ACTIVE subscription (or the creator themselves); every
 * other subscription state is denied with a reason. The browser must never
 * receive a key for content the current viewer cannot access.
 *
 * When gated creator-owned content is not enabled for this deployment
 * (`keyGrantService` absent), the route replies 501 — the documented
 * protocol gap, not a bug.
 */
export async function contentKeysRoutes(app: FastifyInstance, opts: ContentKeysRoutesOptions): Promise<void> {
  app.post("/content-keys/grant", { preHandler: [requireSession, requireCsrf] }, async (request, reply) => {
    if (!opts.keyGrantService) {
      return reply.status(501).send({
        error: {
          message:
            "Gated creator-owned content is not enabled on this deployment. See docs/creator-owned-pds.md for the protocol gap.",
          statusCode: 501,
        },
      });
    }

    const parsed = grantBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { message: parsed.error.issues[0]?.message ?? "Invalid input.", statusCode: 400 } });
    }

    try {
      const grant = await opts.keyGrantService.requestContentKeyGrant({
        subscriberDid: request.session!.did,
        subjectUri: parsed.data.subjectUri,
      });
      return reply.status(200).send({
        subjectUri: grant.subjectUri,
        algorithm: grant.algorithm,
        contentKey: grant.contentKeyBase64,
        expiresAt: grant.expiresAt.toISOString(),
      });
    } catch (error) {
      if (error instanceof ContentKeyNotFoundError) {
        return reply.status(404).send({ error: { message: "No such gated content.", statusCode: 404 } });
      }
      if (error instanceof KeyGrantDeniedError) {
        return reply
          .status(403)
          .send({ error: { message: "You don't have access to this content.", statusCode: 403, reason: error.reason } });
      }
      throw error;
    }
  });
}
