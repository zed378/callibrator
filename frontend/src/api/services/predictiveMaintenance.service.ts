// src/api/services/predictiveMaintenance.service.ts
//
// P9-25 (ADR-103 item 11): on the GENERATED client. The calls and the types are
// read off `paths` (src/api/generated/schema.d.ts, `npm run api:types`, from
// backend/src/routes/api/predictiveMaintenance.openapi.ts); the exported names are unchanged, so
// no caller changed.
import { typedApi, unwrap, type DataOf, type Op, type components } from "../typed";

// ---------- Types ----------

export type PredictiveAnalysisResult = components["schemas"]["PredictiveDeviceAnalysis"];
export type PredictiveRecommendation = components["schemas"]["CalibrationIntervalRecommendation"];
export type ApproveRecommendationResult = DataOf<
  Op<"/api/v1/predictive-maintenance/recommendations/{deviceId}/approve", "post">
>;

// ---------- Service ----------

export const predictiveMaintenanceService = {
  /**
   * Run IoT anomaly analysis for a device.
   * POST /api/v1/predictive-maintenance/analyze/:deviceId
   */
  analyzeDevice: async (deviceId: string): Promise<PredictiveAnalysisResult> => {
    const response = await typedApi
      .POST("/api/v1/predictive-maintenance/analyze/{deviceId}", { params: { path: { deviceId } } })
      .then(unwrap);
    return response.data;
  },

  /**
   * List devices with a pending recommendation.
   * GET /api/v1/predictive-maintenance/recommendations
   */
  getRecommendations: async (): Promise<PredictiveRecommendation[]> => {
    const response = await typedApi.GET("/api/v1/predictive-maintenance/recommendations").then(unwrap);
    return response.data;
  },

  /**
   * Approve (apply) a device's recommended calibration interval.
   * POST /api/v1/predictive-maintenance/recommendations/:deviceId/approve
   */
  approveRecommendation: async (deviceId: string): Promise<ApproveRecommendationResult> => {
    const response = await typedApi
      .POST("/api/v1/predictive-maintenance/recommendations/{deviceId}/approve", { params: { path: { deviceId } } })
      .then(unwrap);
    return response.data;
  },
};

export default predictiveMaintenanceService;
