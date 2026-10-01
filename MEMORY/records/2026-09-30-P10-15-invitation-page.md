# 2026-09-30 — P10-15 (frontend): the invitation page

**Card:** P10-15, page half (the endpoint is the backend lane's, ADR-108) · **Status:** DONE in code; IN REVIEW until the P10-13 live E2E

## Built

- `app/invitation/page.tsx` (server, `AuthShell`, `robots: noindex`, `referrer: no-referrer`) and `components/InvitationForm.tsx`: reads `?token=` once, then removes it from the address bar with `history.replaceState` (and the page sends no Referer), so the token stays out of history and third-party logs.
- One `<h1>` (*Buat kata sandi Anda*), `new-password` with the rule shown before typing, a show-password toggle, a confirmation with `aria-invalid` on mismatch; submit disabled until the rule and the confirmation hold. `POST /api/v1/auth/invitation/accept {token, password}` → `/login?status=invited` (a `role="status"` notice). The backend's one generic 400 for a bad, used or expired token → *Tautan undangan ini sudah tidak berlaku…* and no form; a 400 with field details → the rule; no token at all → the same "no longer valid" sentence.

## Evidence

- `frontend/src/app/invitation/__tests__/invitation.p1015.test.tsx` — 3 tests: the token is stripped from the URL, `new-password` + `aria-describedby`, submit disabled until valid, axe clean, the exact body posted, redirect with the notice; the generic 400 → the expired sentence and no form; no token → the same.
- Browser, dev build: `/invitation?token=x` at 320–1920 px, axe 0 at 320 and 1280.
