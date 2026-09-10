// src/api/services/calibrationScheduler.service.ts
import { api } from "../client";

export interface DueDevice {
  id: string;
  name: string;
  serialNumber?: string | null;
  tenantId: string;
  nextCalibrationDate: string;
  calibrationIntervalDays?: number | null;
  overdue: boolean;
}

export interface RunDetail {
  deviceId: string;
  action: "skipped" | "created" | "error";
  reason?: string;
  workOrderId?: string;
  overdue?: boolean;
  error?: string;
}

export interface RunSummary {
  scanned: number;
  workOrdersCreated: number;
  notificationsCreated: number;
  skipped: number;
  overdue: number;
  errors: number;
  details: RunDetail[];
}

export interface GetDueParams {
  leadDays?: number;
  /** SUPERADMIN only */
  allTenants?: boolean;
}

export interface RunSchedulerInput {
  leadDays?: number;
  /** SUPERADMIN only */
  allTenants?: boolean;
  /** SUPERADMIN only */
  tenantId?: string;
}

// Backend response envelopes
interface BackendDueDevicesResponse {
  success: boolean;
  status: number;
  message: string;
  data: DueDevice[] | null;
}

interface BackendRunResponse {
  success: boolean;
  status: number;
  message: string;
  data: RunSummary;
}

export const calibrationSchedulerService = {
  /**
   * Get devices due for calibration within the look-ahead window,
   * ordered by next calibration date. Returns a plain array (no pagination).
   */
  getDue: async (params?: GetDueParams): Promise<DueDevice[]> => {
    const response = await api.get<BackendDueDevicesResponse>(
      "/api/v1/calibration-scheduler/due",
      {
        params: {
          leadDays: params?.leadDays,
          allTenants: params?.allTenants || undefined,
        },
      },
    );
    return Array.isArray(response.data) ? response.data : [];
  },

  /**
   * Run the calibration scheduler: creates Preventative work orders and
   * notifications for due devices. Idempotent — devices with already-open
   * work orders are skipped.
   */
  run: async (input?: RunSchedulerInput): Promise<RunSummary> => {
    const response = await api.post<BackendRunResponse>(
      "/api/v1/calibration-scheduler/run",
      {
        leadDays: input?.leadDays,
        allTenants: input?.allTenants || undefined,
        tenantId: input?.tenantId || undefined,
      },
    );
    return response.data;
  },
};

export default calibrationSchedulerService;
