# 2026-10-10 — No skipped tests: the e2e runner, the live contract and the browser suites

**Owner rule (2026-10-10):** no test may be skipped. This record covers the e2e runner (`backend/jest.e2e.config.js`), the live contract smoke and the five browser suites in `automate/`. Agent A3 of 4. The live suites, the unit tool tests and the frontend are in sibling records.

## What was skipped, and what each became

| Skip | Was | Decision | Now |
|---|---|---|---|
| Mailed-secret e2e tests (4 in `p10-access-requests`, 1 in `p10-public-auth`) | `mailAvailable() ? test : test.skip` | **Mail is mandatory.** The e2e stack always runs Mailpit | A jest `globalSetup`, `src/tests/e2e/requireMailpit.ts`, refuses to start the run when `E2E_MAILPIT_URL` is unset or its `/api/v1/info` does not answer 200. It names the cause. `mailAvailable` is removed, and the five tests are plain `test` |
| `liveContract.smoke.test.js` (5 tests) | `LIVE_CONTRACT === "1" ? describe : describe.skip` inside the e2e run | **Its own runner.** It needs a NON-production, demo-seeded stack (seed-demo is refused in production, P10-16), it writes, and it can take 30 minutes | `jest.contract.config.js` + `npm run test:contract` (`--experimental-vm-modules`, for otplib) + `make test-contract`. The e2e config leaves the file out (`testPathIgnorePatterns`), and the contract runner always runs it. The `describe` is unconditional |
| p10 in-browser SSO check | `SKIP` when `P10_MOCK_IDP_HOST` was unset | **Always runs, and asserts the right behaviour for the mode.** The mock IdP always starts (host default `host.docker.internal`). Mode: the `p10Live.ts` probe (`POST /auth/register` gives the absent-route 404 only in production), or `E2E_STACK_MODE` | **Production backend:** saving the private http IdP must answer 400 `oidc_authority must use https`, and the IdP must see 0 requests (A-176 SSRF guard). **Non-production** (`E2E_NODE_ENV=development`, `SSRF_DEV_ALLOW_HOSTS=host.docker.internal`): the full OIDC sign-in. A mismatched stack cannot pass either branch |
| p10 mail | Ran, but a missing Mailpit only failed the mail checks later | Mandatory | The run refuses to start without a reachable Mailpit |
| `A11Y_ONLY` (a11y), `P11_ONLY` (p11) | Env switches that ran a subset | Removed | Every group runs on every run. The p11 shots used to be opt-in because they wrote into `docs/`. They now always run and write to `<tmpdir>/p11-shots` unless `P11_SHOTS` is set |
| `RESPONSIVE_QR=0`, `RESPONSIVE_QR_ONLY=1`, `RESPONSIVE_MODES`, and `RESPONSIVE_PATHS` replacing the page list | Subset switches | Removed | All five modes and the QR sweep always run. `RESPONSIVE_PATHS` can only add pages |
| p11 not run by `make test-browser` | — | Added | `make test-browser` runs smoke, a11y, responsive, p10, p11 |

No assertion was weakened. Three test-side corrections came from running things that had not run for a long time:

- **Create-button matchers.** a11y and p11 now accept `tambah` (Indonesian for "add"). The device register (P22-02) opens in the default locale and says "Tambah alat"; the English-only matcher could not find it. The dialog contract the check asserts is unchanged.
- **Contract `ensureUser`.** It still used the pre-P10-16 password flow (`mustChangePassword` + `just-update-password`). It now uses `passwordChangeRequired` + `POST /auth/first-sign-in/password`, and the A-162 admin reset when an earlier run consumed the one-time password. It also reads the operator's TOTP secret from the e2e harness's state file when the harness enrolled it.
- **Contract verdict.** Two changes:
  - A route with no authenticating middleware is public. Each such route is a reviewed P6-04 exemption: the verification page, public posts and SAML metadata. A 2xx from the tenant-B admin on one of them is still probed and recorded, as `public`, but no longer counts as a cross-tenant leak.
  - `/reports/overdue-devices` and `/reports/inventory` may hold `data.rows`, by name (A-343, closed as designed). Any other `data.rows` is still flagged.

## Evidence

The stack was a disposable compose stack: `-p noskip-e2e`, `BUILD_TAG=noskip`, built from this tree, ports 127.0.0.1:27330/27331/27332, Node 26.10.0, Chrome. The env file came from `scripts/ci/e2e-env.sh`. It was torn down with `down -v --rmi all`, and no image, container, volume or network named `noskip` remains.

**Production mode** (the default):

| Suite | Result |
|---|---|
| `npm run test:e2e` | **56 suites, 433 passed, 0 skipped, 0 failed** |
| `smoke.browser.js` | 7/7 |
| `responsive.browser.js` | 45/45 page-mode pairs + 90/90 QR rows |
| `p10.browser.mts` | **13/13**, including `sso (production backend)` (400 "oidc_authority must use https"; IdP saw 0 requests) |
| `p11.browser.mts` | **103/105**. The devices dialog passes after the matcher fix. 2 fail: see "Not green" |
| `a11y.browser.js` | **79/80**. 1 fails: see "Not green" |

**Without Mailpit:** `E2E_MAILPIT_URL=` makes the run refuse to start: "Mailpit is mandatory for the e2e runner and E2E_MAILPIT_URL is not set …". An unreachable URL refuses too: "… it could not be reached (fetch failed) …; tried http://127.0.0.1:1/api/v1/info".

**Non-production** (backend and frontend recreated with `E2E_NODE_ENV=development SSRF_DEV_ALLOW_HOSTS=host.docker.internal`, before seed-demo):

- `p10.browser.mts` passed **13/13**.
- The `sso (non-production backend)` check passed: identifier-first → mock IdP → back on `/dashboard`, provisioned just in time. The IdP saw discovery 1, authorize 1, token 1 (PKCE verified) and jwks 1. The replayed callback went to `/login?error`.

**Contract** (`npm run test:contract`; fresh dev-mode stack, `SEED_DEMO=true`, seeding + seed-demo):

- **553 routes, 27 frontend calls. 3 passed, 2 failed, 0 skipped.**
- Passed: cross-tenant 2xx 0 (3 public routes reported, not counted), frontend missing 0, frontend shape 0.
- Failed: see "Not green".
- Running p10 after seed-demo fails its verify check, because the demo approval workflow intercepts direct approval (409). This is the known rule that the smoke and p10 run on a stack **without** seed-demo, so the contract runs after them.

**Static checks:**

- No conditional skip remains in my files: `grep` for `.skip`, `xit`, `SKIP`, `mailAvailable`, `_ONLY`, `RESPONSIVE_QR`, `RESPONSIVE_MODES` finds none in the e2e tree, `automate/` or the two configs. `noSkippedTests.guard` scans `backend/src` and `automate`.
- `npx eslint` is clean on every changed backend file.
- `tsc -p automate/tsconfig.json` passes with 0 errors, and `node --check` passes on the `.js` suites.
- `npm run ratchet`: 695, at the floor.
- The backend typecheck has no error in these files. The 11 it reports are in sibling agents' in-flight live tests.

## Not green: real defects, found by running, not fixed here (out of this scope)

1. **a11y, `reflow at 200% zoom /dashboard/devices`:** the page is 836 px wide in a 683 px viewport (frontend; the P22-02 device register).
2. **p11, `axe [light|dark 360] /dashboard/calibration`:** color-contrast. `td:nth-child(5) > .text-xs` measures 2.32:1 light and 1.84:1 dark on a red background at 360 px (frontend).
3. **Contract, `POST /api/v1/roles/menus`:** 500 "Cannot read properties of undefined (reading 'trim')". An input-validation gap (backend).
4. **Contract envelope, 46 routes:**
   - 32 without a `data` key, among them 403s from `GET /sessions`, `/webhooks` and `/api-keys`, and the tenant backups routes;
   - 7 without a string `message`, the `/roles` family;
   - `data.results` on `GET /search`, `POST /ipm/sessions` and `/discard`;
   - `data.items` on `POST /ipm/templates/:id/versions`;
   - raw `{count, rows}` on `GET /finance/reports/depreciation`;
   - `success: true` on a 404 at `GET /oidc/authorize/request/:requestId`;
   - `POST /billing/webhook` outside the envelope.

These accumulated while the contract smoke was skipped by default. That is the cost of a skip the owner's rule names.

## CI (not changed here: ci.yml belongs to agent A2)

- The `browser-a11y` job already sets `E2E_MAILPIT_URL` and runs the e2e overlay. It is unaffected, except that a11y now always runs every group, as it did by default before.
- The e2e runner (`npm run test:e2e`) and the contract runner are **not in CI** (A-19). To add them, see the report to the coordinator.

## Files

- `backend/jest.e2e.config.js`
- `backend/jest.contract.config.js` (new)
- `backend/package.json` (`test:contract`)
- `backend/src/tests/e2e/requireMailpit.ts` (new)
- `backend/src/tests/e2e/p10Live.ts`
- `backend/src/tests/e2e/modules/p10-access-requests.e2e.test.ts`
- `backend/src/tests/e2e/modules/p10-public-auth.e2e.test.ts`
- `backend/src/tests/e2e/liveContract.smoke.test.js`
- `automate/a11y.browser.js`
- `automate/p10.browser.mts`
- `automate/p11.browser.mts`
- `automate/responsive.browser.js`
- `Makefile` (`test-e2e` help, `test-contract`, `test-browser`)
- `docs/ENGINEERING/10-TOOLING-LINT-FORMAT.md` (two command rows)
