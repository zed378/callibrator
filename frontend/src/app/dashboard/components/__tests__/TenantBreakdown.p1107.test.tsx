/** @jest-environment jsdom */
/**
 * P11-07: the super admin's tenant breakdown. The browser sweep at 360 px
 * (automate/p11.browser.mts) found its sideways-scrolling table unreachable by
 * keyboard (axe scrollable-region-focusable, WCAG 2.1.1) — fail-before: the
 * wrapper had no tabindex. Its status is a registry tone (P11-05).
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { TenantBreakdown } from "../TenantBreakdown";
import type { TenantBreakdownRow } from "@/api/services/dashboard.service";
import { axeViolations } from "@/tests/a11y/axe";

const rows = [
  { tenantId: "t1", name: "RS Harapan", code: "RSH", status: "active", users: 3, devices: 9 },
  { tenantId: "t2", name: "RS Sehat", code: "RSS", status: "suspended", users: 1, devices: 2 },
] as unknown as TenantBreakdownRow[];

describe("TenantBreakdown (P11-07)", () => {
  it("the scrolling table is a named, focusable region; statuses carry their tone", async () => {
    const { container } = render(<TenantBreakdown rows={rows} />);
    const region = screen.getByRole("region", { name: "Tenant breakdown" });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(screen.getByText("active").closest("[data-tone]")).toHaveAttribute("data-tone", "current");
    expect(screen.getByText("suspended").closest("[data-tone]")).toHaveAttribute("data-tone", "attention");
    expect(await axeViolations(container)).toEqual([]);
  });
});
