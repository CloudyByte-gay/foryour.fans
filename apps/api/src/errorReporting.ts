import type { FastifyBaseLogger } from "fastify";

export interface ErrorReportContext {
  requestId: string;
  method: string;
  url: string;
  statusCode: number;
}

/**
 * Phase 15 (Production Hardening) — "error reporting interface". Same
 * dependency-injection shape as PaymentProvider/ObjectStorage/MediaProcessor
 * before it: the domain (here, "an unexpected error happened") is decoupled
 * from any specific vendor. `LoggingErrorReporter` below is the only
 * implementation that exists today — it forwards to the app's own
 * structured (pino) logs, exactly like PassthroughMediaProcessor/
 * PassthroughContentClassifier are the only real implementations of THEIR
 * interfaces. A real APM/error-tracking integration (Sentry, Bugsnag,
 * Honeycomb, ...) is future, undetermined work that plugs into this same
 * interface with zero call-site changes — see registerErrorHandler.
 */
export interface ErrorReporter {
  reportError(error: unknown, context: ErrorReportContext): void;
}

/**
 * The real (only) implementation. Deliberately reports every 5xx it's
 * given — 4xx client errors are routine (bad input, expired session) and
 * are already visible in access logs; only failures worth someone's
 * attention go through this path, mirroring the severity split a real
 * error-tracking service would apply itself.
 */
export class LoggingErrorReporter implements ErrorReporter {
  constructor(private readonly logger: FastifyBaseLogger) {}

  reportError(error: unknown, context: ErrorReportContext): void {
    if (context.statusCode < 500) return;
    this.logger.error({ err: error, ...context }, "error reported");
  }
}
