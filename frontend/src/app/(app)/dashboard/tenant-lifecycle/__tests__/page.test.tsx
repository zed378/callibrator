/** @jest-environment jsdom */
/**
 * Tenant lifecycle page against the backend contract
 * (backend/src/routes/api/tenantLifecycle.route.js, mounted /api/v1/tenants;
 * controllers/tenantLifecycle.controller.js; services/tenantLifecycle.service.js):
 *  - GET  /:tenantId/status → { status: active|suspended|deleted,
 *    lifecycleStatus, gracePeriodExpiresAt, gracePeriodExpired, offboardedAt,
 *    offboardRetentionExpiresAt } in `data`. An OFFBOARDED tenant's `status`
 *    is the ENUM's "deleted".
 *  - POST /:tenantId/suspend { reason } · /resume · /grace-period (409 unless
 *    suspended) · /offboard · /offboard/cancel; GET /:tenantId/export.
 *  - the picker reads GET /api/v1/tenants/all (rows in `data`, top-level `meta`).
 * The destructive actions (suspend, offboard) go through a confirmation dialog.
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
import TenantLifecyclePage from "../page";
import { grantPermissions, grantSuperAdmin, clearPermissions } from "@/tests/support/permissions";

const mockedGet = api.get as jest.Mock;
const mockedPost = api.post as jest.Mock;

const ok = (data: unknown, message = "ok", meta?: unknown) => ({
  success: true,
  status: 200,
  message,
  data,
  ...(meta ? { meta } : {}),
});

const TENANT = "11111111-1111-4111-8111-111111111111";

const lifecycle = (status: "active" | "suspended" | "deleted", extra: Record<string, unknown> = {}) => ({
  status,
  lifecycleStatus: { active: "ACTIVE", suspended: "SUSPENDED", deleted: "OFFBOARDED" }[status],
  gracePeriodExpiresAt: null,
  gracePeriodExpired: false,
  offboardedAt: status === "deleted" ? "2026-09-28T10:00:00.000Z" : null,
  offboardRetentionExpiresAt: status === "deleted" ? "2026-10-28T10:00:00.000Z" : null,
  ...extra,
});

let current: ReturnType<typeof lifecycle>;

const backend = () => {
  mockedGet.mockImplementation(async (url: string) => {
    if (url === "/api/v1/tenants/all") {
      return ok(
        [
          { id: TENANT, name: "RS Harapan", status: "active" },
          { id: "22222222-2222-4222-8222-222222222222", name: "RS Sehat", status: "active" },
        ],
        "Fetch tenants successful",
        { total: 2, page: 1, limit: 100, totalPages: 1 },
      );
    }
    if (url === `/api/v1/tenants/${TENANT}/status`) return ok(current, "Fetch lifecycle status successful");
    if (url === `/api/v1/tenants/${TENANT}/export`) {
      return ok({ exportedAt: "2026-09-29T00:00:00.000Z", tenant: { id: TENANT } }, "Tenant data exported");
    }
    throw httpError(404, "Tenant not found");
  });
};

const toasts = () => useToastStore.getState().toasts.map((t) => ({ type: t.type, title: t.title, description: t.description }));

const button = (name: string) => screen.getByRole("button", { name });

const pickTenant = async () => {
  fireEvent.click(await screen.findByRole("button", { name: /^Tenant/ }));
  const option = await screen.findByRole("option", { name: "RS Harapan" });
  // Choosing a tenant starts the status read one microtask later (deferEffect).
  await act(async () => {
    fireEvent.click(option);
  });
};

beforeEach(() => {
  // ADR-102: write controls follow the effective permissions.
  grantSuperAdmin();
  jest.clearAllMocks();
  useToastStore.setState({ toasts: [] });
  current = lifecycle("active");
  backend();
});

describe("tenant lifecycle — reading", () => {
  it("asks for a tenant first and reads nothing else", async () => {
    const { container } = render(<TenantLifecyclePage />);

    expect(await screen.findByText(/Select a tenant to view/)).toBeInTheDocument();
    await waitFor(() =>
      expect(mockedGet).toHaveBeenCalledWith("/api/v1/tenants/all", {
        params: { page: 1, limit: 100, find: undefined },
      }),
    );
    expect(mockedGet).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /Suspend/ })).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("an active tenant can be suspended or offboarded, not resumed or un-offboarded", async () => {
    const { container } = render(<TenantLifecyclePage />);
    await pickTenant();

    expect(await screen.findByText("ACTIVE")).toBeInTheDocument();
    expect(mockedGet).toHaveBeenCalledWith(`/api/v1/tenants/${TENANT}/status`);
    expect(button("Suspend")).toBeEnabled();
    expect(button("Offboard")).toBeEnabled();
    expect(button("Resume")).toBeDisabled();
    expect(button("Cancel Offboarding")).toBeDisabled();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("A-356: shows no suspension reason or date — the status read never answers them", async () => {
    current = lifecycle("suspended");
    render(<TenantLifecyclePage />);
    await pickTenant();

    expect(await screen.findByText("SUSPENDED")).toBeInTheDocument();
    expect(screen.getByText("Grace period expires")).toBeInTheDocument();
    expect(screen.queryByText("Suspension reason")).not.toBeInTheDocument();
    expect(screen.queryByText("Suspended at")).not.toBeInTheDocument();
  });

  it("shows the loading state while the status is read", async () => {
    render(<TenantLifecyclePage />);
    mockedGet.mockImplementation((url: string) =>
      url === "/api/v1/tenants/all"
        ? Promise.resolve(ok([{ id: TENANT, name: "RS Harapan" }]))
        : new Promise(() => undefined),
    );
    await pickTenant();

    expect(await screen.findByText("Loading…")).toBeInTheDocument();
  });

  it("a status the caller may not read (404) is an error, not a status", async () => {
    mockedGet.mockImplementation(async (url: string) => {
      if (url === "/api/v1/tenants/all") return ok([{ id: TENANT, name: "RS Harapan" }]);
      throw httpError(404, "Tenant not found");
    });
    const { container } = render(<TenantLifecyclePage />);
    await pickTenant();

    expect(await screen.findByText("Tenant not found")).toBeInTheDocument();
    expect(screen.getByText("UNKNOWN")).toBeInTheDocument();
    expect(screen.queryByText("ACTIVE")).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("a failed tenant list leaves the picker empty", async () => {
    mockedGet.mockRejectedValue(httpError(403, "Super admin only"));
    render(<TenantLifecyclePage />);

    fireEvent.click(await screen.findByRole("button", { name: /^Tenant/ }));
    expect(await screen.findByText("No options available")).toBeInTheDocument();
  });
});

describe("tenant lifecycle — suspend (destructive, confirmed)", () => {
  it("opens a confirmation first; Cancel sends nothing", async () => {
    render(<TenantLifecyclePage />);
    await pickTenant();
    await screen.findByText("ACTIVE");

    fireEvent.click(button("Suspend"));
    const dialog = screen.getByRole("dialog", { name: "Suspend Tenant" });
    expect(within(dialog).getByText(/blocks all users of this tenant/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it("needs a reason, then POSTs it and shows the suspended state", async () => {
    mockedPost.mockImplementation(async () => {
      current = lifecycle("suspended");
      return ok({ id: TENANT, status: "suspended" }, "Tenant suspended");
    });
    const { container } = render(<TenantLifecyclePage />);
    await pickTenant();
    await screen.findByText("ACTIVE");

    fireEvent.click(button("Suspend"));
    const dialog = screen.getByRole("dialog", { name: "Suspend Tenant" });
    expect(await axeViolations(container)).toEqual([]);

    fireEvent.click(within(dialog).getByRole("button", { name: "Suspend Tenant" }));
    expect(toasts()).toContainEqual({ type: "error", title: "A suspension reason is required", description: undefined });
    expect(mockedPost).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "  Non-payment  " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Suspend Tenant" }));

    expect(await screen.findByText("SUSPENDED")).toBeInTheDocument();
    expect(mockedPost).toHaveBeenCalledWith(`/api/v1/tenants/${TENANT}/suspend`, {
      tenantId: TENANT,
      reason: "Non-payment",
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(button("Suspend")).toBeDisabled();
    expect(button("Resume")).toBeEnabled();
  });

  it("a refused suspension (403) keeps the dialog and the typed reason", async () => {
    mockedPost.mockRejectedValue(httpError(403, "Super admin access required"));
    render(<TenantLifecyclePage />);
    await pickTenant();
    await screen.findByText("ACTIVE");

    fireEvent.click(button("Suspend"));
    const dialog = screen.getByRole("dialog", { name: "Suspend Tenant" });
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "Non-payment" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Suspend Tenant" }));

    await waitFor(() =>
      expect(toasts()).toContainEqual({
        type: "error",
        title: "Action failed",
        description: "Super admin access required",
      }),
    );
    expect(screen.getByRole("dialog", { name: "Suspend Tenant" })).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Reason/)).toHaveValue("Non-payment");
  });
});

describe("tenant lifecycle — resume and grace period", () => {
  it("resumes a suspended tenant", async () => {
    current = lifecycle("suspended");
    mockedPost.mockImplementation(async () => {
      current = lifecycle("active");
      return ok({ id: TENANT, status: "active" }, "Tenant resumed");
    });
    render(<TenantLifecyclePage />);
    await pickTenant();
    await screen.findByText("SUSPENDED");

    fireEvent.click(button("Resume"));

    expect(await screen.findByText("ACTIVE")).toBeInTheDocument();
    expect(mockedPost).toHaveBeenCalledWith(`/api/v1/tenants/${TENANT}/resume`);
    expect(toasts()).toContainEqual({ type: "success", title: "Tenant resumed", description: undefined });
  });

  it("a grace period on a tenant that is not suspended explains the 409", async () => {
    const explanation =
      'This tenant is "active", not suspended: a grace period can only be set on a suspended tenant. Suspend it first.';
    mockedPost.mockRejectedValue(httpError(409, explanation));
    render(<TenantLifecyclePage />);
    await pickTenant();
    await screen.findByText("ACTIVE");

    fireEvent.click(button("Start Grace Period"));

    await waitFor(() =>
      expect(toasts()).toContainEqual({ type: "error", title: "Action failed", description: explanation }),
    );
    expect(mockedPost).toHaveBeenCalledWith(`/api/v1/tenants/${TENANT}/grace-period`);
  });

  it("shows the grace deadline once one is set", async () => {
    current = lifecycle("suspended", { gracePeriodExpiresAt: "2026-10-13T10:00:00.000Z" });
    render(<TenantLifecyclePage />);
    await pickTenant();
    await screen.findByText("SUSPENDED");

    const deadline = new Date("2026-10-13T10:00:00.000Z").toLocaleString();
    expect(screen.getByText(deadline)).toBeInTheDocument();
  });
});

describe("tenant lifecycle — offboard (destructive, confirmed)", () => {
  it("confirms, POSTs /offboard, and the offboarded (\"deleted\") tenant can then be un-offboarded", async () => {
    mockedPost.mockImplementation(async (url: string) => {
      if (url.endsWith("/offboard")) {
        current = lifecycle("deleted");
        return ok({ tenant: { id: TENANT, status: "deleted" } }, "Tenant offboarded");
      }
      current = lifecycle("active");
      return ok({ id: TENANT, status: "active" }, "Offboarding cancelled");
    });
    const { container } = render(<TenantLifecyclePage />);
    await pickTenant();
    await screen.findByText("ACTIVE");

    fireEvent.click(button("Offboard"));
    expect(mockedPost).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: "Offboard Tenant" });
    expect(within(dialog).getByText(/schedules the tenant for deletion/)).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);

    fireEvent.click(within(dialog).getByRole("button", { name: "Offboard Tenant" }));

    expect(await screen.findByText("OFFBOARDED")).toBeInTheDocument();
    expect(mockedPost).toHaveBeenCalledWith(`/api/v1/tenants/${TENANT}/offboard`, { force: undefined });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(button("Offboard")).toBeDisabled();
    expect(button("Suspend")).toBeDisabled();
    expect(button("Start Grace Period")).toBeDisabled();
    expect(screen.getByText(new Date("2026-10-28T10:00:00.000Z").toLocaleString())).toBeInTheDocument();

    const cancel = button("Cancel Offboarding");
    expect(cancel).toBeEnabled();
    fireEvent.click(cancel);

    expect(await screen.findByText("ACTIVE")).toBeInTheDocument();
    expect(mockedPost).toHaveBeenLastCalledWith(`/api/v1/tenants/${TENANT}/offboard/cancel`);
  });

  it("Cancel on the offboard confirmation sends nothing", async () => {
    render(<TenantLifecyclePage />);
    await pickTenant();
    await screen.findByText("ACTIVE");

    fireEvent.click(button("Offboard"));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Offboard Tenant" })).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockedPost).not.toHaveBeenCalled();
  });
});

describe("tenant lifecycle — export", () => {
  const createObjectURL = jest.fn(() => "blob:tenant");
  const revokeObjectURL = jest.fn();
  let click: jest.SpyInstance;

  beforeEach(() => {
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    click = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  });
  afterEach(() => click.mockRestore());

  it("downloads the tenant's export named after it", async () => {
    render(<TenantLifecyclePage />);
    await pickTenant();
    await screen.findByText("ACTIVE");

    await act(async () => {
      fireEvent.click(button("Export Data"));
    });

    expect(mockedGet).toHaveBeenCalledWith(`/api/v1/tenants/${TENANT}/export`);
    expect((click.mock.instances[0] as unknown as HTMLAnchorElement).download).toBe(`tenant-${TENANT}-export.json`);
    expect(toasts()).toContainEqual({ type: "success", title: "Export downloaded", description: undefined });
  });

  it("a failed export says so", async () => {
    render(<TenantLifecyclePage />);
    await pickTenant();
    await screen.findByText("ACTIVE");
    mockedGet.mockRejectedValueOnce(httpError(500, "Export failed on the server"));

    await act(async () => {
      fireEvent.click(button("Export Data"));
    });

    expect(click).not.toHaveBeenCalled();
    expect(toasts()).toContainEqual({ type: "error", title: "Export failed", description: "Export failed on the server" });
  });
});

/**
 * ADR-102 — suspend, resume, grace, offboard, cancel and export are
 * superAdminOnly (tenantLifecycle.route.js). A tenant role holding
 * `tenant-lifecycle` read sees the state without them.
 * Fail-before: every action rendered for HEALTHCARE / CALIBRATOR ADMIN.
 */
describe("ADR-102 — lifecycle actions are the super admin's", () => {
  const actions = [/^Suspend$/, /^Resume$/, /^Start Grace Period$/, /^Offboard$/, /^Cancel Offboarding$/, /Export Data/];

  it("a tenant reader sees the state and no action", async () => {
    grantPermissions({ "tenant-lifecycle": "read" });
    render(<TenantLifecyclePage />);
    await pickTenant();
    expect(await screen.findByText("Grace period expires")).toBeInTheDocument();
    for (const name of actions) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });

  it("nothing is writable before the permissions load", async () => {
    clearPermissions();
    render(<TenantLifecyclePage />);
    await pickTenant();
    expect(await screen.findByText("Grace period expires")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Suspend$/ })).not.toBeInTheDocument();
  });
});
