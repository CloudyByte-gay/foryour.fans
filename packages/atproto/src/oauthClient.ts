import { requestLocalLock } from "@atproto/oauth-client";
import type { OAuthSession } from "@atproto/oauth-client-node";
import {
  NodeOAuthClient,
  type NodeSavedSessionStore,
  type NodeSavedStateStore,
} from "@atproto/oauth-client-node";
import { JoseKey } from "@atproto/jwk-jose";
import { buildAtprotoLoopbackClientMetadata } from "@atproto/oauth-types";
import type { OAuthClientMetadataInput } from "@atproto/oauth-types";

const OAUTH_SCOPE = "atproto transition:generic";

/**
 * The minimal surface apps/api's auth routes actually call. Routes depend
 * on this interface, not the concrete NodeOAuthClient — the real client
 * satisfies it structurally, and tests inject a fake instead of hitting a
 * real PDS/authorization server, the same DI pattern the spec establishes
 * for ContentRepository/PaymentProvider in later phases.
 */
export interface OAuthClientLike {
  readonly clientMetadata: unknown;
  readonly jwks: unknown;
  authorize(handle: string, options?: { state?: string; signal?: AbortSignal }): Promise<URL>;
  callback(params: URLSearchParams): Promise<{ session: OAuthSession; state: string | null }>;
  /** Re-hydrates a durable AT OAuth grant so we can act on a DID's behalf outside their browser session — see packages/auth's Postgres-backed sessionStore. */
  restore(did: string): Promise<OAuthSession>;
}

/**
 * Everything OAuth-related (client_id/client-metadata document, jwks, and
 * the callback redirect_uri) is served from a single public origin under
 * `/api/*`, proxied through the Next.js app (see apps/web/next.config.mjs)
 * so browser cookies set on the OAuth callback are same-origin with the web
 * app rather than split across two ports/origins. In dev this is
 * `http://127.0.0.1:3000`; in production it's the site's real public URL.
 */
export interface AtprotoOAuthConfig {
  publicUrl: string;
  mode: "loopback" | "hosted";
  /** Required when mode === "hosted". PEM-encoded EC (P-256) private key used for private_key_jwt client auth. */
  privateKeyPem?: string;
}

export interface CreateOAuthClientOptions {
  config: AtprotoOAuthConfig;
  stateStore: NodeSavedStateStore;
  sessionStore: NodeSavedSessionStore;
}

export function oauthCallbackRedirectUri(publicUrl: string): string {
  return `${publicUrl}/api/auth/atproto/callback`;
}

export function oauthClientMetadataUrl(publicUrl: string): string {
  return `${publicUrl}/api/oauth/client-metadata.json`;
}

export function oauthJwksUri(publicUrl: string): string {
  return `${publicUrl}/api/oauth/jwks.json`;
}

export async function createOAuthClient({
  config,
  stateStore,
  sessionStore,
}: CreateOAuthClientOptions): Promise<NodeOAuthClient> {
  const redirectUri = oauthCallbackRedirectUri(config.publicUrl);

  if (config.mode === "loopback") {
    // No keyset: the loopback client is a public/native client
    // (token_endpoint_auth_method: "none"), per the atproto OAuth spec's
    // dev-only localhost client_id convention — see prompts/full.md and
    // docs/architecture.md for why this must never be used in production.
    return new NodeOAuthClient({
      clientMetadata: buildAtprotoLoopbackClientMetadata({
        scope: OAUTH_SCOPE,
        redirect_uris: [redirectUri],
      }),
      stateStore,
      sessionStore,
      requestLock: requestLocalLock,
    });
  }

  if (!config.privateKeyPem) {
    throw new Error("privateKeyPem is required when AtprotoOAuthConfig.mode is 'hosted'");
  }

  const keyset = [await JoseKey.fromImportable(config.privateKeyPem, "key1")];

  const clientMetadata: OAuthClientMetadataInput = {
    client_id: oauthClientMetadataUrl(config.publicUrl),
    client_name: "foryour.fans",
    client_uri: config.publicUrl,
    redirect_uris: [redirectUri],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    scope: OAUTH_SCOPE,
    token_endpoint_auth_method: "private_key_jwt",
    token_endpoint_auth_signing_alg: "ES256",
    jwks_uri: oauthJwksUri(config.publicUrl),
    dpop_bound_access_tokens: true,
    application_type: "web",
  };

  return new NodeOAuthClient({
    clientMetadata,
    keyset,
    stateStore,
    sessionStore,
    // A single in-process lock is only correct for a single API replica.
    // Phase 16 (multi-replica k8s) must replace this with a distributed
    // lock (e.g. Redlock over Redis) before scaling apps/api horizontally.
    requestLock: requestLocalLock,
  });
}
