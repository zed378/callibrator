/** @jest-environment jsdom */
/**
 * P22-05 — the quick calibration-date entry (F-62; P19-05 § 7): sticker → device → date, laboratory,
 * room → save. Pins: the lookup's 404 / 400 / failure as three different states; a retired device
 * cannot be recorded; the form's checks before a round trip; the exact POST; the saved notice with
 * the re-derived next date, the cleared request and the server's notices; a 409 shown as the
 * server's state explanation with the form kept; the same-day warning; the laboratory list's
 * loading / empty / failed states; axe-clean.
 */
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { axeViolations } from "@/tests/a11y/axe";
import { httpError } from "@/tests/support/httpError";
import { CD_IDS, device, lab, meta, ok, savedRecord } from "@/tests/support/calibrationDatesFixtures";

jest.mock("@/api/client", () => {
  const actual = jest.requireActual("@/api/client");
  return { ...actual, api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() } };
});

import { api } from "@/api/client";
import { useToastStore } from "@/stores/toastStore";
import { MessagesProvider } from "@/i18n/MessagesProvider";
import { en } from "@/i18n/messages/en";
import { QuickEntryPanel } from "../components/QuickEntryPanel";
import { todayDay } from "../entry";
import type { Device } from "@/api/services/calibrationDates.service";

const mockedGet = api.get as jest.Mock;
const mockedPost = api.post as jest.Mock;
const TODAY = todayDay();
const BY_QR = "/api/v1/calibration-devices/by-qr/QR-000123";

const renderPanel = (props: { canPickLab?: boolean; showFacility?: boolean } = {}) =>
  render(
    <MessagesProvider locale="en" messages={en}>
      <QuickEntryPanel canPickLab={props.canPickLab ?? true} showFacility={props.showFacility ?? true} />
    </MessagesProvider>,
  );

type Routes = { device?: Device | Error; sameDay?: number | Error; labs?: unknown[] | Error };
const route =
  ({ device: d = device(), sameDay = 0, labs = [lab(CD_IDS.vendor, "Synthetic Lab"), lab(CD_IDS.otherVendor, "Other Lab")] }: Routes = {}) =>
  async (path: string) => {
    if (path.startsWith("/api/v1/calibration-devices/by-qr/")) {
      if (d instanceof Error) throw d;
      return ok(d);
    }
    if (path === "/api/v1/calibration-records") {
      if (sameDay instanceof Error) throw sameDay;
      return ok([], meta(sameDay, 1, 1));
    }
    if (path === "/api/v1/vendors") {
      if (labs instanceof Error) throw labs;
      return ok(labs);
    }
    throw new Error(`unexpected GET ${path}`);
  };

const findDevice = async (qr = "QR-000123") => {
  fireEvent.change(screen.getByLabelText("QR sticker"), { target: { value: qr } });
  fireEvent.click(screen.getByRole("button", { name: "Find" }));
};

describe("P22-05 — quick calibration-date entry", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useToastStore.setState({ toasts: [] });
  });

  it("finds the device, shows its facts, and saves the confirmed room and the device's laboratory", async () => {
    mockedGet.mockImplementation(route());
    mockedPost.mockResolvedValueOnce(ok(savedRecord({ notices: ["A calibration on this day is already recorded."] })));
    const { container } = renderPanel();
    expect(screen.getByRole("button", { name: "Find" })).toBeDisabled();
    await findDevice();
    expect(mockedGet).toHaveBeenCalledWith(BY_QR);
    expect(await screen.findByRole("heading", { level: 3, name: "Synthetic infusion pump" })).toBeInTheDocument();
    expect(screen.getByText("Infusion pump")).toBeInTheDocument();
    expect(screen.getByText("Synthetic Co · P-1")).toBeInTheDocument();
    expect(screen.getByText("Synthetic clinic")).toBeInTheDocument();
    expect(screen.getByText("Room 101 · 1")).toBeInTheDocument();
    expect(screen.getByText("Current")).toBeInTheDocument();
    expect(screen.getByLabelText("Calibration date")).toHaveValue(TODAY);
    expect(screen.getByLabelText("The device's laboratory: Synthetic Lab")).toBeChecked();
    expect(screen.getByLabelText("Room name")).toHaveValue("Room 101");
    await waitFor(() => expect(mockedGet).toHaveBeenCalledWith("/api/v1/vendors", expect.anything()));
    expect(await axeViolations(container)).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Save calibration date" }));
    await waitFor(() =>
      expect(mockedPost).toHaveBeenCalledWith(`/api/v1/calibration-devices/${CD_IDS.device}/calibration-dates`, {
        calibrationDate: TODAY,
        calibrationVendorId: CD_IDS.vendor,
        locationId: CD_IDS.location,
      }),
    );
    const notice = await screen.findByRole("status");
    expect(within(notice).getByText("Calibration date recorded for Synthetic infusion pump")).toBeInTheDocument();
    expect(within(notice).getByText(/The device's next calibration date is now/)).toBeInTheDocument();
    expect(within(notice).getByText("A calibration on this day is already recorded.")).toBeInTheDocument();
    expect(useToastStore.getState().toasts[0]).toMatchObject({ type: "success", title: "Calibration date recorded for Synthetic infusion pump" });
    // The form is reset for the next sticker.
    expect(screen.getByLabelText("QR sticker")).toHaveValue("");
    expect(screen.queryByLabelText("Calibration date")).not.toBeInTheDocument();
    fireEvent.click(within(notice).getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("Calibration date recorded for Synthetic infusion pump")).not.toBeInTheDocument();
  });

  it("says the IPM request is cleared, and that no next date follows when none is derived", async () => {
    mockedGet.mockImplementation(route({ device: device({ calibrationRequestedAt: "2026-09-01T00:00:00.000Z", calibrationDue: { state: "requested", nextCalibrationDate: null, source: null, requestedBySessionId: null }, lastCalibration: null }) }));
    mockedPost.mockResolvedValueOnce(ok(savedRecord({ device: { id: CD_IDS.device, nextCalibrationDate: null, nextCalibrationDateSource: null, calibrationRequestedAt: null } })));
    renderPanel();
    await findDevice();
    expect(await screen.findByText("Calibration requested")).toBeInTheDocument();
    expect(screen.getByText("None recorded")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save calibration date" }));
    expect(await screen.findByText("The calibration request from the IPM visit is cleared.")).toBeInTheDocument();
    expect(screen.getByText(/The device has no next calibration date/)).toBeInTheDocument();
  });

  it("a 404 says no device was found; a 400 is not a sticker; another failure is an error with a retry", async () => {
    mockedGet.mockImplementation(route({ device: httpError(404, "Not found") }));
    renderPanel();
    await findDevice("QR-999");
    expect(await screen.findByText("No device with sticker QR-999 among the devices you may see.")).toBeInTheDocument();

    mockedGet.mockImplementation(route({ device: httpError(400, "That is not a QR sticker value") }));
    await findDevice("??");
    expect(await screen.findByText("That is not a QR sticker value")).toBeInTheDocument();
    expect(screen.getByText("Not a QR sticker")).toBeInTheDocument();

    mockedGet.mockImplementation(route({ device: httpError(500, "Boom") }));
    await findDevice();
    expect(await screen.findByText(/Something went wrong/)).toBeInTheDocument();
    mockedGet.mockImplementation(route());
    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    expect(await screen.findByRole("heading", { level: 3, name: "Synthetic infusion pump" })).toBeInTheDocument();
  });

  it("an empty sticker submits nothing", () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText("QR sticker"), { target: { value: "   " } });
    fireEvent.submit(screen.getByRole("search"));
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it("a retired device cannot be recorded", async () => {
    mockedGet.mockImplementation(route({ device: device({ status: "retired" }) }));
    renderPanel();
    await findDevice();
    expect(await screen.findByText("The device is retired")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save calibration date" })).not.toBeInTheDocument();
  });

  it("shows the form's problems before any round trip", async () => {
    mockedGet.mockImplementation(route({ device: device({ calibrationVendorId: null, calibrationVendorDisplay: null }) }));
    renderPanel({ canPickLab: false });
    await findDevice();
    await screen.findByLabelText("Calibration date");
    expect(screen.getByLabelText("Type the laboratory's name")).toBeChecked();
    fireEvent.change(screen.getByLabelText("Calibration date"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Room name"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Floor"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save calibration date" }));
    const problems = await screen.findByText("Check these fields");
    const box = problems.closest("[role=alert]") as HTMLElement;
    expect(within(box).getByText("Enter the calibration date.")).toBeInTheDocument();
    expect(within(box).getByText("Name the laboratory that calibrated the device.")).toBeInTheDocument();
    expect(within(box).getByText("Enter the room's name when a floor is given.")).toBeInTheDocument();
    expect(mockedPost).not.toHaveBeenCalled();
    expect(mockedGet).not.toHaveBeenCalledWith("/api/v1/vendors", expect.anything());
  });

  it("a 409 is the server's state explanation, and the form is kept", async () => {
    mockedGet.mockImplementation(route());
    mockedPost.mockRejectedValueOnce(httpError(409, "The device's facility has ended; no calibration can be recorded for it.", "CALIBRATION_FACILITY_ENDED"));
    renderPanel();
    await findDevice();
    fireEvent.change(await screen.findByLabelText("Certificate number"), { target: { value: "C-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save calibration date" }));
    expect(await screen.findByText("The device's facility has ended; no calibration can be recorded for it.")).toBeInTheDocument();
    expect(screen.getByText("Not recorded")).toBeInTheDocument();
    expect(screen.getByLabelText("Certificate number")).toHaveValue("C-1");
  });

  it("a refusal without a message says it could not be recorded", async () => {
    mockedGet.mockImplementation(route());
    mockedPost.mockRejectedValueOnce(new Error(""));
    renderPanel();
    await findDevice();
    fireEvent.click(await screen.findByRole("button", { name: "Save calibration date" }));
    expect(await screen.findByText("The calibration date could not be recorded.")).toBeInTheDocument();
  });

  it("warns about an entry on the same day, re-checks on a date change, and a failed check is silent", async () => {
    mockedGet.mockImplementation(route({ sameDay: 1 }));
    renderPanel();
    await findDevice();
    expect(await screen.findByText("A calibration on this date is already recorded")).toBeInTheDocument();
    mockedGet.mockImplementation(route({ sameDay: 0 }));
    fireEvent.change(screen.getByLabelText("Calibration date"), { target: { value: "2026-01-02" } });
    await waitFor(() => expect(screen.queryByText("A calibration on this date is already recorded")).not.toBeInTheDocument());
    expect(mockedGet).toHaveBeenCalledWith("/api/v1/calibration-records", {
      params: { deviceId: CD_IDS.device, fromDay: "2026-01-02", toDay: "2026-01-02", entryKind: "external_date", page: 1, limit: 1 },
    });
    mockedGet.mockImplementation(route({ sameDay: httpError(500, "Boom") }));
    fireEvent.change(screen.getByLabelText("Calibration date"), { target: { value: "2026-01-03" } });
    fireEvent.change(screen.getByLabelText("Calibration date"), { target: { value: "" } });
    expect(screen.queryByText("A calibration on this date is already recorded")).not.toBeInTheDocument();
  });

  it("picks a laboratory from the list, sending its id, a changed room, the due date and the verdict", async () => {
    mockedGet.mockImplementation(route());
    mockedPost.mockResolvedValueOnce(ok(savedRecord()));
    renderPanel();
    await findDevice();
    fireEvent.click(await screen.findByLabelText("Choose from the laboratories"));
    fireEvent.change(await screen.findByLabelText("Calibration laboratory"), { target: { value: CD_IDS.otherVendor } });
    fireEvent.change(screen.getByLabelText("Calibration date"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText("Next calibration date (from the certificate)"), { target: { value: "2027-10-01" } });
    fireEvent.change(screen.getByLabelText("The laboratory's verdict"), { target: { value: "compliant" } });
    fireEvent.change(screen.getByLabelText("Room name"), { target: { value: "Room 202" } });
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "moved" } });
    fireEvent.click(screen.getByRole("button", { name: "Save calibration date" }));
    await waitFor(() =>
      expect(mockedPost).toHaveBeenCalledWith(`/api/v1/calibration-devices/${CD_IDS.device}/calibration-dates`, {
        calibrationDate: "2026-10-01",
        calibrationVendorId: CD_IDS.otherVendor,
        dueDate: "2027-10-01",
        isCompliant: true,
        room: { name: "Room 202", floor: "1" },
        notes: "moved",
      }),
    );
  });

  it("types a laboratory's name", async () => {
    mockedGet.mockImplementation(route());
    mockedPost.mockResolvedValueOnce(ok(savedRecord()));
    renderPanel({ showFacility: false });
    await findDevice();
    fireEvent.click(await screen.findByLabelText("Type the laboratory's name"));
    fireEvent.change(screen.getByLabelText("Laboratory name"), { target: { value: "Synthetic Outside Lab" } });
    expect(screen.queryByText("Synthetic clinic")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save calibration date" }));
    await waitFor(() => expect(mockedPost).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ externalLabName: "Synthetic Outside Lab" })));
  });

  it("the laboratory list: none yet; a failed read with a retry", async () => {
    mockedGet.mockImplementation(route({ device: device({ calibrationVendorId: null, calibrationVendorDisplay: null }), labs: [] }));
    renderPanel();
    await findDevice();
    expect(await screen.findByText("No active calibration laboratory yet. Type its name.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Calibration date")).not.toBeInTheDocument();
  });

  it("a failed laboratory read is an error with a retry, not an empty list", async () => {
    mockedGet.mockImplementation(route({ device: device({ calibrationVendorId: null, calibrationVendorDisplay: null }), labs: httpError(500, "Boom") }));
    renderPanel();
    await findDevice();
    expect(await screen.findByText(/Something went wrong/)).toBeInTheDocument();
    mockedGet.mockImplementation(route({ device: device({ calibrationVendorId: null }) }));
    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    expect(await screen.findByRole("option", { name: "Other Lab" })).toBeInTheDocument();
  });

  it("names a device laboratory it cannot name, and a store or missing room as none", async () => {
    mockedGet.mockImplementation(
      route({
        device: device({
          calibrationVendorDisplay: null,
          warehouse: { id: CD_IDS.location, name: "Main store", code: "S", kind: "store" },
          deviceType: null,
          manufacturer: null,
          model: null,
          serialNumber: null,
          qrCode: null,
          clientFacility: null,
          calibrationDue: undefined,
          nextCalibrationDate: null,
          lastCalibration: { recordId: CD_IDS.record, date: "2026-01-10", entryKind: "full_record", externalLabName: null, performerDisplay: null },
        }),
      }),
    );
    renderPanel();
    await findDevice();
    expect(await screen.findByLabelText("The device's laboratory: the recorded laboratory")).toBeChecked();
    expect(screen.getByText("The device has no room yet. Fill it in if known.")).toBeInTheDocument();
    expect(screen.getByText(/Full record/)).toBeInTheDocument();
  });
});
