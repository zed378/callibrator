# 2026-09-30 — P10-06: the request-access page replaces /register

**Card:** P10-06 · **ADR:** ADR-098 §6, Amendment 1 row 6 · **Backend:** P10-05 (ADR-108) · **Status:** DONE in code — **release blocker: the privacy notice (Q-42)**

## Built

- `app/request-access/page.tsx` (server; `AuthShell` wide; `access.*` strings only) and `components/RequestAccessForm.tsx`: the fields of doc 20 §8.1 with `autocomplete` (`organization`, `address-level2`, `name`, `organization-title`, `email`, `tel`), a facility-type radio group, a device-count band `<select>`, needs ≤ 2,000; the consent checkbox **unticked**; the honeypot `website` off-screen, `tabindex="-1"`, `autocomplete="off"`, inside an `aria-hidden` wrapper.
- Client validation mirrors the backend schema (lengths, email, WhatsApp normalised `0…`/`62…` → `+62…` then E.164), a `role="alert"` summary that takes focus and links each field, a field error under each control. Body: the contract confirmed with the backend lane (`consentVersion: "2026-09-29"`, `locale`, `website`).
- Answers: the neutral 202 → a success state that **replaces the form**, has its own `<h1>` (focused), sits in `role="status"`, promises no response time; 400 with `errors[]`/`details[]` → those fields flagged; **400 without details (production strips them, `response.util`) → "check the form"**; 429 → minutes from `retryAfter`/`Retry-After`; network → retry message. The backend's English is never shown.
- `/register` → **308** to `/request-access` (`next.config.ts#redirects`); `app/register/` (page, components, `useRegisterForm` and its test) deleted — the frontend no longer calls `POST /auth/register`; `components/auth/AuthBrandingPanel.tsx` and `AuthBackground.tsx` deleted (claims, now unused). The proxy treats `/request-access` and `/forgot-password` as auth routes (a signed-in user goes to the dashboard). `docs/FRONTEND/01-ROUTING.md` updated (ADR-098); stale `.next/types` and `.next/dev/types` removed so `npm run typecheck` does not reference the deleted page.

## Evidence

- `frontend/src/app/request-access/__tests__/requestAccess.p1006.test.tsx` — 8 tests: autocomplete tokens, unticked consent, the honeypot unreachable (tabindex −1, inside `aria-hidden`, not a named textbox), one `<h1>`, axe clean; an empty submit lists every missing field in an alert and sends nothing; a valid submit posts exactly the contract body and never `/auth/register`, the success heading is focused inside `role="status"`, axe clean; 429 (`retryAfter` 1800 → "30 minutes"), network and 500 show dictionary sentences, never "Backend English"; a 400 naming `workEmail` flags that field; WhatsApp normalisation.
- Browser, dev build: `/request-access` at 320–1920 px, no overflow, axe 0 at 320 and 1280. Screenshots `docs/UI-UX/research/screens/p10-request-access-{320,1280}.webp`.

## Open

- **The privacy notice does not exist (Q-42).** The consent text names it without a link. The page is linked from the landing (doc 20 §6.1 requires a way forward) — so the notice must exist before the public deployment. Amendment 1 row 6 records the conflict between §6.1 and this card.
- The submit → queue → approve → invitation → sign-in live E2E (P10-13). The super-admin queue (`/dashboard/access-requests`, P10-07) was built by the backend lane in the dashboard's own style, as P10-07 requires.
