/** @jest-environment jsdom */
/**
 * S6 (audit 01 §2.2) — choosing a global-search result opens its list
 * FILTERED TO THAT RECORD, not the unfiltered list. There is no detail page
 * for a device, stock item or certificate yet, so the list is the closest
 * record view: the result hands its identifying term to the list's hook
 * (stores/searchHandoffStore), which takes it once as its initial filter.
 *
 * Fail-before: handleSelect pushed the list route and nothing else — the user
 * landed on page 1 of the whole register and had to search again.
 */
import React from "react";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";

const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn() }),
}));
jest.mock("@/api/client", () => ({
  ...jest.requireActual("@/api/client"),
  api: { get: jest.fn() },
}));

import { api } from "@/api/client";
import { GlobalSearchBox, recordFilterTerm } from "../GlobalSearch";
import { useSearchHandoff, useSearchHandoffStore } from "@/stores/searchHandoffStore";
import type { SearchResult } from "@/api/services/search.service";

const mockedGet = api.get as jest.Mock;
const device = { type: "device", id: "d1", name: "Infusion Pump A", serialNumber: "SN-77", model: "IP-9", category: "Pumps", manufacturer: "Acme", rank: 1 };
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

beforeEach(() => {
  jest.useFakeTimers();
  mockedGet.mockReset();
  mockPush.mockReset();
  useSearchHandoffStore.setState({ pending: null });
});
afterEach(() => jest.useRealTimers());

const search = async (value: string) => {
  fireEvent.change(screen.getByLabelText("Global search"), { target: { value } });
  await act(async () => {
    jest.advanceTimersByTime(350);
  });
};

describe("S6 — a search result opens its list filtered to that record", () => {
  it("a device: the list is opened with the device's serial number handed to it", async () => {
    mockedGet.mockResolvedValue(envelope([device]));
    render(<GlobalSearchBox />);
    await search("pump");
    fireEvent.click(await screen.findByText("Infusion Pump A"));

    expect(mockPush).toHaveBeenCalledWith("/dashboard/devices");
    expect(useSearchHandoffStore.getState().pending).toEqual({ target: "device", term: "SN-77" });
  });

  it("a certificate: its number is handed to the calibration page", async () => {
    mockedGet.mockResolvedValue(envelope([cert]));
    render(<GlobalSearchBox />);
    await search("CAL");
    fireEvent.click(await screen.findByText("CAL-2026-0001"));

    expect(mockPush).toHaveBeenCalledWith("/dashboard/calibration");
    expect(useSearchHandoffStore.getState().pending).toEqual({ target: "certificate", term: "CAL-2026-0001" });
  });

  it("the identifying term: serial number, else name; stock by name; certificate by number", () => {
    expect(recordFilterTerm({ ...device, serialNumber: undefined } as unknown as SearchResult)).toBe("Infusion Pump A");
    expect(recordFilterTerm({ type: "stock", id: "s", itemName: "Syringe" } as unknown as SearchResult)).toBe("Syringe");
  });
});

describe("S6 — the list takes the hand-off once", () => {
  it("only the target reads it, and it is cleared after mount", () => {
    useSearchHandoffStore.getState().handOff("certificate", "CAL-1");
    expect(renderHook(() => useSearchHandoff("device")).result.current).toBeNull();
    const first = renderHook(() => useSearchHandoff("certificate"));
    expect(first.result.current).toBe("CAL-1");
    expect(useSearchHandoffStore.getState().pending).toBeNull();
    expect(renderHook(() => useSearchHandoff("certificate")).result.current).toBeNull();
  });
});
