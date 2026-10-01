# 2026-09-30 — A-310: server-side backend calls forward the original scheme

**Task:** A-310 (TASKS/AUDIT-2026-09-REMEDIATION.md) · **Type:** bug fix (frontend) · **No backend change, no ADR** (the fix uses the existing A-189 mechanism).

## Defect

With the backend's `FORCE_HTTPS=true` (every Helm values file, compose prod/staging overlays), the backend's `forceHttps` (`backend/src/routes/internal/health.route.js:182`) 301s every request that is not `req.secure` and carries no `X-Forwarded-Proto: https`. The dedicated Next route handlers `app/api/v1/auth/{login,refresh,sso-session}/route.ts` (and `logout`, `logout-all`, not listed in the finding but the same shape) called the backend over plain HTTP without that header: 301 → `https://backend:3000` → fetch TLS failure → browser 500. The catch-all proxy already forwarded it (A-189, `lib/forwardedOrigin.ts`) and was not affected.

## Fix

- `frontend/src/lib/backendHeaders.ts` — `backendForwardHeaders(req)` = `clientIpHeader` (A-16) + `forwardedOriginHeaders(req.headers, req.nextUrl.protocol)` (A-189). One function for every route handler.
- Used by login, refresh, sso-session, logout, logout-all (the last two now take the `NextRequest`).
- `lib/content.api.ts` (cached public content, no incoming request) sends `configuredForwardedProto()` — the scheme of `NEXT_PUBLIC_SITE_URL`, `http` when unset.

**Why the frontend and not a backend exemption:** the header describes the ORIGINAL request, so a genuinely plain-HTTP browser request is still redirected; a backend rule "do not redirect internal calls" would need the backend to tell internal from external by address. Trust: nginx overwrites `X-Forwarded-Proto` with `$scheme` (`deploy/compose/nginx/default.conf:88`) and the frontend publishes no port — the same deployment property A-16 rests on.

## Evidence

- `frontend/src/lib/__tests__/backendHeaders.a310.test.ts` — 8 tests: each of the five routes, behind a mock backend that 301s without `X-Forwarded-Proto: https`, forwards `https` and the client address; plain `http` stays `http`; a nonsense upstream value falls back to Next's own scheme; the configured-scheme fallback.
- **Fail-before:** with `...backendForwardHeaders(req)` removed from the login route, "login sends X-Forwarded-Proto: https and is not redirected" fails (1 failed, 7 skipped); restored, 8/8 pass.
- `src/app/api/v1` + `src/lib` suites: 249 tests, all pass after updating `logout/route.test.ts` and `logout-all/route.test.ts` to pass a request.
- `npm run typecheck` clean; `npx eslint` on the changed files clean.

## VM deploy

`deploy/compose/docker-compose.vm.yml:36` sets `FORCE_HTTPS: "false"`: the VM was **not** affected. Prod/staging compose overlays and Helm were.

## Open

The kind cluster re-run with `FORCE_HTTPS: "true"` (P7-06) has not been done; the fix is proven against a mock, not a cluster.
