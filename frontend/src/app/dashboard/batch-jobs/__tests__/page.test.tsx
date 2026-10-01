/** @jest-environment jsdom */
/**
 * Background jobs page against the backend contract
 * (backend/src/routes/api/batchJobs.route.js, mounted /api/v1/jobs;
 * controllers/batchJob.controller.js; services/batchJob.service.js;
 * models/batchJob.model.ts):
 *  - GET  /?page&limit → data { total, page, limit, totalPages, jobs } — the
 *    documented `data.jobs` exception;
 *  - a BatchJob row: { type, status: PENDING|PROCESSING|COMPLETED|FAILED,
 *    progress, totalItems, processedItems, resultUrl, errorDetails, … };
 *  - POST /test { type, totalItems } → 201.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { axeViolations } from "@/tests/a11y/axe";
import { httpError } from "@/tests/support/httpError";

jest.mock("@/components/layouts/DashboardLayout", () => {
  return function DashboardLayout({ children }: { children: React.ReactNode }) {
    return <main>{children}</main>;
  };
});

jest.mock("@/api/client", () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

import { api } from "@/api/client";
import { useToastStore } from "@/stores/toastStore";
import BatchJobsPage from "../page";
import { grantPermissions, grantSuperAdmin, clearPermissions } from "@/tests/support/permissions";

const mockedGet = api.get as jest.Mock;
const mockedPost = api.post as jest.Mock;

const job = (
  id: string,
  type: string,
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED",
  extra: Record<string, unknown> = {},
) => ({
  id,
  tenantId: "t-1",
  userId: "u-1",
  type,
  status,
  progress: 0,
  totalItems: 10,
  processedItems: 0,
  resultUrl: null,
  errorDetails: null,
  createdAt: "2026-09-29T08:00:00.000Z",
  updatedAt: "2026-09-29T08:00:00.000Z",
  ...extra,
});

let jobs: ReturnType<typeof job>[];
let total: number;

/** batchJob.controller getJobs, verbatim in shape. */
const listAnswer = (page: number) => ({
  success: true,
  status: 200,
  message: "Jobs retrieved successfully",
  data: { total, page, limit: 10, totalPages: Math.ceil(total / 10), jobs },
});

const toasts = () => useToastStore.getState().toasts.map((t) => ({ type: t.type, title: t.title, description: t.description }));

beforeEach(() => {
  // ADR-102: write controls follow the effective permissions.
  grantPermissions({ "batch-jobs": "write" });
  jest.clearAllMocks();
  useToastStore.setState({ toasts: [] });
  jobs = [
    job("aaaaaaaa-1111", "EXPORT_CSV", "COMPLETED", {
      processedItems: 10,
      progress: 100,
      resultUrl: "https://files.example/export.csv",
    }),
    job("bbbbbbbb-2222", "IMPORT_DEVICES", "FAILED", {
      processedItems: 4,
      errorDetails: "Row 5: serial number already exists in this tenant",
    }),
  ];
  total = 2;
  mockedGet.mockImplementation(async (url: string, { params }: { params: { page: number } }) => {
    if (url !== "/api/v1/jobs") throw httpError(404, "Not found");
    return listAnswer(params.page);
  });
});

afterEach(() => {
  jest.useRealTimers();
});

const renderLoaded = async () => {
  const view = render(<BatchJobsPage />);
  await screen.findByText("EXPORT_CSV");
  return view;
};

const rowOf = (type: string) => screen.getByText(type).closest("tr") as HTMLElement;

describe("background jobs — reading", () => {
  it("lists jobs from data.jobs with progress, a result link and a failure's reason", async () => {
    const open = jest.spyOn(window, "open").mockImplementation(() => null);
    const { container } = await renderLoaded();

    expect(mockedGet).toHaveBeenCalledWith("/api/v1/jobs", { params: { page: 1, limit: 10 } });
    const done = rowOf("EXPORT_CSV");
    expect(within(done).getByText("COMPLETED")).toBeInTheDocument();
    expect(within(done).getByText("10/10")).toBeInTheDocument();
    expect(within(done).getByText("100%")).toBeInTheDocument();
    fireEvent.click(within(done).getByRole("button", { name: "Result" }));
    expect(open).toHaveBeenCalledWith("https://files.example/export.csv", "_blank");

    const failed = rowOf("IMPORT_DEVICES");
    expect(within(failed).getByText("FAILED")).toBeInTheDocument();
    expect(within(failed).getByText("4/10")).toBeInTheDocument();
    // errorDetails is what a BatchJob row carries.
    const reason = "Row 5: serial number already exists in this tenant";
    // The cell shows the first 40 characters; the full reason is its title.
    expect(within(failed).getByTitle(reason)).toHaveTextContent(reason.slice(0, 40));
    expect(screen.queryByText(/Auto-refreshing/)).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
    open.mockRestore();
  });

  it("no jobs is the empty state", async () => {
    jobs = [];
    total = 0;
    render(<BatchJobsPage />);

    expect(await screen.findByText("No background jobs have run.")).toBeInTheDocument();
  });

  it("a failed read shows the error, not the empty state", async () => {
    mockedGet.mockRejectedValue(httpError(403, "You do not have permission to read background jobs"));
    const { container } = render(<BatchJobsPage />);

    expect(await screen.findByText("You do not have permission to read background jobs")).toBeInTheDocument();
    expect(screen.getByText("Background jobs could not be loaded.")).toBeInTheDocument();
    expect(screen.queryByText("No background jobs have run.")).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("Refresh reads the list again", async () => {
    await renderLoaded();
    const before = mockedGet.mock.calls.length;

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    });

    expect(mockedGet.mock.calls.length).toBe(before + 1);
  });

  it("pages through jobs", async () => {
    total = 15;
    await renderLoaded();
    expect(screen.getByText("Page 1 of 2 · 15 total")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
    });
    await waitFor(() => expect(mockedGet).toHaveBeenLastCalledWith("/api/v1/jobs", { params: { page: 2, limit: 10 } }));
    expect(await screen.findByText("Page 2 of 2 · 15 total")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    });
    expect(await screen.findByText("Page 1 of 2 · 15 total")).toBeInTheDocument();
  });
});

describe("background jobs — polling while a job runs", () => {
  it("refreshes every 5 s while a job is PENDING or PROCESSING, and stops when none is", async () => {
    jest.useFakeTimers({ doNotFake: ["queueMicrotask", "nextTick"] });
    jobs = [job("cccccccc-3333", "EXPORT_CSV", "PROCESSING", { processedItems: 3 })];
    render(<BatchJobsPage />);
    await screen.findByText("3/10");
    expect(screen.getByText("Auto-refreshing every 5s while jobs are running.")).toBeInTheDocument();
    const reads = mockedGet.mock.calls.length;

    jobs = [job("cccccccc-3333", "EXPORT_CSV", "COMPLETED", { processedItems: 10 })];
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });

    expect(await screen.findByText("10/10")).toBeInTheDocument();
    expect(mockedGet.mock.calls.length).toBe(reads + 1);
    expect(screen.queryByText(/Auto-refreshing/)).not.toBeInTheDocument();

    await act(async () => {
      jest.advanceTimersByTime(15000);
    });
    expect(mockedGet.mock.calls.length).toBe(reads + 1);
  });
});

describe("background jobs — queueing a test job", () => {
  const openQueue = () => {
    fireEvent.click(screen.getByRole("button", { name: "Queue Test Job" }));
    return screen.getByRole("dialog", { name: "Queue Test Job" });
  };

  it("POSTs the type and item count, closes and reloads", async () => {
    mockedPost.mockResolvedValue({ success: true, status: 201, message: "Background job created", data: job("dddd", "IMPORT_DEVICES", "PENDING") });
    const { container } = await renderLoaded();
    const dialog = openQueue();
    expect(await axeViolations(container)).toEqual([]);

    fireEvent.change(within(dialog).getByLabelText("Type"), { target: { value: " IMPORT_DEVICES " } });
    fireEvent.change(within(dialog).getByLabelText("Total items"), { target: { value: "25" } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Queue Job" }));
    });

    expect(mockedPost).toHaveBeenCalledWith("/api/v1/jobs/test", { type: "IMPORT_DEVICES", totalItems: 25 });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(toasts()).toContainEqual({ type: "success", title: "Job queued", description: undefined });
  });

  it("blank fields are left for the server's defaults", async () => {
    mockedPost.mockResolvedValue({ success: true, status: 201, message: "ok", data: {} });
    await renderLoaded();
    const dialog = openQueue();

    fireEvent.change(within(dialog).getByLabelText("Type"), { target: { value: "  " } });
    fireEvent.change(within(dialog).getByLabelText("Total items"), { target: { value: "" } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Queue Job" }));
    });

    expect(mockedPost).toHaveBeenCalledWith("/api/v1/jobs/test", { type: undefined, totalItems: undefined });
  });

  it("a refused job keeps the dialog and says why", async () => {
    mockedPost.mockRejectedValue(httpError(403, "You do not have permission to write background jobs"));
    await renderLoaded();
    const dialog = openQueue();

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Queue Job" }));
    });

    expect(toasts()).toContainEqual({
      type: "error",
      title: "Could not queue job",
      description: "You do not have permission to write background jobs",
    });
    expect(screen.getByRole("dialog", { name: "Queue Test Job" })).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

/**
 * ADR-102 — background jobs writes are gated on `batch-jobs` write. HEALTHCARE ADMIN and CALIBRATOR ADMIN hold it read. Downloading a result is a read and stays.
 * Before the permissions load nothing is writable; the super admin writes.
 * Fail-before: Queue Test Job rendered for every role.
 */
describe("ADR-102 — background jobs write controls follow the effective permission", () => {
  const writeControls = [
      /Queue Test Job/,
  ];

  it("a reader gets none of the write controls", async () => {
    grantPermissions({ "batch-jobs": "read" });
    render(<BatchJobsPage />);
    await screen.findByText("EXPORT_CSV");
    for (const name of writeControls) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });

  it("nothing is writable before the permissions load", async () => {
    clearPermissions();
    render(<BatchJobsPage />);
    await screen.findByText("EXPORT_CSV");
    for (const name of writeControls) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });

  it("the super admin gets them", async () => {
    grantSuperAdmin();
    render(<BatchJobsPage />);
    await screen.findByText("EXPORT_CSV");
    expect(screen.getAllByRole("button", { name: /Queue Test Job/ }).length).toBeGreaterThan(0);
  });
});
