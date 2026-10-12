# P22-10c3: the `/field` browser suite on a disposable stack (14/14, twice), the real-device runbook, and what the suite found

**Date:** 2026-10-12 · **Task:** P22-10c3 (closes P22-10 in code; the real-phone run stays open) · **Specs:** [`P19-08`](../specs/P19-08-offline-field-capture.md) § 16.3, § 16.5; ADR-127 + Am. 1 – 6 (Am. 6 is this card's; Am. 5 is the backend line's idempotency fix) · **Base:** `de2e938` (the stack), then `360cd0d` (the tree)

## Built

| What | Where |
|---|---|
| **The browser suite** | `automate/field.browser.mts` (puppeteer-core, axe-core, the E2E harness; type-checked by `automate/tsconfig.json`; added to `make test-browser`). Setup through the API as the operator, with synthetic data: a client facility, a device type with a published checklist, two devices with QR codes, and two TECHNICIAN accounts in the operator's tenant whose one-time passwords are replaced. Then 13 browser checks (below). |
| **The real-device runbook** | [`TASKS/RUNBOOK-FIELD-REAL-DEVICE.md`](../../TASKS/RUNBOOK-FIELD-REAL-DEVICE.md): § 16.5's ten steps for one Android phone and one iPhone, what to record, and what the automated suites already prove. **OPEN: the owner runs it; an agent cannot hold a phone.** |
| Rooms per facility | `fieldApi.rooms(facilityId)` sends `kind=room&clientFacilityId=` (the filter the backend added in `ecfe7c7`). Rooms are stored per facility; the store reads every downloaded facility's rooms. Supersedes ADR-127 Am. 3 § 6. |
| "To sign" = unsigned | `fieldApi.submitted` sends `unsigned=true` (the filter the backend added in `360cd0d`). Supersedes the gap in Am. 4 § 3. |

## The suite's checks (run 2026-10-12, twice back to back: **14 passed, 0 failed** each)

Production-mode compose stack built from a worktree at `de2e938` plus this card's frontend files, on 127.0.0.1:27330–27332, project `cf-field-c3`.

1. Setup (API).
2. Technician A signs in; `/field` opens on Settings (offline mode is opt-in).
3. **Sizes before the download** (the count is shown first), then the download → Home.
4. The worker is registered with scope `/field`; after a reload it controls the page.
5. **Caches:** 30 entries, 28 static, the `/field` shell, **0 `/api` URLs** (FT-84).
6. **Offline** (CDP): `/field` reloads from the worker with **0 CSP violations**, and the header says offline.
7. Offline: a typed QR finds the device; an IPM is answered (every item), completed and submitted to the outbox.
8. Offline: a NEW device is registered and its IPM started; the outbox says it waits for the registration.
9. **Online, Sync now:** on the server, **2 sessions submitted with `capturedOffline` true**, and the facility holds **3 devices** (the new one registered once).
10. Sign-out: with a capture pending, *Turn off offline mode* is refused with its count.
11. – 12. **axe WCAG 2.1 A/AA: 0** on home, scan, outbox, sign, settings and register, in light and in dark.
13. No horizontal scroll at 360×640, 390×844 and 768×1024 (15 screen × width pairs).
14. **AM-23:** technician B signs in on the same profile; `/field` says another user's offline data is here; the field flag is kept.

Not in this suite, proven elsewhere and named: the administrator wipe and the scope-fingerprint purge (`FieldApp.test.tsx`, `fieldStore.test.ts` over the real store); the 72-hour and server-clock purges (`runtime.test.ts`, the engine's tests); the camera, HEIC, installation and a killed app (the real-device runbook).

## What the suite found (each fixed here, or reported)

| Finding | Action |
|---|---|
| **Backend: a 400 on a request carrying an `Idempotency-Key` crashes the API.** A refused `POST /ipm/sessions/:id/submit` was answered, then `idempotency.middleware` answered again (`ERR_HTTP_HEADERS_SENT`). The unhandled rejection shut the process down, twice in one run. | **Reported to the coordinator**; the backend line fixed it the same day (ADR-127 Am. 5, `idempotency.doubleWrite.test.ts`). |
| The field review allowed a submit the server refuses: `assertComplete` also needs the inspection result, the maintenance result and the recommendation. | `CaptureScreen` lists the missing header fields and keeps Submit off until they are set (`field.capture.headerMissing`); `FieldApp.test.tsx` asserts it. |
| A reconnection during a cycle started offline was lost. The cycle's verify waited out the client's 35 s timeout; the `online` trigger found the store "syncing" and was dropped; when the stale cycle ended, the app was marked offline again. | `transport.verify` is bounded at 10 s (`VERIFY_TIMEOUT_MS`). A trigger that arrives during a cycle runs one more cycle after it (`fieldStore` test). "Sync now" stays enabled offline: `navigator.onLine` is only a hint. |
| CDP's offline emulation changes `navigator.onLine` but fires no `online` event. | The suite dispatches it, as a phone's radio would (commented). |
| The base set of the standard is in every published checklist (15 required items), and a draft cannot make them optional. | The suite answers every item generically (`answerAll`); this is the checklist's behaviour, not a defect. |
| `/users/create` by the super admin without a `tenantId` makes a user who can sign in but gets 401 "Invalid session" on every request. | The suite passes the operator's tenant. **Reported** (lower priority). |

## Gates (2026-10-12; per-card rule)

| Gate | Result |
|---|---|
| frontend `npm run typecheck`; `automate` tsc | 0 errors; 0 errors |
| `npx eslint` on every changed file | 0 errors, 0 warnings |
| `npx jest --ci --findRelatedTests <changed sources>` | 63 suites, **609 tests passed** |
| `npx jest --ci src/tests src/field` | **492 tests passed** |
| `node ../node_modules/next/dist/bin/next build`; `bundle-budget.mjs` | OK; 15/15 within (`/field` 158.5 / 163 brotli) |
| `node scripts/build-sw.mjs --check` | current (`daf93407b2bb`) |
| **`automate/field.browser.mts`** on the disposable stack | **14 / 14, twice** |

The stack was removed with `down -v --rmi all` (project `cf-field-c3`): its containers, its volumes, the two `callibrator/*:cfc3` images, and the public base images it had pulled (rabbitmq, mailpit, among others). Those can be pulled again; no image in use by another container was removed. The worktree was removed too.

## Not done / open

- **The real-device run** (`TASKS/RUNBOOK-FIELD-REAL-DEVICE.md`). By § 16.5, P22-10 is DONE only after it passes on both phones.
- The `unsigned=true` query is unit-tested against the contract, but it was not in the image the suite ran on: the backend's filter landed after `de2e938`. The per-facility rooms read WAS live: the backend filter `ecfe7c7` came before `de2e938`, and the download passed.
- Still not built (ADR-127 Am. 4): the offline report preview, the `X-Field-Worker: disable` kill switch.
