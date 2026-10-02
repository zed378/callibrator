/** @jest-environment jsdom */
/**
 * Seat limit (2026-09-30): the tenant card shows `limitSeats`, the backend's
 * single seat limit. It showed `tenant.maxUsers`, which no backend row has ever
 * carried, so the "Max Users" value was always empty.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import type { Tenant } from "@/types";
import { TenantCard } from "../TenantCard";

jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }) }));

const tenant = (limitSeats: number | null | undefined): Tenant =>
  ({ id: "t1", name: "Alpha Clinic", code: "ALPHA", status: "active", limitSeats, createdAt: "2026-01-01", updatedAt: "2026-01-01" }) as Tenant;

const seatValue = (): string | null => screen.getByText("Seat limit").nextElementSibling?.textContent ?? null;

describe("TenantCard seat limit", () => {
  it("shows the tenant's limitSeats", () => {
    render(<TenantCard tenant={tenant(25)} onEdit={jest.fn()} onSsoConfig={jest.fn()} />);
    expect(seatValue()).toBe("25");
    expect(screen.queryByText("Max Users")).not.toBeInTheDocument();
  });

  it.each([[null], [undefined], [-1]])("shows Unlimited for limitSeats %p", (limitSeats) => {
    render(<TenantCard tenant={tenant(limitSeats)} onEdit={jest.fn()} onSsoConfig={jest.fn()} />);
    expect(seatValue()).toBe("Unlimited");
  });
});
