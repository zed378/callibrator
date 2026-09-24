# Audit 2026-09 — Data Layer

Findings from a read-only audit of the **data layer** on **2026-09-23**: the 72 Sequelize models in
`backend/src/models/`, the 19 migrations in `backend/src/migrations/`, the global tenant-scoping
hooks in `backend/src/utils/tenantScope.util.js`, every `sequelize.query` in `backend/src`, and the
read patterns in `backend/src/services/`.

Task ids are `D-nn`. They sit beside the `A-nn` cards in
[`AUDIT-2026-09-REMEDIATION.md`](./AUDIT-2026-09-REMEDIATION.md) and use the same card shape.

**Nothing here was changed.** No code, no migration, no configuration. This document is the only
file this audit wrote.

**No database was reachable from the auditing machine.** Every claim below is read from code. Where
a claim can only be settled against a live database the card says so and gives the exact `psql`
query; those cards' first checkbox is the verification. Section
[§ What Needs a Database](#what-needs-a-database) collects all of them.

**Two corrections to `CLAUDE.md` are owed** and are recorded as D-05 and D-12 — the traps table
describes the hooks and the raw-SQL rule more confidently than the code supports.

---

## Summary

| Id | Finding | Severity | Verified | Status |
|---|---|---|---|---|
| D-01 | **`bulkCreate` and `upsert` are outside the tenant hooks entirely** — no predicate, no stamping | **critical** | from code | **DONE** 2026-09-24 |
| D-02 | tenant-backup restore writes `users` rows straight from a caller-supplied payload | **high** | from code | TODO |
| D-03 | the GDPR retention purge deletes across **every tenant** when the policy is global | **high** | from code | **DONE** 2026-09-24 |
| D-04 | `calibration_devices.serial_number` is **globally unique** — a cross-tenant device oracle, and a real collision between two hospitals | **high** | from code | TODO |
| D-05 | one `sequelize.query` carries no tenant predicate; `CLAUDE.md` says they all do | medium | from code | TODO |
| D-06 | `users.email` **and `users.username`** are globally unique — A-37 is wider than SCIM | **high** | from code | TODO |
| D-07 | `restoreStatic()` on **seven** models (the card first said six) was a **silent no-op** — `is_deleted` written where the attribute is `isDeleted` | **high** | from code | **DONE** 2026-09-24 |
| D-08 | `audit_logs` has **no indexes at all** — and it is the fastest-growing table | **high** | from code | TODO |
| D-09 | migration 0011 **unconditionally drops `e_signature_records` with `CASCADE`** on `up` | **high** | from code | TODO |
| D-10 | `calibration_records.performed_by` → `users` **ON DELETE CASCADE** — deleting a user deletes the calibration evidence | **high** | from code | TODO |
| D-11 | `hardDeleteUser()` is a **soft** delete — GDPR Art. 17 erasure does not erase | **high** | from code | TODO |
| D-12 | an `include` of a default-scoped model without `required: false` is an INNER JOIN — 26 sites | medium | from code + the repo's own comment | TODO |
| D-13 | `db.sync()` never alters: a model column with no migration is **absent forever** on an existing database | medium | **needs psql** | TODO |
| D-14 | five migrations record themselves applied on any `describeTable` error | medium | from code | TODO |
| D-15 | `certificates.certificate_number` is globally unique | medium | from code | TODO |
| D-16 | `roles` is a **global table** — no `tenant_id`, globally unique `name` (A-38, confirmed and widened) | medium | from code | TODO |
| D-17 | 19 models have **no tenant column** and are therefore not scoped at all | medium | from code | TODO |
| D-18 | `signature_records` CASCADE-deletes with its workflow, its step and its tenant | medium | from code | TODO |
| D-19 | `iot_readings` has no retention policy and no `(tenant_id, timestamp)` index | medium | from code | TODO |
| D-20 | fifteen models declare **no `indexes` block at all** — foreign keys without indexes | medium | from code | TODO |
| D-21 | DECIMAL comes back from `pg` as a **string**; `invoices.amount` / `tax` are never coerced | medium | from code | TODO |
| D-22 | `attachments.resource_id` is a polymorphic id with **no foreign key** and no cleanup | medium | from code | TODO |
| D-23 | `hardDeleteOffboardedTenant` force-deletes four tables and leaves the rest to CASCADE or to fail | medium | from code | TODO |
| D-24 | unbounded reads: DSAR export, dashboard trend, SOP fan-out, signature history | medium | from code | TODO |
| D-25 | two soft-delete mechanisms coexist (`paranoid` + `isDeleted`) with no rule for which | low | from code | TODO |
| D-26 | 46 native `ENUM` types, none derived from the constants they mirror | low | from code | TODO |
| D-27 | 14 `JSON`/`JSONB` columns with no declared shape | low | from code | TODO |
| D-28 | `"UsageMetrics"` is the only camelCase, non-`underscored` table in the schema | low | from code | TODO |
| D-29 | migration `0019` reviewed line by line — **correct**; two residual risks named | info | from code | — |

**Counts:** 1 critical · 8 high · 15 medium · 4 low · 1 informational.

---

## Reference Table 1 — Every Model, and Whether It Is Tenant-Scoped

A model is scoped by the global hooks **if and only if** `rawAttributes` has `tenantId` or
`tenant_id` (`backend/src/utils/tenantScope.util.js:38-44`). There is no other mechanism. `Session`
is scoped despite looking unscoped, because it declares `tenant_id` in snake_case and `tenantKeyOf`
checks both spellings.

Read as: **scoped** = the hooks add the predicate to `findAll`/`count`/bulk update/bulk destroy and
stamp the tenant on `create`/`update`. **NOT scoped** = nothing in the ORM constrains it; only an
explicit `where` in the service does.

| # | Model | Table | Tenant column | Scoped? | `paranoid` | Soft-delete flag |
|---|---|---|---|---|---|---|
| 1 | ApiKey | `api_keys` | `tenantId` | **yes** | yes | `isDeleted` |
| 2 | AssetFinance | `asset_finances` | `tenantId` | **yes** | yes | — |
| 3 | Attachment | `attachments` | `tenantId` | **yes** | yes | `isDeleted` |
| 4 | AuditLog | `audit_logs` | `tenantId` | **yes** | no | — |
| 5 | BatchJob | `batch_jobs` | `tenantId` | **yes** | no | — |
| 6 | CalibrationDevice | `calibration_devices` | `tenantId` | **yes** | yes | `isDeleted` |
| 7 | CalibrationRecord | `calibration_records` | `tenantId` | **yes** | yes | `isDeleted` |
| 8 | Capa | `capas` | `tenantId` | **yes** | yes | — |
| 9 | **Category** | `categories` | — | **NO** | yes | `isDeleted` |
| 10 | Certificate | `certificates` | `tenantId` | **yes** | yes | — |
| 11 | ConsentRecord | `consent_records` | `tenantId` | **yes** | no | — |
| 12 | CustomDomain | `custom_domains` | `tenantId` | **yes** | no | — |
| 13 | DataRetentionPolicy | `data_retention_policies` | `tenantId` (**nullable**) | **yes**¹ | no | — |
| 14 | DocumentChunk | `document_chunks` | `tenantId` | **yes** | no | — |
| 15 | DsarRequest | `dsar_requests` | `tenantId` | **yes** | no | — |
| 16 | ESignatureRecord | `e_signature_records` | `tenantId` | **yes** | no | — |
| 17 | Invoice | `invoices` | `tenantId` | **yes** | no | — |
| 18 | IotReading | `iot_readings` | `tenantId` | **yes** | no | — |
| 19 | KanbanCard | `kanban_cards` | `tenantId` | **yes** | yes | — |
| 20 | **KanbanCardAssignee** | `kanban_card_assignees` | — | **NO** | no | — |
| 21 | **KanbanCardLabel** | `kanban_card_labels` | — | **NO** | no | — |
| 22 | **KanbanCardRelation** | `kanban_card_relations` | — | **NO** | no | — |
| 23 | **KanbanColumn** | `kanban_columns` | — | **NO** | no | — |
| 24 | **KanbanLabel** | `kanban_labels` | — | **NO** | no | — |
| 25 | KanbanProject | `kanban_projects` | `tenantId` | **yes** | yes | — |
| 26 | **KanbanProjectMember** | `kanban_project_members` | — | **NO** | no | — |
| 27 | **KanbanSprint** | `kanban_sprints` | — | **NO** | no | — |
| 28 | MaintenanceWorkOrder | `maintenance_work_orders` | `tenantId` | **yes** | yes | — |
| 29 | **MenuGroup** | `menu_groups` | — | **NO** | no | — |
| 30 | NonConformance | `non_conformances` | `tenantId` | **yes** | yes | — |
| 31 | Notification | `notifications` | `tenantId` | **yes** | no | — |
| 32 | **NotificationState** | `notification_states` | — | **NO** | no | — |
| 33 | PlanQuota | `plan_quotas` | `tenantId` | **yes** | no | — |
| 34 | **Post** | `posts` | — | **NO** | yes | `isDeleted` |
| 35 | **PostCategory** | `post_categories` | — | **NO** | no | — |
| 36 | Risk | `risks` | `tenantId` | **yes** | yes | — |
| 37 | **Role** | `roles` | — | **NO** | yes | `isDeleted` |
| 38 | **RoleMenuPermission** | `role_menu_permissions` | — | **NO** | no | — |
| 39 | Session | `sessions` | **`tenant_id`** (snake) | **yes** | no | `is_deleted` (snake) |
| 40 | SignatureRecord | `signature_records` | `tenantId` | **yes** | yes | — |
| 41 | SignatureWorkflow | `signature_workflows` | `tenantId` | **yes** | yes | — |
| 42 | SignatureWorkflowStep | `signature_workflow_steps` | `tenantId` | **yes** | yes | — |
| 43 | SopDocument | `sop_documents` | `tenantId` | **yes** | yes | — |
| 44 | SopTrainingAcknowledgment | `sop_training_acknowledgments` | `tenantId` | **yes** | no | — |
| 45 | Stock | `stocks` | `tenantId` | **yes** | yes | `isDeleted` |
| 46 | StockAdjustment | `stock_adjustments` | `tenantId` | **yes** | no | — |
| 47 | StockOpname | `stock_opnames` | `tenantId` | **yes** | no | — |
| 48 | StockTransfer | `stock_transfers` | `tenantId` | **yes** | no | — |
| 49 | StorageLocation | `storage_locations` | `tenantId` | **yes** | no | — |
| 50 | Subscription | `subscriptions` | `tenantId` | **yes** | no | — |
| 51 | SupplierScorecard | `supplier_scorecards` | `tenantId` | **yes** | yes | — |
| 52 | **Tenant** | `tenants` | — (it *is* the tenant) | **NO** | yes | `isDeleted` |
| 53 | TenantBackup | `tenant_backups` | `tenantId` | **yes** | yes | — |
| 54 | TenantHierarchy | `tenant_hierarchies` | `tenantId` | **yes** | no | — |
| 55 | TenantKey | `tenant_keys` | `tenantId` | **yes** | yes | — |
| 56 | TenantSettings | `tenant_settings` | `tenantId` | **yes** | no | — |
| 57 | Ticket | `tickets` | `tenantId` | **yes** | yes | — |
| 58 | **TicketComment** | `ticket_comments` | — | **NO** | no | — |
| 59 | TicketCounter | `ticket_counters` | `tenantId` | **yes** | no | — |
| 60 | UsageAlert | `usage_alerts` | `tenantId` | **yes** | no | — |
| 61 | UsageMetric | `"UsageMetrics"` | `tenantId` (camel column) | **yes** | no | — |
| 62 | User | `users` | `tenantId` (**nullable**) | **yes**¹ | yes | `isDeleted` |
| 63 | **UserMenuPermission** | `user_menu_permissions` | — | **NO** | no | — |
| 64 | Vendor | `vendors` | `tenantId` | **yes** | yes | — |
| 65 | Warehouse | `warehouses` | `tenantId` | **yes** | yes | `isDeleted` |
| 66 | Webhook | `webhooks` | `tenantId` | **yes** | yes | `isDeleted` |
| 67 | WebhookDelivery | `webhook_deliveries` | `tenantId` | **yes** | no | — |
| 68 | Workflow | `workflows` | `tenantId` | **yes** | yes | — |
| 69 | **WorkflowAction** | `workflow_actions` | — | **NO** | no | — |
| 70 | WorkflowInstance | `workflow_instances` | `tenantId` | **yes** | yes | — |
| 71 | **WorkflowStep** | `workflow_steps` | — | **NO** | no | — |
| 72 | *(barrel)* `models/index.js` | — | — | — | — | — |

**53 scoped · 19 unscoped.**

¹ The column is nullable. A row written with `tenantId = NULL` is invisible to every scoped read
(`WHERE tenant_id = '<uuid>'` never matches NULL) and is not reachable through the deny sentinel
either. That is a row nobody can see and nobody can clean up. `users.tenantId` nullable is
deliberate (the platform super-admin); `data_retention_policies.tenantId` nullable means "global
default policy", and that premise is what D-03 turns into a cross-tenant delete.

### What Touches Each Unscoped Model by a Caller-Supplied Id

This is the tenant-isolation attack surface. For each, the thing that stands between a
caller-supplied id and another tenant's data — and whether anything would catch a handler that
forgot it.

| Model | Reached by a caller-supplied id at | What constrains it | If the guard were forgotten |
|---|---|---|---|
| **Tenant** | `controllers/tenantHierarchy.controller.js` (`:parentId`, `:tenantId`), `services/certificate.service.js:301`, `services/dashboard.service.js:208`, `services/meteredBilling.service.js:315,569` | route guards only (`ownTenantGuard` / `superAdminOnly`, added by **A-01**) | cross-tenant read **and write** — this is exactly A-01, and the unscoped model is the root cause A-01 names |
| **Role** | `services/roles.service.js:33,54,106,132,157`, `services/menuGroup.service.js:262,291`, SCIM `/Groups/:id` | route guards; SCIM adds `assertAssignableRole` / `assertMutableGroup` (**A-27**) | rename or delete a role **for every tenant** — A-38 |
| **RoleMenuPermission** | `services/menuGroup.service.js:284,334` (`roleId` + `menuGroupId` from the path) | route guards only | a tenant admin edits another tenant's effective permissions, because roles are shared |
| **MenuGroup** | `services/menuGroup.service.js:226,248,267,302` | route guards only | the menu taxonomy is genuinely global — low risk, but nothing in the model says so |
| **UserMenuPermission** | `services/userPermission.service.js:155,187` (`userId` from the path) | `routes/api/userPermissions.route.js:43,96,130` — **all three routes are `rbac(["SUPERADMIN"])`** | cross-tenant grant/revoke. The whole control is one `rbac` call per route; drop it and there is no second line |
| **KanbanColumn / Label / Sprint / ProjectMember / CardRelation / CardAssignee / CardLabel** | `services/kanban.service.js:559,571,632,658,715,869,951,966,1018,1034,1137` | **every** lookup is `where: { id, projectId }` behind `assertAccess(user, projectId, …)`, and `KanbanProject` **is** scoped | a new handler that omits `projectId` from the `where` reaches another tenant's board. A well-built chokepoint with no backstop |
| **TicketComment** | `services/ticket.service.js:424,444` | `loadTicket(user, ticketId)` resolves the ticket under the tenant scope first | a comment written against a ticket id the caller never loaded |
| **WorkflowStep / WorkflowAction** | `services/workflow.service.js:110,260` (`workflowId` from a scoped parent) | the parent `Workflow` **is** scoped | steps read or deleted for another tenant's workflow |
| **NotificationState** | `services/notification.service.js:319,325` (`notificationId` + `userId`) | `Notification` **is** scoped | read-state written for another tenant's notification |
| **Post / Category / PostCategory** | `services/content.service.js:90,207,242,313,353,368` | **nothing** — the CMS is deliberately global | not an isolation defect; it is a design decision written nowhere in the model. See D-17 |

---

## Reference Table 2 — Every Unique Constraint, and Its Oracle Reachability

"Oracle reachability" = can an authenticated caller in tenant A learn, from an ordinary API
response, that a value exists in tenant B? Ranked most reachable first.

| Rank | Constraint | Declared at | Scope | Oracle reachability | Verdict |
|---|---|---|---|---|---|
| 1 | `users.email` UNIQUE | `user.model.js:30`, index `:157` | **global** | **high** — every user-create path: `POST /api/v1/users`, registration, SCIM `POST /Users`. The duplicate check in front of each is tenant-scoped, so the check passes and the **constraint** rejects | **must be `(tenant_id, email)`** — this is A-37, and it is not SCIM-only |
| 2 | `calibration_devices.serial_number` UNIQUE | `calibrationDevice.model.js:36`, index `:121` | **global** | **high** — `POST /api/v1/calibration-devices` and the CSV bulk import (`services/calibrationDevices.service.js:442`). A serial number is printed on the device; an attacker enumerates plausible ones | **must be `(tenant_id, serial_number)`** — D-04. It also blocks a legitimate case: two hospitals owning the same instrument |
| 3 | `users.username` UNIQUE | `user.model.js:27-31`, index `:156` | **global** | **high** — same routes as email. Usernames are guessable in a way emails are not | **must be `(tenant_id, username)`** — D-06 |
| 4 | `certificates.certificate_number` UNIQUE | `certificate.model.js:60`, index `:167` | **global** | **medium** — numbers are usually generated (`:177`) but are settable on create, and the format is predictable | **should be `(tenant_id, certificate_number)`** — D-15 |
| 5 | `roles.name` UNIQUE | `role.model.js:26` | **global** *(the table has no tenant at all)* | **medium** — SCIM `/Groups` and role-create. A 409 says a role name is taken platform-wide | roles are global by design; the constraint is the *symptom*. A-38 / D-16 |
| 6 | `calibration_devices.iot_device_token` UNIQUE | `calibrationDevice.model.js:85` | **global** | **low** — nothing writes it (A-29), and a collision on a random token is not a useful oracle. But it is a **secret** stored in plaintext under a unique index | revisit when A-29 hashes it |
| 7 | `categories.slug` UNIQUE | `category.model.js:41` | **global** | **low** — the CMS has no tenant column at all, so this is correct *for the current design* and wrong the moment the CMS becomes per-tenant | document the decision (D-17) |
| 8 | `posts.slug` UNIQUE | `post.model.js:95` | **global** | **low** — as above | same |
| 9 | `menu_groups.slug` UNIQUE | `menuGroup.model.js:30` | **global** | **low** — the menu taxonomy is platform-wide by design | correct |
| 10 | `invoices.stripe_invoice_id` UNIQUE | `invoice.model.js:71`, migration `0002:16-20` | **global** | **none** — Stripe ids are globally unique and never caller-chosen | correct |
| 11 | `tenants.subdomain` / `domain` / `code` UNIQUE | `tenant.model.js:30,45,91` | **global** | by design — a subdomain **is** global | correct (it is a tenant-registration oracle, which is unavoidable) |
| 12 | `custom_domains.domain` UNIQUE | `customDomain.model.js:26` | **global** | by design — a DNS name is global | correct |
| 13 | `api_keys.key_hash` UNIQUE | `apiKey.model.js:37`, index `:77` | **global** | **none** — SHA-256 of a random key | correct |
| 14 | `sessions.token_hash` UNIQUE | `session.model.js:38`, index `:92` | **global** | **none** | correct |
| 15 | `tenant_keys.key_id` UNIQUE | `tenantKey.model.js:28`, index `:63` | **global** | **none** — `key-<ts>-<rand>`, never caller-supplied | correct |
| 16 | `asset_finances.device_id` UNIQUE | `assetFinance.model.js:84` | **global** | **none** — a UUID FK; one finance row per device | correct |
| 17 | `tenant_hierarchies.tenant_id` / `tenant_code` UNIQUE | `tenantHierarchy.model.js:54,55` | **global** | by design | correct |
| 18 | `ticket_counters.tenant_id` UNIQUE | `ticketCounter.model.js:21` | **per tenant** | — | correct; it is the `ON CONFLICT` target of `services/ticket.service.js:196` |
| 19 | `plan_quotas (tenant_id, metric)` | `planQuota.model.js:35` | **composite with tenant** | — | correct |
| 20 | `tenant_settings (tenant_id, key)` | `tenantSettings.model.js:44` | **composite with tenant** | — | correct |
| 21 | `"UsageMetrics" (tenantId, metric, periodStart)` | `usageMetric.model.js:43` | **composite with tenant** | — | correct |
| 22 | `role_menu_permissions (role_id, menu_group_id)` | `roleMenuPermission.model.js:51` | global *(because roles are)* | — | correct given D-16; wrong the moment roles become per-tenant |
| 23 | `user_menu_permissions (user_id, menu_group_id)` | `userMenuPermission.model.js:69` | user-scoped | — | correct |
| 24 | `notification_states (notification_id, user_id)` | `notificationState.model.js:74` | parent-scoped | — | correct |
| 25 | `post_categories (post_id, category_id)` | `postCategory.model.js:34` | parent-scoped | — | correct |
| 26 | `kanban_card_assignees (card_id, user_id)` | `kanbanCardAssignee.model.js:36` | parent-scoped | — | correct |
| 27 | `kanban_card_labels (card_id, label_id)` | `kanbanCardLabel.model.js:33` | parent-scoped | — | correct |
| 28 | `kanban_card_relations (source_card_id, target_card_id, type)` | `kanbanCardRelation.model.js:51` | parent-scoped | — | correct |

**Four constraints need a tenant column and do not have one: ranks 1-4.** Ranks 5, 7 and 8 are
symptoms of tables that have no tenant column at all.

---

## Cards

### D-01 — `bulkCreate` and `upsert` are outside the tenant hooks entirely

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 |
| **Severity** | **critical** |
| **Verified** | from code, 2026-09-23. **Not exploited** — no database was reachable |

**Evidence** — `backend/src/utils/tenantScope.util.js:104-125` registers exactly seven hooks:

```
:105  beforeFind          :117  beforeCreate
:108  beforeCount         :120  beforeUpdate
:111  beforeBulkUpdate    :123  beforeDestroy
:114  beforeBulkDestroy
```

`beforeBulkCreate` and `beforeUpsert` are **not registered**. Sequelize v6 does not fan `bulkCreate`
out to `beforeCreate` unless the call passes `individualHooks: true`, and no call site in
`backend/src` passes it (grep for `individualHooks`: zero results outside tests).

So for these two operations there is **no predicate and no stamping**. Whatever `tenantId` the
caller put in the object is what lands in the row; if the object has none, the row is written with
`tenantId = NULL` and becomes invisible to every scoped read (Reference Table 1, note ¹).

**Call sites, all on tenant-scoped models:**

| Site | Operation | Where the tenant comes from |
|---|---|---|
| `services/tenantBackup.service.js:385` | `Users.bulkCreate` | **a caller-supplied backup payload** — see D-02 |
| `services/calibrationDevices.service.js:442` | `CalibrationDevice.bulkCreate` | `{...value, tenantId}` at `:434-437` — explicit, correct today |
| `services/sop.service.js:114` | `SopTrainingAcknowledgment.bulkCreate` | `tenantId` in the mapped object at `:109` — explicit, correct today |
| `services/featureFlag.service.js:150` | `TenantSettings.bulkCreate` | `tenantId` at `:139` — explicit, correct today |
| `services/featureFlag.service.js:98` | `TenantSettings.upsert` | the `tenantId` **argument**, unvalidated |
| `services/storage/config.service.js:166` | `TenantSettings.upsert` | the `tenantId` **argument**, unvalidated |
| `services/dataRetention.service.js:47,68,74,80` · `networkSecurity.service.js:46,94` · `oidcProvider.service.js:150` · `tenantLifecycle.service.js:41,68,128` | `TenantSettings.upsert` | the `tenantId` argument |

**Why it matters here.** `CLAUDE.md` states the isolation contract as *"You do not opt in"* and
*"The hooks add the tenant predicate."* For `bulkCreate` and `upsert` that is false, and every one
of the correct call sites above is correct **by hand**. Thirteen `TenantSettings.upsert` calls are
one argument away from writing another tenant's storage credentials, OIDC configuration or
retention policy — `TenantSettings` is the table that holds all three. The one call site that takes
its `tenantId` from data rather than from an argument is D-02, and it is already wrong.

`upsert` additionally resolves its conflict against the unique index `(tenant_id, key)`
(`tenantSettings.model.js:44`) — with no predicate, a wrong `tenantId` does not fail, it **updates
the other tenant's row**.

**Fix direction.** Register `beforeBulkCreate` (iterating the instances through
`applyTenantAssignment`) and `beforeUpsert` (stamping the values and constraining the conflict
target) in `tenantScope.util.js`. Then add the inverse test: a scoped model written through
`bulkCreate`/`upsert` inside a tenant context must land in that tenant **even when the object names
a different one**. Correct `CLAUDE.md` in the same change — the contract paragraph currently
overstates what the hooks cover.

**Definition of Done**
- [ ] `beforeBulkCreate` and `beforeUpsert` registered, with the same deny-by-default resolution
- [ ] test: `bulkCreate([{ tenantId: <B> }])` inside tenant A's context writes **A**, not B
- [ ] test: `upsert({ tenantId: <B>, key })` inside tenant A's context does **not** touch B's row
- [ ] a test that enumerates the registered hooks and fails when a mutating one is missing — so the next operation Sequelize adds is not silently uncovered
- [ ] `CLAUDE.md` § Tenant isolation amended to name what the hooks do **not** cover, or the sentence stands because they now all do

**Abuse cases**
- Adding `beforeBulkCreate` and forgetting `beforeUpsert` — the thirteen `TenantSettings` sites are all `upsert`
- Testing only the happy path (an object with no `tenantId`), which passes with or without the hook

---

**What was changed (2026-09-24)** — `tenantScope.util.js` now registers `beforeBulkCreate` and
`beforeUpsert`. A write naming another tenant is **refused**, not re-stamped; a principal with no
resolvable tenant writes nothing; the system-task path (seeding, migrations) is unaffected.

**Refusing is the only correct answer for `upsert`, and this was checked in Sequelize's source
rather than reasoned about:** in 6.37.8, `Model.upsert` snapshots its values at `model.js:1511-1513`
and only then runs `beforeUpsert` at `:1531`, so a hook **cannot** change what an upsert writes. A
hook that tried to "correct" the tenant would have been silently ignored.

**The two failures in `36205df` were a broken test stub, not a broken fix.** `upsert` sends its SQL
as `{ query, bind }` with `$1…$6` placeholders; the stub kept `query` and dropped `bind`, so "the
statement contains tenant B" could never be observed. `bulkCreate` inlines its values, which is why
those tests passed. The stub now records the bind values. **Mutation check:** with both hook bodies
disabled, 5 of the 10 tests fail — the refusal and stamping ones; the other 5 cover pass-through.

**Verified live, not only in tests**, against a throwaway PostgreSQL container with two demo
tenants: as tenant A, an `upsert` naming B, a `bulkCreate` naming B, and a `bulkCreate` with
`updateOnDuplicate` on B were all refused, and **B's row stayed `B-ORIGINAL`**. With no tenant, both
were refused. `seedAll()` and `seedDemoData()` ran with `errors: []` — the hooks broke no seeding.

**Call-site audit: none broken.** 26 `bulkCreate`/`upsert` sites outside tests (not 27 — one moved
with the backup rewrite). Only three models they touch carry a tenant column. All twelve
`TenantSettings.upsert` sites pass an explicit tenant that is either the caller's own or behind
`superAdminOnly`, where scoping is skipped.

**Not covered:** the live check ran on PostgreSQL 16, the only cached image, not 18. The refusals
are plain `Error`s, so they surface as 500 — no legitimate caller reaches them today, but a 500 is
the wrong code for "you may not write another tenant's row".

### D-02 — Tenant-backup restore writes `users` rows straight from a caller-supplied payload

| | |
|---|---|
| **Status** | TODO |
| **Severity** | **high** |
| **Verified** | from code, 2026-09-23 |

**Evidence** — `backend/src/services/tenantBackup.service.js:379-391`:

```js
await Users.destroy({ where: { tenantId: targetTenantId }, transaction });
// Preserve password hashes from backup for non-merge restores
await Users.bulkCreate(
  data.users.map((u) => ({ ...u, id: undefined })),
  { transaction },
);
```

`data` is the decoded backup document. `...u` carries whatever `tenantId` the document names, and
per D-01 `bulkCreate` neither filters nor stamps it. `targetTenantId` constrains the **destroy**;
nothing constrains the **insert**.

**Why it matters here.** The comment says the point is to preserve password hashes. It does — and it
preserves whatever tenant the rows claim. A restore of a crafted backup inserts authenticating user
rows, with a chosen `roleId` and a chosen password hash, into **any** tenant named in the file. The
`destroy` above it also means a mismatched `targetTenantId` wipes the target's users first. Restore
is the one operation where the payload is both fully caller-controlled and trusted by construction.

Whether the endpoint is reachable by a non-super-admin was **not** checked here — that is an
authorization question and belongs with the A-series sweep. The data-layer defect stands either way:
a super-admin restore is not supposed to be able to silently relocate users between tenants.

**Fix direction.** Strip `tenantId` from every restored row and set it to `targetTenantId`
explicitly, the way `id` is already stripped. The D-01 hook then becomes belt-and-braces rather than
the only control. Validate the backup envelope's tenant against `targetTenantId` and refuse a
mismatch with a 409 that explains it.

**Definition of Done**
- [ ] `tenantId: targetTenantId` forced on every restored row, for users and for every other table the restore writes
- [ ] a backup whose envelope names a different tenant is refused, not silently relocated
- [ ] test: a backup containing `tenantId: <B>` restored into A creates rows in **A** only, and `users` in B is unchanged
- [ ] the same review applied to every other `bulkCreate` in `tenantBackup.service.js`

---

### D-03 — The GDPR retention purge deletes across every tenant when the policy is global

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 |
| **Severity** | **high** — it deletes audit rows |
| **Verified** | from code, 2026-09-23 |

**Evidence** — `backend/src/services/gdpr.service.js:806-813`:

```js
const where = { createdAt: { [Op.lt]: cutoff } };
if (policy.tenantId) {
  where.tenantId = policy.tenantId;
}
const deleted = await model.destroy({ where });
```

`data_retention_policies.tenantId` is **nullable**, documented at
`models/dataRetentionPolicy.model.js:19` as `// null = global default policy`. For such a policy the
`where` carries **no tenant predicate at all**.

The hooks do not save it. `model` is resolved dynamically from `policy.entityType`, and
`beforeBulkDestroy` **is** registered — but `resolveScope` returns `{ mode: "skip" }` when there is
no `AsyncLocalStorage` context (`utils/tenantScope.util.js:52-53`), which is exactly the case for a
scheduler or cron invocation. Skip means no predicate.

**Why it matters here.** `entityType` names `AuditLog` among others
(`dataRetentionPolicy.model.js:24`: *"e.g. AuditLog, Notification, Session"*). A single global
policy row therefore hard-deletes **every tenant's** audit rows older than its `retentionDays`.
`CLAUDE.md` calls one audit row per mutation non-negotiable; this deletes them platform-wide from
one row. Which principals can write `data_retention_policies` was not traced here.

The neighbouring implementation in `services/dataRetention.service.js:126-134` does it correctly —
it always carries `tenantId`. Two implementations of the same job, one safe and one not.

**Fix direction.** Either (a) run the purge once per tenant, iterating tenants and always carrying
the predicate — which `dataRetention.service.js:177` already does — or (b) if a genuinely
platform-wide purge is wanted, make it an explicit, named `isSystemTask` operation with its own
audit row, rather than a `where` clause that is missing a key.

**Definition of Done**
- [ ] no `destroy` in `gdpr.service.js` can run without a tenant predicate
- [ ] test: a policy with `tenantId = null` does **not** delete rows belonging to tenant B when invoked for A
- [ ] a decision recorded on whether a global retention policy should exist at all, given `dataRetention.service.js` already fans out per tenant
- [ ] audit rows deleted by retention are counted and recorded, per tenant

---

**What was changed (2026-09-24)** — `gdpr.service.js`, 50 tests, 100 %.

A retention policy with no tenant (`tenantId` null or absent) now purges **nothing**; per-tenant
policies carry the tenant filter, including `tenant_id` on the snake_case `Session` model. The
platform-wide sweep in `dataRetention.service.js#runRetentionSweep` already purges each tenant under
its own filter, so the tenant-less branch in `gdpr.service.js` was both redundant and the unsafe one
of the two implementations.

**The failing test encoded the defect.** `"purges a policy with no tenant scope without checking
legal hold"` asserted `result.purged === 2` — that a global policy deleted rows with no tenant filter
**and ignored legal hold**. It is replaced by tests asserting a global policy destroys nothing.
Against the pre-fix service, 3 fail.

**Decision needed, recorded as Q-10:** should tenant-less retention policies exist at all? They are
now inert, and a policy row that does nothing is its own kind of confusion.

### D-04 — `calibration_devices.serial_number` is globally unique

| | |
|---|---|
| **Status** | TODO |
| **Severity** | **high** |
| **Verified** | from code, 2026-09-23. **Needs psql** to confirm the constraint on the deployed database |

**Evidence** — `models/calibrationDevice.model.js:33-37` (`unique: true` on the attribute) and
`:121` (`{ fields: ["serial_number"], unique: true }`). Reached by
`POST /api/v1/calibration-devices` and by the CSV bulk import at
`services/calibrationDevices.service.js:442`.

**Why it matters here.** Two things, and the second is worse than the oracle.

1. **Existence oracle.** A serial number is stamped on the instrument. A caller in tenant A submits
   one and learns from the failure whether tenant B owns that device — which hospital owns which
   analyser is exactly the inventory a competitor or an attacker wants. `CLAUDE.md` names a global
   uniqueness constraint as a cross-tenant existence oracle in its traps table; this is the
   instance.
2. **A legitimate collision.** Two hospitals that both buy the same instrument, or a manufacturer
   that restarts its serial sequence, cannot both be registered. The second create fails with a
   database error the caller cannot act on, and the CSV bulk import at `:442` fails the **whole
   batch** on one collision, because `bulkCreate` is not per-row.

**Fix direction.** Drop the global unique index; add `UNIQUE (tenant_id, serial_number)`.
`serial_number` is `allowNull: true` and Postgres treats NULLs as distinct under both forms, so
behaviour for serial-less devices is unchanged. The migration must find and resolve existing
cross-tenant duplicates first — there may be none, which is itself something only psql can say.

**psql needed:**

```sql
-- does the global constraint exist?
SELECT i.relname, pg_get_indexdef(ix.indexrelid)
  FROM pg_index ix
  JOIN pg_class i ON i.oid = ix.indexrelid
  JOIN pg_class t ON t.oid = ix.indrelid
 WHERE t.relname = 'calibration_devices' AND ix.indisunique;

-- would a composite constraint collide with existing data?
SELECT tenant_id, serial_number, count(*)
  FROM calibration_devices
 WHERE serial_number IS NOT NULL
 GROUP BY 1,2 HAVING count(*) > 1;
```

**Definition of Done**
- [ ] both queries run and the output recorded
- [ ] migration replaces the global index with `(tenant_id, serial_number)`, no blanket `try/catch` (D-14), columns verified in psql afterwards
- [ ] test: tenant A and tenant B each create a device with serial `SN-1`; both succeed
- [ ] test: a duplicate **within** one tenant is a 409 with a state explanation, not a 500
- [ ] the CSV import reports per-row failures instead of failing the batch

---

### D-05 — One raw SQL statement carries no tenant predicate

| | |
|---|---|
| **Status** | TODO |
| **Severity** | medium |
| **Verified** | from code, 2026-09-23 — exhaustive grep of `backend/src` |

`CLAUDE.md` states: *"Every `sequelize.query` carries the predicate explicitly."* That is **almost**
true. Here is every one, and its verdict.

| # | Site | Tenant predicate | Params | Verdict |
|---|---|---|---|---|
| 1 | `services/search.service.js:44-53` (FTS) | `WHERE tenant_id = :tenantId` | `replacements`, `:name` | correct |
| 2 | `services/search.service.js:57-66` (ILIKE fallback) | `WHERE tenant_id = :tenantId` | `replacements`, `:name` | correct |
| 3 | `services/ai.service.js:206-213` (chunk insert) | `tenant_id` bound as `$1` | **`bind`**, `$n` | correct — and the comment says why |
| 4 | `services/ai.service.js:233-245` (pgvector retrieval) | `WHERE tenant_id = $2` | **`bind`**, `$n` | correct |
| 5 | `services/meteredBilling.service.js:177-190` | `WHERE "tenantId" = $1` | **`bind`**, `$n` | correct — this is the A-08 fix; the comment records that `replacements` here read every tenant's usage as **zero** |
| 6 | `services/meteredBilling.service.js:655-658` | `WHERE "tenantId" = $1` | **`bind`**, `$n` | correct |
| 7 | `services/ticket.service.js:196-203` | `VALUES (…, :tenantId, …) ON CONFLICT (tenant_id)` | `replacements`, `:name` | correct |
| 8 | **`services/kanban.service.js:745-752`** | **none** | `replacements`, `:name` | **no tenant predicate** |
| 9 | `config/index.js:135,144` (bootstrap: does the database exist) | n/a — pre-tenant | — | n/a |
| 10 | `config/index.js:217`, `utils/dbReady.util.js:29` (`SELECT 1`) | n/a | — | n/a |

**Evidence for #8** — `services/kanban.service.js:745-752`:

```js
const [[seqRow]] = await sequelize.query(
  `UPDATE kanban_projects SET card_seq = card_seq + 1, updated_at = NOW()
   WHERE id = :projectId RETURNING card_seq`,
  { replacements: { projectId }, transaction },
);
```

`kanban_projects` **is** a tenant-scoped model — and this statement bypasses the hook that would
scope it. `projectId` arrives from the route path.

**Why it matters here.** It is mitigated: `createCard` calls `assertAccess(user, projectId,
"editor")` at `:713`, and `assertAccess` resolves the project through the **scoped**
`KanbanProject` model, so a cross-tenant `projectId` throws 404 first. It is not exploitable today.
It matters because `CLAUDE.md` promises a property the code does not have, and because `card_seq`
is a counter — a bump on another tenant's project would be a silent, permanent gap in that board's
card keys with no row to show for it.

**`bind` vs `replacements` is correct at all eight sites.** The two that use `$n` placeholders use
`bind`; the six that use `:name` use `replacements`. Nothing mixes them. The A-08 defect — `$1`
passed as `replacements`, PostgreSQL answering *"there is no parameter $1"*, the `catch` turning it
into `{ total: 0 }` — has not recurred anywhere.

**Fix direction.** Add `AND tenant_id = :tenantId` to the statement (the project is already loaded,
so `project.tenantId` is in hand) and assert one row was updated. Then correct `CLAUDE.md` so the
sentence is true, or state the one documented exception.

**Definition of Done**
- [ ] the `UPDATE` carries `tenant_id` and throws when the updated row count is not 1
- [ ] test: the statement with a foreign `projectId` updates nothing
- [ ] `CLAUDE.md` either stands because it is now true, or names the exception
- [ ] a check (lint rule or test) that a new `sequelize.query` naming a tenant-scoped table without `tenant_id` fails review

---

### D-06 — `users.email` **and** `users.username` are globally unique

| | |
|---|---|
| **Status** | TODO — supersedes and widens **A-37** |
| **Severity** | **high** |
| **Verified** | from code, 2026-09-23 |

**Evidence** — `models/user.model.js:27-31` (`username`, `unique: true`), the `email` attribute at
`:30`, and the indexes at `:156-158`:

```js
{ fields: ["username"], unique: true },
{ fields: ["email"],    unique: true },
{ fields: ["tenant_id", "email"] },        // <- non-unique; the composite exists but does not constrain
```

The third line is the tell: somebody already wrote the composite index that *should* have been the
constraint, and left the global one in place beside it.

**Why it matters here.** A-37 records this for SCIM. It is not SCIM-only — every user-creation path
hits the same constraint, and the duplicate check in front of each is tenant-scoped, so the check
passes and the constraint rejects. Two consequences:

- **the oracle**: a 409 or a 500 on create tells the caller the address or name exists in some other
  tenant;
- **the real block**: one clinician who consults for two hospitals on the platform cannot have an
  account at both. That is not hypothetical for a hospital-services product.

A-37 is scoped to SCIM and rated high. This card says the same constraint is reachable from the
ordinary user-create route and from registration, and that `username` has the identical problem and
is mentioned nowhere.

**Fix direction.** `UNIQUE (tenant_id, email)` and `UNIQUE (tenant_id, username)`. `users.tenantId`
is nullable (the platform super-admin) and Postgres treats NULL as distinct — so a partial unique
index on `WHERE tenant_id IS NULL` is needed to keep super-admin identities unique. Decide and
record which, because the two behave differently and the choice is not obvious.

**psql needed:**

```sql
SELECT pg_get_indexdef(ix.indexrelid)
  FROM pg_index ix JOIN pg_class t ON t.oid = ix.indrelid
 WHERE t.relname = 'users' AND ix.indisunique;

SELECT lower(email), count(DISTINCT tenant_id) FROM users
 GROUP BY 1 HAVING count(DISTINCT tenant_id) > 1;   -- would the composite collide?
```

**Definition of Done**
- [ ] both queries run and recorded
- [ ] A-37 updated to say `username` too, and that the reach is every create path, not SCIM
- [ ] composite constraints in place, with a recorded decision about `tenant_id IS NULL`
- [ ] test: the same email registered in tenant A and in tenant B both succeed
- [ ] test: a duplicate within one tenant is **409 with a state explanation**, not 500 and not a raw PG message (A-13)

---

### D-07 — `restoreStatic()` on six models is a silent no-op

| | |
|---|---|
| **Status** | **DONE** 2026-09-24 |
| **Severity** | **high** — the undelete path does nothing and reports success |
| **Verified** | from code, 2026-09-23 |

**Evidence** — the same three lines in six models:

| Model | Lines | Attribute actually declared |
|---|---|---|
| `models/calibrationDevice.model.js` | `:148-153` | `isDeleted` (`:108`) |
| `models/calibrationRecord.model.js` | `:124-129` | `isDeleted` |
| `models/role.model.js` | `:80-85` | `isDeleted` |
| `models/stock.model.js` | `:107-112` | `isDeleted` |
| `models/tenant.model.js` | `:141-146` | `isDeleted` |
| `models/user.model.js` | `:187-192` | `isDeleted` |

```js
Model.restoreStatic = async function (id) {
  return this.update(
    { is_deleted: false },                    // <- snake_case
    { where: { id, is_deleted: true } },
  );
};
```

Sequelize v6 `Model.update` computes `options.fields` as the intersection of `Object.keys(values)`
with the model's **attribute** names. The attribute is `isDeleted`; `is_deleted` is not an
attribute, so the intersection is empty and nothing is written. The `where` clause works by
accident — an unknown key in a `where` falls through to a literal column name, and the physical
column *is* `is_deleted` because of `underscored: true`.

So: the row is found, nothing is set, and the call returns a shaped result that looks like success.
This is the trap `CLAUDE.md` names — *"`is_deleted` written in code silently does nothing"* —
present six times in the models themselves.

`models/session.model.js:124-129` has the same code and is **correct**, because `Session` uniquely
declares its attributes in snake_case (`is_deleted` at `:76`). That is what makes the other six hard
to see: the pattern is right somewhere.

The fourteen `defaultScope` blocks (`{ where: { is_deleted: false } }`) also use the snake_case
spelling and **do** work, for the same fall-through reason. They are not defects; they are the
reason nobody noticed.

**Fix direction.** `{ isDeleted: false }` in the values of all six, and `isDeleted: true` in the
`where` for consistency. Then the test that would have caught it: soft-delete a row, restore it,
assert the default scope returns it.

**Definition of Done**
- [ ] all six corrected; `Session` left alone, with a comment saying why it differs
- [ ] one test per model: soft-delete → `restoreStatic` → the row is visible under the default scope
- [ ] those tests shown to fail before the fix, naming which cases turn red — per the evidence rule
- [ ] a lint gate: `is_deleted` as a key in an `update()` **values** object is an error

---

**What was changed (2026-09-24)** — correcting this card first: it says **six** models. There are
**seven**; its evidence table omitted `warehouse.model.js:89`. All seven are fixed.

Each `restoreStatic` now reads `this.unscoped().update({ isDeleted: false }, { where: { id, isDeleted: true } })`.
`unscoped()` is deliberate: the `defaultScope` is `{ is_deleted: false }`, and a restore must not
inherit it. A probe against real Sequelize showed that a plain `this.update(…)` does produce the
right SQL — but only because field mapping happens to overwrite the scope's `false` with `true`
after the merge. That is a second "works by accident" layered on the first, so the intent is now
explicit. The paranoid `deleted_at IS NULL` clause and the global tenant hooks both still apply.
`session.model.js` is untouched: it declares `is_deleted` as a snake_case attribute, so its
`restoreStatic` was always correct.

**Verification** — `src/tests/models/restoreStatic.test.js`, **42 tests** (6 per model). The test
spies on `queryInterface.bulkUpdate` and applies the update to an in-memory row stored under the
**real column names**, so Sequelize's attribute resolution, scope injection and field mapping all
run for real; it asserts the stored row flips, that it passes the model's own `defaultScope` again,
and that the call reports **one** affected row. **Proved to fail**: with all seven models reverted,
`21 failed, 21 passed`; with one reverted, exactly that model's three effect-tests fail. It also
guards the other direction — a row that is not soft-deleted is left alone, and a different id is not
restored.

**A finding this surfaced, filed against A-32:** `models/` is excluded from the coverage gate
**twice** — omitted from `collectCoverageFrom` *and* listed in `coveragePathIgnorePatterns`. The
"100 %" figure has never measured one line of any of the 71 models. Measured directly, the seven
fixed models sit at **44–62 % statements**; `softDelete` and `associate` are exercised by nothing.

**Not covered:** the test does not run against PostgreSQL, and does not run the tenant hooks.


### D-08 — `audit_logs` has no indexes at all

| | |
|---|---|
| **Status** | TODO |
| **Severity** | **high** |
| **Verified** | from code, 2026-09-23. Row counts and plans **need psql** |

**Evidence** — `models/auditLog.model.js:66-73`. The options block is:

```js
{ sequelize, modelName: "AuditLog", tableName: "audit_logs",
  timestamps: true, updatedAt: false, underscored: true }
```

No `indexes` array. The only index the table has is the primary key on `id` — a random UUID, so it
helps no range scan. Migration `0001` renames its columns and adds nothing.

Every query against it is a sequential scan:

- `services/audit.service.js:88-95` — the audit list, filtered by tenant and joined to `users`;
- `services/dataRetention.service.js:126-134` — `WHERE tenant_id = ? AND created_at < ?`, the
  retention delete;
- `services/gdpr.service.js:813` — the same shape, without the tenant key (D-03).

**Why it matters here.** `audit_logs` grows with every mutation, by design — `CLAUDE.md` calls one
row per mutation non-negotiable. It carries a `JSONB changes` column holding before/after snapshots
(`:52-56`), so rows are large. It is simultaneously the largest table, the one with the most
selective natural filters, and the only one with no index. The first symptom will be the retention
job timing out, which means rows stop being deleted, which makes the scan slower.

A `tenant_id` sequential scan is also the isolation boundary doing work: every audit read walks
every tenant's rows to return one tenant's.

**Fix direction.** A migration adding at minimum `(tenant_id, created_at DESC)` — covers the list
and the purge; `(tenant_id, resource_type, resource_id)` — covers "what happened to this
certificate"; `(user_id)` — covers the FK and "what did this user do". Consider BRIN on `created_at`
if the table is already large, and monthly partitioning if the psql count says so.

**psql needed:**

```sql
SELECT pg_size_pretty(pg_total_relation_size('audit_logs')), count(*) FROM audit_logs;
SELECT indexname FROM pg_indexes WHERE tablename = 'audit_logs';
EXPLAIN (ANALYZE, BUFFERS)
  SELECT * FROM audit_logs WHERE tenant_id = '<uuid>' ORDER BY created_at DESC LIMIT 50;
```

**Definition of Done**
- [ ] the three queries run and recorded — the plan before and after
- [ ] indexes added by **migration**, not by a model `indexes` block alone (`db.sync()` will not add them to an existing table — D-13)
- [ ] the retention delete's plan uses the index
- [ ] the same question asked of the other fifteen index-less models (D-20)

---

### D-09 — Migration 0011 unconditionally drops `e_signature_records` with CASCADE

| | |
|---|---|
| **Status** | TODO |
| **Severity** | **high — compliance** (21 CFR Part 11 record destruction) |
| **Verified** | from code, 2026-09-23 |

**Evidence** — `src/migrations/0011-add-esignature-records.js:5-7`, the **first three statements of
`up`**:

```js
await queryInterface.dropTable('e_signature_records', { cascade: true }).catch(() => {});
await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_e_signature_records_action";').catch(() => {});
await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_e_signature_records_auth_method";').catch(() => {});
```

There is no `if (!has(table))` guard — unlike `0017:40` and `0018:34`, which check first. The
`.catch(() => {})` means a drop that fails for any reason is ignored and the `createTable` that
follows then fails, leaving the migration half-applied.

**Why it matters here.** Migrations are guarded against re-running only by the `schema_migrations`
row. That row is lost in three ordinary situations: restoring a data-only dump, pointing the app at
a database rebuilt from `db.sync()`, and any recovery that recreates `schema_migrations`. In all
three, `migrator.up()` re-runs `0011` and **destroys every electronic signature record**, with
`CASCADE` taking anything referencing them.

This is a stronger version of the trap `CLAUDE.md` names. A blanket `try/catch` records a migration
as applied while doing nothing; this one does something, and the something is irreversible.
`0017:181` has the same `dropTable(…, { cascade: true }).catch(…)` but in `down`, which is at least
where a destructive statement belongs.

**Fix direction.** Guard the drop with the `describeTable`/`has()` pattern `0017` and `0018` already
use, so `up` on an existing table is a no-op rather than a rebuild. Where the drop exists to clean
up a failed *partial* run, make that explicit and refuse to drop a table that has rows. The
migration is presumably already applied on the deployed database — this is about the next restore,
not about today.

**Definition of Done**
- [ ] `0011` re-run against a database that already has `e_signature_records` with rows leaves them intact
- [ ] a test that runs `migrator.up()` twice and asserts row counts are unchanged, for every migration
- [ ] `docs/DATABASE/13-MIGRATIONS.md` states the rule: **`up` never drops a table that may hold data**
- [ ] `0017`'s `down` reviewed against the same rule

---

### D-10 — `calibration_records.performed_by` CASCADE-deletes with the user

| | |
|---|---|
| **Status** | TODO |
| **Severity** | **high — compliance** (ISO 17025 record retention) |
| **Verified** | from code, 2026-09-23 |

**Evidence** — `models/calibrationRecord.model.js:36-40`:

```js
performedBy: {
  type: DataTypes.UUID, allowNull: false,
  references: { model: "users", key: "id" },
  onDelete: "CASCADE",
},
```

Compare `models/auditLog.model.js:11-15`, which gets it right and says so:
`onDelete: "SET NULL", // Keep the log even if user is deleted`.

**Why it matters here.** Hard-deleting a technician deletes every calibration they performed — the
measurement record an ISO 17025 audit asks for. It is partly masked today by two accidents:

- `User` is `paranoid`, so ordinary deletes are soft and the FK never fires; and
- `certificates.calibration_record_id` (`models/certificate.model.js:46-50`) has **no** `onDelete`,
  so the default `NO ACTION` makes the cascade **fail** with a foreign-key violation rather than
  succeed — but only for records that have a certificate.

So the outcome of a hard user delete is: calibration records with a certificate block the delete
with a raw PG error; calibration records without one are silently destroyed. Neither is a designed
behaviour. `services/tenantLifecycle.service.js:176` does exactly this — `User.destroy({ …, force:
true })` — on tenant purge (D-23).

**Fix direction.** `performed_by` becomes `ON DELETE RESTRICT` (a technician who has performed a
calibration cannot be hard-deleted) or `SET NULL` with `allowNull: true` and the performer's name
denormalised onto the record, which is what a retained record actually needs. Audit every FK from an
evidence-bearing table to `users` the same way, and decide it once rather than six times.

**Definition of Done**
- [ ] a recorded decision, per evidence table, between RESTRICT and SET-NULL-plus-denormalised-name
- [ ] migration altering the constraints, verified in psql (`\d+ calibration_records`)
- [ ] test: hard-deleting a user who performed a calibration either fails cleanly or leaves the record
- [ ] `docs/DATABASE/07-CALIBRATION-TABLES.md` states the retention guarantee explicitly

---

### D-11 — `hardDeleteUser()` is a soft delete

| | |
|---|---|
| **Status** | TODO |
| **Severity** | **high — compliance** (GDPR Art. 17) |
| **Verified** | from code, 2026-09-23 |

**Evidence** — `services/gdpr.service.js:397-403`:

```js
/** Hard delete user */
async function hardDeleteUser(tenantId, userId) {
  const { User } = require("../models");
  await User.destroy({ where: { id: userId, tenantId } });
}
```

`User` is `paranoid: true`. `destroy` without `force: true` sets `deleted_at` and leaves every
column in place — name, email, password hash, everything. The caller at `:331-332` selects this
branch when `options.hardDelete === true`, and `:340` reports `hardDelete` back to the requester as
the action taken.

**Why it matters here.** The function is named `hardDeleteUser`, documented as *"Hard delete user"*,
selected by a flag called `hardDelete`, and reports success. A data subject exercising the right to
erasure is told their data was erased; it is intact and readable with `User.unscoped()` or
`paranoid: false`. Retaining is a defensible engineering choice — regulated systems often must — but
it is not the choice this code claims to have made, and the claim is what makes it a finding rather
than a design.

`anonymizeUser` at `:366` is the other branch; this audit did not verify what it writes.

**Fix direction.** Decide: either `force: true` — and then D-10's cascade becomes live, so the two
cards must be fixed together — or keep the soft delete and rename the function, the flag and the
response to say what actually happens. Whichever, `docs/` and the DSAR response text must match.
This is an Open Question for `TASKS/BACKLOG.md`, not a judgement call inside a bug fix: retention
rules for clinical records and GDPR erasure genuinely conflict and the owner has to choose.

**Definition of Done**
- [ ] the decision recorded as an ADR, with the retention conflict named
- [ ] code, flag name, response text and `docs/` all agree
- [ ] test: after an erasure, `User.unscoped().findByPk(id)` returns what the decision says it should — asserting the **fields**, not just the row count
- [ ] `anonymizeUser` audited to the same standard

---

### D-12 — An include of a default-scoped model without `required: false` is an INNER JOIN

| | |
|---|---|
| **Status** | TODO |
| **Severity** | medium — but this is the defect shape `CLAUDE.md` calls the most repeated one here |
| **Verified** | from code, 2026-09-23, and from the repo's own comment at `services/audit.service.js:90-92`: *"`required:false` — `userId` is nullable … and User **carries a scope that would otherwise INNER JOIN and hide those logs**."* `node_modules` is not installed on this machine, so the Sequelize behaviour was **not** re-derived from its source |

**The rule.** A Sequelize include becomes `required: true` when it has a `where`. Fourteen models
carry a `defaultScope` with a `where` — `apiKey`, `attachment`, `calibrationDevice`,
`calibrationRecord`, `category`, `post`, `role`, `session`, `stock`, `tenant`, `tenantKey`, `user`,
`warehouse`, `webhook` — so including any of them without an explicit `required: false` produces an
INNER JOIN. A nullable FK, or a soft-deleted parent, then **removes the row from the list** with no
error.

`required: false` appears 68 times in `services/` and `controllers/`; `required: true` three times.
The fix is understood here. These are the sites that do not have it.

**Sites, ranked by what they silently empty:**

| Site | Included model | What disappears |
|---|---|---|
| `services/stock.service.js:580-583` | `Warehouse` ×2, **`User` as `approver`** | **pending stock transfers** — `approved_by` is null until approval, so the list shows only *approved* transfers. The queue a user opens to approve things is the one thing missing from it |
| `services/stock.service.js:63-64`, `:97-98` | `Warehouse` (+ `StorageLocation`) | stock rows whose warehouse is soft-deleted, or whose `warehouse_id` is null |
| `services/stock.service.js:358-359`, `:716-717`, `:750`, `:807-808` | `Warehouse`, `User` | adjustments and opnames with a soft-deleted warehouse or performer |
| `services/qms.service.js:38-39` | `User` as `reporter`, `CalibrationDevice` as `device` | **non-conformances raised against a decommissioned device** — devices are soft-deleted on decommission, which is precisely when the NC still matters |
| `services/qms.service.js:101-102` | `NonConformance`, `User` as `assignee` | **unassigned CAPAs** — `assignee` is nullable, so the CAPA list omits everything not yet assigned |
| `services/sop.service.js:44` | `User` as `author` | controlled procedures whose author has left and been soft-deleted |
| `services/user.service.js:146,250,351,900` | `Roles` | users whose role was soft-deleted — they vanish from the admin user list while still able to log in |
| `services/workflow.service.js:24,41` | `WorkflowStep` → nested `Role` | a workflow **with no steps**, and any workflow whose step references a soft-deleted role. A nested required include propagates `required` to its parent |
| `services/workflow.service.js:188-199`, `:232-237` | `Workflow`→`WorkflowStep`, `WorkflowAction` | workflow instances with no actions yet — i.e. the ones just started |
| `services/content.service.js:81` | `Category` (belongsToMany) | **posts with no category** |
| `services/tenantHierarchy.service.js:202,217,308,450,455` | `Tenant`, `Role` | hierarchy rows pointing at a soft-deleted tenant — exactly the rows you look at when investigating one |
| `services/tenantBackup.service.js:223,258,262,303` · `controllers/tenantBackup.controller.js:95,100` | `Users` as `creator`, `Tenants` | backups whose creator has left |
| `controllers/session.controller.js:45,50,125,130,193` | `Users`, `Roles` | sessions of a soft-deleted user — the sessions you most want to see when revoking |
| `controllers/user.controller.js:241` · `services/auth.service.js:624` · `services/userPermission.service.js:47` | `Roles` / `Role` | as above |
| `services/supplierScorecard.service.js:29-30,46-47` | `Vendor`, `User` as `evaluator` | scorecards whose evaluator has left |
| `services/roles.service.js:364-374` | `Role` (nested under a permission read) | permissions attached to a soft-deleted role |
| `services/billing.service.js:117` · `services/eSignature.service.js:847` · `services/menuGroup.service.js:114-115` | `Subscription`, `SignatureWorkflowStep`, `MenuGroup` | **nothing** — these models have no `defaultScope`, so the join is already LEFT. Listed so the next reader does not re-check them |

**Already correct, for reference:** `services/maintenance.service.js:64-66` and `:105-107` carry
both `required: false` **and** `paranoid: false`, with a comment explaining why. `CLAUDE.md` lists
`maintenance_work_orders` as *latent*; it is not — it is the best-handled include in the codebase,
and `CLAUDE.md` should say so. `services/certificate.service.js:156-176`, `:213-247` and
`services/risk.service.js:25-28` are likewise fixed, matching the history `CLAUDE.md` records.

**Fix direction.** Add `required: false` at each site above. Two of them — stock transfers and
CAPAs — should get a failing test first, because they are the ones where the missing rows are the
ones a user is looking for. Longer term the only durable fix is a rule: **every `include` in this
codebase is explicit about `required`**, enforced by lint, because the default is invisible and
depends on a property of the *included* model rather than of the call.

**Definition of Done**
- [ ] a test that asserts the Sequelize behaviour itself (include a default-scoped model with no `required`, assert the generated SQL says `INNER JOIN`) — so a Sequelize upgrade reports the change rather than hiding it
- [ ] `required: false` at every site in the table above except the last row
- [ ] regression tests for the two that hide wanted rows: a **pending** stock transfer appears in the list; an **unassigned** CAPA appears in the list
- [ ] a lint rule: an `include` object without an explicit `required` is an error
- [ ] `CLAUDE.md` traps table corrected — `maintenance_work_orders` is no longer latent

---

### D-13 — `db.sync()` never alters, so a model column with no migration is absent forever

| | |
|---|---|
| **Status** | TODO |
| **Severity** | medium — **potentially high**; only psql can say |
| **Verified** | from code. The *consequence* **needs psql** |

**Evidence** — `backend/index.js:590`:

```js
await db.sync();            // no { alter: true }
```

and `src/config/migrate.js:7`, the same. Migrations run **after** it (`backend/index.js:600-602`).

`sync()` without `alter` issues `CREATE TABLE IF NOT EXISTS`. On an existing database it creates
missing **tables** and does nothing at all about missing **columns**. So:

- a **new model** added without a migration is fine — `sync` creates its table;
- a **new column** on an existing model, with no migration, exists on a fresh database and is
  **permanently absent** on the deployed one.

Sequelize then `SELECT`s every declared attribute, so the first query touching that model fails with
`column "…" does not exist` — for the whole model, not just the new field.

**Why it matters here.** Nineteen migrations exist and nine of them add columns, so the pattern is
understood. The question is whether anything has been missed since. The tables most likely to be
affected are the ones with recent model churn and **no** creating migration — `kanban_*` (nine
tables; `card_seq`, `card_key` and `sprint_id` were added after the module shipped), `tickets` and
`ticket_counters`, `"UsageMetrics"`, `storage_locations`, `tenant_settings`, `consent_records`. All
of those tables are created by `sync` alone, which means they exist at whatever shape the model had
on the day the table first appeared on that database.

This also explains the comment on `0013`: *"the `tenant_hierarchies` table itself is created by the
model-driven `db.sync()`; this migration only handles the column addition to the pre-existing
`tenants` table (which sync will not alter)."* The mechanism is documented; the audit is not.

**Fix direction.** Not a code change — a check. Run the drift query below against the deployed
database and turn whatever it finds into migrations. Then add the check to `make migrate-verify` so
it is a gate rather than an audit.

**psql needed** — the drift query:

```sql
SELECT table_name, column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public'
 ORDER BY table_name, ordinal_position;
```

Compare against the model side, which needs no database:

```js
Object.values(db.models).flatMap(m =>
  Object.values(m.rawAttributes).map(a => [m.tableName, a.field]))
```

**Definition of Done**
- [ ] the drift query run against the VM database and the diff recorded, table by table
- [ ] every missing column given a migration
- [ ] `make migrate-verify` performs the diff and fails on drift — *the log is not evidence*
- [ ] `docs/DATABASE/13-MIGRATIONS.md` states the rule: a new column on an existing model **always** needs a migration, because `sync` will not add it

---

### D-14 — Five migrations record themselves applied on any `describeTable` error

| | |
|---|---|
| **Status** | TODO |
| **Severity** | medium |
| **Verified** | from code, 2026-09-23 |

**Evidence** — the identical shape in `0002:10-13`, `0004:8-11`, `0009`, `0013:17-20`, `0016`:

```js
let desc;
try {
  desc = await context.describeTable(TABLE);
} catch {
  return;               // "table not present yet (fresh DB handled by db.sync)"
}
```

Umzug records a handler that returns normally as **applied**.

**Why it matters here.** The stated reason for the guard — the table might not exist yet — cannot
happen. `db.sync()` runs at `backend/index.js:590`, **before** `migrator.up()` at `:602`, and it
creates every model table. So by the time any of these runs, the table always exists, and the only
thing the `catch` can now swallow is a **real** failure: a lost connection, a permission denial, a
lock timeout. Each is recorded as a successful migration that did nothing, and it will never run
again.

This is the trap `CLAUDE.md` names, and `src/config/migrator.js:52-60` already tells the story of
the last time it bit: *"Umzug then recorded the migration as applied while it had done nothing,
which is how 0008/0013/0014 came to be marked done with their columns absent."* The wrapper bug that
caused it was fixed; the `catch` that hid it was not removed.

`0001:68-72` has the same shape but is legitimately a loop over optional tables. `0014:45-50` and
`0019:20-23` both carry explicit comments saying they deliberately do **not** swallow — the right
pattern exists in the directory.

**Fix direction.** Delete the five `catch { return }` guards. If a migration genuinely must tolerate
an absent table, it checks with `showAllTables()` and says so, rather than catching everything.

**Definition of Done**
- [ ] the five guards removed; a failure fails the migration loudly
- [ ] a test that a throwing `describeTable` propagates instead of marking the migration applied
- [ ] `make migrate-verify` asserts the **columns** exist, not that the log said OK
- [ ] the columns `0002`, `0004`, `0009`, `0013`, `0016` should have added are confirmed present in psql — they may already be victims

---

### D-15 — `certificates.certificate_number` is globally unique

| | |
|---|---|
| **Status** | TODO |
| **Severity** | medium |
| **Verified** | from code, 2026-09-23 |

**Evidence** — `models/certificate.model.js:57-61` and the index at `:167`. A generator exists at
`:177`, so most numbers are system-issued and collisions are unlikely in practice — but the value is
accepted on create and the format is predictable.

**Why it matters here.** A calibration certificate number is a document identifier a hospital quotes
in an audit. Global uniqueness means (a) a caller can probe whether a number is in use anywhere, and
(b) two tenants cannot independently adopt the same numbering scheme — which is exactly what
independent organisations do. The blast radius is smaller than D-04 because the value is usually
generated, which is why this is medium.

**Fix direction.** `UNIQUE (tenant_id, certificate_number)`. Check for existing cross-tenant
duplicates first.

**psql needed:**

```sql
SELECT tenant_id, certificate_number, count(*) FROM certificates
 GROUP BY 1,2 HAVING count(*) > 1;
SELECT certificate_number, count(DISTINCT tenant_id) FROM certificates
 GROUP BY 1 HAVING count(DISTINCT tenant_id) > 1;
```

**Definition of Done**
- [ ] queries run and recorded
- [ ] composite constraint in place
- [ ] test: two tenants each issue `CERT-0001`; both succeed
- [ ] test: a duplicate within one tenant is a 409 with a state explanation

---

### D-16 — `roles` is a global table

| | |
|---|---|
| **Status** | TODO — confirms and widens **A-38** |
| **Severity** | medium — **high** in consequence; medium because it is a data-model decision, not a defect |
| **Verified** | from code, 2026-09-23 |

**Evidence** — `models/role.model.js` declares no `tenantId` (Reference Table 1, row 37), so the
global hooks do not apply to it at all, and `name` is globally unique at `:26`.
`models/roleMenuPermission.model.js` likewise has no tenant column, and its unique key is
`(role_id, menu_group_id)` (`:51`) — so **the permission matrix is shared platform-wide too**.

`Role.findByPk` by a caller-supplied id appears at `services/roles.service.js:106,132,157` and
`services/menuGroup.service.js:262,291`, and through SCIM `/Groups/:id`.

**Why it matters here.** A-38 records this for SCIM Groups: every tenant's groups are listed and a
delete removes one for everyone. This card says the same of the *whole* module — renaming a role,
changing its menu permissions, or deleting it, from any route, changes it for every tenant. A-27's
fix (`assertMutableGroup`, `assertAssignableRole`) protects *system* roles through *SCIM*. A custom
role created by tenant A, through the ordinary roles API, is still visible and editable by tenant B
if B knows its id.

A-27's own residual list already says this: *"roles are **global**, not per-tenant … That is a
data-model question, not a guard — Open Question."* This card is the data-layer evidence for that
Open Question, and it adds `role_menu_permissions`, which neither A-27 nor A-38 mentions.

**Fix direction.** Not a bug fix. Either roles gain a nullable `tenant_id` (NULL = system role,
shared; non-NULL = tenant-owned) with `UNIQUE (tenant_id, name)`, and the hooks then scope them for
free — or the platform commits to global roles and says so, loudly, in
`docs/DATABASE/04-RBAC-TABLES.md`, with every write route restricted to SUPERADMIN. The first is a
migration with a backfill; the second is a guard sweep. It needs an ADR either way.

**Definition of Done**
- [ ] an ADR recording the decision, with alternatives and the bad implications of each
- [ ] A-38 and A-27's residual list point at it
- [ ] if scoped: migration, backfill, composite unique, and a two-tenant test asserting 404 on another tenant's role id
- [ ] if global: every mutating roles and role-permission route is SUPERADMIN-only, with a test per route

---

### D-17 — Nineteen models have no tenant column

| | |
|---|---|
| **Status** | TODO |
| **Severity** | medium |
| **Verified** | from code, 2026-09-23 |

Reference Table 1 lists them; the table under it lists what reaches each by a caller-supplied id.
Three groups, three verdicts:

1. **Correct by design, undocumented in the model.** `Tenant` (it *is* the tenant), `MenuGroup`
   (platform taxonomy). Nothing to fix but a comment.
2. **Protected by an explicit chokepoint, with no backstop.** The seven `kanban_*` children, plus
   `WorkflowStep`, `WorkflowAction`, `NotificationState`, `TicketComment`. Every current lookup
   carries the scoped parent's id (`where: { id, projectId }`, `loadTicket(user, …)`), and the
   parent model *is* scoped. This is good code. It is also the only thing there is: a new handler
   written without the parent id in its `where` reaches another tenant's rows, and nothing in the
   ORM, the build or the tests would say so.
3. **A design decision nobody wrote down.** `Post`, `Category`, `PostCategory` — the CMS is
   platform-global, which is why their slugs are globally unique (Reference Table 2, ranks 7-8).
   `Role`, `RoleMenuPermission`, `UserMenuPermission` — see D-16.

**Fix direction.** For group 2, add a `tenant_id` column to the child tables and let the hooks do
the work — it is denormalised, and denormalisation is the right trade for a deny-by-default
predicate that cannot be forgotten. Failing that, a test that enumerates every service function
taking an id and asserts it also constrains by a scoped parent. For groups 1 and 3, a comment in
each model saying **why** it has no tenant column, so the next reader does not have to infer it from
the absence of a line.

**Definition of Done**
- [ ] every unscoped model carries a comment naming the reason and the compensating control
- [ ] the CMS decision recorded (ADR or `docs/DATABASE/12-PLATFORM-TABLES.md`)
- [ ] group 2: either `tenant_id` added, or a test per service function asserting the parent-id constraint
- [ ] a test that fails when a **new** model without a tenant column is added and not listed in the documented exceptions

---

### D-18 — `signature_records` CASCADE-deletes with its workflow, its step and its tenant

| | |
|---|---|
| **Status** | TODO |
| **Severity** | medium |
| **Verified** | from code, 2026-09-23 |

**Evidence** — `models/signatureRecord.model.js:19-40`: `tenantId` → `tenants` CASCADE,
`workflowId` → `signature_workflows` CASCADE, `workflowStepId` → `signature_workflow_steps`
CASCADE. `userId` (`:37-41`) has **no** `onDelete`, so it defaults to `NO ACTION`.

**Why it matters here.** A-28 granted `DELETE /esignature/workflows` to `qms:write`. Today that is
safe because `services/eSignature.service.js:946` calls `workflow.destroy()` and
`SignatureWorkflow` is `paranoid` — the comment on that line says so explicitly — so the database
CASCADE never fires. The protection is one missing `force: true` away from being gone, in a file
where someone might reasonably add it to make a delete actually delete.

The `userId` FK is the mirror-image problem: with `NO ACTION`, deleting a user who has ever signed
anything fails with a raw PG foreign-key error rather than a 409 that explains it.

**Fix direction.** Evidence tables get `ON DELETE RESTRICT`, so the database refuses rather than
silently obeying, and the service turns the refusal into a 409 with a state explanation. Decide it
once, for `signature_records`, `e_signature_records`, `certificates`, `calibration_records` and
`attachments`, and record it.

**Definition of Done**
- [ ] a single recorded rule for evidence-bearing FKs, applied to all five tables
- [ ] migration altering the constraints, verified with `\d+` in psql
- [ ] test: hard-deleting a workflow that has signature records is refused with a 409 that names the state
- [ ] a test asserting `SignatureWorkflow.destroy` is never called with `force: true`

---

### D-19 — `iot_readings` has no retention and no `(tenant_id, timestamp)` index

| | |
|---|---|
| **Status** | TODO |
| **Severity** | medium |
| **Verified** | from code, 2026-09-23. Growth **needs psql** |

**Evidence** — `models/iotReading.model.js:49-54` declares four indexes: `tenant_id`, `device_id`,
`timestamp`, `(device_id, timestamp)`. There is no `(tenant_id, timestamp)`.

`services/dataRetention.service.js:6-10` lists exactly three retained entities — `audit_logs`,
`notifications`, `sessions`. `iot_readings` is not one of them, and neither is anything else. The
only deletes are in `services/migration.service.js:1987` (demo-data teardown).

**Why it matters here.** This is the highest-cardinality table in the design by an order of
magnitude: one row per device per reading interval, forever. It is mitigated entirely by accident —
A-29 records that **zero** devices have `iot_enabled` and zero have a token, so nothing is
ingesting. The moment A-29 is fixed, this table starts growing with no ceiling and no index
supporting the per-tenant time-range query any dashboard over it would issue.

`services/predictiveMaintenance.service.js:31,44` already issues `IotReading.count` with a tenant
and a time window — exactly the shape the missing index would serve.

**Fix direction.** Add `(tenant_id, device_id, timestamp DESC)` and consider BRIN on `timestamp`.
Add `iot_readings` to `DEFAULT_RETENTION_DAYS` with a conservative default. Decide on monthly
partitioning **before** the table has rows — that is the whole window in which it is cheap.

**Definition of Done**
- [ ] a retention default for `iot_readings`, and a purge that carries the tenant predicate (D-03)
- [ ] the composite index added by migration
- [ ] a decision recorded on partitioning, taken while the table is empty
- [ ] the same asked of `webhook_deliveries` and `document_chunks`, which have the same unbounded-growth shape

---

### D-20 — Fifteen models declare no `indexes` block at all

| | |
|---|---|
| **Status** | TODO |
| **Severity** | medium |
| **Verified** | from code, 2026-09-23 |

**Evidence** — models with no `indexes` array: `auditLog` (D-08), `batchJob`, `capa`, `invoice`,
`maintenanceWorkOrder`, `nonConformance`, `notification`, `risk`, `sopDocument`,
`sopTrainingAcknowledgment`, `subscription`, `supplierScorecard`, `ticketCounter`, `vendor`,
`workflow` / `workflowAction` / `workflowInstance` / `workflowStep`.

Sequelize creates an index for a **primary key** and for a **unique** constraint. It does **not**
create one for a plain foreign key. So every one of these tables has an unindexed `tenant_id` — the
column every query filters on — plus unindexed FKs to `users`, `calibration_devices`, `vendors` and
so on.

**Why it matters here.** `tenant_id` is not an ordinary filter; it is the isolation boundary. An
unindexed one means every read of `capas`, `risks`, `non_conformances`, `maintenance_work_orders`,
`invoices` and `notifications` sequentially scans every tenant's rows to return one tenant's. It is
invisible while the reference database is small and becomes the first production incident when it is
not. An unindexed FK also makes every `ON DELETE CASCADE` on the parent a full scan of the child.

**Fix direction.** A migration adding `(tenant_id)` to each, plus `(tenant_id, status)` where the
service filters on status (`services/risk.service.js:16-18`, `qms.service.js`,
`maintenance.service.js`) and an index on each FK. Adding them to the model `indexes` block alone is
**not enough** — `db.sync()` will not add an index to an existing table (D-13), so the model block
and the migration both have to be written.

**Definition of Done**
- [ ] `(tenant_id)` on all fifteen, by migration **and** in the model block
- [ ] FK columns indexed
- [ ] `EXPLAIN` before/after recorded for the three largest
- [ ] a check that a model declaring `tenantId` and no `tenant_id` index fails review

---

### D-21 — DECIMAL comes back from `pg` as a string

| | |
|---|---|
| **Status** | TODO |
| **Severity** | medium |
| **Verified** | from code, 2026-09-23 |

**Evidence** — four DECIMAL columns:

| Column | Model | Coerced at read? |
|---|---|---|
| `asset_finances.purchase_price` | `assetFinance.model.js:39` | **yes** — `services/finance.service.js:41`: `Number(record.purchasePrice) \|\| 0`, and `:265,275` |
| `asset_finances.residual_value` | `assetFinance.model.js:48` | not seen |
| `invoices.amount` | `invoice.model.js:43` | **no coercion found anywhere in `services/`** |
| `invoices.tax` | `invoice.model.js:48` | **no coercion found anywhere in `services/`** |

`node-postgres` returns `numeric` as a **string**, by design, to avoid silent float loss. Sequelize
does not convert it.

**Why it matters here.** `finance.service.js` was clearly written after someone was bitten — the
`Number()` calls and the `round2` helper are there for a reason. `invoices` was not. Untouched,
`amount` and `tax` serialise to JSON as `"1250.00"` and the frontend renders them fine; the first
`invoice.amount + invoice.tax` produces `"1250.001250.00"`, and the first `>` comparison compares
strings lexicographically, so `"90.00" > "1000.00"` is **true**. Neither throws. Both are the shape
`CLAUDE.md` warns about: wrong, quiet, and plausible-looking.

**Fix direction.** Either a `get()` on each DECIMAL attribute returning `Number(...)` — consistent,
one place, visible in the model — or a parser registered on the `pg` type OID, which is global and
therefore also fixes aggregate results. Decide once; the per-attribute getter is easier to audit.
Then a test that reads a row back and asserts the **type**.

**Definition of Done**
- [ ] a decision recorded and applied to all four columns
- [ ] a test per column asserting `typeof === "number"`, not just the value
- [ ] every arithmetic site on money audited, including aggregates (`SUM` also returns a string)
- [ ] the backend standards state the rule, so a fifth DECIMAL column does not repeat it

---

### D-22 — `attachments.resource_id` is a polymorphic id with no foreign key

| | |
|---|---|
| **Status** | TODO |
| **Severity** | medium |
| **Verified** | from code, 2026-09-23 |

**Evidence** — `models/attachment.model.js:25-33`: `resourceType` (a plain `STRING(50)`, default
`"generic"`) and `resourceId` (`UUID`, nullable, **no `references`**). Indexed together at `:93`.

**Why it matters here.** Three consequences, all quiet:

- **Nothing constrains `resourceType`.** It is a free string, not an ENUM and not checked against a
  list. A typo attaches a file to a resource type nothing will ever query.
- **Nothing cleans up.** Deleting a certificate leaves its attachments as rows pointing at an id
  that no longer resolves. A-28 made attachment deletion a soft delete with an audit row — good —
  but that is the *explicit* path; the orphaning path is silent.
- **The pair is the authorization key.** A-28 gates attachment access on `equipment:read/write`
  because `attachments` has no menu slug. Whether a caller may see a given attachment depends on
  `(resource_type, resource_id)` resolving to something they can see — and the database cannot help
  check that, because it does not know what the pair points at.

The row **is** tenant-scoped, so cross-tenant access is closed. This is an integrity and lifecycle
finding, not an isolation one.

**Fix direction.** Constrain `resourceType` to a checked list shared with the code that reads it.
Add a cleanup: soft-deleting a parent soft-deletes its attachments, in the same transaction, with an
audit row. Add an orphan report so existing ones can be found.

**Definition of Done**
- [ ] `resourceType` validated against a single shared list
- [ ] soft-deleting a parent soft-deletes its attachments, in one transaction, audited
- [ ] an orphan query recorded and run against the deployed database
- [ ] test: the attachments of a soft-deleted certificate are no longer listed

---

### D-23 — `hardDeleteOffboardedTenant` force-deletes four tables and leaves the rest

| | |
|---|---|
| **Status** | TODO |
| **Severity** | medium |
| **Verified** | from code, 2026-09-23 |

**Evidence** — `services/tenantLifecycle.service.js:176-181`:

```js
await User.destroy({ where: { tenantId }, force: true });
await Subscription.destroy({ where: { tenantId }, force: true });
await Invoice.destroy({ where: { tenantId }, force: true });
await TenantSettings.destroy({ where: { tenantId }, force: true });
await tenant.destroy({ force: true });
```

Four tables named out of the 53 that carry `tenantId`. Everything else is left to the
`ON DELETE CASCADE` on `tenants`, which most tenant-scoped models declare.

**Why it matters here.** Three problems compound:

1. **`User.destroy({ force: true })` fires D-10.** `calibration_records.performed_by` is
   `ON DELETE CASCADE` to `users`, so this line deletes calibration records — or, for records that
   have a certificate, fails with a raw foreign-key error partway through, because
   `certificates.calibration_record_id` has no `onDelete`. Which of the two happens depends on the
   data.
2. **There is no transaction.** Five statements, no `db.transaction`. A failure at statement three
   leaves the tenant with its users and subscriptions gone and everything else intact — and the
   tenant row still present, so the operation can be retried into a different partial state.
3. **The ordering is fragile.** It works only because the FK graph happens to allow it. Adding one
   `RESTRICT` — which D-10 and D-18 both recommend — breaks it.

**Fix direction.** Wrap it in one transaction. Delete in dependency order, explicitly, rather than
relying on CASCADE for the unnamed 49 tables — or rely on CASCADE for *all* of them and delete only
the tenant row, which is simpler and provably complete. Fix D-10 first, because until then this
function's behaviour on real data is unknown.

**Definition of Done**
- [ ] one transaction; a failure leaves the tenant intact
- [ ] a recorded decision: explicit ordered deletes, or `tenants` CASCADE alone
- [ ] test: after a purge, **no** row in **any** table references the tenant id — enumerated over `db.models`, not over a hand-written list
- [ ] the evidence question answered: what is retained after a tenant purge, and for how long (a compliance answer, not an engineering one)

---

### D-24 — Unbounded reads

| | |
|---|---|
| **Status** | TODO |
| **Severity** | medium |
| **Verified** | from code, 2026-09-23 |

113 `findAll` calls in `services/`; most are correctly bounded, or bounded by their parent. These
are not, and grow with tenant size:

| Site | Read | Grows with |
|---|---|---|
| `services/gdpr.service.js:213,222,230` | every device, every calibration record and every certificate for a tenant, into memory, to build a DSAR export | the tenant's entire history |
| `services/dashboard.service.js:50-58` (`monthlyTrend`) | every row's date column over six months, bucketed in JS | every dashboard load, for each model it is called on |
| `services/sop.service.js:107` | `User.findAll({ where: { tenantId } })`, then a `bulkCreate` of one acknowledgment row per user | users × published SOPs |
| `services/eSignature.service.js:986` | `SignatureRecord.findAll` — the signature history | signatures, forever |
| `services/dataRetention.service.js:257` | `Model.findAll({ where: { tenantId } })` — every row of a model, to anonymise | the whole table |

**Why it matters here.** `monthlyTrend` is the interesting one: the comment at `:47-49` says it
fetches only the date column and buckets in JS deliberately, *"dialect-safe"*. ADR-039 made this
PostgreSQL-only. The portability that justified pulling every row into Node no longer needs
defending, and a `date_trunc` + `GROUP BY` would return six rows instead of six months of them.

The DSAR export is the one that fails first and worst — it is a compliance obligation with a
deadline, and it OOMs on exactly the large tenant most likely to file one.

**Fix direction.** `monthlyTrend` becomes a `GROUP BY date_trunc('month', …)` — Postgres-only is now
the rule, not a compromise. The DSAR export streams or paginates. The SOP fan-out batches. The
signature history takes a `limit` and a cursor, like every other list route.

**Definition of Done**
- [ ] `monthlyTrend` aggregates in SQL; the dialect-safety comment removed, citing ADR-039
- [ ] the DSAR export streams, tested at a realistic row count — not ten rows
- [ ] `getSignatureHistory` paginated, with `meta.total` as a top-level sibling of `data`
- [ ] a check that a new `findAll` on a tenant-scoped model without a `limit` is flagged in review

---

### D-25 — Two soft-delete mechanisms coexist with no rule for which

| | |
|---|---|
| **Status** | TODO |
| **Severity** | low |
| **Verified** | from code, 2026-09-23 |

Reference Table 1 shows the split: 30 models are `paranoid` (`deleted_at`), 14 carry an `isDeleted`
boolean with a `defaultScope`, and **eleven carry both** — `apiKey`, `attachment`,
`calibrationDevice`, `calibrationRecord`, `category`, `post`, `role`, `stock`, `user`, `warehouse`,
`webhook`. `Session` carries `is_deleted` + `deleted_at` and is **not** paranoid, so its
`deleted_at` is set by hand at `:116`.

The consequence is visible in one file: `services/search.service.js:26,33,39` needs
`softDelete: "is_deleted = false"` for `calibration_devices` and `stocks` but
`softDelete: "deleted_at IS NULL"` for `certificates`, because the three tables do it differently.
Every raw query over these tables has to know which, and a wrong choice returns deleted rows or
returns nothing — silently, either way.

On a model with both, a row can also be `isDeleted = true` with `deleted_at = NULL`, or the reverse:
two flags, four states, two of them meaningless.

**Fix direction.** Pick one. `paranoid` is what Sequelize supports natively, and it is what
`restore()` semantics and the `paranoid: false` include option are built around. Migrating
`isDeleted` into `deleted_at` is mechanical. Until then, a rule in `docs/DATABASE/00-DATA-MODEL.md`
and a comment on each dual model saying which flag is authoritative.

**Definition of Done**
- [ ] a recorded decision, as an ADR
- [ ] the eleven dual models resolved, or documented with the authoritative flag named
- [ ] `search.service.js` stops carrying a per-table `softDelete` string
- [ ] a test that both flags agree on every model that keeps both

---

### D-26 — 46 native ENUM types, none derived from the constants they mirror

| | |
|---|---|
| **Status** | TODO |
| **Severity** | low |
| **Verified** | from code, 2026-09-23 |

46 `DataTypes.ENUM(...)` declarations across the models, each a literal list. Postgres creates a
named type per enum (`enum_<table>_<column>`), which migrations `0011` and `0017` already have to
drop by hand (`0011:6-7`, `0017:30-38`) to avoid collisions — evidence that they are awkward to
change.

Two risks:

- **drift** — the literal list in the model and the constant list in `src/constants/` are maintained
  separately, and nothing compares them. A value added to one is not added to the other, and the
  write fails at the database with a type error rather than a 400;
- **migration cost** — adding a value to a Postgres enum needs `ALTER TYPE`, which the `db.sync()`
  path does not do (D-13), so an enum value added to a model is absent on the deployed database
  exactly like a missing column.

**Fix direction.** Either derive the ENUM list from the shared constant at model-definition time so
they cannot diverge, or replace the native enums with `STRING` plus a `CHECK` constraint plus
application-level validation, which is far easier to migrate. The decision belongs with the Phase-9
typing work, which will want the union type anyway.

**Definition of Done**
- [ ] a recorded decision
- [ ] a test that every model ENUM list equals its constant, for every enum that has one
- [ ] `docs/DATABASE/00-DATA-MODEL.md` states how an enum value is added, end to end

---

### D-27 — Fourteen `JSON`/`JSONB` columns with no declared shape

| | |
|---|---|
| **Status** | TODO |
| **Severity** | low |
| **Verified** | from code, 2026-09-23 |

Fourteen `DataTypes.JSON`/`JSONB` columns. Two matter more than the rest:

- `audit_logs.changes` (`models/auditLog.model.js:52-56`) — *"Stores `{ before: {}, after: {} }`
  snapshots"*, in a comment. Nothing enforces it, nothing redacts it, and A-43 records that
  `auditAction` logs full request and response bodies unredacted. This column is where that lands.
- `api_keys.scopes` (`models/apiKey.model.js:40-43`) — an array of `<slug>:<action>` strings,
  validated on write by `assertScopes` (A-27) but not on read, and the comment still shows the `"*"`
  form that A-27 now rejects.

**Why it matters here.** A JSON column whose shape lives only in a comment is a shape that drifts.
For `audit_logs.changes` it is also where a secret will eventually be written, and there is no
schema to say which keys are not allowed. `CLAUDE.md`'s own evidence rule applies: *"a redaction
test iterating the redactor's own key set cannot catch a key being deleted from it"* — a declared
schema is what makes such a test mean something.

**Fix direction.** A declared shape per column — a Joi schema, or a TypeScript type under Phase 9 —
validated on write. For `audit_logs.changes`, a deny-list of key names checked at write time, and a
test over real fixtures rather than over the deny-list itself.

**Definition of Done**
- [ ] each JSON column has a declared, validated shape
- [ ] `audit_logs.changes` redaction tested against fixtures containing real secret-shaped keys
- [ ] the `api_keys.scopes` comment corrected to match `assertScopes`

---

### D-28 — `"UsageMetrics"` is the only camelCase table in the schema

| | |
|---|---|
| **Status** | TODO |
| **Severity** | low |
| **Verified** | from code, 2026-09-23 |

**Evidence** — `models/usageMetric.model.js:38-46`: `tableName: "UsageMetrics"`, no
`underscored: true`, so the columns are `"tenantId"` and `"periodStart"` — every other table in the
schema is snake_case with `underscored: true`. The model's own header explains it: the
metered-billing raw SQL queries that shape.

**Why it matters here.** It is circular — the model is camelCase because the SQL is, and the SQL is
camelCase because the model is. It is the kind of local exception that is fine until someone writes
`FROM usage_metrics` or `WHERE tenant_id = …` from muscle memory and gets `relation does not exist`
or `column does not exist`. A-08 was a bug in exactly this file, for a neighbouring reason.

The tenant hooks do work on it — `tenantKeyOf` finds `tenantId`, and the physical column is
`"tenantId"`, so the predicate is valid.

**Fix direction.** Rename the table and columns to the house convention in one migration, and update
the two raw statements (`services/meteredBilling.service.js:177-190`, `:655-658`). Low priority; the
cost of leaving it is a comment, and the comment already exists. Worth doing while the table is
small.

**Definition of Done**
- [ ] a decision: rename, or document the exception in `docs/DATABASE/11-BILLING-TABLES.md`
- [ ] if renamed: migration, both raw statements updated, and a test that reads a metric back

---

### D-29 — Migration 0019 reviewed line by line

| | |
|---|---|
| **Status** | — (informational) |
| **Severity** | info |
| **Verified** | from code, 2026-09-23. **It has never been run**; this audit does not change that |

`src/migrations/0019-add-signature-crypto-fields.js` was read in full against the trap list. It is
**correct**, and it is the best migration in the directory.

| Check | Result |
|---|---|
| blanket `try/catch` | **absent, and the absence is deliberate** — the header at `:20-23` says so and gives the reason |
| idempotent `up` | yes — `:38-43` reads `describeTable` and adds only absent columns; `:46-55` reads `showIndex` and adds the index only if absent |
| reversible `down` | yes — `:58-73`, index first then columns, each guarded |
| registered in the manifest | yes — `src/config/migrator.js:66`, with the `.js` suffix matching the other eighteen |
| model/migration agreement | yes — `models/signatureRecord.model.js:48,55,60,66` declares all four attributes; the physical names in `COLUMNS` (`:25-30`) match what `underscored: true` produces |
| backfill | **deliberately none**, `:16-19`: existing rows keep NULL, which is how `verifySignature` reports them as unverifiable rather than valid. The right call, and the header says why |
| destructive statements | none |

**Two residual risks, neither a defect:**

1. **`context.queryInterface || context` (`:35`, `:60`).** Harmless today — `src/config/migrator.js:62`
   passes the `QueryInterface` itself and a `QueryInterface` has no `.queryInterface` property, so
   the fallback takes the right branch. It is a vestige of the wrapper bug the migrator's own
   comment at `:52-60` describes. Nine other migrations carry the same line. Deleting it everywhere
   would make the contract single-valued; keeping it costs nothing but ambiguity.
2. **`showIndex` name matching.** `:49-51` matches on the literal index name
   `"signature_records_signing_key_id"`, which is also the name it creates at `:56`. Self-consistent,
   so re-running is safe. If the index had ever been created under Sequelize's default name it would
   be created a second time under this one.

**The one thing that cannot be checked from here:** that `signature_records` exists on the target
database with the shape `describeTable` expects. Migrations run after `db.sync()`
(`backend/index.js:590`), and `sync` creates the table from the model, so on any database the
application has started against it will. Confirm before the first run:

```sql
\d+ signature_records
SELECT name FROM schema_migrations ORDER BY name;   -- 0019 should be absent
```

---

## What Needs a Database

No database was reachable from the auditing machine. These are the claims psql would settle, with
the query. Run them against the VM database (`10.1.200.13:/home/infra/callibrator`, per `MEMORY`),
**as the application role, not the owner** — per `CLAUDE.md`'s evidence rule, a grant checked as the
owner passes whether it exists or not.

| Card | Question | Query |
|---|---|---|
| **D-13** | which model columns are missing on the deployed database | `SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema='public' ORDER BY 1, ordinal_position;` — diff against `Object.values(db.models).flatMap(m => Object.values(m.rawAttributes).map(a => [m.tableName, a.field]))` |
| **D-14** | did 0002/0004/0009/0013/0016 actually add their columns, or return early | `\d invoices` · `\d users` · `\d calibration_records` · `\d tenants` · `\d attachments` — looking for `stripe_invoice_id`, the MFA fields, the uncertainty fields, `parent_id`, `storage_key` |
| **D-04** | is the global serial-number constraint present, and would a composite collide | `SELECT pg_get_indexdef(ix.indexrelid) FROM pg_index ix JOIN pg_class t ON t.oid=ix.indrelid WHERE t.relname='calibration_devices' AND ix.indisunique;` and `SELECT tenant_id, serial_number, count(*) FROM calibration_devices WHERE serial_number IS NOT NULL GROUP BY 1,2 HAVING count(*)>1;` |
| **D-06** | the same for users | `SELECT pg_get_indexdef(ix.indexrelid) FROM pg_index ix JOIN pg_class t ON t.oid=ix.indrelid WHERE t.relname='users' AND ix.indisunique;` and `SELECT lower(email), count(DISTINCT tenant_id) FROM users GROUP BY 1 HAVING count(DISTINCT tenant_id)>1;` |
| **D-15** | the same for certificates | `SELECT certificate_number, count(DISTINCT tenant_id) FROM certificates GROUP BY 1 HAVING count(DISTINCT tenant_id)>1;` |
| **D-08** | how big is `audit_logs`, and what does the list query plan look like | `SELECT pg_size_pretty(pg_total_relation_size('audit_logs')), count(*) FROM audit_logs;` · `SELECT indexname FROM pg_indexes WHERE tablename='audit_logs';` · `EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM audit_logs WHERE tenant_id='<uuid>' ORDER BY created_at DESC LIMIT 50;` |
| **D-19** | is anything ingesting IoT readings yet | `SELECT count(*) FROM iot_readings;` · `SELECT count(*) FROM calibration_devices WHERE iot_enabled;` |
| **D-20** | which tenant-scoped tables have no `tenant_id` index | `SELECT c.relname FROM pg_class c JOIN pg_attribute a ON a.attrelid=c.oid AND a.attname='tenant_id' WHERE c.relkind='r' AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid=c.oid AND a.attnum = ANY(i.indkey));` |
| **D-10 / D-18** | what the evidence-table FKs actually are on disk | `SELECT conname, conrelid::regclass, confrelid::regclass, confdeltype FROM pg_constraint WHERE contype='f' AND conrelid::regclass::text IN ('calibration_records','certificates','signature_records','e_signature_records','attachments');` (`confdeltype`: `c`=cascade, `r`=restrict, `n`=set null, `a`=no action) |
| **D-29** | is `0019` pending, and does its table exist | `SELECT name FROM schema_migrations ORDER BY name;` · `\d+ signature_records` |
| **D-01** | did any row land with a NULL tenant | one per scoped table, e.g. `SELECT count(*) FROM tenant_settings WHERE tenant_id IS NULL;` — repeat for every table marked scoped in Reference Table 1 |

**What a database would *not* settle**, and should not be claimed either way without one: whether
any of these has been exploited. Nothing here was attacked, on the reference deployment or anywhere
else.
