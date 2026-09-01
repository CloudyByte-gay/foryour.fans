import { PrismaClient } from "@prisma/client";

export { Prisma, PrismaClient } from "@prisma/client";
export type * from "@prisma/client";

let client: PrismaClient | undefined;

export function getPrismaClient(): PrismaClient {
  client ??= new PrismaClient();
  return client;
}
