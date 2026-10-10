# 2026-10-10 — No live suite can skip: a live jest configuration, no opt-in gates, every service run for real

**Date:** 2026-10-10 · **Items:** owner rule "no test may be skipped" (agent A1 of 4), A-367 follow-up · **ADR:** none (a test-harness change; no architecture, no `src/` code changed) · **Base:** `2c2ada4` plus the other three agents' uncommitted work · **Nothing committed.**

**Trigger.** The owner's rule: no test may be skipped. The 54 `backend/src/tests/**/*.live.test.*` suites were picked up by the unit configuration (`jest.config.js`) and each gated itself (`X_LIVE_TEST === "1" ? describe : describe.skip`, `ENDPOINT === "" ? describe.skip : describe`, and inside `upstreamSqlImport.p2406` `(withClamAv ? it : it.skip)`), so every unit run reported all 54 as skipped suites. Seven of them (`upgradeBoot.am3`, `upgradeBoot.p2009`, `rabbitmq.w06`, `storage.s3.u09`, and the three Redis suites) were not in `npm run test:live` either: by-hand only (`NOT_RUN`).

## What changed

| | Before | After |
|---|---|---|
| Unit run (`npm test`, `npm run test:coverage`) | loads 54 live files, all **skipped** | loads **none**: `testPathIgnorePatterns` gains `\.live\.test\.(js|ts)$`; `npx jest --listTests` lists 1,025 files, 0 of them live |
| Live configuration | none (the runner used the unit config) | `backend/jest.live.config.js`: the unit config, `testMatch` = `*.live.test.{js,ts}` only, no coverage; `npx jest --config jest.live.config.js --listTests` lists the 54 |
| Gates | 54 suite gates + 2 test gates (`u09` dev host, `p2406` ClamAV) | **none**. A live suite runs, and fails when its service is missing: `u09` and `p2406` throw at load, naming the missing variables; `w06` throws in `beforeAll` without `RABBITMQ_LIVE_CONTAINER`; the database suites fail on connect |
| Opt-in flags | 27 distinct `*_LIVE_TEST=1` / `P2406_CLAMAV=1` | gone from every suite, the runner and the headers; connection variables kept |
| Runner (`scripts/live-suites.ts`) | 48 runs; `--with=mqtt`; 7 suites by hand (`NOT_RUN`) | **55 runs** (54 files; `q34` in both modes), `NOT_RUN` deleted. `--with=mqtt,redis,rabbitmq,s3,clamav,upgrade` or `all`; each service's variables are checked before anything runs; a suite whose service is not named is listed as NOT SELECTED in the summary; a suite FAILS if any test is skipped or todo or none ran (jest `--json` counts) |
| Upgrade suites | by hand, `AM3_BASE_NODE_MODULES` installed by hand (the header named only `joi`) | `--with=upgrade`; when `AM3_BASE_NODE_MODULES` is unset the runner reads the base's `backend/package.json` (`git show`) and installs every dependency the repository's `node_modules` lacks into `%TEMP%/callibrator-live-am3-base` — for `ce74932` that is `cls-hooked`, `joi` and `swagger-jsdoc`: the first full run failed am3 10/10 on `Cannot find module 'cls-hooked'` with `joi` alone |
| One file by hand | `npm test -- <file> --coverage=false` | `npm run test:live:jest -- <file>` (new script; every header updated) |
| `liveSuites.a367.guard` | every live file is in `SUITES` or `NOT_RUN`; every suite carries an opt-in flag | every live file is in `SUITES`; no suite env has a `*_TEST` key; every need is a known service; **no live file contains a skip shape** (`.skip`/`.todo`, `x*(`, `? describe :`, `: describe.skip`) or a `*_LIVE_TEST` flag; the unit config ignores every live file and the live config matches only them; planted samples prove each check can fail — **6 of 6 passed** |

## Evidence

Environment: throwaway containers on 127.0.0.1, removed by name afterwards — `a1live-pg18` (`pgvector/pgvector:pg18`, :55223), `a1live-mqtt` (`eclipse-mosquitto:2 -c /mosquitto-no-auth.conf`, :55224), `a1live-redis` (`redis:7-alpine`, :55225), `a1live-rmq` (`rabbitmq:4-alpine`, :55226), `a1live-s3` (`chrislusf/seaweedfs:latest`, `weed server -s3` with an identities file, :55227), `a1live-clamav` (`clamav/clamav:stable`, :55228). `S3_LIVE_DEV_HOST=localtest.me` (public DNS → 127.0.0.1; neither `localhost` nor a literal, so the SSRF guard's text check passes and its connect-time check blocks it until `SSRF_DEV_ALLOW_HOSTS`). Node 26.

**`npm run test:live -- --with=all`, run 2 (the final tree): 55 of 55 suites passed; 453 tests passed, 0 failed, 0 skipped; 0 suites not selected** (exit 0). Run 1 of the same command was 54 of 55, 443 passed: `upgradeBoot.am3` failed 10/10 on `Cannot find module 'cls-hooked'` in the base tree, the runner having installed only `joi`; fixed by deriving the list from the base's package.json, then `--only=am3 --with=upgrade` 10/10, then run 2. The previously by-hand suites, each RUN in run 2 (not skipped): `upgradeBoot.am3` 10, `upgradeBoot.p2009` 9 (206 s, scale 1), `rabbitmq.w06` 4 (the broker container restarted under it), `storage.s3.u09` 15 (the dev-host SSRF case included), `rateLimiter.redis` 7, `socket.redisAdapter` 2, `rateLimiter.fixedWindow.am5` 3; `upstreamSqlImport.p2406` 13 with its ClamAV/EICAR case. Per suite: p6 26, p613 6, dbA 11, dbB 10, dbC 4, dbD 6, a215 8, s08 5, s20 9, p918kr 3, q51 6, p2007 56, p2007move 7, p2006 5, p2003 13, p2101 6, p2004 15, p2005 15, p2103 8, p2104 9, p2002 21, p2105 4, p2102b 3, p2106 3, p2107 7, uifix 3, p1005 7, p918att 6, p918 6, p918seed 5, q34u 7, q34f 7, p611 4, q84 12, p804 4, w34 7, p2401 8, p803 4, w03 3, w07 4, w12 8, w15 2, w17 2, w20 4, w33 12, a10 6, w14 3.

Unit side: `npx jest --listTests` (unit config) lists 1,025 files, **0** matching `.live.test.`; `npx jest --config jest.live.config.js --listTests` lists **54**. `liveSuites.a367.guard.test.ts` 6/6.

Gates: `npm run typecheck` 0 errors in my files; `npx eslint` on every changed file 0 errors; `node scripts/ci/eslint-ratchet.js` 0 errors, 0 warnings, baseline 0; `npm run ratchet` 695 `.js`, at the floor (`jest.live.config.js` is a root tool file, not counted).

## CI (`live-db`, owned by agent A2 — not edited here)

`npm run test:live -- --with=mqtt` in CI now runs 48 suites and lists 7 as NOT SELECTED. For all 55: add a ClamAV service (`clamav/clamav:stable`, digest-pinned, port 3310, a health check of a minute or more) with `CLAMAV_LIVE_HOST=localhost`, `CLAMAV_LIVE_PORT=3310`; a Redis service with `REDIS_LIVE_URL=redis://localhost:6379`; RabbitMQ as a **step** (`docker run -d --name rmq-live -p 5672:5672 rabbitmq:4-alpine`, the suite restarts it by name) with `RABBITMQ_LIVE_URL=amqp://localhost:5672`, `RABBITMQ_LIVE_CONTAINER=rmq-live`; SeaweedFS as a step with an identities file and `S3_LIVE_*`, plus `echo "127.0.0.1 s3-live.internal" | sudo tee -a /etc/hosts` and `S3_LIVE_DEV_HOST=s3-live.internal`; `fetch-depth: 0` on checkout (the upgrade suites `git archive` `ce74932` and `3e91413`); `--with=all`; and a longer `timeout-minutes`.

## Not done

- `ci.yml` (agent A2's).
- A-283 (most live suites connect as the owner) is unchanged.
