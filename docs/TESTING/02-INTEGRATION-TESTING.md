# 02 — Integration Testing

Tests that cross a boundary — the database, Redis, the queue — without needing a running HTTP server.

Live HTTP testing is [`03-E2E-TESTING.md`](./03-E2E-TESTING.md).

---

## What Belongs Here

| Concern | Why it needs a real dependency |
|---|---|
| **Tenant scoping** | the global Sequelize hooks only fire against a real query |
| Transactions and rollback | a mock cannot roll back |
| Constraints, ENUMs, delete rules | the database enforces them, not the model |
| Soft delete and `defaultScope` | scope resolution is a Sequelize behaviour |
| Migrations | the only way to know a column exists |
| Redis idempotency | `SET NX` semantics are the point |
| Worker consumption | redelivery is the point |

## Tenant Scoping — the most important integration test

The hooks are installed globally by `models/index.js` and fire on real queries. A mocked model tests nothing.

```js
it("denies when no tenant resolves", async () => {
  await tenantStorage.run({ tenantId: null, isSuperAdmin: false }, async () => {
    expect(await Device.findAll()).toHaveLength(0);   // NOT "all rows"
  });
});

it("filters to the active tenant", async () => {
  await tenantStorage.run({ tenantId: tenantA.id }, async () => {
    const rows = await Device.findAll();
    expect(rows.every((r) => r.tenantId === tenantA.id)).toBe(true);
  });
});

it("stamps tenantId on create, ignoring the body", async () => {
  await tenantStorage.run({ tenantId: tenantA.id }, async () => {
    const d = await Device.create({ name: "x", tenantId: tenantB.id });
    expect(d.tenantId).toBe(tenantA.id);
  });
});
```

The first is the deny branch — the fix for the fail-open hole where a principal with no tenant saw **every** tenant's rows.

## Constraints Are Tested by Violating Them

```js
it("rejects a duplicate serial number", async () => {
  await Device.create({ serialNumber: "IP-001", … });
  await expect(Device.create({ serialNumber: "IP-001", … })).rejects.toThrow();
});
```

**Test constraints against the database, not the model.** A model validation is not a constraint, and the two can disagree.

### The SQLSTATE distinction

`RESTRICT` raises SQLSTATE **23001**; `NO ACTION` raises **23503**. Both appear in this schema, and code mapping only 23503 will 500 on the common case.

Test which one a given relationship produces.

## Transactions and Rollback

```js
it("leaves no partial state and no audit row on failure", async () => {
  jest.spyOn(Device, "update").mockRejectedValueOnce(new Error("boom"));
  await expect(service.recordCalibration(payload)).rejects.toThrow();

  expect(await CalibrationRecord.count()).toBe(0);
  expect(await AuditLog.count()).toBe(0);        // ← the assertion most often missing
});
```

An audit row that survives a rolled-back action records something that did not happen. An action that commits without its audit row is unattributable.

### Quantity moves exactly once

```js
it("moves stock exactly once across the transfer lifecycle", async () => {
  const t = await service.createTransfer({ from: a.id, to: b.id, quantity: 10 });

  await service.markInTransit(t.id);
  expect(await qty(a)).toBe(90);
  expect(await qty(b)).toBe(0);      // NOT yet

  await service.markReceived(t.id);
  expect(await qty(a)).toBe(90);
  expect(await qty(b)).toBe(10);
});
```

Never both at once, never neither (BR-10).

## Migrations

Two runs, and they fail differently.

| Run | Catches |
|---|---|
| Against an **empty** database | ordering problems |
| Against a **populated** database | constraint violations against real values |

### Verify the columns, not the log

**A migration wrapped in a blanket `try/catch` around `describeTable` is recorded as applied while doing nothing.**

```js
it("actually added the column", async () => {
  const [rows] = await sequelize.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'calibration_devices' AND column_name = 'uncertainty_budget'
  `);
  expect(rows).toHaveLength(1);
});
```

The migration log is not evidence. So is `make migrate-verify`.

### Sweep tests

A sweep is worth more than a per-table assertion, because it covers tables that do not exist yet:

```js
it("every table with updated_at has its trigger", …)
it("every tenant-scoped table indexes tenant_id", …)
it("every seeded role has a ROLE_LEVELS entry", …)
```

The last one catches the silent failure mode: a role missing from `ROLE_LEVELS` fails every privileged gate with nothing explaining why.

## Redis Idempotency

```js
it("the second consumer is a no-op", async () => {
  expect(await claim(key)).toBe(true);
  expect(await claim(key)).toBe(false);
});

it("a failed attempt releases its claim", async () => {
  await expect(handleWithFailure(msg)).rejects.toThrow();
  expect(await claim(key)).toBe(true);   // ← reclaimable
});
```

The second is the one usually missing. Without the release, "retry three times" becomes "try once, no-op twice" — and the logs of that are **identical to three successes**, which is why it survives review.

## Database Grants — as the application role

```js
it("cannot delete an audit row as the application role", async () => {
  const app = new Sequelize(APPLICATION_ROLE_URL);   // NOT the owner
  await expect(app.query("DELETE FROM audit_logs")).rejects.toThrow();
});
```

**As the owner this passes whether the `REVOKE` exists or not** — which makes it worse than no test, because it produces a green tick for an absent control.

## Test Data

| Fixture | Why |
|---|---|
| **`createTwoTenants()`** | one line. Twenty lines of setup means the IDOR test gets skipped |
| `createUser(tenant, role)` | |
| `seedDemo()` | ~80 rows; **defect #15 was only visible once there was data** |

`createTwoTenants()` is load-bearing infrastructure, not a convenience.

## Isolation Between Tests

Each test starts from a known state — a transaction rolled back afterwards, or truncation between tests.

Tests that share state pass in one order and fail in another, and the resulting flake gets blamed on the code.

`--runInBand` for anything touching a shared database.

## What Integration Tests Still Cannot Tell You

| Question | Answered by |
|---|---|
| Does the HTTP route exist and is it mounted? | **live E2E** |
| Does the response match the envelope? | **live E2E** |
| Is the permission gate present on the route? | **live E2E** |
| Does the reverse proxy pass the upgrade headers? | deployment verification |

A service can be perfectly correct behind a route nobody mounted.
