/** @jest-environment jsdom */
/**
 * The calibration records screen (Compliance & Quality Control), against the
 * backend contract (calibrationRecords.controller.js list → sendResult with
 * rows in `data` and a top-level `meta`).
 *
 * Real: the page, useCalibration, the calibration and device stores and
 * services, the records table, filters and the record modal. Mocked: the HTTP
 * client, the dashboard chrome, and the certificate table and certificate
 * modals — certificates are another area's work (PDF rendering is moving).
 */
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AxiosError, AxiosHeaders } from "axios";
import { axeViolations } from "@/tests/a11y/axe";

jest.mock("@/components/layouts/DashboardLayout", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

jest.mock("@/api/client", () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

jest.mock("../components/CertificatesTable", () => ({
  __esModule: true,
  default: () => <p>certificates table</p>,
}));

type CertModalProps = { isOpen: boolean; selectedRecordForCert?: { id: string } | null; form?: { validUntil?: string } };
jest.mock("../components/CreateCertModal", () => ({
  __esModule: true,
  default: ({ isOpen, selectedRecordForCert, form }: CertModalProps) =>
    isOpen ? (
      <div role="dialog" aria-label="Create certificate">
        {selectedRecordForCert?.id} valid until {form?.validUntil}
      </div>
    ) : null,
}));
jest.mock("../components/SignCertModal", () => ({ __esModule: true, default: () => null }));
jest.mock("../components/RevokeCertModal", () => ({ __esModule: true, default: () => null }));
jest.mock("../components/ApproveCertModal", () => ({ __esModule: true, default: () => null }));

import { api } from "@/api/client";
import CalibrationPage from "../page";
import { useAuthStore } from "@/stores/authStore";
import { useMenuStore } from "@/stores/menuStore";
import { useCalibrationStore } from "@/stores/calibrationStore";
import { useDeviceStore } from "@/stores/deviceStore";
import type { User } from "@/types";

// Whole-page renders with the real stores; findBy* waits up to 5 s (jest.setup.ts).
jest.setTimeout(20000);

const get = api.get as jest.Mock;
const post = api.post as jest.Mock;

const envelope = (rows: unknown, meta?: Record<string, number>) => ({
  success: true,
  status: 200,
  message: "ok",
  data: rows,
  ...(meta ? { meta } : {}),
});

const httpError = (status: number, message: string) =>
  new AxiosError(message, "ERR_BAD_REQUEST", undefined, undefined, {
    status,
    statusText: "",
    data: { success: false, status, message },
    headers: {},
    config: { headers: new AxiosHeaders() },
  });

const record = (patch: Record<string, unknown> = {}) => ({
  id: "rec-1",
  tenantId: "t-1",
  deviceId: "dev-1",
  performedBy: "u-1",
  calibrationDate: "2026-03-10T00:00:00.000Z",
  standard: "ISO 17025",
  isCompliant: true,
  notes: "within limits",
  createdAt: "2026-03-10T00:00:00.000Z",
  updatedAt: "2026-03-10T00:00:00.000Z",
  device: { id: "dev-1", name: "Fluke 714B", serialNumber: "SN-1", manufacturer: "Fluke", model: "714B" },
  performer: { id: "u-1", firstName: "Ada", lastName: "Lovelace" },
  ...patch,
});

const device = { id: "dev-1", name: "Fluke 714B", serialNumber: "SN-1", status: "active", createdAt: "", updatedAt: "" };
const stats = { totalCertificates: 7, byStatus: { signed: 3, pending_approval: 1, approved: 1, revoked: 2 }, byType: {} };

let records: unknown[] = [];

const backend = () => {
  get.mockImplementation(async (url: string) => {
    switch (url) {
      case "/api/v1/calibration-devices":
        return envelope([device], { total: 1, page: 1, limit: 100, totalPages: 1 });
      case "/api/v1/certificates/stats":
        return envelope(stats);
      case "/api/v1/calibration-records":
        return envelope(records, { total: records.length, page: 1, limit: 10, totalPages: 1 });
      case "/api/v1/certificates":
        return envelope([], { total: 0, page: 1, limit: 10, totalPages: 1 });
      default:
        throw new Error(`unexpected GET ${url}`);
    }
  });
};

type Grants = Record<string, "read" | "write">;
const grant = (permissions: Grants | null, superAdmin = false) =>
  useMenuStore.setState({ effectivePermissions: permissions === null ? null : { superAdmin, permissions } });

const recordCalls = () => get.mock.calls.filter(([url]) => url === "/api/v1/calibration-records");
const certCalls = () => get.mock.calls.filter(([url]) => url === "/api/v1/certificates");

/**
 * ADR-102: the page's write actions follow the EFFECTIVE permissions (loaded
 * with the menu), not the role name — so a role is set up with the grants the
 * seed gives it: the admin roles hold `equipment` write (inherited by
 * `calibration` and `certificate`), every other seeded role `equipment` read.
 */
const EQUIPMENT_WRITERS = ["SUPERADMIN", "HEALTHCARE ADMIN", "CALIBRATOR ADMIN"];
const as = (roleName: string) => {
  useAuthStore.setState({
    user: { id: "u-1", username: "ada", email: "a@x.test", role: { id: "r", name: roleName } } as User,
  });
  const access = EQUIPMENT_WRITERS.includes(roleName) ? "write" : "read";
  useMenuStore.setState({
    effectivePermissions: { superAdmin: false, permissions: { calibration: access, certificate: access } },
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  records = [record(), record({ id: "rec-2", isCompliant: false, notes: undefined, standard: undefined, performer: undefined, device: undefined })];
  useCalibrationStore.setState({ calibrations: null, certificates: null, certificateStats: null, isLoading: false, error: null });
  useDeviceStore.setState({ devices: null, isLoading: false, error: null });
  as("HEALTHCARE ADMIN");
  backend();
});

const renderPage = async () => {
  const view = render(<CalibrationPage />);
  await screen.findByText("within limits");
  return view;
};

describe("calibration page — records list states", () => {
  it("shows a skeleton, not the empty state, while every request is in flight", async () => {
    get.mockImplementation(() => new Promise(() => undefined));
    const { container } = render(<CalibrationPage />);
    await waitFor(() => expect(recordCalls()).toHaveLength(1));

    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
    expect(screen.queryByText("No calibration records found")).not.toBeInTheDocument();
  });

  it("renders the records, the certificate statistics, and passes an accessibility check", async () => {
    const { container } = await renderPage();

    const row = screen.getByText("within limits").closest("tr") as HTMLElement;
    expect(within(row).getByText("Fluke 714B")).toBeInTheDocument();
    expect(within(row).getByText("SN: SN-1")).toBeInTheDocument();
    expect(within(row).getByText("Compliant")).toBeInTheDocument();
    expect(within(row).getByText("Ada Lovelace")).toBeInTheDocument();

    const second = screen.getByText("Unknown Device").closest("tr") as HTMLElement;
    expect(within(second).getByText("Non-Compliant")).toBeInTheDocument();
    expect(within(second).getByText("Standard Limits")).toBeInTheDocument();

    // Statistics card: 7 total, 3 signed, 1+1 awaiting, 2 revoked.
    expect(screen.getByText("Total Certs").nextSibling).toHaveTextContent("7");
    expect(screen.getByText("Awaiting Signatures").nextSibling).toHaveTextContent("2");
    expect(screen.getByText("Revoked Certs").nextSibling).toHaveTextContent("2");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("renders the empty state when there are no records", async () => {
    records = [];
    const { container } = render(<CalibrationPage />);

    expect(await screen.findByText("No calibration records found")).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("a FAILED records load shows the backend's error, never the empty state", async () => {
    get.mockImplementation(async (url: string) => {
      if (url === "/api/v1/calibration-records") throw httpError(500, "Records store unavailable");
      if (url === "/api/v1/certificates/stats") return envelope(stats);
      return envelope([], { total: 0, page: 1, limit: 10, totalPages: 1 });
    });
    const { container } = render(<CalibrationPage />);

    expect(await screen.findByText("Records store unavailable")).toBeInTheDocument();
    await waitFor(() => expect(certCalls()).toHaveLength(1));
    expect(screen.queryByText("No calibration records found")).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe("calibration page — permissions (ADR-102)", () => {
  it("read access on both menus can read records but cannot record or certify", async () => {
    grant({ calibration: "read", certificate: "read" });
    await renderPage();

    expect(screen.queryByRole("button", { name: /Record Calibration/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Certify/ })).not.toBeInTheDocument();
  });

  it("permissions not loaded (or failed to load) offer neither action", async () => {
    grant(null);
    await renderPage();

    expect(screen.queryByRole("button", { name: /Record Calibration/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Certify/ })).not.toBeInTheDocument();
  });

  it("write on `calibration` only records; Certify needs `certificate` write", async () => {
    grant({ calibration: "write", certificate: "read" });
    await renderPage();

    expect(screen.getByRole("button", { name: /Record Calibration/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Certify/ })).not.toBeInTheDocument();
  });

  it("write on `certificate` only certifies, and cannot record", async () => {
    grant({ calibration: "read", certificate: "write" });
    await renderPage();

    expect(screen.queryByRole("button", { name: /Record Calibration/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Certify/ })).toBeInTheDocument();
  });

  it("the platform super admin gets both actions whatever the grants", async () => {
    grant({}, true);
    await renderPage();

    expect(screen.getByRole("button", { name: /Record Calibration/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Certify/ })).toBeInTheDocument();
  });

  it("with write access only a COMPLIANT record offers Certify, which opens the certificate dialog for it", async () => {
    await renderPage();

    const certify = screen.getAllByRole("button", { name: /Certify/ });
    expect(certify).toHaveLength(1);
    expect(within(screen.getByText("Unknown Device").closest("tr") as HTMLElement).queryByRole("button")).toBeNull();

    fireEvent.click(certify[0]);
    // One year of validity from the calibration date is the default.
    expect(screen.getByRole("dialog", { name: "Create certificate" })).toHaveTextContent("rec-1 valid until 2027-03-10");
  });
});

describe("calibration page — filters and tabs", () => {
  it("the device and compliance filters re-query the records from page 1", async () => {
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: "All Calibration Devices" }));
    fireEvent.click(screen.getByRole("option", { name: "Fluke 714B" }));
    await waitFor(() =>
      expect(recordCalls().at(-1)?.[1]).toEqual({ params: expect.objectContaining({ deviceId: "dev-1", page: 1 }) }),
    );

    fireEvent.click(screen.getByRole("button", { name: "All Compliance Statuses" }));
    fireEvent.click(screen.getByRole("option", { name: "Non-Compliant" }));
    await waitFor(() =>
      expect(recordCalls().at(-1)?.[1]).toEqual({ params: expect.objectContaining({ deviceId: "dev-1", isCompliant: false }) }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Non-Compliant" }));
    fireEvent.click(screen.getByRole("option", { name: "All Compliance Statuses" }));
    await waitFor(() =>
      expect(recordCalls().at(-1)?.[1]).toEqual({ params: expect.objectContaining({ isCompliant: null }) }),
    );
  });

  it("the certificates tab swaps in the certificate filters, which query by number and status", async () => {
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Compliance Certificates" }));
    expect(screen.getByText("certificates table")).toBeInTheDocument();
    expect(screen.queryByText("within limits")).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Search by certificate number..."), { target: { value: "CERT-9" } });
    await waitFor(() =>
      expect(certCalls().at(-1)?.[1]).toEqual({ params: expect.objectContaining({ certificateNumber: "CERT-9", page: 1 }) }),
    );

    fireEvent.click(screen.getByRole("button", { name: "All Certificate Statuses" }));
    fireEvent.click(screen.getByRole("option", { name: "Signed & Locked" }));
    await waitFor(() =>
      expect(certCalls().at(-1)?.[1]).toEqual({ params: expect.objectContaining({ status: ["signed"] }) }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Signed & Locked" }));
    fireEvent.click(screen.getByRole("option", { name: "All Certificate Statuses" }));
    await waitFor(() =>
      expect(certCalls().at(-1)?.[1]).toEqual({ params: expect.objectContaining({ status: undefined }) }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Calibration Records" }));
    expect(await screen.findByText("within limits")).toBeInTheDocument();
  });
});

describe("calibration page — recording a calibration", () => {
  const openModal = () => {
    fireEvent.click(screen.getByRole("button", { name: /Record Calibration/ }));
    return screen.getByRole("dialog", { name: "Record Calibration Audit Log" });
  };

  it("posts the record with the deviation as a number, closes, and reloads records and statistics", async () => {
    post.mockResolvedValue({ success: true, status: 201, message: "created", data: record({ id: "rec-3" }) });
    await renderPage();
    const dialog = openModal();
    expect(await axeViolations(dialog)).toEqual([]);

    fireEvent.click(within(dialog).getByRole("button", { name: /Calibration Device/ }));
    fireEvent.click(within(dialog).getByRole("option", { name: "Fluke 714B (SN: SN-1)" }));
    fireEvent.change(within(dialog).getByLabelText("Calibration Date"), { target: { value: "2026-04-01" } });
    fireEvent.change(within(dialog).getByLabelText("Testing Standard"), { target: { value: "IEC 60601" } });
    fireEvent.change(within(dialog).getByLabelText("Test Temp Reading (°C)"), { target: { value: "21.4" } });
    fireEvent.change(within(dialog).getByLabelText("Ref Humidity (%)"), { target: { value: "45" } });
    fireEvent.change(within(dialog).getByLabelText(/Deviation Variance/), { target: { value: "0.25" } });
    fireEvent.click(within(dialog).getByLabelText("Non-Compliant / Fail"));
    fireEvent.change(within(dialog).getByLabelText("Audit Notes / Findings"), { target: { value: "drift" } });

    const statsBefore = get.mock.calls.filter(([u]) => u === "/api/v1/certificates/stats").length;
    fireEvent.click(within(dialog).getByRole("button", { name: "Log Record" }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith("/api/v1/calibration-records", {
      deviceId: "dev-1",
      calibrationDate: "2026-04-01",
      dueDate: "",
      standard: "IEC 60601",
      results: { temperatureReading: "21.4", humidityReading: "45", deviation: 0.25 },
      isCompliant: false,
      notes: "drift",
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() =>
      expect(get.mock.calls.filter(([u]) => u === "/api/v1/certificates/stats").length).toBeGreaterThan(statsBefore),
    );
  });

  it("switching the compliance radio back to Pass is sent as compliant", async () => {
    post.mockResolvedValue({ success: true, status: 201, message: "created", data: record() });
    await renderPage();
    const dialog = openModal();

    fireEvent.change(within(dialog).getByLabelText("Calibration Date"), { target: { value: "2026-04-01" } });
    fireEvent.change(within(dialog).getByLabelText(/Deviation Variance/), { target: { value: "0" } });
    fireEvent.click(within(dialog).getByLabelText("Non-Compliant / Fail"));
    fireEvent.click(within(dialog).getByLabelText("Compliant / Pass"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Log Record" }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0][1]).toMatchObject({ isCompliant: true, results: { deviation: 0 } });
  });

  it("a refused record (400) keeps the dialog open and shows the backend's message", async () => {
    post.mockRejectedValue(httpError(400, "deviceId is required"));
    await renderPage();
    const dialog = openModal();
    fireEvent.change(within(dialog).getByLabelText("Calibration Date"), { target: { value: "2026-04-01" } });
    fireEvent.change(within(dialog).getByLabelText(/Deviation Variance/), { target: { value: "0.1" } });

    fireEvent.click(within(dialog).getByRole("button", { name: "Log Record" }));

    expect(await screen.findByText("deviceId is required")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Record Calibration Audit Log" })).toBeInTheDocument();
  });

  it("Cancel closes the dialog without a request", async () => {
    await renderPage();
    const dialog = openModal();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });
});
