/**
 * useTickets — the filters that reach ticketService.list, the fixed "mine"
 * scope of the Raise page, page reset on a filter change, and a failed load.
 * ticketService.list returns { success, message, data, meta } (rows in data,
 * pagination in a top-level meta).
 */
import { act, renderHook, waitFor } from "@testing-library/react";

const ticketService = { list: jest.fn() };
jest.mock("@/api/services/ticket.service", () => ({ ticketService }));

import { useTickets } from "../useTickets";

const ticket = { id: "k1", ticketNo: "TCK-1", subject: "Printer", status: "open", priority: "high" };
const listPage = (n = 1) => ({
  success: true,
  message: "Tickets fetched",
  data: [ticket],
  meta: { total: 30, page: n, limit: 25, totalPages: 2 },
});

beforeEach(() => {
  jest.clearAllMocks();
  ticketService.list.mockResolvedValue(listPage());
});

describe("useTickets", () => {
  it("loads the first page with no filters", async () => {
    const { result } = renderHook(() => useTickets());
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(ticketService.list).toHaveBeenCalledWith({ page: 1, limit: 25 });
    expect(result.current.tickets).toEqual([ticket]);
    expect(result.current.meta).toEqual({ total: 30, page: 1, limit: 25, totalPages: 2 });
  });

  it("filters reach the request and a filter change goes back to page 1", async () => {
    const { result } = renderHook(() => useTickets());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    act(() => result.current.setPage(2));
    await waitFor(() => expect(ticketService.list).toHaveBeenLastCalledWith({ page: 2, limit: 25 }));

    act(() => result.current.setStatus("open" as never));
    expect(result.current.isLoading).toBe(true);
    expect(result.current.page).toBe(1);
    act(() => result.current.setPriority("high" as never));
    act(() => result.current.setMine(true as never));
    act(() => result.current.setQ("  printer "));
    await waitFor(() =>
      expect(ticketService.list).toHaveBeenLastCalledWith({
        page: 1, limit: 25, status: "open", priority: "high", mine: true, q: "printer",
      }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
  });

  it("the Raise page is always scoped to the caller's own tickets", async () => {
    const { result } = renderHook(() => useTickets({ fixedMine: true }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(ticketService.list).toHaveBeenCalledWith({ page: 1, limit: 25, mine: true });
  });

  it("a missing total defaults to 0", async () => {
    ticketService.list.mockResolvedValue({ ...listPage(), meta: { page: 1, limit: 25, totalPages: 1 } });
    const { result } = renderHook(() => useTickets());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.meta.total).toBe(0);
  });

  it("a failed load is an error, not an empty list; refresh recovers", async () => {
    ticketService.list.mockRejectedValueOnce(new Error("Forbidden"));
    const { result } = renderHook(() => useTickets());
    await waitFor(() => expect(result.current.error).toBe("Forbidden"));
    expect(result.current.isLoading).toBe(false);

    ticketService.list.mockRejectedValueOnce("x");
    await act(async () => result.current.refresh());
    expect(result.current.error).toBe("Failed to load tickets");

    await act(async () => result.current.refresh());
    expect(result.current.error).toBeNull();
    expect(result.current.tickets).toEqual([ticket]);
  });
});
