/**
 * P7-08 / ADR-071 (amendment) — the signed-in branding uses the SERVED logo
 * URL, never the raw stored `tenant.logo`.
 *
 * Fail-before: `favicon` and `logo` were `tenant.logo`. A stored file name
 * became a relative favicon href (resolved against the current page, so it
 * never loaded), and an old absolute third-party URL was put straight into
 * <link rel="icon"> — hotlinked, and blocked by the page CSP's img-src. The
 * backend now answers `logoBaseUrl: null` for any logo it will not serve, and
 * the default favicon is the fallback.
 */
import { act, renderHook } from "@testing-library/react";

const mockSetBranding = jest.fn();
const mockGetById = jest.fn();

jest.mock("@/stores/authStore", () => ({
  useAuthStore: () => ({
    user: { tenantId: "t-1" },
    isAuthenticated: true,
    logout: jest.fn(),
  }),
}));
jest.mock("@/stores/tenantBrandingStore", () => ({
  useTenantBrandingStore: Object.assign(
    () => ({
      branding: {},
      setBranding: mockSetBranding,
      clearBranding: jest.fn(),
      setError: jest.fn(),
      isLoading: false,
    }),
    { getState: () => ({ error: null }) },
  ),
}));
jest.mock("@/api/services/tenant.service", () => ({
  tenantService: {
    getById: (...a: unknown[]) => mockGetById(...a),
    getPublicBranding: jest.fn(),
  },
}));

import { useTenantBranding } from "../useTenantBranding";

const brandingAfterLoad = async () => {
  renderHook(() => useTenantBranding());
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return mockSetBranding.mock.calls.at(-1)?.[0];
};

beforeEach(() => {
  mockSetBranding.mockClear();
  localStorage.clear();
});

describe("P7-08 — signed-in tenant branding", () => {
  it("an old absolute logo the backend will not serve falls back to the default favicon, with no logo", async () => {
    mockGetById.mockResolvedValue({
      name: "Acme",
      primaryColor: "#112233",
      logo: "https://cdn.example.com/logo.png",
      logoBaseUrl: null,
    });

    const branding = await brandingAfterLoad();

    expect(branding.favicon).toBe("/favicon.ico");
    expect(branding.logo).toBeUndefined();
    expect(JSON.stringify(branding)).not.toContain("cdn.example.com");
  });

  it("an uploaded logo is used through its served URL, not the bare file name", async () => {
    const served = "http://127.0.0.1:5000/uploads/public/tenant/1758-42-abc.png";
    mockGetById.mockResolvedValue({
      name: "Acme",
      primaryColor: null,
      logo: "1758-42-abc.png",
      logoBaseUrl: served,
    });

    const branding = await brandingAfterLoad();

    expect(branding.favicon).toBe(served);
    expect(branding.logo).toBe(served);
    expect(branding.logoBaseUrl).toBe(served);
  });
});
