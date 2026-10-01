/** @jest-environment jsdom */
/**
 * TenantBrandingProvider + useTenantBranding on a default (multi-tenant)
 * build: a signed-in user's own tenant branding is read from
 * POST /api/v1/tenants/detail (`data` is the tenant, with the SERVED
 * `logoBaseUrl` — tenant.service.js) and applied to the document: the
 * accessible brand palette on <html>, the title, the favicon.
 *
 * Real: the provider, the hook, the auth and branding stores, the tenant and
 * auth services. Mocked: `@/api/client`'s transport.
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { axeViolations } from "@/tests/a11y/axe";

jest.mock("@/api/client", () => ({
  ...jest.requireActual("@/api/client"),
  api: { get: jest.fn(), post: jest.fn() },
}));

import { api } from "@/api/client";
import { TenantBrandingProvider, applyBrandColor } from "../TenantBrandingProvider";
import { useAuthStore } from "@/stores/authStore";
import { useTenantBrandingStore } from "@/stores/tenantBrandingStore";
import { useAuthBrand } from "@/hooks/useAuthBrand";
import { BRAND_ATTRIBUTE, BRAND_PROPERTIES } from "@/lib/brandColor";
import { httpError } from "@/tests/support/httpErrors";
import type { User } from "@/types";

// Whole-page renders with axe: allow for a loaded machine (as calibration/devices page tests do).
jest.setTimeout(20000);

const mockedPost = api.post as jest.Mock;
const root = document.documentElement;

const tenant = {
  id: "t-1",
  name: "RS Harapan",
  code: "rsh",
  primaryColor: "#0f766e",
  logo: "logo-rsh.png",
  logoBaseUrl: "/uploads/public/tenant/logo-rsh.png",
};

const signIn = () =>
  useAuthStore.setState({
    isAuthenticated: true,
    user: { id: "u-1", username: "ada", tenantId: "t-1" } as User,
  });

const Brand = () => {
  const { name, logoUrl, hasTenant } = useAuthBrand();
  return (
    <p>
      {name}|{String(logoUrl)}|{String(hasTenant)}
    </p>
  );
};

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  document.head.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]').forEach((l) => l.remove());
  document.title = "";
  applyBrandColor(undefined);
  useTenantBrandingStore.setState({ branding: null, error: null, isLoading: false });
  useAuthStore.setState({ isAuthenticated: false, user: null });
});

describe("TenantBrandingProvider", () => {
  it("applies the signed-in tenant's colour, name and served logo to the document", async () => {
    signIn();
    mockedPost.mockResolvedValue({ success: true, status: 200, message: "Fetch tenant successful", data: tenant });
    const { container } = render(
      <TenantBrandingProvider>
        <main>app</main>
      </TenantBrandingProvider>,
    );

    await waitFor(() => expect(document.title).toBe("RS Harapan"));
    expect(mockedPost).toHaveBeenCalledWith("/api/v1/tenants/detail", { tenantId: "t-1" });
    expect(root).toHaveAttribute(BRAND_ATTRIBUTE);
    expect(root.style.getPropertyValue(BRAND_PROPERTIES.lightPrimary)).not.toBe("");
    // The raw brand colour is never written to --primary (ADR-090).
    expect(root.style.getPropertyValue("--primary")).toBe("");
    expect(document.head.querySelector('link[rel="icon"]')).toHaveAttribute("href", tenant.logoBaseUrl);
    expect(document.head.querySelector('link[rel="apple-touch-icon"]')).toHaveAttribute("href", tenant.logoBaseUrl);
    expect(screen.getByText("app")).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("updates existing icon links rather than adding more", async () => {
    const icon = Object.assign(document.createElement("link"), { rel: "icon", href: "/favicon.ico" });
    const apple = Object.assign(document.createElement("link"), { rel: "apple-touch-icon", href: "/apple.png" });
    document.head.append(icon, apple);
    signIn();
    mockedPost.mockResolvedValue({ success: true, status: 200, message: "ok", data: tenant });
    render(<TenantBrandingProvider>app</TenantBrandingProvider>);

    await waitFor(() => expect(icon.getAttribute("href")).toBe(tenant.logoBaseUrl));
    expect(apple.getAttribute("href")).toBe(tenant.logoBaseUrl);
    expect(document.head.querySelectorAll('link[rel="icon"]')).toHaveLength(1);
  });

  it("a tenant the backend will not serve a logo for keeps the default favicon", async () => {
    signIn();
    mockedPost.mockResolvedValue({
      success: true,
      status: 200,
      message: "ok",
      data: { ...tenant, logoBaseUrl: null, primaryColor: null },
    });
    render(<TenantBrandingProvider>app</TenantBrandingProvider>);

    await waitFor(() => expect(document.head.querySelector('link[rel="icon"]')).toHaveAttribute("href", "/favicon.ico"));
    expect(document.head.querySelector('link[rel="apple-touch-icon"]')).toBeNull();
    // No colour: the default theme tokens stay.
    expect(root).not.toHaveAttribute(BRAND_ATTRIBUTE);
  });

  it("a 401 while loading branding ends the session and clears the branding", async () => {
    signIn();
    useTenantBrandingStore.setState({ branding: { appName: "Stale" } });
    mockedPost.mockImplementation(async (url: string) => {
      if (url === "/api/v1/tenants/detail") throw httpError(401, "Session expired");
      return { success: true, status: 200, message: "Logout successful", data: null };
    });
    render(<TenantBrandingProvider>app</TenantBrandingProvider>);

    await waitFor(() => expect(useAuthStore.getState().isAuthenticated).toBe(false));
    expect(mockedPost).toHaveBeenCalledWith("/api/v1/auth/logout", { sessionId: undefined });
    expect(useTenantBrandingStore.getState().branding).toBeNull();
    expect(root).not.toHaveAttribute(BRAND_ATTRIBUTE);
  });

  it("any other failure keeps the session and records the error", async () => {
    signIn();
    mockedPost.mockRejectedValue(httpError(500, "Tenant lookup failed"));
    render(<TenantBrandingProvider>app</TenantBrandingProvider>);

    await waitFor(() => expect(useTenantBrandingStore.getState().error).toBe("Tenant lookup failed"));
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(mockedPost).not.toHaveBeenCalledWith("/api/v1/auth/logout", expect.anything());
  });

  it("restores branding saved from an earlier session, and ignores a corrupt entry", async () => {
    localStorage.setItem("tenant_branding", JSON.stringify({ appName: "Saved Hospital", primaryColor: "#1d4ed8" }));
    const first = render(<TenantBrandingProvider>app</TenantBrandingProvider>);
    await waitFor(() => expect(document.title).toBe("Saved Hospital"));
    expect(root).toHaveAttribute(BRAND_ATTRIBUTE);
    first.unmount();

    useTenantBrandingStore.setState({ branding: null });
    localStorage.setItem("tenant_branding", "{not json");
    render(<TenantBrandingProvider>app</TenantBrandingProvider>);
    await waitFor(() => expect(root).not.toHaveAttribute(BRAND_ATTRIBUTE));
    // Signed out on a default build: nothing is fetched.
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it("the auth pages of a default build show the product brand, never a cached tenant's", () => {
    useTenantBrandingStore.setState({ branding: { appName: "Cached Tenant", logoBaseUrl: "/x.png" } });
    render(<Brand />);

    expect(screen.getByText("Device Calibrator|null|false")).toBeInTheDocument();
  });
});
