/**
 * P21-09e — the person beside a record, for every viewer (spec MEMORY/specs/P19-04-client-facilities.md
 * § 12, the A-90 sweep; ADR-124 Am. 2 § 9; G-24).
 *
 * Provider staff have no facility, so for a facility-BOUND viewer the hooks resolve every `User`
 * include of a provider author to null: no row disappears (every such include is
 * `required: false`, G-24's guard) but the author shows as nothing. Responses therefore carry an
 * additive `…Display` field (`@callibrator/contracts/people#personDisplay`):
 *
 *  - from a stored snapshot when the record has one (a signed certificate's `signedSnapshot`);
 *  - else from ONE batched read of the users through a reviewed `skipFacilityScope` (the tenant
 *    predicate is kept; `paranoid: false`, so a departed person still has a name): first and last
 *    name, the role's name, and as organisation the tenant's name for an unbound author or the
 *    author's facility's name for a bound one;
 *  - a user outside the tenant (the super admin acting inside it, A-90 / Q-17) is "Platform support";
 *  - REDACTED for a bound viewer when the author is bound to ANOTHER facility (history that came
 *    in with a device move): `{ name: null, role, organisation: null, redacted: true }`.
 *
 * Never an id, an e-mail, a phone or a username (FT-15); the opaque id columns stay in the payload
 * (an id resolves to nothing a bound user can reach, FT-16). Named exports only.
 */
import models from "../models";
import { tenantStorage } from "../middlewares/tenantContext.middleware";
import { PLATFORM_SUPPORT_NAME, type PersonDisplay } from "@callibrator/contracts/people";

interface AuthorRow {
  id: string;
  tenantId: string | null;
  firstName: string | null;
  lastName: string | null;
  clientFacilityId: string | null;
  role?: { name?: string | null } | null;
}

const fullName = (row: AuthorRow): string | null => {
  const name = [row.firstName, row.lastName].filter((p): p is string => typeof p === "string" && p.trim() !== "").join(" ").trim();
  return name === "" ? null : name;
};

const PLATFORM_SUPPORT: PersonDisplay = Object.freeze({ name: PLATFORM_SUPPORT_NAME, role: null, organisation: null, redacted: false });

/**
 * The display of each user id, read once.
 *
 * @param userIds - the person references of the rows to answer (nulls and repeats allowed)
 * @returns id → display (an id outside the tenant maps to "Platform support")
 */
export const displayPeople = async (userIds: readonly (string | null | undefined)[]): Promise<Map<string, PersonDisplay>> => {
  const ids = [...new Set(userIds.filter((id): id is string => typeof id === "string" && id !== ""))];
  const out = new Map<string, PersonDisplay>();
  if (ids.length === 0) {
    return out;
  }
  const ctx = tenantStorage.getStore();
  const viewerBound = Boolean(ctx && !ctx.isSuperAdmin && !ctx.isSystemTask && ctx.facilityBound === true);
  const viewerFacility = viewerBound ? (ctx?.clientFacilityId ?? null) : null;
  const authors = (await models.User.unscoped().findAll({
    where: { id: ids },
    attributes: ["id", "tenantId", "firstName", "lastName", "clientFacilityId"],
    include: [{ model: models.Roles, as: "role", attributes: ["name"], required: false }],
    paranoid: false,
    // skipFacilityScope: the author of a facility's record is usually provider staff (no facility)
    // or a person of another facility; the tenant predicate still applies (FACILITY_SCOPE_SKIPS).
    skipFacilityScope: true,
  })) as unknown as AuthorRow[];
  const facilityIds = [...new Set(authors.map((a) => a.clientFacilityId).filter((f): f is string => Boolean(f)))];
  const facilities = facilityIds.length
    ? ((await models.ClientFacility.findAll({
      where: { id: facilityIds },
      attributes: ["id", "name"],
      // skipFacilityScope: the author's facility NAME, never the viewer's readable rule (FACILITY_SCOPE_SKIPS).
      skipFacilityScope: true,
    })) as unknown as { id: string; name: string }[])
    : [];
  const facilityName = new Map(facilities.map((f) => [f.id, f.name]));
  const tenantIds = [...new Set(authors.map((a) => a.tenantId).filter((t): t is string => Boolean(t)))];
  const tenants = tenantIds.length
    ? ((await models.Tenant.findAll({ where: { id: tenantIds }, attributes: ["id", "name"] })) as unknown as { id: string; name: string }[])
    : [];
  const tenantName = new Map(tenants.map((t) => [t.id, t.name]));

  for (const author of authors) {
    const role = author.role?.name ?? null;
    if (viewerBound && author.clientFacilityId && author.clientFacilityId !== viewerFacility) {
      out.set(author.id, { name: null, role, organisation: null, redacted: true });
      continue;
    }
    const organisation = author.clientFacilityId
      ? (facilityName.get(author.clientFacilityId) ?? null)
      : (tenantName.get(author.tenantId ?? "") ?? null);
    out.set(author.id, { name: fullName(author), role, organisation, redacted: false });
  }
  for (const id of ids) {
    if (!out.has(id)) {
      out.set(id, PLATFORM_SUPPORT);
    }
  }
  return out;
};

/** A row as JSON (a model instance's `toJSON()`, or the object itself). */
const plain = (row: unknown): Record<string, unknown> => {
  const source = row as { toJSON?: () => unknown } | null;
  return (source && typeof source.toJSON === "function" ? source.toJSON() : { ...(row as object) }) as Record<string, unknown>;
};

/** `displayField` → the id field it shows, e.g. `{ performerDisplay: "performedBy" }`. */
export type DisplaySpec = Readonly<Record<string, string>>;

/** A snapshot source for a display field: the name a stored snapshot printed, if the row has one. */
export type SnapshotSource = (row: Record<string, unknown>, displayField: string) => PersonDisplay | null;

/**
 * The rows as JSON with each display field added (one batched read for all of them).
 *
 * @param rows - the rows to answer
 * @param spec - display field → id field
 * @param snapshot - a stored snapshot to prefer, per row and field
 * @returns the rows, plain, with the display fields
 */
export const withDisplays = async (
  rows: readonly unknown[],
  spec: DisplaySpec,
  snapshot?: SnapshotSource,
): Promise<Record<string, unknown>[]> => {
  const plainRows = rows.map(plain);
  const ids = plainRows.flatMap((row) => Object.values(spec).map((idField) => row[idField] as string | null | undefined));
  const people = await displayPeople(ids);
  return plainRows.map((row) => {
    const out = { ...row };
    for (const [displayField, idField] of Object.entries(spec)) {
      const id = row[idField];
      // displayPeople answers EVERY id it was given (a user outside the tenant as Platform support).
      out[displayField] = snapshot?.(row, displayField) ?? (typeof id === "string" ? people.get(id) : null);
    }
    return out;
  });
};

/**
 * A signed certificate shows the people it printed (ADR-107's `signedSnapshot`), never a later
 * rename; an unsigned one has no snapshot and falls through to the users' displays.
 */
export const certificateSnapshotDisplay: SnapshotSource = (row, displayField) => {
  const snapshot = row["signedSnapshot"] as
    | { issuer?: { name?: string | null } | null; calibratedBy?: string | null; approvedBy?: string | null; signedBy?: string | null }
    | null
    | undefined;
  if (!snapshot) {
    return null;
  }
  const field = displayField.replace(/Display$/, "") as "calibratedBy" | "approvedBy" | "signedBy";
  return { name: snapshot[field] ?? null, role: null, organisation: snapshot.issuer?.name ?? null, redacted: false };
};

/** One row with its display fields (see withDisplays). */
export const withDisplay = async (row: unknown, spec: DisplaySpec, snapshot?: SnapshotSource): Promise<Record<string, unknown>> =>
  (await withDisplays([row], spec, snapshot))[0] as Record<string, unknown>;
