# 2026-10-10 — No skipped unit test: the tool-dependent and OS-dependent cases

**Owner rule (2026-10-10): no test may be skipped.** This record covers the eight backend UNIT files
named for agent A2, and `.github/workflows/ci.yml`'s `backend-test` job. Live suites, E2E,
`automate/`, `frontend/` and `packages/` are other records.

## Before and after

`npm test -- --ci --coverage=false <the 8 files>` on this workstation (Windows 11, Node 26.10.0):

| | suites | passed | skipped | failed |
|---|---|---|---|---|
| before | 8 | 108 | **6** | 0 |
| after (`CLAMAV_LIVE_PORT=13310`, a real clamd up) | 8 | **116** | **0** | 0 |

116 = 108 + the 6 that were skipped + 2 (the drift guard's placeholder became three real cases).

## Per file

| File | What skipped, and why | Fix | Option |
|---|---|---|---|
| `guards/declarationDrift.p912.test.ts` | the per-twin `.each` fell back to an `it.skip.each` placeholder, since no declaration twin is left (P9-24) and jest refuses an empty table | three cases that always run: **no declaration twin is left** under `src/` (true, and a twin can only reappear by mistake: `noSourceJs.p924` refuses a new source `.js`); **every twin, if one exists, declares exactly its module's exports** (the old comparison, as `driftOf`, over all pairs, reporting the drift); **bites**: `driftOf` passes a matching temporary `.js`/`.d.ts` pair and reports the drifted one (`declared [a, gone]` against `actual [a, b]`) | (e) |
| `guards/prePushHook.a19.test.js` | (1) "no gitleaks anywhere" skipped on a machine with a global gitleaks; (2) "the real gitleaks" skipped without one | (1) deterministic: the hook runs with this process's PATH minus every directory holding a gitleaks (one PATH spelling, so Windows' `Path` cannot leak back), and the test first proves that environment has git and no gitleaks. (2) always runs and **fails** without gitleaks, naming `bash scripts/git-hooks/install-gitleaks.sh`. CI's `backend-test` now runs that installer (8.30.1, the checksum the secret-scan job pins) | (a) + (b) |
| `services/clamAv.service.test.js` | the S-04 real-clamd block (PING, a 300 KB clean file, EICAR) skipped without `CLAMAV_LIVE_PORT` | always defined; a `beforeAll` **fails** without `CLAMAV_LIVE_PORT`, naming the `docker run`. CI's `backend-test` has a `clamav/clamav:1.4` service (the compose digest, `a5f03c12…9303`), healthy on the image's own `clamdcheck.sh`, with `CLAMAV_LIVE_PORT=3310` | (b) |
| `utils/bootstrapSecret.p1016.test.ts` | "mode 0600 on disk (POSIX)" was `it.skip` on win32 | one case per OS: POSIX asserts 0600 in 0700, as before; Windows asserts what Node does there, measured here: no POSIX bits, the mode maps to the read-only attribute only, so the owner-writable file stats 0666 (writable, so a later write replaces it and removal deletes it) and the directory 0666 | (c) |
| `utils/schedulerSwitch.w02.test.js` | the rendered-chart block was `describe.skip` without helm on PATH | always runs; a `beforeAll` **fails** without helm, naming it. CI's `backend-test` installs helm v3.19.0 (`azure/setup-helm`, the pin `deploy-config` uses) | (b) |
| `middlewares/activityLog.a14.stdout.test.js` | **nothing**: no skip, no condition; 7 of 7 ran before and after | unchanged | — |
| `services/upstreamFileImport/processRunner.test.ts` | **nothing**: it runs Node itself as the child and a spawn double, never rsync or ssh; 10 of 10 ran before and after | unchanged | — |
| `utils/checkMenu.test.js` | **nothing**: 2 of 2 ran; the test mocks `config` and `models` and loads the dead `checkMenu.util.js` (A-18) | unchanged. Recommendation: delete the util and this test together when the owner closes A-18; until then it costs nothing and keeps the util's 100 % | (d) |

No assertion was weakened: every former skip now asserts what it did, or (bootstrapSecret on
Windows) asserts the platform's actual behaviour instead of nothing.

## What each place that runs the suite needs

- **CI `backend-test`**: clamd service, helm, gitleaks, all added in this change (pinned).
  rsync is not needed by any of these files.
- **This workstation**: helm is installed (`C:\Tools\Helm`); gitleaks 8.30.1 was installed with the
  repository's own installer into `.tools/bin` (git-ignored; what `make hooks` does, without its
  `core.hooksPath` change); a clamd must be running for `clamAv.service.test.js`:
  `docker run -d --name clamd -p 127.0.0.1:13310:3310 clamav/clamav:1.4` and
  `CLAMAV_LIVE_PORT=13310`. **Without it, `npm test` now fails three cases, by design.** The
  container used for this run, `a2-noskip-clamd`, was removed by name.

## Proof

- the 8 files: 116 passed, 0 skipped, 0 failed (above); `clamAv.service.test.js` without
  `CLAMAV_LIVE_PORT`: fails with the message naming the `docker run`.
- `npx eslint` on the five changed test files: clean; `node scripts/ci/eslint-ratchet.js`:
  0 errors, 0 warnings, baseline 0; `npm run typecheck`: 0 errors (one earlier run failed while
  other agents were editing; the re-run on the same files passed); `npm run ratchet`: 695 `.js`,
  at the floor.
- `actionlint` 1.7.12 (windows_amd64 zip, sha256 `6e7241b5…f6e9` from the release's checksums
  file, whose linux entry equals the one CI pins) on `ci.yml`: no finding.
- **Not run**: the new `backend-test` job on GitHub. The ClamAV service's start-up time on a
  runner is unmeasured (36 × 10 s health retries allowed).

## Addendum: `live-db` runs every live suite (`--with=all`)

The `live-db` job ran `--with=mqtt` only, so 7 suites were NOT SELECTED, which is a skip by
another name. At A1's request, relayed by the coordinator, the job now provides every service
`backend/scripts/live-suites.ts` names, using its exact variables:

- **ClamAV:** a service, `clamav/clamav:1.4@sha256:a5f03c12…9303`, healthy on `clamdcheck.sh`
  (36 × 10 s). `CLAMAV_LIVE_HOST=localhost`, `CLAMAV_LIVE_PORT=3310`.
- **Redis:** a service, `redis:7-alpine@sha256:858f009f…3499`, health `redis-cli ping`.
  `REDIS_LIVE_URL`.
- **RabbitMQ:** a step, `rmq-live` (`rabbitmq:4-alpine@sha256:2cb43283…8ada`), because
  `rabbitmq.w06` restarts it by name. Readiness comes from `rabbitmq-diagnostics check_port_connectivity`.
  `RABBITMQ_LIVE_URL`, `RABBITMQ_LIVE_CONTAINER`.
- **S3:** a step running SeaweedFS 4.48 (`chrislusf/seaweedfs@sha256:4e61d15f…872d`) as
  `weed server -s3` with an identities file written in the step. The keys are throwaway, from
  `openssl rand`, `::add-mask::`ed and exported. The step also adds the `/etc/hosts` alias
  `127.0.0.1 s3-live.internal` as `S3_LIVE_DEV_HOST`.
- **Upgrade suites:** checkout with `fetch-depth: 0` (they `git archive` `ce74932` and `3e91413`).
- **Command and timeout:** `npm run test:live -- --with=all`, `timeout-minutes: 75`.

The digests were read from `RepoDigests` of the images pulled on 2026-10-10.
`actionlint` 1.7.12: no finding.

**Local proof, equivalent containers on 127.0.0.1** (PostgreSQL 18 pgvector, Mosquitto, ClamAV,
Redis, RabbitMQ, SeaweedFS; `S3_LIVE_DEV_HOST=localtest.me`): `npm run test:live -- --with=all`
gave **54 of 55 suites passed, 450 passed, 3 failed, 0 skipped, 0 not selected**.

The 3 failures were all `w14`, with `ECONNREFUSED` on the broker. The cause was this
workstation, not the code: Git Bash rewrote Mosquitto's `-c /mosquitto-no-auth.conf` (and
SeaweedFS's `-dir=/data`) into Windows paths, so the broker exited at start. With
`MSYS_NO_PATHCONV=1`, `--with=mqtt --only=w14` re-ran 3 of 3 passed. CI runs Linux bash, which
rewrites nothing.

The containers (`a2l-pg`, `a2l-mqtt`, `a2l-clamd`, `a2l-redis`, `a2l-rmq`, `a2l-s3`) were removed
by name. Their anonymous volumes were not, because there was no prune. The new job has **not run
on GitHub**.
