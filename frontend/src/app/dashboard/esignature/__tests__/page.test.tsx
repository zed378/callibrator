/** @jest-environment jsdom */
/**
 * A-65 — signing a workflow step re-authenticates the signer.
 *
 * Fixtures mirror the backend exactly:
 *  - GET /esignature/workflows    → rows ARE `data`, count in a top-level
 *    `meta` (A-106; formerly data.workflows)
 *  - GET /esignature/workflows/:id → success(res, workflow) with `steps`, each a
 *    signatureWorkflowStep row: { id, workflowId, stepNumber, signerId,
 *    signerEmail, signerName, status, signedAt } (no `userId`)
 *  - POST /esignature/sign        → success(res, { signatureId, certificate })
 *  - errors: the api client rejects with an Error carrying the backend message
 */
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

jest.mock("@/components/layouts/DashboardLayout", () => {
  return function DashboardLayout({ children }: { children: React.ReactNode }) {
    return <div data-testid="dashboard-layout">{children}</div>;
  };
});

jest.mock("@/api/client", () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  },
}));

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const WF = "33333333-3333-4333-8333-333333333333";
const MY_STEP = "44444444-4444-4444-8444-444444444444";
const THEIR_STEP = "55555555-5555-4555-8555-555555555555";

const mockAuthState = { user: { id: ME } as { id: string } | null };
jest.mock("@/stores/authStore", () => ({
  useAuthStore: (selector: (s: typeof mockAuthState) => unknown) => selector(mockAuthState),
}));

import { api } from "@/api/client";
import { useToastStore } from "@/stores/toastStore";
import ESignaturePage from "../page";

const mockedApi = api as jest.Mocked<typeof api>;

const envelope = (data: unknown, message = "ok") => ({
  success: true,
  status: 200,
  message,
  data,
});

const step = (overrides: Record<string, unknown>) => ({
  id: MY_STEP,
  workflowId: WF,
  stepNumber: 1,
  signerId: ME,
  signerEmail: "me@hospital.test",
  signerName: "Me Signer",
  status: "pending",
  signedAt: null,
  ...overrides,
});

const workflow = (steps: unknown[]) => ({
  id: WF,
  tenantId: "tenant-1",
  documentId: "doc-1",
  subject: "Approve SOP-12",
  status: "in_progress",
  createdAt: "2026-09-24T08:00:00.000Z",
  steps,
});

const signed = {
  signatureId: "sig-1",
  certificate: {
    signatureId: "sig-1",
    workflowId: WF,
    documentId: "doc-1",
    signerId: ME,
    signedAt: "2026-09-24T09:00:00.000Z",
    signatureHash: "ab".repeat(32),
    signatureValue: "c2ln",
    signingKeyId: "key-1",
    signatureScheme: "esig-v2-rsa-sha256",
    algorithm: "RS256",
    ipAddress: "203.0.113.9",
    userAgent: "Mozilla/5.0",
    verificationUrl: "/api/v1/esignature/verify/sig-1",
  },
};

const serveWorkflow = (wf: ReturnType<typeof workflow>) => {
  mockedApi.get.mockImplementation(async (path: string) => {
    // A-113: rows ARE `data`, count in a top-level `meta`.
    if (path.endsWith("/key-pairs")) return { ...envelope([]), meta: { total: 0 } };
    // A-91 signer view: rows ARE `data`, count in a top-level `meta`.
    if (path.endsWith("/my-workflows")) return { ...envelope([wf]), meta: { total: 1 } };
    if (path.endsWith(`/my-workflows/${WF}`)) return envelope(wf);
    // A-106: the management list has the same shape as the signer view.
    if (path.endsWith("/workflows")) return { ...envelope([wf]), meta: { total: 1 } };
    if (path.endsWith(`/workflows/${WF}`)) return envelope(wf);
    throw new Error(`unexpected GET ${path}`);
  });
};

const openWorkflow = async () => {
  render(<ESignaturePage />);
  fireEvent.click(screen.getByRole("button", { name: "Workflows" }));
  await screen.findByText("Approve SOP-12");
  fireEvent.click(screen.getByRole("button", { name: "View" }));
  await screen.findByText("Me Signer");
};

beforeEach(() => {
  jest.clearAllMocks();
  mockAuthState.user = { id: ME };
  useToastStore.setState({ toasts: [] });
});

describe("ESignaturePage — signing re-authenticates (A-65)", () => {
  it("signing asks for the password and the meaning, and posts them with the step — no ip or user agent", async () => {
    serveWorkflow(workflow([step({})]));
    mockedApi.post.mockResolvedValueOnce(envelope(signed, "Document signed"));
    await openWorkflow();

    fireEvent.click(screen.getByRole("button", { name: "Sign" }));
    const form = screen.getByRole("form", { name: "Sign this step" });
    fireEvent.change(within(form).getByPlaceholderText("Your password"), {
      target: { value: "s3cret" },
    });
    fireEvent.change(within(form).getByPlaceholderText("e.g. Reviewed and approved"), {
      target: { value: "Reviewed and approved" },
    });
    fireEvent.click(within(form).getByRole("button", { name: "Sign" }));

    await waitFor(() => expect(mockedApi.post).toHaveBeenCalledTimes(1));
    const [path, body] = mockedApi.post.mock.calls[0];
    expect(path).toBe("/api/v1/esignature/sign");
    expect(body).toEqual({
      stepId: MY_STEP,
      authenticationMethod: "password",
      authPayload: "s3cret",
      reason: "Reviewed and approved",
    });
    expect(body).not.toHaveProperty("ipAddress");
    expect(body).not.toHaveProperty("userAgent");

    await waitFor(() =>
      expect(useToastStore.getState().toasts).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: "success", title: "Document signed" })]),
      ),
    );
    // The credential form is gone once the signature is recorded.
    expect(screen.queryByRole("form", { name: "Sign this step" })).not.toBeInTheDocument();
  });

  it("does not send a signature without a credential", async () => {
    serveWorkflow(workflow([step({})]));
    await openWorkflow();

    fireEvent.click(screen.getByRole("button", { name: "Sign" }));
    const form = screen.getByRole("form", { name: "Sign this step" });
    fireEvent.submit(form);

    expect(mockedApi.post).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts).toEqual([
      expect.objectContaining({ type: "warning" }),
    ]);
  });

  it("a rejected credential shows the backend's message and clears the password field", async () => {
    serveWorkflow(workflow([step({})]));
    mockedApi.post.mockRejectedValueOnce(new Error("Invalid password for e-signature."));
    await openWorkflow();

    fireEvent.click(screen.getByRole("button", { name: "Sign" }));
    const form = screen.getByRole("form", { name: "Sign this step" });
    const password = within(form).getByPlaceholderText("Your password") as HTMLInputElement;
    fireEvent.change(password, { target: { value: "wrong" } });
    fireEvent.change(within(form).getByPlaceholderText("e.g. Reviewed and approved"), {
      target: { value: "Verified" },
    });
    fireEvent.click(within(form).getByRole("button", { name: "Sign" }));

    await waitFor(() =>
      expect(useToastStore.getState().toasts).toEqual([
        expect.objectContaining({
          type: "error",
          title: "Could not sign",
          description: "Invalid password for e-signature.",
        }),
      ]),
    );
    expect(password.value).toBe("");
  });

  it("offers no Sign action on another signer's step, and names who it awaits", async () => {
    serveWorkflow(
      workflow([
        step({ status: "signed", signedAt: "2026-09-24T09:00:00.000Z" }),
        step({
          id: THEIR_STEP,
          stepNumber: 2,
          signerId: OTHER,
          signerName: "Other Signer",
          signerEmail: "other@hospital.test",
        }),
      ]),
    );
    await openWorkflow();

    expect(screen.queryByRole("button", { name: "Sign" })).not.toBeInTheDocument();
    expect(screen.getByText("Awaiting Other Signer")).toBeInTheDocument();
  });
});

/**
 * A-91 — a signer without `qms` opens the workflow they must sign through the
 * signer view (GET /esignature/my-workflows[/:id], gated on `esignature`).
 * The fixtures are the backend's real shapes: eSignature.controller
 * #getSignerWorkflows answers success(res, rows, { total }, msg) — rows in
 * `data`, `meta` a top-level sibling — and #getSignerWorkflow the workflow in
 * `data`, its steps without ipAddress/userAgent. The management routes answer
 * a signer without `qms` with 403, as dynamicAccess does.
 */
describe("ESignaturePage — the signer view (A-91)", () => {
  const forbidden = () =>
    Object.assign(new Error("Access denied"), { response: { status: 403 } });

  const serveSignerOnly = (wf: ReturnType<typeof workflow>) => {
    mockedApi.get.mockImplementation(async (path: string) => {
      if (path.endsWith("/my-workflows")) return { ...envelope([wf]), meta: { total: 1 } };
      if (path.endsWith(`/my-workflows/${WF}`)) return envelope(wf);
      if (path.endsWith("/key-pairs") || path.includes("/esignature/workflows")) {
        throw forbidden();
      }
      throw new Error(`unexpected GET ${path}`);
    });
  };

  it("opens on To sign, listing the workflows that name the caller, and never calls the qms routes", async () => {
    serveSignerOnly(workflow([step({})]));
    render(<ESignaturePage />);

    expect(await screen.findByText("Approve SOP-12")).toBeInTheDocument();
    expect(screen.getByText("awaiting your signature")).toBeInTheDocument();
    const paths = mockedApi.get.mock.calls.map(([path]) => path);
    expect(paths).toEqual(["/api/v1/esignature/my-workflows"]);
    expect(mockedApi.get).toHaveBeenCalledWith("/api/v1/esignature/my-workflows", { params: {} });
  });

  it("a technician named as signer can open and sign their step without qms", async () => {
    const wf = workflow([step({})]);
    serveSignerOnly(wf);
    mockedApi.post.mockResolvedValueOnce(envelope(signed, "Document signed"));
    render(<ESignaturePage />);

    await screen.findByText("Approve SOP-12");
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    await screen.findByText("Me Signer");
    expect(mockedApi.get).toHaveBeenCalledWith(`/api/v1/esignature/my-workflows/${WF}`);

    fireEvent.click(screen.getByRole("button", { name: "Sign" }));
    const form = screen.getByRole("form", { name: "Sign this step" });
    fireEvent.change(within(form).getByPlaceholderText("Your password"), {
      target: { value: "s3cret" },
    });
    fireEvent.change(within(form).getByPlaceholderText("e.g. Reviewed and approved"), {
      target: { value: "Verified" },
    });
    fireEvent.click(within(form).getByRole("button", { name: "Sign" }));

    await waitFor(() =>
      expect(useToastStore.getState().toasts).toEqual([
        expect.objectContaining({ type: "success", title: "Document signed" }),
      ]),
    );
    expect(mockedApi.post).toHaveBeenCalledWith(
      "/api/v1/esignature/sign",
      expect.objectContaining({ stepId: MY_STEP }),
    );
    // Re-read through the signer view, never the qms routes.
    const paths = mockedApi.get.mock.calls.map(([path]) => path);
    expect(paths.filter((path) => path.includes("/esignature/workflows"))).toEqual([]);
    expect(paths.filter((path) => path === `/api/v1/esignature/my-workflows/${WF}`)).toHaveLength(2);
  });

  it("management tabs explain the missing permission instead of toasting a 403", async () => {
    serveSignerOnly(workflow([step({})]));
    render(<ESignaturePage />);
    await screen.findByText("Approve SOP-12");

    fireEvent.click(screen.getByRole("button", { name: "Workflows" }));

    expect(
      await screen.findByText(/needs the Quality Management permission/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New Workflow" })).not.toBeInTheDocument();
    expect(useToastStore.getState().toasts).toEqual([]);

    // Once refused, the other management tab does not ask again.
    fireEvent.click(screen.getByRole("button", { name: "Key Pairs" }));
    expect(screen.getByText(/needs the Quality Management permission/)).toBeInTheDocument();
    const keyCalls = mockedApi.get.mock.calls.filter(([path]) => path.endsWith("/key-pairs"));
    expect(keyCalls).toEqual([]);
  });

  it("a management load failure other than 403 is still reported", async () => {
    mockedApi.get.mockImplementation(async (path: string) => {
      if (path.endsWith("/my-workflows")) return { ...envelope([]), meta: { total: 0 } };
      throw new Error("Service unavailable");
    });
    render(<ESignaturePage />);
    await screen.findByText("No signature workflows name you as a signer.");

    fireEvent.click(screen.getByRole("button", { name: "Key Pairs" }));

    await waitFor(() =>
      expect(useToastStore.getState().toasts).toEqual([
        expect.objectContaining({ type: "error", title: "Could not load key pairs" }),
      ]),
    );
  });

  it("a failure to load the signer view is reported", async () => {
    mockedApi.get.mockRejectedValue(new Error("Service unavailable"));
    render(<ESignaturePage />);

    await waitFor(() =>
      expect(useToastStore.getState().toasts).toEqual([
        expect.objectContaining({
          type: "error",
          title: "Could not load your signature requests",
          description: "Service unavailable",
        }),
      ]),
    );
  });
});
