/** @jest-environment jsdom */
/**
 * P22-06 — /dashboard/exports, by audience and through its flows. Real: the island, the paged reads,
 * the document mapping, the XLSX writer and the download. Mocked: the HTTP client, the dashboard
 * chrome, the PDF renderer (jsPDF is proved in node by `lib/export/inventoryPdf.test.ts`) and the
 * photo loader (`photoThumbs.test.ts`).
 *
 * Pins: `calibration` read gates the page; the size is shown BEFORE anything is built (one row read);
 * a PDF needs one facility for provider staff, never for a bound reader (its facility is the
 * server's); every page read in order with progress, then the file handed to the browser; photos
 * only on request and only up to the limit; Cancel; a failed read said, never an empty file; a
 * changed choice forgets the size; the recap's choices into the query and its file name; one h1;
 * Indonesian; axe.
 */
import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { unzipSync, strFromU8 } from "fflate";
import { axeViolations } from "@/tests/a11y/axe";
import { httpError } from "@/tests/support/httpError";
import { clearPermissions, grantPermissions } from "@/tests/support/permissions";

jest.mock("@/components/layouts/DashboardLayout", () => {
  return function DashboardLayout({ children }: { children: React.ReactNode }) {
    return <main>{children}</main>;
  };
});
jest.mock("@/api/client", () => {
  const actual = jest.requireActual("@/api/client");
  return { ...actual, api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() } };
});
jest.mock("@/lib/export/inventoryPdf", () => ({ renderInventoryPdf: jest.fn(async () => new ArrayBuffer(8)) }));
jest.mock("@/lib/export/photoThumbs", () => ({ loadThumbnails: jest.fn(async () => new Map([["p1", "data:image/jpeg;x"]])) }));
jest.mock("@/lib/export/pagedRead", () => ({ ...jest.requireActual("@/lib/export/pagedRead"), EXPORT_PAGE_PAUSE_MS: 0 }));

import { api } from "@/api/client";
import { useMenuStore } from "@/stores/menuStore";
import { MessagesProvider } from "@/i18n/MessagesProvider";
import { en } from "@/i18n/messages/en";
import { id as idMessages } from "@/i18n/messages/id";
import { renderInventoryPdf } from "@/lib/export/inventoryPdf";
import { loadThumbnails } from "@/lib/export/photoThumbs";
import { ExportsClient, PHOTO_ROW_LIMIT, recapProblem, todayText } from "../ExportsClient";

jest.setTimeout(20000);

const get = api.get as jest.Mock;
const pdf = renderInventoryPdf as jest.Mock;
const thumbs = loadThumbnails as jest.Mock;

const F1 = "5c000000-0000-4000-8000-000000000001";
const ok = <T,>(data: T, meta?: unknown) => ({ success: true, status: 200, message: "ok", data, ...(meta ? { meta } : {}) });

let deviceTotal: number;
let recordTotal: number;
let devicePage: ((page: number) => Promise<unknown>) | null;

const device = (i: number) => ({
  id: `d${String(i)}`,
  tenantId: "t",
  name: `Synthetic device ${String(i)}`,
  serialNumber: null,
  manufacturer: null,
  model: null,
  category: null,
  status: "active",
  locationId: null,
  installationDate: null,
  nextCalibrationDate: null,
  calibrationIntervalDays: null,
  remarks: null,
  iotEnabled: false,
  isDeleted: false,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  qrCode: `QR-${String(1000 - i)}`,
  clientFacility: { id: F1, name: "Synthetic clinic", code: "SC" },
  frontPhotoAttachmentId: i === 1 ? "p1" : null,
  condition: "good",
});

const listOf = <T,>(total: number, make: (i: number) => T, params: Record<string, unknown>) => {
  const page = Number(params["page"]);
  const limit = Number(params["limit"]);
  const start = (page - 1) * limit;
  const rows = Array.from({ length: Math.max(0, Math.min(limit, total - start)) }, (_, i) => make(start + i + 1));
  return ok(rows, { total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) });
};

const routes = (path: string, config?: { params?: Record<string, unknown> }) => {
  const params = config?.params ?? {};
  if (path === "/api/v1/client-facilities/options") return Promise.resolve(ok([{ id: F1, name: "Synthetic clinic", code: "SC", status: "active", isSelf: false }]));
  if (path === "/api/v1/calibration-devices") {
    if (devicePage && Number(params["limit"]) > 1) return devicePage(Number(params["page"]));
    return Promise.resolve(listOf(deviceTotal, device, params));
  }
  if (path === "/api/v1/calibration-records")
    return Promise.resolve(
      listOf(recordTotal, (i) => ({ id: `r${String(i)}`, calibrationDate: "2026-10-01", createdAt: "2026-10-01T03:00:00Z", device: { id: "d", name: `Device ${String(i)}`, serialNumber: null, manufacturer: null, model: null } }), params),
    );
  return Promise.reject(new Error(`unexpected GET ${path}`));
};

/** The file the last download handed to the browser. */
let downloads: { name: string; blob: Blob }[];

const renderPage = (locale: "en" | "id" = "en") =>
  render(
    <MessagesProvider locale={locale} messages={locale === "en" ? en : idMessages}>
      <ExportsClient languageForm={<div>language</div>} />
    </MessagesProvider>,
  );

const section = (name: string) => screen.getByRole("heading", { name }).closest("div") as HTMLElement;
const calls = (path: string) => get.mock.calls.filter((c) => c[0] === path).map((c) => (c[1] as { params: Record<string, unknown> }).params);

beforeEach(() => {
  jest.clearAllMocks();
  clearPermissions();
  deviceTotal = 450;
  recordTotal = 3;
  devicePage = null;
  downloads = [];
  get.mockImplementation(routes);
  let blob: Blob | null = null;
  Object.assign(URL, {
    createObjectURL: jest.fn((b: Blob) => {
      blob = b;
      return "blob:x";
    }),
    revokeObjectURL: jest.fn(),
  });
  jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    if (blob) downloads.push({ name: this.download, blob });
  });
});

afterEach(() => jest.restoreAllMocks());

describe("P22-06 — access", () => {
  it("loading, then restricted without calibration read: one h1 each, nothing read", () => {
    const { unmount } = renderPage();
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    unmount();
    grantPermissions({ ipm: "read" });
    renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "Exports" })).toBeInTheDocument();
    expect(screen.getByText("You do not have access to the device and calibration exports.")).toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });

  it("a reader sees both exports; axe-clean; Indonesian", async () => {
    grantPermissions({ calibration: "read" });
    const { container, unmount } = renderPage();
    expect(screen.getByRole("heading", { level: 2, name: "Inventory list" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Calibration recap" })).toBeInTheDocument();
    await screen.findAllByRole("option", { name: "Synthetic clinic" });
    expect(await axeViolations(container)).toEqual([]);
    unmount();
    renderPage("id");
    expect(screen.getByRole("heading", { level: 1, name: "Ekspor" })).toBeInTheDocument();
  });
});

describe("P22-06 — the inventory", () => {
  it("a PDF needs a facility; the size first (one row read), then every page read, the PDF built and downloaded", async () => {
    grantPermissions({ calibration: "read" });
    renderPage();
    const inv = section("Inventory list");
    expect(within(inv).getByText("A PDF holds one facility: choose it first.")).toBeInTheDocument();
    expect(within(inv).getByRole("button", { name: "Check the size" })).toBeDisabled();
    await within(inv).findByRole("option", { name: "Synthetic clinic" });
    fireEvent.change(within(inv).getByLabelText("Facility"), { target: { value: F1 } });
    fireEvent.click(within(inv).getByRole("button", { name: "Check the size" }));
    expect(await within(inv).findByText(/^450 rows, read in 3 requests; the file will be about/)).toBeInTheDocument();
    expect(calls("/api/v1/calibration-devices")).toEqual([{ page: 1, limit: 1, sort: "id", clientFacilityId: F1 }]);
    fireEvent.click(within(inv).getByRole("button", { name: "Build and download" }));
    expect(await within(inv).findByText("Done: the file was handed to your browser.")).toBeInTheDocument();
    expect(calls("/api/v1/calibration-devices").slice(1).map((p) => [p["page"], p["limit"]])).toEqual([
      [1, 200],
      [2, 200],
      [3, 200],
    ]);
    const input = pdf.mock.calls[0]?.[0] as { variant: string; facilityName: string; rows: { qrCode: string }[]; photos: unknown; labels: { columns: string[] } };
    expect(input.variant).toBe("provider");
    expect(input.facilityName).toBe("Synthetic clinic");
    expect(input.rows).toHaveLength(450);
    expect(input.rows[0]?.qrCode).toBe("QR-550");
    expect(input.photos).toBeNull();
    expect(input.labels.columns).toHaveLength(14);
    expect(thumbs).not.toHaveBeenCalled();
    expect(downloads[0]?.name).toBe(`inventaris_Synthetic_clinic_${todayText()}.pdf`);
    expect(downloads[0]?.blob.type).toBe("application/pdf");
  });

  it("photos on request: loaded with progress for a small facility; above the limit, said and left out", async () => {
    grantPermissions({ calibration: "read" });
    deviceTotal = 3;
    renderPage();
    const inv = section("Inventory list");
    await within(inv).findByRole("option", { name: "Synthetic clinic" });
    fireEvent.change(within(inv).getByLabelText("Facility"), { target: { value: F1 } });
    fireEvent.click(within(inv).getByLabelText("Include the photos (thumbnails)"));
    fireEvent.click(within(inv).getByRole("button", { name: "Check the size" }));
    await within(inv).findByText(/^3 rows/);
    fireEvent.click(within(inv).getByRole("button", { name: "Build and download" }));
    await within(inv).findByText("Done: the file was handed to your browser.");
    expect(thumbs).toHaveBeenCalledWith(["p1"], expect.objectContaining({ signal: expect.any(AbortSignal) }));
    (thumbs.mock.calls[0]?.[1] as { onDone: (d: number, t: number) => void }).onDone(1, 1);
    expect((pdf.mock.calls[0]?.[0] as { photos: Map<string, string> }).photos.get("p1")).toBe("data:image/jpeg;x");

    deviceTotal = PHOTO_ROW_LIMIT + 1;
    fireEvent.click(within(inv).getByRole("button", { name: "Check the size" }));
    expect(await within(inv).findByText(`Above ${String(PHOTO_ROW_LIMIT)} devices the PDF is built without photos; export each facility on its own to keep them.`)).toBeInTheDocument();
    fireEvent.click(within(inv).getByRole("button", { name: "Build and download" }));
    await within(inv).findByText("Done: the file was handed to your browser.");
    expect(thumbs).toHaveBeenCalledTimes(1);
  });

  it("the facility layout has 9 columns; a changed choice forgets the size", async () => {
    grantPermissions({ calibration: "read" });
    deviceTotal = 2;
    renderPage();
    const inv = section("Inventory list");
    await within(inv).findByRole("option", { name: "Synthetic clinic" });
    fireEvent.change(within(inv).getByLabelText("Facility"), { target: { value: F1 } });
    fireEvent.click(within(inv).getByLabelText("Facility (device columns only)"));
    fireEvent.click(within(inv).getByRole("button", { name: "Check the size" }));
    await within(inv).findByText(/^2 rows/);
    fireEvent.click(within(inv).getByLabelText("Provider (technician, inventory date, signatures)"));
    expect(within(inv).queryByText(/^2 rows/)).not.toBeInTheDocument();
    fireEvent.click(within(inv).getByLabelText("Facility (device columns only)"));
    fireEvent.click(within(inv).getByRole("button", { name: "Check the size" }));
    await within(inv).findByText(/^2 rows/);
    fireEvent.click(within(inv).getByRole("button", { name: "Build and download" }));
    await within(inv).findByText("Done: the file was handed to your browser.");
    expect((pdf.mock.calls[0]?.[0] as { variant: string; labels: { columns: string[] } }).labels.columns).toHaveLength(9);
  });

  it("XLSX for every facility: no facility needed; a real workbook downloaded", async () => {
    grantPermissions({ calibration: "read" });
    deviceTotal = 2;
    renderPage();
    const inv = section("Inventory list");
    fireEvent.click(within(inv).getByLabelText("XLSX (spreadsheet)"));
    expect(within(inv).queryByText("A PDF holds one facility: choose it first.")).not.toBeInTheDocument();
    fireEvent.click(within(inv).getByRole("button", { name: "Check the size" }));
    await within(inv).findByText(/^2 rows/);
    expect(calls("/api/v1/calibration-devices")[0]).toEqual({ page: 1, limit: 1, sort: "id" });
    fireEvent.click(within(inv).getByRole("button", { name: "Build and download" }));
    await within(inv).findByText("Done: the file was handed to your browser.");
    expect(downloads[0]?.name).toBe(`inventaris_${todayText()}.xlsx`);
    const bytes = await new Promise<ArrayBuffer>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.readAsArrayBuffer(downloads[0]?.blob as Blob);
    });
    const parts = unzipSync(new Uint8Array(bytes));
    expect(strFromU8(parts["xl/worksheets/sheet1.xml"] as Uint8Array)).toContain("Synthetic device 1");
  });

  it("Cancel stops the reads and says so; a failed read is said, not an empty file", async () => {
    grantPermissions({ calibration: "read" });
    let release: (() => void) | null = null;
    devicePage = (page) =>
      page === 1
        ? Promise.resolve(listOf(450, device, { page: 1, limit: 200 }))
        : new Promise((resolve) => {
            release = () => resolve(listOf(450, device, { page, limit: 200 }));
          });
    renderPage();
    const inv = section("Inventory list");
    fireEvent.click(within(inv).getByLabelText("XLSX (spreadsheet)"));
    fireEvent.click(within(inv).getByRole("button", { name: "Check the size" }));
    await within(inv).findByText(/^450 rows/);
    fireEvent.click(within(inv).getByRole("button", { name: "Build and download" }));
    expect(await within(inv).findByText("Rows read: 200 of 450")).toBeInTheDocument();
    expect(within(inv).getByRole("progressbar")).toBeInTheDocument();
    await waitFor(() => expect(release).not.toBeNull());
    fireEvent.click(within(inv).getByRole("button", { name: "Cancel" }));
    await act(async () => release?.());
    expect(await within(inv).findByText("Cancelled. Nothing was downloaded.")).toBeInTheDocument();
    expect(downloads).toHaveLength(0);

    devicePage = () => Promise.reject(httpError(500, "Server down"));
    fireEvent.click(within(inv).getByRole("button", { name: "Build and download" }));
    expect(await within(inv).findByText("Server down")).toBeInTheDocument();
    get.mockImplementation((path: string) => (path === "/api/v1/calibration-devices" ? Promise.reject(new Error("")) : routes(path)));
    fireEvent.click(within(inv).getByRole("button", { name: "Check the size" }));
    expect(await within(inv).findByText("The export could not be made.")).toBeInTheDocument();
  });

  it("nothing to export: said, no build", async () => {
    grantPermissions({ calibration: "read" });
    deviceTotal = 0;
    renderPage();
    const inv = section("Inventory list");
    fireEvent.click(within(inv).getByLabelText("XLSX (spreadsheet)"));
    fireEvent.click(within(inv).getByRole("button", { name: "Check the size" }));
    expect(await within(inv).findByText("Nothing to export for this choice.")).toBeInTheDocument();
    expect(within(inv).queryByRole("button", { name: "Build and download" })).not.toBeInTheDocument();
  });

  it("a bound reader: no facility choice, a PDF of its own facility (named from its rows)", async () => {
    useMenuStore.setState({ effectivePermissions: { superAdmin: false, facilityBound: true, permissions: { calibration: "read" } } });
    deviceTotal = 1;
    renderPage();
    const inv = section("Inventory list");
    expect(screen.queryByLabelText("Facility")).not.toBeInTheDocument();
    fireEvent.click(within(inv).getByRole("button", { name: "Check the size" }));
    await within(inv).findByText(/^1 rows/);
    fireEvent.click(within(inv).getByRole("button", { name: "Build and download" }));
    await within(inv).findByText("Done: the file was handed to your browser.");
    expect((pdf.mock.calls[0]?.[0] as { facilityName: string }).facilityName).toBe("Synthetic clinic");
    expect(get).not.toHaveBeenCalledWith("/api/v1/client-facilities/options", expect.anything());
  });
});

describe("P22-06 — the calibration recap", () => {
  it("recapProblem: both days, in order; none for the latest list", () => {
    expect(recapProblem({ dateField: "calibration", fromDay: "", toDay: "2026-10-01", latestOnly: false })).toBe("days");
    expect(recapProblem({ dateField: "calibration", fromDay: "2026-10-02", toDay: "2026-10-01", latestOnly: false })).toBe("order");
    expect(recapProblem({ dateField: "created", fromDay: "2026-10-01", toDay: "2026-10-01", latestOnly: false })).toBeNull();
    expect(recapProblem({ dateField: "created", fromDay: "", toDay: "", latestOnly: true })).toBeNull();
  });

  it("a range by input date into the query and the upstream's file name; the latest list without dates; a facility narrows", async () => {
    grantPermissions({ calibration: "read" });
    renderPage();
    const recap = section("Calibration recap");
    await within(recap).findByRole("option", { name: "Synthetic clinic" });
    fireEvent.change(within(recap).getByLabelText("By"), { target: { value: "created" } });
    fireEvent.change(within(recap).getByLabelText("From"), { target: { value: "2026-10-05" } });
    fireEvent.change(within(recap).getByLabelText("Until"), { target: { value: "2026-10-01" } });
    expect(within(recap).getByText("The first day must not be after the last.")).toBeInTheDocument();
    fireEvent.change(within(recap).getByLabelText("From"), { target: { value: "2026-10-01" } });
    fireEvent.change(within(recap).getByLabelText("Until"), { target: { value: "2026-10-31" } });
    fireEvent.change(within(recap).getByLabelText("Facility"), { target: { value: F1 } });
    fireEvent.click(within(recap).getByRole("button", { name: "Check the size" }));
    await within(recap).findByText(/^3 rows/);
    expect(calls("/api/v1/calibration-records")[0]).toEqual({ page: 1, limit: 1, sort: "createdAt", dateField: "created", fromDay: "2026-10-01", toDay: "2026-10-31", clientFacilityId: F1 });
    fireEvent.click(within(recap).getByRole("button", { name: "Build and download" }));
    await within(recap).findByText("Done: the file was handed to your browser.");
    expect(downloads[0]?.name).toBe("rekap_rentang_input_2026-10-01_sd_2026-10-31.xlsx");

    fireEvent.click(within(recap).getByLabelText("The latest calibration of every device (no dates)"));
    expect(within(recap).queryByLabelText("From")).not.toBeInTheDocument();
    fireEvent.click(within(recap).getByRole("button", { name: "Check the size" }));
    await within(recap).findByText(/^3 rows/);
    expect(calls("/api/v1/calibration-records").at(-1)).toEqual({ page: 1, limit: 1, sort: "createdAt", latestOnly: true, clientFacilityId: F1 });
  });
});
