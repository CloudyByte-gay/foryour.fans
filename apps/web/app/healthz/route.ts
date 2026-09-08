import { NextResponse } from "next/server";

/**
 * Phase 16 (Kubernetes Deployment / WEB PHASE 16) — liveness/readiness
 * target for the web Deployment (infrastructure/kubernetes/base/
 * web-deployment.yaml). A Route Handler, not a page: it never touches
 * app/layout.tsx (no session lookup, no theme cookie read), so a probe
 * never depends on this app's own middleware/CSP nonce plumbing or on
 * apps/api being reachable — it only proves the Next.js server process
 * itself is up and serving requests, mirroring apps/api's own /health
 * (liveness, no external dependency) vs /ready (checks dependencies)
 * split. There is no web-side equivalent of /ready: this server has no
 * dependency of its own to check — every real dependency check already
 * happens in apps/api's /ready.
 */
export function GET() {
  return NextResponse.json({ status: "ok" });
}
