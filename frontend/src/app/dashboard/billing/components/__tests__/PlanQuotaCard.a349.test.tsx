/** @jest-environment jsdom */
/**
 * A-349 — the plan-quota card against the contract's QuotaUsage
 * (backend/src/routes/api/quota.openapi.ts): `plan` and `status` are
 * nullable (tenants.plan/status have defaults but allow NULL). The card took
 * both as strings through a cast; it now takes the nullable value and shows
 * "-" for a NULL, with the neutral badge.
 */
import { render, screen } from "@testing-library/react";
import type { Quota } from "@/api/services/quota.service";

jest.mock("@/api/services/quota.service", () => ({
  quotaService: { getQuota: jest.fn() },
}));

import { quotaService } from "@/api/services/quota.service";
import { PlanQuotaCard } from "../PlanQuotaCard";

const getQuota = quotaService.getQuota as jest.Mock;

const quota = (over: Partial<Quota> = {}): Quota => ({
  plan: "professional",
  status: "active",
  features: ["calibration"],
  seats: { used: 12, limit: 50 },
  storage: { usedMb: 100, limitMb: null },
  ...over,
});

describe("PlanQuotaCard — nullable plan and status (A-349)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("shows the plan and status when the tenant has them", async () => {
    getQuota.mockResolvedValue(quota());
    render(<PlanQuotaCard />);
    expect(await screen.findByText("Professional")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("a NULL plan and status read '-', not an empty badge or a crash", async () => {
    getQuota.mockResolvedValue(quota({ plan: null, status: null }));
    render(<PlanQuotaCard />);
    expect(await screen.findByText("Plan & Usage")).toBeInTheDocument();
    expect(screen.getAllByText("-")).toHaveLength(2);
    expect(screen.getByText("Calibration")).toBeInTheDocument();
  });
});
