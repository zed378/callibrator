# 2026-09-27 — Frontend board: F-05, F-07, F-09, F-10, F-11, F-12, F-13, F-14, F-16 (agent "fe2")

**Decision:** ADR-074. **Board:** `TASKS/AUDIT-2026-09-FRONTEND.md`.

The owner committed this agent's work in progress as part of `a31c601`, before it was verified. The
changes after that commit are the overlay dialogs' test, the docs, ADR-074 and this record. Everything
below was verified against the tree at `c905e74` plus those changes.

## Fail-before method

`git worktree add <scratchpad>/fe2/wt f0d7f08` checked out the tree **before** any of this work. Each
new test was copied into the worktree and run there. The worktree was removed afterwards, and its
`node_modules` junctions were deleted as links, never recursively. Backend tests ran through the npm
scripts.

## Per card

| Card | Changed | Tests (fail-before at `f0d7f08`) |
|---|---|---|
| F-09 | `lib/sameOrigin.ts`; `auth/sso-session/route.ts` refuses non-same-origin with 403 | `sso-session/route.test.ts` › *F-09 valid*, *F-09 forged*, *F-09 replayed* (pass before: A-60 had already fixed the verification), *F-09 cross-origin* ×2, *F-09 missing origin* (**3 fail before**), *behind nginx the Origin is compared with the Host* |
| F-11 | `toSameOriginApiPath` in `lib/uploadUrl.ts`; `verify/[certificateNumber]/page.tsx` | `verify/.../__tests__/page.f11.test.tsx` (**3 of 3 fail before**: the old href was `http://localhost:5000/api/v1/...`); `uploadUrl.test.ts` › *toSameOriginApiPath (F-11)* |
| F-13 | `meteredBilling.controller.js` sends `success(res, rows, meta, …)`; `meteredBilling.service.ts` reads `data` + top-level `meta` | backend `src/tests/routes/envelope.f13.test.js`, which drives the real routers, controllers, service and `response.util` (**2 of 3 fail before**, both on metered billing; sessions was already fixed by A-111); `meteredBilling.controller.test.js` (mocks corrected to the real service shape); frontend `meteredBilling.service.test.ts` |
| F-14 | `PROXY_UPSTREAM_TIMEOUT_MS` (32 s); the proxy aborts on the timer or on browser disconnect and answers 504; `requestTimeout.middleware.js` sits before `errorHandler` in `index.js`; `ErrorState` 504 | `route.stream.f16.test.ts` › *F-14: past its budget…504*, *F-14: when the browser goes away…* (**both fail before**); backend `src/tests/middlewares/requestTimeout.f14.test.js` (at `f0d7f08` the same stack, with the old handler verbatim, answered **503** `"Response timeout"`: scratch reproduction); `ErrorState.f07.test.tsx` › *F-14: the proxy's 504…* |
| F-16 | proxy streams both bodies; drops hop-by-hop headers; forwards a caller's `Authorization` only without a cookie | `route.stream.f16.test.ts`, against a real HTTP backend on an ephemeral port, 9 tests (**6 fail before**: upload streaming, download streaming, JSON download not parsed, hop-by-hop, the two F-14 tests). A-71 (`route.tokenStrip.a71`) and A-69 (`route.redirect.a69`) still pass; their stubs are now real `Response`s |
| F-12 | `DateField`, `MultiSelect`, `SearchableDropdown`, `Badge`; 10 overlays gain `role="dialog"` + `useModalA11y`; labels in `PostEditor` and `CardModal` | `components/ui/a11y.f12b.test.tsx` (**8 of 9 fail before**; `DateField` inside a `FormField` already passed); `components/ui/a11y.f12.overlays.test.tsx` (**4 of 4 fail before**, including the source ratchet) |
| F-05, F-07, F-10 | no code change | the manual checks, done headless (below) |

## Headless browser run (the cards' manual checks)

**What was run.** `next build --webpack` of a copy of `frontend/`, with
`NEXT_PUBLIC_API_BASE_URL=http://backend.invalid:5999`, which is unreachable. Turbopack refuses a
junctioned `node_modules` outside the project root. `next start` ran with
`BACKEND_INTERNAL_URL` pointing at a **stand-in backend**: `scratchpad/fe2/stub-backend.js`, which
answers the house envelope and sends `X-Request-Id`. Headless Chrome 154 drove it through
`puppeteer-core` (`scratchpad/fe2/verify.js`). **This is not the real backend.** It proves the
frontend's behaviour, not the backend contract.

- **F-05.** The access token expired under an open session-management page (15 s token life). The
  next filter keystroke caused exactly one `POST /api/v1/auth/refresh`, both in the browser and at the
  backend. The URL did not change, the typed filter `10.0.0.9` was kept, and the table reloaded. With
  a revoked refresh token, the browser landed on `/login?callbackUrl=…` once, went back to
  `/dashboard` zero times, and was left with **no** cookies.
- **F-07.** Session management showed one screen per status, each with its `Reference: <X-Request-Id>`:
  - 403: "Access restricted" plus the backend's reason;
  - 404: "Not found…";
  - 408: "The request timed out", with Retry;
  - 409: "This action is not possible right now" plus the backend's state explanation;
  - 429: "Too many requests", with Retry;
  - offline (`setOfflineMode`, then Retry): "You appear to be offline".

  Screenshots: `scratchpad/fe2/shots/f07-*.png`. `AccessDeniedModal` (a 403 on a **mutation**) was
  not driven in the browser; it is covered by `DashboardLayout.f07`.
- **F-10.** A role whose menu held none of the searchable paths had no search box, and sent 0
  `/search` requests from the browser (0 at the backend). A role with Devices had the box, and typing
  `ab` sent one request.
- **F-11.** `/verify/CERT-1`: the link and the frame were
  `/api/v1/certificates/verify/CERT-1/document?token=…`, the PDF loaded 200 `application/pdf` through
  the proxy, there were **0** requests to `backend.invalid`, and there were no CSP or page errors.
- **F-14.** A backend that never answers: the page showed "The request timed out — The server did not
  respond in time" at 33.0 s, and the stand-in saw the upstream connection closed at 32.0 s.
- **F-16.** The Next process's working set, from 112 MB at idle, peaked at **186 MB** during a 400 MB
  download (419,430,400 bytes received) and **185 MB** during a 300 MB upload (314,572,800 bytes
  received by the backend). Buffered, each transfer would have been held whole.

## Suites

- **Frontend, `npm test` (jest `--coverage`) on `c905e74` plus the changes:** 155 suites, 1,383 tests,
  all passing. Coverage 43.38 / 38.03 / 36.84 / 43.64, over the 41 / 35 / 34 / 41 gate. The gate
  was not raised, because `jest.config.js` was being edited by the hygiene agent at the time.
- **Frontend gates:** `npm run typecheck` (TypeScript 7) exit 0. `npx eslint` on every changed file
  gives 0 errors (the warnings are pre-existing unused variables). `npx next build` exit 0, and it
  lists the Proxy. Bare `npx tsc` no longer resolves under the TypeScript 6 compatibility package
  (ADR-076), and that is the hygiene agent's area.
- **Backend, `npm run test:coverage` on Node 26:** 655 suites, 12,893 tests. **18 failures in 8
  suites, none of them in this work**: webhook ×3, `nodeVersion.a257`, migration `0028`,
  `rawSqlTenantPredicate.d05`, `auth.service`, `user.passwordReset.a162`. Branches were at 99.93% in
  `webhook.controller`, `webhook.service` and `auth.middleware`, all in other agents' areas at the
  time. `requestTimeout.middleware.js`, `meteredBilling.controller.js` and `session.controller.js`
  are at 100% on all four measures. This is **not** a green gate run.

## Found along the way

- **The frontend test gate was broken at `a31c601`.** `package.json` dropped `ts-jest` while
  `jest.config.js` still named it, so `npm test` failed with "Module ts-jest … was not found". The
  hygiene agent restored it while this work was running (ADR-076).
- **Before this change every backend request timeout answered 503, not 408.** See ADR-074 §4.

## Still open

- **The screen-reader walk (F-12).** It was not done. axe runs in jsdom only; the browser suite does
  not run it.
- **A run against the real backend on a live stack (all cards).** Only the stand-in was used.
  **F-05** was not run with `JWT_ACCESS_EXPIRED=60s` against the real backend. **F-11** was not run
  on the VM deployment.
- **The 408 through the real `index.js`.** `requestTimeout.f14` rebuilds `index.js`'s order and does
  not boot `index.js` itself.
