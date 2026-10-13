# The SSO refusal-timing test runs entirely on the fake clock (A-292, second repair)

**Date:** 2026-10-13 · **Card:** line A card 3 · **ADR:** none (test only; ADR-100's floor is unchanged) · **Status:** DONE.

## What was still real-time

The 2026-10-10 repair ([record](./2026-10-10-a292-sso-timing-flake.md)) put the two handler comparisons on jest's fake clock. Three `withSsoRefusalFloor` cases still ran on the real clock:

- a real 400 ms wait (the default floor);
- a real 600 ms wait (`startSsoFor`);
- an **upper bound of 300 ms** on three settled promises.

Under heavy parallel load these failed or timed out (2026-10-13, a369 record). There was no database, bcrypt or network involved: the controller's dependencies are doubles. Only the clock was real.

## The change

`backend/src/tests/controllers/sso.refusalTiming.a292.test.ts`: the three cases now run on the fake clock, with the same claims made exact. The header records why.

- **No delay for a success or another error:** no timer is scheduled (`jest.getTimerCount() === 0`) and the clock does not move. The old "< 300 ms" claim is now exact.
- **Default floor:** the refusal has not settled at 399 virtual ms and has settled at 400, with `SSO_UNAVAILABLE`.
- **`startSsoFor`:** has not settled at the floor − 1 and has settled at the floor.

Nothing in the file waits in real time. The longest test now takes 38 ms; it took 603 ms before.

## Proof it still catches the defect (mutation, reverted)

- A floor one ms short (`floor - 1 - elapsed`) fails 4 of 7 tests: both handler cases, the default floor and `startSsoFor`.
- Delaying every error, not just the refusal, fails "does not delay …".
- `sso.controller.ts` was restored byte-for-byte; `git status` shows it clean.

## Tests (named)

- `controllers/sso.refusalTiming.a292`: 7/7 alone.
- Under load: 7/7 six times in a row while `src/tests/services` and `src/tests/controllers` ran in parallel.
- Gates: `npm run typecheck` 0 errors; ESLint ratchet 0, baseline 0; `npx eslint` on the file clean. No source file changed.

## Files

- `backend/src/tests/controllers/sso.refusalTiming.a292.test.ts`
- `MEMORY/records/2026-10-13-a292-sso-timing-fake-clock.md`, `MEMORY/MEMORY-INDEX.md`, `MEMORY/CHANGELOG.md`
