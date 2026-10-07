/** @jest-environment jsdom */
/**
 * The rsync image import page against the backend contract
 * (backend/src/routes/api/upstreamFileImports.route.ts, /api/v1/admin/upstream-file-imports):
 *  - GET /config → the DPIA gate banner; GET / → rows in `data`, `meta` top-level;
 *  - POST /check-connection without a fingerprint → host keys to confirm; with the chosen one →
 *    the estimate; only then can the import start;
 *  - POST / → queued; the password leaves the form and is never shown again;
 *  - POST /:id/cancel after a confirmation; a 409 shows the backend's explanation;
 *  - ID/EN: the page's words and its `lang` follow the operator's choice.
 */
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
  return {
    ...actual,
    api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
  };
});

import { api } from "@/api/client";
import { useAuthStore } from "@/stores/authStore";
import UpstreamImportPage, { formatBytes } from "../page";
import { initialLocale, MESSAGES } from "../messages";

const mockedGet = api.get as jest.Mock;
const mockedPost = api.post as jest.Mock;

const BASE = "/api/v1/admin/upstream-file-imports";
const TENANT = "2b7c9e41-5d3a-4f6e-8a1b-0c9d8e7f6a5b";
const FP = `SHA256:${"A".repeat(43)}`;
const FP2 = `SHA256:${"B".repeat(43)}`;
const PASSWORD = "page-pw-probe";

const imp = (over: Record<string, unknown> = {}) => ({
  id: "5f0c2b8e-3a4d-4c6b-9e1f-7a8b9c0d1e2f",
  targetTenantId: TENANT,
  status: "completed",
  host: "test-ssh",
  port: 2222,
  username: "importer",
  remotePath: "/srv/uploads",
  fileClasses: ["front", "serial"],
  authMethod: "password",
  hostKeyType: "ssh-ed25519",
  hostKeyFingerprint: FP,
  syntheticSource: true,
  bandwidthLimitKbps: null,
  estimate: { files: 4, bytes: 12000, classes: {} },
  progress: { filesTransferred: 4, bytesTransferred: 12000, filesProcessed: 4, filesToProcess: 4 },
  summary: {
    filesCopied: 4,
    bytesCopied: 12000,
    ingested: 3,
    bytesIngested: 9000,
    skippedPresent: 0,
    duplicateContent: 0,
    metadataStripped: 2,
    quarantined: 1,
    quarantinedByReason: { file_type_refused: 1 },
    failed: 0,
    durationMs: 4000,
  },
  errorCode: null,
  cancelRequested: false,
  credentialStored: false,
  secretErasedAt: "2026-10-07T10:00:00.000Z",
  batchJobId: null,
  requestedBy: "u",
  startedAt: null,
  finishedAt: null,
  createdAt: "2026-10-07T09:00:00.000Z",
  updatedAt: "2026-10-07T10:00:00.000Z",
  ...over,
});

let rows: Record<string, unknown>[];
let realDataAllowed: boolean;

const asRole = (name: string) =>
  act(() => {
    useAuthStore.setState({ user: { id: "u", role: { id: "r", name } } } as never);
  });

beforeEach(() => {
  jest.clearAllMocks();
  document.cookie = "locale=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
  rows = [imp()];
  realDataAllowed = false;
  mockedGet.mockImplementation(async (url: string) => {
    if (url === `${BASE}/config`) {
      return { success: true, status: 200, message: "ok", data: { realDataAllowed, allowListedHostCount: 1, heicConversion: false, fileClasses: [] } };
    }
    if (url === BASE) {
      return { success: true, status: 200, message: "ok", data: rows, meta: { total: rows.length, page: 1, limit: 20, totalPages: 1 } };
    }
    if (url === "/api/v1/tenants/all") {
      return { success: true, status: 200, message: "ok", data: [{ id: TENANT, name: "Provider" }], meta: { total: 1, page: 1, limit: 100, totalPages: 1 } };
    }
    throw new Error(`unexpected GET ${url}`);
  });
  mockedPost.mockImplementation(async (url: string, body: Record<string, unknown>) => {
    if (url === `${BASE}/check-connection`) {
      if (!body["confirmedFingerprint"]) {
        return {
          success: true,
          status: 200,
          message: "ok",
          data: { status: "host_key_unconfirmed", hostKeys: [{ type: "ssh-ed25519", fingerprint: FP }, { type: "ssh-rsa", fingerprint: FP2 }], confirmedHostKey: null, classes: {}, estimate: null },
        };
      }
      return {
        success: true,
        status: 200,
        message: "ok",
        data: {
          status: "ok",
          hostKeys: [{ type: "ssh-ed25519", fingerprint: FP }],
          confirmedHostKey: { type: "ssh-ed25519", fingerprint: body["confirmedFingerprint"] },
          classes: { front: { status: "ok", files: 1200, bytes: 2_400_000 }, serial: { status: "path_not_found", files: 0, bytes: 0 } },
          estimate: { files: 1200, bytes: 2_400_000, classes: {} },
        },
      };
    }
    if (url === BASE) {
      rows = [imp({ id: "new-import", status: "transferring", summary: null, progress: { filesTransferred: 1, bytesTransferred: 6000, filesProcessed: 0, filesToProcess: 0 } }), ...rows];
      return { success: true, status: 201, message: "ok", data: rows[0] };
    }
    if (url.endsWith("/cancel")) {
      return { success: true, status: 200, message: "ok", data: imp({ cancelRequested: true }) };
    }
    throw new Error(`unexpected POST ${url}`);
  });
});

const fillSource = () => {
  fireEvent.change(screen.getByLabelText("Host"), { target: { value: "test-ssh" } });
  fireEvent.change(screen.getByLabelText("Port"), { target: { value: "2222" } });
  fireEvent.change(screen.getByLabelText("User name"), { target: { value: "importer" } });
  fireEvent.click(screen.getByLabelText("Password"));
  fireEvent.change(screen.getByLabelText("SSH password"), { target: { value: PASSWORD } });
  fireEvent.change(screen.getByLabelText("Uploads folder path on the server"), { target: { value: "/srv/uploads" } });
  fireEvent.click(screen.getByLabelText("This source holds synthetic test data"));
};

describe("the upstream photo import page", () => {
  it("a non-super-admin sees the restriction and nothing is requested", async () => {
    await asRole("HEALTHCARE ADMIN");
    render(<UpstreamImportPage />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Import device photos from the old server");
    expect(screen.getByText(/Only a platform super admin/)).toBeInTheDocument();
    await act(async () => Promise.resolve());
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it("shows the DPIA gate banner while real data is not allowed, and the list from `data`", async () => {
    await asRole("SUPERADMIN");
    render(<UpstreamImportPage />);
    expect(await screen.findByText("Real data may not be imported yet")).toBeInTheDocument();
    expect(await screen.findByText("importer@test-ssh:2222")).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(mockedGet).toHaveBeenCalledWith(BASE, { params: { page: 1, limit: 20 } });
  });

  it("an open gate says so", async () => {
    realDataAllowed = true;
    await asRole("SUPERADMIN");
    render(<UpstreamImportPage />);
    expect(await screen.findByText("The DPIA gate is open: real sources may be imported.")).toBeInTheDocument();
  });

  it("check → confirm the fingerprint → estimate → start; the password is cleared after the start", async () => {
    await asRole("SUPERADMIN");
    render(<UpstreamImportPage />);
    await screen.findByText("importer@test-ssh:2222");
    fillSource();
    const start = screen.getByRole("button", { name: /Start import/ });
    expect(start).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /Check connection/ }));
    expect(await screen.findByText("Host keys read. Confirm the fingerprint.")).toBeInTheDocument();
    expect(mockedPost).toHaveBeenCalledWith(`${BASE}/check-connection`, {
      host: "test-ssh",
      port: 2222,
      username: "importer",
      authMethod: "password",
      password: PASSWORD,
      remotePath: "/srv/uploads",
      fileClasses: ["front", "serial"],
      syntheticSource: true,
    });
    // The strongest key is preselected; the operator may choose another.
    expect(screen.getByLabelText(new RegExp(`ssh-ed25519 ${FP.replace("+", "\\+")}`))).toBeChecked();
    fireEvent.click(screen.getByLabelText(new RegExp(`ssh-rsa ${FP2}`)));
    fireEvent.click(screen.getByLabelText(new RegExp(`ssh-ed25519 ${FP}`)));
    fireEvent.click(screen.getByRole("button", { name: /This fingerprint matches the server/ }));
    expect(await screen.findByText("Connected; the folders are readable.")).toBeInTheDocument();
    expect(screen.getByText(/Front photos \(foto_depan\): 1,200 files, 2\.3 MB/)).toBeInTheDocument();
    expect(screen.getByText(/Serial-plate photos \(foto_sn\): folder does not exist/)).toBeInTheDocument();
    expect(start).toBeDisabled(); // no tenant yet

    fireEvent.click(screen.getByRole("button", { name: "Target tenant" }));
    fireEvent.click(await screen.findByText("Provider"));
    fireEvent.change(screen.getByLabelText("Bandwidth limit (KiB/s, optional)"), { target: { value: "2048" } });
    await waitFor(() => expect(start).toBeEnabled());
    fireEvent.click(start);
    await waitFor(() =>
      expect(mockedPost).toHaveBeenCalledWith(BASE, expect.objectContaining({ confirmedFingerprint: FP, targetTenantId: TENANT, bandwidthLimitKbps: 2048, password: PASSWORD })),
    );
    await waitFor(() => expect(screen.getByLabelText("SSH password")).toHaveValue(""));
    expect(await screen.findByText("Transferring")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(PASSWORD);
  });

  it("changing the source after a check requires a new check", async () => {
    await asRole("SUPERADMIN");
    render(<UpstreamImportPage />);
    await screen.findByText("importer@test-ssh:2222");
    fillSource();
    fireEvent.click(screen.getByRole("button", { name: /Check connection/ }));
    expect(await screen.findByText("Host keys read. Confirm the fingerprint.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Host"), { target: { value: "other-host" } });
    expect(screen.queryByText("Host keys read. Confirm the fingerprint.")).not.toBeInTheDocument();
  });

  it("key authentication sends the key, not a password; a no-bandwidth start sends null", async () => {
    await asRole("SUPERADMIN");
    render(<UpstreamImportPage />);
    await screen.findByText("importer@test-ssh:2222");
    fireEvent.change(screen.getByLabelText("Host"), { target: { value: "test-ssh" } });
    fireEvent.change(screen.getByLabelText("User name"), { target: { value: "importer" } });
    fireEvent.change(screen.getByLabelText("SSH private key (no passphrase)"), { target: { value: "-----BEGIN OPENSSH PRIVATE KEY-----\nx\n-----END OPENSSH PRIVATE KEY-----" } });
    fireEvent.change(screen.getByLabelText("Uploads folder path on the server"), { target: { value: "/srv/uploads" } });
    fireEvent.click(screen.getByLabelText("Serial-plate photos (foto_sn)"));
    fireEvent.click(screen.getByRole("button", { name: /Check connection/ }));
    await screen.findByText("Host keys read. Confirm the fingerprint.");
    const body = mockedPost.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(body).toMatchObject({ authMethod: "key", fileClasses: ["front"] });
    expect(body).not.toHaveProperty("password");
    fireEvent.click(screen.getByRole("button", { name: /This fingerprint matches the server/ }));
    await screen.findByText("Connected; the folders are readable.");
    fireEvent.click(screen.getByRole("button", { name: "Target tenant" }));
    fireEvent.click(await screen.findByText("Provider"));
    fireEvent.click(screen.getByRole("button", { name: /Start import/ }));
    await waitFor(() => expect(mockedPost).toHaveBeenCalledWith(BASE, expect.objectContaining({ bandwidthLimitKbps: null })));
  });

  it("a refused check or start shows the backend's explanation", async () => {
    await asRole("SUPERADMIN");
    mockedPost.mockRejectedValueOnce(httpError(403, "Importing real upstream data is disabled until the DPIA gates are met"));
    render(<UpstreamImportPage />);
    await screen.findByText("importer@test-ssh:2222");
    fillSource();
    fireEvent.click(screen.getByRole("button", { name: /Check connection/ }));
    expect(await screen.findByText(/disabled until the DPIA gates are met/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Check connection/ }));
    await screen.findByText("Host keys read. Confirm the fingerprint.");
    fireEvent.click(screen.getByRole("button", { name: /This fingerprint matches the server/ }));
    await screen.findByText("Connected; the folders are readable.");
    fireEvent.click(screen.getByRole("button", { name: "Target tenant" }));
    fireEvent.click(await screen.findByText("Provider"));
    mockedPost.mockRejectedValueOnce(httpError(409, "The server no longer presents the confirmed host key."));
    fireEvent.click(screen.getByRole("button", { name: /Start import/ }));
    expect(await screen.findByText("The server no longer presents the confirmed host key.")).toBeInTheDocument();
    expect(screen.getByLabelText("SSH password")).toHaveValue(PASSWORD);
  });

  it("details show the counts and the erasure; cancel asks first", async () => {
    rows = [imp(), imp({ id: "live-1", status: "ingesting", summary: null, credentialStored: true, secretErasedAt: null, progress: { filesTransferred: 4, bytesTransferred: 12000, filesProcessed: 2, filesToProcess: 4 } }), imp({ id: "f-1", status: "failed", errorCode: "auth_failed", summary: null, progress: null }), imp({ id: "p-1", status: "pending", progress: null, summary: null, estimate: null })];
    await asRole("SUPERADMIN");
    render(<UpstreamImportPage />);
    await screen.findAllByText("importer@test-ssh:2222");
    expect(screen.getByRole("progressbar", { name: "Progress 75%" })).toBeInTheDocument();

    const [first] = screen.getAllByRole("button", { name: "Details" });
    fireEvent.click(first as HTMLElement);
    const summary = screen.getByRole("region", { name: "Summary" });
    expect(within(summary).getByText("file_type_refused: 1")).toBeInTheDocument();
    expect(within(summary).getByText(/Credential erased/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));

    fireEvent.click(screen.getAllByRole("button", { name: "Details" })[2] as HTMLElement);
    expect(within(screen.getByRole("region", { name: "Summary" })).getByText("The login was refused.")).toBeInTheDocument();

    const cancels = screen.getAllByRole("button", { name: "Cancel" });
    expect(cancels).toHaveLength(2);
    fireEvent.click(cancels[0] as HTMLElement);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Yes, cancel the import" }));
    await waitFor(() => expect(mockedPost).toHaveBeenCalledWith(`${BASE}/live-1/cancel`, {}));
  });

  it("opens the import a notification links to (?import=<id>)", async () => {
    window.history.pushState({}, "", "/dashboard/upstream-import?import=5f0c2b8e-3a4d-4c6b-9e1f-7a8b9c0d1e2f");
    try {
      await asRole("SUPERADMIN");
      render(<UpstreamImportPage />);
      const summary = await screen.findByRole("region", { name: "Summary" });
      expect(within(summary).getByText("file_type_refused: 1")).toBeInTheDocument();
    } finally {
      window.history.pushState({}, "", "/");
    }
  });

  it("a failed cancel shows the explanation; dismissing the dialog sends nothing", async () => {
    rows = [imp({ id: "live-1", status: "transferring", summary: null })];
    await asRole("SUPERADMIN");
    mockedPost.mockRejectedValueOnce(httpError(409, "This import is already completed; there is nothing to cancel"));
    render(<UpstreamImportPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Keep it running" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockedPost).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Yes, cancel the import" }));
    expect(await screen.findByText(/already completed; there is nothing to cancel/)).toBeInTheDocument();
  });

  it("an empty list and a failed list are distinct", async () => {
    rows = [];
    await asRole("SUPERADMIN");
    const { unmount } = render(<UpstreamImportPage />);
    expect(await screen.findByText("No imports yet.")).toBeInTheDocument();
    unmount();
    mockedGet.mockImplementation(async () => {
      throw httpError(500, "boom");
    });
    render(<UpstreamImportPage />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("switches to Indonesian, with the page's lang", async () => {
    await asRole("SUPERADMIN");
    render(<UpstreamImportPage />);
    await screen.findByText("importer@test-ssh:2222");
    fireEvent.click(screen.getByRole("button", { name: "ID" }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Impor foto alat dari server lama");
    expect(screen.getByRole("heading", { level: 1 }).closest("[lang]")).toHaveAttribute("lang", "id");
    expect(screen.getByText("Selesai")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ID" })).toHaveAttribute("aria-pressed", "true");
  });

  it("polls while an import is live", async () => {
    rows = [imp({ status: "transferring", summary: null })];
    await asRole("SUPERADMIN");
    render(<UpstreamImportPage />);
    await screen.findByText("Transferring");
    const lists = () => mockedGet.mock.calls.filter(([u]) => u === BASE).length;
    const before = lists();
    await waitFor(() => expect(lists()).toBeGreaterThan(before), { timeout: 7_000 });
  }, 15_000);

  it("has no axe violations with a check answered", async () => {
    await asRole("SUPERADMIN");
    const { container } = render(<UpstreamImportPage />);
    await screen.findByText("importer@test-ssh:2222");
    fillSource();
    fireEvent.click(screen.getByRole("button", { name: /Check connection/ }));
    await screen.findByText("Host keys read. Confirm the fingerprint.");
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe("messages and helpers", () => {
  it("starts in Indonesian only when the locale cookie says so", () => {
    expect(initialLocale("locale=id")).toBe("id");
    expect(initialLocale("a=1; locale=id; b=2")).toBe("id");
    expect(initialLocale("locale=en")).toBe("en");
    expect(initialLocale("")).toBe("en");
  });

  it("the two languages have the same keys", () => {
    expect(Object.keys(MESSAGES.en).sort()).toEqual(Object.keys(MESSAGES.id).sort());
    expect(Object.keys(MESSAGES.en.outcome).sort()).toEqual(Object.keys(MESSAGES.id.outcome).sort());
  });

  it("formats bytes", () => {
    expect(formatBytes(10)).toBe("10 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
  });
});
