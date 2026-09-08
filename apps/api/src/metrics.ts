import { collectDefaultMetrics, Histogram, Registry } from "prom-client";
import type { FastifyInstance } from "fastify";

export interface Metrics {
  registry: Registry;
  httpRequestDuration: Histogram<"method" | "route" | "status_code">;
}

/**
 * Phase 15 (Production Hardening) — "Implement: metrics". Deliberately a
 * FRESH Registry per call, never prom-client's process-wide default
 * registry: the automated test suite calls buildApp() (and therefore this)
 * many times per process, and a second `collectDefaultMetrics()` /
 * `new Histogram()` against the same default registry throws ("metric ...
 * has already been registered"). In production there's exactly one
 * buildApp() call (server.ts), so this is still the one registry per
 * process Prometheus expects to scrape.
 */
export function createMetrics(): Metrics {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });

  const httpRequestDuration = new Histogram({
    name: "http_request_duration_seconds",
    help: "HTTP request duration in seconds, labeled by method, route, and response status code.",
    labelNames: ["method", "route", "status_code"],
    registers: [registry],
  });

  return { registry, httpRequestDuration };
}

export interface MetricsRoutesOptions {
  registry: Registry;
}

/**
 * GET /metrics — a Prometheus scrape target. Registered directly on the
 * root app instance, outside the session-resolving scope and exempt from
 * rate limiting, for the same reasons as /health and /ready (see app.ts):
 * a scraper polls on a fixed interval and must never depend on Redis
 * session lookups or be throttled. Deliberately unauthenticated at the
 * application layer — a real deployment restricts this route at the
 * network/ingress level (internal-only, never internet-facing), which is
 * how Prometheus scraping is conventionally secured, rather than adding an
 * app-level credential that would complicate every scrape config.
 */
export async function metricsRoutes(app: FastifyInstance, { registry }: MetricsRoutesOptions): Promise<void> {
  app.get("/metrics", { config: { rateLimit: false } }, async (request, reply) => {
    reply.header("content-type", registry.contentType);
    return registry.metrics();
  });
}
