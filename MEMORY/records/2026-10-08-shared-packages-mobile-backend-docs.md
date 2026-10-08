# Shared packages, the backend for mobile (Node and Go) and the mobile plan, Phases 35 … 40 — documented as target; ADR-134

**Date:** 2026-10-08 · **Tasks:** BACKLOG D-11 (owner brainstorm and decisions of 2026-10-08) · **Decision:** ADR-134 (Accepted as the plan, not built) · **Base commit:** `9e4663b` (working tree, not committed) · **Kind:** documentation only. No code, configuration, build, test or migration was written or run; nothing was staged or committed. Three other agents were active in the same tree (the mobile-app documentation agent, and two agents executing Phases 12 … 31); every shared board was re-read immediately before its edit and only this change's rows were touched.

## What was asked

From the owner's decisions of 2026-10-08 (React Native with Expo + EAS beside the PWA; share logic + design tokens only; same monorepo, `apps/mobile` + `packages/*`; push, biometrics, camera/QR, background sync; password + MFA, hospital SSO, passkeys; Node variant before Phase 999, Go variant after): write `docs/SHARED/` (target), the backend-for-mobile documents in two variants (`docs/MOBILE/20` Node, `21` Go), the Node-variant phase files, the ADR, and the boards. Two further owner decisions arrived mid-task through the coordinator and were applied: **tenant setup before sign-in** (org code, setup link/QR, MDM pre-fill, email-domain fallback; a public lookup by code; one tenant per install), and **a backend-agnostic API contract first** (Phases 32 … 34 reserved for it, ADR-136 by the other agent; the mobile plan renumbered to Phases 35 … 40 as **one** plan; only the backend for mobile keeps a Go variant; the contract-first `contracts/` folder becomes the source the API client is generated from).

## Outputs

| File | What |
|---|---|
| `docs/SHARED/00-README.md` … `08-ICONS.md`, `90-CONVENTIONS.md` | index; architecture (graph, rules, ports, versioning, build, web migration path, what ADR-089 parts are superseded, why the Go era changes nothing for clients, risks); tokens; api-client; i18n; domain; sync-engine; headless hooks; icons; conventions |
| `docs/MOBILE/20-BACKEND-FOR-MOBILE-NODE.md` | native ingress, tenant setup (§ 2a), install sessions, reuse detection, native sign-in routes, SSO app-link exchange, native passkeys + association files, 426 floor + contract snapshots, attestation (§ 9a), push registry and fan-out, mobile configuration, budgets, stable error codes (§ 13a), tests, threats |
| `docs/MOBILE/21-BACKEND-FOR-MOBILE-GO.md` | the same capabilities in the Go engine: preconditions from Phase 999, capability map, middleware order, differences and risks (refresh concurrency, encrypted columns, Redis keys, semver, WebAuthn libraries, SAML), coexistence, proof |
| `TASKS/PHASE-35-SHARED-PACKAGES.md` (index of the group) · `PHASE-36-MOBILE-BACKEND-NODE.md` · `PHASE-37-MOBILE-APP-FOUNDATION.md` · `PHASE-38-MOBILE-FIELD-CAPTURE.md` · `PHASE-39-MOBILE-ROLES-TABLET-NATIVE.md` · `PHASE-40-MOBILE-RELEASE.md` | 55 cards, all BLOCKED (prerequisite: Phase 34, the contract group) |
| `MEMORY/DECISIONS.md` | ADR-134 (inserted before ADR-135) |
| Banners | `docs/ARCHITECTURE/11`, `12`, `docs/FRONTEND/12`, `13` — superseded in part by ADR-134 |
| Boards | `TASKS/README.md` (six rows), `TASKS/PROGRESS.md` (Phases 35 … 40 section), `docs/README.md` (SHARED category), `docs/PLAN/16` (dependency line), `TASKS/BACKLOG.md` (D-11, Q-48 note, Q-58 … Q-61) |

## Decisions (agent, under the owner's delegation — the owner may revise; ADR-134)

- **`packages/*`, not a root `shared/`;** Q-48's Phase 999 move superseded; no shared UI; no per-backend frontend adapter (one generated client, engine chosen by `baseUrl`).
- **The backend imports `@callibrator/contracts` only;** server-enforced pure rules stay there (`normaliseQrCode`, due derivations, …); `domain` holds client-side rules that compose them.
- **Tokens:** TypeScript source + own generator over Style Dictionary; tenant OKLCH ramp with an ADR-090 guard and copper fallback; tones never tenant-coloured.
- **i18n:** `{name}` + plural subset, not full ICU (the 148.7/150 KB public bundle).
- **Hooks on TanStack Query** with tenant-prefixed keys and a memory-only cache; the web adopts it screen by screen.
- **Lucide** as the one glyph set through a semantic map.
- **The PWA's sync engine becomes the shared engine** behind ports; P19-08's numbers are floors.
- **The API client is generated from the contract-first `contracts/`** (ADR-136), with stable error codes.
- **Backend:** native ingress `/native/api/` (cookies stripped, browser requests refused); install sessions with families; reuse detection with a defined 5-second same-install race (`REFRESH_RACE`); 30-day absolute native lifetime; biometrics as an app lock only; app↔backend PKCE for SSO with an app-link return; `WEBAUTHN_NATIVE_ORIGINS`; association files served by the **backend** (the edge routes `/.well-known/` there — `vm-http.conf`, Helm `ingress.yaml`, `backend/index.ts`); per-tenant push registry and an outbox to FCM/APNs with `{n, c}` payloads; 426 `APP_UPDATE_REQUIRED` and oldest-supported contract snapshots; attestation refusing offline mode only; `x-facility-accessible` per operation.
- **Tenant setup:** `GET /public/tenants/by-code/:code` (closed field list, uniform 404, enumeration budget, ETag, `UNIQUE (lower(code))`); **`tenants.code` mandatory for mobile by a settings gate** (409 `TENANT_CODE_REQUIRED`), not a `NOT NULL` migration; sign-in scoped by `X-Tenant-Code` with the generic 401; `auth.middleware.ts` unchanged.

## Found while documenting

- **The edge routes `/.well-known/` to the backend**, not to Next (as built: `deploy/compose/nginx/vm-http.conf`, `deploy/helm/callibrator/templates/ingress.yaml`, `backend/index.ts`). `docs/MOBILE/05` § 5 first said "frontend"; its author corrected it after `20` § 8.3.
- **Today's refresh has no reuse detection** and each rotation creates a new `sessions` row with no family (`auth.service.ts#refreshUserToken`).
- **`tenants.code` is nullable with a case-sensitive unique** (`tenant.model.ts`); `GET /api/v1/tenants/public` takes only a UUID (`tenant.controller.ts#getPublicBranding`; mounted at `/api/v1/tenants` in `backend/index.ts`) — corrected in audit round 1.
- **ADR-089's `shared/` plan, ADR-127's "no native app" and Q-48's working decision** all conflicted with the owner's 2026-10-08 decisions; recorded by ADR-134 (and ADR-135 for ADR-127).
- **The dashboard is English-only** (ADR-098 § 4), so the status labels gain Indonesian keys the web will read in English until the owner decides the dashboard's language.

## Not determined (stated, not rounded up)

- Whether React Native's `fetch` sends `Origin`/`Sec-Fetch-Mode` (the native-ingress browser refusal depends on it — proved in P36-01, dropped if wrong).
- Zod 4 and the `Intl` APIs on Hermes (proved in P37-01).
- Whether `go-webauthn` accepts `android:apk-key-hash:` origins as configured (P1000+ Go variant).
- How `backend/openapi.json` and the Zod schemas relate to the root `contracts/` — ADR-136's decision, not this record's.

## Owner questions

Q-58 (ingress path vs host), Q-59 (native absolute lifetime), Q-60 (reuse detection for web), Q-61 (reserve the npm scope) in `TASKS/BACKLOG.md`; Q-M1 … Q-M6 in ADR-135.

## Owner answers (2026-10-08, later the same day)

Q-58: the `/native/` path prefix. Q-59: 30 days absolute; a tenant may shorten it. Q-60: refresh-reuse detection on mobile only for now; web revisited together with a cross-tab refresh lock. Q-61: reserve the `@callibrator` npm scope — an owner to-do (create the free npm organisation). Recorded in `TASKS/BACKLOG.md` (rows marked decided; the to-do under Owner-Supplied Values), ADR-134, `docs/MOBILE/20` §§ 3, 5, `21` § 2, `docs/SHARED/01` § 7, Phase 35 § 3 and P35-01, P36-01, P36-03. A planning note was added to P22-10 (`TASKS/PHASE-22-UPSTREAM-FRONTEND.md`): build the PWA sync engine behind the port boundary of `docs/SHARED/06` § 11 so P35-07 is a move; nothing else on the card changed.

## Audit round 1 (2026-10-08, later) — findings fixed in this change's files

Each finding was checked against the code before the edit:
- Owner decisions recorded: **(A)** work-email fallback `POST /public/tenants/discover` (`{ code }` for a `tenant_settings.sso_email_domains` claim, generic 404 otherwise, never starts SSO; the larger ADR-098 residual) — verified that `services/loginDiscovery.service.ts` answers `{ next }` and starts the web OIDC flow with a cookie; **(B)** the SSO callback per platform (`20` § 7.1), decided after a device spike before P36-05; **(C)** super admins refused at native token issuance, and the native ingress moves `X-Tenant-Code` into `X-Callibrator-Tenant-Hint` and strips `X-Tenant-Code`/`X-Tenant-Id` — verified `auth.middleware.ts` honours those headers for super admins.
- 1: App Attest = app integrity only; Play Integrity carries `MEETS_DEVICE_INTEGRITY`; iOS jailbreak = advisory heuristic; residual recorded (`20` § 9a, ADR-134, P36-09).
- 2: `allowCredentials` stays empty (verified in `authPublic.route.ts`); tenant enforced at verify (`20` § 2a.4, P36-12).
- 3: the path is `GET /api/v1/tenants/public` (verified in `backend/index.ts` and `tenant.controller.ts`: UUID from `x-tenant-id`, `?tenantId` or params; active tenants only).
- 4: `20` § 2a.1's field names declared authoritative.
- 5: app-log intake `POST /mobile/logs` (`20` § 11a, `21`, new card **P36-14**).
- 6: by-code budget split into a strict 404-only budget and a loose all-requests budget.
- 7: client handling of `REFRESH_RACE` and of `SESSION_EXPIRED_ABSOLUTE` (re-sign-in prompt, outbox kept) in `20` § 5, `../SHARED/03` § 6.2, ADR-134.
- 8: `21` states the Go engine must serve AASA, `assetlinks.json` and the ACME static at `/.well-known/` (verified `backend/index.ts`, `vm-http.conf`).
- 9: logos — PNG, JPEG, GIF, WebP allowed, SVG refused (verified `utils/upload.util.ts`); a GIF renders its first frame.
- 10: jsPDF under Hermes added as an open feasibility item (`../SHARED/01` § 3, `05` § 7a, P37-01).
Phase 36 now has 14 cards; the group total is 56.

## Evidence

No test was run; none is claimed. Every "as built" statement in the documents names its file, read on 2026-10-08.
