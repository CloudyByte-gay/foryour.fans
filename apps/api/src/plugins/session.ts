import { getAppSession, SESSION_COOKIE_NAME, type AppSessionData } from "@foryour-fans/auth";
import type { PrismaClient, User } from "@foryour-fans/database";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Redis } from "ioredis";

declare module "fastify" {
  interface FastifyRequest {
    /** Populated by sessionPlugin's onRequest hook; null if not logged in. */
    session: AppSessionData | null;
  }
}

export interface SessionPluginOptions {
  redis: Redis;
}

/**
 * Resolves the ff_session cookie (if any) into request.session on every
 * request, so route handlers never touch cookies/Redis directly — they
 * just read request.session, or use requireSession/requireCsrf below.
 */
export async function sessionPlugin(app: FastifyInstance, { redis }: SessionPluginOptions): Promise<void> {
  app.decorateRequest("session", null);

  app.addHook("onRequest", async (request, reply) => {
    // Cookie-authenticated responses and signed grants must never be reused
    // by a shared cache, including anonymous responses on personalized routes.
    reply.header("Cache-Control", "private, no-store");
    const sessionId = request.cookies[SESSION_COOKIE_NAME];
    request.session = sessionId ? await getAppSession(redis, sessionId) : null;
  });
}

/** Fastify preHandler: 401s if there's no valid session. */
export async function requireSession(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.session) {
    await reply.status(401).send({ error: { message: "Not authenticated.", statusCode: 401 } });
  }
}

/**
 * Fastify preHandler: 403s unless the x-csrf-token header matches the
 * session's server-side CSRF token (double-submit pattern — see
 * docs/architecture.md "CSRF"). Must run after requireSession.
 */
export async function requireCsrf(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const csrfHeader = request.headers["x-csrf-token"];
  if (!request.session || request.session.csrfToken !== csrfHeader) {
    await reply.status(403).send({ error: { message: "Invalid CSRF token.", statusCode: 403 } });
  }
}

declare module "fastify" {
  interface FastifyRequest {
    /** Populated by requireAdmin below, once the caller is confirmed ADMIN — avoids a second lookup in the handler. */
    adminUser?: User;
  }
}

/**
 * Phase 14 — 403s unless the session's User row has `role: "ADMIN"`. A
 * factory (not a bare preHandler) because it needs `prisma`, unlike
 * requireSession/requireCsrf above — only registered on the admin routes
 * (apps/api/src/routes/admin.ts) that actually need it, so ordinary routes
 * pay no extra DB lookup. Always re-reads the role fresh from Postgres
 * (never cached on the session cookie), same "mutable field, DB is the
 * source of truth" discipline as every other authenticated route in this
 * codebase — a demoted admin's very next request loses access immediately.
 * Must run after requireSession.
 */
export function requireAdmin(prisma: PrismaClient) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const user = request.session ? await prisma.user.findUnique({ where: { did: request.session.did } }) : null;
    if (!user || user.role !== "ADMIN") {
      await reply.status(403).send({ error: { message: "Admin access required.", statusCode: 403 } });
      return;
    }
    request.adminUser = user;
  };
}

/**
 * Phase 14 — 403s if the caller's `User.status` is RESTRICTED (see the
 * "restrict account" admin action, packages/moderation/src/moderationActions.ts).
 * Applied only to the specific write routes capable of harming others or
 * the platform: commenting, liking, subscribing, filing a report, and
 * blocking — never to reading, authentication, or a restricted user's
 * existing subscriptions/content, which stay fully available. Must run
 * after requireSession.
 */
export function requireNotRestricted(prisma: PrismaClient) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const user = request.session ? await prisma.user.findUnique({ where: { did: request.session.did } }) : null;
    if (!user || user.status === "RESTRICTED") {
      await reply.status(403).send({ error: { message: "This account is restricted.", statusCode: 403 } });
    }
  };
}
