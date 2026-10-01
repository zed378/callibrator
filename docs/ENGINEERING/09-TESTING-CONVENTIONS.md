# 09 — Testing Conventions

How tests are written here, and the specific ways tests in this repository have lied.

---

## The Layers

| Layer | Where | What it proves | State (dated snapshot — re-count before quoting) |
|---|---|---|---|
| unit / route | `backend/src/tests/**` (excl. `e2e/`) | a function's logic, or a real router's chain, with its dependencies doubled | **700 of 724 suites, 13,272 tests, 100/100/100/100** (`npm run test:coverage -- --ci --forceExit`, 2026-09-29, ADR-087 Amendment 12); the 24 skipped suites are the env-gated live ones |
| guard | `backend/src/tests/guards/**` and the named guards elsewhere (below) | a whole-tree rule holds over the real source or the real route tree | part of the unit run |
| validation contract | `backend/src/tests/contracts/validation/` | the exact 400 body of `validate(schema)` for every validator, byte for byte over real HTTP, in production and outside it | 41 suites (P9-11) |
| live PostgreSQL | `backend/src/tests/**/*.live.test.*` | SQL, triggers, grants and hooks against a real PostgreSQL 18 | 21 PostgreSQL suites + Redis/RabbitMQ/MQTT ones, each skipped unless its own variable is set (below) |
| frontend unit | `frontend/src/**/*.test.ts(x)` | components, stores, API clients | 155 suites, 1,380 tests (ADR-076, 2026-09-28) |
| frontend service contract | `frontend/src/api/services/*.test.ts` | the client sends what it believes the API accepts | **a belief, not a guarantee** until `packages/contracts` (P9-22) |
| live E2E | `backend/src/tests/e2e/` | real HTTP against a real server and PostgreSQL | 53 specs + the opt-in `liveContract.smoke`; **green twice in a row** on a disposable compose stack (ADR-077; the P9-00 baseline, below) |
| browser | `automate/smoke.browser.js` | a user flow in a browser | five checks, puppeteer-core (A-20, ADR-077) |

`npm run test:coverage` is the gate. Its scope is stated in `jest.config.js` (ADR-085): `config/`, `constants/`, `models/`, `docs/` and `scripts/` are excluded — so a defect in `config/index.js` is invisible to it, and models are measured by their own named command instead (ADR-092 item 4).

## Rules

### 1. A mock must look like the real thing

The `ioredis` mock in `redis.service.test.js` fabricated a `connected` getter. Real ioredis has none. The suite was green; in production every Redis helper returned early and registration, passkeys and the OIDC provider were broken (A-24).

When mocking a third-party client, expose **only** properties and methods the real client has. If in doubt, construct the real object with `lazyConnect` and inspect it.

### 2. Do not assert what you copied from the implementation

```js
// ❌ this test locked a production bug in
expect(db.query).toHaveBeenCalledWith(expect.stringContaining("UsageMetrics"), {
  replacements: ["tenant-1", "api_calls", 7],
});
```

`$1` placeholders are bind parameters; passed as `replacements` they fail on real PostgreSQL, and every tenant's usage read as zero. The test asserted the wrong option because it was written by reading the code. A test that mirrors the implementation verifies **consistency**, never **correctness**.

Prefer asserting behaviour. When an option genuinely matters, write down *why* in the test — the regression comment now in `meteredBilling.service.test.js` does.

### 3. Every `:id` route: a two-tenant test asserting 404, with its marker

**The fixture for a new test is `twoTenantSuite` over `memoryDb`** (`backend/src/tests/fixtures/`, TypeScript):

- **`memoryDb.ts`** loads the **real** models barrel and the **real** tenant hooks (`tenantScope.util#register`, the include walk, the hookless-statics wrappers) over an in-memory query interface. Only the query interface, joins and transactions are doubled; an operator it cannot evaluate **throws** rather than matching everything, a column the model does not define throws PostgreSQL's `column "x" does not exist`, and raw SQL is refused unless the test installs `onQuery`. So the 404 comes from the hooks, not from a double that decided what "another tenant's row" returns.
- **`routeClient.ts`** drives the **real** router chain (`validateUuid`, `dynamicAccess`, `validate`, controller, service, `errorHandler`, `notFound`); only `auth` is replaced by `authMock()`, which sets `req.user` / `req.tenantId` and then runs the real `tenantContextMiddleware`.
- **`twoTenantSuite.ts`** generates the two tests per route from a table: *"another tenant's record answers 404, identical to one that does not exist, and nothing is written"* (status 404, bodies equal with ids masked, every table unchanged, no committed write) and *"the owning tenant reaches it"* (the positive control — without it a 404 could be a broken fixture).

```ts
/**
 * @two-tenant api/qms.route.js PATCH /nc/:id       ← one marker line per route covered
 */
import type * as MemoryDbModule from "../fixtures/memoryDb";
import type * as RouteClient from "../fixtures/routeClient";
// …type-only imports of the suite and the route

// jest.transform.js runs no hoist plugin: register the mocks FIRST, then load with requireActual
jest.mock("../../config", () => ({
  db: jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb().sequelize,
}));
jest.mock("../../middlewares/auth.middleware", () =>
  jest.requireActual<typeof RouteClient>("../fixtures/routeClient").authMock());
const mdb = jest.requireActual<typeof MemoryDbModule>("../fixtures/memoryDb").memoryDb();
// …twoTenants / seedTenants / grantAllMenus, twoTenantSuite and the router, each via requireActual

beforeEach(() => { mdb.reset(); grantAllMenus(); /* principals for A and B; mdb.seed(A's rows) */ });

twoTenantSuite({ module: "qms", router, mdb, context: () => ctx, routes: [
  { key: "PATCH /nc/:id", method: "PATCH", path: (id: string) => `/nc/${id}`, id: () => NC_A,
    body: { title: "Renamed" }, writes: ["NonConformance", "AuditLog"] },
] });
```

Worked example: `tests/routes/qms.twoTenant.test.ts`. **The marker is enforced:** `tests/guards/twoTenantRoutes.guard.test.ts` walks every route module (`.js` and `.ts`) and requires every route with a `:param` to have an `@two-tenant <route file> <VERB> <path>` marker in a test file that asserts a 404, an entry in its `EARLIER_TESTS` list, or a reviewed `NOT_TENANT_ADDRESSED` entry whose kind (`platform`, `public`, `capability`, `not-tenant-owned`) the route's chain agrees with. A marker for a route that no longer exists fails too. (On 2026-09-29 it was red for exactly that reason while the certificate-PDF route was being moved — the guard doing its job.)

The older fixture, `fixtures/twoTenants.js` (`createTwoTenants()`, A-63), is synchronous and database-free over `jest.mock`'d models — no hooks, no SQL. Existing tests built on it (`tenant.edit.a63.test.js`, `readGates.p604.test.js`) stay; a new test uses the suite above.

For a mutation, also assert **the row is unchanged** — an error response over a completed write is still a breach. The suite does this for you (`tablesAfter` equals `tablesBefore`).

### 4. Test the bodyless request

Express 5 leaves `req.body` `undefined` when there is no body. Every route that reads the body gets a test that sends none. Most controller tests set `req = { body: {} }`, which is exactly why the `menu-groups` 500 shipped.

### 5. Reset mock implementations between tests

`jest.config.js` has `clearMocks: true` and `resetMocks: false`: call history clears, **implementations persist**. A `mockRejectedValue` in one test leaks into every later test in the file. Set defaults in `beforeEach`.

### 6. Name the test in the evidence

"Tests pass" is not evidence. Name the suite, the count and the command. `CLAUDE.md` § Evidence.

### 7. A guard suite must bite, and the proof is recorded

A **guard** is a test that asserts a rule over the whole tree rather than one unit: `routePermissionGuard.p604` (every route gated, ADR-058), `twoTenantRoutes.guard` (rule 3), `schemaAsMiddleware.p911` (no schema method passed to a router), `noConsole.a42`, `nodeVersion.a257`, `auditInTransaction.p611`, `rawSqlTenantPredicate.d05`, `includeRequired.d12`, `unscopedModels.d17`, `jobContext.w12`, `istanbulIgnore.a32` and the rest ADR-087 Amendment 4 lists. Three rules:

- **A bite proof, not a green run.** Plant the forbidden pattern in a scratch file **inside the scanned tree**, run only that guard, watch it **fail** on the plant, remove the plant, and record the plant and the failing assertion (Amendment 4 has the table for 20 guards). A guard that fails on absence (e.g. `webhookEmit.a11`) is proved the other way round. Several guards also carry an in-suite self-test that plants a route or source and asserts refusal.
- **A guard reads every language the tree is written in.** Until Amendment 4, 17 guards filtered on `.js` and silently scanned less as files converted. A new or edited guard accepts `.ts` (and parses it with `@typescript-eslint/typescript-estree` when it parses at all).
- **An allow-list entry carries its reason, and a stale entry fails.** Raising a ceiling (the `istanbul ignore` count, an exemption list) is a reviewed change, never a fix.

### 8. Live PostgreSQL tests run as the application role

Mocks cannot see grants, triggers or SQL the database rejects. A `*.live.test.*` suite runs against a disposable PostgreSQL 18 and is **skipped unless its variable is set** (e.g. `DATA_PG_LIVE_TEST=1`, `Q34_PG_LIVE_TEST=1`; each suite's header gives its command). Run it on a scratch database and remove the container and its volume afterwards.

**A test of a grant, a trigger or an isolation property runs as `callibrator_app`**, the role the backend switches to at boot (ADR-062) — as the owner it passes whether the grant exists or not. `auditLogAppendOnly.q34.live.test.ts`, `dataIntegrity.p6.live.test.js` and `dataLayer.dbC`/`dbD` show the pattern. *As-built:* the convention is not applied uniformly — most live suites connect as the owner, and each has its own variable — recorded as AUDIT A-283.

### 9. The validation contract is pinned byte for byte

`backend/src/tests/contracts/validation/` (P9-11) holds one `<file>.validator.contract.test.ts` per validator plus `middleware.contract.test.ts`, driven by `harness.ts` over a real Express app, the real `errorHandler` and a real fetch. Each asserts the **status, content type and body text** of the 400 in production and outside it. A conversion or refactor may change a suite's import, never its literals; a changed literal is a **contract change** and needs a record naming the frontend impact. The frontend's `*.service.test.ts` files are the other half: they prove what the client sends, and only a live call proves the endpoint answers that way.

### 10. The P9-00 baseline is the behaviour oracle for a conversion

The live E2E set recorded in `MEMORY/records/P9-00.md` (53 of 53 specs, 392 tests, against the JavaScript tree at `35ebd76`, ADR-092) is re-run against an image **built from the branch** by every conversion card. A spec that leaves the set, a changed per-spec pass count, a new 429 or a new 5xx in the access log is a behaviour change. Two traps it recorded: leave `E2E_MFA_STATE_FILE` unset for a multi-identifier run, and space consecutive runs for the `tenantCreate` budget.

## Where Mocks Cannot Help

Mocked tests cannot catch:

- SQL that the real database rejects;
- a property a real library does not have;
- an ignore rule that keeps files out of the repository;
- a header the reverse proxy drops;
- configuration the deployment never set.

Every one of those shipped in 2026-09 behind a green suite. The live E2E suite and a clean-clone CI build (P7-01) are the layers that catch them.

## Writing a Regression Test

When fixing a bug, the test that proves it:

1. **fails** on the old code — check this, do not assume it;
2. carries a comment naming the incident: what broke, where, what the symptom was;
3. asserts the behaviour a user relies on, not the mechanism of the fix.

## TypeScript Tests (as-built)

**A NEW backend test file is `.ts`** (ADR-087 Amendments 1 and 2): the ratchet (`npm run ratchet`) counts tests and fails on any `.js` path not in `backend/.ts-ratchet.json`. A `.ts` test may import a module that is still `.js` (`typecheck` accepts it through `allowJs`, and tests are never built). Existing `.js` tests convert with their module, not before.

- **Transform:** `backend/jest.transform.js` runs the backend's own `@babel/core` 8 with `@babel/preset-typescript` and `@babel/plugin-transform-modules-commonjs` (ADR-087 — `@swc/jest`, ADR-038's choice, breaks `jest.spyOn` on a converted export; babel-jest paired the root Babel 7 core with Babel 8 presets and leaked type arguments). It **erases types and checks none**: a type error in a test passes `jest` and fails `npm run typecheck`, which is the gate.
- **No hoisting.** The transform runs no `jest.mock` hoist plugin, so a `.ts` test registers its mocks first and then loads runtime modules with `jest.requireActual<typeof M>(…)`, typed through an erased `import type * as M` (see rule 3's example).
- **Type-level tests** are ordinary tests with used `@ts-expect-error` lines: an unused one fails the typecheck, so `modelTypes.p910.test.ts` proves, for example, that a raw string is refused where a `TenantId` goes and that `tenantId` on `Session` does not compile.
- **Run the suite through the npm scripts** (`npm test`, `npm run test:coverage`), which pass `--experimental-vm-modules` (A-99), on the Node major in `.nvmrc` (26) — `src/tests/setup/nodeMajor.globalSetup.js` refuses any other.
- The 100% threshold does not move. Test files follow the same strictness as source — an `any` in a test hides a contract change as well as one in source does.
