# 09 — Testing Conventions

How tests are written here, and the specific ways tests in this repository have lied.

---

## The Layers

| Layer | Where | What it proves | State |
|---|---|---|---|
| unit | `backend/src/tests/**` (excl. `e2e/`) | a function's logic with its dependencies mocked | **290 suites, 5,741 tests, 100% coverage** (2026-09-21) |
| frontend unit | `frontend/src/**/*.test.ts(x)` | components, stores, API clients | 70 suites, 687 tests |
| contract | `frontend/src/api/services/*.test.ts` | the client sends what it believes the API accepts | 51 — **a belief, not a guarantee** until `packages/contracts` (P9-22) |
| live E2E | `backend/src/tests/e2e/` | real HTTP against a real server and PostgreSQL | 53 specs; **never green in one uninterrupted run** (P6-02) |
| browser | `automate/` | a user flow in a browser | **directory not in the repository** (A-20) |

`npm run test:coverage` is the gate. It excludes `config/`, `constants/`, `models/` and `scripts/` from measurement — so a defect in `config/index.js` is invisible to it.

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

### 3. Every `:id` route: a two-tenant test asserting 404

```js
const { tenantA, tenantB } = await createTwoTenants();
const resource = await createResource(tenantB);
const res = await request(app).get(`/api/v1/things/${resource.id}`).set(authFor(tenantA));
expect(res.status).toBe(404);   // not 403, not 200
```

For a mutation, also assert **the row is unchanged** — an error response over a completed write is still a breach.

### 4. Test the bodyless request

Express 5 leaves `req.body` `undefined` when there is no body. Every route that reads the body gets a test that sends none. Most controller tests set `req = { body: {} }`, which is exactly why the `menu-groups` 500 shipped.

### 5. Reset mock implementations between tests

`jest.config.js` has `clearMocks: true` and `resetMocks: false`: call history clears, **implementations persist**. A `mockRejectedValue` in one test leaks into every later test in the file. Set defaults in `beforeEach`.

### 6. Name the test in the evidence

"Tests pass" is not evidence. Name the suite, the count and the command. `CLAUDE.md` § Evidence.

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

## TypeScript (target)

Tests convert **with** their module under Phase 9, transformed by `@swc/jest`. The 100% threshold does not move. Test files follow the same strictness as source — an `any` in a test hides a contract change as well as one in source does.
