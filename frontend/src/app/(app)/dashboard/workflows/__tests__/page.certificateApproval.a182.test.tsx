/** @jest-environment jsdom */
/**
 * A-182 — approving a Certificate through its workflow is an electronic
 * signature: the backend now answers 400 unless the approval carries
 * `authMethod`, `authPayload` and `meaning` (the fields of
 * POST /certificates/:id/approve). The approval dialog asks for them — for a
 * Certificate approval only; a rejection, or another record type, sends none.
 *
 * Real: the page, its dialog and ESignatureFields. Mocked: the layout and the
 * two services the page calls.
 */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

jest.mock("@/components/layouts/DashboardLayout", () => {
  return function DashboardLayout({ children }: { children: React.ReactNode }) {
    return <div>{children}</div>;
  };
});

const mockActionOnInstance = jest.fn();
const mockPending = jest.fn();
jest.mock("@/api/services/workflow.service", () => ({
  workflowService: {
    getAll: jest.fn(async () => []),
    getPendingInstances: (...args: unknown[]) => mockPending(...args),
    actionOnInstance: (...args: unknown[]) => mockActionOnInstance(...args),
  },
}));
jest.mock("@/api/services/role.service", () => ({
  roleService: { getAll: jest.fn(async () => ({ data: [] })) },
}));

import WorkflowsPage from "../page";
import { grantPermissions, grantSuperAdmin, clearPermissions } from "@/tests/support/permissions";

const instance = (id: string, resourceType: string) => ({
  id,
  workflowId: `wf-${id}`,
  resourceId: `res-${id}`,
  status: "PENDING",
  currentStepOrder: 1,
  workflow: { id: `wf-${id}`, name: `${resourceType} approval`, resourceType, steps: [] },
});

const openPending = async () => {
  render(<WorkflowsPage />);
  fireEvent.click(await screen.findByRole("button", { name: /My Approvals \(1\)/ }));
};

const dialogButton = (name: RegExp) => {
  const buttons = screen.getAllByRole("button", { name });
  return buttons[buttons.length - 1];
};

beforeEach(() => {
  // ADR-102: write controls follow the effective permissions.
  grantPermissions({ workflows: "write", certificate: "write" });
  jest.clearAllMocks();
  mockActionOnInstance.mockResolvedValue({ status: "APPROVED" });
});

describe("A-182 — the workflow approval dialog re-authenticates a Certificate approval", () => {
  it("asks for credentials and sends them with a Certificate approval", async () => {
    mockPending.mockResolvedValue([instance("c1", "Certificate")]);
    await openPending();

    fireEvent.click(screen.getByRole("button", { name: /^Approve$/ }));
    expect(screen.getByText("Electronic signature")).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText("Your password"), { target: { value: "s3cret" } });
    fireEvent.click(dialogButton(/^Approve$/));

    await waitFor(() => expect(mockActionOnInstance).toHaveBeenCalled());
    expect(mockActionOnInstance).toHaveBeenCalledWith("c1", {
      action: "APPROVED",
      comments: undefined,
      authMethod: "password",
      authPayload: "s3cret",
      meaning: "Reviewed and approved",
    });
  });

  it("does not submit a Certificate approval without the credential", async () => {
    mockPending.mockResolvedValue([instance("c1", "Certificate")]);
    await openPending();

    fireEvent.click(screen.getByRole("button", { name: /^Approve$/ }));
    fireEvent.click(dialogButton(/^Approve$/));

    await new Promise((r) => setTimeout(r, 0));
    expect(mockActionOnInstance).not.toHaveBeenCalled();
  });

  it("a rejection asks for no credentials and sends none", async () => {
    mockPending.mockResolvedValue([instance("c1", "Certificate")]);
    await openPending();

    fireEvent.click(screen.getByRole("button", { name: /^Reject$/ }));
    expect(screen.queryByText("Electronic signature")).toBeNull();
    fireEvent.click(dialogButton(/^Reject$/));

    await waitFor(() => expect(mockActionOnInstance).toHaveBeenCalled());
    expect(mockActionOnInstance).toHaveBeenCalledWith("c1", { action: "REJECTED", comments: undefined });
  });

  it("a stock-transfer approval asks for no credentials", async () => {
    mockPending.mockResolvedValue([instance("s1", "StockTransfer")]);
    await openPending();

    fireEvent.click(screen.getByRole("button", { name: /^Approve$/ }));
    expect(screen.queryByText("Electronic signature")).toBeNull();
    fireEvent.click(dialogButton(/^Approve$/));

    await waitFor(() => expect(mockActionOnInstance).toHaveBeenCalled());
    expect(mockActionOnInstance).toHaveBeenCalledWith("s1", { action: "APPROVED", comments: undefined });
  });
});

/**
 * ADR-102 — New Workflow / Enable / Delete need `workflows` write; Approve /
 * Reject need `certificate`, `warehouse` or `maintenance` write
 * (workflows.route.js). Fail-before: every role got every control.
 */
describe("ADR-102 — workflow controls follow the effective permission", () => {
  const definition = { id: "wf-1", name: "Cert approval", resourceType: "Certificate", isActive: true, steps: [] };

  it("a reader gets no New Workflow, no Enable/Delete and no Approve/Reject", async () => {
    grantPermissions({ workflows: "read", certificate: "read" });
    const { workflowService } = jest.requireMock("@/api/services/workflow.service");
    workflowService.getAll.mockResolvedValueOnce([definition]);
    mockPending.mockResolvedValue([instance("c1", "Certificate")]);
    render(<WorkflowsPage />);
    expect(await screen.findByText("Cert approval")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /New Workflow/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Disable" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete Cert approval" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /My Approvals \(1\)/ }));
    expect(screen.queryByRole("button", { name: /^Approve$/ })).not.toBeInTheDocument();
  });

  it("nothing is writable before the permissions load", async () => {
    clearPermissions();
    mockPending.mockResolvedValue([]);
    render(<WorkflowsPage />);
    await screen.findByRole("button", { name: /My Approvals/ });
    expect(screen.queryByRole("button", { name: /New Workflow/ })).not.toBeInTheDocument();
  });

  it("the super admin gets them", async () => {
    grantSuperAdmin();
    mockPending.mockResolvedValue([]);
    render(<WorkflowsPage />);
    expect(await screen.findByRole("button", { name: /New Workflow/ })).toBeInTheDocument();
  });
});
