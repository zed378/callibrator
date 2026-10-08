/** @jest-environment jsdom */
/**
 * e-Signature — destructive actions ask first, and a failed load is a failure
 * (audit 01 §4.6, severities 4 and 3).
 *
 *  - Key pair and workflow Delete open a confirmation naming the object;
 *    cancelling sends nothing.
 *  - A key-pair or workflow list that fails to load shows the failure and a
 *    retry — never "No key pairs yet", which claims there are none.
 *
 * Fail-before: Delete called the API on the first click; a failed load left
 * the empty-list message under an error toast.
 *
 * Fixtures follow the backend:
 *  - GET  /esignature/key-pairs → rows in `data` ({ id, keyId, algorithm,
 *    publicKey, createdAt }), count in a top-level `meta` (A-113);
 *  - POST /esignature/key-pairs, DELETE /esignature/key-pairs/:id;
 *  - POST /esignature/verify { signatureId } → data { valid, reason? };
 *  - the api client rejects with an Error carrying the backend message and the
 *    axios `response.status`.
 */
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

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

describe("e-Signature — deletes ask first", () => {
  it("key pair: the click opens a confirmation naming it; Cancel sends nothing", async () => {
    await openTab("Key Pairs");
    await screen.findByText("tenant-key-1");
    fireEvent.click(screen.getByRole("button", { name: "Delete key pair tenant-key-1" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete key pair tenant-key-1?" });
    expect(within(dialog).getByText(/cannot be undone/)).toBeInTheDocument();
    expect(del).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(del).not.toHaveBeenCalled();
  });

  it("key pair: confirming deletes it", async () => {
    del.mockResolvedValueOnce(envelope(null));
    await openTab("Key Pairs");
    await screen.findByText("tenant-key-1");
    fireEvent.click(screen.getByRole("button", { name: "Delete key pair tenant-key-1" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete key pair tenant-key-1?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete key pair" }));
    await waitFor(() => expect(del).toHaveBeenCalledWith("/api/v1/esignature/key-pairs/k-1"));
  });

  it("workflow: the click opens a confirmation naming it; Cancel sends nothing", async () => {
    await openTab("Workflows");
    await screen.findByText("Approve SOP-12");
    fireEvent.click(screen.getByRole("button", { name: "Delete workflow Approve SOP-12" }));
    const dialog = await screen.findByRole("dialog", { name: 'Delete workflow "Approve SOP-12"?' });
    expect(within(dialog).getByText(/cancel it instead/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(del).not.toHaveBeenCalled();
  });
});

describe("e-Signature — a failed load is not an empty list", () => {
  it("key pairs: the failure and a retry are shown, not 'No key pairs yet'; the retry recovers", async () => {
    get.mockImplementation(async (path: string) => {
      if (path.endsWith("/my-workflows")) return list([]);
      if (path.endsWith("/key-pairs")) throw withStatus(500, "Key store unavailable");
      throw new Error(`unexpected GET ${path}`);
    });
    await openTab("Key Pairs");
    expect((await screen.findAllByText("Could not load key pairs")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Key store unavailable").length).toBeGreaterThan(0);
    expect(screen.queryByText("No key pairs yet. Generate one to start signing.")).not.toBeInTheDocument();

    backend();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("tenant-key-1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("workflows: the failure is shown, not 'No signature workflows yet'", async () => {
    get.mockImplementation(async (path: string) => {
      if (path.endsWith("/my-workflows")) return list([]);
      if (path.endsWith("/workflows")) throw withStatus(500, "Workflow store down");
      throw new Error(`unexpected GET ${path}`);
    });
    await openTab("Workflows");
    expect((await screen.findAllByText("Workflow store down")).length).toBeGreaterThan(0);
    expect(screen.queryByText("No signature workflows yet.")).not.toBeInTheDocument();
  });

  it("your signature requests: the failure is shown, not 'No signature workflows name you'", async () => {
    get.mockImplementation(async () => {
      throw withStatus(500, "Down");
    });
    render(<ESignaturePage />);
    expect((await screen.findAllByText("Down")).length).toBeGreaterThan(0);
    expect(screen.queryByText("No signature workflows name you as a signer.")).not.toBeInTheDocument();
  });
});

// ADR-102 cases for this page: page.permissions.adr102.test.tsx
