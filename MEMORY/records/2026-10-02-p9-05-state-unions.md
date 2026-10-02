# 2026-10-02 — P9-05: every state machine's statuses from one source

**ADR:** ADR-087 Amendment 30 · **Spec:** `MEMORY/specs/P9-05-shared-types.md` (written first; the card's "Spec required" file did not exist) · **Card:** P9-05 · **By:** the P9-22 helper

## What changed

| Area | Change |
|---|---|
| New | `packages/contracts/src/states.ts`: frozen tuples and unions for certificate (`CERTIFICATE_STATE` object as well), stock transfer, stock opname, work order, tenant lifecycle (`TENANT_LIFECYCLE_STATE` as well), webhook delivery and workflow instance. CAPA is re-exported from `qmsValues`, already its single source |
| Contracts | `certificate.ts` (`CERTIFICATE_STATUS` = the tuple), `stock.ts` (the two local lists and the two inline `z.enum([...])` lists), `maintenance.ts` |
| Models | `certificate` (`STATUS` = `CERTIFICATE_STATE`, ENUM from the tuple), `maintenanceWorkOrder`, `stockOpname`, `stockTransfer`, `webhookDelivery`, `workflowInstance`, `tenant` |
| Other copies, found by the guard | `certificates.openapi.ts`, `stock.openapi.ts` ×2, `qms.openapi.ts`, `webhooks.openapi.ts`, `docs/openapi/tenantSchemas.ts`, `services/admin.service.ts` (`VALID_STATUSES`) |
| Constants | `constants/tenantStatus.ts`: `TENANT_STATUS` IS `TENANT_LIFECYCLE_STATE` |
| Guard | `tests/guards/stateUnions.p905.guard.test.ts` (11 tests):<br>• each model's real `status` ENUM equals its tuple, in order;<br>• the stock schemas accept exactly the tuple;<br>• the contracts and backend objects are the same objects;<br>• no source file writes a list out again |

## Evidence
- **The guard fails before and under a plant:**
  - the source scan found **7** written-out copies, all now imports;
  - an extra ENUM value planted in `stockOpname.model` (scratch mirror) fails it.
- `openapi.json` regenerated **byte-identical** (`cmp`).
- The values and their order are unchanged, so the database ENUMs, validators and responses are unchanged.
- Full backend suite 862/862 (0 failed); contracts package 47 suites, 1,084 tests; contracts typecheck 0.
- typecheck: only another lane's in-flight `supplierScorecard.route` error.
- `build:dist` and `load:check` (dist and src) OK.
- `switch-exhaustiveness-check` was already an error for `.ts`; the unions are what it checks.

## Observations (not changed)
- The tenant request body's `status` (`ACTIVE`/`INACTIVE`/`SUSPENDED`, contracts `tenant.ts`) is a different field from `tenants.status` (ADR-112 already governs it). The spec names them apart.
- The frontend typecheck has one error in `stores/calibrationStore.ts:188`, on the certificate TYPE field, not a status. It belongs to another lane.

## Still open on the card
- The other aggregate-root brands.
- `tenant` on `Request`.
- The last `req as AuthedRequest` cast (`scim.route.ts`).
- One deny-sentinel constant.
