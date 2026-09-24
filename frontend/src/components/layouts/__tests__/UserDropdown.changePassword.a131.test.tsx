/** @jest-environment jsdom */
/**
 * A-131 (ADR-051 A-98) — changing one's own password is available to every
 * signed-in user, outside the permission matrix.
 *
 * The backend route (POST /auth/just-update-password) needs only a session,
 * but the only way to the page was the sidebar entry, which comes from the
 * `change-password` / `account` menu grants — and TECHNICIAN, HEALTHCARE
 * TECHNICIAN, FACILITY MAINTENANCE, WAREHOUSE STAFF and ROOM USER hold
 * neither by default. The user menu takes no permission input at all, so its
 * link shows for everyone.
 *
 * Real: the component. Mocked: next/navigation.
 */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

import { UserDropdown } from "../UserDropdown";

describe("A-131 — the user menu links to Change Password for everyone", () => {
  it("shows a Change Password link to /dashboard/change-password", () => {
    render(<UserDropdown username="tech1" email="tech1@hospital.test" onLogout={jest.fn()} />);

    fireEvent.click(screen.getByText("tech1"));

    const link = screen.getByRole("link", { name: /change password/i });
    expect(link.getAttribute("href")).toBe("/dashboard/change-password");
  });

  it("closes the menu when the link is followed", () => {
    render(<UserDropdown username="tech1" email="tech1@hospital.test" onLogout={jest.fn()} />);
    fireEvent.click(screen.getByText("tech1"));

    fireEvent.click(screen.getByRole("link", { name: /change password/i }));

    expect(screen.queryByRole("link", { name: /change password/i })).toBeNull();
  });
});
