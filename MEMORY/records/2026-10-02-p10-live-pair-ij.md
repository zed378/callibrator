# 2026-10-02 — Live E2E and every browser suite on the current tree, twice (runs I and J); seven P10 cards moved; valid-certificate captures

**Cards:** P10-13 (live acceptance), P10-05 / 07 / 09 / 10 / 12 / 15 / 16 (status), AC-4 (verification captures). **Asked by:** the main session (2026-10-02). **Standard:** ADR-077 (named runs, one uninterrupted run, twice). **Result:** **not green twice.** Both runs failed in places, and every failure is attributed below. The P10 surfaces themselves passed wherever they ran.

## The stack

- **Tree:** a robocopy snapshot of the **current tree** taken 2026-10-02 00:21. Before the snapshot:
  - no `.js`/`.ts` twins anywhere in `backend/src`;
  - backend and frontend `npm run typecheck` both 0;
  - `openapi:check` reported the spec current.
- **Entry point:** the services helper's converted `backend/index.ts` and config modules are included. The build succeeded, and the image booted and served both runs. That is the requested proof that the converted entry point boots.
- **Stack:** project `p1013b` (`deploy/compose/docker-compose.e2e.yml`, env from `scripts/ci/e2e-env.sh`), **production mode**, fresh volumes, Node 26.10.0, Chrome headless. `PRIVACY_NOTICE_URL` was set (ADR-113).
- **Scripts:** scratch `p1013b/run-suite.sh` and `run-pair.sh`, the procedure of the 2026-09-30 record (`2026-09-30-p10-13-e2e.md`). Order: `cd backend && npm run test:e2e`, then `node automate/smoke.browser.js`, `a11y.browser.js`, `responsive.browser.js` (new) and `p10.browser.mts`.
- **Seeding:** `GET /migration/seeding` on the fresh database.

## The runs

| Run | Window | E2E suites | E2E tests | smoke | a11y | responsive | P10 browser |
|---|---|---|---|---|---|---|---|
| **I** | 00:48:17–01:17:35 | 55 passed, **1 failed**, 1 skipped (of 57) | 425 passed, **4 failed**, 5 skipped (50 s) | **7/7** | **could not run**: 76 checks passed, then the brand check stopped with "setting the tenant brand colour failed (401: Invalid token)" | **45/45** | **12/12** (`sso` skipped by name: needs a non-production backend) |
| **J** | 01:17:39–01:41:09 | 54 passed, **2 failed**, 1 skipped | 424 passed, **5 failed**, 5 skipped (101 s) | **7/7** | **80/80** | **45/45** | **could not run**: `TimeoutError` at start-up |

**Access log** (`/app/log/access/access.log`, whole stack life, 3,108 lines):
- **5xx: 7.** Three in I and three in J, all `GET`/`PUT`/`DELETE /api/v1/supplier-scorecard/null` → 500 (A-346). The seventh is my own post-run probe of the same route.
- **429: 6**, all asserted by the P10 specs: 4 × minimal verification verdict, 2 × access-request intake.

**Spec hashes:**
- Unchanged from before I to before J.
- Between before J and after J, another lane changed `auth`, `liveContract.smoke`, `billing`, `certificates`, `content`, `kanban`, `tenant-hierarchy` and `vendors`. The files are stamped 01:41, after J's E2E phase (01:17–01:19), so **both E2E phases ran identical specs**. The browser scripts were unchanged throughout.

## Every failure, with its owner

| # | Where | What | Cause | Owner |
|---|---|---|---|---|
| 1 | E2E, I and J | `supplier-scorecard.e2e.test.js`: create, then get, update and delete (4 tests) | (a) **Stale spec:** it sends `status: "Approved"`, and the A-336 contract allows only `APPROVED` / `PROBATION` / `DISQUALIFIED` (the frontend sends `APPROVED`). The create is a 400, so the later steps use the id `null`. (b) **Real defect:** a malformed id is a **500** on this route, the run's only 5xx, where every sibling route answers 400 through `validateUuid` (vendors, calibration-devices, certificates, warehouses, kanban, tickets, probed live). The route lacked `validateUuid` before its conversion too (`git show HEAD:…supplierScorecard.route.js`). | (a) **A-347**, (b) **A-346**: the A-336 / supplier-scorecard lane |
| 2 | E2E, J only | `storage.e2e.test.js` "422 when S3 connection test fails": `TimeoutError` | The spec's invalid S3 credentials send the backend's connection test to **real AWS** (`us-east-1`). In I it answered 422 in 1.65 s; in J it took longer than the harness's 15 s. The suite depends on the internet and AWS latency, and the connection test has no shorter bound. | **A-348**: the storage module |
| 3 | a11y, I | The brand check never ran (76 checks had passed) | The backend **stalled**: no log line at all from 18:12:00 to 18:12:27 UTC, a re-sign-in that never completed (access-log status `-`, the harness aborted it at 15 s), and node-cron "missed execution" warnings. The harness's `freshAdmin` then kept the expired token **silently**, so the failure surfaced as "401: Invalid token", not as itself. | Harness: **fixed here** (below). Stall: open (below). |
| 4 | P10 browser, J | Could not start: `TimeoutError` | The same kind of stall: the backend wrote **nothing from 18:40:02 to 18:41:11 UTC** (69 s) while idle between suites. The operator sign-in at start-up was aborted (access-log status `-`). | Stall: open (below) |

### The stalls (open; environment or product, not decided)

There were 11 node-cron "missed execution" warnings, in two clusters: 01:05–01:12 (during I's a11y) and 01:40–01:41 (J's P10 start). They come from the `*/15 s` webhook dispatcher and the `*/5 min` watchdog. They are symptoms of a frozen process, not causes.

In the second cluster:
- the backend logged nothing for 69 s, including the RabbitMQ connects it otherwise makes every 15 s;
- Postgres's periodic checkpoint ran on time.

Afterwards:
- an idle probe found **no** stall: 180 health requests, 1 per second, maximum 222 ms;
- the Windows host was at 1 % CPU;
- the Docker VM's `dmesg` shows nothing;
- no other image builds or containers were active.

I cannot tell whether the backend container was starved (host or VM) or blocked the event loop itself. The next step is to run the pair with a 1-second health probe logging alongside, so that the next stall is timed against what was in flight. **Owner: the main session decides.** Until then a green pair on this host is not reproducible on demand.

### Fixed here (my lane)

`automate/a11y.browser.js`, `freshAdmin`:
- a re-sign-in is tried 3 times, 5 s apart;
- if all fail it **throws** "signing in again as … failed 3 times (last: …)".

Before, a failed re-sign-in kept the expired token silently. This is a harness change only, checked with `node --check`. It has not been through a live run yet (the stack is torn down).

## P10 live checks confirmed (item 1)

Against these runs:
- the P10 E2E specs (`p10-access-requests.e2e.test.ts`, `p10-public-auth.e2e.test.ts`) were in the passing set of **both** I and J; the only failing suites were supplier-scorecard and storage;
- the P10 browser suite passed 12/12 in I.

| Card | Live evidence | New status |
|---|---|---|
| P10-05 request-access backend | `p10-access-requests.e2e` I + J; browser *request access* (I) | DONE in working tree; DONE on commit |
| P10-07 super-admin queue | approve/reject in `p10-access-requests.e2e` I + J; browser *invitation: approve →* (I) | same |
| **P10-09 forgot / reset** | `p10-public-auth.e2e` "P10 forgot / reset password (live)" (send-otp neutral for a known and an unknown address, then the reset), **I and J**. Browser *forgot/reset* (I): the neutral sentence, the **mailed** code from Mailpit, a new password, `/login?status=reset`, sign-in with it, axe 0 on both steps. **Confirmed.** | same |
| P10-10 passkeys | browser, **run I only**: two passkeys on two virtual authenticators, sign-in with each, revoke Key A (401) while Key B still works. Run J's P10 browser did not start. | same, on one run (stated in the card) |
| P10-12 register flag | `POST /auth/register` is the absent-route 404 in production (`p10-public-auth.e2e`), I + J | same |
| P10-15 invitation | `p10-access-requests.e2e` I + J; browser *invitation* (I) | same |
| P10-16 bootstrap password | this stack: the seed response names the file only; `docker logs` has 1 pointer line and **0** occurrences of the 24-character value; read with `exec backend cat /app/.bootstrap/superadmin-password` | same |

**Updated:** `TASKS/PHASE-10-LANDING-AUTH-REVAMP.md` (the seven card rows) and `TASKS/PROGRESS.md` (P10-03…09 group row, P10-10, P10-12, P10-15, P10-16). DONE needs the merge; the main session commits at close.

## Valid-certificate captures (item 4)

1. **`SEED_DEMO=true` in production** is refused: "Demo data seeding is refused in production: the demo users share a known password (P10-16)". That is correct behaviour. So the backend and frontend were recreated with `E2E_NODE_ENV=development`, and `GET /migration/seed-demo` returned 200: 2 tenants, 3 certificates, …
2. **The demo's signed certificate `CERT-DEMO-0003` is EXPIRED today.** Its validity ends 2026-06-15, and the demo seeder writes fixed dates. Its page reads **KEDALUWARSA**, not SAH. It was captured as `ac4-verify-expired-*` (9 files), which is a state worth having. **Finding for the demo-data owner:** the seeder's fixed dates leave the demo without a valid certificate after June 2026, so a demo of "scan the QR and see SAH" fails. Not filed as an audit row (demo data only); noted here.
3. **SAH:** a signed certificate from run I's smoke (`CERT-20261001-DEFAULT-0007`, no expiry, device "Browser Smoke Device …", invented test data), reached with its own verification token: `ac4-verify-valid-*` (9 files).

Both sets were captured with `automate/responsive.browser.js` (`RESPONSIVE_PATHS`, added for this) at:
- 320, 375, 768, 1024, 1280, 1440 and 1920 px;
- `zoom200` and `text200`.

**9/9 pairs clean for each set:** no sideways scroll, no clipped or overlapping text, one `<main>`, one `<h1>`, `lang=id`.

**Observation (P10-08 / A-293 owner):** a certificate issued 2 Oct 2026 also shows the row "Hash integritas pada dokumen terbitan sebelum 29 Sep 2026", because the backend always sends `integrity.legacyHash`. It is labelled truthfully but reads oddly for a certificate that has no pre-29-September document. Not changed.

## Docker

- Project `p1013b` was brought down with `-v --remove-orphans`.
- Images `p1013b/backend:e2e` and `p1013b/frontend:e2e` were removed by name.
- The two probe containers (`p1013b-dmesg`, `p1013b-date`) ran with `--rm` on a pre-existing `alpine:3` image (tagged 2026-09-30, not pulled here).
- Afterwards there are 0 containers, 0 volumes, 0 networks and 0 images matching `p1013b`. Nothing was pruned.
