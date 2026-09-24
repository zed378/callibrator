# Dependency Upgrade to Latest — 2026-09-24

**Kind:** change record · **Requested by:** the owner. "Update and upgrade every package to the
latest; delete the lock file and let a new one be written; upgrade literally, then add `^`; make
sure the change causes no bug, problem or vulnerability before deploying."

---

## What Was Done

1. **Exact latest versions first.** `npm-check-updates -u --removeRange` rewrote every dependency in
   the root, backend and frontend manifests. Packages already inside their old range were then
   pinned to the exact `npm view <pkg> version`. After everything was verified, `^` was added back
   to every entry, as the owner asked.
2. **Fresh lockfile.** `package-lock.json` and every `node_modules` were deleted and reinstalled
   from scratch, twice: the second time so the new overrides resolved cleanly.
3. **Two packages are not at their newest major — deliberately:**

   | Package | Latest | Installed | Why |
   |---|---|---|---|
   | `typescript` | 7.0.2 | **6.0.3** | TypeScript 7 ships **no compiler API** — its main export is `lib/version.cjs`. `typescript-eslint` requires `<6.1.0`, `ts-jest` requires `<7`, and Next's type check calls the API |
   | `eslint`, `@eslint/js` | 10.x | **9.39.5** | `eslint-plugin-react`, which `eslint-config-next` depends on, declares `eslint ^9.7` at most |

   Forcing either with `--legacy-peer-deps` would install a combination npm itself calls
   "potentially broken". The newest version that the rest of the stack accepts was taken instead.

## Changes the Upgrade Required

| | |
|---|---|
| **ioredis 6** defaults to RESP3 | `redis.service.js` sets `protocol: 2`. The eval scripts, scan cursors and `SET NX` replies were written against RESP2 shapes |
| **TypeScript 6** requires an explicit `rootDir` when emitting | `frontend/tsconfig.json` sets `"rootDir": "."`; ts-jest had failed every suite with TS5011 |
| **`jwk-to-pem` removed** | its `elliptic` dependency has an unfixed advisory (GHSA-848j-6mx2-7j84). `oidcJwks.js` converts with Node's `crypto.createPublicKey({ format: "jwk" })`. The unit fixtures had been placeholder strings (`n: "modulus"`) that only a mock of `jwk-to-pem` accepted; they are now real keys. **New test** `oidcJwks.realKey.test.js`: RS256 and ES256 tokens verify through the real `jsonwebtoken`, and a token signed by another key with the same `kid` is refused |
| **Sequelize's bundled `uuid` 8** (GHSA-w5hq-g745-h8pq) | root `overrides.sequelize.uuid = 11.1.1`, the patched release, still CommonJS. Sequelize uses only `v1` and `v4` |
| **`crypto` npm package removed** | a deprecated placeholder ("now a built-in Node module"); `require("crypto")` always resolved to Node's own |
| one flaky timeout | `esignature.service.coverage.test.js` generates real RSA keys. It timed out once under a full parallel run and was green on re-run; the file now sets a 60 s timeout |

## Evidence

- **`npm audit`: 0 vulnerabilities.** The previous lockfile had **20** (18 low, 2 moderate), so
  **none was introduced by the upgrade.** The last four were pre-existing (`elliptic`, and `uuid` in
  Sequelize) and are fixed as above.
- **Backend,** `npm run test:coverage`: **399 suites, 8,524 tests, 100 %** on all four measures.
- **Frontend,** `npx jest`: **83 suites, 785 tests**; `npx tsc --noEmit` exits 0.
- **Lint unchanged.** The same code, linted with the old lockfile in a separate worktree and with the
  new one, gives **identical** counts:
  - frontend: 82 errors, 62 warnings;
  - backend: 1,307 errors, 439 warnings.

  Both were pre-existing (A-34).
- **Major versions checked against the real libraries, not mocks:**

  | Library | Check |
  |---|---|
  | ioredis 6 | against a real Redis 8: get, set, `getDel`, `SET NX`, `eval`, `scan`, the lock, and `HELLO` reports protocol 2 |
  | nodemailer 10 | `createTransport` with the service's options, including a string port, fails only on the connection |
  | dotenv 18 | `config({ path, quiet })` |
  | SimpleWebAuthn 14 | the real `generateRegistrationOptions` and `generateAuthenticationOptions` with the service's arguments. It needs Node 22 or later; the backend binary targets node24 |
  | markdown-it 15 | used only by a docs script |
- **Both production images build:** the backend with `npm ci` from the new lockfile plus `pkg`; the
  frontend with `next build`.

## Also in This Change

`backend/uploads/profile/default.svg` is tracked, at the owner's request. It is excepted in
`.gitignore`, `backend/.gitignore`, `backend/.dockerignore` and `backend/Dockerfile.dockerignore`.
Runtime behaviour is unchanged: `picture()` still returns `null` for the placeholder, so the UI keeps
its initials fallback.

## Install Scripts (npm 12)

npm 12 blocks dependency install scripts unless `allowScripts` in the root `package.json` covers
them, and every install warned about the seven that were skipped. Each one was reviewed and
recorded:

- **Approved, pinned to the reviewed version:** `esbuild` and `unrs-resolver`. Their postinstalls
  only verify or select a native binary.
- **Denied:**
  - `core-js` — a donation banner;
  - `@scarf/scarf` — install telemetry;
  - `puppeteer` — a Chrome download; the backend image uses the system Chromium through
    `PUPPETEER_EXECUTABLE_PATH`;
  - `next-bun-compile` — needs `bun`, which the frontend Dockerfile supplies itself;
  - `@parcel/watcher` — a build from source, when its prebuilt binaries already arrive as optional
    dependencies;
  - the `prepare` entries, which never run for registry packages anyway.

All tests and both image builds had already passed with every one of these skipped.

## Not Covered

- **The frontend image still installs without a lockfile** (S-29). Its `npm install` resolves the
  tree inside the build, which takes over ten minutes and is not guaranteed to match the verified
  lockfile exactly. The pins with `^` narrow the drift; `npm ci` from the root lockfile would remove
  it.
- **Requiring SimpleWebAuthn 14 on Node 24** prints two `ExperimentalWarning` lines (Web Crypto
  ML-DSA). This is log noise, not an error.

## Deployed to the VM — 2026-09-24

The deploy used the owner's wipe procedure (ADR-041 runbook).

**Preparation.** Before anything was touched, the containers of the 32 other projects were listed and
the network plan was checked against the host. The pinned `172.30.19.0/24` overlaps none of them;
they sit on 172.17 to 172.29, each a /16.

**Wipe and rebuild.**
- `down -v --remove-orphans` scoped to project `callibrator`, which left **0 containers** and no
  network.
- The bind mounts were emptied through a throwaway alpine container.
- `up -d --build` from `547ffe2`: **all seven containers healthy.**
- **The other 32 containers were identical before and after** — checked with `diff`.

**Verified live:**

| Check | Result |
|---|---|
| Database | PostgreSQL **18.6**; 30 migrations applied, `0027` to `0030` among them. **`0028`, `0029` and `0030` ran on real PostgreSQL for the first time** |
| Foreign keys | `audit_logs` tenant and impersonator: `r`; `calibration_records.performed_by`: `r`; `notifications` tenant: `c` |
| NOT NULL | `calibration_records.tenant_id` and `.performed_by` |
| New columns | the `users.mfa_pending_*` and `mfa_last_used_step` columns are present |
| Seed | through the momentary `ALLOW_SEEDING` toggle: 11 roles, 7 menu groups, **152** permissions (130 before — the new `esignature` and `profile-page` grants), 1 user. It was switched back to `false`, and the endpoint answers **401** |
| Public URL | `/health` 200, `/login` 200, and a real login through the Next proxy: 200 |
| **A-99 in the pkg binary** | `POST /auth/mfa/setup` returned a secret and a QR code, so otplib 13's ES-module dependencies load in the compiled binary. **The verify step was deliberately not run:** it would enable MFA on the only super admin, and there is no disable or recovery path until A-141 lands |
| **A-16 / ADR-050** | that login recorded `sessions.ip_address` **and** the `LOGIN` audit row's `ip_address` as `103.136.59.201`, the operator's real public IP — not the gateway |
| Rate limiting | **`AUTH_RATE_LIMIT_BY_IP=true` is now set on the VM** (the `.env` was backed up first). The backend restarted healthy, and login still returns 200 |
