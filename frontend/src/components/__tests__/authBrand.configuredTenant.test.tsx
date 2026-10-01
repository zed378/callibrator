/** @jest-environment jsdom */
/**
 * A deploy-bound (single-tenant) build — NEXT_PUBLIC_TENANT_ID set: before
 * sign-in, useTenantBranding reads the tenant's PUBLIC branding from
 * GET /api/v1/tenants/public (tenant.controller.js getPublicBranding:
 * `data: { name, primaryColor, logoBaseUrl }`, 404 when unknown) and
 * useAuthBrand shows it on the login/register pages.
 *
 * Real: both hooks, the stores, the tenant service. Mocked: the build
 * constant and `@/api/client`'s transport.
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { axeViolations } from "@/tests/a11y/axe";

jest.mock("@/constants", () => ({
  ...jest.requireActual("@/constants"),
  HAS_CONFIGURED_TENANT: true,
}));
jest.mock("@/api/client", () => ({
  ...jest.requireActual("@/api/client"),
  api: { get: jest.fn(), post: jest.fn() },
}));

import { api } from "@/api/client";
import { useTenantBranding } from "@/hooks/useTenantBranding";
import { useAuthBrand } from "@/hooks/useAuthBrand";
import { useAuthStore } from "@/stores/authStore";
import { useTenantBrandingStore } from "@/stores/tenantBrandingStore";
import { httpError } from "@/tests/support/httpErrors";

const mockedGet = api.get as jest.Mock;

function AuthHeader() {
  useTenantBranding();
  const { name, logoUrl, hasTenant } = useAuthBrand();
  return (
    <header>
      <h1>{name}</h1>
      {logoUrl && <p>logo: {logoUrl}</p>}
      <p>{hasTenant ? "tenant-branded" : "default-brand"}</p>
    </header>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  useTenantBrandingStore.setState({ branding: null, error: null });
  useAuthStore.setState({ isAuthenticated: false, user: null });
});

describe("useAuthBrand on a deploy-bound build", () => {
  it("brands the auth pages with the configured tenant's public branding", async () => {
    mockedGet.mockResolvedValue({
      success: true,
      status: 200,
      message: "Fetch tenant branding successful",
      data: { name: "RS Harapan", primaryColor: "#0f766e", logoBaseUrl: "/uploads/public/tenant/rsh.png" },
    });
    const { container } = render(<AuthHeader />);

    expect(await screen.findByRole("heading", { name: "RS Harapan" })).toBeInTheDocument();
    expect(mockedGet).toHaveBeenCalledWith("/api/v1/tenants/public");
    expect(screen.getByText("logo: /uploads/public/tenant/rsh.png")).toBeInTheDocument();
    expect(screen.getByText("tenant-branded")).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("an unknown tenant (404) leaves the default product brand", async () => {
    mockedGet.mockRejectedValue(httpError(404, "Tenant not found"));
    render(<AuthHeader />);

    await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("heading", { name: "Device Calibrator" })).toBeInTheDocument();
    expect(screen.queryByText(/^logo:/)).not.toBeInTheDocument();
    expect(screen.getByText("default-brand")).toBeInTheDocument();
  });

  it("a tenant with no name or logo still leaves the defaults in place", async () => {
    mockedGet.mockResolvedValue({
      success: true,
      status: 200,
      message: "ok",
      data: { name: "", primaryColor: null, logoBaseUrl: null },
    });
    render(<AuthHeader />);

    await waitFor(() => expect(useTenantBrandingStore.getState().branding).not.toBeNull());
    expect(useTenantBrandingStore.getState().branding).toMatchObject({ favicon: "/favicon.ico" });
    expect(screen.getByRole("heading", { name: "Device Calibrator" })).toBeInTheDocument();
  });
});
