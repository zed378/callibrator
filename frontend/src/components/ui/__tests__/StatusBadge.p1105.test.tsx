/** @jest-environment jsdom */
/**
 * P11-05 (ADR-122 §6): a status badge carries its tone as SHAPE and ICON as
 * well as colour, so current~draft and overdue~due-soon stay apart for a
 * red-green colour-blind reader (simulated ΔE 7) and in greyscale print.
 * Fail-before (HEAD 4584df3): `Badge` had colour variants only — every state
 * was the same tinted pill with no icon.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { Badge } from "../Badge";
import { StatusBadge } from "../StatusBadge";
import { axeViolations } from "@/tests/a11y/axe";

describe("StatusBadge / Badge tone (P11-05)", () => {
  it("each tone has its own icon and shape, and the label is the text", async () => {
    const { container } = render(
      <div>
        <StatusBadge domain="calibrationDue" state="overdue" />
        <StatusBadge domain="calibrationDue" state="due_soon" />
        <StatusBadge domain="device" state="active" />
        <StatusBadge domain="device" state="inactive" />
        <StatusBadge domain="workOrder" state="Open" />
      </div>,
    );
    const badge = (text: string) => screen.getByText(text).closest("[data-tone]") as HTMLElement;

    expect(badge("Overdue")).toHaveAttribute("data-tone", "alarm");
    expect(badge("Overdue").className).toMatch(/bg-status-alarm text-status-alarm-foreground/);
    expect(badge("Due soon")).toHaveAttribute("data-tone", "attention");
    expect(badge("Active")).toHaveAttribute("data-tone", "current");
    expect(badge("Inactive").className).toMatch(/border-dashed/);
    expect(badge("Open")).toHaveAttribute("data-tone", "info");

    const icons = ["Overdue", "Due soon", "Active", "Inactive", "Open"].map(
      (t) => badge(t).querySelector("svg")?.getAttribute("class") ?? "",
    );
    // Five different glyphs (lucide names them in the class), all hidden from AT.
    expect(new Set(icons.map((c) => c.split(" ").find((x) => x.startsWith("lucide-") && x !== "lucide-icon")))).toHaveProperty("size", 5);
    for (const t of ["Overdue", "Active"]) expect(badge(t).querySelector("svg")).toHaveAttribute("aria-hidden", "true");

    expect(await axeViolations(container)).toEqual([]);
  });

  it("children replace the registry label; size passes through", () => {
    render(
      <StatusBadge domain="job" state="FAILED" size="sm">
        failed (3 tries)
      </StatusBadge>,
    );
    const b = screen.getByText("failed (3 tries)").closest("[data-tone]") as HTMLElement;
    expect(b).toHaveAttribute("data-tone", "alarm");
    expect(b.className).toMatch(/text-xs/);
  });

  it("a plain Badge (no tone) is unchanged: colour variant, no icon", () => {
    render(<Badge variant="primary">scope:read</Badge>);
    const b = screen.getByText("scope:read");
    expect(b).not.toHaveAttribute("data-tone");
    expect(b.querySelector("svg")).toBeNull();
    expect(b.className).toMatch(/bg-primary\/10 text-primary/);
  });
});
