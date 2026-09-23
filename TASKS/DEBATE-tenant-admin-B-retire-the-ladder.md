# Position B — Retire the Ladder

**The tenant-admin lockout is not a missing column. It is the second authorization system failing
the way a second authorization system fails.**

Position paper · 2026-09-23 · answers
[`DEBATE-tenant-admin-A-fix-the-principal.md`](./DEBATE-tenant-admin-A-fix-the-principal.md)

> **Note on the opposing paper.** I drafted §0–§2 before A's paper was filed, against the brief's
> summary of A's position (*"add `role_level` to the projection, keep the tier"*). A's filed paper
> is stronger than that summary, and **A independently found the half of the defect I led with** —
> A § *"The half of the defect nobody has found"*. I have left my §0 standing because the referee
> needs the evidence, but I have rewritten its framing to credit A, and §3 now answers A's five
> numbered rebuttals by name rather than a reconstruction of them. Where I correct A on a fact, I
> give the file and line so the referee can check me rather than trust me.

**Where A and I already agree, so the referee can set it aside:** the mechanism is broken at both
ends (projection *and* seed); `meteredBilling.route.js:33` names a role that has never existed and
belongs to `dynamicAccess`; `dynamicAccess` stays the default and `rbac` stays rare; the fix must
ship today and must carry a named test driving the real loader with `rbac` unmocked; and retiring
the ladder needs an ADR rather than a judgement call inside a bug fix. **A's §5.4 and §5.6 concede
the direction of travel.** What is actually in dispute is one question: *when these five routers are
touched, do they keep a privilege floor or take a menu slug?*

---

## §0 — The mechanism has never run, at either end — and A agrees

**A found this too, and says so in its own §0** (*"The half of the defect nobody has found"*) and
concedes it in §5.1 (*"My fix is bigger than 'add one attribute'"*) and §5.2 (*"this mechanism has
been decorative for its entire life"*). I am not scoring a point A missed. I am establishing the
fact both papers rest on, and then drawing the conclusion A does not draw from it.

`rbac` reads the level off the principal:

```js
// middlewares/rbac.middleware.js:38-39
const userRoleLevel =
  req.user.role?.role_level || req.user.role?.roleLevel || 0;
```

The principal on every authenticated request is built by `auth.middleware.js:92` →
`authService.getAuthUserWithTenant` (`services/auth.service.js:444`), whose role projection is:

```js
// services/auth.service.js:451
attributes: ["id", "name", "description"],
```

No `roleLevel`. The same omission appears at `auth.service.js:174` (login),
`auth.service.js:410` (`verifyUserSession`) and `auth.service.js:626` (MFA login). That is the
defect the brief states, and it is real. Add the attribute and the loader stops hiding the column.

**Then the gate reads the column. And the column is `1`.**

```js
// models/role.model.js:36-39
roleLevel: {
  type: DataTypes.INTEGER,
  defaultValue: 1,
},
```

Nothing sets it. `DEFAULT_ROLES` (`services/migration.service.js:78-115`) and
`APPLICATION_ROLES` (`:120-185`) seed eleven roles — `SUPERADMIN`, `HEALTHCARE ADMIN`,
`CALIBRATOR ADMIN`, and eight more — with `id`, `name`, `description`, `nameToShow`, `isSystem`,
`status`, `sortOrder`. **Not one of them carries `roleLevel`.** Grep the whole backend for the
constant that is supposed to supply it:

```
$ grep -rn "ROLE_LEVELS" --include=*.js backend/src | grep -v tests
constants/index.js:10          # re-export
constants/roleConstants.js:97  # the definition
constants/roleConstants.js:480 # the module.exports
middlewares/rbac.middleware.js:7,15,20,21   # the only consumer
```

`ROLE_LEVELS` is read by exactly one file — the middleware that compares against a column nobody
writes. The ladder in `constants/roleConstants.js:97-111` and the column in
`roles.role_level` have never been connected. They were never the same thing.

So Position A's change, shipped alone, produces this:

| | before A's fix | after A's fix |
|---|---|---|
| `req.user.role.roleLevel` | `undefined` → `0` (`rbac.middleware.js:39`) | `1` (the model default) |
| bar for `rbac([ROLE_NAMES.TENANT_ADMIN])` | `8` (`roleConstants.js:100`) | `8` |
| `HEALTHCARE ADMIN` on `POST /api/v1/webhooks` | **403** | **403** |

**The hospital admin is still locked out.** Position A's minimal change is not minimal; to actually
unblock a tenant it needs, at least: the projection, *plus* a backfill migration writing
`role_level` for eleven existing rows, *plus* `roleLevel` added to both seed arrays so a fresh
database agrees with a migrated one, *plus* a decision about what level a tenant-created role gets —
which is the trap `CLAUDE.md` already names: *"a new role without a `ROLE_LEVELS` entry fails every
privileged gate, silently."*

This is independently corroborated in the repository. `AUDIT-2026-09-REMEDIATION.md` § A-39
(`:1333-1354`) records the same mechanism reached from the IdP side: a SCIM-created group "creates
the role with no `roleLevel` … so it takes the model default", and its members "pass neither
`rbac()` … nor `dynamicAccess`". A-39 is filed as a *separate* medium-severity defect. It is not
separate. It is this one.

**The conclusion A does not draw.** A's own accounting of its fix (A §5.1) is: four projections, one
reshaped literal at `auth.service.js:433`, two seed arrays, a backfill migration verified in `psql`,
a validator change and a service change — six parts. A §5.2 adds that the level path "has been
decorative for its entire life" and that "a mechanism nobody has run is a mechanism nobody has
learned to maintain."

Put those two sentences next to each other. We are being asked to spend a six-part change waking up
a mechanism that has never executed a true comparison in production, in order to make it
load-bearing on the five highest-consequence surfaces in the product — storage credentials, outbound
data channels, API-key minting, tenant backup restore and billing. The question "should this
mechanism exist" is not an architecture digression bolted onto a bug fix. It is the question that
six-part change is implicitly answering *yes* to, without an ADR.

**I am not arguing that A's change is wrong.** §3 says plainly that I would ship it today, in full,
including A's boot assertion and A's integration test. I am arguing that shipping it is an
operational decision and keeping the ladder afterwards is an architectural one, and that the second
should not ride along inside the first.

---

## §1 — The actual defect: this codebase has two authorization systems, and only one of them has a data model

### The counts

From [`AUDIT-2026-09-AUTHZ-MATRIX.md`](./AUDIT-2026-09-AUTHZ-MATRIX.md), which maps all 389 routes
and was verified by hand:

> Gate kinds in use: `dynamicAccess` **136** · `rbac` **68** · `denyApiKey` 38 · `superAdminOnly` 26 ·
> `requireApiKeyOrAdmin` 12 (SCIM) · `abac` 7 · `superAdminOrBootstrap` 3.

Seven names. Of those, four are *permission* systems in the sense of deciding what a role may do:
`dynamicAccess`, `rbac`, `abac`, and `superAdminOnly` (a degenerate one). `denyApiKey` is a
principal-type filter, not a permission model, and `requireApiKeyOrAdmin` is SCIM's local variant of
one.

The two that matter carry wildly different weight:

| | `dynamicAccess` | `rbac` |
|---|---|---|
| Routes gated | **136** | **68** |
| Decides by | `role_menu_permissions` rows joined to `menu_groups`, with per-user overrides from `user_menu_permissions` | an integer literal in a constants file |
| Backing data model | 2 tables + a seeded 58-row menu tree (`utils/seedMenuGroups.util.js:84-562`) | none |
| Cache | yes — `RolesService.getRolePermissionsMatrix`, `services/roles.service.js:289-292` | none |
| Configurable at runtime | yes — `/roles/*`, `/menu-groups/*`, `/user-permissions/*` are product surfaces | no — requires a deploy |
| Per-user exception | yes — `dynamicAccess.middleware.js:266-282` | no |
| Appears in `CLAUDE.md`'s canonical gated route | **yes** | **never mentioned** |

`CLAUDE.md` § *Every route needs a permission gate* shows exactly one example of what a gated route
looks like:

```js
router.post("/", auth, dynamicAccess("equipment", "write"), validate(schema), ctrl.create);
```

An agent or a new engineer reading the operating instructions cover to cover learns that
`dynamicAccess` is how you gate a route. They will not learn that `rbac` exists, or when to reach
for it, or that reaching for it on a tenant-scoped route currently denies the tenant.

### What the ladder cannot express — and the repo's own security doc says so

`docs/SECURITY/04-AUTHORIZATION-RBAC.md:62-66`:

> `WAREHOUSE STAFF` at level 4 holds `write` on `warehouse`; `SUPERVISOR` at level 6 holds only
> `read`. That is correct, not a bug. … Level is a privilege ceiling, not a superset relation.
>
> **Any `rbac()` gate that assumes higher level implies broader scope is wrong.**

Read that line, then read the gate it is about:

```js
// routes/api/storage.route.js:13
const storageAdmin = [auth, denyApiKey, rbac([ROLE_NAMES.TENANT_ADMIN])];
```

"Whoever is at least level 8 may rewrite the tenant's S3 credentials" is precisely a gate assuming
that higher level implies broader scope. The document that governs authorization in this repository
already contains the argument against the four gates the brief is about. The gates were written
anyway, on 2026-09-23, under A-02 and A-27 — by people fixing a real critical vulnerability at
speed, which is how this happens and is not a criticism of them.

The concrete business case is one sentence long, and a hospital will produce it within a quarter:
*the biomedical-engineering lead configures storage and issues API keys; the finance lead handles
billing; neither may do the other's job.* On a numeric ladder there is no answer. Both must be
level 8 to clear `rbac([TENANT_ADMIN])`, and level 8 is a single value. On the menu matrix the
answer is a row: `biomed → storage:write`, `finance → metered-billing:write`, and neither gets the
other. The matrix was built for this. The ladder structurally cannot do it.

### Someone already tried, and it silently did nothing

```js
// routes/api/meteredBilling.route.js:33
const billingGuard = [auth, rbac(["TENANT_ADMIN", "BILLING_ADMIN"])];
```

`"BILLING_ADMIN"` appears in exactly three files in the repository: this route, and two tests that
quote it. It is **not** in `ROLE_NAMES` (`roleConstants.js:28-46`), **not** in `ROLE_LEVELS`
(`:97-111`), **not** in `DEFAULT_ROLES` or `APPLICATION_ROLES`, and **not** in any seed. It is a
role that has never existed.

`rbac` does not say so. `roleLevels["BILLING_ADMIN"]` is `undefined`, filtered out at
`rbac.middleware.js:57`; the bar collapses to the other entry. Eight metered-billing routes are
SUPERADMIN-only and the gate reads as though a billing administrator could use them.

This is what "a hardcoded ladder" costs in practice: an engineer reached for the *correct*
abstraction — a role that administers billing and not storage — the system had no place to put it,
and the gate accepted the string and did nothing. `CLAUDE.md` lists this trap; here is a live
instance of it, shipped, with tests.

And the tests are the second half of the lesson. `src/tests/routes/meteredBilling.route.test.js:47-50`:

> `billingGuard = [auth, rbac(["TENANT_ADMIN","BILLING_ADMIN"])]`. The guard was previously defined
> but never applied … These tests exercise the actually-wired middleware chain **to prove the RBAC
> gate is in place and enforces the billing-admin bar.**

It proves the first clause and asserts the second. The test checks that `rbac` is the second
middleware in the stack (`:59` — "mounts the rbac guard as the second middleware on every route").
It never sends a request as a billing admin, because there is no billing admin. And the E2E spec
(`src/tests/e2e/modules/meteredBilling.e2e.test.js:14-15`) authenticates as *"the seeded
super-admin"*, who returns at `rbac.middleware.js:46-48` before any level is read. This is
`CLAUDE.md` § Evidence, verbatim: *"A test generated from the code it tests verifies consistency,
never correctness."*

### What it costs a reviewer

This is the part that is hard to put a number on and is the real argument.

A reviewer looking at one line — `rbac([ROLE_NAMES.TENANT_ADMIN])` — cannot answer "who can call
this?" without holding six facts at once:

1. `TENANT_ADMIN` is not a role. It is a logical tier (`roleConstants.js:40-45`), so the **name**
   branch at `rbac.middleware.js:64` can never match.
2. Therefore the decision falls to the **level** branch at `:65`, bar 8 (`roleConstants.js:100`).
3. The level comes from `req.user.role.role_level || req.user.role.roleLevel || 0`
   (`:38-39`) — two spellings, because `role.model.js` is `underscored: true` and nobody was sure
   which one arrives.
4. Neither arrives: `auth.service.js:451` does not select it.
5. Even selected it would be `1`, because no seed writes it (`role.model.js:38`,
   `migration.service.js:78-185`).
6. So the real answer is: **SUPERADMIN only**, via the name bypass at `:46-48` — which is a
   different branch of the function entirely.

Six files, three of them nowhere near the route. Compare `dynamicAccess("equipment", "write")`:
look up `equipment` in `ROLE_MENU_ASSIGNMENTS` (`roleConstants.js:190-412`), read the column. One
file, one lookup, and it is the same file the product configures from.

The cost is not that `rbac` is hard. It is that **a reviewer must first know which of the two
systems a route uses before they can start reasoning at all**, and nothing about the call site
tells them which one is load-bearing. That is the tax two authorization systems levy on every
review, forever, and it is why the lockout survived from whenever `tenantBackup` was written until
an audit enumerated 389 routes by hand to find it.

`AUDIT-2026-09-AUTHZ-MATRIX.md` pays this tax explicitly, in its method note: a naive sweep
"reports 112 routes as authenticated but carrying no authorization gate. That number is wrong, in
both directions." Every route had to be classified by reading the router **and** its controller
**and** its service. That is what a codebase with four permission systems costs to audit once.

### The 68, honestly counted

I owe the referee a breakdown rather than a number, because "68 routes" is the core of the case
against me (§3) and it is not 68 routes of judgement:

| Router | `rbac` routes | Gate | Does the ladder decide anything? |
|---|---|---|---|
| `roles.route.js` | 14 | `rbac(["SUPERADMIN"])` | **No** — name match at `:46-48` |
| `menuGroups.route.js` | 11 | `rbac(["SUPERADMIN"])` | **No** |
| `session.route.js` | 6 | `rbac(["SUPERADMIN"])` | **No** |
| `userPermissions.route.js` | 3 | `rbac(["SUPERADMIN"])` | **No** |
| `admin.route.js` | 3 | `router.use(rbac(["SUPER_ADMIN","SUPERADMIN"]))` `:20` | **No** |
| `apiKeys.route.js` | 4 | `rbac([TENANT_ADMIN])` `:17` | yes — and it decides *deny* |
| `webhooks.route.js` | 7 | `rbac([TENANT_ADMIN])` `:15` | yes — *deny* |
| `storage.route.js` | 5 | `rbac([TENANT_ADMIN])` `:13` | yes — *deny* |
| `tenantBackup.route.js` | 7 | `rbac([SUPER_ADMIN, TENANT_ADMIN])` `:144` et al. | yes — *deny* |
| `meteredBilling.route.js` | 8 | `rbac(["TENANT_ADMIN","BILLING_ADMIN"])` `:33` | yes — *deny* |
| **Total** | **68** | | **31 tier-gated, 37 name-gated** |

That reconciles exactly to the audit's 68.

**37 of the 68 do not use the ladder at all.** They match `"SUPERADMIN"` by name at
`rbac.middleware.js:46-48` and would behave identically under `superAdminOnly`
(`middlewares/auth.middleware.js:238`), which already gates 26 other routes. They are a rename, or
nothing.

**All 31 that use the ladder currently deny the tenant.** There is no working `rbac` level gate in
this codebase to regress.

That reframes the scope of retiring it: not 68 routes of careful judgement, but 31 routes that need
a menu slug and 37 that need `:%s/rbac(\["SUPERADMIN"\])/superAdminOnly/` or nothing.

---

## §2 — The migration, and the trap it must not walk into

### The slugs — and the honest answer to "do they exist?"

`CLAUDE.md`'s deviation protocol and finding A-07 both demand that this be checked in **both**
places before a word is written, because a `dynamicAccess` name matching no seeded menu denies
everyone silently — the same bug in a new coat. I checked both. **The answer is no, for all four.**

| Router | Proposed slug | In `MENU_SLUGS`<br>(`roleConstants.js:121-155`) | Seeded as a `menu_groups` row<br>(`seedMenuGroups.util.js`) | In `ROLE_MENU_ASSIGNMENTS`<br>(`roleConstants.js:190-412`) |
|---|---|---|---|---|
| `apiKeys` (4) | `api-keys` | **ABSENT** | **PRESENT** — `:394-402`, child of `mgmt-developer`, id `…0208` at `:34` | **ABSENT** |
| `webhooks` (7) | `webhooks` | **ABSENT** | **PRESENT** — `:403-410`, child of `mgmt-developer`, id `…0209` at `:35` | **ABSENT** |
| `storage` (5) | `storage` | **ABSENT** | **ABSENT** | **ABSENT** |
| `tenantBackup` (7) | `tenant-backups` | **ABSENT** | **ABSENT** | **ABSENT** |
| *(bonus)* `meteredBilling` (8) | `metered-billing` | **PRESENT** `:145` | **PRESENT** `:367-374` | **PRESENT** — `HEALTCARE_ADMIN: read` `:256` |

Verified by running the constant, not by reading it:

```
$ node -e "const c=require('./constants/roleConstants.js');const v=Object.values(c.MENU_SLUGS);
  for(const s of ['api-keys','webhooks','storage','tenant-backups','metered-billing'])
  console.log(s, v.includes(s));"
api-keys        false
webhooks        false
storage         false
tenant-backups  false
metered-billing true
```

**This is the strongest single caveat on my plan and I am putting it in the middle of my own paper
rather than a footnote.** Converting these four routers today, without the slug and seed work, would
convert a lockout that at least has a name into a silent one. That is A-07 exactly, and A-07 is
filed as *"unverified — possibly high"* precisely because nobody knows how many routes it already
hits.

It also means **`metered-billing` is the one router that can be converted today**, because its slug
exists in the constant, in the seed, and in the role assignment. See §3.

### A-07 is not hypothetical — here is it live

Tabulating every `dynamicAccess` resource name in the tree against what `getRolePermissionsMatrix`
actually keys the matrix by (menu **name** *and* **slug**, plus one level of child inheritance —
`services/roles.service.js:313-349`):

| Name passed to `dynamicAccess` | Uses | Matches a seeded menu? |
|---|---|---|
| `"warehouse"` | 24 | yes (slug) |
| `"calibration"` | 14 | yes (slug) — but absent from `MENU_SLUGS` |
| `"certificate"` | 12 | yes (slug) — but absent from `MENU_SLUGS` |
| `"content"` | 10 | yes |
| `"Management"` | 10 | yes (name) |
| `"users"` | 8 | yes (slug) — absent from `MENU_SLUGS` |
| `"Maintenance"` | 7 | yes (name) — absent from `MENU_SLUGS` |
| `"Vendors"` | 6 | yes (name) — absent from `MENU_SLUGS` |
| `"Finance"` | 6 | **NO** — the menu is name `"Asset Finance"`, slug `finance` (`seedMenuGroups.util.js:359-366`) |
| `"workflow"` | 5 | **NO** — the menu is name `"Approval Workflows"`, slug `workflows` (`:275-282`) |
| `"Billing"` | 3 | yes (name, `:351-358`) |
| `"AuditLogs"` | 1 | **NO** — the menu is name `"Audit Logs"`, slug `audit` (`:333-340`) |

Two of the three misses are rescued by an OR: `finance.route.js:41` passes
`["Finance", "Billing"]` and `audit.route.js:61` passes `["AuditLogs", "Audit Logs", "audit"]`, and
`dynamicAccess` defaults to OR semantics (`dynamicAccess.middleware.js:158-160`). One is not:

```js
// routes/api/workflows.route.js:149, 215, 252, 316, 354
dynamicAccess("workflow", "read")   // singular. No OR. Matches no name and no slug.
```

**Five approval-workflow routes are SUPERADMIN-only, silently, by string mismatch** — despite
`ROLE_MENU_ASSIGNMENTS` granting `HEALTCARE_ADMIN` `workflows: write` at `roleConstants.js:254`.
That grant creates `matrix["workflows"]` and `matrix["Approval Workflows"]`. The gate asks for
`matrix["workflow"]`. Nothing there, `403`.

*(Read from source, not probed against a running server — see §5.)*

I am citing this **against myself as much as for myself**: it is the failure mode of my own
proposal, demonstrated in the system I am proposing to move everything into. It is also the reason
the plan below leads with a mechanical check rather than with route edits.

### The plan, in dependency order

**Step 0 — the guard, before any route changes.** A unit test that walks every `dynamicAccess(…)`
call site and asserts each resource name is (a) a value in `MENU_SLUGS` and (b) a `slug` in
`seedMenuGroups.util.js`'s `menuData`. It fails today on `"workflow"`, `"Finance"`,
`"AuditLogs"`, `"Management"`, `"Maintenance"`, `"Vendors"`, `"users"`, `"calibration"`,
`"certificate"` — which is the point. It is A-07's Definition of Done, it is the mechanical version
of `CLAUDE.md`'s "name the test", and nothing else in this plan may land before it is green. Phase 9
task P9-19 (typing the argument as a slug union) makes it a compile error later; this makes it a
test failure now.

**Step 1 — `MENU_SLUGS` gains four entries** in `constants/roleConstants.js:121-155`:

```js
API_KEYS: "api-keys",          // menu row already seeded: util:394-402
WEBHOOKS: "webhooks",          // menu row already seeded: util:403-410
STORAGE: "storage",            // NEW menu row required
TENANT_BACKUPS: "tenant-backups", // NEW menu row required
```

**Step 2 — two new menu rows** in `seedMenuGroups.util.js`'s `menuData`, with fixed ids added to
`getMenuGroupId` (`:10-71`) so re-seeds are idempotent:

- `storage` → *"Object Storage"*, `parentSlug: "mgmt-developer"` (it sits with API keys and
  webhooks: tenant infrastructure configuration), id `a0000000-0000-0000-0000-000000000233`.
- `tenant-backups` → *"Backups & Restore"*, `parentSlug: "mgmt-organization"` (it is tenant
  lifecycle, not developer tooling), id `a0000000-0000-0000-0000-000000000234`.

Both ids are unused today (the block ends at `…0232`, `:61`). The fallback branch at `:75` generates
a timestamp-derived id, which is not stable across runs — so the fixed entries are not optional.

**Step 3 — `ROLE_MENU_ASSIGNMENTS` gains the rows.** This is the question the brief asks: *what must
the role→menu assignments say for a `HEALTHCARE ADMIN` to manage webhooks?* Answer, precisely:

```js
// constants/roleConstants.js, inside the ROLE_NAMES.HEALTCARE_ADMIN entry (:229-265)
[MENU_SLUGS.API_KEYS]:       PERMISSION_TYPES.WRITE,
[MENU_SLUGS.WEBHOOKS]:       PERMISSION_TYPES.WRITE,
[MENU_SLUGS.STORAGE]:        PERMISSION_TYPES.WRITE,
[MENU_SLUGS.TENANT_BACKUPS]: PERMISSION_TYPES.WRITE,
```

`WRITE`, not `READ`, and the distinction is load-bearing: `normalizePermission`
(`dynamicAccess.middleware.js:220-222`) maps *every* non-`read` verb to `write`, so a `POST
/webhooks` gated `"write"` needs a literal `write` row. A `read` row satisfies a `read` gate only;
`write` implies `read` (`:288-291`) but never the reverse.

Then the same four for `ROLE_NAMES.CALIBRATOR_ADMIN` (`:266-293`) — **or deliberately not**, and
that is the first thing the matrix buys us that the ladder could not express. Under
`rbac([TENANT_ADMIN])` both admin roles are level 8 and the question cannot be asked. Under the
matrix it is four booleans, and if the answer is "a calibration house does not get the hospital's
backup restore", the matrix can say so. `SUPER_ADMIN`'s entry (`:191-228`) gets them too for
completeness, though it bypasses at `dynamicAccess.middleware.js:52` regardless.

**Step 4 — reconcile the second seeder, or the answer depends on which one ran.** There are two
paths that write `role_menu_permissions` and they disagree today:

| | `services/migration.service.js#seedMenuGroupsAndItems` `:497-563` | `utils/seedMenuGroups.util.js#seedRoleMenuPermissions` `:680-868` |
|---|---|---|
| Source of truth | `ROLE_MENU_ASSIGNMENTS` | a second hardcoded list, `:683-828` |
| Permission written | per-menu, from the constant `:545-550` | **`"read"`, always** `:861` |
| Roles covered | 11 | 4 |
| Reached by | `migration.controller.js:29` → `migrationService.seedAll()` `:812-817` | the util's own `seedAll`, *"kept here for fallback and test compliance"* `:678` |

The live path is `migration.service`. But the util's list already contains `"api-keys"` and
`"webhooks"` for `SUPERADMIN` (`:709-710`) and not for `HEALTHCARE ADMIN` (`:740-781`) — so the two
lists encode different products. Either the util's `seedRoleMenuPermissions` is deleted and the
constant becomes the single source, or it is regenerated from `ROLE_MENU_ASSIGNMENTS`. Leaving both
is how the next `dynamicAccess` conversion produces a route that works on one engineer's database
and 403s on another's.

**Step 5 — one more thing that must be in the change, not discovered after it.**
`migration.service.js:540-550` creates a `RoleMenuPermission` row *only if none exists*, and never
upgrades an existing `read` to `write`. New slugs create new rows, so these four land on an existing
database. Any later change to a permission **type** will not. That is a separate defect; naming it
here so the migration is not written on a false assumption.

**Step 6 — the routes.** Only now:

```js
// routes/api/webhooks.route.js:15
const webhookAdmin = [auth, denyApiKey, dynamicAccess(MENU_SLUGS.WEBHOOKS, "write")];
// routes/api/apiKeys.route.js:17
const adminOnly    = [auth, denyApiKey, dynamicAccess(MENU_SLUGS.API_KEYS, "write")];
// routes/api/storage.route.js:13
const storageAdmin = [auth, denyApiKey, dynamicAccess(MENU_SLUGS.STORAGE, "write")];
```

`denyApiKey` stays on all three. It is orthogonal — a principal-type filter, not a permission — and
it is the thing that stopped A-27's privilege-escalation chain. The read routes (`GET /webhooks`,
`GET /storage/settings`, `GET /storage/usage`) can take `"read"` instead of `"write"`, which is a
finer distinction than `rbac` could draw at all, and the reason to make the conversion rather than
merely fix it.

`tenantBackup` is the one I would leave for last and possibly not do — see §4.

**Step 7 — a test that is evidence.** `CLAUDE.md`: *"An assertion that a test passed is not evidence.
Name the test."* Named, in advance:

- `src/tests/routes/webhooks.authz.test.js` — *"a HEALTHCARE ADMIN with `webhooks:write` receives
  201 from `POST /webhooks`"* and *"a ROOM USER receives 403"*. As a **request**, through the real
  chain, as a non-super-admin principal. Not a middleware-position assertion; the metered-billing
  test is the counter-example (`meteredBilling.route.test.js:47-59`).
- `src/tests/middlewares/dynamicAccess.slugs.test.js` — Step 0's guard.
- and the two-tenant 404 case `CLAUDE.md` calls mandatory for every `:id` route, on
  `GET /webhooks/:id` — which needs `createTwoTenants()`, which `CLAUDE.md` records as not existing
  in any code file as of A-55. That fixture is a prerequisite of this work, not a nicety.

### The implication that argues against me, stated before anyone finds it

`MENU_SLUGS` is not only the `dynamicAccess` vocabulary. It is also the allow-list for API-key scope
issuance:

```js
// services/apiKey.service.js:39
const ALLOWED_RESOURCES = new Set(Object.values(MENU_SLUGS).map((s) => String(s).toLowerCase()));
// :50
if (!ALLOWED_RESOURCES.has(resource)) { throw new AppError(400, `Unknown scope resource: …`); }
```

Adding `api-keys`, `webhooks`, `storage` and `tenant-backups` to `MENU_SLUGS` therefore **widens what
an API key may be scoped to** — a key could be minted with `webhooks:write`. This is the exact
consequence A-07's addendum (`AUDIT-2026-09-REMEDIATION.md:689-695`) warns about for `calibration`
and `certificate`, and it must be a deliberate decision in the ADR, not a side effect.

The containment is real but partial: all three routers keep `denyApiKey`
(`apiKeys.route.js:17`, `webhooks.route.js:15`, `storage.route.js:13`), so a key holding the scope
cannot use it *there*. But `scopeAllows` (`apiKey.service.js:145-160`) is consulted by
`dynamicAccess` for every API-key principal (`dynamicAccess.middleware.js:147`), so the scope becomes
meaningful anywhere else those names are ever used. The honest answer is: **split the vocabularies**
— `MENU_SLUGS` for gating, an explicit `API_KEY_SCOPES` subset for issuance — and that is a real
piece of extra work this plan owes.

---

## §3 — The strongest case against me

I will put it the way I would put it if I were arguing the other side, because a position paper that
softens the opposition is not worth refereeing.

> **"There is a hospital that cannot issue an API key today.** Position B's answer is a four-part
> schema and seed migration, a new mechanical test that currently fails on nine existing call sites,
> a decision about API-key scope vocabulary, a reconciliation of two divergent seeders, and a missing
> test fixture (`createTwoTenants()`) that `CLAUDE.md` has been asking for since A-55 and that nobody
> has written. Each of those is defensible. Together they are weeks, and every day of them the
> hospital is still locked out.
>
> Meanwhile `role_level` is a column that already exists on a table that already exists. Loading it
> is `attributes: ["id","name","description","roleLevel"]`. Backfilling it is one `UPDATE … CASE`.
> That is a day, including the test.
>
> **And some of these gates genuinely mean 'at least this privileged'.** `POST
> /tenants/:tenantId/backups/:id/restore` overwrites the tenant's data. That is not 'may touch the
> backups menu', it is 'is senior enough to destroy the tenant'. Forcing it into a read/write
> boolean on a menu row *loses information*. The menu matrix has two levels by explicit design
> (`docs/SECURITY/04-AUTHORIZATION-RBAC.md:38-42`) — and `write` on `tenant-backups` would mean
> both 'take a backup' and 'restore over production', which is worse than what exists.
>
> **Finally: this is how a one-day fix becomes a one-month one.** The remediation board carries
> A-41 (audit rows outside the transaction, **high**), A-37 (a cross-tenant existence oracle in
> SCIM, **high**), A-42 (audit failures to `console.error` in a process that writes no stdout,
> **high**) and AZ-04 (both gates answering 403 where the rule says 404, **high** — the tenant
> oracle the whole 404 rule exists to prevent). Spending a month unifying authorization while those
> sit is a prioritization error dressed up as an architecture argument."

### My answer

**On the timeline, I concede completely and I do not shade it.** My plan cannot ship today. A's can.
A hospital locked out of its own tenant is an operational incident, and an architecture paper is not
a remediation. §0 does not change that: it only changes what "A's fix" has to contain.

So here is what I would actually do, which is not "my plan instead of A's":

#### Ship today — Position A's fix, completed, plus the one free conversion

1. **`roleLevel` into the four projections** — `auth.service.js:174`, `:410`, `:451`, `:626`.
2. **`roleLevel` into both seed arrays** — `migration.service.js:78-115` and `:120-185`, sourced
   from `ROLE_LEVELS` rather than retyped, so the constant and the column stop being two facts.
3. **A backfill migration** — `0020-backfill-role-levels.js`, writing `role_level` for the eleven
   seeded roles. **No blanket `try/catch`** (`CLAUDE.md`'s named migration trap), and verified in
   `psql`, because `make migrate`'s log is not evidence.
4. **A decision, recorded, about what a tenant-created or SCIM-created role gets** — this closes
   A-39, which is the same bug, and refusing to decide is how it silently returns.
5. **One named test that is evidence** — `src/tests/routes/webhooks.authz.test.js`, a `HEALTHCARE
   ADMIN` principal, `POST /api/v1/webhooks`, asserting **201**. Not middleware position. Not as
   super-admin. That single test is what nobody had, and it is why this shipped.
6. **Delete `"BILLING_ADMIN"`** from `meteredBilling.route.js:33` and convert that router to
   `dynamicAccess(MENU_SLUGS.METERED_BILLING, "read" | "write")` — **today**, because it is the one
   router whose slug already exists in `MENU_SLUGS` (`:145`), in the seed (`util:367-374`) and in
   `ROLE_MENU_ASSIGNMENTS` (`:256`). Eight routes, no schema change, no new slug, no A-07 risk.
   **And in the same commit, close the grant gap A found** (A §3, A §5.5): `HEALTHCARE ADMIN` is
   `metered-billing: READ` at `roleConstants.js:256` and `CALIBRATOR ADMIN` has no row at all
   (`:267-293`). Converting without fixing those trades one silent lockout for another, which is
   A's point and A is right. Two lines, in the table the conversion is already editing.
7. **A's §4.1 integration test and §4.2 boot assertion — both of them, verbatim.** A's test
   (`principal.shape.test.js`, real loader, `rbac` unmocked) is the artifact that would have caught
   this, and A's forensics on why four test layers missed it — `rbac.test.js` hand-building an
   impossible principal, `routeGuards.a02.test.js:21-27` mocking `rbac` to `next()`, the E2E suites
   logging in as the super-admin who short-circuits — are the best pages in either paper. The boot
   assertion modelled on `config/index.js:23-64` and `jwt.util.js:11-28` is right whether the ladder
   lives or dies, because during the migration it is what keeps administrators working. **I adopt
   all of it.**

That is a day, maybe two. The hospital is unblocked. Eight of the 31 routes are already off the
ladder.

#### Ship over the following weeks, task-sized, each independently shippable

8. **The A-07 guard test** (Step 0). Independently valuable — it finds `"workflow"`'s five dead
   routes whether or not anything else in this paper happens.
9. **`workflow` → `workflows`**, with a named test. One character; five routes recovered.
10. **`api-keys` and `webhooks`** — Steps 1, 3, 4, 6, 7. The menu rows already exist
   (`util:394-410`), so these two are the cheap half: a constant entry, an assignment row, a route
   line, a test.
11. **`storage`** — as above, plus a new menu row.
12. **The 37 `rbac(["SUPERADMIN"])` → `superAdminOnly`** — mechanical, no behaviour change
    (`rbac.middleware.js:46-48` and `auth.middleware.js:238` implement the same check), reviewable
    in one sitting. This is where most of the "68 routes" objection evaporates.
13. **Then, and only then, delete `rbac` and `checkRoleLevel`** and remove `TENANT_ADMIN` from
    `ROLE_NAMES` (`:45`) and `ROLE_LEVELS` (`:100`), so no future route can reach for a tier that
    is not a role.

Every step is a PR. None blocks the hospital. **Step 6 in the "today" list is deliberately placed
before all of them**, because if the conversion turns out to be harder than I claim, metered-billing
is where that shows up cheaply and the rest of the plan gets re-argued on evidence.

#### On "some of these genuinely express a privilege floor"

This is the strongest part of A's case and it earns a real concession, in §4 and §5. Short version:
**`tenantBackup` restore is the one place the objection lands**, and my plan's answer is not
"convert it anyway". It is: convert the six read/create routes to
`dynamicAccess("tenant-backups", …)` and leave restore gated on something that means what it says.
Not `rbac([TENANT_ADMIN])` — which today means SUPERADMIN-only and says otherwise — but an explicit,
named, single-purpose guard, the way `superAdminOnly` is explicit. A destructive operation deserves
a gate a reviewer can read in one line. It does not deserve a general-purpose ladder maintained for
its sake.

### Answering A's five rebuttals, by number

**A's §1, "what enumerating names costs" — I agree with every word, and it refutes a position
nobody holds.** A's case against `rbac([HEALTCARE_ADMIN, CALIBRATOR_ADMIN])` at eleven call sites is
correct: eighteen edits, silent breakage on the eleventh you miss, and — the good argument —
**runtime-created custom roles can never pass**, because passing requires a literal string in a file
that shipped before the role existed (`services/roles.service.js:18-26`).

That is an argument for the tier over *enumeration*. It is not an argument for the tier over *the
matrix*, and the matrix is what I propose. Run A's own custom-role scenario through both:

> A hospital creates **"Biomed Supervisor"** through `POST /roles` and wants it to manage webhooks
> and storage, but **not** restore backups and **not** touch billing.

| | under the tier | under the matrix |
|---|---|---|
| How it is granted | set `role_level = 8` — via A's proposed `createRoleSchema` addition, capped at 8 | tick two boxes: `role_menu_permissions` rows for `webhooks` and `storage` |
| What else it grants | **everything gated at ≤ 8**: API keys (4 routes), storage (5), webhooks (7), tenant backups including **restore** (7), metered billing (8) | nothing else |
| Can the hospital withhold backup restore? | **No.** Level 8 is one integer. There is no level that is "8 for storage, 4 for backups" | Yes — omit the row |
| Deploy required | none for the level, but the surfaces it unlocks are fixed at compile time | none |

A is right that the tier lets a runtime role *hold admin privilege*. It holds **all** of it, as one
indivisible grant, because that is what a scalar is. The matrix was built for exactly this case —
`user_menu_permissions` and `role_menu_permissions` exist, are cached, are configurable through
shipped product surfaces (`/roles/*`, `/menu-groups/*`, `/user-permissions/*`), and require no
deploy. A's strongest argument is an argument for *data-driven* authorization over
*source-literal* authorization. On that we agree completely. The matrix is the data-driven one that
already has a schema.

**A's §2, "four of five have no slug, so migrating means four new slugs and four new `menu_groups`
rows, plus grants in each of eleven `ROLE_MENU_ASSIGNMENTS` entries."** Two corrections, both
checkable:

- **It is two new rows, not four.** `api-keys` and `webhooks` are *already seeded menu groups* —
  `utils/seedMenuGroups.util.js:394-402` and `:403-410`, children of `mgmt-developer`, with fixed
  ids at `:34` and `:35`, and already granted to `SUPERADMIN` at `:709-710`. Only `storage` and
  `tenant-backups` need new rows. My §2 Step 2 adds exactly two.
- **Grants go in the roles that should have the permission, not all eleven.** `ROLE_MENU_ASSIGNMENTS`
  is not a dense matrix — `KANBAN` appears in four of the eleven blocks and `TICKETS_RESPONSE` in
  six. A `WAREHOUSE STAFF` block does not need a `webhooks` row; its absence *is* the denial
  (`dynamicAccess.middleware.js:263`, `matrix[menuName] || []`). Realistically: three blocks, two
  new menu rows, one constant, one route line per router.

A is nonetheless right that this is more work than a backfill. §3's sequencing concedes that and is
built around it.

**A's §3 — the metered-billing demonstration — is A's best hit, and it lands.** A migrates
`meteredBilling.route.js:33` to `dynamicAccess("metered-billing", "write")` and shows
`HEALTHCARE ADMIN` holds only `READ` (`roleConstants.js:256`) and `CALIBRATOR ADMIN` holds nothing
(`:267-293`). Both get 403. A concludes: *"the opposition's remedy, applied to the only route where
it is available, reproduces the bug."*

I concede the instance and dispute the inference, on one property: **visibility.**

| | the ladder's failure | the matrix's failure |
|---|---|---|
| Where the missing fact lives | nowhere — `role_level` is unset in a database, `TENANT_ADMIN` is a tier in a constants file, and neither is a row anyone reads | a missing line in `ROLE_MENU_ASSIGNMENTS`, in a table a reviewer reads top to bottom |
| Files to consult to diagnose | six (§1: route, `roleConstants`, `rbac.middleware`, `auth.service`, `role.model`, `migration.service`) | one |
| Fix | schema + migration + validator + service, then all-or-nothing | one line, per role, per surface |
| Configurable by the customer | no | yes, through a shipped surface |
| Detectable mechanically | only by A's §4.2 boot assertion, which must be written | by my §2 Step 0 guard **plus** a grant-coverage test, both of which are ordinary unit tests |

A's own §5.5 concedes the remedy — *"provided the grant gap I found at `:267-293` is closed in the
same change."* That is my §2 Step 3, and it is one line. A has demonstrated that **authorization
data must be written and verified**, which is true of both mechanisms and is the thing my §2 Step 0
exists to enforce. It does not distinguish them. What distinguishes them is that one mechanism's
data is a row in a product's configuration table and the other's is an integer nobody has ever set.

**A's §4, "dormant is safe is the most dangerous sentence in this debate."** I did not say it and I
agree with A. The SUPERADMIN route-around is real — both gates bypass unconditionally
(`rbac.middleware.js:46-48`, `dynamicAccess.middleware.js:52-60`) and that account is PR-3's
highest-value credential. This is an argument for **shipping today**, which is §3's entire structure,
and it is an argument against *my* plan being the whole answer. It is not an argument for keeping
the ladder afterwards.

**A's §5, "the ladder is already load-bearing."** Measured against the tree: `rbac` is imported by
ten routers, gating 68 routes. **37 of those never reach the level branch** — they match
`"SUPERADMIN"` by name at `:46-48`. Of the 31 that do reach it, **all 31 deny**. So the ladder is
load-bearing in the sense that deleting it changes behaviour, and it is not load-bearing in the
sense of any caller currently being admitted by a level comparison. There is no working level gate
in production to regress. That is a materially different starting position from "a live mechanism we
would be ripping out", and it is why §3's step 11 — the 37 `SUPERADMIN` renames — is mechanical
rather than risky.

*(Counting note, so the referee does not think we contradict each other: A counts eleven `rbac(…)`
**call sites** across five routers; I count 31 **routes**, because four of the five share one guard
array reused across their routes — `webhooks.route.js:15` is one call site and seven routes. Both
numbers are right.)*

#### On prioritization

A is right that A-41, A-42, A-37 and AZ-04 outrank this, and I will not pretend otherwise. That is
an argument for my sequencing — a one-day fix now, conversions as separate small tasks that queue
behind the high-severity board — and an argument *against* doing the unification as one project.
It is not an argument that the second authorization system should be kept. AZ-04 is itself evidence
for my side: it is one finding that had to be written against *two* middlewares
(`dynamicAccess.middleware.js:105`, `:130` and `abac.middleware.js:82`) because the same rule is
implemented in more than one place. Every defect in this subsystem costs as many fixes as there are
systems.

---

## §4 — What a level ladder is legitimately good for

Not nothing. Three honest cases, and only one of them is in the 68.

**1. An ordered scale over a single resource, where the order is the semantics.** `kanban` does this
correctly:

```js
// services/kanban.service.js:130-139
const assertAccess = async (user, projectId, minLevel = "viewer") => {
  const { project, level } = await resolveAccess(user, projectId);
  if (!level || LEVELS[level] < LEVELS[minLevel]) { … }
```

Viewer < member < … < owner, **per project**, resolved from project membership — not from a global
role. 28 call sites (`AUDIT-2026-09-AUTHZ-MATRIX.md`, "Gated Below The Route"). This is a genuinely
ordered relation where "higher implies everything lower" is *true*, and it is scoped to the resource
that gives it meaning. That is what an ordered scale is for. It is also not `rbac`, does not use
`ROLE_LEVELS`, and is unaffected by anything in this paper.

**2. Approval chains, where seniority is the product requirement.** "A calibration certificate needs
a manager's approval above the technician who produced it" is inherently ordinal. But the
implementation already does not use the ladder:
`migration.service.js:1484-1485` defines workflow steps as
`{ stepOrder: 1, roleId: ROLE_IDS.CALIBRATOR_ADMIN }, { stepOrder: 2, roleId: ROLE_IDS.ENGINEERING_MANAGER }` —
**explicit role ids in an explicit order**, which is strictly better, because it survives someone
deciding that a supervisor may approve what an engineering manager may not.

**3. A tie-breaker for destructive operations**, as in §3 — restore, purge, tenant deletion. Genuine,
and it is a handful of routes, and it wants an explicit named guard rather than a general mechanism.

**Do any of the 68 truly need the ladder?** By my reading: **no.**

- The 37 `rbac(["SUPERADMIN"])` routes never touch it (`:46-48`).
- `apiKeys`, `webhooks`, `storage` and `meteredBilling` — 24 routes — are *surfaces*. "May this role
  configure outbound webhooks" is a menu question. The doc says as much at
  `04-AUTHORIZATION-RBAC.md:66`, and the hospital's biomed-vs-finance split makes it a product
  question that the ladder answers wrong by construction.
- `tenantBackup` — 7 routes — is mixed: list/get/create are a surface; **restore** is the one route
  in all 389 where "senior enough" is the actual rule, and it deserves its own named guard rather
  than a shared ladder.

**One route out of 68.** That is not a reason to maintain a parallel authorization system, a
constants-file ladder, a `role_level` column, a `ROLE_LEVELS` map, a `checkRoleLevel` export with
zero call sites, and the six-file reasoning chain from §1 that every reviewer pays for on every
review.

---

## §5 — What I concede

1. **Position A's fix is the right thing to ship today, and my plan is not.** A hospital cannot wait
   for an architecture migration. I would ship A's change first, in the same week, and I have
   written its steps out in §3 rather than gesturing at them.

2. **A's change is necessary independently of mine**, and I would keep it even after the four
   conversions land — because `rbac` cannot be deleted the day the last route moves off it, and a
   gate that silently evaluates `0` for every principal in the interim is worse than one that works.

3. **Not one of the four slugs I propose exists in both `MENU_SLUGS` and the seed today.** Two
   (`api-keys`, `webhooks`) are seeded menu rows missing from the constant; two (`storage`,
   `tenant-backups`) exist in neither. Converting the routers before Steps 1–4 would reproduce A-07
   exactly — a silent deny instead of a named one, which is strictly worse. This is the single
   biggest risk in my proposal and it is mine to carry.

4. **`dynamicAccess` is not clean either.** It answers **403** for a cross-tenant id at
   `dynamicAccess.middleware.js:105` and `:130` where `CLAUDE.md` requires 404 — AZ-04, **high**,
   open. Its `catch` returns `500` with `error.message` (`:203-206`), which is A-13's shape. It
   swallows per-user override lookup failures and falls back to role permissions (`:276-282`) —
   defensible, and it means a `none` revocation fails **open** if the override service is down.
   I am arguing it is the *better* of the two systems and the one with a data model. I am not
   arguing it is correct.

5. **`tenant-backups` restore is a real counter-example** to "everything is a surface", and my plan
   gives it a named guard rather than a menu row. If the referee thinks one such route justifies
   keeping the mechanism, that is a coherent position and I would ask only that the mechanism then
   be *one* route's guard, explicitly, rather than a general ladder with 67 other users.

6. **Widening `MENU_SLUGS` widens API-key scope issuance** (`apiKey.service.js:39`, `:50`) as a side
   effect. My plan owes a split vocabulary, and that is extra work I did not have in my first
   estimate.

7. **Nothing in this paper was tested against a running server.** Every claim is read from source,
   which is the same limitation `AUDIT-2026-09-AUTHZ-MATRIX.md` states about itself. In particular
   the claims that `workflows`' five routes and the four `TENANT_ADMIN` routers deny a
   `HEALTHCARE ADMIN` are **derived** — from `auth.service.js:451`, `role.model.js:38`,
   `migration.service.js:78-185` and `roles.service.js:313-349` — not observed. The first thing the
   winning position should do, whichever it is, is log in as `HEALTHCARE ADMIN` and `POST
   /api/v1/webhooks`. If that returns 201, this entire debate rests on a misreading and both papers
   should be withdrawn.

8. **`dynamicAccess` is more expensive per request than `rbac`, and A is right about the numbers.**
   `rbac` is an integer comparison on a row already fetched — zero I/O. `dynamicAccess` costs a
   Redis `get` (`roles.service.js:290-292`), a `RoleMenuPermission.findAll` with a two-level nested
   include on a miss (`:294-311`), **and** an un-cached per-user override lookup on every request
   (`dynamicAccess.middleware.js:266-282`). I weigh it lower because the price is already paid on
   136 routes and these 31 are low-traffic administrative surfaces, not hot paths — but that is a
   judgement about traffic, not a refutation, and if someone measures it and I am wrong about the
   traffic, A's point stands.

9. **A's metered-billing demonstration (A §3) is a real hit on my proposal and I have changed my
   plan because of it.** My "ship today" step 6 originally said "convert `metered-billing`"; it now
   says "convert it *and close the grant gap at `roleConstants.js:256` and `:267-293` in the same
   commit", because A showed that converting alone reproduces the lockout. A is also right about
   the general principle it illustrates: **the matrix fails exactly as silently as the ladder when
   nobody writes the row.** My answer is that the row is visible and the integer was not, and that
   my §2 Step 0 guard plus a grant-coverage test make it mechanical — but "my mechanism also needs a
   test to be safe" is a weaker claim than "my mechanism is safe", and the referee should score it
   as such.

10. **A's §1 argument about runtime-created custom roles is the best argument in either paper for
    keeping *some* mechanism that is not a source literal.** I answer it in §3 by pointing at the
    matrix rather than at enumeration, and I believe that answer holds — but A identified a real
    structural property (`services/roles.service.js:18-26` mints roles whose names no shipped file
    contains) that I had not thought about before reading A's paper, and it deserves to be recorded
    as A's finding.

11. **A's §4 test forensics are better than mine and I adopt them wholesale.** A traced the seam
    precisely — `rbac.test.js` asserting against a principal that Sequelize cannot produce,
    `routeGuards.a02.test.js:21-27` mocking `rbac` to `next()` and saying so in its own header,
    `meteredBilling.route.test.js:97` carrying a green assertion named *"allows a TENANT_ADMIN
    through"* for a principal impossible three times over. A's §4.1 integration test and §4.2 boot
    assertion are in my "ship today" list at item 7 because they are correct under either outcome.

12. **Retiring `rbac` requires an ADR under `CLAUDE.md`'s deviation protocol**, because it contradicts
   `docs/SECURITY/04-AUTHORIZATION-RBAC.md:9-15`, which documents three gates as the design. The
   next number is **ADR-042** (`MEMORY/DECISIONS.md` ends at ADR-041, `:1158`). If this position
   wins, that ADR — decision, rationale, alternatives *including A's*, and the bad implications
   above — is the first deliverable, and amending `04-AUTHORIZATION-RBAC.md` to stop describing
   `rbac` as gating on "numeric `roleLevel`" (`:12`) is part of it. That line is PR-4's shape: a
   document stating a design as fact where the code has never implemented it.

---

## The claim, in one paragraph

Both papers agree the mechanism is broken at both ends: the level is never selected
(`auth.service.js:451`) and never seeded (`migration.service.js:78-185`), so the complete fix is
A's own six-part change, not one attribute. Having established that — and having A concede that the
level path "has been decorative for its entire life" — the question on the table is whether to spend
that change making a never-executed ladder load-bearing on the five highest-consequence surfaces in
the product. It should not. `dynamicAccess` gates 136 routes against a real data model with per-user
overrides and is the only gate `CLAUDE.md` shows; `rbac` gates 68 against a constants-file ladder, of
which 37 never use the ladder and all 31 that do currently deny the tenant. The ladder cannot express
"administers storage but not billing" — the split a hospital with a biomedical lead and a finance
lead will ask for within a quarter — and the one engineer who tried wrote `"BILLING_ADMIN"` into
`meteredBilling.route.js:33`, a role that has never existed, and shipped it with tests that assert
the guard's position in the middleware stack. Ship A's fix today, completed properly and proven by a
`HEALTHCARE ADMIN` request test that returns 201. Convert `metered-billing` today too — with its grant gap
closed in the same commit, which is A's correction and A is right — because its slug already exists
everywhere it needs to. Then retire the ladder one router at a time, behind a
mechanical check that no `dynamicAccess` name may be absent from the seed — because the only thing
worse than a lockout with a name is the same lockout without one.
