/**
 * Ticket Response desk, through the REAL useTickets hook and ticket service —
 * `@/api/client` mocked with backend envelopes (list: rows in `data`,
 * top-level `meta`; metrics: the object in `data`). The super admin works
 * every tenant's queue and sees each row's tenant; a tenant responder does not.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

jest.mock("@/components/layouts/DashboardLayout", () => {
  return function DashboardLayout({ children }: { children: React.ReactNode }) {
    return <main>{children}</main>;
  };
});

const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock("@/api/client", () => ({ api: { get: jest.fn() } }));

const mockAuth: { user: { id: string; role: { name: string } } | null } = { user: null };
jest.mock("@/stores/authStore", () => ({
  useAuthStore: (selector?: (s: typeof mockAuth) => unknown) => (selector ? selector(mockAuth) : mockAuth),
}));

import { api } from "@/api/client";
import type { Ticket } from "@/api/services/ticket.service";
import { axeViolations } from "@/tests/a11y/axe";
import { httpError } from "@/tests/support/httpErrors";
import { budi, metrics, ticket, ticketList, ticketOk } from "@/tests/support/ticketFixtures";
import TicketResponsePage from "../page";

const get = api.get as jest.Mock;

let rows: Ticket[] | Error = [];
let metricsAnswer: unknown = ticketOk(metrics(), "Ticket metrics retrieved");

// Multi-step page flows with an axe pass each; under --coverage on a loaded
// machine one can exceed Jest's 5 s default (see jest.setup.ts).
jest.setTimeout(20000);

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.user = { id: budi.id, role: { name: "SUPERADMIN" } };
  rows = [
    ticket("tk-1", { assignee: budi, assignedTo: budi.id }),
    ticket("tk-2", { ticketKey: "TKT-8", subject: "Printer offline", tenant: { id: "t-2", name: "RS Sehat" } }),
  ];
  metricsAnswer = ticketOk(metrics(), "Ticket metrics retrieved");
  get.mockImplementation(async (url: string) => {
    if (url === "/api/v1/tickets/metrics") {
      if (metricsAnswer instanceof Error) throw metricsAnswer;
      return metricsAnswer;
    }
    if (url === "/api/v1/tickets") {
      if (rows instanceof Error) throw rows;
      return ticketList(rows);
    }
    throw new Error(`unexpected GET ${url}`);
  });
});

const tile = (label: string) => screen.getByText(label).closest("div")?.parentElement as HTMLElement;

describe("Ticket Response desk", () => {
  it("the super admin sees every tenant's queue, each row's tenant, and the metrics", async () => {
    const { container } = render(<TicketResponsePage />);
    expect(await screen.findByText("Printer offline")).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith("/api/v1/tickets", { params: { page: 1, limit: 25 } });
    expect(screen.getByText(/across every tenant/)).toBeInTheDocument();
    expect(screen.getByText("RS Harapan")).toBeInTheDocument();
    expect(screen.getByText("RS Sehat")).toBeInTheDocument();
    expect(screen.getByText("· to Budi Admin")).toBeInTheDocument();
    await waitFor(() => expect(tile("Overdue")).toHaveTextContent("2"));
    expect(tile("Total")).toHaveTextContent("12");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("a tenant responder sees their own tenant's queue, without tenant chips", async () => {
    mockAuth.user = { id: budi.id, role: { name: "HEALTHCARE ADMIN" } };
    render(<TicketResponsePage />);
    expect(await screen.findByText("Printer offline")).toBeInTheDocument();
    expect(screen.getByText(/Your tenant's support queue/)).toBeInTheDocument();
    expect(screen.queryByText("RS Sehat")).not.toBeInTheDocument();
  });

  it("'Only tickets assigned to me' asks for mine=true", async () => {
    render(<TicketResponsePage />);
    await screen.findByText("Printer offline");
    await act(async () => {
      fireEvent.click(screen.getByRole("checkbox", { name: "Only tickets assigned to me" }));
    });
    await waitFor(() =>
      expect(get).toHaveBeenLastCalledWith("/api/v1/tickets", { params: { mine: true, page: 1, limit: 25 } }),
    );
  });

  it("status filter reaches the request", async () => {
    render(<TicketResponsePage />);
    await screen.findByText("Printer offline");
    fireEvent.click(screen.getByRole("button", { name: "All statuses" }));
    await act(async () => {
      fireEvent.click(await screen.findByRole("option", { name: "In progress" }));
    });
    await waitFor(() =>
      expect(get).toHaveBeenCalledWith("/api/v1/tickets", { params: { status: "in_progress", page: 1, limit: 25 } }),
    );
  });

  it("an empty queue says it is clear; unreadable metrics read as zeros", async () => {
    rows = [];
    metricsAnswer = httpError(403, "Forbidden");
    const { container } = render(<TicketResponsePage />);
    expect(await screen.findByRole("heading", { name: "Queue is clear" })).toBeInTheDocument();
    expect(tile("Total")).toHaveTextContent("0");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("a failed load shows the backend's message, never 'Queue is clear'", async () => {
    rows = httpError(500, "Ticket service unavailable");
    const { container } = render(<TicketResponsePage />);
    expect(await screen.findByText("Ticket service unavailable")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Queue is clear" })).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });
});
