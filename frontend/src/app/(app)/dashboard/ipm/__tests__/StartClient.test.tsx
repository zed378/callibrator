/** @jest-environment jsdom */
/**
 * P22-03 — starting an IPM (/dashboard/ipm/new) and the camera scanner. Real: the island, the
 * scanner, the services and the typed client. Mocked: the HTTP client, the dashboard chrome, the
 * router, and the browser's camera and `BarcodeDetector`.
 *
 * Pins: only an `ipm` writer who is not the operator may start; a sticker typed (or scanned) finds
 * the device in context — a 404 is "no device you may inspect", never another facility's; the start
 * sends the device and ONE capture reference per device chosen (a retry is the same draft) and opens
 * the capture; a refusal is the server's explanation, and an existing draft is offered to resume;
 * the camera: a code read stops the camera and finds the device; a URL on a sticker gives its last
 * segment; no `BarcodeDetector` or a refused camera is said; one h1; axe.
 */
import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { axeViolations } from "@/tests/a11y/axe";
import { httpError } from "@/tests/support/httpError";
import { clearPermissions, grantPermissions, grantSuperAdmin } from "@/tests/support/permissions";

jest.mock("@/components/layouts/DashboardLayout", () => {
  return function DashboardLayout({ children }: { children: React.ReactNode }) {
    return <main>{children}</main>;
  };
});
jest.mock("@/api/client", () => {
  const actual = jest.requireActual("@/api/client");
  return { ...actual, api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() } };
});
const push = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { api } from "@/api/client";
import { MessagesProvider } from "@/i18n/MessagesProvider";
import { en } from "@/i18n/messages/en";
import { StartClient, draftIdOf, newClientRef } from "../new/StartClient";
import { QrScanner, canScan, codeFromScan } from "../components/QrScanner";

jest.setTimeout(20000);

const get = api.get as jest.Mock;
const post = api.post as jest.Mock;
const ok = <T,>(data: T) => ({ success: true, status: 200, message: "ok", data });
const DEVICE = "5b000000-0000-4000-8000-000000000001";
const DRAFT = "5a000000-0000-4000-8000-000000000009";

const device = (over: Record<string, unknown> = {}) => ({
  id: DEVICE,
  tenantId: "t",
  name: "Synthetic pump",
  serialNumber: "SN-1",
  manufacturer: "Make",
  model: "M-1",
  qrCode: "QR-000123",
  clientFacility: { id: "f", name: "Synthetic clinic", code: "SC" },
  warehouse: { id: "w", name: "ICU", code: "I", floor: "2", kind: "room" },
  lastIpm: { performedAt: "2026-09-01T02:00:00Z", visitNumber: 3 },
  openIpmDraftId: null,
  ...over,
});

const renderPage = () =>
  render(
    <MessagesProvider locale="en" messages={en}>
      <StartClient languageForm={<div>language</div>} />
    </MessagesProvider>,
  );

const find = async (code: string) => {
  fireEvent.change(screen.getByLabelText("QR sticker"), { target: { value: code } });
  fireEvent.click(screen.getByRole("button", { name: "Find" }));
};

const withoutCamera = () => {
  Reflect.deleteProperty(globalThis, "BarcodeDetector");
  Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
};

beforeEach(() => {
  jest.clearAllMocks();
  clearPermissions();
  withoutCamera();
  get.mockImplementation((path: string) =>
    path === "/api/v1/calibration-devices/by-qr/QR-000123" ? Promise.resolve(ok(device())) : Promise.reject(httpError(404, "Calibration device not found")),
  );
});

describe("P22-03 — start an IPM", () => {
  it("loading; restricted without ipm write and for the platform operator", () => {
    const { unmount } = renderPage();
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    unmount();
    grantPermissions({ ipm: "read" });
    const second = renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "Start an IPM" })).toBeInTheDocument();
    expect(screen.getByText("Only a technician who records IPM visits can start or fill one in.")).toBeInTheDocument();
    second.unmount();
    grantSuperAdmin();
    renderPage();
    expect(screen.getByText("Only a technician who records IPM visits can start or fill one in.")).toBeInTheDocument();
  });

  it("find by sticker: the device's facts; start sends the device and one capture reference, then opens the capture; axe-clean", async () => {
    grantPermissions({ ipm: "write" });
    post.mockRejectedValueOnce(httpError(503, "Try again"));
    post.mockResolvedValueOnce(ok({ id: DRAFT }));
    const { container } = renderPage();
    expect(screen.getByText("Type the code or use a handheld scanner. This browser cannot scan with the camera.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Scan with the camera" })).not.toBeInTheDocument();
    await find("QR-000123");
    expect(await screen.findByRole("heading", { level: 2, name: "Synthetic pump" })).toBeInTheDocument();
    for (const fact of ["QR-000123", "SN-1", "Make · M-1", "Synthetic clinic", "ICU · 2"]) expect(screen.getByText(fact)).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Start the IPM" }));
    expect(await screen.findByText("Try again")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start the IPM" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/dashboard/ipm/capture/${DRAFT}`));
    const refs = post.mock.calls.map((c) => (c[1] as { clientRef: string }).clientRef);
    expect(refs[0]).toBe(refs[1]);
    expect(post.mock.calls[0]?.[0]).toBe("/api/v1/ipm/sessions");
    expect((post.mock.calls[0]?.[1] as { deviceId: string }).deviceId).toBe(DEVICE);
  });

  it("not found is said with the code; another failure with the server's words", async () => {
    grantPermissions({ ipm: "write" });
    renderPage();
    await find("QR-999");
    expect(await screen.findByText("No device you may inspect has the sticker QR-999.")).toBeInTheDocument();
    get.mockRejectedValueOnce(httpError(500, "Database down"));
    await find("QR-000123");
    expect(await screen.findByText("Database down")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("QR sticker"), { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "Find" }));
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("a draft that exists: the server's 409 offers to resume it; a device that names one offers it before starting", async () => {
    grantPermissions({ ipm: "write" });
    post.mockRejectedValueOnce(Object.assign(httpError(409, "You already have an IPM draft for this device — resume or discard it.", "IPM_DRAFT_EXISTS"), {}));
    const err = httpError(409, "x", "IPM_DRAFT_EXISTS");
    (err.response as { data: Record<string, unknown> }).data["draftId"] = DRAFT;
    expect(draftIdOf(err)).toBe(DRAFT);
    expect(draftIdOf(new Error("x"))).toBeNull();
    expect(draftIdOf(httpError(409, "x"))).toBeNull();
    post.mockReset();
    post.mockRejectedValueOnce(err);
    renderPage();
    await find("QR-000123");
    fireEvent.click(await screen.findByRole("button", { name: "Start the IPM" }));
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByRole("link", { name: "Continue the draft" })).toHaveAttribute("href", `/dashboard/ipm/capture/${DRAFT}`);

    get.mockResolvedValueOnce(ok(device({ openIpmDraftId: DRAFT, lastIpm: null })));
    await find("QR-000123");
    expect(await screen.findByText("You already have an IPM draft for this device.")).toBeInTheDocument();
    expect(screen.getByText("Never")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start the IPM" })).not.toBeInTheDocument();
    expect(newClientRef()).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("P22-03 — the camera scanner", () => {
  const camera = (codes: string[], options: { deny?: boolean } = {}) => {
    const stopTrack = jest.fn();
    const detect = jest.fn(async () => {
      const code = codes.shift();
      return code ? [{ rawValue: code }] : [];
    });
    Object.assign(globalThis, {
      BarcodeDetector: class {
        detect = detect;
      },
    });
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: jest.fn(async () => (options.deny ? Promise.reject(new Error("NotAllowed")) : { getTracks: () => [{ stop: stopTrack }] })) },
      configurable: true,
    });
    jest.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    return { stopTrack, detect };
  };

  it("codeFromScan: the code itself, or the last segment of a URL", () => {
    expect(codeFromScan(" QR-000123 ")).toBe("QR-000123");
    expect(codeFromScan("https://kalibrasi.example/d/QR-000123")).toBe("QR-000123");
    expect(codeFromScan("https://kalibrasi.example/")).toBe("https://kalibrasi.example/");
    expect(codeFromScan("http://[bad")).toBe("http://[bad");
    expect(canScan()).toBe(false);
  });

  it("a code read stops the camera and finds the device", async () => {
    grantPermissions({ ipm: "write" });
    const { stopTrack } = camera(["", "https://kalibrasi.example/d/QR-000123"]);
    expect(canScan()).toBe(true);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Scan with the camera" }));
    expect(await screen.findByRole("dialog", { name: "Scan the QR sticker" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { level: 2, name: "Synthetic pump" }, { timeout: 3000 })).toBeInTheDocument();
    expect(stopTrack).toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText("QR sticker")).toHaveValue("QR-000123");
  });

  it("a refused camera, or no detector, is said; closing releases it", async () => {
    camera([], { deny: true });
    const onClose = jest.fn();
    const { unmount } = render(
      <MessagesProvider locale="en" messages={en}>
        <QrScanner onCode={jest.fn()} onClose={onClose} />
      </MessagesProvider>,
    );
    expect(await screen.findByText("The camera could not be opened (permission refused or no camera). Type the code instead.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
    unmount();
    withoutCamera();
    render(
      <MessagesProvider locale="en" messages={en}>
        <QrScanner onCode={jest.fn()} onClose={jest.fn()} />
      </MessagesProvider>,
    );
    expect(await screen.findByText("This browser cannot read QR codes from the camera. Type the code or use a handheld scanner.")).toBeInTheDocument();
  });

  it("closed before the camera opened: the stream is stopped at once", async () => {
    const { stopTrack } = camera([]);
    let release: (v: unknown) => void = () => undefined;
    (navigator.mediaDevices.getUserMedia as jest.Mock).mockImplementationOnce(() => new Promise((r) => (release = r)));
    const { unmount } = render(
      <MessagesProvider locale="en" messages={en}>
        <QrScanner onCode={jest.fn()} onClose={jest.fn()} />
      </MessagesProvider>,
    );
    unmount();
    await act(async () => release({ getTracks: () => [{ stop: stopTrack }] }));
    expect(stopTrack).toHaveBeenCalled();
  });
});
