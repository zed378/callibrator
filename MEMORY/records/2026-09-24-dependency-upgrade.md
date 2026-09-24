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

## Not Covered

- **The frontend image still installs without a lockfile** (S-29). Its `npm install` resolves the
  tree inside the build, which takes over ten minutes and is not guaranteed to match the verified
  lockfile exactly. The pins with `^` narrow the drift; `npm ci` from the root lockfile would remove
  it.
- **Requiring SimpleWebAuthn 14 on Node 24** prints two `ExperimentalWarning` lines (Web Crypto
  ML-DSA). This is log noise, not an error.
