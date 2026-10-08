/** @jest-environment jsdom */
/**
 * A-160 — the tenant "MFA required" policy panel reads and writes the two
 * tenant_settings keys through the existing settings API.
 *
 * Fail-before (baseline 2a157f1): the panel did not exist.
 *
 * Real: the panel, the UI kit, the toast store. Mocked: the tenant API client.
 */
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

jest.mock("@/api/services/tenant.service", () => ({
  tenantService: { getSettings: jest.fn(), updateSettings: jest.fn() },
}));

import { MfaPolicyPanel } from "../MfaPolicyPanel";
import { tenantService } from "@/api/services/tenant.service";
import type { Tenant } from "@/types";

const mocked = tenantService as unknown as { getSettings: jest.Mock; updateSettings: jest.Mock };
const TENANT = { id: "t-1", name: "RS Harapan", code: "RSH" } as Tenant;

beforeEach(() => jest.clearAllMocks());

describe("A-160: MfaPolicyPanel", () => {
  it("shows the current policy and saves it back as the backend reads it", async () => {
    mocked.getSettings.mockResolvedValue({ tenant: TENANT, settings: { mfa_required: "false" } });
    mocked.updateSettings.mockResolvedValue(undefined);
    const onClose = jest.fn();
    render(<MfaPolicyPanel tenant={TENANT} onClose={onClose} />);

    const box = await screen.findByRole("checkbox", { name: /Require two-factor authentication/i });
    expect(box).not.toBeChecked();
    const level = screen.getByLabelText(/Only for roles at or above level/i);
    expect(level).toBeDisabled();

    fireEvent.click(box);
    fireEvent.change(level, { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mocked.updateSettings).toHaveBeenCalledWith("t-1", {
        mfa_required: "true",
        mfa_required_min_role_level: "5",
      }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("reads an existing policy (case-insensitively) and a blank level means everyone", async () => {
    mocked.getSettings.mockResolvedValue({
      tenant: TENANT,
      settings: { mfa_required: "TRUE" },
    });
    mocked.updateSettings.mockResolvedValue(undefined);
    render(<MfaPolicyPanel tenant={TENANT} onClose={jest.fn()} />);

    expect(await screen.findByRole("checkbox", { name: /Require two-factor/i })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mocked.updateSettings).toHaveBeenCalledWith("t-1", {
        mfa_required: "true",
        mfa_required_min_role_level: "",
      }),
    );
  });

  it("refuses to save a level that is not a whole number", async () => {
    mocked.getSettings.mockResolvedValue({ tenant: TENANT, settings: { mfa_required: "true" } });
    render(<MfaPolicyPanel tenant={TENANT} onClose={jest.fn()} />);

    fireEvent.change(await screen.findByLabelText(/Only for roles at or above level/i), {
      target: { value: "admins" },
    });

    expect(screen.getByText(/Enter a whole number/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("a load failure and a save failure are shown, and the panel stays open", async () => {
    mocked.getSettings.mockRejectedValueOnce(new Error("Forbidden"));
    const { unmount } = render(<MfaPolicyPanel tenant={TENANT} onClose={jest.fn()} />);
    expect(await screen.findByText("Forbidden")).toBeInTheDocument();
    unmount();

    mocked.getSettings.mockResolvedValue({ tenant: TENANT, settings: {} });
    mocked.updateSettings.mockRejectedValue(new Error("Management write access required"));
    const onClose = jest.fn();
    render(<MfaPolicyPanel tenant={TENANT} onClose={onClose} />);
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));

    expect(await screen.findByText("Management write access required")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
