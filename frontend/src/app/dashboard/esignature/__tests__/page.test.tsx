/** @jest-environment jsdom */
/**
 * A-65 — signing a workflow step re-authenticates the signer.
 *
 * Fixtures mirror the backend exactly:
 *  - GET /esignature/workflows    → success(res, { workflows }) — data.workflows
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
    if (path.endsWith("/key-pairs")) return envelope({ keyPairs: [] });
    if (path.endsWith("/workflows")) return envelope({ workflows: [wf] });
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
