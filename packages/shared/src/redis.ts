import { Redis } from "ioredis";

let client: Redis | undefined;

export function getRedisClient(redisUrl: string): Redis {
  client ??= new Redis(redisUrl, {
    // Fail fast in health/readiness checks instead of buffering forever.
    maxRetriesPerRequest: 3,
  });
  return client;
}
