# Feature Spec — <Task ID> <Title>

**Written:** YYYY-MM-DD — **before** implementation
**Task:** <ID>
**Author:** <who>
**Spec refs:** <docs/ documents this implements>

> Save to `MEMORY/specs/<task-id>-<slug>.md`.
>
> A feature spec is required for any task marked `Spec required` in `TASKS/`. It is written **before** code, and its purpose is to surface the decisions and traps **while they are still cheap** — reading `docs/` carefully before writing code is what has repeatedly found contradictions that would otherwise have become defects.

---

## Problem

*What is not possible today, and for whom. Name the persona from `docs/UI-UX/03-PERSONAS.md` where one applies.*

---

## What `docs/` Already Decides

*Read every document in Spec refs and list what is already settled. Do not re-decide it.*

| Decision | Source |
|---|---|
| | |

**If `docs/` is silent, contradictory, or wrong about something you need — stop and say so here.** That is a specification gap, and it belongs in `TASKS/BACKLOG.md` and probably in an ADR before any code is written.

---

## Data Model

*New tables and columns; changes to existing ones.*

| Column | Type | Nullable | Notes |
|---|---|---|---|

Answer each of these explicitly:

- [ ] Does every new table carry **`tenantId`**? If not, what is the recorded reason?
- [ ] Is it `paranoid`? Should it be? Is soft delete right for **evidence**?
- [ ] What are the delete rules, and do they respect *governance and evidence outlive operations*?
- [ ] Which columns are indexed, and which query justifies each?
- [ ] Any uniqueness constraint — is it **per tenant** or global? A global one is a cross-tenant oracle.
- [ ] Any ENUM — what are the exact values, and is the vocabulary consistent with neighbouring tables?
- [ ] Anything derived — is it **`VIRTUAL`**, or stored where it can disagree with its inputs?

---

## API

| Method | Path | Permission | Purpose |
|---|---|---|---|

- [ ] Every route has a **permission gate**. (Nothing in the build enforces this.)
- [ ] Identifiers: path, body, or query string — and does the **validator see them**?
- [ ] `PUT` or `PATCH`? The API is not internally consistent; check the neighbours.
- [ ] Response uses the standard envelope — rows in `data`, pagination in a **top-level `meta`**.
- [ ] Status codes: 400 validation, 403 in-tenant permission, **404 cross-tenant**, **409 invalid transition**.
- [ ] Is any endpoint **public**? That needs an ADR.

---

## Business Rules

*New rules, as `BR-<n>` candidates, each with its **enforcement point of record**.*

**A rule with no enforcement point is an aspiration.** State whether each is a database constraint, a middleware, a service check, or a convention — and if it is a convention, say so plainly rather than implying more.

---

## Security

- [ ] Tenant isolation: does anything bypass the global hooks — raw SQL, vector search, a cache key?
- [ ] Any new `skipTenantScope` or `isSystemTask`, and why?
- [ ] Any new secret? Where is it stored, and does it reach `audit_logs.changes`?
- [ ] Any outbound request to a **tenant-supplied** destination? That is SSRF.
- [ ] Any new fail-open/fail-closed choice? Which way, and why?
- [ ] Does anything new appear in a **list** response that should not — a token, a credential, an internal note?

---

## Compliance

- [ ] Does this touch evidence — calibration records, certificates, signatures, audit?
- [ ] Is it append-only, and is that a **constraint** or a convention?
- [ ] Does it need an audit row? Is it written **inside the transaction**?
- [ ] Is any new personal data covered by DSAR export, erasure and retention?

---

## UI

*Screens, and which menu slug gates them.*

- [ ] Menu slug added to `MENU_SLUGS` **and** `ROLE_MENU_ASSIGNMENTS`? A group nobody is granted is invisible.
- [ ] Three list states — loading, empty, **failed**?
- [ ] Density: is this a scanning screen or a precision screen?
- [ ] Does it work at 375px, keyboard-only, and with reduced motion?

---

## Tests

*Name them, before writing them.*

- Unit:
- Integration:
- Live E2E:
- **Two-tenant IDOR** (required for any `:id` route):
- Negative authorization cases (the positive case alone proves nothing):
- Mutation check:

---

## Traps to Avoid

*The known ones, checked against this feature. Delete what does not apply; add what you find.*

- [ ] `required: false` on every optional include — the most repeated defect here
- [ ] `validate(schema)`, never `schema.validate`
- [ ] `{ ...req.params, ...req.body }` where identifiers arrive in the path
- [ ] `const { sequelize } = require("../models")` — **not `db`**
- [ ] `isDeleted`, not `is_deleted`
- [ ] `sessions` uses snake_case attributes
- [ ] A new role needs a **`ROLE_LEVELS`** entry, or it fails every gate silently
- [ ] A migration must not swallow errors in a blanket `try/catch`

---

## Open Questions

*Anything that needs a decision from the owner. Raise before coding, not after.*

---

## Rollout

- [ ] Is the migration **expand-and-contract**? Can the previous code run against the new schema?
- [ ] Does `down` exist, and has it been tested?
- [ ] Is this behind a feature flag?
- [ ] What does the rollback look like if this is wrong?
