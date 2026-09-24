/** @jest-environment jsdom */
/**
 * A-135 — the retention page against the backend's real contract.
 *
 * The page used to send `audit_log_retention_days`, `notification_retention_days`
 * and `session_retention_days`: keys the backend has never accepted, so every
 * Save answered 400 "Unknown retention policy" and every "current" value read
 * as blank (the GET answers `{ notifications, sessions }`). It also offered an
 * "Audit Logs" retention window, although audit rows are never purged
 * (ADR-051 Q-12).
 *
 * Fixtures mirror the backend exactly (dataRetention.service.js + controller):
 *  - GET  /tenants/:id/policy     → data `{ notifications, sessions }`
 *  - GET  /tenants/:id/legal-hold → data `{ tenantId, onLegalHold }`
 *  - PUT  /tenants/:id/policy     → data `{ policyKey, days }`
 *  - GET  /tenants/all            → rows in `data`, count in top-level `meta`
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

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

const TENANT = "11111111-1111-4111-8111-111111111111";

const mockAuthState = { user: { id: "u-1", tenantId: TENANT } };
jest.mock("@/stores/authStore", () => ({
  useAuthStore: (selector: (s: typeof mockAuthState) => unknown) => selector(mockAuthState),
}));

import { api } from "@/api/client";
import { useToastStore } from "@/stores/toastStore";
import DataRetentionPage from "../page";

const mockedApi = api as jest.Mocked<typeof api>;

const envelope = (data: unknown, extra: Record<string, unknown> = {}) => ({
  success: true,
  status: 200,
  message: "ok",
  data,
  ...extra,
});

const backend = ({ onLegalHold = false } = {}) => {
  mockedApi.get.mockImplementation(async (url: string) => {
    if (url === "/api/v1/tenants/all") {
      return envelope([{ id: TENANT, name: "Hospital A" }], { meta: { total: 1 } });
    }
    if (url === `/api/v1/tenants/${TENANT}/policy`) {
      return envelope({ notifications: 90, sessions: 30 });
    }
    if (url === `/api/v1/tenants/${TENANT}/legal-hold`) {
      return envelope({ tenantId: TENANT, onLegalHold });
    }
    throw new Error(`unexpected GET ${url}`);
  });
  mockedApi.put.mockImplementation(async (_url: string, body: unknown) => {
    const { policyKey, days } = body as { policyKey: string; days: number };
    return envelope({ policyKey, days });
  });
};

const dayInputs = () => screen.getAllByRole("spinbutton") as HTMLInputElement[];

beforeEach(() => {
  jest.clearAllMocks();
  useToastStore.setState({ toasts: [] });
});

describe("DataRetentionPage — the real backend contract (A-135)", () => {
  it("shows the backend's two purgeable entities, prefilled, and no Audit Logs window", async () => {
    backend();
    render(<DataRetentionPage />);

    await waitFor(() => expect(dayInputs().map((i) => i.value)).toEqual(["90", "30"]));
    expect(screen.getByText("Notifications")).toBeInTheDocument();
    expect(screen.getByText("Sessions")).toBeInTheDocument();
    expect(screen.queryByText("Audit Logs")).not.toBeInTheDocument();
    expect(screen.getByText(/Audit logs are never purged/)).toBeInTheDocument();
    expect(screen.getByText("current: 90")).toBeInTheDocument();
  });

  it("saves with the key the backend accepts", async () => {
    backend();
    render(<DataRetentionPage />);
    await waitFor(() => expect(dayInputs()[0].value).toBe("90"));

    fireEvent.change(dayInputs()[0], { target: { value: "60" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Save" })[0]);

    await waitFor(() =>
      expect(mockedApi.put).toHaveBeenCalledWith(`/api/v1/tenants/${TENANT}/policy`, {
        tenantId: TENANT,
        policyKey: "notifications",
        days: 60,
      }),
    );
    await waitFor(() =>
      expect(useToastStore.getState().toasts).toEqual([
        expect.objectContaining({ type: "success", title: "Retention policy updated" }),
      ]),
    );
  });

  it("refuses a period below the backend's floor before sending it, and accepts 0 (keep forever)", async () => {
    backend();
    render(<DataRetentionPage />);
    await waitFor(() => expect(dayInputs()[1].value).toBe("30"));

    fireEvent.change(dayInputs()[1], { target: { value: "7" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Save" })[1]);

    await waitFor(() =>
      expect(useToastStore.getState().toasts).toEqual([
        expect.objectContaining({ type: "error", title: "Enter 0 (keep forever) or at least 30 days" }),
      ]),
    );
    expect(mockedApi.put).not.toHaveBeenCalled();

    fireEvent.change(dayInputs()[1], { target: { value: "0" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Save" })[1]);
    await waitFor(() =>
      expect(mockedApi.put).toHaveBeenCalledWith(`/api/v1/tenants/${TENANT}/policy`, {
        tenantId: TENANT,
        policyKey: "sessions",
        days: 0,
      }),
    );
  });

  it("reads the legal-hold flag from onLegalHold", async () => {
    backend({ onLegalHold: true });
    render(<DataRetentionPage />);

    await waitFor(() => expect(screen.getByText("Active")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Release Hold/ })).toBeInTheDocument();
  });

  it("offers no dataset anonymization — the backend refuses it (A-152)", async () => {
    backend();
    render(<DataRetentionPage />);

    await waitFor(() => expect(dayInputs()[0].value).toBe("90"));
    expect(screen.getByRole("button", { name: /Purge Expired Records/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Anonymize/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/ANONYMIZED/)).not.toBeInTheDocument();
  });
});
