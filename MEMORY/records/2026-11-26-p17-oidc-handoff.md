# 2026-11-26 — PT-21 real OIDC controller handoff and pending-user refusal

Status: focused implementation and verification in the working tree; P17 exit remains open.
Spec refs: `docs/SECURITY/15-FASKES-SCOPE-THREAT-MODEL.md` §12 PT-21,
ADR-124 AM-15; prior protocol evidence: `2026-11-25-p17-oidc-wire.md`.

Extended `backend/src/tests/services/ssoJit.facility.p1707.live.test.ts`'s
existing real synthetic IdP case with an ephemeral HTTP Express harness mounting
the actual `sso.controller` login/callback/exchange functions and `auth.middleware`.
The IdP enforces PKCE and serves RSA-signed tokens/JWKS over real local HTTP.
Tenant settings, JIT identity, session and audit rows persist through the real
models/services on a freshly migrated PostgreSQL database as `callibrator_app`.
No transport, identity verification, controller, session, auth or database mocks.

The added assertions prove:

- Login sets an HttpOnly, SameSite=Lax browser-binding cookie with the documented
  `/api/v1/auth/sso/oidc` path.
- A callback without that cookie redirects to `sso_state` before the IdP token
  exchange. Retrying the consumed state with the genuine cookie is also refused.
- A legitimate callback exchanges the code and redirects to `/sso-callback`
  carrying only a fresh handoff code, without an access token in the URL.
- One exchange creates the session and exactly one LOGIN audit; replay returns401.
- The resulting pending-facility user's actual bearer request to the protected
  harness endpoint returns403 with `FACILITY_BINDING_PENDING`; it never reaches
  the protected handler. This complements the existing administrator-confirmation
  and audit-failure rollback tests in the suite.

Verification: `npm --prefix backend run test:live -- --only=p1707jit` through the
existing disposable local PostgreSQL helper passed **4/4**, no failures/skips,
Jest150.755s, runner179s, exit0. Backend `npm run typecheck` passed exit0.
The suite's existing fourth test contains both wire and controller assertions.
Focused `npx eslint src/tests/services/ssoJit.facility.p1707.live.test.ts` from
`backend/` passed exit0, no issues. An unused fourth error-middleware argument
was corrected afterward to forward errors when headers are already sent;
Express requires four arguments to recognize error middleware. The exercised
response path is unchanged. No application behavior changed.

Limits: test-mode HTTP loopback uses the documented SSRF development allow-list.
Redis was unavailable, so the real controller's process-memory single-use fallback
was exercised; this is not evidence of multi-replica Redis behavior. The harness
forwards the cookie explicitly and checks its attributes; browser automatic cookie
selection, the Next frontend session-cookie bridge, production Secure cookies and
a public HTTPS organisation IdP remain unproved. The harness mounts controllers
directly, so this is not evidence for full application route/middleware wiring.
No production change, signature, phase completion, merge or physical-device claim.
