# Debate C-2: Should a parent tenant ever see child tenant data? (Q-05)

Debate paper · 2026-09-27/28 · decided in **ADR-084** (`../MEMORY/DECISIONS.md`). Both positions, then the referee.

## The behaviour as the code had it (read 2026-09-27)

- Tenants nest: `tenants.parentId` (migration 0013) and the materialised `tenant_hierarchies` (`path`, `depth`).
  Re-parenting is a platform operation (A-01, A-224); reads of a named tenant are limited to the caller's own tenant
  with a 404 otherwise (`routes/api/tenantHierarchy.route.js#ownTenantOnly`).
- The global tenant hooks are exact-match on one `tenantId` per principal. They never read the hierarchy.
- **But** `tenantHierarchy.service.js` still exported `getDataVisibilityScope(tenantId, scope)` and
  `buildTenantFilter`, with a `"subtree"` scope (parent reads every descendant) and an `"all"` scope (any member reads
  the whole family: parent **and siblings**), plus `HIERARCHY_SCOPE` and an `assignRole` validator defaulting to
  `scope: "subtree"`. Nothing called them. The `"all"` scope found the family by `code LIKE '<root>_%'`, which also
  matches an unrelated tenant whose code merely begins with the root's.
- `tenant_hierarchies` is itself tenant-scoped, so a tenant user's tree read returns no children at all; only the
  platform operator sees the structure across tenants.

## Position A — compliance first: never

1. Each hospital is its own regulated entity and its own GDPR controller for its staff's and patients' data. A parent
   organisation in the tenant tree is not automatically a processor with a lawful basis. Visibility by hierarchy is a
   disclosure nobody consented to.
2. The multi-tenancy document (`docs/SECURITY/05`) is deny-by-default. A second path to another tenant's rows is a
   second place for the isolation defect this codebase has already had twice (A-87, ADR-048).
3. The dead helpers are a loaded gun: the next "group dashboard" card will find `buildTenantFilter(..., "subtree")`,
   wire it in, and the `LIKE` bug comes along. Delete them (the ADR-051 Q-10 precedent: dead engines that mean "delete
   everything" or "see everything" are removed, not left).

**Concedes:** hospital groups do ask for group reporting, and "never" gives them nothing.

## Position B — operability first: yes, for a group that asks

1. The hierarchy exists for hospital groups. A group quality manager who cannot see whether member hospitals'
   devices are in calibration is running the group on spreadsheets exported from each hospital — a worse privacy
   outcome than a controlled view.
2. Offer an opt-in role in the parent with read access to children's operational data, audited in both tenants.

**Concedes:** row-level access to a child's data from the parent is the hardest thing in the product to get right,
and the helpers that exist are not a design for it (the `"all"` scope would show a child its siblings). B would accept
aggregates first.

## Where they agree

- The hierarchy alone must not confer access; if anything is built, it is explicit, consented and audited.
- The existing helpers must not be the basis of it.

## Referee's decision (ADR-084, Q-05)

**No. A parent tenant never sees a child tenant's data by virtue of the hierarchy, and nothing in the code may widen a
principal's tenant through it.** The hierarchy is structure (names, codes, links), visible to the platform operator.

- Removed: `getDataVisibilityScope`, `buildTenantFilter`, `HIERARCHY_SCOPE` and the `assignRole` validator.
- Pinned by `tenantHierarchy.visibility.q05.test.js`: tenant A made the **parent** of tenant B through the real router;
  every read naming the other tenant is 404 in both directions and byte-identical to a non-existent id; no source file
  calls a visibility helper; the tenant-context middleware never reads the hierarchy.
- **Group reporting, if the owner wants it, is a new feature with its own ADR:** aggregates only (counts and
  compliance rates, no rows), enabled by each child tenant's administrator, revocable, audited in both tenants.

**Why A:** B's own concession — aggregates first, and not these helpers — leaves nothing of B's position that needs
the hierarchy to grant access today. Removing dead code that encodes the opposite answer costs nothing.
