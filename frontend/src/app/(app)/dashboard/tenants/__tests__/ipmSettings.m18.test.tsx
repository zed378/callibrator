/** @jest-environment jsdom */
/**
 * M-18 (P26-01 § 9 C-1) — the tenant administrator's IPM and public-page settings, on the tenants
 * page. Real: the page's client island, the card, the panel, the rules (`ipmSettings.ts`), the tenant
 * service and the typed client. Mocked: the HTTP client, the dashboard chrome, next/navigation.
 *
 * Pins: offered to a tenant administrator (management write) and never to the platform operator or a
 * reader; read through `POST /tenants/settings { tenantId }`, written through
 * `PATCH /tenants/settings { tenantId, settings }` with the CHANGED keys only (a cleared one as "",
 * `off` as ""); the interval and the zone checked first (nothing sent); a 400 and a 409 shown as the
 * server wrote them; a failed read is not "all off" and retries; "nothing has changed"; Indonesian;
 * axe.
 */
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AxiosError, AxiosHeaders } from "axios";
import { axeViolations } from "@/tests/a11y/axe";

jest.mock("@/components/layouts/DashboardLayout", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
jest.mock("@/api/client", () => {
  const actual = jest.requireActual("@/api/client");
  return { ...actual, api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() } };
});
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }) }));

import { api } from "@/api/client";
import { TenantsClient } from "../TenantsClient";
import { IpmSettingsPanel } from "../components/IpmSettingsPanel";
import { changesOf, formOf, problemsOf } from "../components/ipmSettings";
import { MessagesProvider } from "@/i18n/MessagesProvider";
import { en } from "@/i18n/messages/en";
import { id as idMessages } from "@/i18n/messages/id";
import { useAuthStore } from "@/stores/authStore";
import type { Tenant, User } from "@/types";
import { clearPermissions, grantPermissions, grantSuperAdmin } from "@/tests/support/permissions";

jest.setTimeout(20000);

const get = api.get as jest.Mock;
const post = api.post as jest.Mock;
const patch = api.patch as jest.Mock;

const envelope = (data: unknown, meta?: Record<string, number>) => ({ success: true, status: 200, message: "ok", data, ...(meta ? { meta } : {}) });
const httpError = (status: number, message: string) =>
  new AxiosError(message, "ERR_BAD_REQUEST", undefined, undefined, {
    status,
    statusText: "",
    data: { success: false, status, message },
    headers: {},
    config: { headers: new AxiosHeaders() },
  });

const TENANT = {
  id: "t-1",
  name: "Synthetic Calibration Co",
  code: "SYN",
  status: "active",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

let stored: Record<string, unknown>;

beforeEach(() => {
  jest.clearAllMocks();
  clearPermissions();
  stored = { public_device_page: "minimal", ipm_countersign_enabled: "false", ipm_interval_months: 6, sso_enabled: "true" };
  get.mockImplementation(async (url: string) => {
    if (url === "/api/v1/tenants/all") return envelope([TENANT], { total: 1, page: 1, limit: 10, totalPages: 1 });
    throw new Error(`unexpected GET ${url}`);
  });
  post.mockImplementation(async (url: string, body: { tenantId?: string }) => {
    if (url === "/api/v1/tenants/detail") return envelope(TENANT);
    if (url === "/api/v1/tenants/settings") return envelope({ tenant: TENANT, settings: stored, tenantId: body.tenantId });
    throw new Error(`unexpected POST ${url}`);
  });
  patch.mockImplementation(async () => envelope({ ok: true }));
});

const as = (who: "admin" | "operator" | "reader") => {
  useAuthStore.setState({
    user: { id: "u-1", username: "ada", email: "a@x.test", tenantId: "t-1", role: { id: "r", name: who === "operator" ? "SUPERADMIN" : "CALIBRATOR ADMIN" } } as User,
  });
  if (who === "operator") grantSuperAdmin();
  else grantPermissions({ management: who === "admin" ? "write" : "read" });
};

const renderPanel = (locale: "en" | "id" = "en", onClose = jest.fn()) =>
  render(
    <MessagesProvider locale={locale} messages={locale === "en" ? en : idMessages}>
      <IpmSettingsPanel tenant={TENANT as unknown as Tenant} onClose={onClose} />
    </MessagesProvider>,
  );

describe("M-18 — the rules", () => {
  it("formOf: unset and unknown modes read as off; the interval and zone as text", () => {
    expect(formOf({})).toEqual({ publicPage: "off", countersign: false, interval: "", timeZone: "" });
    expect(formOf({ public_device_page: "everything", ipm_countersign_enabled: true, ipm_interval_months: 12, tenant_time_zone: " Asia/Makassar " })).toEqual({
      publicPage: "off",
      countersign: true,
      interval: "12",
      timeZone: "Asia/Makassar",
    });
  });

  it("problemsOf: the interval 1 … 60 or empty; a zone the runtime knows or empty", () => {
    const base = { publicPage: "off" as const, countersign: false, interval: "", timeZone: "" };
    expect(problemsOf(base)).toEqual([]);
    expect(problemsOf({ ...base, interval: "1" })).toEqual([]);
    expect(problemsOf({ ...base, interval: "60" })).toEqual([]);
    for (const bad of ["0", "61", "1.5", "-3", "six"]) expect(problemsOf({ ...base, interval: bad })).toEqual(["interval"]);
    expect(problemsOf({ ...base, timeZone: "Asia/Jayapura" })).toEqual([]);
    expect(problemsOf({ ...base, timeZone: "Mars/Olympus" })).toEqual(["timeZone"]);
  });

  it("changesOf: only the changed keys; off and a cleared field as an empty value", () => {
    const before = { publicPage: "minimal" as const, countersign: false, interval: "6", timeZone: "" };
    expect(changesOf(before, before)).toEqual({});
    expect(changesOf(before, { ...before, publicPage: "off", countersign: true, interval: "", timeZone: "Asia/Makassar" })).toEqual({
      public_device_page: "",
      ipm_countersign_enabled: "true",
      ipm_interval_months: "",
      tenant_time_zone: "Asia/Makassar",
    });
  });
});

describe("M-18 — who is offered it", () => {
  const renderPage = () =>
    render(
      <MessagesProvider locale="en" messages={en}>
        <TenantsClient />
      </MessagesProvider>,
    );

  it("a tenant administrator opens it from the tenant's card", async () => {
    as("admin");
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "IPM and public page settings of Synthetic Calibration Co" }));
    expect(await screen.findByRole("dialog", { name: "IPM and public page — Synthetic Calibration Co" })).toBeTruthy();
  });

  it("the platform operator and a reader are not offered it", async () => {
    for (const who of ["operator", "reader"] as const) {
      as(who);
      const { unmount } = renderPage();
      await screen.findByText("Synthetic Calibration Co");
      expect(screen.queryByRole("button", { name: /IPM and public page settings/ })).toBeNull();
      unmount();
    }
  });
});

describe("M-18 — the panel", () => {
  it("reads the stored values; saves only what changed, with the tenant in the body", async () => {
    const onClose = jest.fn();
    const { container } = renderPanel("en", onClose);
    const minimal = await screen.findByRole("radio", { name: /^Minimal The name/ });
    expect((minimal as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: /countersigns IPM reports/ }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("textbox", { name: "IPM interval (months)" }) as HTMLInputElement).value).toBe("6");
    expect(await axeViolations(container)).toEqual([]);

    fireEvent.click(screen.getByRole("radio", { name: /^Minimal, with the last IPM report/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /countersigns IPM reports/ }));
    fireEvent.change(screen.getByRole("combobox", { name: "Time zone" }), { target: { value: "Asia/Makassar" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch.mock.calls[0]?.[0]).toBe("/api/v1/tenants/settings");
    expect(patch.mock.calls[0]?.[1]).toEqual({
      tenantId: "t-1",
      settings: { public_device_page: "minimal_with_report", ipm_countersign_enabled: "true", tenant_time_zone: "Asia/Makassar" },
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("turning the page off and clearing the interval send empty values", async () => {
    renderPanel();
    fireEvent.click(await screen.findByRole("radio", { name: /^Off/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "IPM interval (months)" }), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch.mock.calls[0]?.[1]).toEqual({ tenantId: "t-1", settings: { public_device_page: "", ipm_interval_months: "" } });
  });

  it("an invalid interval or zone is explained on its field and nothing is sent", async () => {
    const { container } = renderPanel();
    const interval = await screen.findByRole("textbox", { name: "IPM interval (months)" });
    fireEvent.change(interval, { target: { value: "61" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Time zone" }), { target: { value: "Mars/Olympus" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Enter a whole number from 1 to 60, or leave it empty.")).toBeTruthy();
    expect(screen.getByText(/not a time zone this browser knows/)).toBeTruthy();
    expect(interval.getAttribute("aria-invalid")).toBe("true");
    expect(interval.getAttribute("aria-describedby")).toContain("interval-error");
    expect(patch).not.toHaveBeenCalled();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("nothing changed: says so and sends nothing", async () => {
    renderPanel();
    await screen.findByRole("radio", { name: /^Off/ });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Nothing has changed.")).toBeTruthy();
    expect(patch).not.toHaveBeenCalled();
  });

  it("a 400 and a 409 are shown as the server wrote them; the dialog stays open", async () => {
    const onClose = jest.fn();
    renderPanel("en", onClose);
    fireEvent.click(await screen.findByRole("checkbox", { name: /countersigns IPM reports/ }));
    patch.mockRejectedValueOnce(httpError(400, 'Setting "ipm_countersign_enabled" must be true or false'));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText('Setting "ipm_countersign_enabled" must be true or false')).toBeTruthy();
    patch.mockRejectedValueOnce(httpError(409, "The tenant is suspended; its settings cannot change."));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("The tenant is suspended; its settings cannot change.")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("a failed read is not 'all off': it says so, offers no form, and retries", async () => {
    post.mockRejectedValueOnce(httpError(500, "boom"));
    renderPanel();
    expect(await screen.findByText("The settings cannot be read.")).toBeTruthy();
    expect(screen.queryByRole("radio")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("radio", { name: /^Minimal The name/ })).toBeTruthy();
  });

  it("Indonesian", async () => {
    renderPanel("id");
    expect(await screen.findByRole("dialog", { name: "IPM dan halaman publik — Synthetic Calibration Co" })).toBeTruthy();
    expect(await screen.findByRole("radio", { name: /^Mati/ })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: /IPSRS faskes menandatangani/ })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Interval IPM (bulan)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Simpan" })).toBeTruthy();
  });
});
