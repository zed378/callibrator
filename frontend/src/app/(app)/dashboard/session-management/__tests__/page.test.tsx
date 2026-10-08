/** @jest-environment jsdom */
/**
 * A-111 — the session list reads the standard envelope.
 *
 * GET /api/v1/sessions now answers `{ success, status, message, data: Session[],
 * meta }` — rows in `data`, pagination in a top-level `meta` — exactly what the
 * backend's session.envelope.a111.test.js asserts from the real response.util.
 * The fixture below is that body. Only the HTTP client is mocked: the real
 * session.service unwraps it, so a service that still read `data.sessions`
 * would render "No sessions found" here (CLAUDE.md: the empty-list-with-no-error
 * failure).
 */
import { render, screen, waitFor } from "@testing-library/react";

jest.mock("@/components/layouts/DashboardLayout", () => {
  return function DashboardLayout({ children }: { children: React.ReactNode }) {
    return <div data-testid="dashboard-layout">{children}</div>;
  };
});

const mockFetchUser = jest.fn();
const mockAuth = {
  user: { id: "22222222-2222-4222-8222-222222222222" },
  isAuthenticated: true,
  fetchUser: mockFetchUser,
};
jest.mock("@/stores/authStore", () => ({
  useAuthStore: () => mockAuth,
}));

jest.mock("@/api/client", () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  },
}));

import { api } from "@/api/client";
import SessionManagementPage from "../page";

const mockedApi = api as jest.Mocked<typeof api>;

const session = {
  id: "8c352a92-d6cf-4b71-b0db-6e69622d1b11",
  userId: "33333333-3333-4333-8333-333333333333",
  username: "technician.one",
  email: "tech@rs.test",
  firstName: "Tech",
  lastName: "One",
  ipAddress: "10.20.30.40",
  userAgent: "Mozilla/5.0 Firefox/121",
  device: "Desktop",
  browser: "Firefox",
  os: "Linux",
  location: "N/A",
  role: "Technician",
  tenantId: "11111111-1111-4111-8111-111111111111",
  tenantName: "RS Sehat",
  isRevoked: false,
  isActive: true,
  expiredAt: "2099-01-01T00:00:00.000Z",
  revokedAt: null,
  revokedReason: null,
  lastActivityAt: "2026-09-24T08:00:00.000Z",
  createdAt: "2026-09-24T07:00:00.000Z",
  status: "active",
};

beforeEach(() => {
  jest.clearAllMocks();
  mockedApi.get.mockImplementation(async (url: string) => {
    if (url === "/api/v1/sessions") {
      return {
        success: true,
        status: 200,
        message: "Sessions retrieved successfully",
        data: [session],
        meta: { total: 41, page: 1, limit: 20, totalPages: 3 },
      };
    }
    if (url === "/api/v1/sessions/stats") {
      return {
        success: true,
        status: 200,
        message: "Session statistics retrieved successfully",
        data: { total: 41, active: 30, expired: 8, revoked: 3 },
      };
    }
    throw new Error(`unexpected GET ${url}`);
  });
});

describe("Session management page (A-111)", () => {
  it("lists the rows from data and paginates from the top-level meta", async () => {
    render(<SessionManagementPage />);

    expect(await screen.findByText("technician.one")).toBeInTheDocument();
    expect(screen.getByText("10.20.30.40")).toBeInTheDocument();
    expect(screen.queryByText("No sessions found")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Page 1 of 3 (41 total)")).toBeInTheDocument());
  });
});
