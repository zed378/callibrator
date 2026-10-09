/** @jest-environment jsdom */
/**
 * P22-05 — the calibration list (F-63; P19-05 § 8 as built by P21-06): latest per device by default;
 * each filter's exact query (only what is set is sent; page 1 on a change); loading, empty and
 * failed as three states (a failure is never an empty list); the facility filter for provider staff
 * only (a failed options read leaves it out); the room from the snapshot; the recorder by snapshot,
 * "redacted", or the API key; the pager from the top-level `meta`; axe-clean.
 */
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { axeViolations } from "@/tests/a11y/axe";
import { httpError } from "@/tests/support/httpError";
import { CD_IDS, meta, ok, record } from "@/tests/support/calibrationDatesFixtures";

jest.mock("@/api/client", () => {
  const actual = jest.requireActual("@/api/client");
  return { ...actual, api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() } };
});

import { api } from "@/api/client";
import { MessagesProvider } from "@/i18n/MessagesProvider";
import { en } from "@/i18n/messages/en";
import { CalibrationListPanel, INITIAL_FILTERS, listQuery } from "../components/CalibrationListPanel";

const mockedGet = api.get as jest.Mock;
const RECORDS = "/api/v1/calibration-records";

const renderPanel = (showFacility = true) =>
  render(
    <MessagesProvider locale="en" messages={en}>
      <CalibrationListPanel showFacility={showFacility} />
    </MessagesProvider>,
  );

const lastQuery = (): Record<string, unknown> => {
  const calls = mockedGet.mock.calls.filter((c) => c[0] === RECORDS);
  return (calls[calls.length - 1]?.[1] as { params: Record<string, unknown> }).params;
};

const routes =
  (rows = [record()], total = rows.length, facilities: unknown[] | Error = [{ id: CD_IDS.facility, name: "Synthetic clinic", code: null }]) =>
  async (path: string, config?: { params?: { page?: number } }) => {
    if (path === RECORDS) return ok(rows, meta(total, config?.params?.page ?? 1));
    if (path === "/api/v1/client-facilities/options") {
      if (facilities instanceof Error) throw facilities;
      return ok(facilities);
    }
    throw new Error(`unexpected GET ${path}`);
  };

describe("P22-05 — calibration list", () => {
  beforeEach(() => jest.clearAllMocks());

  it("listQuery sends only what is set", () => {
    expect(listQuery(INITIAL_FILTERS, 1)).toEqual({ page: 1, limit: 50, latestOnly: true, sort: "calibrationDate" });
    expect(
      listQuery({ qr: " 12 ", facilityId: "f", kind: "external_date", dateField: "created", fromDay: "2026-01-01", toDay: "", latestOnly: false }, 2),
    ).toEqual({ page: 2, limit: 50, latestOnly: false, sort: "createdAt", qrCode: "12", clientFacilityId: "f", entryKind: "external_date", dateField: "created", fromDay: "2026-01-01" });
    expect(listQuery({ ...INITIAL_FILTERS, toDay: "2026-02-01" }, 1)).toMatchObject({ dateField: "calibration", toDay: "2026-02-01" });
  });

  it("lists the latest calibration per device with the snapshot room, the recorder and the verdict; axe-clean", async () => {
    mockedGet.mockImplementation(
      routes([
        record(),
        record({ id: "r2", isCompliant: false, performerDisplay: { name: null, role: null, organisation: null, redacted: true }, room: { name: "—", floor: "—" }, entryKind: "full_record", externalLabName: null }),
        record({ id: "r3", isCompliant: null, performerDisplay: null, apiKey: { id: "k", name: "Synthetic lab key", keyPrefix: "ck_" }, device: null, clientFacility: null, dueDate: null }),
        record({ id: "r4", performerDisplay: null, room: undefined, entryKind: undefined }),
      ]),
    );
    const { container } = renderPanel();
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    const table = await screen.findByRole("table");
    expect(lastQuery()).toEqual({ page: 1, limit: 50, latestOnly: true, sort: "calibrationDate" });
    const rows = within(table).getAllByRole("row");
    expect(within(rows[1] as HTMLElement).getByText("Synthetic infusion pump")).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText("Room 101 · 1")).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText("Synthetic Technician")).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText("Within tolerance")).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText("Outside laboratory date")).toBeInTheDocument();
    expect(within(rows[2] as HTMLElement).getByText("Redacted")).toBeInTheDocument();
    expect(within(rows[2] as HTMLElement).getByText("Out of tolerance")).toBeInTheDocument();
    expect(within(rows[2] as HTMLElement).getByText("Full record")).toBeInTheDocument();
    expect(within(rows[3] as HTMLElement).getByText("Synthetic lab key")).toBeInTheDocument();
    expect(within(rows[3] as HTMLElement).getByText("Not stated")).toBeInTheDocument();
    expect(await screen.findByRole("option", { name: "Synthetic clinic" })).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("each filter re-reads page 1 with its query", async () => {
    mockedGet.mockImplementation(routes());
    renderPanel();
    await screen.findByRole("table");
    await screen.findByRole("option", { name: "Synthetic clinic" });
    fireEvent.change(screen.getByLabelText("QR sticker"), { target: { value: "QR-1" } });
    await waitFor(() => expect(lastQuery()).toMatchObject({ qrCode: "QR-1", page: 1 }));
    fireEvent.change(screen.getByLabelText("Facility"), { target: { value: CD_IDS.facility } });
    await waitFor(() => expect(lastQuery()).toMatchObject({ clientFacilityId: CD_IDS.facility }));
    fireEvent.change(screen.getByLabelText("Entry kind"), { target: { value: "full_record" } });
    await waitFor(() => expect(lastQuery()).toMatchObject({ entryKind: "full_record" }));
    fireEvent.change(screen.getByLabelText("Date range on"), { target: { value: "created" } });
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-01-01" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-03-31" } });
    await waitFor(() => expect(lastQuery()).toMatchObject({ dateField: "created", fromDay: "2026-01-01", toDay: "2026-03-31", sort: "createdAt" }));
    fireEvent.click(screen.getByLabelText("Latest calibration per device only"));
    await waitFor(() => expect(lastQuery()).toMatchObject({ latestOnly: false }));
  });

  it("warns when the range is reversed", async () => {
    mockedGet.mockImplementation(routes());
    renderPanel(false);
    await screen.findByRole("table");
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-05-01" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-04-01" } });
    expect(await screen.findByText("The start date is after the end date: no row can match.")).toBeInTheDocument();
  });

  it("says when nothing matches", async () => {
    mockedGet.mockImplementation(routes([]));
    renderPanel(false);
    expect(await screen.findByText("No calibration matches.")).toBeInTheDocument();
    expect(mockedGet).not.toHaveBeenCalledWith("/api/v1/client-facilities/options");
  });

  it("a failed read is an error with a retry, never an empty list", async () => {
    mockedGet.mockImplementation(routes());
    mockedGet.mockRejectedValueOnce(httpError(500, "Boom"));
    renderPanel(false);
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
    expect(screen.queryByText("No calibration matches.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    expect(await screen.findByRole("table")).toBeInTheDocument();
  });

  it("a failed facility read leaves the filter out; the list still reads", async () => {
    mockedGet.mockImplementation(routes([record()], 1, httpError(500, "Boom")));
    renderPanel();
    expect(await screen.findByRole("table")).toBeInTheDocument();
    await waitFor(() => expect(mockedGet).toHaveBeenCalledWith("/api/v1/client-facilities/options"));
    expect(screen.queryByLabelText("Facility")).not.toBeInTheDocument();
  });

  it("pages through the top-level meta", async () => {
    mockedGet.mockImplementation(routes([record()], 120));
    renderPanel(false);
    expect(await screen.findByText("Page 1 of 3 · 120 rows")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Page 2 of 3 · 120 rows")).toBeInTheDocument();
    expect(lastQuery()).toMatchObject({ page: 2 });
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(await screen.findByText("Page 1 of 3 · 120 rows")).toBeInTheDocument();
  });
});
