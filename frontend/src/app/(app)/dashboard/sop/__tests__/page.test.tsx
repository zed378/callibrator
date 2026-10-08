/** @jest-environment jsdom */
/**
 * SOP documents page against the backend contract
 * (backend/src/routes/api/sop.route.js, mounted /api/v1/sop;
 * controllers/sop.controller.js; services/sop.service.js):
 *  - GET  /?page&limit&status → documents in `data`, pagination in a top-level
 *    `meta` (sop.controller getDocuments — the house envelope, c131729);
 *  - POST / { title, version, contentUrl, requiresTraining } → 201, a DRAFT;
 *  - PATCH /:id/publish → 409 when not publishable, or when the caller wrote it;
 *  - POST /:id/acknowledge → 404 when no training is assigned, 409 when done.
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
import SopPage from "../page";
import { grantPermissions, grantSuperAdmin, clearPermissions } from "@/tests/support/permissions";

const mockedGet = api.get as jest.Mock;
const mockedPost = api.post as jest.Mock;
const mockedPatch = api.patch as jest.Mock;

const doc = (
  id: string,
  documentNumber: string,
  title: string,
  status: "DRAFT" | "UNDER_REVIEW" | "PUBLISHED" | "ARCHIVED",
  extra: Record<string, unknown> = {},
) => ({
  id,
  tenantId: "t-1",
  authorId: "u-1",
  documentNumber,
  title,
  version: "1.0",
  contentUrl: null,
  requiresTraining: true,
  status,
  publishedDate: status === "PUBLISHED" ? "2026-09-10T00:00:00.000Z" : null,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  ...extra,
});

let documents: ReturnType<typeof doc>[];
let total: number;

/** sop.controller getDocuments, verbatim in shape. */
const listAnswer = (rows: unknown[], page: number) => ({
  success: true,
  status: 200,
  message: "Documents retrieved successfully",
  data: rows,
  meta: { total, page, limit: 10, totalPages: Math.ceil(total / 10) },
});

const backend = () => {
  mockedGet.mockImplementation(async (url: string, { params }: { params: { page: number; status?: string } }) => {
    if (url !== "/api/v1/sop") throw httpError(404, "Not found");
    const rows = params.status ? documents.filter((d) => d.status === params.status) : documents;
    return listAnswer(rows, params.page);
  });
};

const toasts = () => useToastStore.getState().toasts.map((t) => ({ type: t.type, title: t.title, description: t.description }));
const rowOf = (title: string) => screen.getByText(title).closest("tr") as HTMLElement;

beforeEach(() => {
  // ADR-102: write controls follow the effective permissions.
  grantPermissions({ sop: "write" });
  jest.clearAllMocks();
  useToastStore.setState({ toasts: [] });
  documents = [
    doc("d-1", "SOP-0001", "Thermometer calibration", "DRAFT"),
    doc("d-2", "SOP-0002", "Autoclave validation", "PUBLISHED", {
      contentUrl: "https://docs.example/sop-2.pdf",
      requiresTraining: false,
    }),
  ];
  total = 2;
  backend();
});

const renderLoaded = async () => {
  const view = render(<SopPage />);
  await screen.findByText("Thermometer calibration");
  return view;
};

describe("SOP — reading", () => {
  it("lists documents from the envelope, with status, training and publish date", async () => {
    const { container } = await renderLoaded();

    expect(mockedGet).toHaveBeenCalledWith("/api/v1/sop", { params: { page: 1, limit: 10 } });
    const draft = rowOf("Thermometer calibration");
    expect(within(draft).getByText("SOP-0001")).toBeInTheDocument();
    expect(within(draft).getByText("DRAFT")).toBeInTheDocument();
    expect(within(draft).getByText("Required")).toBeInTheDocument();
    expect(within(draft).getByRole("button", { name: "Publish" })).toBeInTheDocument();

    const published = rowOf("Autoclave validation");
    expect(within(published).getByText("Not required")).toBeInTheDocument();
    expect(within(published).getByText(new Date("2026-09-10T00:00:00.000Z").toLocaleDateString())).toBeInTheDocument();
    // No training required → no acknowledgement row exists; the backend would 404.
    expect(within(published).queryByRole("button", { name: "I have read this" })).not.toBeInTheDocument();
    expect(within(published).queryByRole("button", { name: "Publish" })).not.toBeInTheDocument();
    expect(screen.getByText("Page 1 of 1 · 2 total")).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("no documents is the empty state", async () => {
    documents = [];
    total = 0;
    render(<SopPage />);

    expect(await screen.findByText("No SOP documents yet.")).toBeInTheDocument();
    expect(screen.queryByText(/Page 1 of/)).not.toBeInTheDocument();
  });

  it("a failed read shows the error, not the empty state", async () => {
    mockedGet.mockRejectedValue(httpError(403, "You do not have permission to read SOP documents"));
    const { container } = render(<SopPage />);

    expect(await screen.findByText("You do not have permission to read SOP documents")).toBeInTheDocument();
    expect(screen.getByText("SOP documents could not be loaded.")).toBeInTheDocument();
    expect(screen.queryByText("No SOP documents yet.")).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("filters by status from page 1, and clears the filter", async () => {
    await renderLoaded();

    fireEvent.click(screen.getByRole("button", { name: /^Filter by status/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole("option", { name: "PUBLISHED" }));
    });
    await waitFor(() =>
      expect(mockedGet).toHaveBeenLastCalledWith("/api/v1/sop", { params: { page: 1, limit: 10, status: "PUBLISHED" } }),
    );
    await waitFor(() => expect(screen.queryByText("Thermometer calibration")).not.toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    });
    await waitFor(() => expect(mockedGet).toHaveBeenLastCalledWith("/api/v1/sop", { params: { page: 1, limit: 10 } }));
  });

  it("pages with the top-level meta", async () => {
    total = 12;
    await renderLoaded();
    expect(screen.getByText("Page 1 of 2 · 12 total")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
    });
    await waitFor(() => expect(mockedGet).toHaveBeenLastCalledWith("/api/v1/sop", { params: { page: 2, limit: 10 } }));
    expect(await screen.findByText("Page 2 of 2 · 12 total")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    });
    expect(await screen.findByText("Page 1 of 2 · 12 total")).toBeInTheDocument();
  });

  it("opens a document's content in a new tab", async () => {
    const open = jest.spyOn(window, "open").mockImplementation(() => null);
    await renderLoaded();

    fireEvent.click(within(rowOf("Autoclave validation")).getByRole("button", { name: "Open document" }));

    expect(open).toHaveBeenCalledWith("https://docs.example/sop-2.pdf", "_blank");
    open.mockRestore();
  });
});

describe("SOP — which action each state offers (F-19)", () => {
  // The backend's rules (sop.service.js): publish from DRAFT | UNDER_REVIEW
  // (PUBLISHABLE_STATES); acknowledge only where publishDocument assigned
  // training — a PUBLISHED document with requiresTraining.
  beforeEach(() => {
    documents = [
      doc("d-1", "SOP-0001", "Thermometer calibration", "DRAFT"),
      doc("d-3", "SOP-0003", "Pipette check", "UNDER_REVIEW"),
      doc("d-4", "SOP-0004", "Steriliser loading", "PUBLISHED"),
      doc("d-5", "SOP-0005", "Retired balance check", "ARCHIVED"),
    ];
    total = 4;
  });

  it("an UNDER_REVIEW document offers Publish, never 'I have read this'", async () => {
    await renderLoaded();
    const review = rowOf("Pipette check");
    expect(within(review).queryByRole("button", { name: "I have read this" })).not.toBeInTheDocument();
    expect(within(review).getByRole("button", { name: "Publish" })).toBeInTheDocument();
  });

  it("only a PUBLISHED document that requires training offers the acknowledgement", async () => {
    await renderLoaded();
    expect(within(rowOf("Steriliser loading")).getByRole("button", { name: "I have read this" })).toBeInTheDocument();
    expect(within(rowOf("Steriliser loading")).queryByRole("button", { name: "Publish" })).not.toBeInTheDocument();
    expect(within(rowOf("Thermometer calibration")).queryByRole("button", { name: "I have read this" })).not.toBeInTheDocument();
    const archived = rowOf("Retired balance check");
    expect(within(archived).queryByRole("button", { name: "I have read this" })).not.toBeInTheDocument();
    expect(within(archived).queryByRole("button", { name: "Publish" })).not.toBeInTheDocument();
  });
});

describe("SOP — creating a draft", () => {
  const openNew = () => {
    fireEvent.click(screen.getByRole("button", { name: "New Document" }));
    return screen.getByRole("dialog", { name: "New SOP Document" });
  };

  it("needs a title", async () => {
    await renderLoaded();
    const dialog = openNew();

    fireEvent.click(within(dialog).getByRole("button", { name: "Create Draft" }));

    expect(toasts()).toContainEqual({ type: "error", title: "A title is required", description: undefined });
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it("POSTs only the fields the backend reads, blank ones omitted", async () => {
    mockedPost.mockResolvedValue({ success: true, status: 201, message: "Document created successfully", data: doc("d-3", "SOP-0003", "ECG check", "DRAFT") });
    const { container } = await renderLoaded();
    const dialog = openNew();
    expect(await axeViolations(container)).toEqual([]);

    fireEvent.change(within(dialog).getByLabelText(/Title/), { target: { value: "  ECG check " } });
    fireEvent.change(within(dialog).getByLabelText("Version"), { target: { value: " " } });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /Requires training/ }));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Create Draft" }));
    });

    expect(mockedPost).toHaveBeenCalledWith("/api/v1/sop", {
      title: "ECG check",
      version: undefined,
      contentUrl: undefined,
      requiresTraining: false,
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(toasts()).toContainEqual({ type: "success", title: "Document created as DRAFT", description: undefined });
  });

  it("a refused create keeps the dialog", async () => {
    mockedPost.mockRejectedValue(httpError(403, "You do not have permission to write SOP documents"));
    await renderLoaded();
    const dialog = openNew();

    fireEvent.change(within(dialog).getByLabelText(/Title/), { target: { value: "ECG check" } });
    fireEvent.change(within(dialog).getByLabelText(/Content URL/), { target: { value: "https://docs.example/ecg.pdf" } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Create Draft" }));
    });

    expect(mockedPost).toHaveBeenCalledWith("/api/v1/sop", {
      title: "ECG check",
      version: "1.0",
      contentUrl: "https://docs.example/ecg.pdf",
      requiresTraining: true,
    });
    expect(screen.getByRole("dialog", { name: "New SOP Document" })).toBeInTheDocument();
  });
});

describe("SOP — publishing (confirmed) and acknowledging", () => {
  it("publishing asks first, warns about the tenant-wide training, then PATCHes", async () => {
    mockedPatch.mockImplementation(async () => {
      documents = documents.map((d) => (d.id === "d-1" ? { ...d, status: "PUBLISHED" as const } : d));
      return { success: true, status: 200, message: "Document published and training tasks assigned", data: documents[0] };
    });
    const { container } = await renderLoaded();

    fireEvent.click(within(rowOf("Thermometer calibration")).getByRole("button", { name: "Publish" }));
    expect(mockedPatch).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: "Publish Document" });
    expect(within(dialog).getByText(/EVERY user in the tenant/)).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Publish" }));
    });

    expect(mockedPatch).toHaveBeenCalledWith("/api/v1/sop/d-1/publish");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(toasts()).toContainEqual({
      type: "success",
      title: "Published — training assigned to every user in the tenant",
      description: undefined,
    });
    await waitFor(() => expect(within(rowOf("Thermometer calibration")).getByText("PUBLISHED")).toBeInTheDocument());
  });

  it("a document without training says only that it is published", async () => {
    documents = [doc("d-5", "SOP-0005", "Label printer", "DRAFT", { requiresTraining: false })];
    total = 1;
    mockedPatch.mockResolvedValue({ success: true, status: 200, message: "ok", data: {} });
    render(<SopPage />);
    await screen.findByText("Label printer");

    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    const dialog = screen.getByRole("dialog", { name: "Publish Document" });
    expect(within(dialog).getByText(/cannot be returned to draft/)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Publish" }));
    });

    expect(toasts()).toContainEqual({ type: "success", title: "Published", description: undefined });
  });

  // V-13 (ADR-109 §7): the backend answers the author with 403, not 409.
  it("the author cannot release their own SOP: the 403 is explained and the dialog stays", async () => {
    const own =
      "SOP SOP-0001 was authored by you and is still DRAFT. A controlled procedure must be released by someone other than its author — ask a second authorised user to publish it.";
    mockedPatch.mockRejectedValue(httpError(403, own));
    await renderLoaded();

    fireEvent.click(within(rowOf("Thermometer calibration")).getByRole("button", { name: "Publish" }));
    const dialog = screen.getByRole("dialog", { name: "Publish Document" });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Publish" }));
    });

    expect(toasts()).toContainEqual({ type: "error", title: "Action failed", description: own });
    expect(screen.getByRole("dialog", { name: "Publish Document" })).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("acknowledges training; a second acknowledgement's 409 is explained", async () => {
    const already =
      "You already acknowledged this SOP on 2026-09-11T00:00:00.000Z. A training record is not overwritten; if the procedure changed, a new revision must be published and acknowledged.";
    mockedPost
      .mockResolvedValueOnce({ success: true, status: 200, message: "Training acknowledged successfully", data: { id: "ack-1", status: "COMPLETED" } })
      .mockRejectedValueOnce(httpError(409, already));
    documents[1] = { ...documents[1], requiresTraining: true };
    await renderLoaded();
    const ack = () => within(rowOf("Autoclave validation")).getByRole("button", { name: "I have read this" });

    await act(async () => {
      fireEvent.click(ack());
    });
    expect(mockedPost).toHaveBeenCalledWith("/api/v1/sop/d-2/acknowledge");
    expect(toasts()).toContainEqual({ type: "success", title: "Training acknowledged", description: undefined });

    await act(async () => {
      fireEvent.click(ack());
    });
    expect(toasts()).toContainEqual({ type: "error", title: "Action failed", description: already });
  });
});

/**
 * ADR-102 — SOP documents writes are gated on `sop` write. ENGINEERING MANAGER holds `sop` read and keeps "I have read this".
 * Before the permissions load nothing is writable; the super admin writes.
 * Fail-before: New Document and Publish rendered for every role.
 */
describe("ADR-102 — SOP documents write controls follow the effective permission", () => {
  const writeControls = [
      /New Document/,
  ];

  it("a reader gets none of the write controls", async () => {
    grantPermissions({ "sop": "read" });
    render(<SopPage />);
    await screen.findByText("Thermometer calibration");
    for (const name of writeControls) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });

  it("nothing is writable before the permissions load", async () => {
    clearPermissions();
    render(<SopPage />);
    await screen.findByText("Thermometer calibration");
    for (const name of writeControls) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });

  it("the super admin gets them", async () => {
    grantSuperAdmin();
    render(<SopPage />);
    await screen.findByText("Thermometer calibration");
    expect(screen.getAllByRole("button", { name: /New Document/ }).length).toBeGreaterThan(0);
  });
});
