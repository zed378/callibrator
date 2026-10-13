/** @jest-environment jsdom */
/**
 * C-4 (P26-01 § 9; P24-01) — stage 2 on the SQL-dump import page. Real: the page's island, the
 * transform section, the service and the typed client. Mocked: the HTTP client and the dashboard
 * chrome.
 *
 * Pins: a loaded run offers the transform with a provider tenant chosen from the ACTIVE tenants
 * (`GET /tenants/all`); the request is `POST …/:id/transform { providerTenantId }`; while the server's
 * steps are not built its 409 `TRANSFORM_NOT_AVAILABLE` is shown as the run's state, in the server's
 * words, not as a generic failure; any other refusal is a failure in the server's words; a queued
 * transform is announced and the run's state shown; the button waits while one is in progress; a
 * failed transform says why; a finished one shows its rows per step; Indonesian; axe.
 */
import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { axeViolations } from "@/tests/a11y/axe";
import { httpError } from "@/tests/support/httpError";

jest.mock("@/components/layouts/DashboardLayout", () => {
  return function DashboardLayout({ children }: { children: React.ReactNode }) {
    return <main>{children}</main>;
  };
});
jest.mock("@/api/client", () => {
  const actual = jest.requireActual("@/api/client");
  return { ...actual, api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() } };
});

import { api } from "@/api/client";
import { useAuthStore } from "@/stores/authStore";
import { MessagesProvider } from "@/i18n/MessagesProvider";
import { id as idMessages } from "@/i18n/messages/id";
import { UpstreamSqlImportClient } from "../UpstreamSqlImportClient";

const get = api.get as jest.Mock;
const post = api.post as jest.Mock;

const RUN = "6f1e2d3c-4b5a-4987-8a6b-5c4d3e2f1a0b";
const PROVIDER = "0b9c8d7e-6f5a-4b3c-8d2e-1f0a9b8c7d6e";
const BASE = "/api/v1/admin/upstream-sql-imports";
const ok = (data: unknown, meta?: unknown) => ({ success: true, status: 200, message: "ok", data, ...(meta ? { meta } : {}) });
const NOT_AVAILABLE = "The transform into the application's tables is not built on this server yet: the run stays staged.";

const run = (over: Record<string, unknown> = {}) => ({
  id: RUN,
  status: "loaded",
  dataClass: "synthetic",
  compression: "none",
  sizeBytes: 1024,
  sha256: "a".repeat(64),
  bytesRead: 1024,
  uncompressedBytes: 1024,
  progress: 1,
  rowsLoaded: 10,
  rowsRejected: 0,
  rowsNotExtracted: 0,
  tables: [],
  parseSummary: null,
  errorCode: null,
  errorSummary: null,
  transformStatus: "not_available",
  transformErrorCode: null,
  transformRequestable: false,
  transformRequestedAt: null,
  transformStartedAt: null,
  transformFinishedAt: null,
  transformTenantId: null,
  transformSummary: null,
  attempt: 1,
  fileRetained: false,
  fileRetainUntil: null,
  retryable: false,
  cancellable: false,
  cancelRequestedAt: null,
  uploadedBy: { id: "u", name: "Op Erator" },
  createdAt: "2026-10-07T08:00:00.000Z",
  startedAt: "2026-10-07T08:00:01.000Z",
  scannedAt: null,
  parseStartedAt: null,
  finishedAt: "2026-10-07T08:00:43.000Z",
  durationMs: 42_000,
  ...over,
});

const tenant = (id: string, name: string, status = "active") => ({ id, name, code: name.slice(0, 3).toUpperCase(), status, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });

let detail: Record<string, unknown>;

beforeEach(() => {
  jest.clearAllMocks();
  window.history.pushState({}, "", "/dashboard/upstream-sql-import");
  act(() => {
    useAuthStore.setState({ user: { id: "u", role: { id: "r", name: "SUPERADMIN" } } } as never);
  });
  detail = run();
  get.mockImplementation(async (url: string) => {
    if (url === `${BASE}/settings`) return ok({ maxUploadBytes: 1, maxUncompressedBytes: 1, failedRetentionDays: 7, realDataAllowed: false, transformAvailable: false });
    if (url === BASE) return ok([detail], { total: 1, page: 1, limit: 20, totalPages: 1 });
    if (url === `${BASE}/${RUN}`) return ok(detail);
    if (url === "/api/v1/tenants/all")
      return ok([tenant(PROVIDER, "Synthetic Provider"), tenant("1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d", "Suspended Synthetic", "suspended")], { total: 2, page: 1, limit: 50, totalPages: 1 });
    throw new Error(`unexpected GET ${url}`);
  });
});

const openRun = async (locale: "en" | "id" = "en") => {
  const ui = locale === "en" ? <UpstreamSqlImportClient /> : (
    <MessagesProvider locale="id" messages={idMessages}>
      <UpstreamSqlImportClient />
    </MessagesProvider>
  );
  const view = render(ui);
  fireEvent.click(await screen.findByRole("button", { name: locale === "en" ? /Open the import of/ : /Buka impor/ }));
  return { ...view, section: await screen.findByRole("region", { name: locale === "en" ? "Stage 2: transform" : "Tahap 2: transformasi" }) };
};

describe("C-4 — stage 2 on the SQL-dump import page", () => {
  it("a loaded run: the state, the active tenants only, and the action disabled until a tenant is chosen (axe)", async () => {
    const { container, section } = await openRun();
    expect(within(section).getByText("Not requested")).toBeInTheDocument();
    const select = within(section).getByRole("combobox", { name: "Provider tenant" });
    await waitFor(() => expect(within(select).getByRole("option", { name: "Synthetic Provider (SYN)" })).toBeInTheDocument());
    expect(within(select).queryByRole("option", { name: /Suspended Synthetic/ })).toBeNull();
    expect(within(section).getByRole("button", { name: "Transform into the chosen tenant" })).toBeDisabled();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("the server's 409 TRANSFORM_NOT_AVAILABLE is the run's state, in its own words", async () => {
    const { container, section } = await openRun();
    const select = within(section).getByRole("combobox", { name: "Provider tenant" });
    await waitFor(() => expect(within(select).getAllByRole("option")).toHaveLength(2));
    fireEvent.change(select, { target: { value: PROVIDER } });
    post.mockRejectedValueOnce(httpError(409, NOT_AVAILABLE, "TRANSFORM_NOT_AVAILABLE"));
    fireEvent.click(within(section).getByRole("button", { name: "Transform into Synthetic Provider" }));
    expect(await within(section).findByText(NOT_AVAILABLE)).toBeInTheDocument();
    expect(within(section).getByText("The transform was not started")).toBeInTheDocument();
    expect(within(section).queryByText("The transform was refused.")).toBeNull();
    expect(post).toHaveBeenCalledWith(`${BASE}/${RUN}/transform`, { providerTenantId: PROVIDER });
    expect(await axeViolations(container)).toEqual([]);
  });

  it("another refusal (403 real data) is a failure in the server's words", async () => {
    const { section } = await openRun();
    const select = within(section).getByRole("combobox", { name: "Provider tenant" });
    await waitFor(() => expect(within(select).getAllByRole("option")).toHaveLength(2));
    fireEvent.change(select, { target: { value: PROVIDER } });
    post.mockRejectedValueOnce(httpError(403, "The run is declared real upstream data and UPSTREAM_REAL_DATA_ALLOWED is off (DPIA gates R-01, R-03, R-17).", "REAL_DATA_NOT_ALLOWED"));
    fireEvent.click(within(section).getByRole("button", { name: "Transform into Synthetic Provider" }));
    expect(await within(section).findByText(/UPSTREAM_REAL_DATA_ALLOWED is off/)).toBeInTheDocument();
    expect(within(section).getByText("The transform was refused.")).toBeInTheDocument();
  });

  it("a queued transform: announced, the state shown, the action waits while it is in progress", async () => {
    const { section } = await openRun();
    const select = within(section).getByRole("combobox", { name: "Provider tenant" });
    await waitFor(() => expect(within(select).getAllByRole("option")).toHaveLength(2));
    fireEvent.change(select, { target: { value: PROVIDER } });
    detail = run({ transformStatus: "transform_requested", transformTenantId: PROVIDER, transformRequestedAt: "2026-10-13T08:00:00.000Z" });
    post.mockResolvedValueOnce(ok(detail));
    fireEvent.click(within(section).getByRole("button", { name: "Transform into Synthetic Provider" }));
    const region = await screen.findByRole("region", { name: "Stage 2: transform" });
    expect(await within(region).findByText("Requested")).toBeInTheDocument();
    expect(within(region).getByRole("button", { name: "Transform into Synthetic Provider" })).toBeDisabled();
  });

  it("a failed transform says why; a finished one shows its rows per step and table", async () => {
    detail = run({ transformStatus: "transform_failed", transformErrorCode: "TRANSFORM_NOT_BUILT", transformTenantId: PROVIDER });
    const first = await openRun();
    expect(within(first.section).getByText("Failed")).toBeInTheDocument();
    expect(within(first.section).getByText("The transform's steps are not all built on this server; nothing was written.")).toBeInTheDocument();
    first.unmount();

    detail = run({
      transformStatus: "transformed",
      transformTenantId: PROVIDER,
      transformSummary: { durationMs: 900, steps: [{ step: "client_facilities", durationMs: 100, sources: [{ table: "mst_faskes", staged: 5, mapped: 4, unchanged: 0, quarantined: { duplicate_code: 1 } }] }] },
    });
    const { container, section } = await openRun();
    expect(within(section).getByText("Transformed")).toBeInTheDocument();
    const table = within(section).getByRole("table", { name: "Rows per step and staged table" });
    expect(within(table).getByRole("rowheader", { name: "mst_faskes" })).toBeInTheDocument();
    expect(within(table).getByText("duplicate_code 1")).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("the tenants cannot be read: says so and retries", async () => {
    const base = get.getMockImplementation();
    let failOnce = true;
    get.mockImplementation(async (url: string) => {
      if (url === "/api/v1/tenants/all" && failOnce) {
        failOnce = false;
        throw httpError(500, "boom");
      }
      return base?.(url);
    });
    const { section } = await openRun();
    expect(await within(section).findByText("The tenants cannot be read.")).toBeInTheDocument();
    fireEvent.click(within(section).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(within(within(section).getByRole("combobox", { name: "Provider tenant" })).getAllByRole("option")).toHaveLength(2));
  });

  it("Indonesian", async () => {
    const { section } = await openRun("id");
    expect(within(section).getByText("Belum diminta")).toBeInTheDocument();
    expect(within(section).getByRole("combobox", { name: "Tenant penyedia" })).toBeInTheDocument();
    expect(within(section).getByRole("button", { name: "Transformasi ke tenant terpilih" })).toBeDisabled();
  });
});
