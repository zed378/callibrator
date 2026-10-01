/** @jest-environment jsdom */
/**
 * GlobalSearch against the backend contract: GET /api/v1/search answers
 * `{ data: { query, total, results, byType } }` (search.service.js — rows
 * grouped per type, each carrying `type`). The real search service runs; only
 * the transport (`@/api/client`'s `api.get`) is mocked.
 *
 * Covered: results grouped by type with the right primary/secondary text,
 * choosing a result (click or Enter) navigates to that type's page, Escape
 * and an outside click close the list, focusing again reopens it, and a 403
 * removes the box (F-10) rather than showing an error.
 */
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { axeViolations } from "@/tests/a11y/axe";

const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn() }),
}));
jest.mock("@/api/client", () => ({
  ...jest.requireActual("@/api/client"),
  api: { get: jest.fn() },
}));

import { api } from "@/api/client";
import { GlobalSearchBox } from "../GlobalSearch";
import { httpError } from "@/tests/support/httpErrors";

const mockedGet = api.get as jest.Mock;

const device = { type: "device", id: "d1", name: "Infusion Pump A", serialNumber: null, model: "IP-9", category: "Pumps", manufacturer: "Acme", rank: 1 };
const stock = { type: "stock", id: "s1", itemName: "Syringe 10ml", sku: "SYR-10", serialNumber: null, quantity: 40, rank: 0.8 };
const cert = { type: "certificate", id: "c1", certificateNumber: "CAL-2026-0001", status: "approved", standard: "ISO 17025", deviceId: "d1", rank: 0.5 };

const envelope = (rows: Array<{ type: string }>) => ({
  success: true,
  status: 200,
  message: "Search results",
  data: {
    query: "pump",
    total: rows.length,
    results: rows,
    byType: rows.reduce<Record<string, unknown[]>>((acc, r) => {
      (acc[r.type] ||= []).push(r);
      return acc;
    }, {}),
  },
  meta: null,
});

const input = () => screen.getByLabelText("Global search");

const type = async (value: string) => {
  fireEvent.change(input(), { target: { value } });
  await act(async () => {
    jest.advanceTimersByTime(350);
  });
};

beforeEach(() => {
  jest.useFakeTimers();
  mockedGet.mockReset();
  mockPush.mockReset();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("GlobalSearchBox — results", () => {
  it("groups the backend's results by type, with each type's identifying text", async () => {
    mockedGet.mockResolvedValue(envelope([device, stock, cert]));
    const { container } = render(<GlobalSearchBox />);

    await type("pump");

    expect(mockedGet).toHaveBeenCalledWith("/api/v1/search", {
      params: { q: "pump", types: undefined, limit: 10 },
    });
    expect(screen.getByText("Devices")).toBeInTheDocument();
    expect(screen.getByText("Stock")).toBeInTheDocument();
    expect(screen.getByText("Certificates")).toBeInTheDocument();
    // device: no serial → model; stock: sku; certificate: status
    expect(screen.getByRole("button", { name: /Infusion Pump A\s*IP-9/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Syringe 10ml\s*SYR-10/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /CAL-2026-0001\s*approved/ })).toBeInTheDocument();
    jest.useRealTimers();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("choosing a result goes to its type's page and clears the box", async () => {
    mockedGet.mockResolvedValue(envelope([stock]));
    render(<GlobalSearchBox />);

    await type("syr");
    fireEvent.click(screen.getByRole("button", { name: /Syringe 10ml/ }));

    expect(mockPush).toHaveBeenCalledWith("/dashboard/stock");
    expect(input()).toHaveValue("");
    expect(screen.queryByText("Stock")).not.toBeInTheDocument();
  });

  it("Enter opens the first result", async () => {
    mockedGet.mockResolvedValue(envelope([cert, device]));
    render(<GlobalSearchBox />);

    await type("cal");
    fireEvent.keyDown(input(), { key: "Enter" });

    expect(mockPush).toHaveBeenCalledWith("/dashboard/calibration");
  });

  it("Escape closes the list, and focusing the box again reopens it", async () => {
    mockedGet.mockResolvedValue(envelope([device]));
    render(<GlobalSearchBox />);

    await type("pump");
    fireEvent.keyDown(input(), { key: "Escape" });
    expect(screen.queryByText("Devices")).not.toBeInTheDocument();

    // Enter on a closed list does nothing.
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(mockPush).not.toHaveBeenCalled();

    fireEvent.focus(input());
    expect(screen.getByText("Devices")).toBeInTheDocument();
  });

  it("a click outside closes the list", async () => {
    mockedGet.mockResolvedValue(envelope([device]));
    render(
      <div>
        <p>elsewhere</p>
        <GlobalSearchBox />
      </div>,
    );

    await type("pump");
    expect(screen.getByText("Devices")).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByText("elsewhere"));
    expect(screen.queryByText("Devices")).not.toBeInTheDocument();
  });

  it("a 403 hands the refusal to the caller and shows no error", async () => {
    mockedGet.mockRejectedValue(httpError(403, "Forbidden"));
    const onForbidden = jest.fn();
    render(<GlobalSearchBox onForbidden={onForbidden} />);

    await type("pump");

    expect(onForbidden).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Search failed/)).not.toBeInTheDocument();
  });

  it("a 403 with no handler is shown as a failed search", async () => {
    mockedGet.mockRejectedValue(httpError(403, "Forbidden"));
    render(<GlobalSearchBox />);

    await type("pump");

    expect(screen.getByText("Search failed: Forbidden")).toBeInTheDocument();
  });
});
