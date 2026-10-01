# 2026-09-30 — Phase 10 frontend as built (index)

**Cards:** P10-00, P10-01, P10-02, P10-03, P10-04 (frontend), P10-06, P10-08, P10-09, P10-10 (button), P10-11, P10-15 (page); A-310 · **ADR:** ADR-098 and its **Amendment 1** (eleven as-built departures, each with its bad implication) · **Coordinated with:** the backend lane (a925164fe93fffd8b, ADR-108), the security agent (a3efccc11dfc4ac2e, ADR-100: verify token, A-288 location retry), the bootstrap agent (a9c19561bfcb97f1f, P10-16 first-password step).

| Card | Record | Status |
|---|---|---|
| P10-00 | [fabricated proof removed](./2026-09-30-P10-00-fabricated-proof-removed.md) | DONE |
| P10-01 | [tokens, fonts, motif](./2026-09-30-P10-01-public-tokens-fonts-motif.md) | DONE |
| P10-02 | [ID/EN](./2026-09-30-P10-02-id-en-language.md) | DONE |
| P10-03 | [landing](./2026-09-30-P10-03-landing.md) | DONE in code; release items open |
| P10-04 / P10-10 button | [sign-in](./2026-09-30-P10-04-sign-in.md) | DONE in code; IN REVIEW until the live E2E |
| P10-06 | [request access](./2026-09-30-P10-06-request-access-page.md) | DONE in code; **privacy notice blocks release** |
| P10-08 | [verification](./2026-09-30-P10-08-verify-restyle.md) | DONE in code |
| P10-09 | [forgot/reset](./2026-09-30-P10-09-forgot-reset.md) | DONE in code |
| P10-11 | [copy guard](./2026-09-30-P10-11-copy-guard.md) | DONE |
| P10-15 page | [invitation](./2026-09-30-P10-15-invitation-page.md) | DONE in code; IN REVIEW until the live E2E |
| A-310 | [forwarded proto](./2026-09-30-a310-forwarded-proto.md) | DONE in code; kind re-run open |

## Gates (2026-09-30, named)

- `npm run typecheck` (frontend, TypeScript 7): **no error in any Phase 10 file**. (Earlier in the day two errors existed in `dashboard/calibration` — another agent's in-flight work — and are gone at the last run.)
- `npx eslint` on every file this work touched: **0 errors, 0 warnings**.
- Jest, full frontend run: **281 of 284 suites, 2,956 of 2,980 tests** passed. The three failing suites are not this work's: `components/ui/a11y.adr090.test.tsx › TenantCard …` (the tenants page changed under another agent; the sign-in test in the same file passes), `app/dashboard/users/__tests__/page.test.tsx` (passes alone — load-dependent timing), and `app/blog/__tests__/publicContent.test.tsx` — **mine, fixed** (A-310 added `X-Forwarded-Proto` to the content fetch; the expectation now includes it; 16/16).
- Phase 10 test files (all TypeScript): `app/__tests__/landing.p1003`, `app/login/__tests__/loginFlow.p1004` (19), `app/request-access/__tests__/requestAccess.p1006` (8), `app/forgot-password/__tests__/forgotPassword.p1009` (7), `app/invitation/__tests__/invitation.p1015` (3), `i18n/__tests__/i18n.p1002` (9), `tests/public/publicTokens.contrast.p1001` (14), `tests/public/copyTruthfulness.p1011` (74), `lib/__tests__/passkey.p1010` (3), `app/api/v1/auth/passkey/verify/route.p1010` (3), `lib/__tests__/backendHeaders.a310` (8); backend `src/tests/routes/sendOtp.neutral.p1009.test.ts` (1).
- `npx next build`: green, 84 pages (after the contracts module-format fix by another agent).
- Browser (headless Chrome 154 + axe-core 4.13, WCAG 2.1 A/AA, dev build, a disposable local stack): `/`, `/login`, `/request-access`, `/forgot-password`, `/invitation`, `/verify/<valid, token>`, `/verify/<not found>` at **320, 768, 1280, 1920** — no horizontal overflow (after one fix on verify), exactly one `<h1>` and one `<main>`, `lang="id"`, **axe 0 violations** at 320 and 1280, **0 CSP console violations, 0 third-party requests**. Screenshots in `docs/UI-UX/research/screens/p10-*.webp`.
- **Lighthouse 12, mobile, simulated, production build, 2026-09-30** (three runs; one for request-access):

| Page | Performance | A11y | BP | SEO | LCP (median) | CLS | First-load JS |
|---|---|---|---|---|---|---|---|
| `/` | 79 / 83 / 75 | 100 | 100 | 100 | 4.3 s | 0 | 176.3 KB |
| `/login` | 85 / 85 / 91 | 100 | 100 | 100 | 2.7 s | 0.009 | 193.3 KB |
| `/verify/<not found>` | 78 / 73 / 75 | 100 | 100 | 63 (the intended `noindex`) | 3.9 s | 0 | 186.8 KB |
| `/request-access` | 79 | 100 | 100 | 100 | 3.6 s | 0 | 189.3 KB |

  **AC-5 (Performance ≥ 90 on `/`, ≥ 95 on `/login` and `/verify`) and AC-6 (LCP) are not met; AC-7 is met on `/` (≤ 180 KB) and not on `/verify` (≤ 120 KB).** Accessibility is 100 everywhere, CLS ≈ 0, the hero image is 15 KB as served. The simulated LCP is dominated by *render delay* — the main-thread cost of the shared JavaScript every page loads (react-dom, the Next runtime, and the root layout's providers with axios and the auth store). The host was running ~20 other agents' stacks: identical runs differed 2.7× in TBT and the observed unthrottled FCP ranged 0.36–3.0 s. P10-13 re-measures on a quiet machine or the VM; the next reduction is structural (the root layout's client providers load on public pages that do not need them) and is recorded, not done.

## Not done here (P10-13 and the owner)

Live E2E for every flow; a keyboard walk and an NVDA walk recorded; the release checklist (doc 20 §14): counsel review, the privacy notice, the contact values, the legal entity, the working decisions Q-39 … Q-47; ~~blog and news on the new header and footer~~ (done 2026-09-30, [P10-perf-blog](./2026-09-30-P10-perf-blog.md)); conditional-UI passkeys; the VM deploy (the main session's closing step).

**Follow-up (2026-09-30):** the structural reduction named above (the root layout's providers) is done — [2026-09-30-P10-perf-blog.md](./2026-09-30-P10-perf-blog.md), ADR-098 Amendment 2.
