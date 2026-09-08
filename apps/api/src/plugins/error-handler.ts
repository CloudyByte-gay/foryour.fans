import type { FastifyError, FastifyInstance } from "fastify";
import type { ErrorReporter } from "../errorReporting.js";

export function registerErrorHandler(app: FastifyInstance, errorReporter: ErrorReporter): void {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const statusCode = error.statusCode ?? 500;

    request.log.error({ err: error, requestId: request.id }, "request failed");
    errorReporter.reportError(error, { requestId: request.id, method: request.method, url: request.url, statusCode });

    reply.status(statusCode).send({
      error: {
        message: statusCode >= 500 ? "Internal Server Error" : error.message,
        statusCode,
        requestId: request.id,
      },
    });
  });

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      error: {
        message: "Not Found",
        statusCode: 404,
        requestId: request.id,
      },
    });
  });
}
