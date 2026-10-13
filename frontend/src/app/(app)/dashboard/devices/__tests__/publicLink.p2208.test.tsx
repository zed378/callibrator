/** @jest-environment jsdom */
/**
 * P22-08 — a device's public link in the register (ADR-138 § 1, Am. 1 § 6; P19-07 § 10). Real: the
 * register island, the dialog, the service and the typed client. Mocked: the HTTP client, the
 * dashboard chrome and `qrcode` (jsdom has no canvas).
 *
 * Pins: the row action only for unbound staff with `calibration` write; the three load states (a
 * failed read is never "no link", and it retries); issue → the sticker (QR made in the browser, the
 * link, print, PNG download) with nothing sent anywhere but the API; replace and revoke each ask
 * first and say what happens to the printed sticker; a refusal is the server's explanation; the
 * setting's text (the report link's disclosure said); Indonesian; axe.
 */
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { axeViolations } from "@/tests/a11y/axe";
import { httpError } from "@/tests/support/httpError";
import { clearPermissions, grantPermissions, grantSuperAdmin } from "@/tests/support/permissions";
import { CD_IDS, device, meta, ok } from "@/tests/support/calibrationDatesFixtures";

jest.mock("@/components/layouts/DashboardLayout", () => {
  return function DashboardLayout({ children }: { children: React.ReactNode }) {
    return <main>{children}</main>;
  };
});
jest.mock("@/api/client", () => {
  const actual = jest.requireActual("@/api/client");
  return { ...actual, api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() } };
});
jest.mock("qrcode", () => ({ __esModule: true, default: { toDataURL: jest.fn(async () => "data:image/png;base64,UVI=") } }));

import { api } from "@/api/client";
import QRCode from "qrcode";
import { useMenuStore } from "@/stores/menuStore";
import { MessagesProvider } from "@/i18n/MessagesProvider";
import { en } from "@/i18n/messages/en";
import { id as idMessages } from "@/i18n/messages/id";
import { DevicesClient } from "../DevicesClient";
import { PRINT_CLASS, PublicLinkDialog } from "../components/PublicLinkDialog";

const get = api.get as jest.Mock;
const post = api.post as jest.Mock;
const del = api.delete as jest.Mock;
const toDataURL = (QRCode as unknown as { toDataURL: jest.Mock }).toDataURL;

const LINK = `/api/v1/calibration-devices/${CD_IDS.device}/public-token`;
const TOKEN = "Zx3kQ9vN2mP4rT6wY8aC1d";
const URL_ = `https://kalibrasi.example.test/d/${TOKEN}`;
const NONE = { active: false, issuedAt: null, issuedBy: null, lastRevokedAt: null, setting: "off" };
const ACTIVE = {
  active: true,
  issuedAt: "2026-10-13T02:00:00.000Z",
  issuedBy: { name: "Synthetic Staff", role: "TECHNICIAN", organisation: null, redacted: false },
  lastRevokedAt: "2026-10-12T02:00:00.000Z",
  setting: "minimal_with_report",
};

let state: Record<string, unknown>;

const renderDialog = (locale: "en" | "id" = "en", onClose = jest.fn()) =>
  render(
    <MessagesProvider locale={locale} messages={locale === "en" ? en : idMessages}>
      <PublicLinkDialog device={device()} onClose={onClose} />
    </MessagesProvider>,
  );

beforeEach(() => {
  jest.clearAllMocks();
  clearPermissions();
  state = NONE;
  get.mockImplementation((path: string) => (path === LINK ? Promise.resolve(ok(state)) : Promise.reject(new Error(`unexpected GET ${path}`))));
  post.mockImplementation((path: string) => {
    if (path === LINK || path === `${LINK}/rotate`) {
      state = { ...ACTIVE, setting: "off" };
      return Promise.resolve(ok({ token: TOKEN, url: URL_, issuedAt: "2026-10-13T02:00:00.000Z" }));
    }
    return Promise.reject(new Error(`unexpected POST ${path}`));
  });
  del.mockImplementation(() => {
    state = { ...NONE, lastRevokedAt: "2026-10-13T03:00:00.000Z" };
    return Promise.resolve(ok({ revokedAt: "2026-10-13T03:00:00.000Z" }));
  });
});

describe("P22-08 — the row action", () => {
  const rows = (path: string) => {
    if (path === "/api/v1/calibration-devices") return Promise.resolve(ok([device()], meta(1, 1, 20)));
    if (path === "/api/v1/client-facilities/options") return Promise.resolve(ok([]));
    if (path === LINK) return Promise.resolve(ok(state));
    return Promise.reject(new Error(`unexpected GET ${path}`));
  };
  const renderRegister = () =>
    render(
      <MessagesProvider locale="en" messages={en}>
        <DevicesClient languageForm={<div>language</div>} />
      </MessagesProvider>,
    );

  it("unbound staff with calibration write open the panel from the row", async () => {
    get.mockImplementation(rows);
    grantPermissions({ calibration: "write" });
    renderRegister();
    fireEvent.click(await screen.findByRole("button", { name: "Public link of Synthetic infusion pump" }));
    expect(await screen.findByRole("dialog", { name: "Public link of Synthetic infusion pump" })).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("a facility account, the operator and a reader see no such action", async () => {
    get.mockImplementation(rows);
    for (const grant of [
      () => useMenuStore.setState({ effectivePermissions: { superAdmin: false, facilityBound: true, permissions: { calibration: "write" } } }),
      () => grantSuperAdmin(),
      () => grantPermissions({ calibration: "read" }),
    ]) {
      grant();
      const { unmount } = renderRegister();
      await screen.findByText("Synthetic infusion pump");
      expect(screen.queryByRole("button", { name: "Public link of Synthetic infusion pump" })).toBeNull();
      unmount();
    }
  });
});

describe("P22-08 — the panel", () => {
  it("no link yet: says so and what the tenant's page shows; Issue makes the sticker in the browser — nothing else is sent", async () => {
    const { container } = renderDialog();
    expect(await screen.findByText("This device has no public link yet.")).toBeTruthy();
    expect(screen.getByText(/This tenant’s public page is off/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Issue a link" }));
    const sticker = await screen.findByRole("region", { name: "Sticker" });
    expect(within(sticker).getByRole("img", { name: "QR code of the public link of Synthetic infusion pump" }).getAttribute("src")).toBe("data:image/png;base64,UVI=");
    expect(within(sticker).getByText(URL_)).toBeTruthy();
    expect(within(sticker).getByText(/will not be shown again/)).toBeTruthy();
    const download = within(sticker).getByRole("link", { name: "Download the sticker (PNG)" });
    expect([download.getAttribute("href"), download.getAttribute("download")]).toEqual(["data:image/png;base64,UVI=", "sticker-Synthetic_infusion_pump.png"]);
    expect(toDataURL).toHaveBeenCalledWith(URL_, expect.objectContaining({ width: 512 }));
    expect(post.mock.calls.map((c) => c[0])).toEqual([LINK]);
    expect(await screen.findByText(/Active link, issued .* by Synthetic Staff\./)).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("print shows only the sticker: the body class is set around window.print()", async () => {
    const seen: boolean[] = [];
    const print = jest.spyOn(window, "print").mockImplementation(() => {
      seen.push(document.body.classList.contains(PRINT_CLASS));
    });
    renderDialog();
    fireEvent.click(await screen.findByRole("button", { name: "Issue a link" }));
    fireEvent.click(await screen.findByRole("button", { name: "Print the sticker" }));
    expect([print.mock.calls.length, seen, document.body.classList.contains(PRINT_CLASS)]).toEqual([1, [true], false]);
  });

  it("a QR the browser cannot make: the link stays, no download is offered", async () => {
    toDataURL.mockRejectedValueOnce(new Error("no canvas"));
    renderDialog();
    fireEvent.click(await screen.findByRole("button", { name: "Issue a link" }));
    expect(await screen.findByText("The QR code cannot be made in this browser. Copy the link.")).toBeTruthy();
    expect(screen.getByText(URL_)).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Download the sticker (PNG)" })).toBeNull();
  });

  it("an active link: issuer, last revocation, the report link's disclosure; Replace asks first, then a new sticker", async () => {
    state = ACTIVE;
    renderDialog();
    expect(await screen.findByText(/Active link, issued .* by Synthetic Staff\./)).toBeTruthy();
    expect(screen.getByText(/The last link was revoked/)).toBeTruthy();
    expect(screen.getByText(/shows the serial number, the QR number and the signers’ names/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Replace the link" }));
    expect(await screen.findByText("The printed sticker of Synthetic infusion pump stops working. Print a new sticker from the new link.")).toBeTruthy();
    const confirm = screen.getAllByRole("button", { name: "Replace the link" }).at(-1) as HTMLElement;
    fireEvent.click(confirm);
    expect(await screen.findByRole("region", { name: "Sticker" })).toBeTruthy();
    expect(post.mock.calls.map((c) => c[0])).toEqual([`${LINK}/rotate`]);
  });

  it("Revoke asks first, then the link is gone and the sticker cleared; Cancel changes nothing", async () => {
    state = ACTIVE;
    renderDialog();
    fireEvent.click(await screen.findByRole("button", { name: "Revoke the link" }));
    expect(await screen.findByText("The printed sticker of Synthetic infusion pump will show “not found”.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(del).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Revoke the link" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Revoke the link" }).at(-1) as HTMLElement);
    expect(await screen.findByText("This device has no public link yet.")).toBeTruthy();
    expect(del).toHaveBeenCalledWith(LINK);
    expect(screen.queryByRole("region", { name: "Sticker" })).toBeNull();
  });

  it("a refusal is the server's explanation; with none, a plain refusal", async () => {
    post.mockRejectedValueOnce(httpError(409, "This device already has a public link.", "PUBLIC_TOKEN_ACTIVE"));
    renderDialog();
    fireEvent.click(await screen.findByRole("button", { name: "Issue a link" }));
    expect(within(await screen.findByRole("alert")).getByText("This device already has a public link.")).toBeTruthy();
    post.mockRejectedValueOnce({});
    fireEvent.click(screen.getByRole("button", { name: "Issue a link" }));
    await waitFor(() => expect(within(screen.getByRole("alert")).getAllByText("The action was refused.").length).toBeGreaterThan(0));
  });

  it("a failed read is not 'no link': it says so and retries", async () => {
    get.mockRejectedValueOnce(httpError(500, "boom"));
    renderDialog();
    expect(await screen.findByText("The link’s state cannot be read.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Issue a link" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("This device has no public link yet.")).toBeTruthy();
  });

  it("an active link whose issuer cannot be named reads without a name", async () => {
    state = { ...ACTIVE, issuedBy: null, lastRevokedAt: null, setting: "minimal" };
    renderDialog();
    expect(await screen.findByText(/^Active link, issued [^]+\.$/)).toBeTruthy();
    expect(screen.queryByText(/ by /)).toBeNull();
    expect(screen.queryByText(/The last link was revoked/)).toBeNull();
    expect(screen.getByText(/shows the name, type, manufacturer and model/)).toBeTruthy();
  });

  it("Indonesian", async () => {
    renderDialog("id");
    expect(await screen.findByRole("dialog", { name: "Tautan publik Synthetic infusion pump" })).toBeTruthy();
    expect(await screen.findByText("Perangkat ini belum memiliki tautan publik.")).toBeTruthy();
  });
});
