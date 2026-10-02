// src/api/services/device.service.ts
//
// P9-25 (ADR-103 item 11): on the GENERATED client. Every call is typed by
// `paths` (generated from backend/src/routes/api/calibrationDevices.openapi.ts);
// the device and the request bodies are the contract's, which replaced the
// interim `z.input` types (ADR-097 Am. 1). The names are unchanged. The CSV
// import stays on `api` (multipart).
import { api } from "../client";
import { typedApi, unwrap, type JsonBody, type Op, type components } from "../typed";
import { PaginatedResponse } from "@/types";

type S = components["schemas"];
type ById = "/api/v1/calibration-devices/{calibrationDeviceId}";

export type Device = S["CalibrationDevice"];
export type DeviceStatus = NonNullable<Device["status"]>;

export type DeviceCreateInput = JsonBody<Op<"/api/v1/calibration-devices", "post">>;

export type DeviceUpdateInput = JsonBody<Op<ById, "put">> & {
  id: string;
};

/**
 * The device form's state (DeviceModal / useDevices). A UI shape, not the
 * request contract: it must stay assignable to DeviceCreateInput, which the
 * typecheck enforces where the hook submits it.
 */
export interface DeviceFormState {
  name: string;
  serialNumber?: string;
  manufacturer?: string;
  model?: string;
  category?: string;
  status?: DeviceStatus;
  locationId?: string;
  installationDate?: string;
  nextCalibrationDate?: string;
  calibrationIntervalDays?: number;
  remarks?: string;
}

/**
 * The CSV import's report. A-358: a rejected row's `errors` is a message OR a
 * list of field errors; the devices page renders it as text, which throws on
 * the list. Kept as built.
 */
export type BulkImportResult = S["CalibrationDeviceImportReport"];

/** The older nested answer the list still accepts (`data.rows`, `data.meta`). */
interface NestedPage {
  rows: Device[];
  count: number;
  meta: { total: number; page: number; limit: number; totalPages: number };
}

const device = (calibrationDeviceId: string) => ({ params: { path: { calibrationDeviceId } } });

export const deviceService = {
  getAll: async (
    page = 1,
    limit = 20,
    find?: string,
    status?: string,
    category?: string,
  ): Promise<PaginatedResponse<Device>> => {
    const response = await typedApi
      .GET("/api/v1/calibration-devices", {
        // The page's filter select offers only the DeviceStatus values.
        params: { query: { page, limit, find, status: status as DeviceStatus | undefined, category } },
      })
      .then(unwrap);

    // Defensive: guard against a plain-array `data` or missing `meta`
    // so the UI never crashes reading `meta.total`.
    const payload = response?.data as NestedPage | Device[] | null | undefined;
    const rows: Device[] = Array.isArray(payload)
      ? payload
      : (payload?.rows ?? []);
    // House style puts pagination in a TOP-LEVEL `meta` (sibling of `data`),
    // not `data.meta` — read that first so `total`/`totalPages` are not lost.
    const meta =
      (response as { meta?: NestedPage["meta"] })?.meta ??
      (payload && !Array.isArray(payload) ? payload.meta : undefined);
    const total = meta?.total ?? rows.length;
    const lim = meta?.limit ?? limit;

    return {
      success: response?.success ?? true,
      message: response?.message ?? "",
      data: rows,
      meta: {
        total,
        page: meta?.page ?? page,
        limit: lim,
        totalPages: meta?.totalPages ?? Math.max(1, Math.ceil(total / lim)),
      },
    };
  },

  getById: async (id: string): Promise<Device> =>
    (await typedApi.GET("/api/v1/calibration-devices/{calibrationDeviceId}", device(id)).then(unwrap)).data,

  create: async (data: DeviceCreateInput): Promise<Device> =>
    (await typedApi.POST("/api/v1/calibration-devices", { body: data }).then(unwrap)).data,

  update: async (data: DeviceUpdateInput): Promise<Device> => {
    const { id, ...rest } = data;
    return (
      await typedApi.PUT("/api/v1/calibration-devices/{calibrationDeviceId}", { ...device(id), body: rest }).then(unwrap)
    ).data;
  },

  delete: async (id: string): Promise<void> => {
    await typedApi.DELETE("/api/v1/calibration-devices/{calibrationDeviceId}", device(id));
  },

  /**
   * Bulk-import calibration devices from a CSV file.
   * Backend route: POST /api/v1/calibration-devices/bulk-import (multipart)
   * The client interceptor strips Content-Type for FormData so the
   * browser sets the multipart boundary itself.
   */
  bulkImport: async (file: File): Promise<BulkImportResult> => {
    const formData = new FormData();
    formData.append("file", file);
    const response = await api.post<{ data: BulkImportResult }>("/api/v1/calibration-devices/bulk-import", formData);
    return response.data;
  },
};
