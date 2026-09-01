import type { FastifyInstance } from "fastify";

/**
 * Liveness check: verifies the process itself is up and answering requests.
 * Must never depend on external systems (Postgres, Redis, etc) — that's /ready.
 */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => {
    return { status: "ok" as const };
  });
}
