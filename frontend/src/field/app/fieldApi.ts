/**
 * P22-10c1 — the reads and the one write the field app makes OUTSIDE the sync engine (P19-08 § 7.2,
 * § 11.3): who am I, the facilities, the working-set size and pages, the rooms, the catalogue with
 * its `ETag`, and the administrator wipe's record.
 *
 * Every call goes through the typed client (`typedApi` over `api`: refresh-once, the gate
 * redirects, the normalised error), so a path, query or body the backend does not publish is a
 * compile error. The ONE exception is the catalogue: it needs `If-None-Match` sent and `ETag` / 304
 * read, which the typed client does not expose, so it goes through the same axios instance
 * (`apiClient`, the same interceptors) — as the engine's transport does (P22-10b).
 *
 * Rows are read from `data` and the total from the top-level `meta` (the house envelope).
 */
import type { AxiosInstance } from "axios";
import { describeApiError } from "@/api/client";
import { typedApi, unwrap } from "@/api/typed";
import { DEVICE_CONFLICT_CODES, FIELD_DEVICE_SUMMARY_KEYS } from "@callibrator/contracts/deviceValues";

/** The signed-in user as the field app needs it (from `POST /auth/verify`). */
export interface FieldUser {
  readonly id: string;
  readonly tenantId: string;
  readonly roleName: string | null;
  readonly roleLevel: number;
  /** The bound facility, or null for an unbound (provider) user. */
  readonly clientFacilityId: string | null;
  readonly scopeFingerprint: string;
}

export interface FieldFacility {
  readonly id: string;
  readonly name: string;
  readonly code: string;
  readonly status: string;
}

/** One `fieldDeviceSummary` row (P19-08 § 7.2), exactly the contract's keys. */
export interface FieldDevice {
  readonly id: string;
  readonly clientFacilityId: string | null;
  readonly name: string;
  readonly manufacturer: string | null;
  readonly model: string | null;
  readonly serialNumber: string | null;
  readonly qrCode: string | null;
  readonly deviceTypeId: string | null;
  readonly status: string | null;
  readonly condition: string | null;
  readonly locationId: string | null;
  readonly ipmIntervalMonths: number | null;
  readonly ipmDue: unknown;
  readonly lastIpm: { readonly performedAt: string; readonly visitNumber: number } | null;
  readonly calibrationDue: unknown;
  readonly photosComplete: boolean | null;
  readonly openIpmDraftId: string | null;
  readonly updatedAt: string | null;
}

export interface FieldRoom {
  readonly id: string;
  readonly name: string;
}

export interface SubmittedVisit {
  readonly id: string;
  readonly deviceId: string;
  readonly performedAt: string | null;
  readonly visitNumber: number | null;
}

/** The size of a facility's working set, read BEFORE downloading it. */
export type FacilitySize = { readonly ok: true; readonly total: number } | { readonly ok: false; readonly tooLarge: true; readonly message: string };

export type CatalogueRead = { readonly notModified: true } | { readonly notModified: false; readonly etag: string | null; readonly document: unknown };

export interface FieldApi {
  whoAmI(): Promise<FieldUser>;
  /** A bound user's own facility; an unbound user's facility options. */
  facilities(user: FieldUser): Promise<FieldFacility[]>;
  facilitySize(facilityId: string): Promise<FacilitySize>;
  devicePage(facilityId: string, page: number, limit: number): Promise<{ rows: FieldDevice[]; total: number }>;
  /** A facility's rooms (`kind=room&clientFacilityId=`, ADR-127 Am. 5 — the filter the backend added). */
  rooms(facilityId: string): Promise<FieldRoom[]>;
  catalogue(etag: string | null): Promise<CatalogueRead>;
  /** Online QR lookup (`GET /calibration-devices/by-qr/:qrCode`, the same 404 everywhere): the row cut to the field keys, or null. */
  byQr(code: string): Promise<FieldDevice | null>;
  /** The user's submitted visits still without the performer's signature, newest first (the "to sign" list; signing is the report page's, online). */
  submitted(userId: string): Promise<SubmittedVisit[]>;
  /** `POST /field/wipes`: the audit row of an administrator wipe (sent BEFORE the deletion, ADR-135). */
  recordWipe(wipedUserId: string, captures: number, photos: number): Promise<void>;
}

const rec = (v: unknown): Record<string, unknown> => (v !== null && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** A `view=field` row reduced to exactly the contract's keys (anything else the server sent is dropped). */
export const toFieldDevice = (row: unknown): FieldDevice => {
  const r = rec(row);
  const out: Record<string, unknown> = {};
  for (const k of FIELD_DEVICE_SUMMARY_KEYS) out[k] = r[k] ?? null;
  return out as unknown as FieldDevice;
};

const totalOf = (body: unknown, fallback: number): number => {
  const total = rec(rec(body)["meta"])["total"];
  return typeof total === "number" ? total : fallback;
};

export function createFieldApi(client: AxiosInstance): FieldApi {
  return {
    async whoAmI() {
      const body = await typedApi.POST("/api/v1/auth/verify", { body: {} as never }).then(unwrap);
      const d = rec(rec(body)["data"]);
      const role = rec(d["role"]);
      const id = str(d["id"]);
      const tenantId = str(d["tenantId"]);
      const scopeFingerprint = str(d["scopeFingerprint"]);
      if (!id || !tenantId || !scopeFingerprint) throw new Error("The session did not name its user");
      return {
        id,
        tenantId,
        roleName: str(role["name"]),
        roleLevel: typeof role["roleLevel"] === "number" ? role["roleLevel"] : 0,
        clientFacilityId: str(d["clientFacilityId"]),
        scopeFingerprint,
      };
    },

    async facilities(user) {
      if (user.clientFacilityId !== null) {
        const mine = (await typedApi.GET("/api/v1/client-facilities/mine").then(unwrap)).data;
        return mine ? [{ id: mine.id, name: mine.name, code: mine.code, status: mine.status }] : [];
      }
      const options = (await typedApi.GET("/api/v1/client-facilities/options").then(unwrap)).data;
      return options.map((o) => ({ id: o.id, name: o.name, code: o.code, status: o.status }));
    },

    async facilitySize(facilityId) {
      try {
        const body = await typedApi
          .GET("/api/v1/calibration-devices", { params: { query: { clientFacilityId: facilityId, view: "field", page: 1, limit: 1, sort: "id" } } })
          .then(unwrap);
        return { ok: true, total: totalOf(body, body.data.length) };
      } catch (err) {
        const e = describeApiError(err);
        if (e.status === 400 && e.code === DEVICE_CONFLICT_CODES.workingSetTooLarge) return { ok: false, tooLarge: true, message: e.message };
        throw err;
      }
    },

    async devicePage(facilityId, page, limit) {
      const body = await typedApi
        .GET("/api/v1/calibration-devices", { params: { query: { clientFacilityId: facilityId, view: "field", page, limit, sort: "id" } } })
        .then(unwrap);
      return { rows: body.data.map(toFieldDevice), total: totalOf(body, body.data.length) };
    },

    async rooms(facilityId) {
      const rows: FieldRoom[] = [];
      for (let page = 1; ; page += 1) {
        const body = await typedApi.GET("/api/v1/warehouses", { params: { query: { kind: "room", clientFacilityId: facilityId, page, limit: 100 } } }).then(unwrap);
        for (const w of body.data) rows.push({ id: w.id, name: w.name });
        if (body.data.length < 100 || rows.length >= totalOf(body, rows.length)) return rows;
      }
    },

    async catalogue(etag) {
      const response = await client.request({
        method: "GET",
        url: "/api/v1/ipm/templates/published",
        headers: { "X-Field-Client": "1", ...(etag ? { "If-None-Match": etag } : {}) },
        validateStatus: (s) => (s >= 200 && s < 300) || s === 304,
      });
      if (response.status === 304) return { notModified: true };
      const h = rec(response.headers);
      return { notModified: false, etag: str(h["etag"]), document: rec(response.data)["data"] ?? null };
    },

    async byQr(code) {
      try {
        const body = await typedApi.GET("/api/v1/calibration-devices/by-qr/{qrCode}", { params: { path: { qrCode: code } } }).then(unwrap);
        return toFieldDevice(body.data);
      } catch (err) {
        if (describeApiError(err).status === 404) return null;
        throw err;
      }
    },

    async submitted(userId) {
      const body = await typedApi
        .GET("/api/v1/ipm/sessions", { params: { query: { performedBy: userId, status: "submitted", unsigned: true, sort: "performedAt", page: 1, limit: 20 } } })
        .then(unwrap);
      return body.data.map((s) => {
        const r = rec(s);
        return { id: String(r["id"]), deviceId: String(r["deviceId"]), performedAt: str(r["performedAt"]), visitNumber: typeof r["visitNumber"] === "number" ? r["visitNumber"] : null };
      });
    },

    async recordWipe(wipedUserId, captures, photos) {
      await typedApi.POST("/api/v1/field/wipes", { body: { wipedUserId, captures, photos } });
    },
  };
}
