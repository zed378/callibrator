# Phase 10 — Landing, Sign-in, Request Access and Verification Revamp

**Status:** 🟡 planned 2026-09-29, **runs now, in parallel with finishing Phase 9.** · **Decision:** ADR-098 · **Design spec:** [`../docs/UI-UX/20-LANDING-AUTH-REVAMP.md`](../docs/UI-UX/20-LANDING-AUTH-REVAMP.md) · **Owner brief (binding):** [`../docs/UI-UX/research/00-owner-brief-landing-auth.md`](../docs/UI-UX/research/00-owner-brief-landing-auth.md)

Phase 10 is **frontend-focused**. Its backend pieces (P10-04's discovery endpoint, P10-05, P10-09's neutral OTP answer, P10-10, P10-12) are written in **TypeScript** under the Phase 9 rules (ADR-087: a new `.js` file fails `npm run ratchet`; do not half-convert an existing `.js` file you edit). It does not wait for Phase 9 and must not disturb it: no Phase 10 card converts a module.

**Process:** the owner brief's row "Hi-fi HTML mockups first → owner approval → implementation" was **superseded by the owner on 2026-09-29**: execution starts once these documents are ready, with no separate mockup gate (ADR-098 §7). The owner reviews on the running build.

**Order:** P10-00 first and alone — it removes live fabricated proof and is the smallest change. Then P10-01 and P10-02 (foundations), then the pages. P10-11 lands before P10-03 merges so the landing is born guarded. P10-14 (certificate enumeration) must be DONE before the landing's certificate-lookup field ships.

**Evidence base:** research 04 (market, legal practice) and research 05 (the as-built code audit, file by file). Where they differ on what the code does, 05 wins.

**Overlap with ADR-100 (a security agent, in progress on 2026-09-29):** request budgets for the public auth and verification endpoints (`middlewares/requestBudget.middleware.ts`: A-291, and the budget parts of A-292 and A-293) and configured email-link origins (`utils/publicLinkOrigin.util.ts`: A-289). Phase 10 cards **consume** that work (surface `Retry-After`, verify the origin) and do not rebuild it. Read ADR-100's record before starting P10-04, P10-09 or P10-12.

**Working decisions (ADR-098 §8, Q-39 … Q-47):** the coordinating session set answers to the follow-up questions on 2026-09-29, reporting that the owner delegated them. They are recorded as **awaiting the owner's confirmation**, and the cards below are written on them: public name **Device Calibrator**; accreditation named generically (Kemenkes standards), never SNARS; `POST /auth/register` disabled in production behind a flag; an **invitation link** for the first administrator; a user-verifying passkey counts as MFA; rejected or expired requests kept 12 months; certificate verification through a random QR token with a minimal verdict for typed numbers (being built by a security agent); contact channels from configuration, hidden when empty; no pricing, no trial.

| Card | Title | Status | Depends on |
|---|---|---|---|
| P10-00 | Remove fabricated proof from the live pages | **DONE** 2026-09-30 ([record](../MEMORY/records/2026-09-30-P10-00-fabricated-proof-removed.md)) | — |
| P10-01 | Public tokens, fonts and the precision motif | **DONE** 2026-09-30 ([record](../MEMORY/records/2026-09-30-P10-01-public-tokens-fonts-motif.md)) | P10-00 |
| P10-02 | ID/EN language: dictionaries, cookie, toggle | **DONE** 2026-09-30 ([record](../MEMORY/records/2026-09-30-P10-02-id-en-language.md)) | P10-00 |
| P10-03 | Landing page | **DONE in code** 2026-09-30 — release items open: lookup field waits for P10-14, `auditRows` withheld, Lighthouse AC-5/6 not met on a loaded host ([record](../MEMORY/records/2026-09-30-P10-03-landing.md), ADR-098 Amendment 1) | P10-01, P10-02, P10-11 |
| P10-04 | Sign-in: autocomplete, forgot link, identifier-first SSO | **DONE in code** 2026-09-30, page ([record](../MEMORY/records/2026-09-30-P10-04-sign-in.md)) and **backend built 2026-09-30** (`/auth/login/discover`, `/auth/sso/start`, SSO domain claim; [record](../MEMORY/records/2026-09-30-p10-backend-access-requests-passkey.md), ADR-108) | P10-01, P10-02 |
| P10-05 | Request-access backend | **IN REVIEW** 2026-09-30: built, unit + PostgreSQL 18 tested; live E2E outstanding ([record](../MEMORY/records/2026-09-30-p10-backend-access-requests-passkey.md), ADR-108) | — |
| P10-06 | Request-access page (replaces `/register`) | **DONE in code** 2026-09-30 — **privacy notice (Q-42) blocks release**; live E2E open ([record](../MEMORY/records/2026-09-30-P10-06-request-access-page.md)) | P10-01, P10-02, P10-05 |
| P10-07 | Super-admin access-request queue | **IN REVIEW** 2026-09-30: API + `/dashboard/access-requests` page built; live E2E outstanding ([record](../MEMORY/records/2026-09-30-p10-backend-access-requests-passkey.md), ADR-108) | P10-05 |
| P10-08 | Verification page restyle | **DONE in code** 2026-09-30 ([record](../MEMORY/records/2026-09-30-P10-08-verify-restyle.md)) | P10-01, P10-02 |
| P10-09 | Forgot and reset password | **DONE in code** 2026-09-30; live E2E open ([record](../MEMORY/records/2026-09-30-P10-09-forgot-reset.md)) | P10-01, P10-02 |
| P10-10 | Passwordless passkey sign-in | **IN REVIEW** 2026-09-30: backend built and tested with real signed assertions; the sign-in button is wired (2026-09-30, [record](../MEMORY/records/2026-09-30-P10-04-sign-in.md)); the virtual-authenticator E2E outstanding ([record](../MEMORY/records/2026-09-30-p10-backend-access-requests-passkey.md), ADR-108) | P10-04 |
| P10-11 | Copy-truthfulness guard test | **DONE** 2026-09-30 ([record](../MEMORY/records/2026-09-30-P10-11-copy-guard.md)) | P10-00 |
| P10-12 | Registration endpoint: production flag, neutral answers, configured activation origin | **IN REVIEW** 2026-09-30: flag and neutral answer built ([record](../MEMORY/records/2026-09-30-p10-backend-access-requests-passkey.md), ADR-108) | — |
| P10-13 | Accessibility, performance and live E2E verification | **IN PROGRESS** — performance part done 2026-09-30 (AC-7 met, CI budget check, blog/news restyled; [record](../MEMORY/records/2026-09-30-P10-perf-blog.md), ADR-098 Am. 2); live E2E, walks, checklist open | P10-03, P10-04, P10-06, P10-07, P10-08, P10-09 |
| P10-14 | Certificate-verification enumeration (tracks the security agent's change) | **IN REVIEW** — A-293 is DONE in the working tree (2026-09-29, ADR-100 §1), not yet committed; the owner's confirmation of Q-47 is owed | — |
| P10-15 | Invitation acceptance: set-password page and endpoint | **IN REVIEW** 2026-09-30: endpoint built; `/invitation` page built 2026-09-30 ([record](../MEMORY/records/2026-09-30-P10-15-invitation-page.md)); live E2E outstanding ([record](../MEMORY/records/2026-09-30-p10-backend-access-requests-passkey.md), ADR-108) | P10-05 |
| P10-16 | First super admin: one-time bootstrap password, revealed only inside the container | **DONE in code 2026-09-29** — live check open | — |

---

### P10-00 — Remove fabricated proof from the live pages

| | |
|---|---|
| **Status** | **DONE** 2026-09-30 ([record](../MEMORY/records/2026-09-30-P10-00-fabricated-proof-removed.md)) |
| **Depends on** | — |
| **Spec refs** | docs/UI-UX/20-LANDING-AUTH-REVAMP.md §6.9, §12 · docs/UI-UX/research/04-competitor-landing-and-auth.md §4.2 (C1–C4, C7–C9, C11–C14), §6.1.1 |
| **Spec required** | no |

**Why:** The public page shows fictional testimonials with randomuser.me faces, a marquee of invented hospitals, unsourced numbers ("12,000+", "40% less audit time", "99.2% on schedule"), and ISO 17025 / HIPAA / KARS / SNARS / SOC 2 badge chips. `frontend/src/data/landing.ts` itself calls them placeholders and `public/marketing/CREDITS.md` calls the people fictional. They are live. This is a deletion, not a design task, and it goes first because it carries legal risk today (UU 8/1999 Pasal 9 and 17; research 04 §4.1).

**Definition of Done**
- [ ] Removed from rendering and from `data/landing.ts`: `heroStats`, `accreditations`, `testimonials`, `partners`, `pricingTiers`; the hero pill with the pulsing dot; `HeroChips` numbers; the four-avatar trust cluster; `TrustSection`, `TestimonialsSection`, `PricingSection` from `app/page.tsx`
- [ ] `public/marketing/avatar-1.jpg` … `avatar-4.jpg` deleted; `CREDITS.md` updated
- [ ] `AuthBrandingPanel.tsx`: "HIPAA-ready access controls" and "ISO 17025-aligned workflows" removed; "compliant" as an outcome removed
- [ ] Every "Start free trial" (hero, CTA section, `app/blog/[slug]/page.tsx:100`) replaced by *Sign in* or removed; the login link "Create a tenant workspace" (`app/login/page.tsx:177`) and the register tagline "compliant from day one" removed
- [ ] The `Marquee` is no longer rendered anywhere public (WCAG 2.2.2)
- [ ] Also removed (research 05): "Audit prep: Days → minutes" (C9); "14-day free trial · No credit card required · Cancel anytime" (R1, X4); "Most popular" (R3); nav "Get Started" → `/login` (G3); `platform-dashboard.jpg` shown as the product under `app.hdc.health` (P1); `feature-monitoring.jpg`, a patient monitor (F9); the SSO placeholder "e.g. hca-group", a real hospital company (A12); `SecuritySection.tsx` deleted (§3.11); the unused Next starter SVGs in `public/` deleted
- [ ] Footer links with `href="#"` removed (05 G6); the dead "Remember me" checkbox removed (05 A9)
- [ ] Nothing new is added: the page may look emptier; that is the point
- [ ] Existing frontend tests updated to the removal (not deleted wholesale); `pnpm lint`, `npm run typecheck`, `pnpm build` green
- [ ] Record lists every string and file removed

**Abuse cases**
- Hiding sections with CSS or a flag while the fabricated data stays in the bundle
- Replacing fictional numbers with different unsourced numbers
- Keeping "ISO 17025" as a chip "because it is only aligned"

---

### P10-01 — Public tokens, fonts and the precision motif

| | |
|---|---|
| **Status** | **DONE** 2026-09-30 ([record](../MEMORY/records/2026-09-30-P10-01-public-tokens-fonts-motif.md)) |
| **Depends on** | P10-00 |
| **Spec refs** | docs/UI-UX/20-LANDING-AUTH-REVAMP.md §4 · docs/UI-UX/08-COLOR-SYSTEM.md · docs/UI-UX/07-TYPOGRAPHY.md · ADR-090 · ADR-071 · ADR-098 §3 |
| **Spec required** | no (doc 20 §4 is the spec) |

**Why:** Every public page draws on one dark palette, one accent, two new faces and one motif. Built once, scoped so the dashboard's ADR-090 tokens do not move.

**Definition of Done**
- [ ] `--pub-*` tokens from doc 20 §4.2 under `[data-surface="public"]` in `globals.css`; dashboard tokens byte-identical
- [ ] A unit test recomputes every ratio in doc 20 §4.2 from the CSS values and fails if any drops below its stated threshold (4.5:1 text, 3:1 boundaries and focus)
- [ ] Instrument Serif and Plus Jakarta Sans via `next/font`, attached only by the public layouts; `font-synthesis: none` on the serif; Latin subset ≤ 90 KB combined
- [ ] OFL licence texts in `frontend/public/licenses/`
- [ ] The precision-scale motif as an SVG component using tokens only; the grain texture as a static file (no inline `<style>`)
- [ ] Buttons, inputs, focus ring, links, cards for the public surface, each with its reduced-motion behaviour
- [ ] Asset register rows (doc 20 §12) for everything added

**Abuse cases**
- Changing a shared token (`--accent`, `--primary`) and letting the dashboard shift
- A contrast table asserted in a document but never computed from the shipped CSS
- Loading fonts from `fonts.googleapis.com` at runtime (CSP `font-src 'self'` would block it, or someone widens the CSP)

---

### P10-02 — ID/EN language: dictionaries, cookie, toggle

| | |
|---|---|
| **Status** | **DONE** 2026-09-30 ([record](../MEMORY/records/2026-09-30-P10-02-id-en-language.md)) |
| **Depends on** | P10-00 |
| **Spec refs** | docs/UI-UX/20-LANDING-AUTH-REVAMP.md §5 · docs/UI-UX/research/02-standards-and-benchmarks.md §5 · docs/UI-UX/00-DESIGN-DIRECTION.md § Language (as amended by ADR-098 §4) · ADR-071 |
| **Spec required** | no |

**Why:** Indonesian is the default and English one click away on every public page; the frontend has no i18n library.

**Definition of Done**
- [ ] `frontend/src/i18n/messages/id.ts` (source) and `en.ts` typed `Messages`; a missing English key is a typecheck error
- [ ] Root layout reads the `locale` cookie (default `id`) and sets `<html lang>` (no longer hard-coded `"en"`)
- [ ] `setLocale` Server Action behind a `<form>`; works with JavaScript disabled; cookie `HttpOnly`, `SameSite=Lax`, `Secure` in production
- [ ] Toggle labels "Bahasa Indonesia" / "English", no flags; it has an accessible name and announces the current language
- [ ] A client-side mapper from backend status/code to dictionary strings; no raw backend English on public pages
- [ ] Dashboard untouched (Phase 11 decides its language)
- [ ] Tests: default is `id` with no cookie; the action sets the cookie; `lang` follows it

**Abuse cases**
- A client-only toggle that flashes Indonesian then English (hydration mismatch) or needs inline script
- `Accept-Language` sniffing that makes English the default for Indonesian users on English-language browsers — the owner chose Indonesian for everyone
- Keys duplicated with drifting meanings across pages

---

### P10-03 — Landing page

| | |
|---|---|
| **Status** | **DONE in code** 2026-09-30 — release items open: lookup field waits for P10-14, `auditRows` withheld, Lighthouse AC-5/6 not met on a loaded host ([record](../MEMORY/records/2026-09-30-P10-03-landing.md), ADR-098 Amendment 1) |
| **Depends on** | P10-01, P10-02, P10-11 |
| **Spec refs** | docs/UI-UX/20-LANDING-AUTH-REVAMP.md §3, §6, §11.1, §12, §13 · docs/UI-UX/14-PUBLIC-SURFACES-UX.md (as amended) · research 05 when it lands |
| **Spec required** | no (doc 20 is the spec) |

**Why:** The page that sells to hospital buyers, rebuilt dark, premium and true.

**Definition of Done**
- [ ] `app/page.tsx` is a **server component**; client islands only where needed
- [ ] Sections in doc 20 §6 order; one `<main>`, one `<h1>`
- [ ] Hero screenshot captured from a seeded demo tenant, AVIF/WebP, `priority`, captioned *Contoh data*
- [ ] WhatsApp/email CTAs read `NEXT_PUBLIC_CONTACT_WHATSAPP` / `NEXT_PUBLIC_CONTACT_EMAIL`; **a channel whose value is empty is hidden** (never a placeholder); the request-access link is always present
- [ ] Every string from the dictionaries; every claim-bearing key has its source in doc 20 §11 and passes P10-11
- [ ] Items flagged in §11 checked before shipping: the certificate number printed next to the QR, and the audit-log `REVOKE` + migration 0091 holding on the reference deployment as the application role
- [ ] Every string checked against doc 20 §11 and research 05's classification; a string 05 marked OC or OP does not ship in any form
- [ ] The verification field submits to `/verify/<number>` without JavaScript
- [ ] Reduced motion: complete static page; no animation dependency added
- [ ] GSAP, ScrollTrigger, SplitText, Lenis and Motion no longer load on `/` (05 §7.2: ~305 KiB gzip today); no text server-rendered at `opacity: 0` (05 §7.3)
- [ ] The display and body faces load with `next/font/local` from committed files
- [ ] The certificate-lookup field is present **only if P10-14 is DONE**; otherwise the section shows the QR explanation and the phone mock-up
- [ ] The page exports its own `metadata`, possible now that it is a server component; every public string, `<title>`, header, footer, auth default and blog metadata say **Device Calibrator** (Q-43), never "Callibrator" or "HDC"
- [ ] Footer carries only links with a destination; the privacy link appears once the notice exists (Q-42)

**Abuse cases**
- Re-introducing a number, a logo or a badge "temporarily" for a demo
- A screenshot from a real tenant with real device or staff names
- Naming SNARS, HIPAA or SOC 2 anywhere, including alt text and metadata
- Shipping `landing.caps.language` ("available in Indonesian and English") while the dashboard is English only

---

### P10-04 — Sign-in: autocomplete, forgot link, identifier-first SSO

| | |
|---|---|
| **Status** | **DONE in code** 2026-09-30 (page: [record](../MEMORY/records/2026-09-30-P10-04-sign-in.md); backend: ADR-108) — IN REVIEW until the P10-13 live E2E |
| **Depends on** | P10-01, P10-02 |
| **Spec refs** | docs/UI-UX/20-LANDING-AUTH-REVAMP.md §7, §11.2 · docs/UI-UX/14-PUBLIC-SURFACES-UX.md § Auth Screens · research 04 §3.1–3.3, §3.5, §6.2 · `backend/src/controllers/sso.controller.js` |
| **Spec required** | **yes** — `MEMORY/specs/P10-04-identifier-first-login.md` for the discovery endpoint and the super-admin email-domain setting (doc 20 §7.2 is the outline) |

**Why:** Sign-in fails WCAG 2.1 SC 1.3.5 (no `autocomplete` in `PasswordLoginForm.tsx`), has no forgot-password link although the backend has the routes, and asks users for a tenant code **and** a SAML/OIDC choice they cannot know (`SsoLoginForm.tsx`).

**Definition of Done**
- [ ] Split-screen layout; `<h1>` in the form at every width; panel carries no claims
- [ ] `autocomplete` on every field (`username`, `current-password`, `one-time-code`)
- [ ] *Lupa kata sandi?* → `/forgot-password`
- [ ] One identifier-first form replaces the two tabs; the user never chooses a protocol
- [ ] Backend (TypeScript): `POST /auth/login/discover` answering by email **domain** only, rate-limited (`loginDiscover`), plus a **super-admin-only** tenant setting for SSO email domains; a test proves the response is identical for an existing and a non-existent address in the same domain
- [ ] (ADR-100 already budgets the SSO start routes; no second limiter) `/login?org=<code>` deep link; organisation-code fallback through a new `POST /auth/sso/start` that picks the tenant's protocol and gives **one generic refusal** for unknown code / SSO disabled / misconfigured (**A-292**); the old `/sso/login` and `/sso/oidc/login` get the same generic answer
- [ ] "Remember me" removed; error summary `role="alert"`; MFA instruction tied by `aria-describedby`; an expired MFA token gets its own message; `/sso-callback` routes through `destinationAfterSignIn` (05 §5.1–5.3)
- [ ] Messages per doc 20 §7.4, including the 429 minutes from `retryAfter` and the distinct suspended-tenant message
- [ ] TOTP stays one pasteable field; recovery code always visible
- [ ] Tenant-pinned build shows tenant logo and name, not its colour
- [ ] Existing tests (`useLoginForm.a123`, `useLoginForm.ssoError.a188`, `MfaLoginForm.a141`) pass or are updated with the reason recorded

**Abuse cases**
- Discovery that looks the **account** up (then answers differently for unknown addresses)
- A tenant able to claim an email domain for itself (`gmail.com`, a rival hospital's domain)
- Removing the organisation-code path before every SSO tenant has a domain claim, locking them out
- A generic SSO refusal in the body but different status codes (404 vs 400) — still an oracle

---

### P10-05 — Request-access backend

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | — |
| **Spec refs** | MEMORY/specs/P10-05-request-access.md · docs/UI-UX/20-LANDING-AUTH-REVAMP.md §8 · docs/SECURITY/05-MULTI-TENANCY-SECURITY.md · ADR-098 §6 |
| **Spec required** | **yes — written:** `MEMORY/specs/P10-05-request-access.md` |

**Why:** The owner chose Request access: a public intake with honeypot and rate limit (no captcha) and a super-admin queue whose approval creates the tenant.

**Definition of Done**
- [ ] Model, migration (next free number), validator, service, controller, public route — all `.ts`; admin routes added to `admin.route.js`
- [ ] Neutral 202 for new, duplicate, over-cap and honeypot submissions — pinned by `accessRequest.neutral.p1005.test.ts`
- [ ] Row + audit in one transaction; no personal data in audit `changes`; `access-request-intake` added to `SYSTEM_ACTORS`
- [ ] Approve reuses `tenant.service.js#createTenant` with a new optional outer `{ transaction }`; existing tenant tests pass unmodified
- [ ] Approval also creates the first tenant administrator from the request's contact, **with no usable password**, and issues a single-use, time-limited **invitation** purpose token (the pattern of `generatePurposeToken` / `activationClaims`, `auth.service.js:262–265`); the invitation email is sent after commit with its link built from the configured public origin (never a request header, A-289). No temporary password (Q-45: the random one-time password is for the super-admin bootstrap only). An address that already belongs to a user → 409 with a state explanation, through the rate-limited, audited identity-conflict path (A-128)
- [ ] Retention: a pending request nobody decides becomes `expired` after 90 days; `rejected`, `spam` and `expired` rows are purged 12 months later by the existing retention job, audited; an `approved` row keeps its tenant link (Q-42)
- [ ] 404 unknown id, 409 non-pending with a state explanation, 409 on a tenant code/name clash with the request left `pending`
- [ ] Admin `:id` routes allow-listed as `platform` in `twoTenantRoutes.guard.test.ts` with a reviewed reason
- [ ] Every test named in the spec's Tests section exists and passes; mutation checks recorded
- [ ] `ACCESS_REQUEST_NOTIFY_EMAIL`, `ACCESS_REQUEST_IP_PEPPER` in `config/env.ts` and `.env.example`
- [ ] Migration verified by `\d access_requests`, not by the log
- [ ] Access-request rows reachable by the DSAR erasure search by email

**Abuse cases**
- The public endpoint answering 409 "already requested" (an oracle)
- `tenantId` read from the body, or the link column named `tenantId` so the hooks scope the table
- Approval implemented as a second tenant-creation path beside `createTenant`
- Emailing the requester at submit (the form becomes a mail cannon)

---

### P10-06 — Request-access page (replaces `/register`)

| | |
|---|---|
| **Status** | **DONE in code** 2026-09-30 — **privacy notice (Q-42) blocks release**; live E2E open ([record](../MEMORY/records/2026-09-30-P10-06-request-access-page.md)) |
| **Depends on** | P10-01, P10-02, P10-05 |
| **Spec refs** | docs/UI-UX/20-LANDING-AUTH-REVAMP.md §8, §11.2 · MEMORY/specs/P10-05-request-access.md § UI |
| **Spec required** | no |

**Why:** `/register` promises a workspace it does not create (`auth.service.js:202`); the owner chose Request access.

**Definition of Done**
- [ ] `/request-access` with the fields in doc 20 §8.1, `autocomplete` tokens, the honeypot, the unticked consent linked to the privacy notice
- [ ] `/register` → 308 to `/request-access`; every link to `/register` updated
- [ ] Success state replaces the form, takes focus, `role="status"`, has its own `<h1>`; no response time promised
- [ ] 400 → field errors; 429 → rate-limit message; network → retry
- [ ] Works at 320 px, keyboard-only, reduced motion
- [ ] `POST /auth/register` is no longer called by the frontend; the endpoint's production flag is P10-12
- [ ] The page does not go live before the privacy notice it links exists (**Q-42**); until then the route may be merged behind the absence of the landing link

**Abuse cases**
- The honeypot reachable by keyboard or announced by a screen reader (it then traps real users)
- A pre-ticked consent box

---

### P10-07 — Super-admin access-request queue

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P10-05 |
| **Spec refs** | MEMORY/specs/P10-05-request-access.md § UI · docs/UI-UX/research/02-standards-and-benchmarks.md §1.1 (worklist), §2.3 (side panel) · docs/UI-UX/10-COMPONENT-SPECIFICATION.md |
| **Spec required** | no |

**Why:** A request nobody works is worse than no form.

**Definition of Done**
- [ ] `/dashboard/admin/access-requests` worklist, tabs by status with counts, side panel, Approve and Reject forms
- [ ] Menu slug visible to `SUPERADMIN` only (`MENU_SLUGS`, `ROLE_MENU_ASSIGNMENTS`, and a migration for existing databases)
- [ ] Three list states; envelope read as rows in `data`, pagination in top-level `meta`
- [ ] 409 shown as its state explanation; the Approve form prefills the administrator from the request; *Resend invitation* for an approved request whose administrator has not accepted (audited, invalidates the old token)
- [ ] Follows the dashboard's current language and look (Phase 11 is on hold)

**Abuse cases**
- The page reachable by a tenant admin through a direct URL (the API refuses, but the page must not render data or a misleading empty list)
- Reading `data.rows` / `data.meta` (renders an empty list with no error)

---

### P10-08 — Verification page restyle

| | |
|---|---|
| **Status** | **DONE in code** 2026-09-30 ([record](../MEMORY/records/2026-09-30-P10-08-verify-restyle.md)) |
| **Depends on** | P10-01, P10-02 |
| **Spec refs** | docs/UI-UX/20-LANDING-AUTH-REVAMP.md §10 · docs/UI-UX/14-PUBLIC-SURFACES-UX.md § The Verification Page · docs/UI-UX/08-COLOR-SYSTEM.md § The Verification Page (as amended) |
| **Spec required** | no |

**Why:** The owner wants it in the new style; 14's rules for it stay in force word for word.

**Definition of Done**
- [ ] Public palette; verdict word in the display serif with icon; accent never inside the verdict card
- [ ] The six verdicts the page computes today, each with word + icon + status colour
- [ ] **Not indexed:** `robots` metadata `index: false, follow: false` and an `X-Robots-Tag: noindex` header on `/verify/*` (missing today — `robots.ts` does not cover it)
- [ ] Zero motion; ≤ 120 KB JS; LCP ≤ 1.8 s
- [ ] The "Not yet valid" branch's display of the internal status raised with the owner through the deviation protocol (not changed silently)
- [ ] Existing verify tests pass

**Abuse cases**
- "Not found" styled differently from a signature mismatch (a certificate-number oracle)
- A decorative animation "only on valid"

---

### P10-09 — Forgot and reset password

| | |
|---|---|
| **Status** | **DONE in code** 2026-09-30; live E2E open ([record](../MEMORY/records/2026-09-30-P10-09-forgot-reset.md)) |
| **Depends on** | P10-01, P10-02 |
| **Spec refs** | docs/UI-UX/20-LANDING-AUTH-REVAMP.md §9 · docs/UI-UX/14-PUBLIC-SURFACES-UX.md § Failure states · `backend/src/services/auth.service.js#requestOTP`, `#resetPassword` |
| **Spec required** | no |

**Why:** The backend has had the OTP reset flow all along; no page reaches it. And its first step answers differently for known and unknown emails.

**Definition of Done**
- [ ] `/forgot-password`: email → OTP + new password, with `autocomplete` `email`, `one-time-code`, `new-password`
- [ ] The neutral `send-otp` answer (already neutral at `auth.controller.js:135`; the service's differing internal messages never reach the wire) **pinned** by an HTTP-level test comparing a known and an unknown address
- [ ] The cap on successful OTP requests (A-291) is ADR-100's request budget; this card confirms it answers neutrally when it trips
- [ ] A resend cooldown on the page, driven by the 429's `Retry-After`
- [ ] Password helper text states the rule the backend's reset schema enforces
- [ ] 429 messages from `forgotPassword` / `resetPassword` limits
- [ ] Success returns to `/login` with a status notice

**Abuse cases**
- A cap that answers differently when it trips (a new oracle)
- A reset step that reveals whether the OTP or the email was wrong

---

### P10-10 — Passwordless passkey sign-in

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P10-04 |
| **Spec refs** | MEMORY/specs/P10-10-passkey-login.md · docs/UI-UX/20-LANDING-AUTH-REVAMP.md §7.5 · ADR-098 §5 |
| **Spec required** | **yes — written:** `MEMORY/specs/P10-10-passkey-login.md` |

**Why:** The owner wants a passkey button. Today's WebAuthn login endpoints require a session (`webauthn.route.js:13`), so a button would call nothing. **The login page shows the passkey option only once this card is DONE.**

**Definition of Done**
- [ ] `POST /auth/passkey/options` and `/auth/passkey/verify` (TypeScript, public, `authPreCheck("passkeyLogin")`)
- [ ] No `allowCredentials` before authentication; ceremony-bound single-use challenge
- [ ] One `skipTenantScope` (the credential lookup) with its reason; the same post-authentication rules as password sign-in
- [ ] Unique index on `webauthnCredentialId` with the reasoning in the migration
- [ ] Conditional UI then button on `/login`; hidden without `PublicKeyCredential`
- [ ] Every test named in the spec, including the tenant test and a virtual-authenticator live E2E
- [ ] A user-verifying passkey counts as phishing-resistant MFA and skips the TOTP step, for platform operators too (Q-46, working decision): ADR-059's super-admin MFA rule amended in the same change, with a test that a passkey sign-in by an operator with no TOTP is admitted and one without UV is refused

**Follow-up (ADR-108 Amendment 1): several passkeys per user are built.** Migration 0104 moved the legacy one-per-user passkeys into `webauthn_credentials`.
- [ ] **After the VM deploy is verified**, register `backend/src/migrations/pending/drop-legacy-user-webauthn-columns.ts`. It drops the emptied `users.webauthn_credential_id / _public_key / _sign_count` columns and 0100's inert index. Do the four steps in its header in ONE change: next free number plus manifest; remove the model attributes; remove the gdpr/user.service references; run it on production-shaped data and check `\d users`. Record: `MEMORY/records/2026-09-30-p10-backend-access-requests-passkey.md` § Migration 0104.

**Abuse cases**
- Asking for the email first and returning that user's credential ids
- A second, weaker session-issuing path instead of the shared post-authentication function

---

### P10-11 — Copy-truthfulness guard test

| | |
|---|---|
| **Status** | **DONE** 2026-09-30 ([record](../MEMORY/records/2026-09-30-P10-11-copy-guard.md)) |
| **Depends on** | P10-00 |
| **Spec refs** | docs/UI-UX/20-LANDING-AUTH-REVAMP.md §3 (principle 4), §11, §12 · research 04 §4.1 |
| **Spec required** | no |

**Why:** The fabricated proof shipped because nothing stopped it. A guard makes the rule a build failure.

**Definition of Done**
- [ ] A frontend test over **both** dictionaries and the public page sources fails on: a badge-claim term (`HIPAA`, `SOC 2`, `SNARS`, `certified`, `bersertifikat`, `terakreditasi`, `compliant` as an outcome, `100% secure`, `aman 100%`, `terbaik`, `#1`, `nomor satu`); a numeral followed by `%`, `+`, `x` or a thousands-grouped figure in marketing copy unless the key is on a reviewed allow-list with a source; a `randomuser.me`/`pravatar`/`unsplash`/`pexels` URL
- [ ] A test that every claim-bearing key in the dictionaries appears in doc 20 §11 with a non-empty source column (the doc table is parsed)
- [ ] A test that every file under `public/marketing/` and `public/brand/` has a row in doc 20 §12
- [ ] Mutation check: add "HIPAA-ready" to a string, and "12,000+" to another; the named test fails for each; recorded
- [ ] The list of terms lives in one reviewed constant with a comment per term (why it is banned)

**Abuse cases**
- A guard that iterates only the terms currently present (consistency, not correctness — CLAUDE.md § Evidence)
- Moving a claim into an image or `alt` text the scan does not read

---

### P10-12 — Registration endpoint: production flag, neutral answers, configured activation origin

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | — |
| **Spec refs** | research 04 §3.4 · research 05 §5.5 · ADR-098 §8.3 · `backend/src/controllers/auth.controller.js:87` · `backend/src/services/auth.service.js:202–285` · `backend/src/config/env.ts` · ADR-075 (a self-registered account has no tenant) |
| **Spec required** | no |

**Why (security):** three defects on one public endpoint. (1) **A-289:** the activation link's origin comes from `req.headers.origin || req.headers.host`, so a forged `Origin` puts an attacker's domain in a genuine activation email sent from our mailer. (2) **A-290:** `POST /auth/register` answers 409 "Email already registered" / "Username already used" — an account oracle. (3) Self-registration creates a tenant-less account nobody needs (ADR-075), squats an address against the global unique index, and mails any address (A-291). Request access replaces it (Q-44, working decision): the endpoint is **disabled in production behind a flag**, and neutral wherever it stays enabled.

**Definition of Done**
- [ ] `SELF_REGISTRATION_ENABLED` (name to match `config/env.ts` conventions) read through `env.ts`: **default off when `isProduction`**, on elsewhere unless set. Off → `POST /auth/register` answers **404** with the standard not-found envelope (the route behaves as absent), and no user or email is created
- [ ] Where enabled, the two 409s are replaced by one neutral answer ("If the address can be registered, an activation link has been sent"), identical for new, taken-email and taken-username cases; a taken case sends nothing
- [ ] The activation-link origin fix (A-289) is ADR-100's `publicLinkOrigin.util.ts`; this card **verifies** it with a forged-`Origin` test on the register path and does not re-implement it
- [ ] Tests: flag off in production → 404 and nothing written; flag on → the three cases answer identically. Mutation checks recorded
- [ ] `.env.example` and `docs/` (the auth API reference) updated through the ADR

**Abuse cases**
- Validating the `Origin` header against an allow-list but still using it
- A "disabled" endpoint that still creates the user and only hides the response
- Neutral bodies with different status codes or response times large enough to tell apart

---

### P10-13 — Accessibility, performance and live E2E verification

| | |
|---|---|
| **Status** | **IN PROGRESS** — performance part done 2026-09-30 ([record](../MEMORY/records/2026-09-30-P10-perf-blog.md), ADR-098 Amendment 2): the dashboard's providers moved out of the root layout, **AC-7 met** (brotli first-load `/` 123.4 KB ≤ 180, `/verify/*` 117.9 KB ≤ 120), a CI budget check (`frontend/scripts/bundle-budget.mjs`), blog and news on the public surface, axe 0 on 11 public pages × 2 widths. Lighthouse (5× median, interleaved, loaded host): `/` 75→76, `/login` 85→81, `/verify/*` 77→82, `/blog` 70→89 — **AC-5/AC-6 still not met**; re-measure on a quiet machine or the VM. Open: the live E2E, the keyboard and NVDA walks, the §14 checklist |
| **Depends on** | P10-03, P10-04, P10-06, P10-07, P10-08, P10-09 |
| **Spec refs** | docs/UI-UX/20-LANDING-AUTH-REVAMP.md §13, §14 · docs/UI-UX/17-ACCESSIBILITY.md · ADR-077 · ADR-090 |
| **Spec required** | no |

**Why:** "Renders" is not "works". The phase closes on measured evidence, named.

**Definition of Done**
- [ ] AC-1 … AC-12 of doc 20 §13, each with the tool, the build, the date and the result in the record
- [ ] Live E2E specs for sign-in (password, MFA), identifier-first SSO redirect, request access → queue → approve, forgot/reset, verify valid and not-found; the **whole** live suite green in one run
- [ ] One keyboard-only walk and one screen-reader walk (NVDA) of `/login` and `/request-access`, recorded
- [ ] The release checklist in doc 20 §14 reviewed; items that still need the owner (legal review, the privacy notice, the contact values, the legal entity, confirmation of the working decisions Q-39 … Q-47) listed as open, not ticked
- [ ] `TASKS/PROGRESS.md` Phase 10 row updated with what is verified and what is not

**Abuse cases**
- Lighthouse on the dev server, or a single lucky run quoted
- "axe clean" without naming the pages and states tested
- Ticking the counsel-review item because the copy "looks careful"

---

### P10-14 — Certificate-verification enumeration (tracks the security agent's change)

| | |
|---|---|
| **Status** | **IN REVIEW** (reconciled 2026-09-30). The security change it tracks is **A-293, DONE 2026-09-29** (ADR-100 §1; migration `0096`; record `MEMORY/records/2026-09-29-security-followups.md`): a 192-bit token in the QR, the full verdict only with it, a minimal verdict for a bare number, per-address budgets. Named tests: `routes/certificateVerify.a293.test.ts` (11 of 12 failed before), `models/certificateVerificationToken.a293.test.ts`, `services/certificateDocument.verifyToken.a293.test.ts`, `utils/certificateVerificationToken.a293.test.ts`, frontend `page.a293`. **Still owed:** the change is **uncommitted** (DONE means merged), migration `0096` is recorded as not yet run on PostgreSQL (OPEN-WORK §2), and **Q-47 awaits the owner's confirmation**. This card tracks it and gates the landing's lookup field; **it is not re-planned here** |
| **Depends on** | — |
| **Spec refs** | TASKS/AUDIT-2026-09-REMEDIATION.md A-293 · ADR-098 §8.7 (Q-47) · docs/UI-UX/research/05-landing-auth-audit.md §5.9 · docs/UI-UX/14-PUBLIC-SURFACES-UX.md § The Verification Page · docs/UI-UX/20-LANDING-AUTH-REVAMP.md §6.5, §10 |
| **Spec required** | owned by the security agent's change |

**Why:** certificate numbers are sequential and the public verify endpoint returned issued-to, device, serial and signer behind only the global limiter (A-293). The working decision (Q-47): a random verification token of at least 128 bits in the QR/verify link; a lookup **by number** returns only a minimal verdict (valid / revoked / expired, issuing tenant, dates; no serial, no signer) under a per-IP rate limit.

**Definition of Done (for Phase 10's purposes)**
- [ ] The security agent's change is merged with its own record and named tests; this card links them
- [ ] P10-08 designs both views (full via token, minimal via number) against the shipped response shapes
- [ ] P10-03's lookup field is enabled only after this card is DONE
- [ ] Doc 14 and doc 20 §6.5, §10 match what shipped (amended through that change's ADR)

**Abuse cases**
- Enabling the landing's lookup field before the minimal verdict ships
- Phase 10 re-implementing any part of it in parallel

---

### P10-15 — Invitation acceptance: set-password page and endpoint

| | |
|---|---|
| **Status** | TODO |
| **Depends on** | P10-05 |
| **Spec refs** | MEMORY/specs/P10-05-request-access.md § Approve · ADR-098 §8.4 (Q-45) · docs/UI-UX/20-LANDING-AUTH-REVAMP.md §8.2, §11.2 · research 05 §6.2 · `backend/src/services/auth.service.js` (`generatePurposeToken`, `activationClaims`) |
| **Spec required** | no (the P10-05 spec covers the token; this card is the acceptance side) |

**Why:** approval invites the first administrator by link (working decision Q-45); someone has to be able to accept it.

**Definition of Done**
- [ ] `POST /api/v1/auth/invitation/accept` (TypeScript, public, `authPreCheck`-style limiter): `{ token, password }`; verifies the single-use purpose token, sets the password against the backend's password rule, marks the email verified (the mailbox is now proven), consumes the token, writes an audit row in the same transaction; an invalid, used or expired token → one generic 400
- [ ] `/invitation?token=` page in the public style: one `<h1>`, `new-password` with the rule shown before typing, show-password toggle, success → `/login` with a status notice; the token is removed from the address bar after it is read
- [ ] Sign-in afterwards follows the tenant's MFA policy (enrolment required where the policy says so)
- [ ] A super admin can re-issue an expired invitation from the queue (P10-07), audited
- [ ] Tests: single use, expiry, wrong-purpose token refused, audit row rolled back with a failed accept

**Abuse cases**
- An invitation token accepted as an activation or MFA token (purpose not checked)
- The token left in the URL, browser history or a `Referer` header to a third party

---

### P10-16 — First super admin: one-time bootstrap password, revealed only inside the container

| | |
|---|---|
| **Status** | **DONE in code (2026-09-29)** — the live check on a compose stack is open |
| **Depends on** | — |
| **Spec refs** | MEMORY/specs/P10-16-superadmin-bootstrap-otp.md · ADR-099 · docs/SECURITY/03-AUTHENTICATION-SECURITY.md · deploy/README.md § First Boot |
| **Spec required** | **yes — written:** `MEMORY/specs/P10-16-superadmin-bootstrap-otp.md` |
| **Record** | `MEMORY/records/2026-09-29-superadmin-bootstrap-otp.md` |

**Why:** owner request (2026-09-29). The seed gave `sys@mail.com` the public password `123123`, and every re-seed reset it to that. Owner decision: the first password is random, works once, must be changed at once, and is visible **only inside the container** (a 0600 file; never stdout/stderr, an API response, the audit log, the database plaintext or the environment). Filed in Phase 10 as sign-in work.

**Definition of Done**
- [x] Created only when no super admin exists; 24-character CSPRNG password; hash only; one-time + must-change + 72 h; audit row and file write inside the creating transaction; re-seed and restart never touch an existing credential
- [x] Plaintext only in `/app/.bootstrap/superadmin-password` (0600, `app:app`, 0700 directory, not a volume); pointer line only on stdout; seed response carries the path only
- [x] First sign-in consumed atomically (conditional UPDATE + audit, one transaction); answers a `password-change` purpose token, no session; the second use is the wrong-password 401; concurrent double sign-in → exactly one token
- [x] `POST /auth/first-sign-in/password`: password rule, ≠ the one-time password, flags cleared + sessions revoked + audit in one transaction; the token refused by `auth` on every route
- [x] Recovery CLI `./backend rotate-bootstrap-password` / `npm run bootstrap:rotate` (audited, prints the path only); boot step retires the old public default
- [x] Frontend first-password step (accessible, `new-password`, non-enumerating); E2E harness and automation carry no default password
- [x] Tests named in the record; 100% on the new modules; the three reviewed lists updated
- [x] **Amendment 1 (Q-49, 2026-09-30):** every administrator-set password (user create, admin reset) is one-time; the demo seeder is refused in production. `adminTemporaryPassword.p1016.test.ts`, fail-before recorded
- [ ] **Live:** follow `deploy/README.md` § Closing deploy (U-08): image build with `/app/.bootstrap`, the binary subcommand, a first sign-in in a browser through nginx/Next, `docker logs` shows the pointer and never the value, the VM's existing operator rotated on its next deploy

**Abuse cases**
- The value printed "just once" to the console (`docker logs` keeps it)
- `/app/.bootstrap` added as a bind mount "for persistence" (puts the plaintext on the host)
- A re-seed or restart re-issuing the password of an existing super admin
- The password-change token accepted anywhere else, or reusable after the change
- An administrator's temporary password opening a session (Amendment 1), or a re-reset silently clearing the one-time flag
- Demo users (known password) seeded on a production stack
