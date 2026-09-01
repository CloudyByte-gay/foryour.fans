export type Did = string & { readonly __brand: "Did" };

const DID_PATTERN = /^did:[a-z0-9]+:[a-zA-Z0-9._:%-]+$/;

export function isDid(value: string): value is Did {
  return DID_PATTERN.test(value);
}

export function assertDid(value: string): Did {
  if (!isDid(value)) {
    throw new Error(`Not a valid DID: ${value}`);
  }
  return value;
}

export { getRedisClient } from "./redis.js";

