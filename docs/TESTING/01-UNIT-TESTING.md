# 01 — Unit Testing

Jest 30. `backend/src/tests/` (342 files) and `frontend/**/__tests__/`.

---

## Commands

```bash
npm test                # --forceExit
npm run test:unit
npm run test:watch
npm run test:coverage   # the gate
```

`--max-old-space-size=4096` on every jest invocation — the suite is large enough to exhaust the default heap.

`--forceExit` is there because open handles (Redis, RabbitMQ, the MQTT broker) otherwise keep the process alive. It hides handle leaks, which is a trade-off worth knowing about.

## The Gate

| Workspace | Threshold | Status |
|---|---|---|
| Backend | **100%** | **currently failing** |
| Frontend | 70% | |

The backend is below threshold: the demo seeder, certificate submit-for-approval, `qms.validator`, the retention `legalHoldSchema`, the tenant subdomain-derivation branch and the param-merge branches all added uncovered code.

A 100% line gate does not mean the code is well tested. It means every line executed at least once — which a single happy-path call achieves for most functions. **The gate is a floor, not a goal.**

## Services Are Where It Matters

Business logic lives in the 76 services. For each function:

| Assertion | Why |
|---|---|
| The happy path | |
| **Each error branch, with its status code** | a 404 that should be 409 is a real defect |
| **Rollback leaves no partial state and no audit row** | catches an audit write that escaped its transaction |
| **Idempotency: the second call is a no-op** | RabbitMQ redelivers, Stripe retries |
| **Two-tenant isolation** | the wrong tenant gets nothing |

The rollback assertion is the one most often missing.

```js
it("writes no audit row when the transaction rolls back", async () => {
  jest.spyOn(Device, "update").mockRejectedValueOnce(new Error("boom"));
  await expect(service.recordCalibration(payload)).rejects.toThrow();
  expect(await AuditLog.count()).toBe(0);
});
```

An audit row that survives a rolled-back action records something that did not happen.

## Status Codes Are Behaviour

```js
await expect(service.approve(draftCert.id))
  .rejects.toMatchObject({ status: 409 });   // NOT 400, NOT 500
```

Before ADR-035 this threw a plain `Error` and surfaced as a **500** — and there was no submit transition at all, so approval was unreachable. The 500 hid the design gap.

Assert the status, not merely that it throws.

## Models

| Assertion |
|---|
| state-machine transitions: legal ones succeed, illegal ones throw with the right status |
| `VIRTUAL` columns compute correctly — `risks.rpn`, `supplier_scorecards.overallScore` |
| `defaultScope` excludes secrets |
| soft delete sets `isDeleted` (**not** `is_deleted` — that silently does nothing) |

## Middleware

| Assertion |
|---|
| `auth` rejects a suspended tenant with 403 |
| `auth` honours `x-tenant-id` **only** for `SUPERADMIN` — and **ignores** it otherwise, rather than rejecting |
| `dynamicAccess` allows the granted role and **403s the others** |
| `rbac` compares levels numerically |
| `enforceQuota` rejects **before** the handler runs |
| `tenantScope` denies when no tenant resolves |

The `x-tenant-id` case is subtle: ignored, not rejected, so a probe returns the caller's own data rather than an error confirming the header means something.

## Validators

**Test the rejections.** A validator test that only proves valid input passes proves nothing.

| Assertion |
|---|
| every ENUM rejects a value outside its set, with **400** |
| `tenantId` in the body is **forbidden** |
| attribution fields (`performedBy`, `createdBy`) in the body are forbidden |
| a path parameter is merged before validation |

A bad enum reaching the database always produces a **500 rather than a 400**. That is the signature of a missing validator, and it sends the investigation to the wrong layer.

## Mocking

Mock the **boundary**, not the layer under test.

| Mock | Do not mock |
|---|---|
| External HTTP (Stripe, the LLM) | the service being tested |
| SMTP | the model being tested |
| The clock, for time-dependent logic | Sequelize entirely |

A service test that mocks its own models tests the mock. Use a real database where it is cheap — many of these are integration tests in unit clothing, and that is fine.

## The Self-Verifying Trap

**A test generated from the code it tests verifies consistency, never correctness.**

A redaction test iterating the same key set the redactor uses cannot catch a key being **deleted** from that set. Both sides change together; the test stays green.

Fixes: an independently maintained list of things that must never appear, or a mutation check.

## Mutation Checking

Prove a test works by **breaking the thing it guards**:

```
drop a database constraint      → the right test fails
remove a redaction key          → the right test fails
delete a tenant predicate       → the IDOR sweep fails
```

**A test nobody has ever seen fail is a test nobody knows is connected.**

## Frontend Unit Tests

Test behaviour, not implementation:

```tsx
expect(screen.getByRole("dialog")).toBeInTheDocument();   // ✓
expect(wrapper.state.isOpen).toBe(true);                   // ✗
```

Query by role and accessible name. A suite that queries `data-testid` everywhere would still pass if the component were unusable with a keyboard.

### The three-state assertion

Every list component needs three tests, and this is the pair that matters:

```tsx
it("renders ErrorState when the request fails", …)   // NOT EmptyState
it("renders EmptyState when the list is genuinely empty", …)
it("renders rows when data arrives", …)
```

Rendering an empty list on failure is a lie about a compliance figure. These two are easy to write as one test that passes for the wrong reason — assert the **component**, not merely the absence of rows.

### Stores

| Assertion |
|---|
| initial state |
| each action's effect |
| **cleared on logout** |
| **cleared on tenant switch** |

The second is a real leak. The third is a **cross-tenant leak in the browser**, and no backend IDOR test will find it.

## What Unit Tests Cannot Tell You

| Question | Answered by |
|---|---|
| Does the endpoint exist? | **live E2E** |
| Does it return the expected envelope? | **live E2E** |
| Is the tenant predicate applied end to end? | **live E2E, two tenants** |
| Does the whole flow work? | browser suite |
| Does the control actually exist? | **mutation check** |

3,863 unit and mock tests passed while 13 endpoints were broken. Unit tests are necessary and they are not sufficient.
