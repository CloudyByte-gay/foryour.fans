import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { LoggingErrorReporter, type ErrorReporter } from "../src/errorReporting.js";
import { registerErrorHandler } from "../src/plugins/error-handler.js";

describe("registerErrorHandler + ErrorReporter", () => {
  it("reports a thrown 500 to the injected ErrorReporter with request context", async () => {
    const reportError = vi.fn();
    const reporter: ErrorReporter = { reportError };

    const app = Fastify({ logger: false });
    registerErrorHandler(app, reporter);
    app.get("/boom", async () => {
      throw new Error("kaboom");
    });

    const response = await app.inject({ method: "GET", url: "/boom" });

    expect(response.statusCode).toBe(500);
    expect(reportError).toHaveBeenCalledTimes(1);
    const [error, context] = reportError.mock.calls[0]!;
    expect((error as Error).message).toBe("kaboom");
    expect(context).toMatchObject({ method: "GET", url: "/boom", statusCode: 500 });

    await app.close();
  });

  it("calls the reporter for a 4xx too, passing the real statusCode through — severity filtering is the reporter's job, not the error handler's", async () => {
    const reportError = vi.fn();
    const app = Fastify({ logger: false });
    registerErrorHandler(app, { reportError });
    app.get("/missing", async () => {
      const error = new Error("Not found") as Error & { statusCode: number };
      error.statusCode = 404;
      throw error;
    });

    const response = await app.inject({ method: "GET", url: "/missing" });

    expect(response.statusCode).toBe(404);
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError.mock.calls[0]![1]).toMatchObject({ statusCode: 404 });

    await app.close();
  });
});

describe("LoggingErrorReporter", () => {
  it("logs a 5xx error", () => {
    const error = vi.fn();
    const reporter = new LoggingErrorReporter({ error } as never);

    reporter.reportError(new Error("oops"), { requestId: "r1", method: "GET", url: "/x", statusCode: 500 });

    expect(error).toHaveBeenCalledTimes(1);
  });

  it("does not log a 4xx error — those are routine, not incidents", () => {
    const error = vi.fn();
    const reporter = new LoggingErrorReporter({ error } as never);

    reporter.reportError(new Error("bad input"), { requestId: "r1", method: "GET", url: "/x", statusCode: 404 });

    expect(error).not.toHaveBeenCalled();
  });
});
