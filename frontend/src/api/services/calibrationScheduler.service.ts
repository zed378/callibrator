// src/api/services/calibrationScheduler.service.ts
// P9-25 (ADR-103 item 11): on the GENERATED client; types from the contract
// (backend/src/routes/api/calibrationScheduler.openapi.ts).
import { typedApi, unwrap, type JsonBody, type Op, type components } from "../typed";

export type DueDevice = components["schemas"]["DueCalibrationDevice"];
export type RunSummary = components["schemas"]["CalibrationScanSummary"];
export type RunDetail = RunSummary["details"][number];

/** The look-ahead the UI asks for (`allTenants` a boolean; the query carries "true"). */
export interface GetDueParams {
  leadDays?: number;
  /** SUPERADMIN only */
  allTenants?: boolean;
}

export type RunSchedulerInput = JsonBody<Op<"/api/v1/calibration-scheduler/run", "post">>;

export const calibrationSchedulerService = {
  /**
   * Get devices due for calibration within the look-ahead window,
   * ordered by next calibration date. Returns a plain array (no pagination).
   */
  getDue: async (params?: GetDueParams): Promise<DueDevice[]> => {
    const response = await typedApi
      .GET("/api/v1/calibration-scheduler/due", {
        params: {
          query: {
            leadDays: params?.leadDays,
            allTenants: params?.allTenants ? "true" : undefined,
          },
        },
      })
      .then(unwrap);
    return Array.isArray(response.data) ? response.data : [];
  },

  /**
   * Run the calibration scheduler: creates Preventative work orders and
   * notifications for due devices. Idempotent — devices with already-open
   * work orders are skipped.
   */
  run: async (input?: RunSchedulerInput): Promise<RunSummary> => {
    const response = await typedApi
      .POST("/api/v1/calibration-scheduler/run", {
        body: {
          leadDays: input?.leadDays,
          allTenants: input?.allTenants || undefined,
          tenantId: input?.tenantId || undefined,
        },
      })
      .then(unwrap);
    return response.data;
  },
};

export default calibrationSchedulerService;
