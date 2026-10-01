# 2026-09-30 — P10-02: Indonesian by default, English by a toggle

**Card:** P10-02 · **ADR:** ADR-098 §4, Amendment 1 rows 8–9 · **Status:** DONE

## Built

- `frontend/src/i18n/messages/id.ts` (the source; exports `Messages`) and `en.ts` (typed `Messages`): a missing or extra English key is a compile error. About 300 flat keys: `pub.*`, `landing.*`, `auth.*`, `access.*`, `invite.*`, `reset.*`, `verify.*`.
- `i18n/config.ts` (locales, cookie `locale`, `resolveLocale`, `htmlLangFor`), `format.ts`, `index.ts` (`getMessages`, `createTranslator`, `pickMessages`), `server.ts` (`getLocale` from the cookie — default `id`, no Accept-Language), `actions.ts` (the `setLocale` Server Action: HttpOnly, SameSite=Lax, Secure in production, Path=/, one year; an unknown value stores `id`), `MessagesProvider.tsx`, `apiErrors.ts` (backend status/code → dictionary key: the backend's English is never shown on a public page).
- `components/public/LanguageForm.tsx`: a `<form>` posting to the Server Action; two submit buttons named in their own language with `lang`; `aria-current` and a visually hidden "(current language)" on the current one; works with JavaScript disabled; no inline script. The name is on a `group`, not the form (a named form is a landmark; two toggles on one page failed axe `landmark-unique` in the browser run, fixed).
- Root layout: `<html lang>` from the cookie; `/dashboard` stays `en` (the proxy passes the path in `x-pathname`). The dashboard is otherwise untouched.

## Evidence

- `frontend/src/i18n/__tests__/i18n.p1002.test.ts` — 9 tests: no cookie → `id` (`t("auth.login.submit") === "Masuk"`); the cookie followed and an unknown value ignored; `htmlLangFor` (`/dashboard/*` → `en`, `/dashboardx` → cookie); `setLocale` sets exactly `{httpOnly: true, sameSite: "lax", secure: false, path: "/", maxAge: 31536000}`, `secure: true` in production, `id` for `<script>`; the dictionaries have the same keys, none empty, the same placeholders; `format`; `pickMessages`.
- Live, dev server: `curl /` → `<html lang="id">` and the Indonesian `<h1>`; the browser run reported `lang="id"` on every public page.
