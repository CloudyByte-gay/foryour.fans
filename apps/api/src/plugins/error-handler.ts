import type { FastifyError, FastifyInstance } from "fastify";

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const statusCode = error.statusCode ?? 500;

    request.log.error({ err: error, requestId: request.id }, "request failed");

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
