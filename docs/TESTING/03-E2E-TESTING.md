# 03 — Live E2E Testing

53 specs, run **against a running server with a real database**: 50 at `backend/src/tests/e2e/modules/<module>.e2e.test.js`, plus `auth`, `authz` and `http` one level up at `backend/src/tests/e2e/`.

```bash
npm run test:e2e        # jest.e2e.config.js, --runInBand, --forceExit
make test-e2e
```

Harness: `setup.js` plus a shared login. **No coverage gate** — these prove contracts, not lines.

---

## Why This Layer Exists

**3,863 tests passed while 13 endpoints were broken.**

Frontend services had been written against endpoints that did not exist, with tests mocking the fabrication. Every test agreed with every other test, and none agreed with the server.

> A mock proves the code calls what the developer believed.
> Only a live call proves the endpoint exists and answers that way.

## Two Operational Rules — both learned by breaking things

### 1. Never suspend the default tenant

Suspending a tenant blocks **every** request from its users (BR-3). The default tenant contains the super-admin, including the session running the test — so suspending it **403s every subsequent request**, including the one that would reverse it.

Recovery required a direct database update.

Three specs — `tenant-lifecycle`, `data-retention`, `feature-flags` — originally grabbed `/tenants/all` `data[0]` in `beforeAll` and did exactly this. They now create a **disposable** tenant.

```js
beforeAll(async () => {
  tenant = await createDisposableTenant();   // ✓
  // tenant = (await api.get("/tenants/all")).data[0];   ✗ that is YOUR tenant
});
```

### 2. Watch the rate limiter

The global budget is 5,000/15 min in production and 100,000 otherwise. Repeated verification runs have exhausted even the non-production budget, producing failures unrelated to the code under test.

If the suite starts failing with 429s, wait for the window rather than debugging the code.

## What Each Spec Asserts

| Assertion | |
|---|---|
| The route **exists** at the path the client uses | |
| The **method** is right — several endpoints use `PATCH` where `PUT` is expected | |
| The **envelope**: rows in `data`, pagination in a **top-level `meta`** | |
| The permission gate is present — an unauthorised role gets 403 | |
| **Two-tenant isolation** — the other tenant gets **404** | |
| Status codes: 400 for validation, **409** for an invalid transition | |

### The envelope assertion is not pedantry

`GET /qms/nc`, `/qms/capa` and `/sop` returned `{ total, …, nonConformances: [] }` inside `data`. Every corresponding frontend list rendered **empty, with no error anywhere**.

```js
expect(Array.isArray(res.body.data)).toBe(true);      // rows in data
expect(res.body.meta).toHaveProperty("total");        // meta is a SIBLING
expect(res.body.data).not.toHaveProperty("rows");     // never nested
```

## The IDOR Sweep

The most important test in the project.

```js
describe("IDOR", () => {
  it("returns 404 for another tenant's resource", async () => {
    const { a, b } = await createTwoTenants();
    const device = await asTenant(a).post("/calibration-devices", payload);

    for (const call of [
      () => asTenant(b).get(`/calibration-devices/${device.id}`),
      () => asTenant(b).put(`/calibration-devices/${device.id}`, payload),
      () => asTenant(b).delete(`/calibration-devices/${device.id}`),
    ]) {
      expect((await call()).status).toBe(404);   // NOT 403, NOT 200
    }

    const list = await asTenant(b).get("/calibration-devices");
    expect(list.body.data.find((d) => d.id === device.id)).toBeUndefined();
  });
});
```

**404, not 403.** A 403 says "this exists and you may not have it", turning id enumeration into a tenant-membership oracle.

### `createTwoTenants()` is load-bearing

A **one-line fixture** is what decides whether this test gets written for a new endpoint. Twenty lines of setup means it gets skipped, and the sweep decays into covering only what someone had time for.

### Cases easy to miss

- an authenticated principal with **no** tenant sees zero rows — the deny branch
- global search returns only A's rows, across every entity type it unions
- a batch job started by A produces a result containing only A's data
- a `document_chunks` retrieval for A cites only A's documents — **the highest-risk instance**
- a Kanban query starting from a child table joins to the project

## Tests That Documented a Bug

Several agent-written specs originally asserted the **broken** behaviour — the QMS and SOP envelope deviation, and the feature-flag and lifecycle 400s. They were updated to assert the corrected contract when the defects were fixed.

**A test written against observed behaviour without asking whether the behaviour is correct encodes the bug.** Always ask.

## Demo Data Finds What an Empty Database Hides

`SEED_DEMO=true` seeds ~80 rows across every business module, idempotently, with teardown.

**Defect #15 — the certificate list returning zero rows because four includes were INNER JOINs — was only visible once there was data.** Every draft has null `approvedBy` and `signedBy`, so every draft vanished; an empty database has no drafts to lose.

An empty database hides an entire class of query defect.

**`SEED_DEMO` must never be true in production.**

## Current State, Stated Honestly

Every fix has been verified live and **individually**.

**A single clean full-suite pass in one uninterrupted run has not been achieved**, because the rate-limit window kept needing to reset.

**That is a gap, not a pass.** A suite that has never passed as a suite has not passed, and saying so is more useful than a status report that rounds up.

It is the third item under "now" in [`../PLAN/16-IMPLEMENTATION-ROADMAP.md`](../PLAN/16-IMPLEMENTATION-ROADMAP.md).

## Environment-Dependent Failures

Not code defects, and worth recognising as such:

| Endpoint | Fails because |
|---|---|
| `POST /ai/query` | no AI/embeddings provider configured |
| `POST /gdpr/export` | same |
| Certificate PDF | `PUPPETEER_EXECUTABLE_PATH` unset outside Docker — **fails at first use, not startup** |

## Writing a New Spec

1. Read the **actual route file** in `backend/src/routes/api/` — not Swagger, which drifts (the GDPR endpoints already disagree).
2. Note the verb, the path shape, and **where the identifier lives** — path, body, or query string.
3. Assert existence, method, envelope, permission gate, **two-tenant 404**, and status codes.
4. Use a **disposable** tenant for anything destructive.
5. Ask whether the behaviour you are asserting is **correct**, not merely current.

## Checklist Before Calling the Suite Green

- [ ] one **uninterrupted** full run
- [ ] no 429s in the output
- [ ] no spec touched the default tenant destructively
- [ ] the IDOR sweep covered every `:id` route added since the last run
- [ ] any environment-dependent failure is **named** as such, not counted as a pass
