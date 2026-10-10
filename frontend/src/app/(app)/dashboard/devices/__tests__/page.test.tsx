/** @jest-environment jsdom */
/**
 * P22-02 — /dashboard/devices, the device register, by audience (ADR-102: the effective
 * permissions, never a role name) and through its flows. Real: the island, its dialogs, the
 * services and the typed client. Mocked: the HTTP client (`@/api/client`), the dashboard chrome and
 * the browser's image codec (`lib/photoPrep#preparePhoto` — jsdom has no canvas).
 *
 * Pins: the list's three states (a failed read is never an empty register); rows from `data`, paging
 * from the top-level `meta`; each filter's query; a bound account sees no facility, import, delete or
 * IoT and its form has no QR / status / laboratory / store / facility; the operator never manages
 * photos; register → the two required photos (Finish only with both); edit sends only the changes;
 * a 409 is the server's explanation with the form kept; photo upload, replace, delete, HEIC refusal
 * explained; CSV import report (A-358 field errors as text); delete with its failure kept; one h1;
 * Indonesian; axe.
 */
import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { axeViolations } from "@/tests/a11y/axe";
import { httpError } from "@/tests/support/httpError";
import { clearPermissions, grantPermissions, grantSuperAdmin } from "@/tests/support/permissions";
import { CD_IDS, device, lab, meta, ok } from "@/tests/support/calibrationDatesFixtures";

jest.mock("@/components/layouts/DashboardLayout", () => {
  return function DashboardLayout({ children }: { children: React.ReactNode }) {
    return <main>{children}</main>;
  };
});

jest.mock("@/api/client", () => {
  const actual = jest.requireActual("@/api/client");
  return { ...actual, api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() } };
});

jest.mock("@/lib/photoPrep", () => {
  const actual = jest.requireActual("@/lib/photoPrep");
  return { ...actual, preparePhoto: jest.fn(async () => new File(["jpeg"], "prepared.jpg", { type: "image/jpeg" })) };
});

import { api } from "@/api/client";
import { preparePhoto, PhotoPrepError } from "@/lib/photoPrep";
import { useMenuStore } from "@/stores/menuStore";
import { useToastStore } from "@/stores/toastStore";
import { useSearchHandoffStore } from "@/stores/searchHandoffStore";
import { MessagesProvider } from "@/i18n/MessagesProvider";
import { en } from "@/i18n/messages/en";
import { id as idMessages } from "@/i18n/messages/id";
import { DevicesClient, accessFor, listQuery, INITIAL_FILTERS } from "../DevicesClient";
import { clearPhotoLinks } from "../components/PhotoThumb";
import type { RegisterDevice } from "@/api/services/deviceRegister.service";

jest.setTimeout(20000);

const get = api.get as jest.Mock;
const post = api.post as jest.Mock;
const put = api.put as jest.Mock;
const del = api.delete as jest.Mock;
const prep = preparePhoto as jest.Mock;

const FRONT = "8a000000-0000-4000-8000-000000000001";
const PLATE = "8a000000-0000-4000-8000-000000000002";
const NEW_PHOTO = "8a000000-0000-4000-8000-000000000003";
const SELF = "8b000000-0000-4000-8000-000000000001";

let rows: RegisterDevice[];
let total: number;
const routes = (path: string, config?: { params?: Record<string, unknown> }) => {
  if (path === "/api/v1/calibration-devices") return Promise.resolve(ok(rows, meta(total, Number(config?.params?.page ?? 1), 20)));
  if (path === "/api/v1/client-facilities/options")
    return Promise.resolve(
      ok([
        { id: SELF, name: "Own organisation", code: "SELF", status: "active", isSelf: true },
        { id: CD_IDS.facility, name: "Synthetic clinic", code: "SC", status: "active", isSelf: false },
        { id: "ended", name: "Ended clinic", code: "EC", status: "ended", isSelf: false },
      ]),
    );
  if (path === "/api/v1/warehouses") return Promise.resolve(ok([{ id: "store-1", name: "Depot", code: "DP" }]));
  if (path === "/api/v1/vendors") return Promise.resolve(ok([lab(CD_IDS.vendor, "Synthetic Lab")]));
  if (path === "/api/v1/device-types") return Promise.resolve(ok([{ id: "type-1", name: "Infusion pump", status: "active" }]));
  if (path.startsWith("/api/v1/iot/devices/")) return Promise.reject(httpError(404, "No IoT config"));
  return Promise.reject(new Error(`unexpected GET ${path}`));
};

const postRoutes = (path: string, body?: unknown) => {
  if (path.endsWith("/signed-url")) {
    const id = path.split("/")[4];
    return Promise.resolve(ok({ url: `https://x.invalid/api/v1/attachments/${String(id)}/signed?token=t`, token: "t", expiresAt: "x", expiresInSec: 300 }));
  }
  if (path === "/api/v1/calibration-devices") return Promise.resolve(ok(device({ id: "new-device", name: (body as { name: string }).name, frontPhotoAttachmentId: null, serialPlatePhotoAttachmentId: null })));
  if (path.endsWith("/photos")) {
    const purpose = (body as FormData).get("purpose");
    return Promise.resolve({ data: { id: purpose === "device_front" ? NEW_PHOTO : PLATE, purpose } });
  }
  return Promise.reject(new Error(`unexpected POST ${path}`));
};

const renderPage = (locale: "en" | "id" = "en") =>
  render(
    <MessagesProvider locale={locale} messages={locale === "en" ? en : idMessages}>
      <DevicesClient languageForm={<div>language</div>} />
    </MessagesProvider>,
  );

const lastListQuery = (): Record<string, unknown> => {
  const calls = get.mock.calls.filter((c) => c[0] === "/api/v1/calibration-devices");
  return (calls[calls.length - 1]?.[1] as { params: Record<string, unknown> }).params;
};

const bind = (permissions: Record<string, "read" | "write">) =>
  useMenuStore.setState({ effectivePermissions: { superAdmin: false, facilityBound: true, permissions } });

beforeEach(() => {
  jest.clearAllMocks();
  clearPermissions();
  clearPhotoLinks();
  useToastStore.setState({ toasts: [] });
  rows = [device({ frontPhotoAttachmentId: FRONT, serialPlatePhotoAttachmentId: PLATE, photosComplete: true, condition: "good" })];
  total = 1;
  get.mockImplementation(routes);
  post.mockImplementation(postRoutes);
});

describe("P22-02 — access", () => {
  it("accessFor: write unlocks the form; bound loses import, delete and IoT; the operator never manages photos", () => {
    const can = (slugs: string[]) => (slug: string) => slugs.includes(slug);
    const base = { superAdmin: false, facilityBound: false };
    expect(accessFor({ ...base, canRead: can(["calibration"]), canWrite: can(["calibration"]) })).toEqual({
      read: true,
      write: true,
      importCsv: true,
      photosWrite: true,
      rows: { photos: true, ipm: false, edit: true, remove: true, iot: true },
    });
    expect(accessFor({ ...base, facilityBound: true, canRead: can(["calibration"]), canWrite: can(["calibration"]) })).toMatchObject({
      importCsv: false,
      photosWrite: true,
      rows: { remove: false, iot: false, edit: true },
    });
    expect(accessFor({ ...base, superAdmin: true, canRead: can(["calibration"]), canWrite: can(["calibration"]) }).photosWrite).toBe(false);
    expect(accessFor({ ...base, canRead: can(["calibration"]), canWrite: can([]) })).toMatchObject({ write: false, rows: { edit: false, remove: false } });
  });

  it("loading, then restricted: one h1 each, nothing loaded", () => {
    const { unmount } = renderPage();
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    unmount();
    grantPermissions({ sop: "write" });
    renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "Devices" })).toBeInTheDocument();
    expect(screen.getByText("You do not have access to the device register.")).toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });

  it("a reader sees the list and the photos, no write control; axe-clean", async () => {
    grantPermissions({ calibration: "read" });
    const { container } = renderPage();
    const table = await screen.findByRole("table");
    expect(within(table).getByText("Synthetic infusion pump")).toBeInTheDocument();
    expect(within(table).getByText("QR-000123")).toBeInTheDocument();
    expect(within(table).getByText("Infusion pump")).toBeInTheDocument();
    expect(within(table).getByText("Synthetic clinic")).toBeInTheDocument();
    expect(within(table).getByText("Room 101 · 1")).toBeInTheDocument();
    expect(within(table).getByText("Good")).toBeInTheDocument();
    expect(await within(table).findByRole("img", { name: "Front photo of Synthetic infusion pump" })).toHaveAttribute(
      "src",
      `/api/v1/attachments/${FRONT}/signed?token=t`,
    );
    expect(post).toHaveBeenCalledWith(`/api/v1/attachments/${FRONT}/signed-url`, { variant: "thumb" });
    expect(screen.queryByRole("button", { name: /Add device|Import CSV|Edit |Delete / })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "IoT ingest for Synthetic infusion pump" })).toBeInTheDocument();
    await screen.findByRole("option", { name: "Synthetic clinic" });
    expect(await axeViolations(container)).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Photos of Synthetic infusion pump" }));
    const dialog = await screen.findByRole("dialog", { name: "Photos of Synthetic infusion pump" });
    expect(within(dialog).queryByRole("button", { name: /Replace|Take or choose|Delete/ })).not.toBeInTheDocument();
    expect(await within(dialog).findByRole("img", { name: "Serial-plate photo of Synthetic infusion pump" })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("a facility-bound technician: no facility column or filter, no import, delete or IoT; its form omits the provider fields", async () => {
    bind({ calibration: "write" });
    renderPage();
    await screen.findByRole("table");
    expect(screen.queryByRole("columnheader", { name: "Facility" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Facility")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Import CSV" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Delete |IoT ingest/ })).not.toBeInTheDocument();
    expect(get).not.toHaveBeenCalledWith("/api/v1/client-facilities/options");
    expect(screen.getByText(/The devices of your facility/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add device" }));
    const dialog = await screen.findByRole("dialog", { name: "Add a device" });
    for (const label of ["QR sticker", "Status", "Calibration laboratory", "Facility"]) expect(within(dialog).queryByLabelText(label)).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText("A store")).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Bound pump" } });
    fireEvent.change(within(dialog).getByLabelText("Room"), { target: { value: "Ward A" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add device" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/v1/calibration-devices", { name: "Bound pump", room: { name: "Ward A", floor: null } }));
    expect(get).not.toHaveBeenCalledWith("/api/v1/warehouses", expect.anything());
    // A bound technician manages its devices' photos: the registration asks for them.
    expect(await screen.findByRole("dialog", { name: "Add the photos of Bound pump" })).toBeInTheDocument();
  });
});

describe("P22-02 — the list", () => {
  it("a failed read is an error with a retry, never an empty register; empty says so", async () => {
    grantPermissions({ calibration: "read" });
    get.mockImplementation((path: string, config?: { params?: Record<string, unknown> }) =>
      path === "/api/v1/calibration-devices" ? Promise.reject(httpError(500, "Boom")) : routes(path, config),
    );
    renderPage();
    expect(await screen.findByText(/Something went wrong/)).toBeInTheDocument();
    expect(screen.queryByText("No device matches.")).not.toBeInTheDocument();
    rows = [];
    total = 0;
    get.mockImplementation(routes);
    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    expect(await screen.findByText("No device matches.")).toBeInTheDocument();
  });

  it("rows without a photo, QR, type, condition or due date read as such; due states are badged; a failed link is a named placeholder", async () => {
    grantPermissions({ calibration: "read" });
    rows = [
      device({
        id: "d2",
        name: "Bare device",
        qrCode: null,
        deviceType: null,
        category: null,
        manufacturer: null,
        model: null,
        warehouse: null,
        clientFacility: null,
        serialNumber: null,
        photosComplete: false,
        frontPhotoAttachmentId: null,
        calibrationDue: { state: "overdue", nextCalibrationDate: "2026-01-01", source: "record", requestedBySessionId: null },
      }),
      device({ id: "d3", name: "Linked device", frontPhotoAttachmentId: "broken-link", status: null, calibrationDue: undefined, nextCalibrationDate: null }),
    ];
    total = 2;
    post.mockImplementation((path: string, body?: unknown) =>
      path.includes("broken-link") ? Promise.reject(httpError(404, "gone")) : postRoutes(path, body),
    );
    renderPage();
    const table = await screen.findByRole("table");
    expect(within(table).getByRole("img", { name: "No photo of Bare device" })).toBeInTheDocument();
    expect(within(table).getByText("No QR sticker yet")).toBeInTheDocument();
    expect(within(table).getByText("Photos missing")).toBeInTheDocument();
    expect(within(table).getAllByText("Not assessed")).toHaveLength(2);
    expect(within(table).getByText("Overdue")).toBeInTheDocument();
    expect(await within(table).findByRole("img", { name: "The photo cannot be shown right now" })).toBeInTheDocument();
  });

  it("each filter re-reads page 1 with its query; pages through the top-level meta", async () => {
    grantPermissions({ calibration: "read" });
    total = 45;
    renderPage();
    await screen.findByRole("table");
    expect(lastListQuery()).toEqual({ page: 1, limit: 20 });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(lastListQuery()).toEqual({ page: 2, limit: 20 }));
    expect(await screen.findByText("Page 2 of 3 · 45 devices")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    await waitFor(() => expect(lastListQuery()).toEqual({ page: 1, limit: 20 }));

    await screen.findByRole("option", { name: "Synthetic clinic" });
    fireEvent.change(screen.getByLabelText("Name, serial number or make"), { target: { value: "pump" } });
    fireEvent.change(screen.getByLabelText("QR sticker"), { target: { value: "42" } });
    fireEvent.change(screen.getByLabelText("Condition"), { target: { value: "broken" } });
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "retired" } });
    fireEvent.change(screen.getByLabelText("Calibration due"), { target: { value: "overdue" } });
    fireEvent.change(screen.getByLabelText("Facility"), { target: { value: CD_IDS.facility } });
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "Pumps" } });
    await screen.findByRole("option", { name: "Infusion pump" });
    fireEvent.change(screen.getByRole("combobox", { name: "Device type" }), { target: { value: "type-1" } });
    await waitFor(() =>
      expect(lastListQuery()).toEqual({
        page: 1,
        limit: 20,
        find: "pump",
        qrCode: "42",
        deviceTypeId: "type-1",
        condition: "broken",
        status: "retired",
        calibrationDue: "overdue",
        clientFacilityId: CD_IDS.facility,
        category: "Pumps",
      }),
    );
    expect(listQuery(INITIAL_FILTERS, 3)).toEqual({ page: 3, limit: 20 });
  });

  it("a global-search hand-off opens the list filtered to it", async () => {
    grantPermissions({ calibration: "read" });
    useSearchHandoffStore.getState().handOff("device", "SN-001");
    renderPage();
    await screen.findByRole("table");
    expect(lastListQuery()).toEqual({ page: 1, limit: 20, find: "SN-001" });
  });

  it("the type search sends its text; a failed type read is said", async () => {
    jest.useFakeTimers();
    try {
      grantPermissions({ calibration: "read" });
      renderPage();
      await act(async () => {
        jest.advanceTimersByTime(10);
      });
      fireEvent.change(screen.getByRole("searchbox", { name: "Search Device type" }), { target: { value: "inf" } });
      get.mockImplementation((path: string, config?: { params?: Record<string, unknown> }) =>
        path === "/api/v1/device-types" ? Promise.reject(httpError(500, "Boom")) : routes(path, config),
      );
      await act(async () => {
        jest.advanceTimersByTime(300);
      });
      expect(get).toHaveBeenCalledWith("/api/v1/device-types", { params: { status: "active", page: 1, limit: 50, search: "inf" } });
      expect(screen.getByText("The device types could not be loaded.")).toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("P22-02 — register and edit", () => {
  it("registers a device for a chosen facility, then asks for the two photos; Finish only with both", async () => {
    grantPermissions({ calibration: "write", vendors: "read" });
    renderPage();
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "Add device" }));
    const dialog = await screen.findByRole("dialog", { name: "Add a device" });
    await within(dialog).findByRole("option", { name: "Synthetic Lab" });
    expect(within(dialog).queryByRole("option", { name: "Ended clinic" })).not.toBeInTheDocument();
    expect(await axeViolations(dialog)).toEqual([]);

    fireEvent.click(within(dialog).getByRole("button", { name: "Add device" }));
    const problems = await within(dialog).findByText("Check these fields");
    expect(within(problems.closest("[role=alert]") as HTMLElement).getByText("Give the device a name of at least two characters.")).toBeInTheDocument();
    expect(within(dialog).getByText("Choose the facility this device belongs to.")).toBeInTheDocument();
    expect(post).not.toHaveBeenCalledWith("/api/v1/calibration-devices", expect.anything());

    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "New pump" } });
    fireEvent.change(within(dialog).getByLabelText("QR sticker"), { target: { value: "42" } });
    fireEvent.change(within(dialog).getByLabelText("Facility"), { target: { value: CD_IDS.facility } });
    fireEvent.change(within(dialog).getByLabelText("Condition"), { target: { value: "good" } });
    fireEvent.change(within(dialog).getByLabelText("Accessories"), { target: { value: "yes" } });
    fireEvent.change(within(dialog).getByLabelText("Calibration laboratory"), { target: { value: CD_IDS.vendor } });
    fireEvent.change(within(dialog).getByLabelText("Room"), { target: { value: "Ward B" } });
    fireEvent.change(within(dialog).getByLabelText("Floor"), { target: { value: "3" } });
    await within(dialog).findByRole("option", { name: "Infusion pump" });
    fireEvent.change(within(dialog).getByRole("combobox", { name: "Device type" }), { target: { value: "type-1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add device" }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/api/v1/calibration-devices", {
        name: "New pump",
        qrCode: "42",
        deviceTypeId: "type-1",
        condition: "good",
        accessoriesComplete: true,
        room: { name: "Ward B", floor: "3" },
        status: "active",
        calibrationVendorId: CD_IDS.vendor,
        clientFacilityId: CD_IDS.facility,
      }),
    );
    expect(useToastStore.getState().toasts[0]).toMatchObject({ type: "success", title: "New pump added" });

    const photos = await screen.findByRole("dialog", { name: "Add the photos of New pump" });
    const finish = within(photos).getByRole("button", { name: "Finish" });
    expect(finish).toBeDisabled();
    expect(within(photos).getByText("A required photo is still missing.")).toBeInTheDocument();
    const front = within(photos).getByLabelText("Take or choose: Front photo") as HTMLInputElement;
    expect(front).toHaveAttribute("accept", "image/jpeg,image/png");
    expect(front).toHaveAttribute("capture", "environment");
    fireEvent.change(front, { target: { files: [new File(["heic"], "IMG.HEIC", { type: "image/heic" })] } });
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/v1/calibration-devices/new-device/photos", expect.any(FormData)));
    const sent = post.mock.calls.find((c) => c[0] === "/api/v1/calibration-devices/new-device/photos")?.[1] as FormData;
    expect((sent.get("file") as File).type).toBe("image/jpeg");
    expect(prep).toHaveBeenCalled();
    fireEvent.change(within(photos).getByLabelText("Take or choose: Serial-plate photo"), {
      target: { files: [new File(["png"], "plate.png", { type: "image/png" })] },
    });
    expect(await within(photos).findByText("Both required photos are present.")).toBeInTheDocument();
    fireEvent.click(within(photos).getByRole("button", { name: "Finish" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Finish later closes the registration's photo step", async () => {
    grantPermissions({ calibration: "write" });
    renderPage();
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "Add device" }));
    const dialog = await screen.findByRole("dialog", { name: "Add a device" });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Later pump" } });
    fireEvent.change(await within(dialog).findByLabelText("Facility"), { target: { value: SELF } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add device" }));
    const photos = await screen.findByRole("dialog", { name: "Add the photos of Later pump" });
    fireEvent.click(within(photos).getByRole("button", { name: "Finish later" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("the operator registers without a photo step", async () => {
    grantSuperAdmin();
    renderPage();
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "Add device" }));
    const dialog = await screen.findByRole("dialog", { name: "Add a device" });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Operator pump" } });
    fireEvent.change(await within(dialog).findByLabelText("Facility"), { target: { value: SELF } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add device" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/v1/calibration-devices", expect.objectContaining({ name: "Operator pump" })));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("edits a device: prefilled, only the changes sent; a 409 is the server's explanation with the form kept; Cancel closes", async () => {
    grantPermissions({ calibration: "write" });
    put.mockRejectedValueOnce(httpError(409, "QR code TST000042 is already on device Other pump in Synthetic clinic.", "DEVICE_QR_TAKEN"));
    put.mockResolvedValueOnce(ok(device({ name: "Synthetic infusion pump" })));
    renderPage();
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "Edit Synthetic infusion pump" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit Synthetic infusion pump" });
    expect(within(dialog).getByLabelText("QR sticker")).toHaveValue("QR-000123");
    expect(within(dialog).getByLabelText("Room")).toHaveValue("Room 101");
    expect(within(dialog).getByText("Synthetic clinic")).toBeInTheDocument();
    expect(within(dialog).queryByRole("combobox", { name: "Facility" })).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("QR sticker"), { target: { value: "42" } });
    fireEvent.change(within(dialog).getByLabelText("Condition"), { target: { value: "not_good" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));
    expect(await within(dialog).findByText("QR code TST000042 is already on device Other pump in Synthetic clinic.")).toBeInTheDocument();
    expect(put).toHaveBeenLastCalledWith(`/api/v1/calibration-devices/${CD_IDS.device}`, { qrCode: "42", condition: "not_good" });
    expect(within(dialog).getByLabelText("QR sticker")).toHaveValue("42");

    fireEvent.click(within(dialog).getByLabelText("A store"));
    fireEvent.change(await within(dialog).findByLabelText("Store"), { target: { value: "store-1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(put).toHaveBeenLastCalledWith(`/api/v1/calibration-devices/${CD_IDS.device}`, { qrCode: "42", condition: "not_good", locationId: "store-1" }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(useToastStore.getState().toasts[0]).toMatchObject({ title: "Synthetic infusion pump saved" });

    fireEvent.click(screen.getByRole("button", { name: "Edit Synthetic infusion pump" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("a refusal without a message says it was not saved", async () => {
    grantPermissions({ calibration: "write" });
    put.mockRejectedValueOnce(new Error(""));
    renderPage();
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "Edit Synthetic infusion pump" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));
    expect(await within(dialog).findByText("The device could not be saved.")).toBeInTheDocument();
  });
});

describe("P22-02 — photos", () => {
  const openPhotos = async () => {
    grantPermissions({ calibration: "write" });
    renderPage();
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "Photos of Synthetic infusion pump" }));
    return screen.findByRole("dialog", { name: "Photos of Synthetic infusion pump" });
  };

  it("replaces a photo and deletes one after confirmation; the list reloads on close", async () => {
    const dialog = await openPhotos();
    expect(await within(dialog).findByRole("img", { name: "Front photo of Synthetic infusion pump" })).toHaveAttribute(
      "src",
      `/api/v1/attachments/${FRONT}/signed?token=t`,
    );
    expect(post).toHaveBeenCalledWith(`/api/v1/attachments/${FRONT}/signed-url`, { variant: "display" });
    fireEvent.change(within(dialog).getByLabelText("Replace: Front photo"), { target: { files: [new File(["j"], "f.jpg", { type: "image/jpeg" })] } });
    await waitFor(() => expect(post).toHaveBeenCalledWith(`/api/v1/calibration-devices/${CD_IDS.device}/photos`, expect.any(FormData)));
    expect(await within(dialog).findByRole("img", { name: "Front photo of Synthetic infusion pump" })).toHaveAttribute(
      "src",
      `/api/v1/attachments/${NEW_PHOTO}/signed?token=t`,
    );

    del.mockResolvedValueOnce(ok({ id: PLATE }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete: Serial-plate photo" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete photo" }));
    await waitFor(() => expect(del).toHaveBeenCalledWith(`/api/v1/calibration-devices/${CD_IDS.device}/photos/${PLATE}`));
    expect(await within(dialog).findByText("A required photo is still missing.")).toBeInTheDocument();
    const reads = get.mock.calls.filter((c) => c[0] === "/api/v1/calibration-devices").length;
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(get.mock.calls.filter((c) => c[0] === "/api/v1/calibration-devices").length).toBe(reads + 1));
  });

  it("explains a HEIC the browser cannot convert, a server refusal and a failed delete", async () => {
    const dialog = await openPhotos();
    prep.mockRejectedValueOnce(new PhotoPrepError("heic_unreadable"));
    fireEvent.change(within(dialog).getByLabelText("Replace: Front photo"), { target: { files: [new File(["h"], "a.heic", { type: "image/heic" })] } });
    expect(await within(dialog).findByText(/This photo is in HEIC format/)).toBeInTheDocument();
    expect(post).not.toHaveBeenCalledWith(expect.stringMatching(/\/photos$/), expect.anything());

    post.mockImplementationOnce(() => Promise.reject(httpError(422, "The photo could not be decoded.", "PHOTO_UNDECODABLE")));
    fireEvent.change(within(dialog).getByLabelText("Replace: Serial-plate photo"), { target: { files: [new File(["j"], "p.jpg", { type: "image/jpeg" })] } });
    expect(await within(dialog).findByText("The photo could not be decoded.")).toBeInTheDocument();

    post.mockImplementationOnce(() => Promise.reject(new Error("")));
    fireEvent.change(within(dialog).getByLabelText("Replace: Serial-plate photo"), { target: { files: [new File(["j"], "p.jpg", { type: "image/jpeg" })] } });
    expect(await within(dialog).findByText("The photo could not be uploaded.")).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText("Replace: Serial-plate photo"), { target: { files: [] } });

    del.mockRejectedValueOnce(new Error(""));
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete: Front photo" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete photo" }));
    expect(await within(dialog).findByText("The photo could not be deleted.")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Delete: Front photo" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(within(dialog).getByRole("button", { name: "Delete: Front photo" })).toBeInTheDocument();
  });

  it("the take-or-choose button opens the file picker", async () => {
    const dialog = await openPhotos();
    const input = within(dialog).getByLabelText("Replace: Front photo") as HTMLInputElement;
    const click = jest.spyOn(input, "click");
    fireEvent.click(within(dialog).getByRole("button", { name: "Replace: Front photo" }));
    expect(click).toHaveBeenCalled();
  });
});

describe("P22-02 — delete, import and IoT", () => {
  it("deletes after confirmation; a failure stays in the dialog", async () => {
    grantPermissions({ calibration: "write" });
    del.mockRejectedValueOnce(httpError(404, "Device not found"));
    del.mockResolvedValueOnce(ok({}));
    renderPage();
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "Delete Synthetic infusion pump" }));
    expect(await screen.findByText(/leaves the register/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete device" }));
    expect(await screen.findByText("Device not found")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete device" }));
    await waitFor(() => expect(useToastStore.getState().toasts[0]).toMatchObject({ title: "Synthetic infusion pump deleted" }));
    expect(del).toHaveBeenLastCalledWith(`/api/v1/calibration-devices/${CD_IDS.device}`);

    del.mockRejectedValueOnce(new Error(""));
    fireEvent.click(screen.getByRole("button", { name: "Delete Synthetic infusion pump" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete device" }));
    expect(await screen.findByText("The device could not be deleted.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  });

  it("imports a CSV: the report with at most five row errors (field errors as text), dismissible; a refusal is shown", async () => {
    grantPermissions({ calibration: "write" });
    renderPage();
    await screen.findByRole("table");
    const errors = [
      { row: 2, errors: [{ field: "name", message: "required" }] },
      ...[3, 4, 5, 6, 7].map((row) => ({ row, errors: "bad row" })),
    ];
    post.mockImplementationOnce(() => Promise.resolve({ data: { successCount: 1, failedCount: 6, totalCount: 7, errors } }));
    const input = screen.getByLabelText("CSV file of devices") as HTMLInputElement;
    const click = jest.spyOn(input, "click");
    fireEvent.click(screen.getByRole("button", { name: "Import CSV" }));
    expect(click).toHaveBeenCalled();
    fireEvent.change(input, { target: { files: [new File(["name\nA"], "devices.csv", { type: "text/csv" })] } });
    expect(await screen.findByText("1 of 7 devices imported, 6 refused.")).toBeInTheDocument();
    expect(screen.getByText("Row 2: name: required")).toBeInTheDocument();
    expect(screen.getByText("…and 1 more")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("CSV import finished")).not.toBeInTheDocument();

    post.mockImplementationOnce(() => Promise.reject(httpError(400, "Only CSV files")));
    fireEvent.change(input, { target: { files: [new File(["x"], "devices.csv", { type: "text/csv" })] } });
    expect(await screen.findByText("Only CSV files")).toBeInTheDocument();
    post.mockImplementationOnce(() => Promise.reject(new Error("")));
    fireEvent.change(input, { target: { files: [new File(["x"], "devices.csv", { type: "text/csv" })] } });
    expect(await screen.findByText("The CSV import failed.")).toBeInTheDocument();
    fireEvent.change(input, { target: { files: [] } });
  });

  it("a clean import reports success with no error list", async () => {
    grantPermissions({ calibration: "write" });
    renderPage();
    await screen.findByRole("table");
    post.mockImplementationOnce(() => Promise.resolve({ data: { successCount: 2, failedCount: 0, totalCount: 2, errors: [] } }));
    fireEvent.change(screen.getByLabelText("CSV file of devices"), { target: { files: [new File(["x"], "d.csv", { type: "text/csv" })] } });
    expect(await screen.findByText("2 of 2 devices imported, 0 refused.")).toBeInTheDocument();
  });

  it("opens the IoT dialog for a device", async () => {
    grantPermissions({ calibration: "read" });
    renderPage();
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "IoT ingest for Synthetic infusion pump" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /Close/ })[0] as HTMLElement);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

describe("P22-02 — language", () => {
  it("speaks Indonesian", async () => {
    grantPermissions({ calibration: "write" });
    renderPage("id");
    expect(screen.getByRole("heading", { level: 1, name: "Alat" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tambah alat" })).toBeInTheDocument();
    expect(await screen.findByText("Baik")).toBeInTheDocument();
  });
});
