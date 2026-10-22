/** @jest-environment jsdom */
/**
 * P24-09c (ADR-139 § 3, Am. 1) — the invitation of an imported account on the users page:
 *  - the dialog reads the state; until the operator opens the organisation it says so and offers no
 *    send;
 *  - a named account: "Send invitation" sends no body; a shared one asks for both names first;
 *  - a live invitation shows when it expires and offers "Send again" and "Withdraw";
 *  - a refusal is shown in the server's own words; a failed load can be retried;
 *  - Indonesian through the messages provider.
 *
 * Real: the component, the UI kit, the toast store, the i18n provider. Mocked: the user API client
 * (its calls are what is observed). The routes are asserted in
 * backend/src/tests/routes/userInvitation.p2409a.test.ts.
 */
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

jest.mock("@/api/services/user.service", () => ({
  userService: { getInvitation: jest.fn(), issueInvitation: jest.fn(), revokeInvitation: jest.fn() },
}));

import { InvitationActions } from "../InvitationActions";
import { userService } from "@/api/services/user.service";
import { useToastStore } from "@/stores/toastStore";
import { MessagesProvider } from "@/i18n/MessagesProvider";
import { id as idMessages } from "@/i18n/messages/id";
import type { User } from "@/types";

const mocked = userService as unknown as { getInvitation: jest.Mock; issueInvitation: jest.Mock; revokeInvitation: jest.Mock };

const user = { id: "u-7", username: "rs1a", email: "rs1a@example.test", awaitingInvitation: true } as User;
const state = (patch: Record<string, unknown> = {}) => ({
  awaitingInvitation: true,
  invitationsOpen: true,
  personRequired: false,
  live: null,
  firstIssuedAt: null,
  acceptedAt: null,
  ...patch,
});
const LIVE = {
  issuedAt: "2026-10-20T08:00:00.000Z",
  expiresAt: "2026-10-27T08:00:00.000Z",
  expired: false,
  issuedBy: { name: "Admin Satu", role: null, organisation: null, redacted: false },
};
const toasts = () => useToastStore.getState().toasts;
const open = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Invite rs1a" }));
  await screen.findByRole("dialog");
};

beforeEach(() => {
  jest.clearAllMocks();
  useToastStore.setState({ toasts: [] });
});

describe("P24-09c: the invitation dialog", () => {
  it("until the operator opens the organisation: says so, offers no send", async () => {
    mocked.getInvitation.mockResolvedValue(state({ invitationsOpen: false }));
    render(<InvitationActions user={user} />);
    await open();
    expect(await screen.findByText(/Invitations for this organisation are not open yet/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send invitation" })).toBeNull();
  });

  it("a named account: sends with no body, toasts the expiry, refreshes the list and the state", async () => {
    mocked.getInvitation.mockResolvedValueOnce(state()).mockResolvedValueOnce(state({ live: LIVE }));
    mocked.issueInvitation.mockResolvedValue({ issuedAt: LIVE.issuedAt, expiresAt: LIVE.expiresAt, emailQueued: true });
    const onChanged = jest.fn();
    render(<InvitationActions user={user} onChanged={onChanged} />);
    await open();
    fireEvent.click(await screen.findByRole("button", { name: "Send invitation" }));
    await waitFor(() => expect(mocked.issueInvitation).toHaveBeenCalledWith("u-7", {}));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(toasts()[0]).toMatchObject({ type: "success", title: "Invitation sent to rs1a" });
    expect(await screen.findByTestId("invitation-live")).toHaveTextContent(/Admin Satu/);
    expect(screen.getByRole("button", { name: "Send again" })).toBeInTheDocument();
  });

  it("a shared account: both names before it can be sent, then sent with them", async () => {
    mocked.getInvitation.mockResolvedValue(state({ personRequired: true }));
    mocked.issueInvitation.mockResolvedValue({ issuedAt: LIVE.issuedAt, expiresAt: LIVE.expiresAt, emailQueued: false });
    render(<InvitationActions user={user} />);
    await open();
    const send = await screen.findByRole("button", { name: "Send invitation" });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: " Siti " } });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Last name"), { target: { value: "Rahma" } });
    expect(send).toBeEnabled();
    fireEvent.click(send);
    await waitFor(() => expect(mocked.issueInvitation).toHaveBeenCalledWith("u-7", { firstName: "Siti", lastName: "Rahma" }));
    await waitFor(() => expect(toasts()[0]).toMatchObject({ type: "warning", title: expect.stringMatching(/could not be queued/) }));
  });

  it("a live invitation: when it expires, by whom; withdraw it; an expired one says so", async () => {
    mocked.getInvitation.mockResolvedValueOnce(state({ live: LIVE, firstIssuedAt: LIVE.issuedAt })).mockResolvedValueOnce(state({ firstIssuedAt: LIVE.issuedAt }));
    mocked.revokeInvitation.mockResolvedValue({ revokedAt: LIVE.expiresAt });
    const { unmount } = render(<InvitationActions user={user} />);
    await open();
    expect(await screen.findByTestId("invitation-live")).toHaveTextContent(/valid until/);
    fireEvent.click(screen.getByRole("button", { name: "Withdraw" }));
    await waitFor(() => expect(mocked.revokeInvitation).toHaveBeenCalledWith("u-7"));
    expect(toasts()[0]).toMatchObject({ title: "Invitation for rs1a withdrawn" });
    expect(await screen.findByText(/First invitation sent/)).toBeInTheDocument();
    unmount();

    mocked.getInvitation.mockResolvedValue(state({ live: { ...LIVE, expired: true, issuedBy: null } }));
    render(<InvitationActions user={user} />);
    await open();
    expect(await screen.findByTestId("invitation-live")).toHaveTextContent(/expired/);
    expect(screen.getByTestId("invitation-live")).toHaveTextContent(/by —/);
  });

  it("a refusal in the server's words; a failure without words; a failed load can be retried; Close closes", async () => {
    mocked.getInvitation.mockRejectedValueOnce(new Error("down")).mockResolvedValue(state());
    mocked.issueInvitation.mockRejectedValueOnce(new Error("This account does not wait for an invitation.")).mockRejectedValueOnce(new Error(""));
    render(<InvitationActions user={user} />);
    await open();
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    fireEvent.click(await screen.findByRole("button", { name: "Send invitation" }));
    expect(await screen.findByText("This account does not wait for an invitation.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));
    expect(await screen.findByText("The invitation could not be changed.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("speaks Indonesian", async () => {
    mocked.getInvitation.mockResolvedValue(state({ personRequired: true }));
    render(
      <MessagesProvider locale="id" messages={idMessages}>
        <InvitationActions user={user} />
      </MessagesProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Undang rs1a" }));
    expect(await screen.findByText("Siapa yang akan memakai akun ini?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Kirim undangan" })).toBeDisabled();
  });
});
