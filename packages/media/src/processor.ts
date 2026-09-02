import type { MediaProcessor } from "./types.js";

/**
 * The real, shipped Phase 8 MediaProcessor — see MediaProcessor's own doc
 * comment (types.ts) for why "no real scanning yet, always ready" is the
 * honest implementation rather than a stub. Wired into server.ts exactly
 * like FakePaymentProvider was Phase 6's real implementation.
 */
export class PassthroughMediaProcessor implements MediaProcessor {
  process(_asset: { id: string; storageKey: string; mimeType: string }): Promise<"ready" | "rejected"> {
    return Promise.resolve("ready");
  }
}
