import type { FastifyInstance } from "fastify";

export type ReadinessCheck = () => Promise<void>;

interface ReadyRoutesOptions {
  checkDatabaseConnection: ReadinessCheck;
}

/**
 * Readiness check: verifies PostgreSQL connectivity so orchestrators (k8s)
 * can hold traffic back until dependencies are actually reachable.
 */
export async function readyRoutes(app: FastifyInstance, options: ReadyRoutesOptions): Promise<void> {
  app.get("/ready", async (request, reply) => {
    try {
      await options.checkDatabaseConnection();
      return { status: "ok" as const };
    } catch (error) {
      request.log.error({ err: error }, "readiness check failed");
      return reply.status(503).send({
        status: "unavailable" as const,
        reason: "database unreachable",
      });
    }
  });
}
