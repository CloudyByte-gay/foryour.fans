import { randomBytes } from "node:crypto";
import type { AtprotoProfile, OAuthClientLike } from "@foryour-fans/atproto";
import type { OAuthSession } from "@atproto/oauth-client-node";
import {
  CSRF_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  APP_SESSION_TTL_SECONDS,
  createAppSession,
  destroyAppSession,
  syncUserFromProfile,
} from "@foryour-fans/auth";
import type { PrismaClient } from "@foryour-fans/database";
import { assertDid } from "@foryour-fans/shared";
import type { FastifyInstance } from "fastify";
import type { Redis } from "ioredis";
import { z } from "zod";
import { requireCsrf, requireSession } from "../plugins/session.js";

export interface AuthRoutesOptions {
  publicUrl: string;
  isProduction: boolean;
  redis: Redis;
  prisma: PrismaClient;
  oauthClient: OAuthClientLike;
  fetchProfile: (session: OAuthSession) => Promise<AtprotoProfile>;
}

const startBodySchema = z.object({
  handle: z.string().trim().min(1, "handle is required"),
});

function sessionCookieOptions(isProduction: boolean) {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax" as const,
    path: "/",
    maxAge: APP_SESSION_TTL_SECONDS,
  };
}

function csrfCookieOptions(isProduction: boolean) {
  // Deliberately NOT httpOnly — frontend JS reads this to echo it back as
  // the x-csrf-token header (double-submit pattern); the session store is
  // still the source of truth the server actually checks against.
  return {
    httpOnly: false,
    secure: isProduction,
    sameSite: "lax" as const,
    path: "/",
    maxAge: APP_SESSION_TTL_SECONDS,
  };
}

export async function authRoutes(app: FastifyInstance, options: AuthRoutesOptions): Promise<void> {
  const { publicUrl, isProduction, redis, prisma, oauthClient, fetchProfile } = options;

  app.get("/oauth/client-metadata.json", async () => oauthClient.clientMetadata);
  app.get("/oauth/jwks.json", async () => oauthClient.jwks ?? { keys: [] });

  app.post("/auth/atproto/start", async (request, reply) => {
    const parsed = startBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: { message: "handle is required", statusCode: 400 } });
    }

    const state = randomBytes(16).toString("hex");

    try {
      const url = await oauthClient.authorize(parsed.data.handle, { state });
      return { redirectUrl: url.toString() };
    } catch (error) {
      request.log.warn({ err: error, handle: parsed.data.handle }, "failed to start atproto oauth flow");
      return reply.status(400).send({
        error: { message: "Could not start sign-in for that handle.", statusCode: 400 },
      });
    }
  });

  app.get("/auth/atproto/callback", async (request, reply) => {
    const queryString = request.url.includes("?") ? request.url.slice(request.url.indexOf("?") + 1) : "";
    const params = new URLSearchParams(queryString);

    let session: OAuthSession;
    try {
      ({ session } = await oauthClient.callback(params));
    } catch (error) {
      request.log.warn({ err: error }, "atproto oauth callback failed");
      return reply.status(400).send({ error: { message: "Sign-in failed.", statusCode: 400 } });
    }

    const profile = await fetchProfile(session);
    const user = await syncUserFromProfile(prisma, profile);

    const { sessionId, session: appSession } = await createAppSession(redis, assertDid(user.did));

    reply.setCookie(SESSION_COOKIE_NAME, sessionId, sessionCookieOptions(isProduction));
    reply.setCookie(CSRF_COOKIE_NAME, appSession.csrfToken, csrfCookieOptions(isProduction));

    return reply.redirect(`${publicUrl}/dashboard`);
  });

  app.post("/auth/logout", { preHandler: [requireCsrf] }, async (request, reply) => {
    const sessionId = request.cookies[SESSION_COOKIE_NAME];
    if (sessionId) {
      await destroyAppSession(redis, sessionId);
    }

    reply.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
    reply.clearCookie(CSRF_COOKIE_NAME, { path: "/" });
    return reply.status(204).send();
  });

  app.get("/me", { preHandler: [requireSession] }, async (request, reply) => {
    // requireSession already 401'd and short-circuited if this is null.
    const session = request.session!;

    const user = await prisma.user.findUnique({ where: { did: session.did } });
    if (!user) {
      return reply.status(401).send({ error: { message: "Not authenticated.", statusCode: 401 } });
    }

    return {
      did: user.did,
      handle: user.handle,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
    };
  });
}
