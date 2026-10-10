import { api } from "../client";
import { typedApi, unwrap, type DataOf, type JsonBody, type Op, type QueryOf, type components } from "../typed";

/**
 * P22-02 — the device register (`dashboard/devices`; P19-03 spec § 4 – § 8, as built by P21-02a and
 * P21-02b; ADR-132 Am. 2, Am. 3). Every JSON call is on the GENERATED client; the two multipart
 * calls (the CSV import and a photo upload) go through `api` with a FormData body, as
 * `device.service#bulkImport` did, their paths and answers typed off `paths`.
 *
 *  - `GET /calibration-devices` — the register's list with the P21-02a filters (`qrCode`,
 *    `deviceTypeId`, `condition`, `clientFacilityId`, `calibrationDue`, …); rows in `data`, paging
 *    in the TOP-LEVEL `meta`.
 *  - `POST /calibration-devices` / `PUT /:id` — the contract is chosen by the principal's binding
 *    on the server (strict for a bound technician: no QR, status or laboratory — the form never
 *    sends them for one). A taken QR is 409 `DEVICE_QR_TAKEN` naming its holder; an ended facility
 *    409 `DEVICE_FACILITY_ENDED`.
 *  - `POST /calibration-devices/:id/photos` (multipart `file` + `purpose`) — JPEG or PNG by
 *    content; HEIC is refused 415 `PHOTO_HEIC_UNSUPPORTED` (the browser converts first,
 *    `lib/photoPrep`); a front or serial-plate photo replaces the live one.
 *  - `DELETE /calibration-devices/:id/photos/:attachmentId`.
 *  - `POST /attachments/:id/signed-url { variant: "thumb" }` — a short-lived link to a
 *    metadata-free thumbnail; never a permanent URL.
 */

type S = components["schemas"];
type ById = "/api/v1/calibration-devices/{calibrationDeviceId}";
type PhotosPath = "/api/v1/calibration-devices/{calibrationDeviceId}/photos";

export type RegisterDevice = S["CalibrationDevice"];
export type DeviceListQuery = QueryOf<Op<"/api/v1/calibration-devices", "get">>;
export type DeviceCreateBody = JsonBody<Op<"/api/v1/calibration-devices", "post">>;
export type DeviceUpdateBody = JsonBody<Op<ById, "put">>;
export type DevicePhoto = DataOf<Op<PhotosPath, "post">>;
export type DevicePhotoPurpose = DevicePhoto["purpose"];
export type ImportReport = S["CalibrationDeviceImportReport"];
export type StoreLocation = S["Warehouse"];
export type DeviceTypeOption = S["DeviceType"];
export type PageMeta = S["PaginationMeta"];

/** One page of a list: the rows, and the paging the envelope carried beside them. */
export interface Paged<T> {
  rows: T[];
  meta: PageMeta;
}

/** A list row is a full device unless `view=field` was asked for; this page never asks for it. */
const isDevice = (row: unknown): row is RegisterDevice =>
  typeof row === "object" && row !== null && "tenantId" in row && "status" in row;

const PHOTOS_PATH = (id: string): string => `/api/v1/calibration-devices/${encodeURIComponent(id)}/photos`;

export const deviceRegisterService = {
  /** One page of the register. */
  list: async (query: DeviceListQuery): Promise<Paged<RegisterDevice>> => {
    const answer = await typedApi.GET("/api/v1/calibration-devices", { params: { query } }).then(unwrap);
    const rows = (answer.data ?? []).filter(isDevice);
    const page = query.page ?? 1;
    return { rows, meta: answer.meta ?? { total: rows.length, page, limit: rows.length, totalPages: 1 } };
  },

  /** One device, as `GET /:id` answers it (the facts included). */
  get: async (calibrationDeviceId: string): Promise<RegisterDevice> =>
    (await typedApi.GET("/api/v1/calibration-devices/{calibrationDeviceId}", { params: { path: { calibrationDeviceId } } }).then(unwrap))
      .data,

  create: async (body: DeviceCreateBody): Promise<RegisterDevice> =>
    (await typedApi.POST("/api/v1/calibration-devices", { body }).then(unwrap)).data,

  update: async (calibrationDeviceId: string, body: DeviceUpdateBody): Promise<RegisterDevice> =>
    (
      await typedApi
        .PUT("/api/v1/calibration-devices/{calibrationDeviceId}", { params: { path: { calibrationDeviceId } }, body })
        .then(unwrap)
    ).data,

  remove: async (calibrationDeviceId: string): Promise<void> => {
    await typedApi.DELETE("/api/v1/calibration-devices/{calibrationDeviceId}", { params: { path: { calibrationDeviceId } } });
  },

  /** The CSV import (multipart). */
  bulkImport: async (file: File): Promise<ImportReport> => {
    const form = new FormData();
    form.append("file", file);
    const answer = await api.post<{ data: ImportReport }>("/api/v1/calibration-devices/bulk-import", form);
    return answer.data;
  },

  /** A register photo (multipart): the browser has already made it a JPEG (`lib/photoPrep`). */
  uploadPhoto: async (calibrationDeviceId: string, purpose: DevicePhotoPurpose, file: File): Promise<DevicePhoto> => {
    const form = new FormData();
    form.append("purpose", purpose);
    form.append("file", file);
    const answer = await api.post<{ data: DevicePhoto }>(PHOTOS_PATH(calibrationDeviceId), form);
    return answer.data;
  },

  deletePhoto: async (calibrationDeviceId: string, attachmentId: string): Promise<void> => {
    await typedApi.DELETE("/api/v1/calibration-devices/{calibrationDeviceId}/photos/{attachmentId}", {
      params: { path: { calibrationDeviceId, attachmentId } },
    });
  },

  /**
   * A short-lived link to a photo's metadata-free derivative (`thumb` for a list, `display` to view
   * it), as a SAME-ORIGIN path: the server mints it on its public base URL, and the page's CSP
   * (`img-src 'self'`) loads it through the `/api` proxy whatever that base is.
   */
  photoLink: async (attachmentId: string, variant: "thumb" | "display"): Promise<string> => {
    const { url } = (
      await typedApi.POST("/api/v1/attachments/{id}/signed-url", { params: { path: { id: attachmentId } }, body: { variant } }).then(unwrap)
    ).data;
    const parsed = new URL(url, "http://same-origin.invalid");
    return `${parsed.pathname}${parsed.search}`;
  },

  /** The tenant's stores (a device may stand in a store — a workshop or a depot; provider staff only). */
  stores: async (): Promise<StoreLocation[]> =>
    (await typedApi.GET("/api/v1/warehouses", { params: { query: { kind: "store", page: 1, limit: 100 } } }).then(unwrap)).data ?? [],

  /** Active device types whose name contains `search` (the form's picker; the first 50). */
  deviceTypes: async (search?: string): Promise<DeviceTypeOption[]> =>
    (
      await typedApi
        .GET("/api/v1/device-types", { params: { query: { status: "active", page: 1, limit: 50, ...(search ? { search } : {}) } } })
        .then(unwrap)
    ).data ?? [],
};
