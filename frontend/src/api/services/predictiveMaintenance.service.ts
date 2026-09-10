import { api } from "../client";

// ---------- Types ----------

export interface PredictiveAnalysisResult {
  status: "analyzed" | "skipped" | "unchanged";
  deviceId?: string;
  anomalyRate?: number;
  totalReadings?: number;
  currentInterval?: number;
  recommendedCalibrationInterval?: number | null;
  recommendationReason?: string | null;
}

export interface PredictiveRecommendation {
  id: string;
  name: string;
  serialNumber?: string;
  calibrationIntervalDays?: number;
  recommendedCalibrationInterval: number;
  recommendationReason?: string;
}

export interface ApproveRecommendationResult {
  deviceId: string;
  calibrationIntervalDays: number;
}

// Backend response envelope
interface BackendResponse<T> {
  success: boolean;
  status: number;
  message: string;
  data: T;
}

// ---------- Service ----------

export const predictiveMaintenanceService = {
  /**
   * Run IoT anomaly analysis for a device.
   * POST /api/v1/predictive-maintenance/analyze/:deviceId
   */
  analyzeDevice: async (deviceId: string): Promise<PredictiveAnalysisResult> => {
    const response = await api.post<BackendResponse<PredictiveAnalysisResult>>(
      `/api/v1/predictive-maintenance/analyze/${deviceId}`,
    );
    return response.data;
  },

  /**
   * List devices with a pending recommendation.
   * GET /api/v1/predictive-maintenance/recommendations
   */
  getRecommendations: async (): Promise<PredictiveRecommendation[]> => {
    const response = await api.get<BackendResponse<PredictiveRecommendation[]>>(
      "/api/v1/predictive-maintenance/recommendations",
    );
    return response.data;
  },

  /**
   * Approve (apply) a device's recommended calibration interval.
   * POST /api/v1/predictive-maintenance/recommendations/:deviceId/approve
   */
  approveRecommendation: async (
    deviceId: string,
  ): Promise<ApproveRecommendationResult> => {
    const response = await api.post<
      BackendResponse<ApproveRecommendationResult>
    >(`/api/v1/predictive-maintenance/recommendations/${deviceId}/approve`);
    return response.data;
  },
};

export default predictiveMaintenanceService;
