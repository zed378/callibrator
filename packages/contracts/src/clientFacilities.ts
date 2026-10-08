/**
 * Client facilities — the contract of the facility dimension (P21-09; ADR-124 and its Amendments
 * 1–3; spec MEMORY/specs/P19-04-client-facilities.md § 7.2, § 10, § 13; P19-08 § 9.5, § 10).
 *
 * Holds:
 *  - the refusal codes an authenticated request carries as a TOP-LEVEL `code` when the account's
 *    facility no longer lets it in (§ 7.2), and the scope-loss tuple the PWA purges on (AM-1);
 *  - the canonical input of the scope fingerprint `POST /auth/verify` returns (AM-26) — the
 *    server hashes it with SHA-256 (hex); another runtime reproduces it from this function;
 *  - the request schemas of the facility administration and the user binding (§ 10.1, § 13.1).
 *
 * Imports nothing but `zod` and its siblings (both ends load it).
 */
import { z } from "zod";
import { CLIENT_FACILITY_KINDS, CLIENT_FACILITY_STATUSES } from "./states";
import { email, numeric, optionalText, uuid } from "./fields";
import { MAX_LIMIT } from "./pagination";

/**
 * Why an authenticated request is refused for its facility (403, top-level `code`) — spec § 7.2,
 * plus the route gate's refusal (§ 7.7). Frozen; the order is the spec's.
 */
export const FACILITY_REFUSAL_CODES = Object.freeze([
  "FACILITY_BINDING_PENDING",
  "FACILITY_UNRESOLVED",
  "FACILITY_INACTIVE",
  "FACILITY_ENDED",
  "FACILITY_ROUTE_REFUSED",
] as const);
export type FacilityRefusalCode = (typeof FACILITY_REFUSAL_CODES)[number];

/**
 * The 403 codes on which an offline client purges its working set and signs out (AM-1; P19-08
 * § 10, G-O5). The account and tenant codes are sent by P21-03; the facility codes by P21-09.
 * `FACILITY_ROUTE_REFUSED` is NOT one: it refuses one action, the account keeps its scope.
 */
export const SCOPE_LOSS_CODES = Object.freeze([
  "ACCOUNT_INACTIVE",
  "TENANT_SUSPENDED",
  "TENANT_DELETED",
  "FACILITY_INACTIVE",
  "FACILITY_ENDED",
  "FACILITY_BINDING_PENDING",
] as const);
export type ScopeLossCode = (typeof SCOPE_LOSS_CODES)[number];

/** Whether a response's top-level `code` means the account lost its scope. */
export const isScopeLossCode = (code: unknown): code is ScopeLossCode =>
  typeof code === "string" && (SCOPE_LOSS_CODES as readonly string[]).includes(code);

/**
 * `single`: the tenant has only its own (self) facility — the frontend hides every facility
 * concept, so a self-served hospital notices nothing. `multi`: it serves client facilities.
 */
export const FACILITY_MODES = Object.freeze(["single", "multi"] as const);
export type FacilityMode = (typeof FACILITY_MODES)[number];

/** The version tag that opens the fingerprint input; a change of the input's shape bumps it. */
export const SCOPE_FINGERPRINT_VERSION = "scope-fingerprint/v1";

/** What the scope fingerprint is computed from (AM-26; P19-08 § 9.5). */
export interface ScopeFingerprintParts {
  readonly tenantId: string | null;
  /** The bound facility, or null for an unbound principal. */
  readonly clientFacilityId: string | null;
  readonly roleId: string | null;
  /** The bound facility's status, or null for an unbound principal. */
  readonly facilityStatus: string | null;
}

/**
 * The canonical text the scope fingerprint hashes: the version, then each part on its own line —
 * a missing tenant / role as `-`, an unbound principal's facility as `unbound`, its status as `-`.
 * Lines, not a join of free text: no part can contain a newline (UUIDs and an ENUM).
 */
export const scopeFingerprintInput = (parts: ScopeFingerprintParts): string =>
  [
    SCOPE_FINGERPRINT_VERSION,
    parts.tenantId ?? "-",
    parts.clientFacilityId ?? "unbound",
    parts.roleId ?? "-",
    parts.facilityStatus ?? "-",
  ].join("\n");

// ==========================================
// FACILITY ADMINISTRATION (§ 13.1)
// ==========================================

/** `^[A-Z0-9][A-Z0-9._-]{0,31}$` after upper-casing (0117's CHECK). */
const FACILITY_CODE = /^[A-Z0-9][A-Z0-9._-]{0,31}$/;

/** A facility name as the database holds it: trimmed, inner whitespace collapsed (0117's CHECK). */
const facilityName = z
  .string()
  .transform((v) => v.replace(/\s+/g, " ").trim())
  .pipe(z.string().min(1).max(255));

/** A facility code, upper-cased; `SELF` is the self facility's and never accepted. */
const facilityCode = z
  .string()
  .trim()
  .transform((v) => v.toUpperCase())
  .pipe(z.string().regex(FACILITY_CODE).refine((v) => v !== "SELF", { error: "SELF is reserved for the tenant's own facility" }));

/** The organisational and contact fields both create and edit take. */
const facilityDetails = {
  kind: z.enum(CLIENT_FACILITY_KINDS).optional(),
  address: optionalText(500),
  city: optionalText(100),
  province: optionalText(100),
  postalCode: optionalText(20),
  phone: optionalText(50),
  contactName: optionalText(255),
  contactEmail: email().max(255).nullable().optional(),
  contactPhone: optionalText(50),
};

/** `POST /client-facilities` — never `isSelf`, `status`, `tenantId` (strict). */
export const clientFacilityCreate = z.strictObject({
  name: facilityName,
  code: facilityCode,
  ...facilityDetails,
});
export type ClientFacilityCreateInput = z.output<typeof clientFacilityCreate>;

/** `PATCH /client-facilities/:clientFacilityId` — partial, strict, at least one field. */
export const clientFacilityUpdate = z
  .strictObject({
    name: facilityName.optional(),
    code: facilityCode.optional(),
    ...facilityDetails,
  })
  .refine((v) => Object.keys(v).length > 0, { error: "Change at least one field" });
export type ClientFacilityUpdateInput = z.output<typeof clientFacilityUpdate>;

/** `POST /client-facilities/:clientFacilityId/status` (§ 4.4). */
export const clientFacilityStatusChange = z.strictObject({
  status: z.enum(CLIENT_FACILITY_STATUSES),
  reason: z.string().trim().min(3).max(500),
});
export type ClientFacilityStatusChangeInput = z.output<typeof clientFacilityStatusChange>;

/** The sort keys of the facility list; every order ends in `id` (the CI-3 tiebreaker). */
export const CLIENT_FACILITY_SORTS = Object.freeze(["name", "code", "createdAt"] as const);

/** `GET /client-facilities` (strict). */
export const clientFacilityListQuery = z.strictObject({
  page: numeric(z.number().int().min(1)).default(1),
  limit: numeric(z.number().int().min(1).max(MAX_LIMIT)).default(25),
  status: z.enum(CLIENT_FACILITY_STATUSES).optional(),
  kind: z.enum(CLIENT_FACILITY_KINDS).optional(),
  q: z.string().trim().min(1).max(100).optional(),
  sort: z.enum(CLIENT_FACILITY_SORTS).default("name"),
});
export type ClientFacilityListQueryInput = z.output<typeof clientFacilityListQuery>;

/** `:clientFacilityId`. */
export const clientFacilityIdParams = z.object({ clientFacilityId: uuid() });

/**
 * `PATCH /client-facilities/:clientFacilityId` as the route validates it — the path parameter and
 * the body together (`validate(schema, { from: ["params", "body"] })`, the path-parameter trap):
 * strict, at least one field besides the id. The body alone is `clientFacilityUpdate`.
 */
export const clientFacilityEdit = z
  .strictObject({
    clientFacilityId: uuid(),
    name: facilityName.optional(),
    code: facilityCode.optional(),
    ...facilityDetails,
  })
  .refine((v) => Object.keys(v).some((k) => k !== "clientFacilityId"), { error: "Change at least one field" });
export type ClientFacilityEditInput = z.output<typeof clientFacilityEdit>;

/** `POST /client-facilities/:clientFacilityId/status` as the route validates it (params + body). */
export const clientFacilityStatusRequest = clientFacilityStatusChange.extend({ clientFacilityId: uuid() });
export type ClientFacilityStatusRequestInput = z.output<typeof clientFacilityStatusRequest>;

// ==========================================
// USER BINDING (§ 10.1)
// ==========================================

/** `PUT /users/:userId/client-facility` — params and body together (`from: ["params", "body"]`). */
export const userFacilityBinding = z.strictObject({
  userId: uuid(),
  clientFacilityId: uuid().nullable(),
  roleId: uuid().optional(),
  reason: z.string().trim().min(3).max(500),
});
export type UserFacilityBindingInput = z.output<typeof userFacilityBinding>;

// ==========================================
// DEVICE MOVE (§ 11, P21-09d)
// ==========================================

/**
 * `POST /calibration-devices/:calibrationDeviceId/move` — params and body together
 * (`validate(schema, { from: ["params", "body"] })`). `targetLocationId`: a room of the target
 * facility or a provider store (P19-03 § 9, ADR-132 § 8); omitted, a room of the old facility is
 * cleared.
 */
export const deviceMove = z.strictObject({
  calibrationDeviceId: uuid(),
  targetClientFacilityId: uuid(),
  targetLocationId: uuid().nullable().optional(),
  reason: z.string().trim().min(3).max(500),
});
export type DeviceMoveInput = z.output<typeof deviceMove>;

/** `GET /calibration-devices/:calibrationDeviceId/moves`. */
export const deviceMovesParams = z.object({ calibrationDeviceId: uuid() });

/** The children a move carries, per table, and the files flagged for re-keying (`counts`). */
export const DEVICE_MOVE_COUNT_KEYS = Object.freeze([
  "calibration_records",
  "certificates",
  "maintenance_work_orders",
  "iot_readings",
  "non_conformances",
  "attachments_rekey",
] as const);
export type DeviceMoveCountKey = (typeof DEVICE_MOVE_COUNT_KEYS)[number];
