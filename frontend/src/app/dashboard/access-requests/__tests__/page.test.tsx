/** @jest-environment jsdom */
/**
 * P10-07 — the access-request queue page against the backend contract
 * (backend/src/routes/api/admin.route.js, /api/v1/admin/access-requests;
 * backend/src/services/accessRequest.service.ts):
 *  - GET  ?status&page&limit → rows in `data`, `{ total, page, limit, counts }`
 *    in a TOP-LEVEL `meta` (never data.rows / data.meta);
 *  - GET  /:id → the request, its decider, tenant, invitation and duplicates;
 *  - POST /:id/approve { tenantCode, tenantName?, adminFirstName?, adminLastName? }
 *    (the invited address is never sent — the backend uses the request's own);
 *  - POST /:id/reject { reason, spam }; POST /:id/resend-invitation;
 *  - a 409 carries the state explanation, shown inline.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
import { suggestTenantCode } from "@/api/services/accessRequest.service";
import AccessRequestsPage from "../page";

const mockedGet = api.get as jest.Mock;
const mockedPost = api.post as jest.Mock;

const ID = "11111111-1111-4111-8111-111111111111";
const row = {
  id: ID,
  organisationName: "RSUD Contoh Sejahtera",
  facilityType: "hospital",
  city: "Bandung",
  deviceCountBand: "500_1999",
  contactName: "Siti Rahma Wulandari",
  contactRole: "Kepala IPSRS",
  workEmail: "siti@rsud-contoh.go.id",
  whatsapp: "+6281234567890",
  needs: "Jadwal kalibrasi",
  locale: "id",
  status: "pending",
  createdAt: "2026-09-29T10:00:00.000Z",
  decidedAt: null,
  provisionedTenantId: null,
  duplicateCount: 1,
};
const counts = { pending: 1, approved: 0, rejected: 0, spam: 0, expired: 0 };
const detail = {
  ...row,
  decisionNote: null,
  decidedBy: null,
  provisionedTenant: null,
  adminUserId: null,
  invitation: { sentAt: null, expiresAt: null, acceptedAt: null, resendable: false },
  duplicates: [{ id: "x", organisationName: "RSUD older", status: "rejected", createdAt: "2026-09-01T00:00:00.000Z" }],
};

const asRole = (name: string) =>
  act(() => {
    useAuthStore.setState({ user: { id: "u", role: { id: "r", name } } } as never);
  });

beforeEach(() => {
  jest.clearAllMocks();
  mockedGet.mockImplementation(async (url: string) => {
    if (url === "/api/v1/admin/access-requests") {
      return { success: true, status: 200, message: "ok", data: [row], meta: { total: 1, page: 1, limit: 20, counts } };
    }
    if (url === `/api/v1/admin/access-requests/${ID}`) {
      return { success: true, status: 200, message: "ok", data: detail };
    }
    throw new Error(`unexpected GET ${url}`);
  });
});

describe("P10-07 — the access-request queue", () => {
  it("a non-super-admin sees the restriction and nothing is requested", async () => {
    await asRole("HEALTHCARE ADMIN");
    render(<AccessRequestsPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Access Requests" })).toBeInTheDocument();
    expect(screen.getByText(/Only a platform super admin/)).toBeInTheDocument();
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it("lists pending requests from `data` with counts from the top-level `meta`", async () => {
    await asRole("SUPERADMIN");
    render(<AccessRequestsPage />);
    expect(await screen.findByRole("button", { name: "RSUD Contoh Sejahtera" })).toBeInTheDocument();
    expect(mockedGet).toHaveBeenCalledWith("/api/v1/admin/access-requests", {
      params: { status: "pending", page: 1, limit: 20 },
    });
    expect(screen.getByRole("tab", { name: /Pending \(1\)/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("siti@rsud-contoh.go.id")).toBeInTheDocument();
  });

  it("shows the empty state and the failed state (with retry) distinctly", async () => {
    await asRole("SUPERADMIN");
    mockedGet.mockResolvedValueOnce({ success: true, status: 200, message: "ok", data: [], meta: { total: 0, page: 1, limit: 20, counts } });
    const { unmount } = render(<AccessRequestsPage />);
    expect(await screen.findByText("No new requests")).toBeInTheDocument();
    unmount();
    mockedGet.mockRejectedValueOnce(httpError(500, "boom"));
    render(<AccessRequestsPage />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("No new requests")).not.toBeInTheDocument();
  });

  it("opens a request, prefills the approval from it, and approves without sending an address", async () => {
    await asRole("SUPERADMIN");
    mockedPost.mockResolvedValue({ success: true, status: 200, message: "ok", data: { invitationSent: true } });
    render(<AccessRequestsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "RSUD Contoh Sejahtera" }));
    expect(await screen.findByText(/1 other request\(s\) from this address/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(screen.getByLabelText("Tenant code")).toHaveValue("RCS");
    expect(screen.getByLabelText("Administrator first name")).toHaveValue("Siti");
    expect(screen.getByLabelText("Administrator last name")).toHaveValue("Rahma Wulandari");
    fireEvent.click(screen.getByRole("button", { name: "Approve and invite" }));
    await waitFor(() =>
      expect(mockedPost).toHaveBeenCalledWith(`/api/v1/admin/access-requests/${ID}/approve`, {
        tenantCode: "RCS",
        tenantName: "RSUD Contoh Sejahtera",
        adminFirstName: "Siti",
        adminLastName: "Rahma Wulandari",
      }),
    );
  });

  it("shows a 409's state explanation inline and keeps the form", async () => {
    await asRole("SUPERADMIN");
    mockedPost.mockRejectedValue(
      httpError(409, "This request was already approved on 2026-09-29 by Andi Operator; only a pending request can be decided."),
    );
    render(<AccessRequestsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "RSUD Contoh Sejahtera" }));
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    fireEvent.click(screen.getByRole("button", { name: "Approve and invite" }));
    expect(await screen.findByText(/already approved on 2026-09-29 by Andi Operator/)).toBeInTheDocument();
    expect(screen.getByLabelText("Tenant code")).toBeInTheDocument();
  });

  it("rejects with a required reason, optionally as spam", async () => {
    await asRole("SUPERADMIN");
    mockedPost.mockResolvedValue({ success: true, status: 200, message: "ok", data: {} });
    render(<AccessRequestsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "RSUD Contoh Sejahtera" }));
    fireEvent.click(await screen.findByRole("button", { name: "Reject" }));
    fireEvent.submit(screen.getByLabelText("Reason").closest("form") as HTMLFormElement);
    expect(await screen.findByText("A reason is required")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Bot submission" } });
    fireEvent.click(screen.getByLabelText("Mark as spam"));
    fireEvent.click(screen.getAllByRole("button", { name: "Reject" }).at(-1) as HTMLElement);
    await waitFor(() =>
      expect(mockedPost).toHaveBeenCalledWith(`/api/v1/admin/access-requests/${ID}/reject`, { reason: "Bot submission", spam: true }),
    );
  });

  it("offers Resend invitation for an approved request whose invitation was not accepted", async () => {
    await asRole("SUPERADMIN");
    mockedGet.mockImplementation(async (url: string) =>
      url === "/api/v1/admin/access-requests"
        ? { success: true, status: 200, message: "ok", data: [{ ...row, status: "approved" }], meta: { total: 1, page: 1, limit: 20, counts } }
        : {
            success: true,
            status: 200,
            message: "ok",
            data: {
              ...detail,
              status: "approved",
              decidedAt: "2026-09-29T11:00:00.000Z",
              decidedBy: { id: "a", name: "Andi Operator" },
              provisionedTenant: { id: "t", code: "RCS", name: "RSUD Contoh Sejahtera" },
              invitation: { sentAt: null, expiresAt: "2026-10-06T11:00:00.000Z", acceptedAt: null, resendable: true },
            },
          },
    );
    mockedPost.mockResolvedValue({ success: true, status: 200, message: "ok", data: { invitationSent: true } });
    render(<AccessRequestsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "RSUD Contoh Sejahtera" }));
    expect(await screen.findByText("Invitation not sent — resend")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Resend invitation" }));
    await waitFor(() => expect(mockedPost).toHaveBeenCalledWith(`/api/v1/admin/access-requests/${ID}/resend-invitation`, {}));
  });

  it("has no axe violations with a request open", async () => {
    await asRole("SUPERADMIN");
    const { container } = render(<AccessRequestsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "RSUD Contoh Sejahtera" }));
    await screen.findByText(/other request\(s\)/);
    expect(await axeViolations(container)).toEqual([]);
  });

  it("suggestTenantCode", () => {
    expect(suggestTenantCode("RSUD Contoh Sejahtera")).toBe("RCS");
    expect(suggestTenantCode("Klinik 17")).toBe("K17");
    expect(suggestTenantCode("Lab")).toBe("LAB");
  });
});
