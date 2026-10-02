import apiClient from "../client";
import type { Answer, Op } from "../typed";

// Backend route: GET /api/v1/health — super admin only (403 otherwise).
// Shape: backend/src/controllers/health.controller.ts#readinessDetail over
// backend/src/services/health.service.js#buildReport.
//
// It answers 503 — WITH the breakdown in `data` — when a required dependency
// is down. That 503 is the most important answer this endpoint gives, so it is
// accepted as a response rather than thrown away as an error.

/** The backend's status vocabulary (health.service.js STATUS). */
// P9-25 (ADR-103 item 11): the report types are the contract's own
// (backend/src/routes/internal/health.openapi.ts). The call stays on
// `apiClient`: it accepts a 503 that carries the breakdown (`validateStatus`),
// an axios option the typed client's transport does not carry.
type ReadinessBreakdown = Answer<Op<"/api/v1/health", "get">>;
export type HealthReport = ReadinessBreakdown["data"];
export type DependencyReport = HealthReport["dependencies"][number];
export type DependencyStatus = DependencyReport["status"];
type HealthEnvelope = Omit<ReadinessBreakdown, "data"> & { data?: HealthReport | null };

const isHealthReport = (value: unknown): value is HealthReport => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<HealthReport>;
  return (
    (candidate.status === "healthy" || candidate.status === "unhealthy") &&
    Array.isArray(candidate.dependencies)
  );
};

export const healthService = {
  /**
   * Per-dependency breakdown. Resolves on 200 and 503; rejects on anything
   * else (403 for a non-super-admin, network failure), and rejects when the
   * body does not carry a breakdown — never invents one.
   */
  getDetail: async (): Promise<HealthReport> => {
    const response = await apiClient.get<HealthEnvelope>("/api/v1/health", {
      validateStatus: (status) => status === 200 || status === 503,
    });
    const report = response.data?.data;
    if (!isHealthReport(report)) {
      throw new Error("Health response did not include a dependency report");
    }
    return report;
  },
};
