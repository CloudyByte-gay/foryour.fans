import { Redis } from "ioredis";

// Keyed by URL — a bare module-level singleton would silently hand every
// caller the connection for whichever URL was passed first, ignoring the
// URL any later caller actually asked for.
const clients = new Map<string, Redis>();

export function getRedisClient(redisUrl: string): Redis {
  let client = clients.get(redisUrl);
  if (!client) {
    client = new Redis(redisUrl, {
      // Fail fast in health/readiness checks instead of buffering forever.
      maxRetriesPerRequest: 3,
    });
    clients.set(redisUrl, client);
  }
  return client;
}
