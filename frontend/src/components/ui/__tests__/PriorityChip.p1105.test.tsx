/**
 * ADR-122 Amendment 1 (2026-10-07): an ordinal level (work-order priority,
 * QMS severity, risk RPN, supplier score band) is a neutral chip with a ramp
 * dot — never a status tone — and the converted status chips render the
 * registry's shape + icon + word. Checked by axe-core (jsdom; colour contrast
 * is the browser suite's, and the tones' pairs are a11y.adr090's).
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { PriorityChip } from "../PriorityChip";
import { StatusBadge } from "../StatusBadge";
import HealthIndicator from "@/app/dashboard/components/health-indicator";
import { axeViolations } from "@/tests/a11y/axe";

describe("PriorityChip (ADR-122 Am. 1)", () => {
  it.each([
    ["urgent", "bg-priority-urgent"],
    ["high", "bg-priority-high"],
    ["medium", "bg-priority-medium"],
    ["low", "bg-priority-low"],
    ["unheard-of", "bg-priority-none"],
  ])("level %s draws the %s dot on a neutral chip", (level, dot) => {
    const { container } = render(<PriorityChip level={level}>Critical</PriorityChip>);
    const chip = screen.getByText("Critical");
    expect(chip).toHaveAttribute("data-level", level);
    expect(chip).toHaveClass("bg-muted", "text-foreground");
    expect(chip).not.toHaveAttribute("data-tone");
    const mark = container.querySelector("[aria-hidden='true']");
    expect(mark).toHaveClass(dot);
  });

  it("never uses a status colour", () => {
    const { container } = render(
      <PriorityChip level="urgent" size="sm">
        20
      </PriorityChip>,
    );
    expect(container.innerHTML).not.toMatch(/destructive|status-|success|warning/);
    expect(screen.getByText("20")).toHaveClass("text-xs");
  });

  it("is axe-clean beside the converted status chips", async () => {
    const { container } = render(
      <div>
        <PriorityChip level="high">High</PriorityChip>
        <StatusBadge domain="calibrationResult" state="non_compliant" />
        <StatusBadge domain="legalHold" state="active" size="sm" />
        <StatusBadge domain="wip" state="over" size="sm">
          3/2
        </StatusBadge>
        <HealthIndicator name="PostgreSQL Database" status="error" uptime="Required" delay={0} />
        <HealthIndicator name="MQTT Broker" status="neutral" label="Not configured" delay={0} />
      </div>,
    );
    expect(await axeViolations(container)).toEqual([]);
    // shape + icon + word
    const alarm = screen.getByText("Non-Compliant");
    expect(alarm).toHaveAttribute("data-tone", "alarm");
    expect(alarm.querySelector("svg")).not.toBeNull();
    expect(screen.getByText("Down")).toHaveAttribute("data-tone", "alarm");
    expect(screen.getByText("Not configured")).toHaveAttribute("data-tone", "draft");
  });
});
