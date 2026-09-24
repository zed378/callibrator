/** @jest-environment jsdom */
/**
 * A-56 / A-22 — GlobalSearch.
 *
 *  - A-56: the backend now answers a failed search with a 500 instead of an
 *    empty list. The component must show that as a failure (with the request
 *    id as a reference), never as "No results".
 *  - A-22: the reset that runs when the query drops below two characters
 *    moved from the debounce effect to the change handler. These cases pin
 *    the behaviour the move must keep: the dropdown closes, and a response
 *    still in flight for the old query does not reopen it.
 *
 * Real: the component and searchErrorMessage. Mocked: next/navigation and
 * the HTTP call (searchService.search).
 */
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

const mockSearch = jest.fn();
jest.mock("@/api/services/search.service", () => {
  const actual = jest.requireActual("@/api/services/search.service");
  return {
    ...actual,
    searchService: { search: (...args: unknown[]) => mockSearch(...args) },
  };
});

import { GlobalSearchBox as GlobalSearch } from "../GlobalSearch";

const input = () => screen.getByLabelText("Global search");

const type = async (value: string) => {
  fireEvent.change(input(), { target: { value } });
  // Past the 300 ms debounce, then let the request's promise settle.
  await act(async () => {
    jest.advanceTimersByTime(350);
  });
};

/** An axios-shaped rejection, as api/client.ts hands it on. */
const serverError = (message: string, requestId?: string) =>
  Object.assign(new Error(message), {
    response: {
      status: 500,
      data: { success: false, status: 500, message, data: null, requestId },
    },
  });

beforeEach(() => {
  jest.useFakeTimers();
  mockSearch.mockReset();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("GlobalSearch — A-56 a failed search is not 'no results'", () => {
  it("shows the failure and the request id when the backend answers 500", async () => {
    mockSearch.mockRejectedValue(
      serverError("An unexpected error occurred. Please try again later.", "req-42"),
    );
    render(<GlobalSearch />);

    await type("pump");

    expect(
      screen.getByText(
        "Search failed: An unexpected error occurred. Please try again later. (reference req-42)",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/No results/)).toBeNull();
  });

  it("shows the failure without a reference when the body has no request id", async () => {
    mockSearch.mockRejectedValue(serverError("Search failed for certificate"));
    render(<GlobalSearch />);

    await type("pump");

    expect(screen.getByText("Search failed: Search failed for certificate")).toBeTruthy();
  });

  it("still says 'No results' for a search that succeeded with nothing", async () => {
    mockSearch.mockResolvedValue({ query: "pump", total: 0, results: [], byType: {} });
    render(<GlobalSearch />);

    await type("pump");

    expect(screen.getByText(/No results for/)).toBeTruthy();
  });
});

describe("GlobalSearch — A-22 reset on a short query", () => {
  it("closes the dropdown when the query is cut below two characters", async () => {
    mockSearch.mockResolvedValue({
      query: "pump",
      total: 1,
      results: [{ type: "device", id: "d1", name: "Infusion pump", rank: 1 }],
      byType: { device: [{ type: "device", id: "d1", name: "Infusion pump", rank: 1 }] },
    });
    render(<GlobalSearch />);

    await type("pump");
    expect(screen.getByText("Infusion pump")).toBeTruthy();

    fireEvent.change(input(), { target: { value: "p" } });

    expect(screen.queryByText("Infusion pump")).toBeNull();
  });

  it("drops a response still in flight when the query is cleared", async () => {
    let resolve: (v: unknown) => void = () => undefined;
    mockSearch.mockReturnValue(new Promise((r) => { resolve = r; }));
    render(<GlobalSearch />);

    await type("pump");
    fireEvent.change(input(), { target: { value: "" } });
    await act(async () => {
      resolve({
        query: "pump",
        total: 1,
        results: [{ type: "device", id: "d1", name: "Late pump", rank: 1 }],
        byType: { device: [{ type: "device", id: "d1", name: "Late pump", rank: 1 }] },
      });
    });

    expect(screen.queryByText("Late pump")).toBeNull();
  });

  it("does not search at all for a one-character query", async () => {
    render(<GlobalSearch />);

    await type("p");

    expect(mockSearch).not.toHaveBeenCalled();
  });
});
