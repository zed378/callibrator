# DEBATE — `rbac([TENANT_ADMIN])` locks out tenant administrators

## Position A: fix the data, not the gates

**Date:** 2026-09-23 · Paths are relative to the repo root; backend sources live under `backend/src/`.

---

## 0. The claim, and the part nobody has stated yet

The gates are right. The middleware is right. The loaders are right about everything except one integer.

`rbac` decides by level:

```js
// backend/src/middlewares/rbac.middleware.js:38-39
const userRoleLevel =
  req.user.role?.role_level || req.user.role?.roleLevel || 0;
```

Nothing ever puts a level there. Every loader that builds the principal projects the role down to a name:

| loader | line | projection |
|---|---|---|
| `loginUser` | `backend/src/services/auth.service.js:174` | `["id", "name"]` |
| `verifyUserSession` | `backend/src/services/auth.service.js:410` | `["id", "name"]` |
| **`getAuthUserWithTenant`** | `backend/src/services/auth.service.js:451` | `["id", "name", "description"]` |
| `loginMfa` | `backend/src/services/auth.service.js:626` | `["id", "name"]` |

`getAuthUserWithTenant` is the one that matters: `backend/src/middlewares/auth.middleware.js:92` calls it and `:114` assigns its result to `req.user` on **every** authenticated request (again at `:189`/`:196` for `optionalAuth`). So `req.user.role` is `{ id, name, description }`, `userRoleLevel` is `0`, and the level branch at `backend/src/middlewares/rbac.middleware.js:64-68` can only ever be reached by a caller whose level is `0`.

`rbac` grants on **name first**:

```js
// backend/src/middlewares/rbac.middleware.js:64-68
if (!requiredRoles.includes(userRoleName)) {
  if (!allowHigher || userRoleLevel < minRequiredLevel) {
    throw new Error("Forbidden: Insufficient permissions");
  }
}
```

So every gate that lists a **real seeded role name** still works — the name check carries it. Every gate that lists the **logical tier** `ROLE_NAMES.TENANT_ADMIN` (`backend/src/constants/roleConstants.js:45`, level 8 at `:100`) matches no name, falls to the level bar, and compares `0 < 8`. It denies everyone except the SUPERADMIN, who short-circuits earlier at `backend/src/middlewares/rbac.middleware.js:47-49`.

**Five routers, not four.** The prompt names four; there is a fifth:

| router | line | gate |
|---|---|---|
| `backend/src/routes/api/apiKeys.route.js` | `:17` | `rbac([ROLE_NAMES.TENANT_ADMIN])` |
| `backend/src/routes/api/webhooks.route.js` | `:15` | `rbac([ROLE_NAMES.TENANT_ADMIN])` |
| `backend/src/routes/api/storage.route.js` | `:13` | `rbac([ROLE_NAMES.TENANT_ADMIN])` |
| `backend/src/routes/api/tenantBackup.route.js` | `:144, :259, :297, :396, :489, :608, :695` | `rbac([SUPER_ADMIN, TENANT_ADMIN])` |
| **`backend/src/routes/api/meteredBilling.route.js`** | **`:33`** | **`rbac(["TENANT_ADMIN", "BILLING_ADMIN"])`** |

`meteredBilling` is worse than the other four: `"BILLING_ADMIN"` is not in `ROLE_NAMES` at all, so it is dropped by the `filter` at `backend/src/middlewares/rbac.middleware.js:57`, and the bar collapses to `min(8) = 8` — the whole metered-billing surface is SUPERADMIN-only, and has been since it was written.

### The half of the defect nobody has found

Fixing the projection alone **does not fix it**. The seed never writes the level either.

`backend/src/models/role.model.js:36-39` defines `roleLevel: { type: INTEGER, defaultValue: 1 }`, and the model is `underscored: true` (`:50`), so the column `role_level` exists. But `DEFAULT_ROLES` (`backend/src/services/migration.service.js:78-113`) and `APPLICATION_ROLES` (`:121`) set `id`, `name`, `description`, `nameToShow`, `isSystem`, `status`, `sortOrder` — **and no `roleLevel`**. Every seeded role in every deployed database carries `role_level = 1`.

So today a HEALTHCARE ADMIN would fail the bar twice over: the level is not selected, and if it were, it would be `1`.

And `backend/src/services/roles.service.js:18-26` — `createRole` — writes `name`, `description`, `is_system`, `status`. `createRoleSchema` (`backend/src/validators/roles.validator.js:3-6`) does not accept a level. **Every customer-created custom role is born at level 1 and absent from `ROLE_LEVELS`.** That is the CLAUDE.md trap — *"a new role without a `ROLE_LEVELS` entry fails every privileged gate, silently"* — already latent in the role-creation API, waiting for the first customer who asks for "Biomed Supervisor".

This is the same defect from both ends. One end is a role with no level. The other end is a level that never reaches the principal. **Both are the data failing to describe the role, and neither is a reason to abandon levels.**

---

## 1. Why the tier is the right abstraction

### The tier is the requirement, stated once

The requirement on `webhooks.route.js` is not "HEALTHCARE ADMIN or CALIBRATOR ADMIN may manage webhooks." Read the comment the author actually wrote at `backend/src/routes/api/webhooks.route.js:10-14`:

> *"A webhook is an outbound channel out of the tenant: its target URL decides where this tenant's data is POSTed... **Managing them is tenant-admin work**."*

"Tenant-admin work" is the requirement. `ROLE_NAMES.TENANT_ADMIN` is that sentence compiled. `docs/SECURITY/04-AUTHORIZATION-RBAC.md:15` says the same thing in the architecture's own voice:

> *"`rbac` exists for operations expressed as a privilege floor rather than a surface — tenant backups, for instance, gated at `TENANT_ADMIN` (level 8) so both admin roles satisfy one check."*

The design is written down, it is coherent, and the code at `backend/src/middlewares/rbac.middleware.js:19-25` implements it faithfully. The only thing missing is a column in a projection and an integer in a seed.

### What enumerating names costs

The alternative is `rbac([ROLE_NAMES.HEALTCARE_ADMIN, ROLE_NAMES.CALIBRATOR_ADMIN])` at each site. Count the cost honestly.

**Today.** Five routers, eleven call sites (seven of them in `tenantBackup.route.js` alone), and seven Swagger `description:` strings that say "Requires SUPER_ADMIN or TENANT_ADMIN role" (`backend/src/routes/api/tenantBackup.route.js:40, :160, :274, :312, :411, :504, :624`). That is eighteen edits for a fix that is otherwise one line in one projection.

**The next role.** Suppose the QMS work in `ROLE_MENU_ASSIGNMENTS` grows a `QUALITY MANAGER` at admin tier. With the tier: add `ROLE_LEVELS.QUALITY_MANAGER = 8`, seed the role at level 8, done — eleven gates admit it because eleven gates asked for "level 8 or above", which is what was meant. With enumeration: find all eleven, edit all eleven, and the eleventh one you miss is silent. Note that `tenantBackup.route.js` has **seven** separate `rbac([...])` calls — a five-out-of-seven edit is not a hypothetical failure mode, it is the normal outcome of a manual sweep.

**The custom role a customer asks for.** `createRole` (`backend/src/services/roles.service.js:18-26`) lets a tenant mint a role at runtime, through an API, with a name nobody wrote in a constants file. Under enumeration that role can **never** pass a `rbac` gate, because passing requires its literal string to appear in a source file that shipped before it existed. Under the tier it passes the moment someone sets its level — which is a data decision made by whoever creates the role, in the tenant, at the time, which is where that decision belongs. Enumeration does not merely cost more edits; it makes runtime-created roles structurally incapable of holding administrative privilege.

**The asymmetry that decides it.** Both mechanisms fail closed. But enumeration fails closed *forever and invisibly* — the new role is simply never in the array, and no artifact anywhere records that it should have been. The tier fails closed *at a single named location* — `ROLE_LEVELS`, one map, which a boot assertion can check (§4). One of these is diagnosable. The other is eighteen files you have to already suspect.

### The tier is also the cheaper check

`rbac` costs **zero I/O**. The role row is already fetched by `getAuthUserWithTenant`; `roleLevel` is a third `INTEGER` on a row already joined and already in the result set.

`dynamicAccess` costs, per request, per menu group: a Redis `get` (`backend/src/services/roles.service.js:289-292`), on a miss a `RoleMenuPermission.findAll` with a two-level nested `MenuGroup` include (`:294-311`), **plus** a per-user override lookup wrapped in its own try/catch (`backend/src/middlewares/dynamicAccess.middleware.js:262-278`). That is the right price for fine-grained surface permissions. It is the wrong price for "is this caller an administrator of this tenant", which is one integer comparison against a field on a row you are already holding.

---

## 2. The exact change

### 2.1 The projection — four loaders, one attribute

Add `"roleLevel"` to the `Role`/`Roles` include in `backend/src/services/auth.service.js` at `:174`, `:410`, `:451`, `:626`.

```js
attributes: ["id", "name", "description", "roleLevel"],   // :451
attributes: ["id", "name", "roleLevel"],                  // :174, :410, :626
```

Note the **attribute name is `roleLevel`, not `role_level`** — the model is `underscored: true` (`backend/src/models/role.model.js:50`), so Sequelize maps the JS attribute `roleLevel` to the column `role_level` and exposes `roleLevel` on the instance. The `req.user.role?.role_level` branch at `backend/src/middlewares/rbac.middleware.js:39` will therefore stay `undefined` forever and the `|| roleLevel` fallback is what fires. That branch is not load-bearing and I would delete it (§2.5) rather than leave a snake_case read that only the test fixtures satisfy.

`verifyUserSession` also **reshapes** the role on the way out (`backend/src/services/auth.service.js:433`): `role: user.role ? { id: user.role.id, name: user.role.name } : null`. That literal needs `roleLevel` added too, or the level is selected and then discarded.

### 2.2 The seed — the half that makes the projection matter

1. Add `roleLevel: ROLE_LEVELS.<KEY>` to each entry of `DEFAULT_ROLES` (`backend/src/services/migration.service.js:78-113`) and `APPLICATION_ROLES` (`:121+`). `ROLE_IDS`, `ROLE_LEVELS` and `ROLE_NAMES` already share their keys, so this is mechanical and lint-checkable.
2. **A migration is mandatory, not optional.** `seedDefaultRoles` skips roles that already exist (`backend/src/services/migration.service.js:399-402`; `seedApplicationRoles` does the same at `:446-449`), so editing the seed arrays changes nothing in any database that has already been seeded — which is all of them. Migration `0020-backfill-role-levels.js` sets `role_level` by role name from `ROLE_LEVELS`, in one `UPDATE ... CASE`, with **no blanket `try/catch`** (CLAUDE.md: a migration with one is recorded as applied while doing nothing), followed by `make migrate-verify` and a `psql` check of the actual column values — the log is not evidence.
3. Custom roles: add `roleLevel` to `createRoleSchema` (`backend/src/validators/roles.validator.js:3-6`), bounded `Joi.number().integer().min(1).max(8)` — **max 8, never 10**, so no tenant-created role can ever reach the SUPERADMIN tier — and pass it through `createRole` (`backend/src/services/roles.service.js:18-26`). Creating a role is itself an administrative act already gated; granting the caller's own tier or below is the natural rule and should be enforced in the service, not the validator.

### 2.3 What the principal then carries

`req.user.role` becomes `{ id, name, description, roleLevel }` — one `INTEGER` more than today. That is the entire change to the principal.

### 2.4 What it costs

| cost | reality |
|---|---|
| Wider projection on a hot path | One `INTEGER` column on a row already fetched and already joined in the same query. No extra query, no extra round trip, no extra join. |
| Bigger session payload | **None.** `generateAccessToken` is called with `{ id, email }` (`backend/src/utils/jwt.util.js:185`). The token carries no role. The principal is rebuilt from the database on every request at `backend/src/middlewares/auth.middleware.js:92`. Nothing about the token changes. |
| Cache implications | **None on this path.** There is no cache between `getAuthUserWithTenant` and `req.user` — it is a live `findByPk` per request. The only role cache is `cacheKeys.permissions(roleId)` inside `getRolePermissionsMatrix` (`backend/src/services/roles.service.js:290`), which caches the *menu matrix*, not the role row, and is untouched by this change. A level change takes effect on the caller's next request. |
| Migration risk | Real. One `UPDATE` on `roles`, a table with eleven rows plus whatever tenants have created. Reversible: `down` restores `role_level = 1`. |
| Blast radius | Strictly widening. Today every level comparison evaluates `0 < n`. After the change some evaluate `8 < 8` and pass. **No caller who is authorized today becomes unauthorized.** That asymmetry is worth stating plainly: this change cannot break access, only grant it — which is also precisely why §4 matters more than §2. |

### 2.5 Two lines I would also delete

- `backend/src/middlewares/rbac.middleware.js:39` — drop the `role_level` snake_case read. It can never be satisfied by a Sequelize instance of an `underscored` model. Its only satisfiers today are hand-built test objects (§4), and a dead branch that exists to make fixtures pass is how the fixtures got wrong in the first place.
- `backend/src/middlewares/rbac.middleware.js:102` — `checkRoleLevel` reads `req.user.role.roleLevel` only and has the identical defect. Fix it in the same change or delete it; leaving a second, differently-broken copy of the same comparison is how this recurs.

---

## 3. The strongest case against me

I will state it at full strength, because it is a good argument.

> **A numeric privilege ladder is a blunt instrument, and this codebase already knows it.** `docs/SECURITY/04-AUTHORIZATION-RBAC.md:66-72` says so in as many words: `WAREHOUSE STAFF` at level 4 holds `write` on `warehouse`; `SUPERVISOR` at level 6 holds only `read`. Level orders *escalation*, not *scope*. **"Any `rbac()` gate that assumes higher level implies broader scope is wrong"** — the document's own sentence. The real authorization model is `dynamicAccess` with a menu slug, resolved from `role_menu_permissions` with per-user overrides; the doc calls it "the default" at `:13` and its own "Adding a Gated Surface" recipe (`:135-141`) says to gate with `dynamicAccess`, not `rbac`. `rbac` is the legacy exception. Right now it is a **dormant** legacy exception — it denies everyone but the SUPERADMIN, which is fail-closed and harmless. Position A proposes to wake it up: backfill the column, and eleven call sites that currently decide nothing start deciding, on a ladder the security document warns is not a scope relation. That does not retire the ladder. It makes the ladder **load-bearing**, in five routers holding storage credentials, outbound data channels, API-key minting and tenant backups — the highest-consequence surfaces in the product. Deleting the tier and enumerating real role names costs eighteen edits once and leaves nothing to wake up.

### My answer

**First — "blunt" is the right shape for this particular question.** The doc's warning is precise and I accept it entirely: level must not stand in for *scope*. But none of these five gates is a scope question. Not one of them asks "may you read warehouse and write equipment". They ask one question with one bit of answer: *are you an administrator of this tenant, or are you staff?* There is no surface decomposition available, because there is no surface — `apiKeys`, `webhooks`, `storage` and `tenantBackup` are **tenant-configuration** operations, not menus of records. The doc anticipated exactly this and carved it out at `:15`: "operations expressed as a privilege floor rather than a surface". A privilege floor is what a level is for. The doc is not ambivalent about `rbac`; it is specific about when to reach for it.

**Second — `dynamicAccess` cannot express four of these five gates today without minting four new menus.** `MENU_SLUGS` (`backend/src/constants/roleConstants.js:121-155`) contains no slug for API keys, webhooks, storage or backups. Migrating means running the full six-step recipe at `docs/SECURITY/04-AUTHORIZATION-RBAC.md:135-141` — four new slugs, four new `menu_groups` rows, **and grants added to each of eleven `ROLE_MENU_ASSIGNMENTS` entries** (`backend/src/constants/roleConstants.js:192, 230, 267, 295, 319, 335, 349, 362, 374, 386, 399`), plus a migration to seed the rows into every existing database. Against my one-integer backfill that is not the cheap option, and it is not the safe one either.

**Third — and this is the part that decides it — `dynamicAccess` has the identical failure mode, and I can show it running today.** `METERED_BILLING` is the one slug of the five that **already exists** (`backend/src/constants/roleConstants.js:145`). So migrate `meteredBilling.route.js:33` to `dynamicAccess("metered-billing", "write")` right now, exactly as the opposition prescribes, and read the grants:

- SUPER_ADMIN → `WRITE` (`backend/src/constants/roleConstants.js:218`)
- HEALTHCARE ADMIN → `READ` (`:256`)
- CALIBRATOR ADMIN → **absent from its menu block entirely** (`:267-293`)

A healthcare admin gets 403 on every write. A calibrator admin gets 403 on everything. **The same two roles are locked out of the same surface, by the other mechanism, for the same underlying reason: a row of authorization data that nobody wrote.** The opposition's remedy, applied to the only route where it is available without new infrastructure, reproduces the bug. That is not a rhetorical point — it is the demonstration that the defect is not "levels". The defect is that authorization data is written by hand into two places and validated in neither.

**Fourth — "dormant is safe" is the most dangerous sentence in this debate.** Right now a HEALTHCARE ADMIN clicking *Create API key* gets a 403. That is not a security property; it is an outage wearing a security property's clothes. CLAUDE.md names the mechanism exactly: *"it is silent because a 403 to an admin looks like a permission decision, not a bug."* The pressure this generates is real and predictable: a support ticket, an engineer who finds an admin cannot do admin work, and the fastest fix to hand — give the customer a SUPERADMIN account. `docs/SECURITY/04-AUTHORIZATION-RBAC.md:35` calls that account "the highest-value credential in the system (PR-3)", and `backend/src/middlewares/rbac.middleware.js:47-49` plus `backend/src/middlewares/dynamicAccess.middleware.js:52-60` confirm it bypasses *both* gates unconditionally, including tenant scoping. A gate that denies the people who should pass does not stay denied. It gets routed around, at the highest privilege available, and the route-around is what ships.

**Fifth — on "making the ladder load-bearing".** It already is. `ROLE_LEVELS` is exported, `rbac` is imported by five routers, `docs/SECURITY/04-AUTHORIZATION-RBAC.md` documents the mechanism as current, and `backend/src/middlewares/rbac.middleware.js:19-25` was *deliberately rewritten* to remove phantom undefined entries — its own comment at `:17-18` says so. Position B's "retire it" is not the deletion of an unused thing; it is a migration of five routers plus a documentation rewrite, and the intermediate state is the lockout we already have. If the owner decides the ladder should go, that is an ADR and a phase of work, and §5 says what I would support. It is not a bug fix, and the lockout is a bug today.

---

## 4. How I would prevent the recurrence

**The defect is not the missing attribute. The defect is that nothing failed when it was missing.** Four independent test layers passed over this and none of them could see it. Here is exactly why, because the pattern generalizes and the generalization is the deliverable.

| layer | file | why it cannot see the defect |
|---|---|---|
| middleware unit tests | `backend/src/tests/middlewares/rbac.test.js:66, :82, :89, :105` | Hand-builds `req.user = { role: { name, role_level } }`. No loader produces that shape — and `role_level` in snake_case is a shape Sequelize cannot produce at all, for an `underscored` model. The fixture asserts the middleware against a **fabricated** principal. |
| route-guard composition | `backend/src/tests/routes/routeGuards.a02.test.js:21-27` | **Mocks `rbac` to `(req,res,next)=>next()`.** It asserts the gate is in the chain with the right role array — and by construction cannot observe that the gate rejects everyone. Its own header says so at `:9-10`: *"They do not re-test the middlewares themselves."* |
| route smoke tests | `backend/src/tests/routes/apiKeys.route.test.js` and siblings | Assert router shape only — that a POST `/` layer exists. No principal at all. |
| live E2E | `backend/src/tests/e2e/modules/api-keys.e2e.test.js:12` | Logs in as `sys@mail.com` — the **SUPERADMIN**, which short-circuits at `backend/src/middlewares/rbac.middleware.js:47-49` before any level is read. The one suite that drives the real loader uses the one principal that never reaches the broken branch. |

And the sharpest single artifact, `backend/src/tests/routes/meteredBilling.route.test.js:97`:

```js
guard({ user: { role: { name: "TENANT_ADMIN", role_level: 8 } } }, {}, next);
expect(next).toHaveBeenCalledWith();     // test name: "allows a TENANT_ADMIN through"
```

That principal is impossible **three** times over: no seeded role is named `TENANT_ADMIN` (`backend/src/constants/roleConstants.js:40-45` says so explicitly — *"NOT a seeded DB role"*); no loader selects a level; and `role_level` in snake_case is not an attribute of an `underscored` Sequelize instance. A green assertion named *"allows a TENANT_ADMIN through"* is currently the repository's strongest written evidence for the exact thing that is false. CLAUDE.md's Evidence section predicted this verbatim: *"A mock proves the client, not the contract."*

**The seam between the loader and the gate is tested by nobody. Every test sits on one side of it.** Four fixes, in the order I would land them.

### 4.1 One test that drives the real loader (the fix that would have caught it)

```
backend/src/tests/integration/principal.shape.test.js

for each of the four loaders in auth.service.js:
  seed a user on a real (test-db) role at a known level
  call the loader
  assert principal.role.roleLevel === that level     // not 0, not undefined, not 1
  feed the principal to the real, unmocked rbac([ROLE_NAMES.TENANT_ADMIN])
  assert next() with no error
  and a TECHNICIAN principal through the same path asserts 403
```

The load-bearing words are **real loader** and **unmocked `rbac`**. CLAUDE.md's rule — *"A test generated from the code it tests verifies consistency, never correctness"* — means the principal in this test must come out of `auth.service.js`, never out of an object literal. If it is written with a literal it is `rbac.test.js` again and it will pass again while the system is broken again.

This test also pins the *name*: writing `role_level` instead of `roleLevel` fails it, which is the `is_deleted` / `isDeleted` trap from CLAUDE.md's table wearing a different column.

### 4.2 A startup assertion (the fix that makes it impossible to ship)

There is precedent for this, in this codebase, on this concern. `backend/src/config/index.js:23-64` runs `validateConfig()` at require time and throws on a missing `DB_HOST` or an unsupported `DB_DIALECT`. `backend/src/utils/jwt.util.js:11-28` throws at require time if `JWT_ACCESS_SECRET` is missing or equal to the refresh secret — added under A-31, for exactly this reason: a configuration that is silently wrong is worse than a process that will not start.

Add the same for authorization. At module load in `rbac.middleware.js`:

```
for each key in ROLE_NAMES:
  ROLE_LEVELS[key] must exist            // catches the trap from the documented end:
                                         // a new role with no level
```

and at boot, after the models connect (an async check in the startup path, not at require time):

```
every row in roles must have role_level > 0, and equal to ROLE_LEVELS[its name]
  where the name is a known one; an unknown (custom) name must simply have a level
→ otherwise: refuse to start, naming the role
```

`ROLE_LEVELS` disagreeing with the `roles` table is not a runtime condition to degrade through. It is a deployment that will silently deny administrators, and it should not reach a port. The failure message names the role, which turns a week of "why is my admin getting 403" into a line in the startup log.

### 4.3 A test for the *other* end of the trap

The prompt frames this as CLAUDE.md's trap from the far end, and that framing is the design input for the test:

```
it("every ROLE_NAMES entry has a ROLE_LEVELS entry", ...)
it("every seeded role in DEFAULT_ROLES + APPLICATION_ROLES carries roleLevel", ...)
it("createRole persists the level it was given, and rejects level 10", ...)
```

The third is the one that matters for the custom-role case in §1, and it currently fails: `backend/src/services/roles.service.js:18-26` does not persist a level at all.

### 4.4 The typed version, when Phase 9 reaches these modules

Under ADR-038 / `TASKS/PHASE-9-TYPESCRIPT-MIGRATION.md`, `auth.middleware.ts` and `rbac.middleware.ts` should share one exported type:

```ts
interface AuthenticatedPrincipal {
  id: string;
  tenantId: string | null;
  role: { id: string; name: string; roleLevel: number };   // required, not optional
}
```

`roleLevel: number` — **not** `number | undefined`, and **no** `role_level` alias. Then `req.user.role?.roleLevel || 0` stops compiling, because the optional chain and the `|| 0` are both dead, and a loader that returns a role without a level fails typecheck at the projection rather than at a customer's 403. This is the durable version of 4.1 and 4.2; the test and the assertion are what hold the line until the conversion arrives. I am not proposing a half-conversion of `auth.service.js` now — CLAUDE.md forbids it, and correctly.

**Ordering matters.** 4.1 and 4.3 go in the *same commit* as the fix, and 4.1 must be observed to fail on the pre-fix code and pass after. An assertion that a test passed is not evidence: the test is `backend/src/tests/integration/principal.shape.test.js`, the case is *"getAuthUserWithTenant yields a principal that passes rbac([TENANT_ADMIN])"*, and the record goes in `MEMORY/records/` with `TASKS/PROGRESS.md` updated in the same commit.

---

## 5. What I concede

1. **My fix is bigger than "add one attribute", and the prompt's framing understates it.** It is four projections, one reshaped literal at `backend/src/services/auth.service.js:433`, two seed arrays, a migration with a verified `psql` check, and a validator plus service change for custom roles. I would rather say that now than discover it at step 4 of the workflow.

2. **The `role_level` snake_case branch at `backend/src/middlewares/rbac.middleware.js:39` is dead code that exists to satisfy wrong fixtures**, and the fixtures were written after the branch. That is a piece of evidence that the level path has never been exercised against a real principal, and it is not evidence in my favour — it is evidence that this mechanism has been decorative for its entire life. A mechanism nobody has run is a mechanism nobody has learned to maintain, and Position B is entitled to weigh that.

3. **The security document's warning is correct and permanently binding.** `docs/SECURITY/04-AUTHORIZATION-RBAC.md:66-72` — level orders escalation, not scope. If backfilling the column tempts anyone to write `rbac([SUPERVISOR])` to mean "supervisors and warehouse staff", that gate is wrong and the document already says it is wrong. The backfill must land with that sentence quoted in the `rbac` JSDoc, not merely in a `docs/` file that the gate's author may not open.

4. **`dynamicAccess` should remain the default, and `rbac` should stay rare.** I am defending five call sites, not a direction of travel. If any of the four surfaces later grows a read/write distinction — a role that may *view* webhook deliveries but not *edit* targets — that is a slug, and it should become one. The tier answers a yes/no question; the moment the question stops being yes/no, the tier is the wrong tool and I would migrate it myself.

5. **`meteredBilling.route.js:33` is genuinely Position B's route, and I hand it over.** `"BILLING_ADMIN"` is a name that exists nowhere in `ROLE_NAMES`, which is already the enumeration failure mode in miniature; the `metered-billing` slug already exists at `backend/src/constants/roleConstants.js:145`; and the surface is a menu with a read/write distinction, not a privilege floor. It should be `dynamicAccess("metered-billing", "read"|"write")` — **provided** the grant gap I found at `:267-293` is closed in the same change, or the migration swaps one silent lockout for another.

6. **If the owner decides the ladder should be retired, I will not litigate it — but that is an ADR, not this fix.** Deleting `ROLE_LEVELS` means five routers, a documentation rewrite at `docs/SECURITY/04-AUTHORIZATION-RBAC.md:11-15` and `:58-72`, four new menu slugs, eleven `ROLE_MENU_ASSIGNMENTS` blocks and a `menu_groups` migration. It is a phase of work with a decision behind it, and CLAUDE.md is explicit that a decision the owner has not made is an Open Question in `TASKS/BACKLOG.md`, not a judgement call made inside a bug fix. **Meanwhile the lockout is live.** The one-integer backfill and the assertion that makes it loud are correct under either future: if the ladder stays, they are the fix; if the ladder goes, they keep administrators working during the migration and are deleted with it.

7. **What would change my mind.** If someone shows that a real customer deployment has `role_level` values that *disagree* with `ROLE_LEVELS` — set by hand, by an operator, to mean something — then the column is not a cache of the constants map but an independent source of truth, my backfill silently overwrites a production authorization decision, and the assertion in §4.2 is asserting the wrong invariant. I checked: nothing under `backend/src/` writes `roleLevel` — no service, no controller, no validator, and no migration in `0001`–`0019` — so the column is `1` everywhere and the risk is theoretical. But it is checkable in one query against the live database before the migration runs, and it should be checked rather than assumed.

---

## Summary

| | |
|---|---|
| **The bug** | `role_level` is never selected (`auth.service.js:174, :410, :451, :626`) **and** never seeded (`migration.service.js:78-113`), so `rbac.middleware.js:38-39` always reads `0` and every `rbac([TENANT_ADMIN])` gate is SUPERADMIN-only — five routers, eleven call sites. |
| **The fix** | Select `roleLevel` in four loaders, seed it, backfill it by migration, accept it in `createRole` (capped at 8). No token change, no cache change, no extra query. |
| **Why the tier** | "Administers this tenant" is one requirement; enumeration writes it eleven times, breaks on every new role silently, and makes runtime-created custom roles structurally unable to hold admin privilege. |
| **Why not `dynamicAccess` here** | These are privilege floors, not surfaces; four of five have no slug; and the one that *does* — `metered-billing` — reproduces the identical lockout through the grant matrix at `roleConstants.js:267-293`. |
| **The real defect** | Nothing failed when the attribute was missing. Four test layers, every one on one side of the loader/gate seam. Fix: an integration test on the real loader with `rbac` unmocked, plus a boot assertion in the style of `config/index.js:23-64`. |
