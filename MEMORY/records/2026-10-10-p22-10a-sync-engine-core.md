# P22-10a: the offline sync engine's core, behind its ports

**Date:** 2026-10-10 · **Task:** P22-10a (Phase 22; F-78, F-79). P22-10 is split into a / b / c (below). · **Specs:** [`P19-08`](../specs/P19-08-offline-field-capture.md) § 9 – § 11; `docs/SHARED/06-SYNC-ENGINE.md` § 3 – § 11; ADR-127 + Am. 1; ADR-134 § A.11 · **Base:** after `b5b97e2`

> This part is frontend only and contains no page: no route, no worker, no IndexedDB yet. Nothing runs in the app until P22-10c wires the engine to the `/field` screens.

## The split (P22-10 was too large for one gated card)

| Part | Scope |
|---|---|
| **P22-10a** (this one) | The engine core in `frontend/src/field/engine/`, behind the ports of `06` § 4: the model, planner, freezing, runner, classification, purge rules, one-field-user registry rules and config. Tested with in-memory adapters. |
| P22-10b | The web platform layer in `frontend/src/field/platform/`: the encrypted IndexedDB store (AES-GCM, non-extractable key, AAD per slot) and the registry; `public/sw.js` (generated, scoped to `/field`) and its registration; the manifest; CSP `worker-src` / `manifest-src`; `camera=(self)` on `/field`; `proxy.ts` protecting `/field`; the guards (route namespace, no tenant data in the shell). |
| P22-10c | The `/field` app: the screens (settings / prepare, scan, device, capture over the engine, outbox / attention, sign), the working-set download, the purge triggers wired in, the profile guard, the administrator wipe, the browser suites, and the real-device script. The real-device run itself is the owner's (P19-08 § 16.5). |

## Built

| File | What |
|---|---|
| `model.ts` | Capture states (`editing` → `submitted_local` → `syncing` → `synced`, or `attention` / `discarded_local`); the capture with its `clientRef`, `dependsOn`, `capturedOffline` and `clientCapturedAt`; `Confirmed` (id, revision, header, the results' canonical text, submitted, discarded); the frozen request; the op; the answer. |
| `config.ts` | P19-08's numbers as defaults: 72 h, 2 captures in parallel, 2 s × 2ⁿ backoff up to 5 min with ± 20 % jitter, a 60 s offline window, a 2 s edit debounce. **Any looser value is refused at construction.** `backoffMs` also honours `Retry-After` when the server asks for longer. |
| `planner.ts` | Plans the ONE next request from the local capture diffed against what the server confirmed, in this order: create (with `clientRef` and the offline claim; blocked while a registration it depends on has not synced) → `PATCH` of the changed header fields with the revision → `PUT` of the WHOLE result set with the revision → one upload per photo, **never after a submit** → submit. A device registration is: create, then its photos. A discard is sent to the server only for a draft the server holds. **Freezing:** a fresh UUID v4 key, the exact body text and a request digest, written before the first attempt. Also provides `canonicalJson` (key-order-free identity of the results). |
| `classify.ts` | Maps every answer to an outcome: 2xx → success; network, timeout, 5xx, 408, 429 and 409 `IDEMPOTENCY_IN_FLIGHT` → retry the same frozen op; 409 `IDEMPOTENCY_KEY_REUSED` → re-plan once; 403 with a scope-loss code → purge; anything else → attention. |
| `purge.ts` | The purge rules as data: the device clock (72 h, or a clock that ran backwards); the server clock (AM-24); scope-loss codes (not `FACILITY_ROUTE_REFUSED`); a changed fingerprint (AM-26); sign-out refused while the outbox is not empty. **The outbox is never touched by a purge.** |
| `registry.ts` | AM-23. Enabling offline mode is refused while another user's row holds an outbox or a working set; that user's empty rows are removed silently. When another user signs in, the previous user's working sets are purged without opening them, and their pending count is kept as a number only. |
| `engine.ts` | The capture lifecycle (create / edit / photo / submit / discard / resolve attention), with an online-only edit debounce. A **cycle** runs verify (fingerprint purge) → clock purge → captures, with one capture's ops strictly in order and up to 2 captures at once. An op left `in_flight` by a crash is re-sent unchanged. A success records what was confirmed. A retry waits with backoff. A reused key re-plans once and then raises attention. A scope loss purges, keeps the op frozen and stops the cycle. An attention stops only that capture. Resolutions: `retry`, `edit`, `keep_mine` (re-read the revision and re-send the whole state), `use_server_draft` (adopt the `draftId`), `discard`. Also: status and subscribe, `onSessionEnded` / `onScopeLost`, `checkClock`, and `signOut`. |
| `ports.ts` | `CaptureStore`, `Transport` (send exactly / read / verify; `SessionEnded`), `Clock`, `Random`, `Network`, `Scheduler`, `EngineLog`. The log carries no tenant data. |
| `testing/memory.ts` | In-memory adapters and a **fake server** that enforces the rules the engine relies on: `clientRef` replay, `Idempotency-Key` replay (same body → stored answer; different body → 409 `KEY_REUSED`), revision conflicts, no photo after submit, and injected failures. |

## Evidence — tests named

- `field/engine/__tests__/rules.test.ts` (13): config defaults, each looser value refused, and the backoff; the purge rules row by row; the registry; classification; the planner's order and its stops; freezing, the digest, `canonicalJson` and UUID v4.
- `field/engine/__tests__/engine.test.ts` (19): an offline capture syncing once online with each request sent once and the server holding exactly the local capture; a 5xx then no answer, re-sending the same key and bytes after the backoff; a crash with an op in flight, re-sent unchanged after restart with no duplicate; an edit during a pending op getting a new key, and a store crash mid-plan losing nothing; revision conflict → keep mine; draft exists → use the server draft; a refused submit → edit; key reused → re-plan once, then attention; a scope loss purging while the outbox is kept and the cycle stops; session ended at verify and on send; a changed fingerprint and the server clock; a registration with a dependent IPM; two captures in parallel, each in order; discards; lifecycle refusals; sign-out; the debounce; the offline claim; no re-entrant cycles.
- **Property test:** 40 seeded random sequences of edits, photos, failures and outages. In every one, **no frozen key is ever sent with two bodies**, **no upload follows a submit**, and the server ends **equal to the local capture** (results, header, photo count; submitted).
- `field/engine/__tests__/portBoundary.guard.test.ts` (17): no platform global and no app import in any engine source; the only allowed package import is `@callibrator/contracts` (ADR-134 § A.11).

## Gates (2026-10-10; per-card rule)

| Gate | Result |
|---|---|
| frontend `npm run typecheck` | 0 errors |
| `npx eslint src/field` | 0 errors, 0 warnings |
| `npx jest --ci src/field/engine` (the related tests: all new) | **3 suites, 49 tests passed**. Coverage of the engine: 99.13 / 94.06 / 98.71 / 99.71 (`engine.ts` 98.65 / 90.65; `testing/memory.ts` 93.95 / 82.35) |
| `next build`, bundle budget | not run: no page, route or dependency changed (per-card rule) |

## Not done / open

- P22-10b and P22-10c, as above.
- **The working-set download plan** (`06` § 6: sizes first, the cap, paging, `If-None-Match`, rollback of a partial download) moves to P22-10c, where it is used together with the transport adapter.
- The engine sends no `X-Field-Client` header; that belongs to the transport adapter (P22-10b).
