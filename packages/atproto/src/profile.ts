import { Agent } from "@atproto/api";
import type { OAuthSession } from "@atproto/oauth-client-node";

export interface AtprotoProfile {
  did: string;
  handle: string;
  displayName?: string;
  avatarUrl?: string;
}

/**
 * Fetches the subset of the user's own profile we cache locally (see
 * User.handle/displayName/avatarUrl — all mutable, all re-synced on login;
 * only User.did is treated as identity).
 */
export async function fetchProfile(session: OAuthSession): Promise<AtprotoProfile> {
  const agent = new Agent(session);
  const { data } = await agent.getProfile({ actor: session.did });

  return {
    did: data.did,
    handle: data.handle,
    displayName: data.displayName,
    avatarUrl: data.avatar,
  };
}
