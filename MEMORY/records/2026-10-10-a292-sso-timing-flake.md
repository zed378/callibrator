# A-292: the SSO refusal-timing test made deterministic (CI flake on `d0fea5c`)

**Date:** 2026-10-10 · **Task:** CI repair (A-292's proof, no code change) · **Base commit:** `d0fea5c` · **Resumed:** started by a halted agent; its edit was complete and is kept as written

## The failure

CI on `d0fea5c` was red on one test: `backend/src/tests/controllers/sso.refusalTiming.a292.test.ts:114` expected the gap between an unknown tenant code and a known code without SSO to be **< 150 ms** and measured **340 ms** on a loaded runner. The test compared wall-clock medians of three runs within a tolerance: on a busy machine the scheduler, not the controller, decides the number. The controller (`withSsoRefusalFloor`, `sso.controller.ts`) was unchanged.

## The fix — stronger, not looser

The two refusal paths now run on jest's **fake clock** (modern timers fake `Date.now` and `setTimeout` alike), so the measure is the controller's own arithmetic:

- **The equality case** (`POST /sso/login`, `POST /sso/oidc/login`): one virtual millisecond before the floor (`FLOOR_MS - 1` = 599 ms) **neither** path has answered; after the timers run, both answered **at exactly 600 ms with 404**. The old claim was "within 150 ms of each other, both ≥ floor − 5"; the new one is "the same instant, never before the floor" — no tolerance at all.
- **The control** (floor `0`, the behaviour before A-292): the unknown code answers at 0 ms, the known one at exactly `SETTINGS_MS` (250 ms) — proving the measurement still sees the oracle the floor removes.
- **Kept on the REAL clock**: the three `withSsoRefusalFloor` cases (no delay for a success or another error; the 400 ms default; `startSsoFor` floored). They assert lower bounds (≥ floor − 5) except "does not delay", which allows half the floor (300 ms) for a call that does no I/O.

The tolerance was not raised; the floor assertion is kept (exact, on the fake clock; ≥ on the real one).

## Evidence — tests named

- `backend/src/tests/controllers/sso.refusalTiming.a292.test.ts` — 7 passed (`npm test -- src/tests/controllers/sso.refusalTiming.a292.test.ts`, 12 s), and in the full coverage run of 2026-10-10 (1,017 suites passed, 0 failed; see the P21-07 record).

## Not done

- Not re-run on GitHub yet (the coordinator's commit will).
