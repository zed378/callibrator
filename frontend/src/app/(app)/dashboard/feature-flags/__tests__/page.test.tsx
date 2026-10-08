/** @jest-environment jsdom */
/**
 * Feature flags page against the backend contract
 * (backend/src/routes/api/featureFlag.route.js, mounted /api/v1/feature-flags;
 * controllers/featureFlag.controller.js; services/featureFlag.service.ts):
 *  - GET /definitions → data: the DEFAULT_FLAGS object keyed by flag key
 *    ({ [key]: { category, defaultValue, description } }) — not a list;
 *  - GET /?tenantId → data: { [key]: { enabled, category, description,
 *    defaultValue, tenantOverride } } — a state object per flag;
 *  - POST /:tenantId/:flagKey { tenantId, flagKey, enabled } (super admin);
 *  - DELETE /:tenantId/:flagKey · POST /:tenantId/initialize.
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

const mockAuthState: { user: { id: string; tenantId: string } | null } = { user: null };
jest.mock("@/stores/authStore", () => ({
  useAuthStore: (selector: (s: typeof mockAuthState) => unknown) => selector(mockAuthState),
}));

import { api } from "@/api/client";
import { useToastStore } from "@/stores/toastStore";
import FeatureFlagsPage from "../page";
import { grantPermissions, grantSuperAdmin, clearPermissions } from "@/tests/support/permissions";

const mockedGet = api.get as jest.Mock;
const mockedPost = api.post as jest.Mock;
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

/** featureFlag.service.ts DEFAULT_FLAGS (two of them). */
const DEFAULT_FLAGS = {
  enable_mfa: { category: "platform", defaultValue: false, description: "Require MFA for all users" },
  enable_iot: { category: "calibration", defaultValue: true, description: "Enable IoT sensor ingestion" },
};

/** Overrides per tenant: flag key → stored value. */
let overrides: Record<string, Record<string, boolean>>;

const tenantState = (tenantId: string) =>
  Object.fromEntries(
    Object.entries(DEFAULT_FLAGS).map(([key, def]) => {
      const override = overrides[tenantId]?.[key];
      return [key, { enabled: override ?? def.defaultValue, ...def, tenantOverride: override !== undefined }];
    }),
  );

const backend = () => {
  mockedGet.mockImplementation(async (url: string, config?: { params?: { tenantId?: string } }) => {
    if (url === "/api/v1/tenants/all") {
      return ok(
        [
          { id: OWN, name: "RS Harapan" },
          { id: OTHER, name: "RS Sehat" },
        ],
        "ok",
        { total: 2, page: 1, limit: 100, totalPages: 1 },
      );
    }
    if (url === "/api/v1/feature-flags/definitions") return ok(DEFAULT_FLAGS, "Fetch flag definitions successful");
    if (url === "/api/v1/feature-flags") {
      // tenantFlagQuerySchema requires tenantId: without it the backend answers 400 (A-353).
      if (!config?.params?.tenantId) throw httpError(400, "tenantId is required");
      return ok(tenantState(config.params.tenantId), "Fetch feature flags successful");
    }
    throw httpError(404, "Not found");
  });
};

const toasts = () => useToastStore.getState().toasts.map((t) => ({ type: t.type, title: t.title, description: t.description }));
const rowOf = (key: string) => screen.getByText(key).closest("tr") as HTMLElement;

beforeEach(() => {
  // ADR-102: write controls follow the effective permissions.
  grantSuperAdmin();
  jest.clearAllMocks();
  useToastStore.setState({ toasts: [] });
  mockAuthState.user = { id: "u-1", tenantId: OWN };
  overrides = { [OWN]: { enable_iot: false } };
  backend();
});

const renderLoaded = async () => {
  const view = render(<FeatureFlagsPage />);
  await screen.findByText("enable_mfa");
  return view;
};

describe("feature flags — reading", () => {
  it("lists every defined flag with its default and the tenant's effective value", async () => {
    const { container } = await renderLoaded();

    expect(mockedGet).toHaveBeenCalledWith("/api/v1/feature-flags", { params: { tenantId: OWN } });

    const mfa = rowOf("enable_mfa");
    expect(within(mfa).getByText("Require MFA for all users")).toBeInTheDocument();
    expect(within(mfa).getByText("off")).toBeInTheDocument();
    expect(within(mfa).getByText("Disabled")).toBeInTheDocument();
    expect(within(mfa).queryByText("override")).not.toBeInTheDocument();
    expect(within(mfa).getByRole("button", { name: "Enable" })).toBeInTheDocument();

    const iot = rowOf("enable_iot");
    expect(within(iot).getByText("on")).toBeInTheDocument();
    expect(within(iot).getByText("Disabled")).toBeInTheDocument();
    expect(within(iot).getByText("override")).toBeInTheDocument();
    expect(within(iot).getByRole("button", { name: "Reset to default" })).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("a failed read shows the error, not the empty state", async () => {
    mockedGet.mockImplementation(async (url: string) => {
      if (url === "/api/v1/feature-flags") throw httpError(403, "You do not have permission to read feature flags");
      return ok({});
    });
    const { container } = render(<FeatureFlagsPage />);

    expect(await screen.findByText("You do not have permission to read feature flags")).toBeInTheDocument();
    expect(screen.getByText("Feature flags could not be loaded.")).toBeInTheDocument();
    expect(screen.queryByText("No feature flags defined.")).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("with no tenant in the session it asks for one and shows the defaults, never asking without a tenant (A-353)", async () => {
    mockAuthState.user = null;
    render(<FeatureFlagsPage />);

    expect(await screen.findByText(/Select a tenant to view and override/)).toBeInTheDocument();
    // The definitions still list, each at its default — no 400 from a tenant-less read.
    expect(await screen.findByText("enable_mfa")).toBeInTheDocument();
    expect(within(rowOf("enable_iot")).getByText("Enabled")).toBeInTheDocument();
    expect(within(rowOf("enable_mfa")).getByText("Disabled")).toBeInTheDocument();
    expect(screen.queryByText("tenantId is required")).not.toBeInTheDocument();
    expect(mockedGet).not.toHaveBeenCalledWith("/api/v1/feature-flags", expect.anything());
  });

  it("choosing another tenant reads that tenant's flags", async () => {
    await renderLoaded();

    fireEvent.click(screen.getByRole("button", { name: /^Tenant/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole("option", { name: "RS Sehat" }));
    });

    await waitFor(() => expect(mockedGet).toHaveBeenCalledWith("/api/v1/feature-flags", { params: { tenantId: OTHER } }));
    await waitFor(() => expect(within(rowOf("enable_iot")).getByText("Enabled")).toBeInTheDocument());
    expect(within(rowOf("enable_iot")).queryByText("override")).not.toBeInTheDocument();
  });
});

describe("feature flags — changing", () => {
  it("Enable POSTs enabled: true for this tenant and shows it enabled", async () => {
    mockedPost.mockImplementation(async () => {
      overrides[OWN] = { ...overrides[OWN], enable_mfa: true };
      return ok({ flagKey: "enable_mfa", enabled: true }, "Feature flag updated");
    });
    await renderLoaded();

    await act(async () => {
      fireEvent.click(within(rowOf("enable_mfa")).getByRole("button", { name: "Enable" }));
    });

    expect(mockedPost).toHaveBeenCalledWith(`/api/v1/feature-flags/${OWN}/enable_mfa`, {
      tenantId: OWN,
      flagKey: "enable_mfa",
      enabled: true,
    });
    await waitFor(() => expect(within(rowOf("enable_mfa")).getByText("Enabled")).toBeInTheDocument());
    expect(toasts()).toContainEqual({ type: "success", title: "enable_mfa enabled", description: undefined });
  });

  it("a refused change (403, not a super admin) says why", async () => {
    mockedPost.mockRejectedValue(httpError(403, "Super admin access required"));
    await renderLoaded();

    await act(async () => {
      fireEvent.click(within(rowOf("enable_mfa")).getByRole("button", { name: "Enable" }));
    });

    expect(toasts()).toContainEqual({ type: "error", title: "Update failed", description: "Super admin access required" });
    expect(within(rowOf("enable_mfa")).getByText("Disabled")).toBeInTheDocument();
  });

  it("reset DELETEs the override and the flag returns to its default", async () => {
    mockedDelete.mockImplementation(async () => {
      overrides[OWN] = {};
      return ok({ flagKey: "enable_iot", reset: true }, "Feature flag reset to default");
    });
    await renderLoaded();

    await act(async () => {
      fireEvent.click(within(rowOf("enable_iot")).getByRole("button", { name: "Reset to default" }));
    });

    expect(mockedDelete).toHaveBeenCalledWith(`/api/v1/feature-flags/${OWN}/enable_iot`);
    await waitFor(() => expect(within(rowOf("enable_iot")).getByText("Enabled")).toBeInTheDocument());
    expect(toasts()).toContainEqual({ type: "success", title: "enable_iot reset to default", description: undefined });
  });

  it("a failed reset says so", async () => {
    mockedDelete.mockRejectedValue(httpError(400, "Unknown feature flag: enable_iot"));
    await renderLoaded();

    await act(async () => {
      fireEvent.click(within(rowOf("enable_iot")).getByRole("button", { name: "Reset to default" }));
    });

    expect(toasts()).toContainEqual({ type: "error", title: "Reset failed", description: "Unknown feature flag: enable_iot" });
  });

  it("Initialize Defaults POSTs /initialize for the tenant; failures and a missing tenant are reported", async () => {
    mockedPost.mockResolvedValueOnce(ok({}, "Feature flags initialized")).mockRejectedValueOnce(httpError(500, "boom"));
    await renderLoaded();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Initialize Defaults" }));
    });
    expect(mockedPost).toHaveBeenCalledWith(`/api/v1/feature-flags/${OWN}/initialize`);
    expect(toasts()).toContainEqual({ type: "success", title: "Tenant flags initialized", description: undefined });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Initialize Defaults" }));
    });
    expect(toasts()).toContainEqual({ type: "error", title: "Initialize failed", description: "boom" });
  });

  it("with no tenant, changes are refused before any request", async () => {
    mockAuthState.user = null;
    render(<FeatureFlagsPage />);
    await screen.findByText("enable_mfa");

    fireEvent.click(screen.getByRole("button", { name: "Initialize Defaults" }));
    fireEvent.click(within(rowOf("enable_mfa")).getByRole("button", { name: "Enable" }));

    expect(toasts().filter((t) => t.title === "Select a tenant first")).toHaveLength(2);
    expect(mockedPost).not.toHaveBeenCalled();
  });
});

/**
 * ADR-102 — flag writes are superAdminOnly (featureFlags.route.js). A tenant
 * role holding `feature-flags` read (HEALTHCARE / CALIBRATOR ADMIN) sees the
 * flags without Enable/Disable, Reset or Initialize Defaults.
 * Fail-before: the toggles rendered for every role (audit 01 §4.7).
 */
describe("ADR-102 — feature flag controls are the super admin's", () => {
  it("a tenant reader sees the flags without any control", async () => {
    grantPermissions({ "feature-flags": "read" });
    await renderLoaded();
    expect(screen.queryByRole("button", { name: /Initialize Defaults/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^(Enable|Disable)$/ })).not.toBeInTheDocument();
  });

  it("nothing is writable before the permissions load", async () => {
    clearPermissions();
    await renderLoaded();
    expect(screen.queryByRole("button", { name: /^(Enable|Disable)$/ })).not.toBeInTheDocument();
  });
});
