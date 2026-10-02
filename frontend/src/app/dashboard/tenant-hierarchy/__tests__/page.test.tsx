/** @jest-environment jsdom */
/**
 * Tenant hierarchy page against the backend contract
 * (backend/src/routes/api/tenantHierarchy.route.js, mounted
 * /api/v1/tenant-hierarchy; controllers/tenantHierarchy.controller.js;
 * services/tenantHierarchy.service.js):
 *  - GET  /tree → data { isRoot, depth, path, tenant, children: [{ tenantId,
 *    code, name, status, depth }] };
 *  - GET  /cross-tenant-roles?userId → data { assignments: [{ tenantId,
 *    tenantName, tenantCode, role: { id, name, level } }] } (super admin);
 *  - POST /:tenantId/children (the parent) { name, code?, plan } → 201; 409 on a state conflict;
 *  - PUT  /:tenantId/parent { newParentId } · DELETE /:tenantId/parent (409 when
 *    already a root).
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

const mockAuthState: { user: { id: string; tenantId: string; role?: { name: string } } | null } = { user: null };
jest.mock("@/stores/authStore", () => ({
  useAuthStore: (selector: (s: typeof mockAuthState) => unknown) => selector(mockAuthState),
}));

import { api } from "@/api/client";
import { useToastStore } from "@/stores/toastStore";
import TenantHierarchyPage from "../page";
import { grantPermissions, grantSuperAdmin, clearPermissions } from "@/tests/support/permissions";

const mockedGet = api.get as jest.Mock;
const mockedPost = api.post as jest.Mock;
const mockedPut = api.put as jest.Mock;
const mockedDelete = api.delete as jest.Mock;

const ok = (data: unknown, message = "ok", meta?: unknown) => ({
  success: true,
  status: 200,
  message,
  data,
  ...(meta ? { meta } : {}),
});

const OWN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

let tree: Record<string, unknown>;

const backend = () => {
  mockedGet.mockImplementation(async (url: string, config?: { params?: Record<string, unknown> }) => {
    if (url === "/api/v1/tenants/all") {
      return ok(
        [
          { id: OWN, name: "RS Harapan" },
          { id: OTHER, name: "Grup Sehat" },
        ],
        "ok",
        { total: 2, page: 1, limit: 100, totalPages: 1 },
      );
    }
    if (url === "/api/v1/tenant-hierarchy/tree") return ok(tree, "Tenant tree retrieved");
    if (url === "/api/v1/tenant-hierarchy/cross-tenant-roles") {
      // platformOnly (tenantHierarchy.route.js): everyone else gets a 403.
      if (mockAuthState.user?.role?.name !== "SUPERADMIN") throw httpError(403, "Super admin access required");
      expect(config?.params).toEqual({ userId: "u-1" });
      return ok(
        {
          assignments: [
            {
              tenantId: OTHER,
              tenantName: "Grup Sehat",
              tenantCode: "SEHAT",
              role: { id: "r-1", name: "TENANT_ADMIN", level: 80 },
            },
          ],
        },
        "Cross-tenant roles retrieved",
      );
    }
    throw httpError(404, "Not found");
  });
};

const toasts = () => useToastStore.getState().toasts.map((t) => ({ type: t.type, title: t.title, description: t.description }));

beforeEach(() => {
  jest.clearAllMocks();
  useToastStore.setState({ toasts: [] });
  mockAuthState.user = { id: "u-1", tenantId: OWN, role: { name: "SUPERADMIN" } };
  grantSuperAdmin(); // ADR-102
  tree = {
    isRoot: false,
    depth: 1,
    path: "/SEHAT/HARAPAN",
    tenant: { id: OWN, name: "RS Harapan", code: "HARAPAN", status: "active", plan: "business" },
    children: [
      { tenantId: "c-1", code: "HARAPAN-NORTH", name: "North Wing", status: "active", depth: 2 },
      { tenantId: "c-2", code: "HARAPAN-LAB", name: "Lab", status: "suspended", depth: 2 },
    ],
  };
  backend();
});

const renderLoaded = async () => {
  const view = render(<TenantHierarchyPage />);
  await screen.findByText("North Wing");
  return view;
};

describe("tenant hierarchy — reading", () => {
  it("shows this tenant's place in the tree and its business units", async () => {
    const { container } = await renderLoaded();

    expect(screen.getByRole("heading", { name: "RS Harapan" })).toBeInTheDocument();
    expect(screen.getByText("depth 1")).toBeInTheDocument();
    expect(screen.getByText("/SEHAT/HARAPAN")).toBeInTheDocument();
    expect(screen.getByText("Business units (2)")).toBeInTheDocument();
    const lab = screen.getByText("Lab").closest("tr") as HTMLElement;
    expect(within(lab).getByText("suspended")).toBeInTheDocument();
    expect(within(lab).getByText("level 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Detach" })).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("shows each cross-tenant role by the role and tenant names the backend sends", async () => {
    await renderLoaded();

    const tables = screen.getAllByRole("table");
    const roleRow = within(tables[1]).getAllByRole("row")[1];
    expect(within(roleRow).getByText("TENANT_ADMIN")).toBeInTheDocument();
    expect(within(roleRow).getByText("Grup Sehat")).toBeInTheDocument();
  });

  it("a root tenant with no units has no Detach and shows the empty states", async () => {
    tree = { isRoot: true, children: [] };
    mockAuthState.user = { id: "", tenantId: OWN, role: { name: "SUPERADMIN" } };
    grantSuperAdmin(); // ADR-102
    render(<TenantHierarchyPage />);

    expect(await screen.findByText("No business units under this tenant.")).toBeInTheDocument();
    expect(screen.getByText("You hold no roles in other tenants.")).toBeInTheDocument();
    expect(screen.getByText("root")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Detach" })).not.toBeInTheDocument();
    // No user id: the roles read is not made (the backend answers [] without one).
    expect(mockedGet).not.toHaveBeenCalledWith("/api/v1/tenant-hierarchy/cross-tenant-roles", expect.anything());
  });

  it("a failed read shows the error, never the empty states", async () => {
    mockedGet.mockImplementation(async (url: string) => {
      if (url === "/api/v1/tenant-hierarchy/tree") throw httpError(500, "Failed to read the tree");
      return ok([]);
    });
    const { container } = render(<TenantHierarchyPage />);

    expect(await screen.findByText("Failed to read the tree")).toBeInTheDocument();
    expect(screen.getByText("Business units could not be loaded.")).toBeInTheDocument();
    expect(screen.getByText("Cross-tenant roles could not be loaded.")).toBeInTheDocument();
    expect(screen.queryByText("No business units under this tenant.")).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe("tenant hierarchy — adding a business unit", () => {
  const openAdd = () => {
    fireEvent.click(screen.getByRole("button", { name: "Add Business Unit" }));
    return screen.getByRole("dialog", { name: "Add Business Unit" });
  };

  it("needs a name of at least 2 characters", async () => {
    await renderLoaded();
    const dialog = openAdd();

    fireEvent.change(within(dialog).getByLabelText(/Name/), { target: { value: " N " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));

    expect(toasts()).toContainEqual({ type: "error", title: "Name must be at least 2 characters", description: undefined });
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it("POSTs the unit under this tenant, omitting a blank code", async () => {
    mockedPost.mockResolvedValue(ok({ tenantId: "c-3", code: "HARAPAN-ICU", path: "/SEHAT/HARAPAN/ICU", depth: 2 }, "Child tenant created"));
    const { container } = await renderLoaded();
    const dialog = openAdd();
    expect(await axeViolations(container)).toEqual([]);

    fireEvent.change(within(dialog).getByLabelText(/Name/), { target: { value: "  ICU  " } });
    fireEvent.change(within(dialog).getByLabelText(/Code/), { target: { value: "   " } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^Plan/ }));
    fireEvent.click(within(dialog).getByRole("option", { name: "enterprise" }));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));
    });

    expect(mockedPost).toHaveBeenCalledWith(`/api/v1/tenant-hierarchy/${OWN}/children`, {
      name: "ICU",
      code: undefined,
      plan: "enterprise",
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(toasts()).toContainEqual({ type: "success", title: "Child tenant created", description: undefined });
  });

  it("a depth-limit 409 is explained and the dialog stays open", async () => {
    const depth = 'Maximum hierarchy depth (5) reached: "RS Harapan" cannot have sub-organizations';
    mockedPost.mockRejectedValue(httpError(409, depth));
    await renderLoaded();
    const dialog = openAdd();

    fireEvent.change(within(dialog).getByLabelText(/Name/), { target: { value: "ICU" } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));
    });

    expect(toasts()).toContainEqual({ type: "error", title: "Action failed", description: depth });
    expect(screen.getByRole("dialog", { name: "Add Business Unit" })).toBeInTheDocument();
  });

  it("with no tenant in the session nothing is sent", async () => {
    mockAuthState.user = { id: "u-1", tenantId: "", role: { name: "SUPERADMIN" } };
    grantSuperAdmin(); // ADR-102
    await renderLoaded();
    const dialog = openAdd();

    fireEvent.change(within(dialog).getByLabelText(/Name/), { target: { value: "ICU" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));

    expect(toasts()).toContainEqual({ type: "error", title: "No tenant context", description: undefined });
    expect(mockedPost).not.toHaveBeenCalled();
  });
});

describe("tenant hierarchy — moving and detaching", () => {
  const openMove = () => {
    fireEvent.click(screen.getByRole("button", { name: "Move under…" }));
    return screen.getByRole("dialog", { name: "Move Tenant" });
  };

  it("offers every tenant but this one, needs a choice, then PUTs the new parent", async () => {
    mockedPut.mockResolvedValue(ok({ tenantId: OWN, newParentId: OTHER }, "Parent tenant updated successfully"));
    await renderLoaded();
    const dialog = openMove();
    expect(within(dialog).getByText(/can change who can see its data/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Move" }));
    expect(toasts()).toContainEqual({ type: "error", title: "Pick a new parent", description: undefined });

    fireEvent.click(within(dialog).getByRole("button", { name: /^New parent/ }));
    expect(within(dialog).queryByRole("option", { name: "RS Harapan" })).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("option", { name: "Grup Sehat" }));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Move" }));
    });

    expect(mockedPut).toHaveBeenCalledWith(`/api/v1/tenant-hierarchy/${OWN}/parent`, { newParentId: OTHER });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("a cycle or no-op move (409) is explained", async () => {
    mockedPut.mockRejectedValue(httpError(409, "This tenant is already under that parent"));
    await renderLoaded();
    const dialog = openMove();

    fireEvent.click(within(dialog).getByRole("button", { name: /^New parent/ }));
    fireEvent.click(within(dialog).getByRole("option", { name: "Grup Sehat" }));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Move" }));
    });

    expect(toasts()).toContainEqual({
      type: "error",
      title: "Action failed",
      description: "This tenant is already under that parent",
    });
    expect(screen.getByRole("dialog", { name: "Move Tenant" })).toBeInTheDocument();
  });

  it("Detach DELETEs the parent link and reloads as a root", async () => {
    mockedDelete.mockImplementation(async () => {
      tree = { ...tree, isRoot: true, depth: 0, path: "/HARAPAN" };
      return ok({ tenantId: OWN, status: "root" }, "Parent relationship removed successfully");
    });
    await renderLoaded();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Detach" }));
    });
    await act(async () => {
      fireEvent.click(within(screen.getByRole("dialog", { name: "Detach this tenant?" })).getByRole("button", { name: "Detach" }));
    });

    expect(mockedDelete).toHaveBeenCalledWith(`/api/v1/tenant-hierarchy/${OWN}/parent`);
    expect(await screen.findByText("root")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Detach" })).not.toBeInTheDocument();
    expect(toasts()).toContainEqual({ type: "success", title: "Detached — this tenant is now a root", description: undefined });
  });

  it("detaching a tenant that is already a root (409) is explained", async () => {
    mockedDelete.mockRejectedValue(httpError(409, "This tenant is already a root tenant: it has no parent to remove"));
    await renderLoaded();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Detach" }));
    });
    await act(async () => {
      fireEvent.click(within(screen.getByRole("dialog", { name: "Detach this tenant?" })).getByRole("button", { name: "Detach" }));
    });

    await waitFor(() =>
      expect(toasts()).toContainEqual({
        type: "error",
        title: "Action failed",
        description: "This tenant is already a root tenant: it has no parent to remove",
      }),
    );
  });
});

describe("tenant hierarchy — who may do what (F-19)", () => {
  it("F-19: for a tenant role the page loads the tree and never asks for the super-admin-only roles", async () => {
    mockAuthState.user = { id: "u-1", tenantId: OWN, role: { name: "HEALTHCARE ADMIN" } };
    grantPermissions({ "tenant-hierarchy": "read" }); // ADR-102
    const { container } = await renderLoaded();

    expect(screen.queryByText("Super admin access required")).not.toBeInTheDocument();
    expect(mockedGet).not.toHaveBeenCalledWith("/api/v1/tenant-hierarchy/cross-tenant-roles", expect.anything());
    expect(mockedGet).not.toHaveBeenCalledWith("/api/v1/tenants/all", expect.anything());
    expect(screen.queryByRole("heading", { name: "Your cross-tenant roles" })).not.toBeInTheDocument();
    for (const name of [/Add Business Unit/, /Move under/, "Detach"]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
    expect(screen.getByText(/Only the platform administrator can add business units/)).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("F-19: Detach asks first, says what the parent loses, and Cancel sends nothing", async () => {
    await renderLoaded();

    fireEvent.click(screen.getByRole("button", { name: "Detach" }));
    const dialog = screen.getByRole("dialog", { name: "Detach this tenant?" });
    expect(dialog).toHaveTextContent(/RS Harapan.*becomes a root/);
    expect(await axeViolations(dialog)).toEqual([]);

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockedDelete).not.toHaveBeenCalled();
  });
});

/**
 * ADR-102 — the platform actions are the super admin's (tenantHierarchy.route.js
 * platformOnly); the page reads that from the effective permissions. A tenant
 * role holding `tenant-hierarchy` read sees its tree only; before the
 * permissions load no platform control shows.
 */
describe("ADR-102 — tenant hierarchy platform actions follow the effective permission", () => {
  it("nothing is writable before the permissions load", async () => {
    clearPermissions();
    render(<TenantHierarchyPage />);
    await waitFor(() => expect(screen.queryByText(/loading/i)).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Add/ })).not.toBeInTheDocument();
  });
});
