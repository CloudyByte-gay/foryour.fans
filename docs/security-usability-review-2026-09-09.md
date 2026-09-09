# Security and usability review — 2026-09-09

This review fixes concrete issues in authentication, API caching and rate limiting,
browser security policy, navigation, and the media composer. It also upgrades the
web framework and exercises the existing authorization, billing, moderation,
media, accessibility, and responsive-layout tests. This is a source and local
test-environment review, not a penetration test of a deployed environment.

## Findings and fixes

| Finding | Impact | Fix |
| --- | --- | --- |
| OAuth completion was not bound to the initiating browser | An attacker could arrange for another browser to complete the attacker's sign-in (login CSRF). SDK transaction state alone did not establish browser ownership. | Store random application state in a ten-minute HttpOnly, SameSite=Lax cookie; compare with the state returned by the SDK before creating an app session. Clear it after success and revoke any replaced app session. |
| Raw forwarding headers selected rate-limit buckets | A direct client could rotate `X-Forwarded-For` to evade limits. | Use Fastify's resolved client IP with explicit `TRUSTED_PROXIES` IP/CIDR configuration; trust no proxy by default. Regression tests cover trusted and untrusted peers and changing spoofed headers. |
| Personalized API responses lacked a cache prohibition | Shared caches could retain cookie-authenticated content or signed grants, and stale browser responses could outlive access changes. | Set `Cache-Control: private, no-store` throughout the session-aware route scope, including anonymous responses and errors. |
| Request logs included OAuth query parameters | Authorization codes and state appeared in routine request logs. | Serialize request paths without query strings. |
| Prefix-only redirect validation differed from browser URL parsing | Control characters could turn a seemingly local path into an external navigation; dot segments and encoded names bypassed reserved-route checks. | Validate the parsed origin and normalized, decoded pathname; reject control characters, backslashes, malformed encodings, and auth/API/login destinations. |
| The CSP nonce was only on the response | Next could render inline framework scripts without the nonce, breaking hydration and interactive flows. | Forward the generated CSP to Next in the request as well as sending it to the browser, overriding client-supplied nonce/CSP headers. |
| CSP blocked direct storage uploads and local video previews | Signed cross-origin PUT uploads and blob video previews could fail despite valid files. | Permit HTTPS storage connections and blob media; allow the documented HTTP MinIO endpoints only outside production. |
| Upload retry removed the attachment; unexpected failures could leave it stuck | Users had to reselect files, and malformed/network responses could leave publishing blocked. | Retain the original File for retry and convert unexpected failures to actionable errors. Lock remove/reorder controls during save and announce truncated file selections. |
| Failed sign-in consumed the return destination during rendering | React rerenders could erase the destination before the user clicked retry. | Read the retry destination without consuming it; consume it only after successful sign-in. Profile-sync failures now reach the friendly callback error page. |
| Next.js 14.2.35 had 23 production dependency advisories | Included framework request handling, rewrite SSRF, CSP/XSS, denial-of-service, and image-optimizer vulnerabilities. | Upgrade to Next.js 15.5.24 and React 19.2.8, migrate remaining synchronous page search parameters, and initialize timer refs for React 19 types. Keep the unused image optimizer disabled. |

## Validation

- Production dependency audit after upgrading: **zero known vulnerabilities**
  (`pnpm audit --prod`); this is advisory coverage, not proof of absence of flaws.
- All 860 workspace unit/integration tests passed against disposable Postgres 16 and
  Redis 7 instances, including real entitlement, ownership, moderation, webhook,
  CSRF, OAuth, and rate-limit checks. Additional focused UI regressions cover retry
  destination persistence and disabled attachment controls (two more passing tests;
  862 unit/integration tests total).
- Workspace lint and type checks passed; API/package and production web builds passed.
- All **36 Chromium end-to-end tests passed** against the production build,
  including OAuth/logout, onboarding, posts, media access, subscriptions,
  settings, automated accessibility scans, and 360px overflow checks.

## Deployment notes and remaining limits

- Configure `TRUSTED_PROXIES` with the actual web-proxy/ingress addresses or CIDRs
  and prevent untrusted clients from bypassing the ingress. With it unset,
  proxied users share the proxy IP's rate-limit budget. Do not use a universal CIDR.
- `connect-src` allows HTTPS destinations for signed storage uploads. This is a
  deliberate policy relaxation; a deployment with a fixed storage origin can
  narrow it further. Inline scripts still require the per-request nonce.
- The existing fake payment/payout providers, age/identity verification limitations,
  and disabled gated PDS content remain launch constraints. This review does not
  add a real payment processor or approve the application for real-money launch.
- Local tests use fake AT authorization and payment providers. Real provider,
  production ingress, and object-storage configuration still require deployment
  validation. No production service or user data was modified.

## Primary references

- [Next.js nonce propagation](https://nextjs.org/docs/14/app/building-your-application/configuring/content-security-policy)
- [Fastify proxy trust](https://fastify.dev/docs/latest/Reference/Server/#trustproxy)
- [Next.js 15 migration](https://nextjs.org/docs/app/guides/upgrading/version-15)
- [Rewrite SSRF advisory](https://github.com/advisories/GHSA-p9j2-gv94-2wf4)
