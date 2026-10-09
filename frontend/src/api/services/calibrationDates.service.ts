import { typedApi, unwrap, type DataOf, type JsonBody, type Op, type QueryOf, type components } from "../typed";

/**
 * P22-05 — the quick calibration-date entry and the calibration list (P19-05 spec § 7, § 8;
 * P21-05, P21-06; ADR-133 Am. 2, Am. 3). Every call is on the GENERATED client.
 *
 *  - `GET /calibration-devices/by-qr/:qrCode` — the sticker normalised by the server, looked up in
 *    the caller's context; every miss (unknown, deleted, another facility's, another tenant's) is the
 *    same 404, and a value that is no QR is a 400. Facility-accessible.
 *  - `POST /calibration-devices/:id/calibration-dates` — `calibration` write; refused to a
 *    facility-bound account (N-10) and to the platform tenant (A-127). 201: the record, the device's
 *    re-derived next date, `notices` (a same-day entry). 409 `CALIBRATION_DEVICE_RETIRED` /
 *    `CALIBRATION_FACILITY_ENDED` carry their state explanation in `message`.
 *  - `GET /calibration-records` — the recap read: `latestOnly`, `entryKind`, `dateField` with
 *    `fromDay` / `toDay` (days of the tenant's zone), `qrCode`, `clientFacilityId`, `limit` ≤ 200.
 *  - `GET /vendors?type=CalibrationLab` — the laboratories (`vendors` read).
 *
 * Lists answer the house envelope: rows in `data`, paging in a TOP-LEVEL `meta`.
 */

type S = components["schemas"];

export type Device = S["CalibrationDevice"];
export type CalibrationRecord = S["CalibrationRecord"];
export type ExternalCalibrationRecord = DataOf<Op<"/api/v1/calibration-devices/{calibrationDeviceId}/calibration-dates", "post">>;
export type CalibrationDateBody = JsonBody<Op<"/api/v1/calibration-devices/{calibrationDeviceId}/calibration-dates", "post">>;
export type RecordQuery = QueryOf<Op<"/api/v1/calibration-records", "get">>;
export type PageMeta = S["PaginationMeta"];
export type Laboratory = S["Vendor"];

/** One page of a list: the rows, and the paging the envelope carried beside them. */
export interface Paged<T> {
  rows: T[];
  meta: PageMeta;
}

/** The rows in `data` and the top-level `meta`; a missing `meta` reads as one page of what came. */
const paged = <T>(answer: { data: T[] | null; meta?: PageMeta | null }, page = 1): Paged<T> => {
  const rows = answer.data ?? [];
  return { rows, meta: answer.meta ?? { total: rows.length, page, limit: rows.length, totalPages: 1 } };
};

export const calibrationDatesService = {
  /** The device a sticker names, as `GET /calibration-devices/:id` answers it. */
  findDeviceByQr: async (qrCode: string): Promise<Device> =>
    (await typedApi.GET("/api/v1/calibration-devices/by-qr/{qrCode}", { params: { path: { qrCode } } }).then(unwrap)).data,

  /** Records an outside laboratory's calibration by its date: no file, no results; history kept. */
  recordDate: async (calibrationDeviceId: string, body: CalibrationDateBody): Promise<ExternalCalibrationRecord> =>
    (
      await typedApi
        .POST("/api/v1/calibration-devices/{calibrationDeviceId}/calibration-dates", { params: { path: { calibrationDeviceId } }, body })
        .then(unwrap)
    ).data,

  /** One page of calibration records (the recap read). */
  listRecords: async (query: RecordQuery = {}): Promise<Paged<CalibrationRecord>> =>
    paged(await typedApi.GET("/api/v1/calibration-records", { params: { query } }).then(unwrap), query.page),

  /**
   * How many effective quick entries the device already has on that day (the tenant's zone): the
   * form's soft duplicate warning before saving (spec § 7.3 — history is never refused).
   */
  sameDayEntries: async (deviceId: string, day: string): Promise<number> => {
    const answer = await typedApi
      .GET("/api/v1/calibration-records", {
        params: { query: { deviceId, fromDay: day, toDay: day, entryKind: "external_date", page: 1, limit: 1 } },
      })
      .then(unwrap);
    return answer.meta?.total ?? answer.data?.length ?? 0;
  },

  /** Active calibration laboratories whose name contains `find` (the first 50). */
  laboratories: async (find?: string): Promise<Laboratory[]> =>
    (
      await typedApi
        .GET("/api/v1/vendors", {
          params: { query: { type: "CalibrationLab", status: "Active", page: 1, limit: 50, ...(find ? { find } : {}) } },
        })
        .then(unwrap)
    ).data ?? [],
};
