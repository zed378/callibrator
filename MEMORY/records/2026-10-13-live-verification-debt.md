# 2026-10-13 — Live verification debt: the idempotency crash fix and the `unsigned` filter, run for real

**Card:** line D card 2 (verification debt; no numbered task) · **ADR:** none new. This is evidence only; ADR-127 Am. 5 gains a "Live" bullet · **Base:** `f2a2d70`

Two earlier records said "not run":
- the idempotency crash fix (`6ea58c5`, ADR-127 Am. 5): did the container survive?
- `GET /ipm/sessions?unsigned=` (`360cd0d`): was there a live PostgreSQL case?

Both are now run. **No defect was found.**

## (a) A refused, keyed request does not take the API down (disposable stack)

**Stack.**
- Project `lined-stack`, `BUILD_TAG=lined`.
- Built from a clean worktree of `f2a2d70` (which contains `6ea58c5`), not the working tree, because three other lines had uncommitted changes there.
- Files: `docker-compose.yml` + `docker-compose.build.yml` + `docker-compose.e2e.yml`, production mode. Env from `scripts/ci/e2e-env.sh`.
- Backend on 127.0.0.1:27420, started with its dependencies only (no frontend).
- Seeded with `GET /api/v1/migration/seeding`.
- One synthetic TECHNICIAN (`ldprobe`) inserted in the default tenant with a random password.

**Probe** (a Node `fetch` script; each refused request sent **twice under the same `Idempotency-Key`**):

| Request | Answers |
|---|---|
| `POST /api/v1/calibration-devices`, a new serial (keyed) | 201 |
| the same serial again, key K2, twice | 409, 409 (duplicate serial, a handler-level refusal) |
| `POST /api/v1/ipm/sessions` (keyed) | 201 |
| `POST /ipm/sessions/:id/submit` on the empty draft, key K4, twice | 400, 400 ("This IPM cannot be submitted yet …"), the original reproduction |
| the same with a stale `revision`, key K5, twice | 409 `IPM_REVISION_CONFLICT`, 409 |
| `GET /health` | 200 `{"status":"ok"}` |

**After the probe:**
- `docker inspect lined-stack-backend-1`: `RestartCount=0`, `StartedAt` unchanged (07:19:47Z), running, healthy.
- The backend log has **0** lines matching `UNHANDLED_REJECTION|ERR_HTTP_HEADERS_SENT|Cannot set headers`.
- It has 4 lines of the middleware's "second answer dropped" warning, which is the fix working as designed.

**Not re-run:** the fail-before on a `de2e938` image. The coordinator reproduced the crash there twice on 2026-10-12; this run does not repeat it.

**Teardown:**
- `down -v --rmi local`: no `lined` container, volume or image remains.
- The worktree was removed. Its `node_modules` junctions were unlinked first, and the main tree's `node_modules` were checked intact.

## (b) `unsigned=` on PostgreSQL 18, as `callibrator_app`

- **Added** one case to the existing live suite `backend/src/tests/services/ipmSubmit.p2104.live.test.ts`, which is already registered as `p2104` in `backend/scripts/live-suites.ts`. The case is "the 'to sign' list: unsigned=true is the caller's effective submitted reports without its performer signature, false those with it; a bound caller sees its facility only".
- **What the case does:**
  - U1 submits two reports on D3 and signs one as performer. U2 submits one, and U1 leaves one in draft.
  - `true` holds the unsigned one and not the signed one; `false` holds the reverse. U2's report and the draft are in neither list, and the two lists are disjoint.
  - Every listed row is checked against the table: `submitted`, `superseded_by_id IS NULL` and `performed_by = U1`. U1's superseded original is in neither list.
  - A caller bound to F2 sees neither D3 report and only F2 rows.
- **Run:** `npm run test:live -- --only=p2104` on `pgvector/pgvector:pg18` at 127.0.0.1:56260 (container `ld-pg18`, removed afterwards), from the clean `f2a2d70` worktree plus this test file: **10 passed of 10** (71 s).
- **Mutation check:** the same run with `listSessions` ignoring `unsigned` (a throwaway edit in the worktree, reverted): **only the new case fails**, 9 passed and 1 failed. So the case detects the filter, not just the fixture.
- **In the working tree** (with other lines' uncommitted migrations 0137/0138 and model changes), the same suite ran three times:
  - first run: the `beforeAll` (sync and 138 migrations) passed its 300 s timeout under load;
  - second and third runs: 9 passed. The new case passed both times, and the pre-existing first case ("a root submit writes every issued field…") hit its 10 s test timeout both times.
  - On the clean tree that first case passes, so it is load, or something in the in-flight work. **Re-check it once those changes land.**
- **Gates:**
  - `npx eslint src/tests/services/ipmSubmit.p2104.live.test.ts`: clean
  - `npm run typecheck`: 0 errors
  - `npm run ratchet`: unchanged (no new `.js` file)

## Files

- `backend/src/tests/services/ipmSubmit.p2104.live.test.ts`
- `MEMORY/DECISIONS.md` (ADR-127 Am. 5, one "Live" bullet)
- `MEMORY/records/2026-10-12-fix-idempotency-double-write.md` and `MEMORY/records/2026-10-12-ipm-sessions-unsigned-filter.md` (a "since" pointer each)
- this record, `MEMORY/MEMORY-INDEX.md`, `MEMORY/CHANGELOG.md`
