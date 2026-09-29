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
import type { TenantId } from "../types/ids";

/** An attribute definition, as far as this module reads it. */
interface AttributeDefinition {
  field?: string;
}

/** A Sequelize model, as far as this module reads it (private members included). */
export interface ScopedModel {
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
}

/** Query / hook options, as far as this module reads and writes them. */
export interface QueryOptions {
  skipTenantScope?: boolean;
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
const NO_TENANT_UUID = "00000000-0000-0000-0000-000000000000";

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
 * W-34 — `Model.destroy({ truncate: true })` becomes `TRUNCATE`, which has no
 * WHERE: the predicate `beforeBulkDestroy` adds is silently dropped and every
 * tenant's rows go. Inside a tenant (or deny) scope it is refused.
 */
const refuseScopedTruncate = (options: QueryOptions | null | undefined, model: ScopedModel): void => {
  if (!options?.truncate || !tenantKeyOf(model)) {return;}
  const scope = resolveScope(options);
  if (scope.mode === "skip") {return;}
  throw new Error("Security Violation: Attempted to truncate a tenant-scoped table inside a tenant context");
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
      if (scope.mode === "skip") {
        return increment.call(this, fields, options);
      }
      const value = scope.mode === "deny" ? NO_TENANT_UUID : scope.tenantId;
      return increment.call(this, fields, { ...options, where: withTenantPredicate(options.where, key, value) });
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
  db.addHook("beforeFind", function (this: ScopedModel, options: QueryOptions) {
    applyTenantWhere(options, this);
    applyTenantToIncludes(options, this);
  });
  db.addHook("beforeCount", function (this: ScopedModel, options: QueryOptions) {
    applyTenantWhere(options, this);
    applyTenantToIncludes(options, this);
    scopedByCount.add(options);
  });
  db.addHook("beforeBulkUpdate", function (this: ScopedModel, options: QueryOptions) {
    applyTenantWhere(options, this);
  });
  db.addHook("beforeBulkDestroy", function (this: ScopedModel, options: QueryOptions) {
    refuseScopedTruncate(options, this);
    applyTenantWhere(options, this, { byField: true });
  });
  // W-34: `Model.restore` maps names to columns BEFORE this hook, exactly as
  // `destroy` does (W-33), so the predicate names the column.
  db.addHook("beforeBulkRestore", function (this: ScopedModel, options: QueryOptions) {
    applyTenantWhere(options, this, { byField: true });
  });
  db.addHook("beforeRestore", function (this: ScopedModel, instance: TenantRow, options: QueryOptions) {
    assertSameTenant(instance, this, options);
  });
  db.addHook("beforeCreate", function (this: ScopedModel, instance: TenantRow, options: QueryOptions) {
    applyTenantAssignment(instance, this, options);
  });
  db.addHook("beforeBulkCreate", function (this: ScopedModel, instances: TenantRow[], options: QueryOptions) {
    applyTenantAssignmentBulk(instances, this, options);
  });
  db.addHook("beforeUpdate", function (this: ScopedModel, instance: TenantRow, options: QueryOptions) {
    applyTenantAssignment(instance, this, options);
  });
  db.addHook("beforeUpsert", function (this: ScopedModel, values: TenantRow, options: QueryOptions) {
    assertUpsertTenant(values, this, options);
  });
  db.addHook("beforeDestroy", function (this: ScopedModel, instance: TenantRow, options: QueryOptions) {
    assertSameTenant(instance, this, options);
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
  register,
};
