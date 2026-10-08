/**
 * Application-level tenant isolation (replaces Postgres RLS).
 *
 * Postgres RLS cannot be the isolation mechanism once the platform must run on
 * multiple database engines, so isolation lives here: global Sequelize hooks
 * inject a mandatory tenant predicate into every query touching a
 * tenant-scoped model.
 *
 * DENY BY DEFAULT is the whole point. The previous inline implementation
 * returned early (i.e. applied NO filter) whenever the request had no
 * `tenantId` — so an authenticated principal without a tenant saw EVERY
 * tenant's rows. That is the same fail-open hole the RLS policy had via its
 * `app.current_tenant = ''` branch. Here, that case resolves to a predicate
 * that can never match.
 *
 * Resolution order:
 *   options.skipTenantScope  -> skip   (explicit, greppable, auditable opt-out)
 *   no CLS context           -> skip   (pre-auth login/register, public
 *                                       endpoints, migrations, schedulers —
 *                                       these are not user-tenant requests)
 *   context.isSystemTask     -> skip   (background/system work)
 *   context.isSuperAdmin     -> skip   (cross-tenant operator, by design)
 *   context.tenantId         -> filter by that tenant
 *   otherwise                -> DENY   (authenticated, no tenant => sees nothing)
 *
 * INCLUDES (A-87). Until 2026-09-24 the predicate reached the ROOT model's
 * WHERE only; an include of a tenant-scoped model joined whatever row its
 * foreign key pointed at, in any tenant. `beforeFind` and `beforeCount` now
 * also walk the include tree (`applyTenantToIncludes`) and put the same
 * predicate, resolved the same way, on every tenant-scoped include — in its
 * ON clause, with its join type pinned to what it would have been without
 * the hook, so a LEFT JOIN never silently becomes an INNER JOIN.
 *
 * HOOKLESS STATICS (W-34). `aggregate` (so `sum`/`min`/`max`) and static
 * `increment` (so `decrement`) run no hook at all; they are wrapped per model
 * (`scopeHooklessStatics`). `restore` does fire hooks, which were not
 * registered until 2026-09-25.
 *
 * THE FACILITY DIMENSION (P21-09, ADR-124 Am. 2 § 8). Every hook also applies a second,
 * deny-by-default scope for a FACILITY-BOUND principal (`ctx.facilityBound`): a facility model
 * is filtered to the principal's facility, a FACILITY_READABLE model to its rule, and any other
 * tenant model is denied — see `resolveFacilityScope`. Unbound principals are untouched.
 *
 * Eleven hooks are registered, plus `afterDefine` to wrap each new model's
 * hookless statics. Read/bulk-write verbs get a predicate; create-shaped
 * verbs get a stamp. `bulkCreate` and `upsert` (D-01) were outside the hooks
 * entirely until 2026-09-23 — see `applyTenantAssignmentBulk` and
 * `assertUpsertTenant` for why those two REFUSE a mismatched row instead of
 * silently re-scoping it.
 *
 * P9-09 (ADR-087 Amendment 4): converted from tenantScope.util.js with no
 * behaviour change, under the four gates tenantContext passed. The types below
 * describe the parts of Sequelize's model, options and include objects this
 * module reads — several of them private (`_scope`, `_conformIncludes`,
 * `_expandIncludeAll`, `_getIncludedAssociation`). They are structural and
 * local: the models are not typed yet (P9-10), and every JavaScript caller may
 * pass anything, so every defensive check the .js made is still made.
 */

import { Op } from "sequelize";
import { tenantStorage } from "../middlewares/tenantContext.middleware";
import { NO_FACILITY_ID, NO_TENANT_ID, type TenantId } from "../types/ids";
import { FACILITY_READABLE, type FacilityReadableEntry } from "../constants/facilityAccess";

/** An attribute definition, as far as this module reads it. */
interface AttributeDefinition {
  field?: string;
}

/** A Sequelize model, as far as this module reads it (private members included). */
export interface ScopedModel {
  /** The model name (`FACILITY_READABLE` is keyed by it). */
  name?: string;
  rawAttributes?: Record<string, AttributeDefinition | undefined>;
  _scope: { where?: unknown };
  _getIncludedAssociation(model: unknown, as: unknown): ScopedAssociation | null;
  _conformIncludes(options: QueryOptions, model: ScopedModel): void;
  _expandIncludeAll(options: QueryOptions): void;
  aggregate: (this: ScopedModel, attribute: unknown, aggregateFunction: unknown, options?: QueryOptions) => unknown;
  increment: (this: ScopedModel, fields: unknown, options?: QueryOptions) => unknown;
}

/** An association, as far as this module reads it. */
interface ScopedAssociation {
  through?: { model?: ScopedModel | null } | null;
}

/** A conformed include (`{ model, as, … }`), as far as this module reads and writes it. */
interface ScopedInclude {
  model: ScopedModel;
  as?: unknown;
  association?: ScopedAssociation;
  where?: unknown;
  required?: boolean;
  separate?: boolean;
  limit?: unknown;
  include?: unknown;
  through?: { where?: unknown; [key: string]: unknown };
  _pseudo?: boolean;
  skipTenantScope?: boolean;
  /** P21-09: the include-level twin of the root `skipFacilityScope` (reviewed, G-13). */
  skipFacilityScope?: boolean;
}

/** Query / hook options, as far as this module reads and writes them. */
export interface QueryOptions {
  skipTenantScope?: boolean;
  /** P21-09: the reviewed opt-out of the facility dimension (spec § 7.6, G-13). */
  skipFacilityScope?: boolean;
  /** P21-09 (AM-6): the device move's id — the one operation that may change a row's facility. */
  facilityMove?: unknown;
  /** P21-09 (AM-6): the user-binding operation — the one that may change `users.client_facility_id`. */
  facilityBinding?: unknown;
  where?: unknown;
  include?: unknown;
  truncate?: boolean;
  fields?: unknown;
  [key: string]: unknown;
}

/** A row (instance or plain object) whose tenant column is read or stamped. */
type TenantRow = Record<string, unknown>;

/** How the active context scopes a query. */
export type Scope = { mode: "skip" } | { mode: "filter"; tenantId: TenantId } | { mode: "deny" };

/**
 * A syntactically valid UUID that no real tenant will ever own. Used instead of
 * a sentinel like "__no_tenant__" because tenant columns are UUID typed —
 * a non-UUID literal makes Postgres raise a type error instead of returning
 * zero rows, which would turn a denial into a 500.
 */
// P9-10 DoD (ADR-087 Amendment 11): the deny branch is a TenantId, so a scope value is always one.
// The same string as before; branded in src/types/ids.ts, the one place a brand assertion lives.
const NO_TENANT_UUID: TenantId = NO_TENANT_ID;

/** The tenant column for a model, or null when the model is not tenant-scoped. */
const tenantKeyOf = (model: ScopedModel | null | undefined): "tenantId" | "tenant_id" | null => {
  // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- as built: a falsy model is returned as is
  const attrs = model && model.rawAttributes;
  if (!attrs) {return null;}
  if (attrs["tenantId"]) {return "tenantId";}
  if (attrs["tenant_id"]) {return "tenant_id";}
  return null;
};

/**
 * Decide how the active context scopes a query.
 */
const resolveScope = (options?: QueryOptions | null): Scope => {
  if (options?.skipTenantScope) {return { mode: "skip" };}

  const ctx = tenantStorage.getStore();
  if (!ctx) {return { mode: "skip" };}
  if (ctx.isSystemTask) {return { mode: "skip" };}
  if (ctx.isSuperAdmin) {return { mode: "skip" };}
  if (ctx.tenantId) {return { mode: "filter", tenantId: ctx.tenantId };}

  return { mode: "deny" };
};

/**
 * Inject the mandatory tenant predicate into a read/bulk-write query.
 *
 * W-33 — `byField`: `Model.destroy` maps attribute names to column names
 * (`Utils.mapOptionFieldNames`, sequelize/lib/model.js) BEFORE it runs
 * `beforeBulkDestroy`, and nothing maps them again. The predicate added there
 * must therefore name the COLUMN: `tenantId` reached the DELETE verbatim, and
 * PostgreSQL answered `column "tenantId" does not exist` for every bulk
 * destroy of an underscored model run inside a tenant context. Finds and bulk
 * updates map after their hooks, so they keep the attribute name.
 *
 * @param options - the query options (mutated)
 * @param model - the model the hook fired for
 * @param how - `byField`: name the column, not the attribute
 */
const applyTenantWhere = (options: QueryOptions, model: ScopedModel, { byField = false }: { byField?: boolean } = {}): void => {
  const key = tenantKeyOf(model);
  if (!key) {return;}

  const scope = resolveScope(options);
  if (scope.mode === "skip") {return;}

  // Isolation is FORCED: a caller asking for another tenant simply gets nothing.
  const value = scope.mode === "deny" ? NO_TENANT_UUID : scope.tenantId;
  // `key` came from rawAttributes, so the attribute exists.
  const attributes = model.rawAttributes as Record<string, AttributeDefinition>;
  // An empty field name falls back to the key (`||`, as built). `!` is banned
  // (no-non-null-assertion), so the assertion states that the attribute exists.
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- see above
  const column = byField ? (attributes[key] as AttributeDefinition).field || key : key;
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: any falsy where is replaced by {}
  const current = options.where || {};
  options.where = { ...current, [column]: value };
};

/**
 * `where` with the tenant predicate added — the include-level twin of the
 * spread in `applyTenantWhere`. A plain object is spread (symbol operators
 * such as `[Op.or]` survive a spread), so the tenant key is FORCED exactly as
 * it is on the root: an include asking for another tenant gets nothing. Any
 * other shape (`sequelize.where(...)`, a literal) is AND-ed, never replaced.
 */
const withTenantPredicate = (where: unknown, key: string, value: string): object => {
  if (where === undefined || where === null) {return { [key]: value };}
  // `typeof` only narrows for the checker: a primitive's prototype is never
  // Object.prototype, so it is AND-ed below, exactly as before.
  if (typeof where === "object" && Object.getPrototypeOf(where) === Object.prototype) {return { ...where, [key]: value };}
  return { [Op.and]: [where, { [key]: value }] };
};

/**
 * The include's association, or null when Sequelize cannot resolve it — in
 * which case Sequelize itself throws the EagerLoadingError a moment later, so
 * there is nothing for this hook to scope.
 */
const associationOf = (include: ScopedInclude, parentModel: ScopedModel): ScopedAssociation | null => {
  if (include.association) {return include.association;}
  try {
    return parentModel._getIncludedAssociation(include.model, include.as);
  } catch {
    return null;
  }
};

/**
 * A `separate: true` include (and a hasMany include with a `limit`, which
 * Sequelize makes separate) is not joined: `_findSeparate` runs it as its OWN
 * `findAll` on the target, where `beforeFind` fires again and scopes it as a
 * root query — its nested includes included.
 */
const isSeparate = (include: ScopedInclude): boolean =>
  include.separate === true ||
  (include.separate === undefined && Boolean(include.limit));

/**
 * Put the tenant predicate on every tenant-scoped model in an include tree.
 *
 * JOIN SEMANTICS ARE PRESERVED. Sequelize defaults an include's `required` to
 * `!!include.where` AFTER merging the target's defaultScope `where` into it
 * (`_validateIncludedElement`). Adding a `where` here would therefore turn
 * every LEFT JOIN into an INNER JOIN. So when the include did not say, its
 * `required` is pinned FIRST to what Sequelize would have chosen without this
 * hook: `!!(own where || defaultScope where)`. A LEFT JOIN stays a LEFT JOIN
 * (the predicate lands in its ON clause, so a foreign row joins as NULL), and
 * an INNER JOIN stays INNER (a row pointing at a foreign row drops out).
 *
 * @param includes - Conformed includes (`{ model, as, ... }`)
 * @param parentModel - The model these includes hang off
 * @param value - The tenant id (or NO_TENANT_UUID) to force
 */
const scopeIncludes = (includes: ScopedInclude[], parentModel: ScopedModel, value: string): void => {
  for (const include of includes) {
    // A pseudo include is the `through` row Sequelize generated while
    // validating a belongsToMany; it is scoped via `include.through` below.
    // `skipTenantScope` on an include is the include-level twin of the root
    // opt-out: explicit, greppable, reviewable.
    if (include._pseudo || include.skipTenantScope || isSeparate(include)) {continue;}

    const key = tenantKeyOf(include.model);
    if (key) {
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: only `undefined` is pinned; `??=` would also overwrite an explicit null
      if (include.required === undefined) {
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: Boolean(a || b)
        include.required = Boolean(include.where || include.model._scope.where);
      }
      include.where = withTenantPredicate(include.where, key, value);
    }

    const association = associationOf(include, parentModel);
    // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- as built: each falsy link is passed on as is
    const throughKey = tenantKeyOf(association && association.through && association.through.model);
    if (throughKey) {
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built
      const through = include.through || {};
      include.through = { ...through, where: withTenantPredicate(through.where, throughKey, value) };
    }

    if (Array.isArray(include.include)) {
      scopeIncludes(include.include as ScopedInclude[], include.model, value);
    }
  }
};

/**
 * Inject the tenant predicate into every include of a find/count (A-87).
 *
 * `beforeFind` fires once, for the root model; `applyTenantWhere` only reaches
 * that model's WHERE. Without this an include of a tenant-scoped model joins
 * any tenant's row its foreign key points at. Resolution is IDENTICAL to the
 * root's (`resolveScope` on the root options): skip for no context, system
 * work, the super admin and `skipTenantScope`; force the caller's tenant; deny
 * with NO_TENANT_UUID. There are no "global rows" to special-case: a
 * NULL-tenant row is invisible to the root predicate, so it is invisible here.
 *
 * Includes are normalised first with Sequelize's own `_conformIncludes` and
 * `_expandIncludeAll` (both idempotent; findAll and aggregate call them again
 * after this hook) so a string alias, a bare model, an association or
 * `{ all: true }` all arrive as `{ model, as, include }`.
 */
const applyTenantToIncludes = (options: QueryOptions, model: ScopedModel): void => {
  if (!options.include) {return;}

  const scope = resolveScope(options);
  if (scope.mode === "skip") {return;}
  const value = scope.mode === "deny" ? NO_TENANT_UUID : scope.tenantId;

  model._conformIncludes(options, model);
  model._expandIncludeAll(options);
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- _conformIncludes above mutates `options`; the checker cannot see that
  if (!options.include) {return;} // `include: []` conforms to no include at all
  scopeIncludes(options.include as ScopedInclude[], model, value);
};

/** Stamp the active tenant onto a row being created/updated. */
const applyTenantAssignment = (instance: TenantRow, model: ScopedModel, options?: QueryOptions): void => {
  const key = tenantKeyOf(model);
  if (!key) {return;}

  const scope = resolveScope(options);
  // Only stamp when there is a real tenant to stamp.
  if (scope.mode !== "filter") {return;}

  instance[key] = scope.tenantId;
};

/**
 * Stamp — or refuse — every row of a `bulkCreate`.
 *
 * `bulkCreate` is a create-shaped operation with no `where`, so there is no
 * predicate to inject; the isolation lever is the tenant column on each row.
 * Sequelize v6 builds the INSERT from `instance.dataValues` *after* this hook
 * runs (`sequelize/lib/model.js`, `recursiveBulkCreate`: `beforeBulkCreate` at
 * :1596, `records = instances.map(...)` at :1652), so mutating the instances
 * here does reach the statement.
 *
 * DECISION — a row carrying a tenant id that is not the caller's is REFUSED,
 * not stamped over. Three reasons:
 *   1. Deny-by-default. Stamping over is a silent rewrite of caller data; the
 *      caller asked for something the isolation model forbids and gets told so.
 *   2. It matches `assertSameTenant` (beforeDestroy), which already throws
 *      rather than quietly narrowing, so the two write-side guards agree.
 *   3. The one call site that takes its tenant from *data* rather than from an
 *      argument is the tenant-backup restore (D-02). Stamping there would
 *      silently re-own another tenant's users into the caller's tenant and the
 *      restore would report success. Refusing surfaces the bug.
 * A row with NO tenant id is stamped — that is the ordinary create path, and
 * it matches `applyTenantAssignment`.
 *
 * @param instances - The built (unsaved) instances
 * @param model - The model the hook fired for
 * @param options - The bulkCreate options
 */
const applyTenantAssignmentBulk = (instances: (TenantRow | null | undefined)[] | null | undefined, model: ScopedModel, options?: QueryOptions): void => {
  const key = tenantKeyOf(model);
  if (!key) {return;}

  const scope = resolveScope(options);
  if (scope.mode === "skip") {return;}

  // No resolvable tenant => write NOTHING. There is no `where` to poison with
  // NO_TENANT_UUID here, and stamping the sentinel would create real rows owned
  // by a tenant that does not exist. Refusal is the only fail-closed answer.
  if (scope.mode === "deny") {
    throw new Error(
      "Security Violation: Attempted to bulkCreate with no resolvable tenant",
    );
  }

  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built
  for (const instance of instances || []) {
    if (!instance) {continue;}
    const owner = instance[key];
    if (
      owner !== undefined &&
      owner !== null &&
      // eslint-disable-next-line @typescript-eslint/no-base-to-string -- as built: a tenant id of any JavaScript type is compared as its string
      String(owner) !== String(scope.tenantId)
    ) {
      throw new Error(
        "Security Violation: Attempted to bulkCreate a cross-tenant record",
      );
    }
    instance[key] = scope.tenantId;
  }

  // `options.fields` is snapshotted before this hook and decides the INSERT
  // column list. A caller that passed an explicit `fields` omitting the tenant
  // column would drop the stamp on the floor; put it back.
  if (options && Array.isArray(options.fields) && !(options.fields as unknown[]).includes(key)) {
    (options.fields as unknown[]).push(key);
  }
};

/**
 * Refuse an `upsert` that would touch a row outside the caller's tenant.
 *
 * `beforeUpsert` CANNOT stamp. Sequelize v6 computes `insertValues` and
 * `updateValues` from the built instance *before* it runs the hook
 * (`sequelize/lib/model.js`: instance built :1502, values snapshotted
 * :1512-1513, `beforeUpsert` :1531, statement built from those snapshots
 * :1533). Mutating `values` here changes nothing that reaches the database, so
 * a stamp would be a lie that looks like a fix. Refusal is what a hook can
 * actually enforce — and it is also the deny-by-default answer.
 *
 * The conflict target is not ours to pick either: `queryInterface.upsert`
 * derives it from the updated fields (`query-interface.js:318-339`) and falls
 * back to the primary key. On `tenant_settings` it resolves to the unique index
 * `(tenant_id, key)`, so a wrong tenant id does not collide — it UPDATEs the
 * other tenant's row. On a model whose conflict target does not include the
 * tenant column it is worse: `DO UPDATE SET tenant_id = EXCLUDED.tenant_id`
 * would re-own the conflicting row. Both are refused here.
 *
 * A missing tenant id is refused too, rather than stamped: we cannot stamp, and
 * letting it through writes a NULL-tenant row that every scoped read ignores.
 *
 * @param values - The values passed to `Model.upsert`
 * @param model - The model the hook fired for
 * @param options - The upsert options
 */
const assertUpsertTenant = (values: TenantRow | null | undefined, model: ScopedModel, options?: QueryOptions): void => {
  const key = tenantKeyOf(model);
  if (!key) {return;}

  const scope = resolveScope(options);
  if (scope.mode === "skip") {return;}

  if (scope.mode === "deny") {
    throw new Error(
      "Security Violation: Attempted to upsert with no resolvable tenant",
    );
  }

  // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- as built: a falsy `values` is passed on as is
  const owner = values && values[key];
  if (owner === undefined || owner === null) {
    throw new Error(
      "Security Violation: Attempted to upsert a row with no tenant",
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-base-to-string -- as built: compared as strings
  if (String(owner) !== String(scope.tenantId)) {
    throw new Error(
      "Security Violation: Attempted to upsert a cross-tenant record",
    );
  }
};

/** Refuse to destroy a row belonging to another tenant. */
const assertSameTenant = (instance: TenantRow | null | undefined, model: ScopedModel, options?: QueryOptions): void => {
  const key = tenantKeyOf(model);
  if (!key) {return;}

  const scope = resolveScope(options);
  if (scope.mode !== "filter") {return;}

  // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- as built: a falsy instance is passed on as is
  const owner = instance && instance[key];
  // eslint-disable-next-line @typescript-eslint/no-base-to-string -- as built: compared as strings
  if (owner && String(owner) !== String(scope.tenantId)) {
    throw new Error(
      "Security Violation: Attempted to destroy cross-tenant record",
    );
  }
};

/**
 * A-365 (F-4 of docs/SECURITY/15-FASKES-SCOPE-THREAT-MODEL.md § 9). A bulk
 * update's WHERE is scoped by `applyTenantWhere`, but its VALUES were never
 * read: `Model.update({ tenantId: X }, { where })` inside tenant A's context
 * matched A's rows and re-owned them to X. No route reaches it today (the
 * request schemas strip unknown fields and no service passes the column), so
 * this is the guard that keeps it so — the twin of `assertSameTenant` and of
 * the bulkCreate refusal. Inside a tenant scope, a value for the tenant column
 * that is not the context's tenant is refused; the context's own tenant (a
 * no-op) passes. Skip scopes (no context, a system task, the super admin) are
 * unchanged, as for every other hook; a deny scope's WHERE reaches no row.
 *
 * Sequelize v6 hands the values to `beforeBulkUpdate` as `options.attributes`
 * (lib/model.js, `update`).
 */
const refuseBulkTenantReassign = (options: QueryOptions, model: ScopedModel): void => {
  const key = tenantKeyOf(model);
  if (!key) {return;}
  const scope = resolveScope(options);
  // A deny scope's WHERE matches nothing (NO_TENANT_UUID), so its values reach no row.
  if (scope.mode !== "filter") {return;}
  const values = options["attributes"];
  if (typeof values !== "object" || values === null || !(key in values)) {return;}
  const next = (values as Record<string, unknown>)[key];
  if (String(next) !== String(scope.tenantId)) {
    throw new Error("Security Violation: Attempted to bulk-update the tenant column to another tenant");
  }
};

/**
 * W-34 — `Model.destroy({ truncate: true })` becomes `TRUNCATE`, which has no
 * WHERE: the predicate `beforeBulkDestroy` adds is silently dropped and every
 * tenant's rows go. Inside a tenant (or deny) scope it is refused.
 */
const refuseScopedTruncate = (options: QueryOptions | null | undefined, model: ScopedModel): void => {
  if (!options?.truncate || !tenantKeyOf(model)) {return;}
  const scope = resolveScope(options);
  // P21-09 (FT-19): a bound context is refused even when the tenant predicate was skipped.
  if (scope.mode === "skip" && resolveFacilityScope(model, options.skipFacilityScope).mode === "skip") {return;}
  throw new Error("Security Violation: Attempted to truncate a tenant-scoped table inside a tenant context");
};

/* ------------------------------------------------------------------ */
/* THE FACILITY DIMENSION (P21-09; ADR-124 Am. 2 § 8; spec § 7.3 – § 7.6) */
/* ------------------------------------------------------------------ */

/**
 * How the active context scopes a query in the SECOND dimension — the client facility a bound
 * principal is confined to. Resolved per model, beside (never instead of) the tenant scope:
 *
 *   options.skipFacilityScope                     -> skip   (reviewed, G-13)
 *   no context                                    -> skip   (pre-auth, migrations, ETL, schedulers)
 *   ctx.isSystemTask || ctx.isSuperAdmin          -> skip
 *   !ctx.facilityBound                            -> skip   (provider staff; self-served hospitals)
 *   the model has a facility key                  -> filter { <facility key>: ctx.clientFacilityId ?? NO_FACILITY_ID }
 *   the model has no tenant key either            -> skip   (global: roles, menus, catalogue, tenants)
 *   FACILITY_READABLE[model.name]                 -> rule   { <attribute>: own facility / own user }
 *   otherwise                                     -> deny   { <tenant key>: NO_TENANT_ID } (provider-internal)
 *
 * `skipTenantScope` does NOT skip this dimension (FT-30): a bound request reaching one of the
 * reviewed tenant opt-outs is still confined, and a deny writes NO_TENANT_ID on the tenant column
 * even when the tenant predicate was skipped.
 */
export type FacilityScope =
  | { mode: "skip" }
  | { mode: "filter" | "rule" | "deny"; key: string; value: string };

/** The facility column for a model, or null when the model has none. */
const facilityKeyOf = (model: ScopedModel | null | undefined): "clientFacilityId" | "client_facility_id" | null => {
  const attrs = model?.rawAttributes;
  if (!attrs) {return null;}
  if (attrs["clientFacilityId"]) {return "clientFacilityId";}
  if (attrs["client_facility_id"]) {return "client_facility_id";}
  return null;
};

/** The model's FACILITY_READABLE entry, if any. */
const readableEntryOf = (model: ScopedModel): FacilityReadableEntry | null => {
  const name = model.name;
  if (!name || !Object.prototype.hasOwnProperty.call(FACILITY_READABLE, name)) {return null;}
  // Present: the hasOwnProperty check above.
  return (FACILITY_READABLE as Readonly<Record<string, FacilityReadableEntry>>)[name] as FacilityReadableEntry;
};

/** Whether the active context is a bound principal's (the only one the dimension applies to). */
const boundContext = (): boolean => {
  const ctx = tenantStorage.getStore();
  return Boolean(ctx && !ctx.isSystemTask && !ctx.isSuperAdmin && ctx.facilityBound === true);
};

/**
 * Decide how the active context scopes `model` in the facility dimension.
 *
 * @param model - the model a hook fired for (or an include's model)
 * @param skip - `skipFacilityScope` at this level
 * @returns the facility scope
 */
const resolveFacilityScope = (model: ScopedModel, skip?: boolean): FacilityScope => {
  if (skip || !boundContext()) {return { mode: "skip" };}
  // boundContext() has just read a store.
  const ctx = tenantStorage.getStore() as NonNullable<ReturnType<typeof tenantStorage.getStore>>;
  const facilityKey = facilityKeyOf(model);
  if (facilityKey) {
    return { mode: "filter", key: facilityKey, value: ctx.clientFacilityId ?? NO_FACILITY_ID };
  }
  const tenantKey = tenantKeyOf(model);
  if (!tenantKey) {return { mode: "skip" };}
  const readable = readableEntryOf(model);
  if (readable) {
    const value = readable.rule === "own-facility" ? ctx.clientFacilityId ?? NO_FACILITY_ID : ctx.userId ?? NO_TENANT_ID;
    return { mode: "rule", key: readable.attribute, value };
  }
  return { mode: "deny", key: tenantKey, value: NO_TENANT_ID };
};

/**
 * The column (not the attribute) a scope names — for the hooks that run after mapping (W-33).
 * An attribute without a field name (or none at all) names its own column, as applyTenantWhere.
 */
const columnOf = (model: ScopedModel, key: string): string => {
  const field = model.rawAttributes?.[key]?.field;
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- an EMPTY field name falls back too, as applyTenantWhere's `||`
  return field ? field : key;
};

/**
 * Put the facility predicate on a read / bulk-write query's root, AND-ed beside the tenant
 * predicate and FORCED: a caller's own `clientFacilityId` in the `where` (a provider filter)
 * cannot widen a bound query (FT-10) — the forced value replaces it, and any other shape is AND-ed.
 *
 * @param options - the query options (mutated)
 * @param model - the model the hook fired for
 * @param how - `byField`: name the column (bulk destroy / restore, W-33)
 */
const applyFacilityWhere = (options: QueryOptions, model: ScopedModel, { byField = false }: { byField?: boolean } = {}): void => {
  const scope = resolveFacilityScope(model, options.skipFacilityScope);
  if (scope.mode === "skip") {return;}
  const key = byField ? columnOf(model, scope.key) : scope.key;
  options.where = withTenantPredicate(options.where, key, scope.value);
};

/**
 * The include-tree twin of `applyFacilityWhere` (AM-5): each include's model is resolved on its
 * own — a facility model gets the facility predicate in its ON clause, a readable model its rule,
 * a provider-internal model NO_TENANT_ID (deny per include: a LEFT join reads null, an INNER one
 * drops the row) — with the join type pinned exactly as `scopeIncludes` pins it. `through` models
 * too; `separate` includes re-enter `beforeFind`; an include's `skipFacilityScope` is honoured.
 *
 * @param includes - conformed includes
 * @param parentModel - the model they hang off
 */
const scopeFacilityIncludes = (includes: ScopedInclude[], parentModel: ScopedModel): void => {
  for (const include of includes) {
    if (include._pseudo || include.skipFacilityScope || isSeparate(include)) {continue;}

    const scope = resolveFacilityScope(include.model);
    if (scope.mode !== "skip") {
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- only `undefined` is pinned; `??=` would also overwrite an explicit null (as scopeIncludes)
      if (include.required === undefined) {
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- Boolean(a || b), as scopeIncludes
        include.required = Boolean(include.where || include.model._scope.where);
      }
      include.where = withTenantPredicate(include.where, scope.key, scope.value);
    }

    const throughModel = associationOf(include, parentModel)?.through?.model;
    if (throughModel) {
      const throughScope = resolveFacilityScope(throughModel);
      if (throughScope.mode !== "skip") {
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as scopeIncludes
        const through = include.through || {};
        include.through = { ...through, where: withTenantPredicate(through.where, throughScope.key, throughScope.value) };
      }
    }

    if (Array.isArray(include.include)) {
      scopeFacilityIncludes(include.include as ScopedInclude[], include.model);
    }
  }
};

/**
 * Put the facility dimension on every include of a find / count. A root `skipFacilityScope` skips
 * the whole tree; nothing is done outside a bound context (the common case costs one store read).
 */
const applyFacilityToIncludes = (options: QueryOptions, model: ScopedModel): void => {
  if (!options.include || options.skipFacilityScope || !boundContext()) {return;}
  model._conformIncludes(options, model);
  model._expandIncludeAll(options);
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- _conformIncludes above mutates `options`
  if (!options.include) {return;}
  scopeFacilityIncludes(options.include as ScopedInclude[], model);
};

/** Whether a row value matches a scope's value (compared as strings, as the tenant guards do). */
const sameValue = (actual: unknown, expected: string): boolean =>
  // eslint-disable-next-line @typescript-eslint/no-base-to-string -- an id of any JavaScript type is compared as its string
  actual !== undefined && actual !== null && String(actual) === expected;

/**
 * Stamp — or refuse — the facility dimension on a row a bound principal creates (spec § 7.4):
 * a facility model or a readable model gets its value stamped when missing and a mismatched value
 * REFUSED (never silently re-owned — the bulkCreate rule); a provider-internal model is refused
 * outright ("a facility-bound principal cannot write provider-internal data") unless the call is a
 * reviewed `skipFacilityScope`.
 *
 * @param instance - the row
 * @param model - the model the hook fired for
 * @param options - the create options
 * @param verb - for the refusal message
 */
const applyFacilityAssignment = (instance: TenantRow | null | undefined, model: ScopedModel, options: QueryOptions | null | undefined, verb = "create"): void => {
  const scope = resolveFacilityScope(model, options?.skipFacilityScope);
  if (scope.mode === "skip" || !instance) {return;}
  if (scope.mode === "deny") {
    throw new Error(`Security Violation: A facility-bound principal cannot ${verb} provider-internal data`);
  }
  const current = instance[scope.key];
  if (current === undefined || current === null) {
    // The own-facility rule compares a primary key: a bound principal never creates the facility row.
    if (scope.mode === "rule" && scope.key === "id") {
      throw new Error(`Security Violation: A facility-bound principal cannot ${verb} a client facility`);
    }
    instance[scope.key] = scope.value;
    return;
  }
  if (!sameValue(current, scope.value)) {
    throw new Error(`Security Violation: Attempted to ${verb} a row of another client facility`);
  }
};

/** `beforeBulkCreate`: every row as `applyFacilityAssignment`; the INSERT column list keeps the key. */
const applyFacilityAssignmentBulk = (instances: (TenantRow | null | undefined)[] | null | undefined, model: ScopedModel, options?: QueryOptions): void => {
  const scope = resolveFacilityScope(model, options?.skipFacilityScope);
  if (scope.mode === "skip") {return;}
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- a missing list is no rows
  for (const instance of instances || []) {
    applyFacilityAssignment(instance, model, options, "bulkCreate");
  }
  if (options && Array.isArray(options.fields) && !(options.fields as unknown[]).includes(scope.key)) {
    (options.fields as unknown[]).push(scope.key);
  }
};

/**
 * `beforeUpsert` cannot stamp (see assertUpsertTenant): a bound principal's upsert must carry its
 * own facility (or rule value); missing, mismatched or provider-internal is refused.
 */
const assertUpsertFacility = (values: TenantRow | null | undefined, model: ScopedModel, options?: QueryOptions): void => {
  const scope = resolveFacilityScope(model, options?.skipFacilityScope);
  if (scope.mode === "skip") {return;}
  if (scope.mode === "deny") {
    throw new Error("Security Violation: A facility-bound principal cannot upsert provider-internal data");
  }
  if (!sameValue(values?.[scope.key], scope.value)) {
    throw new Error("Security Violation: Attempted to upsert a row outside the principal's client facility");
  }
};

/** `beforeDestroy` / `beforeRestore` (instance): a bound principal acts only on its own facility's rows. */
const assertSameFacility = (instance: TenantRow | null | undefined, model: ScopedModel, options?: QueryOptions): void => {
  const scope = resolveFacilityScope(model, options?.skipFacilityScope);
  if (scope.mode === "skip") {return;}
  if (scope.mode === "deny" || !sameValue(instance?.[scope.key], scope.value)) {
    throw new Error("Security Violation: Attempted to destroy or restore a row outside the principal's client facility");
  }
};

/** Whether the options carry one of the two typed operations allowed to change a facility (AM-6). */
const facilityChangeAllowed = (options: QueryOptions | null | undefined): boolean =>
  Boolean(options?.facilityMove) || options?.facilityBinding === true;

const FACILITY_CHANGE_REFUSED = "Security Violation: A row's client facility changes only through a device move or a user binding";

/**
 * AM-6 — a row's facility changes only through the device move or the user binding. The bulk
 * twin of A-365's `refuseBulkTenantReassign`, but for EVERY context (unbound principals, the super
 * admin and system tasks too): an integrity rule, not a scope rule. Outside any context (the ETL,
 * migrations) nothing is checked here, as for every hook — the database triggers hold there.
 */
const refuseFacilityReassign = (options: QueryOptions, model: ScopedModel): void => {
  const key = facilityKeyOf(model);
  if (!key || !tenantStorage.getStore() || facilityChangeAllowed(options)) {return;}
  const values = options["attributes"];
  if (typeof values === "object" && values !== null && key in values) {
    throw new Error(FACILITY_CHANGE_REFUSED);
  }
};

/** A row that can say whether an attribute changed (a Sequelize instance). */
interface ChangeTracking {
  changed?: (key: string) => unknown;
}

/** The instance twin of `refuseFacilityReassign` (`beforeUpdate`: `save()` / `instance.update()`). */
const refuseFacilityChange = (instance: TenantRow | null | undefined, model: ScopedModel, options?: QueryOptions): void => {
  const key = facilityKeyOf(model);
  if (!key || !instance || !tenantStorage.getStore() || facilityChangeAllowed(options)) {return;}
  const tracking = instance as ChangeTracking;
  if (typeof tracking.changed === "function" && tracking.changed(key)) {
    throw new Error(FACILITY_CHANGE_REFUSED);
  }
};

/**
 * Options objects `beforeCount` has already scoped. `count` runs its hook and
 * then hands the SAME object to `this.aggregate`, so the aggregate wrapper
 * skips it instead of adding the predicate a second time.
 */
const scopedByCount = new WeakSet<object>();

/** Marks a model whose hookless statics are already wrapped. */
const WRAPPED = Symbol("tenantScope.hooklessStatics");

/**
 * W-34 — give the HOOKLESS statics of a tenant-scoped model the predicate a
 * find gets. In Sequelize 6.37.8 (`lib/model.js`):
 *
 *   - `aggregate` runs NO hook. `sum`, `min` and `max` are `this.aggregate(...)`
 *     and `count` is `beforeCount` + `this.aggregate(...)`.
 *   - static `increment` runs NO hook; `decrement` and the instance
 *     `increment`/`decrement` all end in `this.constructor.increment`/
 *     `this.increment`.
 *   - static `restore` runs `beforeBulkRestore` (registered below), and the
 *     instance `restore` runs `beforeRestore` — neither was registered.
 *
 * Wrapping `aggregate` and `increment` on the model therefore reaches every
 * one of those verbs. The predicate is resolved exactly as for a find
 * (`resolveScope`): `skipTenantScope: true` is the only opt-out; no context,
 * the super admin and a system task skip; no resolvable tenant denies.
 *
 * Both originals map attribute names to columns AFTER this wrapper runs
 * (`Utils.mapOptionFieldNames`), so the attribute name is correct here.
 */
const scopeHooklessStatics = (model: ScopedModel | null | undefined): void => {
  if (!model || !tenantKeyOf(model) || Object.prototype.hasOwnProperty.call(model, WRAPPED)) {return;}
  const { aggregate, increment } = model;

  Object.defineProperty(model, "aggregate", {
    configurable: true,
    writable: true,
    value: function scopedAggregate(this: ScopedModel, attribute: unknown, aggregateFunction: unknown, options?: QueryOptions): unknown {
      if (options && scopedByCount.has(options)) {
        return aggregate.call(this, attribute, aggregateFunction, options);
      }
      // A shallow copy: the caller's object is not mutated (aggregate deep-
      // clones it next anyway), and applyTenantWhere replaces `where`.
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built
      const scoped: QueryOptions = { ...(options || {}) };
      if (Array.isArray(scoped.include)) {scoped.include = [...(scoped.include as ScopedInclude[])];}
      applyTenantWhere(scoped, this);
      applyTenantToIncludes(scoped, this);
      // P21-09: the facility dimension, as a find gets it (FT-11, FT-17).
      applyFacilityWhere(scoped, this);
      applyFacilityToIncludes(scoped, this);
      return aggregate.call(this, attribute, aggregateFunction, scoped);
    },
  });

  Object.defineProperty(model, "increment", {
    configurable: true,
    writable: true,
    value: function scopedIncrement(this: ScopedModel, fields: unknown, options?: QueryOptions): unknown {
      // No `where`: Sequelize's own assertion refuses it. The predicate must
      // not turn a refused call into a tenant-wide update.
      if (!options?.where) {
        return increment.call(this, fields, options);
      }
      // `model` is tenant-scoped (checked above), and the wrapper is only on it.
      const key = tenantKeyOf(this) as string;
      const scope = resolveScope(options);
      // P21-09 (FT-18): the facility predicate is added beside the tenant one, as for a find.
      const facility = resolveFacilityScope(this, options.skipFacilityScope);
      if (scope.mode === "skip" && facility.mode === "skip") {
        return increment.call(this, fields, options);
      }
      let where: unknown = options.where;
      if (scope.mode !== "skip") {
        where = withTenantPredicate(where, key, scope.mode === "deny" ? NO_TENANT_UUID : scope.tenantId);
      }
      if (facility.mode !== "skip") {
        where = withTenantPredicate(where, facility.key, facility.value);
      }
      return increment.call(this, fields, { ...options, where });
    },
  });

  Object.defineProperty(model, WRAPPED, { value: true });
};

/** A Sequelize instance, as far as `register` uses it. */
interface HookedDatabase {
  models?: Record<string, ScopedModel> | null;
  addHook(name: string, fn: (this: ScopedModel, ...args: never[]) => void): unknown;
}

/** Register the isolation hooks on a Sequelize instance. */
const register = (db: HookedDatabase): void => {
  // W-34: the statics no hook reaches — on every model already defined, and
  // on every model defined from now on.
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built
  Object.values(db.models || {}).forEach(scopeHooklessStatics);
  db.addHook("afterDefine", (model: ScopedModel) => { scopeHooklessStatics(model); });
  // P21-09: every hook below also applies the facility dimension (spec § 7.4) — after the
  // tenant step; outside a bound context it does nothing but AM-6 (a facility changes only by a
  // move or a binding), which holds for every context.
  db.addHook("beforeFind", function (this: ScopedModel, options: QueryOptions) {
    applyTenantWhere(options, this);
    applyTenantToIncludes(options, this);
    applyFacilityWhere(options, this);
    applyFacilityToIncludes(options, this);
  });
  db.addHook("beforeCount", function (this: ScopedModel, options: QueryOptions) {
    applyTenantWhere(options, this);
    applyTenantToIncludes(options, this);
    applyFacilityWhere(options, this);
    applyFacilityToIncludes(options, this);
    scopedByCount.add(options);
  });
  db.addHook("beforeBulkUpdate", function (this: ScopedModel, options: QueryOptions) {
    refuseBulkTenantReassign(options, this);
    refuseFacilityReassign(options, this);
    applyTenantWhere(options, this);
    applyFacilityWhere(options, this);
  });
  db.addHook("beforeBulkDestroy", function (this: ScopedModel, options: QueryOptions) {
    refuseScopedTruncate(options, this);
    applyTenantWhere(options, this, { byField: true });
    applyFacilityWhere(options, this, { byField: true });
  });
  // W-34: `Model.restore` maps names to columns BEFORE this hook, exactly as
  // `destroy` does (W-33), so the predicate names the column.
  db.addHook("beforeBulkRestore", function (this: ScopedModel, options: QueryOptions) {
    applyTenantWhere(options, this, { byField: true });
    applyFacilityWhere(options, this, { byField: true });
  });
  db.addHook("beforeRestore", function (this: ScopedModel, instance: TenantRow, options: QueryOptions) {
    assertSameTenant(instance, this, options);
    assertSameFacility(instance, this, options);
  });
  db.addHook("beforeCreate", function (this: ScopedModel, instance: TenantRow, options: QueryOptions) {
    applyTenantAssignment(instance, this, options);
    applyFacilityAssignment(instance, this, options);
  });
  db.addHook("beforeBulkCreate", function (this: ScopedModel, instances: TenantRow[], options: QueryOptions) {
    applyTenantAssignmentBulk(instances, this, options);
    applyFacilityAssignmentBulk(instances, this, options);
  });
  db.addHook("beforeUpdate", function (this: ScopedModel, instance: TenantRow, options: QueryOptions) {
    applyTenantAssignment(instance, this, options);
    refuseFacilityChange(instance, this, options);
  });
  db.addHook("beforeUpsert", function (this: ScopedModel, values: TenantRow, options: QueryOptions) {
    assertUpsertTenant(values, this, options);
    assertUpsertFacility(values, this, options);
  });
  db.addHook("beforeDestroy", function (this: ScopedModel, instance: TenantRow, options: QueryOptions) {
    assertSameTenant(instance, this, options);
    assertSameFacility(instance, this, options);
  });
};

export {
  NO_TENANT_UUID,
  tenantKeyOf,
  resolveScope,
  applyTenantWhere,
  applyTenantToIncludes,
  applyTenantAssignment,
  applyTenantAssignmentBulk,
  assertUpsertTenant,
  assertSameTenant,
  scopeHooklessStatics,
  refuseScopedTruncate,
  refuseBulkTenantReassign,
  facilityKeyOf,
  resolveFacilityScope,
  applyFacilityWhere,
  applyFacilityToIncludes,
  applyFacilityAssignment,
  applyFacilityAssignmentBulk,
  assertUpsertFacility,
  assertSameFacility,
  refuseFacilityReassign,
  refuseFacilityChange,
  columnOf,
  register,
};
