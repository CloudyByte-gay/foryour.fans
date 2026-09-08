import { cookies } from "next/headers";
import { loadWebEnv } from "./env";

const { API_INTERNAL_URL } = loadWebEnv();

/**
 * Server Component -> apps/api, forwarding the incoming request's cookies
 * directly. Bypasses the public /api/* proxy (see next.config.mjs) since
 * we're already running server-side — the browser is never involved.
 */
export async function fetchApi(path: string, init: RequestInit = {}): Promise<Response> {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");

  return fetch(`${API_INTERNAL_URL}${path}`, {
    ...init,
    headers: { ...init.headers, cookie: cookieHeader },
    cache: "no-store",
  });
}
