import type { FastifyInstance } from "fastify";

export type ReadinessCheck = () => Promise<void>;

interface ReadyRoutesOptions {
  checkDatabaseConnection: ReadinessCheck;
  /**
   * Phase 15 — Redis is a real hard dependency too (sessions, OAuth state,
   * rate-limit counters), but `/ready` was only ever checking Postgres.
   * Optional (defaulting to a no-op) so every existing test call site that
   * builds an app without caring about readiness at all keeps working
   * unchanged; server.ts always supplies the real ping-based check.
   */
  checkRedisConnection?: ReadinessCheck;
}

/**
 * Readiness check: verifies PostgreSQL AND Redis connectivity so
 * orchestrators (k8s) can hold traffic back until every dependency this
 * process actually needs is reachable — not just one of them.
 */
export async function readyRoutes(app: FastifyInstance, options: ReadyRoutesOptions): Promise<void> {
  const checkRedisConnection = options.checkRedisConnection ?? (async () => {});

  app.get("/ready", { config: { rateLimit: false } }, async (request, reply) => {
    try {
      await options.checkDatabaseConnection();
    } catch (error) {
      request.log.error({ err: error }, "readiness check failed");
      return reply.status(503).send({ status: "unavailable" as const, reason: "database unreachable" });
    }

    try {
      await checkRedisConnection();
    } catch (error) {
      request.log.error({ err: error }, "readiness check failed");
      return reply.status(503).send({ status: "unavailable" as const, reason: "redis unreachable" });
    }

    return { status: "ok" as const };
  });
}
