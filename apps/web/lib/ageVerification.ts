/**
 * Age verification — WEB PHASE 14. Still a self-attestation gate, not real
 * identity/age verification: `full.md`'s Phase 14 elevates CREATOR identity
 * verification to a real, admin-reviewed backend field/workflow
 * (`Creator.verificationStatus`), but does not add a subscriber-facing age-
 * verification field or workflow — only creator KYC was "pulled forward from
 * future work" by its own text. Building a backend-tracked age-verification
 * status here would mean inventing API surface `full.md` never asked for,
 * which cross-cutting requirement #10 ("never build ahead of the API")
 * rules out. So this stays exactly what requirement #5 describes for every
 * earlier phase: a client-side self-attestation placeholder, "marked clearly
 * as a placeholder" — now surfaced consistently at every point adult content
 * is gated, rather than not existing at all. Real per-account age/identity
 * verification is documented future work (docs/ux.md's Phase 14 known
 * limitations).
 *
 * `next/headers`-free — imported by client components.
 */

const AGE_GATE_KEY = "ff.ageConfirmed";

export function hasConfirmedAge(): boolean {
  try {
    return window.localStorage.getItem(AGE_GATE_KEY) === "true";
  } catch {
    return false;
  }
}

export function confirmAge(): void {
  try {
    window.localStorage.setItem(AGE_GATE_KEY, "true");
  } catch {
    // localStorage unavailable (private browsing, etc.) — the gate just
    // reappears next time, which is the safe direction to fail in.
  }
}
