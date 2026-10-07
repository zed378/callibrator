# Multi-Tenancy

How one hospital is kept out of another's data, where that isolation is deliberately crossed, and where it still leaks.

**Read [`../SECURITY/05-MULTI-TENANCY-SECURITY.md`](../SECURITY/05-MULTI-TENANCY-SECURITY.md) first.** It is mandatory reading for every engineer (`CLAUDE.md`), and it defines the mechanism — global Sequelize hooks, deny by default, `NO_TENANT_UUID`, 404 never 403. Every document in this folder **extends** it and none repeats it.

> **Target standard: TypeScript, strict (ADR-038).** The backend is mixed JavaScript and TypeScript during Phase 9 (ADR-087). The isolation core — `backend/src/utils/tenantScope.util.ts` and `backend/src/middlewares/tenantContext.middleware.ts` — was converted by 2026-09-28; most modules these documents describe are still `.js`. Each document names the files it describes and labels current behaviour **as-built**.

> **Target — a second scope dimension inside a tenant (ADR-124, decided 2026-10-07, not built).** Health facilities become clients inside the tenant that serves them, and a facility's own staff are confined to their facility by the same hooks, deny-by-default, cross-facility = 404. Summary in [`../SECURITY/05-MULTI-TENANCY-SECURITY.md`](../SECURITY/05-MULTI-TENANCY-SECURITY.md) § Target — the Facility Dimension. No cross-tenant path is added.

## Documents

| | Document | Covers |
|---|---|---|
| 01 | [Tenant Hierarchy, Lifecycle and Backup](./01-TENANT-HIERARCHY-AND-SUBORGS.md) | why `Tenant` is outside the hooks and what gates stand in; the parent/child tree; lifecycle states and who moves them; backup and restore scope |
| 06 | [Realtime Isolation](./06-REALTIME-ISOLATION.md) | tenant context over a Socket.IO connection, and where it does not reach |
| 07 | [Super-Admin and Cross-Tenant Operations](./07-SUPERADMIN-CROSS-TENANT-OPERATIONS.md) | one inventory of every route and function that is meant to act across tenants, with its gate and its reason |
| 08 | [Cross-Tenant Protection](./08-CROSS-TENANT-PROTECTION.md) | the control stack, the models the hooks cannot scope, raw SQL, and the uniqueness oracles |

`00`, `02`, `03`, `04` and `05` are **unassigned**. A link to a `MULTI-TENANCY/` path absent from the table above is a broken link, not a hidden document.

## The Short Version

**Isolation is automatic only for a model with a tenant column.** `Tenant` itself and `Role` have none, so on those models the route gate is the entire control — see [`01`](./01-TENANT-HIERARCHY-AND-SUBORGS.md) and [`08`](./08-CROSS-TENANT-PROTECTION.md).

**The super admin skips the predicate and every permission check.** What that reaches is listed in [`07`](./07-SUPERADMIN-CROSS-TENANT-OPERATIONS.md), once.

**The hierarchy grants no visibility** (ADR-084, Q-05). A parent tenant never sees a child's data because of the tree.

## Related

| For | Read |
|---|---|
| the mandatory mechanism | [`../SECURITY/05-MULTI-TENANCY-SECURITY.md`](../SECURITY/05-MULTI-TENANCY-SECURITY.md) |
| the realtime transport itself | [`../ARCHITECTURE/10-REALTIME-ARCHITECTURE.md`](../ARCHITECTURE/10-REALTIME-ARCHITECTURE.md) |
| the findings behind the open items | [`../../TASKS/AUDIT-2026-09-REMEDIATION.md`](../../TASKS/AUDIT-2026-09-REMEDIATION.md) § A-01, A-37, A-38, A-39 |
