/**
 * P22-09 — the facility administration as plain data (P19-04 § 4.4 – § 4.6): the form's state, the
 * create body and the edit body (only what changed — a cleared field sent as null), checked with
 * the CONTRACTS the routes validate with (`clientFacilityCreate`, `clientFacilityUpdate`), so a
 * reserved code (`SELF`), a malformed code or e-mail is said before the round trip; the status
 * transitions the page offers; the list's query.
 */
import { clientFacilityCreate, clientFacilityUpdate } from "@callibrator/contracts/clientFacilities";
import { CLIENT_FACILITY_KINDS, CLIENT_FACILITY_STATUSES } from "@callibrator/contracts/states";
import type { ClientFacility, FacilityCreateBody, FacilityEditBody, FacilityListQuery } from "@/api/services/clientFacility.service";

export const KINDS = CLIENT_FACILITY_KINDS;
export const STATUSES = CLIENT_FACILITY_STATUSES;
export type Kind = (typeof KINDS)[number];
export type Status = (typeof STATUSES)[number];

export const PAGE_SIZE = 25;
export const REASON_MIN = 3;

export interface FacilityForm {
  name: string;
  code: string;
  kind: Kind;
  address: string;
  city: string;
  province: string;
  postalCode: string;
  phone: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
}

const TEXT_FIELDS = ["address", "city", "province", "postalCode", "phone", "contactName", "contactEmail", "contactPhone"] as const;

export const emptyForm = (): FacilityForm => ({
  name: "",
  code: "",
  kind: "hospital",
  address: "",
  city: "",
  province: "",
  postalCode: "",
  phone: "",
  contactName: "",
  contactEmail: "",
  contactPhone: "",
});

export const formOf = (f: ClientFacility): FacilityForm => ({
  name: f.name,
  code: f.code,
  kind: f.kind,
  address: f.address ?? "",
  city: f.city ?? "",
  province: f.province ?? "",
  postalCode: f.postalCode ?? "",
  phone: f.phone ?? "",
  contactName: f.contactName ?? "",
  contactEmail: f.contactEmail ?? "",
  contactPhone: f.contactPhone ?? "",
});

const text = (v: string): string | null => (v.trim() === "" ? null : v.trim());

/** The create body: blank optionals left out. */
export const createBody = (f: FacilityForm): FacilityCreateBody => {
  const body: FacilityCreateBody = { name: f.name.trim(), code: f.code.trim(), kind: f.kind };
  for (const key of TEXT_FIELDS) {
    const v = text(f[key]);
    if (v !== null) body[key] = v;
  }
  return body;
};

/** The edit body: only the fields that changed; a cleared one is null. */
export const editBody = (f: FacilityForm, before: FacilityForm): FacilityEditBody => {
  const body: FacilityEditBody = {};
  if (f.name.trim() !== before.name.trim()) body.name = f.name.trim();
  if (f.code.trim().toUpperCase() !== before.code.trim().toUpperCase()) body.code = f.code.trim();
  if (f.kind !== before.kind) body.kind = f.kind;
  for (const key of TEXT_FIELDS) {
    if (f[key].trim() !== before[key].trim()) body[key] = text(f[key]);
  }
  return body;
};

/** The contract's problems with the body (field → message), or none. */
export const problemsOf = (body: FacilityCreateBody | FacilityEditBody, creating: boolean): Record<string, string> => {
  const parsed = creating ? clientFacilityCreate.safeParse(body) : clientFacilityUpdate.safeParse(body);
  if (parsed.success) return {};
  const out: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const key = String(issue.path[0] ?? "form");
    out[key] ??= issue.message;
  }
  return out;
};

/** The statuses a facility can be moved to from its own (never to itself). */
export const nextStatuses = (current: Status): Status[] => STATUSES.filter((s) => s !== current);

/** The list's query for a page: only what is set is sent. */
export const listQuery = (f: { q: string; status: "" | Status; kind: "" | Kind }, page: number): FacilityListQuery => ({
  page,
  limit: PAGE_SIZE,
  sort: "name",
  ...(f.q.trim() ? { q: f.q.trim() } : {}),
  ...(f.status ? { status: f.status } : {}),
  ...(f.kind ? { kind: f.kind } : {}),
});

/** A reason the routes accept (trimmed, 3 – 500). */
export const reasonValid = (reason: string): boolean => {
  const n = reason.trim().length;
  return n >= REASON_MIN && n <= 500;
};
