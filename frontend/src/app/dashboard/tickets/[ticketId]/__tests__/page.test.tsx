/**
 * Ticket detail, through the REAL ticket and user services — `@/api/client`
 * mocked with backend envelopes (backend/src/controllers/ticket.controller.js).
 * Two points of view (ticketPov): a requester, and a responder (tenant admin
 * or the cross-tenant super admin) who can assign, post internal notes and
 * sees the tenant.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

jest.mock("@/components/layouts/DashboardLayout", () => {
  return function DashboardLayout({ children }: { children: React.ReactNode }) {
    return <main>{children}</main>;
  };
});

const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useParams: () => ({ ticketId: "tk-1" }),
  useRouter: () => ({ push: mockPush }),
}));

jest.mock("@/api/client", () => ({
  api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

const mockAuth: { user: { id: string; role: { name: string } } | null } = { user: null };
jest.mock("@/stores/authStore", () => ({
  useAuthStore: (selector?: (s: typeof mockAuth) => unknown) => (selector ? selector(mockAuth) : mockAuth),
}));

import { api } from "@/api/client";
import type { Ticket } from "@/api/services/ticket.service";
import { useToastStore } from "@/stores/toastStore";
import { axeViolations } from "@/tests/a11y/axe";
import { httpError } from "@/tests/support/httpErrors";
import { usersEnvelope } from "@/tests/support/kanbanFixtures";
import { ana, budi, tComment, ticket, ticketOk } from "@/tests/support/ticketFixtures";
import TicketDetailPage from "../page";

const get = api.get as jest.Mock;
const post = api.post as jest.Mock;
const patch = api.patch as jest.Mock;
const del = api.delete as jest.Mock;

const URL = "/api/v1/tickets/tk-1";
let current: Ticket | Error = ticket("tk-1");

const as = (role: string) => {
  mockAuth.user = { id: role === "TECHNICIAN" ? ana.id : budi.id, role: { name: role } };
};
const lastToast = () => useToastStore.getState().toasts.at(-1);

// Multi-step page flows with an axe pass each; under --coverage on a loaded
// machine one can exceed Jest's 5 s default (see jest.setup.ts).
jest.setTimeout(20000);

beforeEach(() => {
  jest.clearAllMocks();
  useToastStore.setState({ toasts: [] });
  as("TECHNICIAN");
  current = ticket("tk-1", {
    comments: [
      tComment("c1", { body: "Any update?" }),
      tComment("c2", { body: "Parts ordered", isInternal: true, author: budi }),
    ],
  });
  get.mockImplementation(async (url: string) => {
    if (url === URL) {
      if (current instanceof Error) throw current;
      return ticketOk(current, "Ticket retrieved");
    }
    if (url === "/api/v1/users/all") return usersEnvelope([budi]);
    throw new Error(`unexpected GET ${url}`);
  });
});

const renderPage = async () => {
  const view = render(<TicketDetailPage />);
  await screen.findByRole("heading", { level: 1, name: "Autoclave calibration overdue" });
  return view;
};

describe("Ticket detail — reading", () => {
  it("shows the key, status, priority, description, the conversation and the facts", async () => {
    const { container } = await renderPage();
    expect(get).toHaveBeenCalledWith(URL);
    expect(screen.getByText("TKT-7")).toBeInTheDocument();
    expect(screen.getAllByText("Open").length).toBeGreaterThan(0);
    expect(screen.getByText("autoclave")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Conversation (2)" })).toBeInTheDocument();
    expect(screen.getByText("Any update?")).toBeInTheDocument();
    expect(screen.getByText("Internal")).toBeInTheDocument();
    expect(screen.getByText("Ana Nurse", { selector: "span.text-foreground.text-right" })).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("while loading says so; a ticket of another tenant (404) shows the backend's message", async () => {
    current = httpError(404, "Ticket not found");
    const { container } = render(<TicketDetailPage />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(await screen.findByText("Ticket not found")).toBeInTheDocument();
    expect(screen.getByText("Ticket not found.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete ticket" })).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("no description and no replies", async () => {
    current = ticket("tk-1", { description: null, comments: [] });
    await renderPage();
    expect(screen.getByText("No description provided.")).toBeInTheDocument();
    expect(screen.getByText("No replies yet.")).toBeInTheDocument();
  });

  // A-298 fail-before: the description was injected raw, so the onerror
  // handler, the <script> and the data: link below all reached the DOM of
  // whoever opened the ticket — including the cross-tenant super admin.
  it("renders the rich description sanitized (A-298): formatting kept, handlers, scripts and data: links gone", async () => {
    current = ticket("tk-1", {
      description:
        '<p><strong>Door seal</strong> worn</p><img src="x" onerror="window.__pwned=1">' +
        '<script>window.__pwned=2</script><a href="data:text/html,<script>alert(1)</script>">see</a>' +
        '<a href="https://example.org/manual">manual</a>',
      comments: [],
    });
    const { container } = await renderPage();
    const body = container.querySelector(".article-prose") as HTMLElement;
    expect(within(body).getByText("Door seal").tagName).toBe("STRONG");
    expect(body.querySelector("[onerror]")).toBeNull();
    expect(body.querySelector("script")).toBeNull();
    expect(within(body).getByText("see")).not.toHaveAttribute("href");
    expect(within(body).getByText("manual")).toHaveAttribute("href", "https://example.org/manual");
    expect(within(body).getByText("manual")).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("a requester: back to My tickets; no assignee picker, no internal-note box, no tenant row", async () => {
    await renderPage();
    expect(screen.queryByRole("button", { name: /Assignee/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /Internal note/ })).not.toBeInTheDocument();
    expect(screen.queryByText("RS Harapan")).not.toBeInTheDocument();
    expect(get).not.toHaveBeenCalledWith("/api/v1/users/all", expect.anything());
    fireEvent.click(screen.getByRole("button", { name: "My tickets" }));
    expect(mockPush).toHaveBeenCalledWith("/dashboard/tickets/raise");
  });

  it("the super admin: back to the Response desk, sees the tenant, can assign", async () => {
    as("SUPERADMIN");
    const { container } = await renderPage();
    expect(screen.getByText("RS Harapan")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Internal note (responders only)" })).toBeInTheDocument();
    await waitFor(() => expect(get).toHaveBeenCalledWith("/api/v1/users/all", expect.anything()));
    expect(await axeViolations(container)).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Response desk" }));
    expect(mockPush).toHaveBeenCalledWith("/dashboard/tickets/response");
  });

  it("a tenant responder sees no tenant row", async () => {
    as("HEALTHCARE ADMIN");
    await renderPage();
    expect(screen.getByRole("button", { name: "Response desk" })).toBeInTheDocument();
    expect(screen.queryByText("RS Harapan")).not.toBeInTheDocument();
  });
});

describe("Ticket detail — changes", () => {
  it("changing the status PATCHes it and shows the server's ticket", async () => {
    await renderPage();
    patch.mockResolvedValue(ticketOk(ticket("tk-1", { status: "resolved", resolvedAt: "2026-09-22T10:00:00.000Z" }), "Ticket updated"));
    fireEvent.click(screen.getByRole("button", { name: /^Status/ }));
    await act(async () => {
      fireEvent.click(await screen.findByRole("option", { name: "Resolved" }));
    });
    expect(patch).toHaveBeenCalledWith(URL, { status: "resolved" });
    expect(await screen.findByText("Resolved", { selector: "span.text-muted-foreground" })).toBeInTheDocument();
  });

  it("changing the priority PATCHes it", async () => {
    await renderPage();
    patch.mockResolvedValue(ticketOk(ticket("tk-1", { priority: "urgent" })));
    fireEvent.click(screen.getByRole("button", { name: /^Priority/ }));
    await act(async () => {
      fireEvent.click(await screen.findByRole("option", { name: "Urgent" }));
    });
    expect(patch).toHaveBeenCalledWith(URL, { priority: "urgent" });
  });

  it("a responder assigns the ticket; Unassigned sends null", async () => {
    as("HEALTHCARE ADMIN");
    await renderPage();
    await waitFor(() => expect(get).toHaveBeenCalledWith("/api/v1/users/all", expect.anything()));
    patch.mockResolvedValue(ticketOk(ticket("tk-1", { assignedTo: budi.id, assignee: budi })));
    fireEvent.click(screen.getByRole("button", { name: /^Assignee/ }));
    await act(async () => {
      fireEvent.click(await screen.findByRole("option", { name: "Budi Admin" }));
    });
    expect(patch).toHaveBeenCalledWith(URL, { assignedTo: budi.id });
    fireEvent.click(screen.getByRole("button", { name: /^Assignee/ }));
    await act(async () => {
      fireEvent.click(await screen.findByRole("option", { name: "Unassigned" }));
    });
    expect(patch).toHaveBeenLastCalledWith(URL, { assignedTo: null });
  });

  it("a refused change (403 — not the requester or assignee) is toasted with the backend's message", async () => {
    as("HEALTHCARE ADMIN");
    await renderPage();
    patch.mockRejectedValue(httpError(403, "You do not have permission to modify this ticket"));
    fireEvent.click(screen.getByRole("button", { name: /^Status/ }));
    await act(async () => {
      fireEvent.click(await screen.findByRole("option", { name: "Closed" }));
    });
    expect(lastToast()).toMatchObject({
      type: "error",
      title: "Update failed",
      description: "You do not have permission to modify this ticket",
    });
  });
});

describe("Ticket detail — replies", () => {
  it("posts a trimmed reply and reloads the conversation; blank replies cannot be sent", async () => {
    await renderPage();
    const reply = screen.getByRole("button", { name: "Reply" });
    expect(reply).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("Write a reply…"), { target: { value: "  Thanks!  " } });
    post.mockResolvedValue(ticketOk(tComment("c3", { body: "Thanks!" }), "Comment added"));
    current = ticket("tk-1", { comments: [tComment("c3", { body: "Thanks!" })] });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    });
    expect(post).toHaveBeenCalledWith(`${URL}/comments`, { body: "Thanks!", isInternal: false });
    expect(await screen.findByText("Thanks!")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Write a reply…")).toHaveValue("");
  });

  it("a responder can post an internal note", async () => {
    as("HEALTHCARE ADMIN");
    await renderPage();
    fireEvent.change(screen.getByPlaceholderText("Write a reply…"), { target: { value: "Vendor called" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Internal note (responders only)" }));
    post.mockResolvedValue(ticketOk(tComment("c4")));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    });
    expect(post).toHaveBeenCalledWith(`${URL}/comments`, { body: "Vendor called", isInternal: true });
  });

  it("a refused reply is toasted and the text is kept", async () => {
    await renderPage();
    fireEvent.change(screen.getByPlaceholderText("Write a reply…"), { target: { value: "Hello" } });
    post.mockRejectedValue(httpError(403, "You can only comment on tickets you are party to"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    });
    expect(lastToast()).toMatchObject({
      type: "error",
      title: "Could not post reply",
      description: "You can only comment on tickets you are party to",
    });
    expect(screen.getByPlaceholderText("Write a reply…")).toHaveValue("Hello");
  });
});

describe("Ticket detail — delete", () => {
  it("asks first (naming the ticket), DELETEs, toasts and goes back", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Delete ticket" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete this ticket?" });
    expect(within(dialog).getByText(/TKT-7 — "Autoclave calibration overdue"/)).toBeInTheDocument();
    expect(await axeViolations(dialog)).toEqual([]);
    del.mockResolvedValue(ticketOk({ deleted: true }, "Ticket deleted"));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Delete ticket" }));
    });
    expect(del).toHaveBeenCalledWith(URL);
    expect(lastToast()).toMatchObject({ type: "success", title: "Ticket deleted" });
    expect(mockPush).toHaveBeenCalledWith("/dashboard/tickets/raise");
  });

  it("a refused delete (403) closes the dialog and toasts the reason", async () => {
    as("HEALTHCARE ADMIN");
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Delete ticket" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete this ticket?" });
    del.mockRejectedValue(httpError(403, "Only the requester or an admin can delete a ticket"));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Delete ticket" }));
    });
    expect(screen.queryByRole("dialog", { name: "Delete this ticket?" })).not.toBeInTheDocument();
    expect(lastToast()).toMatchObject({
      type: "error",
      title: "Delete failed",
      description: "Only the requester or an admin can delete a ticket",
    });
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("Cancel keeps the ticket", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Delete ticket" }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "Delete this ticket?" })).getByRole("button", { name: "Cancel" }));
    expect(del).not.toHaveBeenCalled();
  });
});
