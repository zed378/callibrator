/** @jest-environment jsdom */
/**
 * e-Signature page — key pairs, verification, and the workflow paths the A-65 /
 * A-91 / A-129 suite (page.test.tsx) does not reach. Fixtures follow the
 * backend:
 *  - GET  /esignature/key-pairs → rows in `data` ({ id, keyId, algorithm,
 *    publicKey, createdAt }), count in a top-level `meta` (A-113);
 *  - POST /esignature/key-pairs, DELETE /esignature/key-pairs/:id;
 *  - POST /esignature/verify { signatureId } → data { valid, reason? };
 *  - the api client rejects with an Error carrying the backend message and the
 *    axios `response.status`.
 */
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { axeViolations } from "@/tests/a11y/axe";

jest.mock("@/components/layouts/DashboardLayout", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

jest.mock("@/api/client", () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

const ME = "11111111-1111-4111-8111-111111111111";
const mockAuthState = { user: { id: ME } as { id: string } | null };
jest.mock("@/stores/authStore", () => ({
  useAuthStore: (selector: (s: typeof mockAuthState) => unknown) => selector(mockAuthState),
}));

import { api } from "@/api/client";
import { useToastStore } from "@/stores/toastStore";
import ESignaturePage from "../page";
import { grantPermissions, grantSuperAdmin, clearPermissions } from "@/tests/support/permissions";

jest.setTimeout(20000);

const get = api.get as jest.Mock;
const post = api.post as jest.Mock;
const del = api.delete as jest.Mock;

const envelope = (data: unknown, message = "ok") => ({ success: true, status: 200, message, data });
const list = (rows: unknown[]) => ({ ...envelope(rows), meta: { total: rows.length } });
const withStatus = (status: number, message: string) => Object.assign(new Error(message), { response: { status } });

const WF = "33333333-3333-4333-8333-333333333333";
const workflowRow = (patch: Record<string, unknown> = {}) => ({
  id: WF,
  tenantId: "tenant-1",
  documentId: "doc-1",
  subject: "Approve SOP-12",
  status: "in_progress",
  createdAt: "2026-09-24T08:00:00.000Z",
  steps: [],
  ...patch,
});

let keys: unknown[] = [];
let workflows: unknown[] = [];

const backend = () => {
  get.mockImplementation(async (path: string) => {
    if (path.endsWith("/my-workflows")) return list([]);
    if (path.endsWith("/key-pairs")) return list(keys);
    if (path.endsWith("/workflows")) return list(workflows);
    if (path.endsWith("/signers")) return list([{ id: "u-a", name: "Ana Tech", email: "ana@x.test" }, { id: "u-b", name: "Ben", email: "ben@x.test" }]);
    throw new Error(`unexpected GET ${path}`);
  });
};

const toasts = () => useToastStore.getState().toasts;

beforeEach(() => {
  // ADR-102: write controls follow the effective permissions.
  grantPermissions({ qms: "write", esignature: "write" });
  jest.clearAllMocks();
  mockAuthState.user = { id: ME };
  keys = [
    { id: "k-1", keyId: "tenant-key-1", algorithm: "RS256", publicKey: "-----BEGIN PUBLIC KEY-----MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIB", createdAt: "2026-09-01T00:00:00.000Z" },
  ];
  workflows = [workflowRow()];
  useToastStore.setState({ toasts: [] });
  backend();
});

const openTab = async (name: string) => {
  const view = render(<ESignaturePage />);
  await screen.findByText("No signature workflows name you as a signer.");
  fireEvent.click(screen.getByRole("button", { name }));
  return view;
};


/** Deleting asks first (audit 01 §4.6): open the confirmation and confirm it. */
const deleteAndConfirm = async (kind: "workflow" | "key pair") => {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^Delete ${kind} `) }));
  const dialog = await screen.findByRole("dialog", { name: new RegExp(`^Delete ${kind}`) });
  fireEvent.click(within(dialog).getByRole("button", { name: `Delete ${kind}` }));
};

describe("e-Signature — key pairs", () => {
  it("lists the tenant's key pairs, and the tab passes an accessibility check", async () => {
    const { container } = await openTab("Key Pairs");

    expect(await screen.findByText("tenant-key-1")).toBeInTheDocument();
    expect(screen.getByText("RS256")).toBeInTheDocument();
    expect(screen.getByText(/^-----BEGIN PUBLIC KEY-----MIIB\w*…$/)).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("with no key pairs yet, says how to start", async () => {
    keys = [];
    await openTab("Key Pairs");

    expect(await screen.findByText("No key pairs yet. Generate one to start signing.")).toBeInTheDocument();
  });

  it("a key without a key id or public key falls back to its id and a dash", async () => {
    keys = [{ id: "k-9" }];
    await openTab("Key Pairs");

    expect(await screen.findByText("k-9")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("generates a key pair, confirms it, and re-reads the list", async () => {
    post.mockResolvedValue(envelope({ id: "k-2" }));
    await openTab("Key Pairs");
    await screen.findByText("tenant-key-1");
    const before = get.mock.calls.filter(([p]) => p.endsWith("/key-pairs")).length;

    fireEvent.click(screen.getByRole("button", { name: /Generate Key Pair/ }));

    await waitFor(() => expect(toasts()[0]).toMatchObject({ type: "success", title: "Key pair generated" }));
    expect(post).toHaveBeenCalledWith("/api/v1/esignature/key-pairs", {});
    expect(get.mock.calls.filter(([p]) => p.endsWith("/key-pairs")).length).toBeGreaterThan(before);
  });

  it("a refused generation is reported with the backend's message", async () => {
    post.mockRejectedValue(withStatus(400, "API keys cannot create key pairs"));
    await openTab("Key Pairs");
    await screen.findByText("tenant-key-1");

    fireEvent.click(screen.getByRole("button", { name: /Generate Key Pair/ }));

    await waitFor(() =>
      expect(toasts()[0]).toMatchObject({
        type: "error",
        title: "Could not generate key pair",
        description: "API keys cannot create key pairs",
      }),
    );
  });

  it("deletes a key pair, and reports a refused delete", async () => {
    del.mockResolvedValueOnce(envelope(null));
    await openTab("Key Pairs");
    await screen.findByText("tenant-key-1");

    await deleteAndConfirm("key pair");
    await waitFor(() => expect(toasts()[0]).toMatchObject({ type: "success", title: "Key pair deleted" }));
    expect(del).toHaveBeenCalledWith("/api/v1/esignature/key-pairs/k-1");

    useToastStore.setState({ toasts: [] });
    del.mockRejectedValueOnce(withStatus(404, "Key pair not found"));
    await screen.findByRole("button", { name: /^Delete key pair / });
    await deleteAndConfirm("key pair");
    await waitFor(() =>
      expect(toasts()[0]).toMatchObject({ type: "error", title: "Could not delete key pair", description: "Key pair not found" }),
    );
  });

  it("a 403 on key pairs explains the missing permission instead of toasting", async () => {
    get.mockImplementation(async (path: string) => {
      if (path.endsWith("/my-workflows")) return list([]);
      throw withStatus(403, "Forbidden");
    });
    await openTab("Key Pairs");

    expect(await screen.findByText(/needs the Quality Management permission/)).toBeInTheDocument();
    expect(toasts()).toEqual([]);
  });

  it("Refresh re-reads the key pairs", async () => {
    await openTab("Key Pairs");
    await screen.findByText("tenant-key-1");
    const before = get.mock.calls.filter(([p]) => p.endsWith("/key-pairs")).length;

    fireEvent.click(screen.getByRole("button", { name: /Refresh/ }));

    await waitFor(() => expect(get.mock.calls.filter(([p]) => p.endsWith("/key-pairs")).length).toBeGreaterThan(before));
  });
});

describe("e-Signature — verification", () => {
  it("does nothing without a signature id", async () => {
    await openTab("Verify");

    fireEvent.click(screen.getByRole("button", { name: /Verify Signature/ }));

    expect(post).not.toHaveBeenCalled();
  });

  it("an intact signature is reported valid, and the tab passes an accessibility check", async () => {
    post.mockResolvedValue(envelope({ valid: true, signatureId: "sig-1" }, "Signature verified"));
    const { container } = await openTab("Verify");

    fireEvent.change(screen.getByPlaceholderText("signature record id"), { target: { value: "  sig-1  " } });
    fireEvent.click(screen.getByRole("button", { name: /Verify Signature/ }));

    expect(await screen.findByText("Signature is valid — the signed record is intact.")).toBeInTheDocument();
    expect(post).toHaveBeenCalledWith("/api/v1/esignature/verify", { signatureId: "sig-1" });
    expect(await axeViolations(container)).toEqual([]);
  });

  it("an invalid signature shows the backend's reason, or a default one", async () => {
    post.mockResolvedValueOnce(envelope({ valid: false, reason: "Signature has been revoked" }));
    await openTab("Verify");
    fireEvent.change(screen.getByPlaceholderText("signature record id"), { target: { value: "sig-2" } });
    fireEvent.click(screen.getByRole("button", { name: /Verify Signature/ }));
    expect(await screen.findByText("Invalid: Signature has been revoked")).toBeInTheDocument();

    post.mockResolvedValueOnce(envelope({ valid: false }));
    fireEvent.click(screen.getByRole("button", { name: /Verify Signature/ }));
    expect(await screen.findByText("Invalid: signature does not match")).toBeInTheDocument();
  });

  it("a failed verification request is reported, not shown as a verdict", async () => {
    post.mockRejectedValue(withStatus(429, "Too many requests"));
    await openTab("Verify");
    fireEvent.change(screen.getByPlaceholderText("signature record id"), { target: { value: "sig-3" } });
    fireEvent.click(screen.getByRole("button", { name: /Verify Signature/ }));

    await waitFor(() =>
      expect(toasts()[0]).toMatchObject({ type: "error", title: "Verification failed", description: "Too many requests" }),
    );
    expect(screen.queryByText(/Signature is valid/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Invalid:/)).not.toBeInTheDocument();
  });
});

describe("e-Signature — workflows", () => {
  it("each status reads as its own badge; closed workflows offer no Cancel", async () => {
    workflows = [
      workflowRow({ id: "w-1", subject: "Done one", status: "completed" }),
      workflowRow({ id: "w-2", subject: "Stopped one", status: "cancelled" }),
      workflowRow({ id: "w-3", subject: "Late one", status: "expired" }),
      workflowRow({ id: "w-4", subject: "New one", status: "pending" }),
      workflowRow({ id: "w-5", subject: "Odd one", status: undefined, documentId: undefined, createdAt: undefined }),
    ];
    await openTab("Workflows");

    const row = async (subject: string) => (await screen.findByText(subject)).closest("tr") as HTMLElement;
    expect(within(await row("Done one")).getByText("completed")).toBeInTheDocument();
    expect(within(await row("Done one")).queryByRole("button", { name: /Cancel/ })).not.toBeInTheDocument();
    expect(within(await row("Stopped one")).queryByRole("button", { name: /Cancel/ })).not.toBeInTheDocument();
    expect(within(await row("Late one")).getByRole("button", { name: /Cancel/ })).toBeInTheDocument();
    expect(within(await row("New one")).getByText("pending")).toBeInTheDocument();
    expect(within(await row("Odd one")).getByText("doc: —")).toBeInTheDocument();
  });

  it("deletes a workflow without signatures, confirms it, and re-reads the list", async () => {
    del.mockResolvedValue(envelope(null));
    await openTab("Workflows");
    await screen.findByText("Approve SOP-12");

    await deleteAndConfirm("workflow");

    await waitFor(() => expect(toasts()[0]).toMatchObject({ type: "success", title: "Workflow deleted" }));
    expect(del).toHaveBeenCalledWith(`/api/v1/esignature/workflows/${WF}`);
  });

  it("a failure to open a workflow's detail is reported", async () => {
    await openTab("Workflows");
    await screen.findByText("Approve SOP-12");
    get.mockRejectedValueOnce(withStatus(404, "Workflow not found"));

    fireEvent.click(screen.getByRole("button", { name: "View" }));

    await waitFor(() =>
      expect(toasts()[0]).toMatchObject({ type: "error", title: "Could not load workflow", description: "Workflow not found" }),
    );
  });

  it("a workflows load failure other than 403 is reported", async () => {
    get.mockImplementation(async (path: string) => {
      if (path.endsWith("/my-workflows")) return list([]);
      throw withStatus(500, "Workflow store unavailable");
    });
    await openTab("Workflows");

    await waitFor(() =>
      expect(toasts()[0]).toMatchObject({ type: "error", title: "Could not load workflows", description: "Workflow store unavailable" }),
    );
  });

  it("creating needs a document, a subject and a signer — and says so", async () => {
    await openTab("Workflows");
    await screen.findByText("Approve SOP-12");
    fireEvent.click(screen.getByRole("button", { name: /New Workflow/ }));
    const dialog = screen.getByRole("dialog", { name: "New Signature Workflow" });
    await within(dialog).findAllByRole("option", { name: /Ana Tech/ });

    fireEvent.click(within(dialog).getByRole("button", { name: "Create Workflow" }));

    expect(toasts()[0]).toMatchObject({ type: "warning", title: "Document, subject and at least one signer are required" });
    expect(post).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("sends the optional message trimmed, and a removed signer is not sent", async () => {
    post.mockResolvedValue(envelope({ workflowId: WF, signers: [] }));
    await openTab("Workflows");
    await screen.findByText("Approve SOP-12");
    fireEvent.click(screen.getByRole("button", { name: /New Workflow/ }));
    const dialog = screen.getByRole("dialog", { name: "New Signature Workflow" });
    await within(dialog).findAllByRole("option", { name: /Ana Tech/ });

    fireEvent.change(within(dialog).getByPlaceholderText("e.g. certificate uuid"), { target: { value: "doc-9" } });
    fireEvent.change(within(dialog).getByPlaceholderText("Please sign this certificate"), { target: { value: "Sign SOP" } });
    fireEvent.change(within(dialog).getByLabelText("Message"), { target: { value: "  please  " } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Add signer/ }));
    const selects = within(dialog).getAllByRole("combobox");
    fireEvent.change(selects[0], { target: { value: "u-a" } });
    fireEvent.change(selects[1], { target: { value: "u-b" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove signer 2" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Create Workflow" }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/api/v1/esignature/workflows", {
        documentId: "doc-9",
        subject: "Sign SOP",
        message: "please",
        signers: [{ userId: "u-a" }],
      }),
    );
    await waitFor(() => expect(toasts()[0]).toMatchObject({ type: "success", title: "Signature workflow created" }));
  });
});

// ADR-102 cases for this page: page.permissions.adr102.test.tsx
