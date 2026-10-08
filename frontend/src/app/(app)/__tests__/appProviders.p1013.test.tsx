/** @jest-environment jsdom */
/**
 * P10-13 (ADR-098 Amendment 2): the signed-in app's client providers live in
 * the dashboard layout, not the root layout, so public pages do not download
 * or hydrate them.
 *
 *  - no root layout imports a client provider (a source check: any import
 *    there is JavaScript on every page of its group). ADR-131 (P10-18): there
 *    are two root layouts, app/(public) and app/(app), plus their shared
 *    document (app/rootDocument.tsx) and the global 404;
 *  - the dashboard layout renders AppProviders around its pages, and they still
 *    mount the session check and the toast stack;
 *  - the session check skips a session already in the store (the client-side
 *    step from sign-in into the dashboard) and runs otherwise.
 */
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { render, screen } from "@testing-library/react";
import { AuthInitializer } from "@/components/AuthInitializer";
import { useAuthStore } from "@/stores/authStore";

jest.mock("@/hooks/useTenantBranding", () => ({ useTenantBranding: () => ({ branding: null }) }));

import DashboardRootLayout from "../dashboard/layout";

const src = (rel: string) => fs.readFileSync(path.resolve(__dirname, "../..", rel), "utf8");

describe("P10-13: providers only where they are used", () => {
  it.each(["(public)/layout.tsx", "(app)/layout.tsx", "rootDocument.tsx", "global-not-found.tsx"])(
    "%s imports no client provider",
    (file) => {
      const root = src(file);
      for (const name of ["AuthInitializer", "TenantBrandingProvider", "ThemeProvider", "ToastContainer", "AppProviders"]) {
        expect({ name, imported: new RegExp(`import[^;]*\\b${name}\\b`).test(root) }).toEqual({ name, imported: false });
      }
    },
  );

  it("the dashboard layout wraps its pages in AppProviders (session check, toasts)", () => {
    // jsdom has no matchMedia; ThemeProvider reads the system theme.
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia;
    const initialize = jest.fn().mockResolvedValue(undefined);
    useAuthStore.setState({ isAuthenticated: false, initialize });

    render(
      <DashboardRootLayout>
        <p>dashboard page</p>
      </DashboardRootLayout>,
    );

    expect(screen.getByText("dashboard page")).toBeInTheDocument();
    expect(initialize).toHaveBeenCalledTimes(1);
  });

  it("the session check is skipped for a session already in the store", () => {
    const initialize = jest.fn().mockResolvedValue(undefined);
    useAuthStore.setState({ isAuthenticated: true, initialize });

    render(<AuthInitializer />);

    expect(initialize).not.toHaveBeenCalled();
  });
});
