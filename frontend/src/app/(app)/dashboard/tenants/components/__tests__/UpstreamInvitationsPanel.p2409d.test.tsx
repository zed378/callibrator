/** @jest-environment jsdom */
/**
 * P24-09d (ADR-139 Am. 1) — the platform operator's switch for a tenant's imported users'
 * invitations (`upstream_invitations_open`, PATCH /admin/tenants/:id/flags):
 *  - the state is read fail-closed from the tenant's settings (only a JSON `true` is open);
 *  - opening asks first and says it is the cutover act; the answer's settings are what is shown;
 *    the tenant list is refreshed;
 *  - closing; a failure in the server's words, or without words;
 *  - the tenant card offers the switch only when given the handler (the page gives it to the
 *    super admin only);
 *  - Indonesian.
 *
 * Real: the panel, the card, the UI kit, the toast store, the i18n provider. Mocked: the tenant
 * service and the tenant store (their calls are what is observed).
 */
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

jest.mock("@/api/services/tenant.service", () => ({ tenantService: { setUpstreamInvitationsOpen: jest.fn() } }));
const mockRefetch = jest.fn(() => Promise.resolve());
jest.mock("@/stores/tenantStore", () => ({
  useTenantStore: (select: (s: { refetchTenants: () => Promise<void> }) => unknown) => select({ refetchTenants: mockRefetch }),
}));
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }) }));

import { UpstreamInvitationsPanel, invitationsOpenOf } from "../UpstreamInvitationsPanel";
import { TenantCard } from "../TenantCard";
import { tenantService } from "@/api/services/tenant.service";
import { useToastStore } from "@/stores/toastStore";
import { MessagesProvider } from "@/i18n/MessagesProvider";
import { id as idMessages } from "@/i18n/messages/id";
import type { Tenant } from "@/types";

const setOpen = tenantService.setUpstreamInvitationsOpen as jest.Mock;
const tenant = (settings: Record<string, unknown> | undefined = {}) =>
  ({ id: "t-1", name: "Penyedia Sintetis", code: "PS", status: "active", createdAt: "2026-10-01T00:00:00.000Z", settings }) as unknown as Tenant;
const toasts = () => useToastStore.getState().toasts;

beforeEach(() => {
  jest.clearAllMocks();
  useToastStore.setState({ toasts: [] });
});

describe("P24-09d: the operator's invitations switch", () => {
  it("reads the flag fail-closed", () => {
    expect([undefined, {}, { upstream_invitations_open: "true" }, { upstream_invitations_open: false }, { upstream_invitations_open: true }].map((s) => invitationsOpenOf(tenant(s)))).toEqual([
      false,
      false,
      false,
      false,
      true,
    ]);
  });

  it("opens after confirming; shows the answer's state; refreshes the list", async () => {
    setOpen.mockResolvedValue(tenant({ upstream_invitations_open: true }));
    render(<UpstreamInvitationsPanel tenant={tenant()} onClose={jest.fn()} />);
    expect(screen.getByTestId("invitations-state")).toHaveTextContent("Invitations are closed.");
    fireEvent.click(screen.getByRole("button", { name: "Open invitations" }));
    expect(screen.getByText(/only after the pre-invitation checks are recorded/)).toBeInTheDocument();
    expect(setOpen).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole("button", { name: "Open invitations" }).at(-1) as HTMLElement);
    await waitFor(() => expect(setOpen).toHaveBeenCalledWith("t-1", true));
    expect(await screen.findByText("Invitations are open.")).toBeInTheDocument();
    expect(toasts()[0]).toMatchObject({ type: "success", title: "Invitations opened for Penyedia Sintetis" });
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it("closes; a failure in the server's words or without words; Done closes the panel", async () => {
    setOpen.mockResolvedValueOnce(tenant({ upstream_invitations_open: false })).mockRejectedValueOnce(new Error("Tenant not found")).mockRejectedValueOnce(new Error(""));
    const onClose = jest.fn();
    render(<UpstreamInvitationsPanel tenant={tenant({ upstream_invitations_open: true })} onClose={onClose} />);
    const confirm = async (label: string) => {
      fireEvent.click(screen.getByRole("button", { name: label }));
      fireEvent.click(screen.getAllByRole("button", { name: label }).at(-1) as HTMLElement);
    };
    await confirm("Close invitations");
    expect(await screen.findByText("Invitations are closed.")).toBeInTheDocument();
    expect(toasts()[0]).toMatchObject({ title: "Invitations closed for Penyedia Sintetis" });
    await confirm("Open invitations");
    expect(await screen.findByText("Tenant not found")).toBeInTheDocument();
    await confirm("Open invitations");
    expect(await screen.findByText("The invitations could not be changed.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open invitations" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("the card offers the switch only with the handler", () => {
    const onInvitations = jest.fn();
    const { rerender } = render(<TenantCard tenant={tenant()} />);
    expect(screen.queryByRole("button", { name: "Imported users' invitations for Penyedia Sintetis" })).toBeNull();
    rerender(<TenantCard tenant={tenant()} onUpstreamInvitations={onInvitations} />);
    fireEvent.click(screen.getByRole("button", { name: "Imported users' invitations for Penyedia Sintetis" }));
    expect(onInvitations).toHaveBeenCalledWith(expect.objectContaining({ id: "t-1" }));
  });

  it("speaks Indonesian", () => {
    render(
      <MessagesProvider locale="id" messages={idMessages}>
        <UpstreamInvitationsPanel tenant={tenant()} onClose={jest.fn()} />
      </MessagesProvider>,
    );
    expect(screen.getByText("Undangan ditutup.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Buka undangan" })).toBeInTheDocument();
  });
});
