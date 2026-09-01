import { getAppSession, SESSION_COOKIE_NAME, type AppSessionData } from "@foryour-fans/auth";
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

  app.addHook("onRequest", async (request) => {
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
