/** @jest-environment jsdom */
/**
 * P22-05 — /dashboard/calibration-dates by audience (ADR-102: the effective permissions, never a
 * role name):
 *  - `calibration` write, unbound, not the operator: "Record a date" and the list;
 *  - `calibration` read: the list only;
 *  - a facility-bound account (N-10: the entry route answers it 403) never gets the entry, and its
 *    list offers no facility filter and shows no facility column (the server scopes its read);
 *  - the platform operator (A-127: the platform tenant authors nothing) reads, never records;
 *  - no read: a restriction notice, nothing loaded;
 *  - one `<h1>`; Indonesian and English; keyboard tabs; axe-clean.
 */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { axeViolations } from "@/tests/a11y/axe";
import { clearPermissions, grantPermissions, grantSuperAdmin } from "@/tests/support/permissions";
import { meta, ok, record } from "@/tests/support/calibrationDatesFixtures";

jest.mock("@/components/layouts/DashboardLayout", () => {
  return function DashboardLayout({ children }: { children: React.ReactNode }) {
    return <main>{children}</main>;
  };
});

jest.mock("@/api/client", () => {
  const actual = jest.requireActual("@/api/client");
  return { ...actual, api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() } };
});

import { api } from "@/api/client";
import { useMenuStore } from "@/stores/menuStore";
import { MessagesProvider } from "@/i18n/MessagesProvider";
import { en } from "@/i18n/messages/en";
import { id as idMessages } from "@/i18n/messages/id";
import { CalibrationDatesClient, tabsFor } from "../CalibrationDatesClient";

const mockedGet = api.get as jest.Mock;

const renderPage = (locale: "en" | "id" = "en") =>
  render(
    <MessagesProvider locale={locale} messages={locale === "en" ? en : idMessages}>
      <CalibrationDatesClient languageForm={<div>language</div>} />
    </MessagesProvider>,
  );

const routes = async (path: string) => {
  if (path === "/api/v1/calibration-records") return ok([record()], meta(1));
  if (path === "/api/v1/client-facilities/options") return ok([{ id: "f1", name: "Synthetic clinic", code: null }]);
  throw new Error(`unexpected GET ${path}`);
};

describe("P22-05 — /dashboard/calibration-dates by audience", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearPermissions();
    mockedGet.mockImplementation(routes);
  });

  it("tabsFor: entry for an unbound writer who is not the operator; the list for every reader", () => {
    const can = (slugs: string[]) => (slug: string) => slugs.includes(slug);
    const base = { superAdmin: false, facilityBound: false };
    expect(tabsFor({ ...base, canRead: can(["calibration"]), canWrite: can(["calibration"]) })).toEqual(["entry", "list"]);
    expect(tabsFor({ ...base, canRead: can(["calibration"]), canWrite: can([]) })).toEqual(["list"]);
    expect(tabsFor({ ...base, facilityBound: true, canRead: can(["calibration"]), canWrite: can(["calibration"]) })).toEqual(["list"]);
    expect(tabsFor({ ...base, superAdmin: true, canRead: can(["calibration"]), canWrite: can(["calibration"]) })).toEqual(["list"]);
    expect(tabsFor({ ...base, canRead: can([]), canWrite: can([]) })).toEqual([]);
  });

  it("says it is loading until the permissions arrive, with the page's one h1, and loads nothing", () => {
    renderPage();
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it("shows a restriction notice to a caller with no calibration read", () => {
    grantPermissions({ sop: "write" });
    renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "Calibration dates" })).toBeInTheDocument();
    expect(screen.getByText("You do not have access to calibration dates.")).toBeInTheDocument();
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it("a writer gets both tabs, the entry first; arrow keys move between them; axe-clean", async () => {
    grantPermissions({ calibration: "write", vendors: "read" });
    const { container } = renderPage();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("tab", { name: "Record a date" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("QR sticker")).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);

    fireEvent.keyDown(screen.getByRole("tab", { name: "Record a date" }), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Calibration list" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Calibration list" })).toHaveFocus();
    expect(await screen.findByText("Synthetic infusion pump")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Facility" })).toBeInTheDocument();
    expect(await screen.findByRole("option", { name: "Synthetic clinic" })).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole("tab", { name: "Calibration list" }), { key: "Enter" });
    expect(screen.getByRole("tab", { name: "Calibration list" })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(screen.getByRole("tab", { name: "Calibration list" }), { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: "Record a date" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("tab", { name: "Calibration list" }));
    expect(screen.getByRole("tab", { name: "Calibration list" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByText("Synthetic infusion pump")).toBeInTheDocument();
    expect(await screen.findByRole("option", { name: "Synthetic clinic" })).toBeInTheDocument();
  });

  it("a facility-bound account with calibration write reads the list only, with no facility filter or column", async () => {
    useMenuStore.setState({ effectivePermissions: { superAdmin: false, facilityBound: true, permissions: { calibration: "write" } } });
    renderPage();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Record a date" })).not.toBeInTheDocument();
    expect(await screen.findByText("Synthetic infusion pump")).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Facility" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Facility")).not.toBeInTheDocument();
    expect(mockedGet).not.toHaveBeenCalledWith("/api/v1/client-facilities/options");
  });

  it("the platform operator reads the list, never records", async () => {
    grantSuperAdmin();
    renderPage();
    expect(screen.queryByRole("tab", { name: "Record a date" })).not.toBeInTheDocument();
    expect(await screen.findByText("Synthetic infusion pump")).toBeInTheDocument();
    expect(await screen.findByRole("option", { name: "Synthetic clinic" })).toBeInTheDocument();
  });

  it("speaks Indonesian", async () => {
    grantPermissions({ calibration: "write" });
    renderPage("id");
    expect(screen.getByRole("heading", { level: 1, name: "Tanggal kalibrasi" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Catat tanggal" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Daftar kalibrasi" })).toBeInTheDocument();
  });
});
