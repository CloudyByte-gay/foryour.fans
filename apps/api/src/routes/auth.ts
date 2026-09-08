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
import { promoteAdminIfConfigured } from "@foryour-fans/moderation";
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
  /** Phase 14 — DIDs to promote to ADMIN on login; see config/env.ts#ADMIN_DIDS. */
  adminDids: string[];
  /**
   * Phase 15 — the per-route rate limit on POST /auth/atproto/start (see the
   * doc comment on that route below). A real, bounded ceiling in every
   * environment, but production-strict (10/minute) vs. test-relaxed
   * (200/minute, since the apps/web Playwright e2e suite drives many real
   * sign-ins through this exact route in one process from one source IP) —
   * see app.ts's registration call for the environment split.
   */
  authStartRateLimitMax: number;
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
  const { publicUrl, isProduction, redis, prisma, oauthClient, fetchProfile, adminDids, authStartRateLimitMax } = options;

  app.get("/oauth/client-metadata.json", async () => oauthClient.clientMetadata);
  app.get("/oauth/jwks.json", async () => oauthClient.jwks ?? { keys: [] });

  // Phase 15 — a much stricter rate limit than the app.ts global default:
  // every call here makes an outbound handle-resolution + Pushed
  // Authorization Request to a THIRD-PARTY PDS (see oauthClient.authorize
  // below), so a flood from here is an attack on someone else's
  // infrastructure via this one, not just a load problem for this API.
  app.post(
    "/auth/atproto/start",
    { config: { rateLimit: { max: authStartRateLimitMax, timeWindow: "1 minute" } } },
    async (request, reply) => {
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
    },
  );

  app.get("/auth/atproto/callback", async (request, reply) => {
    const queryString = request.url.includes("?") ? request.url.slice(request.url.indexOf("?") + 1) : "";
    const params = new URLSearchParams(queryString);

    // The web callback page (apps/web/app/auth/callback) is where the browser
    // lands after this route runs — on success to finish routing (honoring a
    // stored `next`, nudging brand-new users), on failure to show a friendly
    // message instead of a raw JSON body.
    const callbackUrl = `${publicUrl}/auth/callback`;

    // The authorization server redirects the user back here with `?error=...`
    // when they decline consent or the AS rejects the request. Forward the
    // code so the web page can say something specific (e.g. "you cancelled").
    const authServerError = params.get("error");
    if (authServerError) {
      request.log.info({ error: authServerError }, "atproto oauth callback returned an authorization-server error");
      return reply.redirect(`${callbackUrl}?error=${encodeURIComponent(authServerError)}`);
    }

    let session: OAuthSession;
    try {
      ({ session } = await oauthClient.callback(params));
    } catch (error) {
      request.log.warn({ err: error }, "atproto oauth callback failed");
      return reply.redirect(`${callbackUrl}?error=exchange_failed`);
    }

    const profile = await fetchProfile(session);
    const user = await syncUserFromProfile(prisma, profile);
    await promoteAdminIfConfigured(prisma, user.did, adminDids);

    const { sessionId, session: appSession } = await createAppSession(redis, assertDid(user.did));

    reply.setCookie(SESSION_COOKIE_NAME, sessionId, sessionCookieOptions(isProduction));
    reply.setCookie(CSRF_COOKIE_NAME, appSession.csrfToken, csrfCookieOptions(isProduction));

    return reply.redirect(callbackUrl);
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
      bannerUrl: user.bannerUrl,
      // Phase 14 (Trust and Safety) — role gates the web /admin console
      // client-side (the server-side check on every /admin/* route is what
      // actually matters); status drives the "your account is restricted"
      // banner. Both mutable, re-read fresh on every /me call like every
      // other field here.
      role: user.role,
      status: user.status,
    };
  });

  // Re-pull the cached profile fields (handle/displayName/avatarUrl/bannerUrl)
  // from the user's own PDS on demand. Same restore -> fetch -> sync path the
  // OAuth callback runs at login; the DID is never touched. See prompts/web.md
  // WEB PHASE 3 ("Refresh from AT Protocol").
  app.post("/me/refresh", { preHandler: [requireSession, requireCsrf] }, async (request, reply) => {
    const session = request.session!;

    let oauthSession: OAuthSession;
    try {
      oauthSession = await oauthClient.restore(session.did);
    } catch (error) {
      request.log.warn({ err: error }, "failed to restore atproto session for profile refresh");
      return reply.status(502).send({
        error: { message: "Couldn't reach your AT Protocol account. Try signing in again.", statusCode: 502 },
      });
    }

    let profile: AtprotoProfile;
    try {
      profile = await fetchProfile(oauthSession);
    } catch (error) {
      request.log.warn({ err: error }, "failed to fetch atproto profile for refresh");
      return reply.status(502).send({
        error: { message: "Couldn't fetch your profile from your PDS.", statusCode: 502 },
      });
    }

    const user = await syncUserFromProfile(prisma, profile);
    return {
      did: user.did,
      handle: user.handle,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      bannerUrl: user.bannerUrl,
      role: user.role,
      status: user.status,
    };
  });
}
