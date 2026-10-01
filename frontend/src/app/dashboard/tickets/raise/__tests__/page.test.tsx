/**
 * Raise a Ticket (the requester's list) and the Raise-a-ticket modal, through
 * the REAL useTickets hook and ticket service — `@/api/client` mocked with
 * the backend's envelope (rows in `data`, top-level `meta`). The list is
 * always `mine=true`. The super admin cannot raise: the backend answers 403
 * "Super admins answer tickets and cannot raise them".
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

jest.mock("@/components/layouts/DashboardLayout", () => {
  return function DashboardLayout({ children }: { children: React.ReactNode }) {
    return <main>{children}</main>;
  };
});

// TipTap in jsdom is covered by its own suite; here the editor is a textarea
// that hands back HTML the way the real one does.
jest.mock("@/components/editor/RichTextEditor", () =>
  function RichTextEditor({ value, onChange }: { value: string; onChange: (html: string) => void }) {
    return <textarea aria-label="Description editor" value={value} onChange={(e) => onChange(e.target.value)} />;
  },
);

const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock("@/api/client", () => ({ api: { get: jest.fn(), post: jest.fn() } }));

import { api } from "@/api/client";
import type { Ticket } from "@/api/services/ticket.service";
import { useToastStore } from "@/stores/toastStore";
import { axeViolations } from "@/tests/a11y/axe";
import { httpError, networkError } from "@/tests/support/httpErrors";
import { ticket, ticketList, ticketOk } from "@/tests/support/ticketFixtures";
import RaiseTicketPage from "../page";

const get = api.get as jest.Mock;
const post = api.post as jest.Mock;

let rows: Ticket[] | Error = [];

// Multi-step page flows with an axe pass each; under --coverage on a loaded
// machine one can exceed Jest's 5 s default (see jest.setup.ts).
jest.setTimeout(20000);

beforeEach(() => {
  jest.clearAllMocks();
  useToastStore.setState({ toasts: [] });
  rows = [ticket("tk-1"), ticket("tk-2", { ticketKey: "TKT-8", subject: "Printer offline", status: "resolved", priority: "low" })];
  get.mockImplementation(async (url: string) => {
    if (url !== "/api/v1/tickets") throw new Error(`unexpected GET ${url}`);
    if (rows instanceof Error) throw rows;
    return ticketList(rows);
  });
});

describe("Raise a Ticket — list", () => {
  it("lists the caller's own tickets (mine=true) with count, and opens one", async () => {
    const { container } = render(<RaiseTicketPage />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(await screen.findByText("Printer offline")).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith("/api/v1/tickets", { params: { mine: true, page: 1, limit: 25 } });
    expect(screen.getByText(/2 raised\./)).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: /Autoclave calibration overdue/ }));
    expect(mockPush).toHaveBeenCalledWith("/dashboard/tickets/tk-1");
  });

  it("no tickets: the empty state offers to raise one", async () => {
    rows = [];
    const { container } = render(<RaiseTicketPage />);
    expect(await screen.findByRole("heading", { name: "No tickets yet" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Raise a ticket" })).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("a failed load shows the error, never the empty state", async () => {
    rows = networkError();
    const { container } = render(<RaiseTicketPage />);
    expect(await screen.findByText("Network Error")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "No tickets yet" })).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("status, priority and search filters reach the request", async () => {
    render(<RaiseTicketPage />);
    await screen.findByText("Printer offline");
    fireEvent.click(screen.getByRole("button", { name: "All statuses" }));
    await act(async () => {
      fireEvent.click(await screen.findByRole("option", { name: "Resolved" }));
    });
    await waitFor(() =>
      expect(get).toHaveBeenLastCalledWith("/api/v1/tickets", {
        params: { status: "resolved", mine: true, page: 1, limit: 25 },
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "All priorities" }));
    await act(async () => {
      fireEvent.click(await screen.findByRole("option", { name: "Urgent" }));
    });
    fireEvent.change(screen.getByPlaceholderText("Search subject or key (e.g. TKT-12)…"), { target: { value: " TKT-7 " } });
    await waitFor(() =>
      expect(get).toHaveBeenLastCalledWith("/api/v1/tickets", {
        params: { status: "resolved", priority: "urgent", mine: true, q: "TKT-7", page: 1, limit: 25 },
      }),
    );
  });
});

describe("Raise a ticket — modal", () => {
  const openModal = async () => {
    render(<RaiseTicketPage />);
    await screen.findByText("Printer offline");
    fireEvent.click(screen.getByRole("button", { name: "Raise ticket" }));
    return screen.findByRole("dialog", { name: "Raise a ticket" });
  };

  it("raises the ticket with subject, HTML description, priority and category; then opens it", async () => {
    const dialog = await openModal();
    expect(await axeViolations(dialog)).toEqual([]);
    fireEvent.change(within(dialog).getByLabelText("Subject"), { target: { value: "  Centrifuge noisy " } });
    fireEvent.change(within(dialog).getByLabelText("Description editor"), { target: { value: "<p>Rattles at 3000 rpm</p>" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Priority/ }));
    fireEvent.click(await within(dialog).findByRole("option", { name: "Urgent" }));
    fireEvent.click(within(dialog).getByRole("button", { name: /Category/ }));
    fireEvent.click(await within(dialog).findByRole("option", { name: "Incident" }));
    post.mockResolvedValue(ticketOk(ticket("tk-9", { ticketKey: "TKT-9", subject: "Centrifuge noisy" }), "Ticket created"));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Raise ticket" }));
    });
    expect(post).toHaveBeenCalledWith("/api/v1/tickets", {
      subject: "Centrifuge noisy",
      description: "<p>Rattles at 3000 rpm</p>",
      priority: "urgent",
      category: "incident",
    });
    expect(useToastStore.getState().toasts.at(-1)).toMatchObject({
      type: "success",
      title: "Ticket raised",
      description: "TKT-9 — Centrifuge noisy",
    });
    expect(mockPush).toHaveBeenCalledWith("/dashboard/tickets/tk-9");
    expect(screen.queryByRole("dialog", { name: "Raise a ticket" })).not.toBeInTheDocument();
  });

  it("an empty description is sent as null, with the default priority and category", async () => {
    const dialog = await openModal();
    fireEvent.change(within(dialog).getByLabelText("Subject"), { target: { value: "Login slow" } });
    post.mockResolvedValue(ticketOk(ticket("tk-10")));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Raise ticket" }));
    });
    expect(post).toHaveBeenCalledWith("/api/v1/tickets", {
      subject: "Login slow",
      description: null,
      priority: "medium",
      category: "support",
    });
  });

  it("a subject under 3 characters is refused locally", async () => {
    const dialog = await openModal();
    fireEvent.change(within(dialog).getByLabelText("Subject"), { target: { value: " ab " } });
    fireEvent.submit(within(dialog).getByLabelText("Subject").closest("form") as HTMLFormElement);
    expect(await within(dialog).findByText("Subject must be at least 3 characters.")).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it("the super admin is refused by the backend (403) and told why, in the dialog", async () => {
    const dialog = await openModal();
    fireEvent.change(within(dialog).getByLabelText("Subject"), { target: { value: "Try to raise" } });
    post.mockRejectedValue(httpError(403, "Super admins answer tickets and cannot raise them"));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Raise ticket" }));
    });
    expect(await within(dialog).findByText("Super admins answer tickets and cannot raise them")).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("button", { name: "Raise ticket" })).toBeEnabled();
    expect(await axeViolations(dialog)).toEqual([]);
  });

  it("Cancel closes without sending", async () => {
    const dialog = await openModal();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Raise a ticket" })).not.toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });
});
