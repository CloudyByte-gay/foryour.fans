import type { PrismaClient } from "@foryour-fans/database";
import { InvalidWebhookError, processWebhookEvent, type PaymentProvider } from "@foryour-fans/subscriptions";
import type { FastifyInstance, FastifyRequest } from "fastify";

export interface WebhooksRoutesOptions {
  prisma: PrismaClient;
  paymentProvider: PaymentProvider;
}

/**
 * Public — called by the payment provider, not a logged-in browser, so
 * this is deliberately registered outside the session-requiring scope (see
 * app.ts) and needs none of requireSession/requireCsrf.
 *
 * Registers its own raw-body content-type parser, scoped to this plugin
 * only via Fastify's encapsulation (same pattern as sessionPlugin — see
 * docs/architecture.md): a real PaymentProvider's signature verification
 * depends on the exact bytes received, and Fastify's default JSON parser
 * would re-serialize the body before a handler ever saw it, silently
 * breaking that verification. Every other route in the app keeps normal
 * JSON body parsing.
 */
export async function webhooksRoutes(app: FastifyInstance, { prisma, paymentProvider }: WebhooksRoutesOptions): Promise<void> {
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (_request: FastifyRequest, rawBody: Buffer) =>
    Promise.resolve(rawBody),
  );

  app.post("/webhooks/:provider", async (request, reply) => {
    const { provider } = request.params as { provider: string };
    if (provider !== paymentProvider.name) {
      return reply.status(404).send({ error: { message: "Unknown payment provider.", statusCode: 404 } });
    }

    const rawBody = request.body as Buffer;

    try {
      const outcome = await processWebhookEvent(prisma, paymentProvider, rawBody, request.headers as Record<string, string>);
      return { outcome };
    } catch (error) {
      if (error instanceof InvalidWebhookError) {
        request.log.warn({ err: error.cause }, "invalid webhook delivery");
        return reply.status(400).send({ error: { message: error.message, statusCode: 400 } });
      }
      throw error;
    }
  });
}
