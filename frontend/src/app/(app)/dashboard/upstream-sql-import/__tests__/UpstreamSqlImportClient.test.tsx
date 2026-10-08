/** @jest-environment jsdom */
/**
 * P24-06 — the SQL-dump import page against the backend contract
 * (backend/src/routes/api/admin.route.ts, /api/v1/admin/upstream-sql-imports;
 * backend/src/services/upstreamSqlImport.service.ts):
 *  - GET /settings → { maxUploadBytes, realDataAllowed, … } — the DPIA banner and the declaration;
 *  - GET ?page&limit → runs in `data`, pagination in a TOP-LEVEL `meta`;
 *  - POST (multipart: `dataClass`, `file`) with upload progress and the upload's own timeout;
 *  - GET /:id, POST /:id/cancel, POST /:id/retry; a 409 carries the state explanation, shown inline;
 *  - polled while a run is in flight; `?run=<id>` (the notification's link) opens that run;
 *  - Indonesian and English; axe-clean.
 */
import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { axeViolations } from "@/tests/a11y/axe";
import { httpError } from "@/tests/support/httpError";

jest.mock("@/components/layouts/DashboardLayout", () => {
  return function DashboardLayout({ children }: { children: React.ReactNode }) {
    return <main>{children}</main>;
  };
});

jest.mock("@/api/client", () => {
  const actual = jest.requireActual("@/api/client");
  return {
    ...actual,
    api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
  };
});

import { api } from "@/api/client";
import { useAuthStore } from "@/stores/authStore";
import { useToastStore } from "@/stores/toastStore";
import { MessagesProvider } from "@/i18n/MessagesProvider";
import { id as idMessages } from "@/i18n/messages/id";
import { UpstreamSqlImportClient, POLL_MS } from "../UpstreamSqlImportClient";

const mockedGet = api.get as jest.Mock;
const mockedPost = api.post as jest.Mock;

const RUN = "6f1e2d3c-4b5a-4987-8a6b-5c4d3e2f1a0b";
const BASE = "/api/v1/admin/upstream-sql-imports";
const ok = (data: unknown, meta?: unknown) => ({ success: true, status: 200, message: "ok", data, ...(meta ? { meta } : {}) });

const run = (over: Record<string, unknown> = {}) => ({
  id: RUN,
  status: "loaded",
  dataClass: "synthetic",
  compression: "none",
  sizeBytes: 5 * 1024 * 1024,
  sha256: "a".repeat(64),
  bytesRead: 5 * 1024 * 1024,
  uncompressedBytes: 5 * 1024 * 1024,
  progress: 1,
  rowsLoaded: 1234,
  rowsRejected: 2,
  rowsNotExtracted: 9,
  tables: [
    { table: "auth_logins", staged: false, reason: "not_migrated", columns: 0, excludedColumns: 0, rowsLoaded: 0, rowsRejected: 0, rowsNotExtracted: 9, rejections: {}, notes: {} },
    { table: "trx_inventory", staged: true, reason: null, columns: 20, excludedColumns: 0, rowsLoaded: 1234, rowsRejected: 2, rowsNotExtracted: 0, rejections: { invalid_date: 2 }, notes: {} },
    { table: "mst_alat", staged: true, reason: null, columns: 4, excludedColumns: 0, rowsLoaded: 0, rowsRejected: 0, rowsNotExtracted: 0, rejections: {}, notes: {} },
  ],
  parseSummary: null,
  errorCode: null,
  errorSummary: null,
  transformStatus: "not_available",
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

let settings = { maxUploadBytes: 200 * 1024 * 1024, maxUncompressedBytes: 1, failedRetentionDays: 7, realDataAllowed: false, transformAvailable: false };
let rows: Record<string, unknown>[] = [];
let detail: Record<string, unknown> = run();

const asRole = (name: string) =>
  act(() => {
    useAuthStore.setState({ user: { id: "u", role: { id: "r", name } } } as never);
  });

const pickFile = (contents = "-- dump\n", name = "dump.sql") => {
  const file = new File([contents], name, { type: "application/sql" });
  fireEvent.change(screen.getByLabelText("Dump file"), { target: { files: [file] } });
  return file;
};

beforeEach(() => {
  jest.clearAllMocks();
  window.history.pushState({}, "", "/dashboard/upstream-sql-import");
  settings = { maxUploadBytes: 200 * 1024 * 1024, maxUncompressedBytes: 1, failedRetentionDays: 7, realDataAllowed: false, transformAvailable: false };
  rows = [];
  detail = run();
  mockedGet.mockImplementation(async (url: string) => {
    if (url === `${BASE}/settings`) return ok(settings);
    if (url === BASE) return ok(rows, { total: rows.length, page: 1, limit: 20, totalPages: 1 });
    if (url === `${BASE}/${RUN}`) return ok(detail);
    throw new Error(`unexpected GET ${url}`);
  });
});

describe("P24-06 — the SQL-dump import page", () => {
  it("a non-super-admin sees the restriction and nothing is requested", async () => {
    await asRole("HEALTHCARE ADMIN");
    render(<UpstreamSqlImportClient />);
    expect(screen.getByRole("heading", { level: 1, name: "SQL dump import" })).toBeInTheDocument();
    expect(screen.getByText(/Only a platform super admin/)).toBeInTheDocument();
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it("while the DPIA gate is off: the warning banner, and the upload refused until a file is chosen and declared synthetic", async () => {
    await asRole("SUPERADMIN");
    const { container } = render(<UpstreamSqlImportClient languageForm={<span>LANG</span>} />);
    expect(await screen.findByText("Real upstream data is not allowed yet")).toBeInTheDocument();
    expect(screen.getByText("LANG")).toBeInTheDocument();
    expect(await screen.findByText("No imports yet.")).toBeInTheDocument();
    expect(mockedGet).toHaveBeenCalledWith(BASE, { params: { page: 1, limit: 20 } });
    fireEvent.click(screen.getByRole("button", { name: "Upload and queue" }));
    expect(await screen.findByText("Choose a dump file first.")).toBeInTheDocument();
    pickFile();
    fireEvent.click(screen.getByRole("button", { name: "Upload and queue" }));
    expect(await screen.findByText("Tick the synthetic-data declaration first.")).toBeInTheDocument();
    expect(mockedPost).not.toHaveBeenCalled();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("refuses a file over the cap before sending it", async () => {
    await asRole("SUPERADMIN");
    settings = { ...settings, maxUploadBytes: 4 };
    render(<UpstreamSqlImportClient />);
    await screen.findByText("No imports yet.");
    pickFile("-- far more than four bytes\n");
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Upload and queue" }));
    expect(await screen.findByText(/The file is larger than/)).toBeInTheDocument();
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it("uploads multipart with progress and the long timeout, then opens the queued run", async () => {
    await asRole("SUPERADMIN");
    detail = run({ status: "uploaded", progress: 0, rowsLoaded: 0, cancellable: true, fileRetained: true, tables: [], durationMs: null, finishedAt: null });
    let finish: (v: unknown) => void = () => undefined;
    mockedPost.mockImplementationOnce((url: string, body: FormData, config: { timeout: number; onUploadProgress: (e: { loaded: number; total?: number }) => void }) => {
      expect(url).toBe(BASE);
      expect(body.get("dataClass")).toBe("synthetic");
      expect((body.get("file") as File).name).toBe("dump.sql");
      expect(config.timeout).toBeGreaterThan(15 * 60 * 1000);
      config.onUploadProgress({ loaded: 50, total: 100 });
      config.onUploadProgress({ loaded: 10 });
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    render(<UpstreamSqlImportClient />);
    await screen.findByText("No imports yet.");
    pickFile();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Upload and queue" }));
    expect(await screen.findByRole("progressbar", { name: "Upload progress" })).toHaveAttribute("aria-valuenow", "50");
    expect(screen.getByText("50% uploaded")).toBeInTheDocument();
    rows = [detail];
    await act(async () => {
      finish(ok(detail));
    });
    expect(await screen.findByRole("heading", { name: `Import ${RUN.slice(0, 8)}` })).toBeInTheDocument();
    expect(useToastStore.getState().toasts.some((t) => t.title === "The dump was accepted; the import is queued.")).toBe(true);
    expect(screen.getByText("Refreshed automatically while an import runs.")).toBeInTheDocument();
  });

  it("an upload the server refuses shows its explanation inline", async () => {
    await asRole("SUPERADMIN");
    mockedPost.mockRejectedValueOnce(httpError(409, "Another import is in progress (run 12345678, parsing)."));
    render(<UpstreamSqlImportClient />);
    await screen.findByText("No imports yet.");
    pickFile();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Upload and queue" }));
    expect(await screen.findByText("Another import is in progress (run 12345678, parsing).")).toBeInTheDocument();
  });

  it("when real data is allowed: the informational banner and a choice of synthetic or real", async () => {
    await asRole("SUPERADMIN");
    settings = { ...settings, realDataAllowed: true };
    mockedPost.mockResolvedValueOnce(ok(run({ status: "uploaded" })));
    render(<UpstreamSqlImportClient />);
    expect(await screen.findByText("Real upstream data is allowed")).toBeInTheDocument();
    pickFile();
    fireEvent.click(screen.getByRole("radio", { name: "Real upstream data" }));
    fireEvent.click(screen.getByRole("button", { name: "Upload and queue" }));
    await waitFor(() => expect(mockedPost).toHaveBeenCalled());
    expect((mockedPost.mock.calls[0]?.[1] as FormData).get("dataClass")).toBe("real");
    fireEvent.click(screen.getByRole("radio", { name: "Synthetic test data" }));
  });

  it("lists runs with their status in words; a loaded run's detail: counts, per table, the transform notice, the file gone", async () => {
    await asRole("SUPERADMIN");
    rows = [run()];
    const { container } = render(<UpstreamSqlImportClient />);
    fireEvent.click(await screen.findByRole("button", { name: /Open the import of/ }));
    expect(await screen.findByText("Loaded into staging", { selector: "span *, span" })).toBeInTheDocument();
    expect(await screen.findByText("Stage 2 (the transform into the application's tables) is not available yet: the rows stay in staging.")).toBeInTheDocument();
    expect(screen.getByText("The file has been deleted from the server.")).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "trx_inventory" })).toBeInTheDocument();
    expect(screen.getByText("invalid_date 2")).toBeInTheDocument();
    expect(screen.getByText("not_migrated")).toBeInTheDocument();
    expect(screen.getByText("42 s")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Import progress" })).toHaveAttribute("aria-valuenow", "100");
    expect(await axeViolations(container)).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Close the import details" }));
    expect(screen.queryByText("Per table")).not.toBeInTheDocument();
  });

  it("a failed run: its failure in words, the file kept for a retry, and the retry queued", async () => {
    await asRole("SUPERADMIN");
    detail = run({ status: "failed", errorCode: "TRUNCATED_INPUT", retryable: true, fileRetained: true, fileRetainUntil: "2026-10-14T08:00:00.000Z", uploadedBy: null, tables: [] });
    rows = [detail];
    mockedPost.mockResolvedValueOnce(ok(run({ status: "uploaded", attempt: 2, cancellable: true })));
    render(<UpstreamSqlImportClient />);
    fireEvent.click(await screen.findByRole("button", { name: /Open the import of/ }));
    expect(await screen.findByText("The dump ends inside a statement, a string or a comment: the file is truncated.")).toBeInTheDocument();
    expect(screen.getByText(/The file is kept until .* for a retry, then deleted\./)).toBeInTheDocument();
    expect(screen.getByText("No table has been read yet.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(mockedPost).toHaveBeenCalledWith(`${BASE}/${RUN}/retry`, {}));
    expect(await screen.findByRole("button", { name: "Cancel the import" })).toBeInTheDocument();
  });

  it("a cancellation the server refuses (409) is explained inline; an asked one says the worker stops", async () => {
    await asRole("SUPERADMIN");
    detail = run({ status: "parsing", progress: 0.4, cancellable: true, fileRetained: true, durationMs: null, finishedAt: null });
    rows = [detail];
    mockedPost.mockRejectedValueOnce(httpError(409, "The run has just finished; it can no longer be cancelled."));
    render(<UpstreamSqlImportClient />);
    fireEvent.click(await screen.findByRole("button", { name: /Open the import of/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel the import" }));
    expect(await screen.findByText("The run has just finished; it can no longer be cancelled.")).toBeInTheDocument();
    mockedPost.mockResolvedValueOnce(ok(run({ status: "parsing", cancellable: false, cancelRequestedAt: "2026-10-07T08:00:10.000Z", fileRetained: true })));
    fireEvent.click(screen.getByRole("button", { name: "Cancel the import" }));
    expect(await screen.findByText("Cancellation requested; the worker stops at its next checkpoint.")).toBeInTheDocument();
  });

  it("polls while a run is in flight, and opens the run the notification links to", async () => {
    jest.useFakeTimers();
    try {
      await asRole("SUPERADMIN");
      window.history.pushState({}, "", `/dashboard/upstream-sql-import?run=${RUN}`);
      detail = run({ status: "scanning", progress: 0, fileRetained: true, cancellable: true });
      rows = [detail];
      render(<UpstreamSqlImportClient />);
      await act(async () => {
        await Promise.resolve();
      });
      await waitFor(() => expect(mockedGet).toHaveBeenCalledWith(`${BASE}/${RUN}`));
      const before = mockedGet.mock.calls.length;
      await act(async () => {
        jest.advanceTimersByTime(POLL_MS);
      });
      await waitFor(() => expect(mockedGet.mock.calls.length).toBeGreaterThan(before));
    } finally {
      jest.useRealTimers();
    }
  });

  it("a list that cannot be read, and a run that cannot be read, each say so with a retry", async () => {
    await asRole("SUPERADMIN");
    mockedGet.mockRejectedValueOnce(httpError(500, "boom"));
    const { unmount } = render(<UpstreamSqlImportClient />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    unmount();
    rows = [run()];
    render(<UpstreamSqlImportClient />);
    const opener = await screen.findByRole("button", { name: /Open the import of/ });
    mockedGet.mockImplementationOnce(async () => {
      throw httpError(404, "Import run not found");
    });
    fireEvent.click(opener);
    expect(await screen.findByText(/not found|could not|went wrong/i)).toBeInTheDocument();
  });

  it("speaks Indonesian when the page is given the Indonesian dictionary", async () => {
    await asRole("SUPERADMIN");
    const { container } = render(
      <MessagesProvider locale="id" messages={idMessages}>
        <UpstreamSqlImportClient />
      </MessagesProvider>,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Impor dump SQL" })).toBeInTheDocument();
    expect(await screen.findByText("Data nyata upstream belum diizinkan")).toBeInTheDocument();
    expect(container.querySelector("[lang='id']")).not.toBeNull();
  });
});
