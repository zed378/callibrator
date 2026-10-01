/** @jest-environment jsdom */
/**
 * Network security page against the backend contract
 * (backend/src/routes/api/networkSecurity.route.js, mounted
 * /api/v1/network-security; controllers/networkSecurity.controller.js;
 * services/networkSecurity.service.js):
 *  - GET  /ip-allowlist → data { allowlist: string[] }
 *  - PUT  /ip-allowlist { cidrs } (super admin; replaces the list) → data { tenantId, allowlist }
 *  - GET  /geofence     → data { geofence: { latitude, longitude, radiusKm } | null }
 *  - PUT  /geofence { latitude, longitude, radiusKm? } (super admin) → data { tenantId, geofence }
 *  - POST /evaluate-login { ip, latitude?, longitude? } → data { allowed, ip, geofence, requiresStepUp }
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { axeViolations } from "@/tests/a11y/axe";
import { httpError, networkError } from "@/tests/support/httpError";

jest.mock("@/components/layouts/DashboardLayout", () => {
  return function DashboardLayout({ children }: { children: React.ReactNode }) {
    return <main>{children}</main>;
  };
});

jest.mock("@/api/client", () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

import { api } from "@/api/client";
import { useToastStore } from "@/stores/toastStore";
import { clearPermissions, grantPermissions, grantSuperAdmin } from "@/tests/support/permissions";
import NetworkSecurityPage from "../page";

const mockedGet = api.get as jest.Mock;
const mockedPost = api.post as jest.Mock;
const mockedPut = api.put as jest.Mock;

const ok = (data: unknown, message = "ok") => ({ success: true, status: 200, message, data });

let allowlist: string[];
let geofence: { latitude: number; longitude: number; radiusKm: number } | null;

const backend = () => {
  mockedGet.mockImplementation(async (url: string) => {
    if (url === "/api/v1/network-security/ip-allowlist") return ok({ allowlist }, "Fetch IP allowlist");
    if (url === "/api/v1/network-security/geofence") return ok({ geofence }, "Fetch geofence");
    throw httpError(404, "Not found");
  });
};

const toasts = () => useToastStore.getState().toasts.map((t) => ({ type: t.type, title: t.title, description: t.description }));

beforeEach(() => {
  jest.clearAllMocks();
  useToastStore.setState({ toasts: [] });
  allowlist = ["203.0.113.0/24", "198.51.100.7"];
  geofence = { latitude: -6.2, longitude: 106.816666, radiusKm: 25 };
  backend();
  // ADR-102: the write controls follow `network-security: write`.
  grantPermissions({ "network-security": "write" });
});

const renderLoaded = async () => {
  const view = render(<NetworkSecurityPage />);
  await screen.findByText("203.0.113.0/24");
  return view;
};

const cidrInput = () => screen.getByPlaceholderText("203.0.113.0/24");

/** F-19: every allowlist change opens a confirmation first; press its confirm button. */
const confirmIn = (title: RegExp, button: string) =>
  fireEvent.click(within(screen.getByRole("dialog", { name: title })).getByRole("button", { name: button }));
const [geoLat, geoLng] = [() => screen.getAllByLabelText("Latitude")[0], () => screen.getAllByLabelText("Longitude")[0]];

describe("network security — reading", () => {
  it("shows the enforced allowlist, the lock-out warning and the configured geofence", async () => {
    const { container } = await renderLoaded();

    expect(screen.getByText("198.51.100.7")).toBeInTheDocument();
    expect(screen.getByText("Enforced")).toBeInTheDocument();
    expect(screen.getByText(/can lock you\s+out of this tenant/)).toBeInTheDocument();
    expect(screen.getByText("Configured")).toBeInTheDocument();
    expect(geoLat()).toHaveValue(-6.2);
    expect(geoLng()).toHaveValue(106.816666);
    expect(screen.getByLabelText("Radius (km)")).toHaveValue(25);
    expect(await axeViolations(container)).toEqual([]);
  });

  it("an empty allowlist and no geofence read as unrestricted", async () => {
    allowlist = [];
    geofence = null;
    const { container } = render(<NetworkSecurityPage />);

    expect(await screen.findByText(/sign-in is allowed from any IP/)).toBeInTheDocument();
    expect(screen.getByText("Unrestricted")).toBeInTheDocument();
    expect(screen.getByText("Not set")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove all restrictions" })).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("shows the loading state before the reads answer", async () => {
    mockedGet.mockImplementation(() => new Promise(() => undefined));
    render(<NetworkSecurityPage />);

    expect(await screen.findByText("Loading…")).toBeInTheDocument();
    expect(screen.queryByText(/sign-in is allowed from any IP/)).not.toBeInTheDocument();
  });

  it("a failed read (403) shows the error", async () => {
    mockedGet.mockRejectedValue(httpError(403, "You do not have permission to read network security"));
    const { container } = render(<NetworkSecurityPage />);

    expect(await screen.findByText("You do not have permission to read network security")).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe("network security — IP allowlist", () => {
  it("adding a range PUTs the whole list with it appended", async () => {
    mockedPut.mockResolvedValue(ok({ tenantId: "t-1", allowlist: [...allowlist, "192.0.2.0/28"] }));
    await renderLoaded();

    fireEvent.change(cidrInput(), { target: { value: " 192.0.2.0/28 " } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    confirmIn(/Add 192\.0\.2\.0\/28/, "Add range");

    expect(await screen.findByText("192.0.2.0/28")).toBeInTheDocument();
    expect(mockedPut).toHaveBeenCalledWith("/api/v1/network-security/ip-allowlist", {
      cidrs: ["203.0.113.0/24", "198.51.100.7", "192.0.2.0/28"],
    });
    expect(toasts()).toContainEqual({ type: "success", title: "Range added", description: undefined });
    expect(cidrInput()).toHaveValue("");
  });

  it("Enter in the field adds too", async () => {
    mockedPut.mockResolvedValue(ok({ tenantId: "t-1", allowlist: [] }));
    await renderLoaded();

    fireEvent.change(cidrInput(), { target: { value: "192.0.2.1" } });
    fireEvent.keyDown(cidrInput(), { key: "Enter" });
    confirmIn(/Add 192\.0\.2\.1/, "Add range");

    await waitFor(() => expect(mockedPut).toHaveBeenCalledTimes(1));
  });

  it("refuses a malformed or duplicate range without calling the server", async () => {
    await renderLoaded();

    fireEvent.change(cidrInput(), { target: { value: "not-an-ip" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(toasts()).toContainEqual({
      type: "error",
      title: "Invalid CIDR",
      description: "Use a form like 203.0.113.0/24, 203.0.113.7 or 2001:db8::/32",
    });

    fireEvent.change(cidrInput(), { target: { value: "198.51.100.7" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(toasts()).toContainEqual({ type: "error", title: "That range is already listed", description: undefined });

    expect(mockedPut).not.toHaveBeenCalled();
  });

  it("removing one range PUTs the list without it", async () => {
    mockedPut.mockResolvedValue(ok({ tenantId: "t-1", allowlist: ["198.51.100.7"] }));
    await renderLoaded();

    fireEvent.click(screen.getByRole("button", { name: "Remove 203.0.113.0/24" }));
    confirmIn(/Remove 203\.0\.113\.0\/24/, "Remove range");

    await waitFor(() => expect(screen.queryByText("203.0.113.0/24", { selector: "span" })).not.toBeInTheDocument());
    expect(mockedPut).toHaveBeenCalledWith("/api/v1/network-security/ip-allowlist", { cidrs: ["198.51.100.7"] });
    expect(toasts()).toContainEqual({ type: "success", title: "Range removed", description: undefined });
  });

  it("removing all restrictions PUTs an empty list", async () => {
    mockedPut.mockResolvedValue(ok({ tenantId: "t-1", allowlist: [] }));
    await renderLoaded();

    fireEvent.click(screen.getByRole("button", { name: "Remove all restrictions" }));
    confirmIn(/Remove all IP restrictions/, "Remove all");

    expect(await screen.findByText(/sign-in is allowed from any IP/)).toBeInTheDocument();
    expect(mockedPut).toHaveBeenCalledWith("/api/v1/network-security/ip-allowlist", { cidrs: [] });
  });

  it("a refused write (403, not a super admin) says so and re-reads the server's list", async () => {
    mockedPut.mockRejectedValue(httpError(403, "Super admin access required"));
    await renderLoaded();
    const readsBefore = mockedGet.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "Remove 203.0.113.0/24" }));
    confirmIn(/Remove 203\.0\.113\.0\/24/, "Remove range");

    await waitFor(() =>
      expect(toasts()).toContainEqual({ type: "error", title: "Update failed", description: "Super admin access required" }),
    );
    await waitFor(() => expect(mockedGet.mock.calls.length).toBe(readsBefore + 2));
    expect(await screen.findByText("203.0.113.0/24")).toBeInTheDocument();
  });
});

describe("network security — every allowlist change is confirmed first (F-19)", () => {
  it("F-19: Add asks first, warns that the first range locks out everyone outside it, and Cancel sends nothing", async () => {
    mockedGet.mockImplementation(async (url: string) =>
      url.endsWith("/ip-allowlist") ? ok({ tenantId: "t-1", allowlist: [] }) : ok({ tenantId: "t-1", geofence: null }),
    );
    render(<NetworkSecurityPage />);
    await screen.findByText(/sign-in is allowed from any IP/);

    fireEvent.change(cidrInput(), { target: { value: "192.0.2.0/28" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    const dialog = screen.getByRole("dialog", { name: /Add 192\.0\.2\.0\/28/ });
    expect(within(dialog).getByText(/only this range may sign in.*locked out/)).toBeInTheDocument();
    expect(await axeViolations(dialog)).toEqual([]);

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockedPut).not.toHaveBeenCalled();
    expect(cidrInput()).toHaveValue("192.0.2.0/28");
  });

  it("F-19: removing a range asks first and warns it can lock out whoever signs in from it", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Remove 203.0.113.0/24" }));
    const dialog = screen.getByRole("dialog", { name: /Remove 203\.0\.113\.0\/24/ });
    expect(within(dialog).getByText(/including you/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(mockedPut).not.toHaveBeenCalled();
    expect(screen.getByText("203.0.113.0/24")).toBeInTheDocument();
  });

  it("F-19: removing the last range says it lifts the restriction", async () => {
    mockedGet.mockImplementation(async (url: string) =>
      url.endsWith("/ip-allowlist") ? ok({ tenantId: "t-1", allowlist: ["198.51.100.7"] }) : ok({ tenantId: "t-1", geofence: null }),
    );
    render(<NetworkSecurityPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Remove 198.51.100.7" }));
    expect(within(screen.getByRole("dialog")).getByText(/This is the last range/)).toBeInTheDocument();
  });

  it("F-19: Remove all asks first, naming how many ranges go, and Cancel keeps them", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Remove all restrictions" }));
    const dialog = screen.getByRole("dialog", { name: /Remove all IP restrictions/ });
    expect(within(dialog).getByText(/All 2 ranges are removed/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(mockedPut).not.toHaveBeenCalled();
  });

  it("F-19: adding to a list that is already enforced says the range is allowed as well", async () => {
    mockedPut.mockResolvedValue(ok({ tenantId: "t-1", allowlist: [] }));
    await renderLoaded();
    fireEvent.change(cidrInput(), { target: { value: "192.0.2.9" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(within(screen.getByRole("dialog")).getByText(/as well as the ones already listed/)).toBeInTheDocument();
  });
});

describe("network security — geofence", () => {
  it("saves the coordinates and radius", async () => {
    mockedPut.mockResolvedValue(ok({ tenantId: "t-1", geofence: { latitude: -7.25, longitude: 112.75, radiusKm: 10 } }));
    await renderLoaded();

    fireEvent.change(geoLat(), { target: { value: "-7.25" } });
    fireEvent.change(geoLng(), { target: { value: "112.75" } });
    fireEvent.change(screen.getByLabelText("Radius (km)"), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Geofence" }));

    await waitFor(() =>
      expect(toasts()).toContainEqual({ type: "success", title: "Geofence saved", description: undefined }),
    );
    expect(mockedPut).toHaveBeenCalledWith("/api/v1/network-security/geofence", {
      latitude: -7.25,
      longitude: 112.75,
      radiusKm: 10,
    });
  });

  it("omits an empty radius so the server applies its 50 km default, and shows it", async () => {
    geofence = null;
    mockedPut.mockResolvedValue(ok({ tenantId: "t-1", geofence: { latitude: 1, longitude: 2, radiusKm: 50 } }));
    render(<NetworkSecurityPage />);
    await screen.findByText("Not set");

    fireEvent.change(geoLat(), { target: { value: "1" } });
    fireEvent.change(geoLng(), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Geofence" }));

    expect(await screen.findByText("Configured")).toBeInTheDocument();
    expect(mockedPut).toHaveBeenCalledWith("/api/v1/network-security/geofence", { latitude: 1, longitude: 2 });
    expect(screen.getByLabelText("Radius (km)")).toHaveValue(50);
  });

  it("validates coordinates and radius before sending", async () => {
    geofence = null;
    render(<NetworkSecurityPage />);
    await screen.findByText("Not set");
    const save = screen.getByRole("button", { name: "Save Geofence" });

    fireEvent.click(save);
    expect(toasts()).toContainEqual({ type: "error", title: "Latitude and longitude are required", description: undefined });

    fireEvent.change(geoLat(), { target: { value: "91" } });
    fireEvent.change(geoLng(), { target: { value: "10" } });
    fireEvent.click(save);
    expect(toasts()).toContainEqual({ type: "error", title: "Coordinates are out of range", description: undefined });

    fireEvent.change(geoLat(), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("Radius (km)"), { target: { value: "-5" } });
    fireEvent.click(save);
    expect(toasts()).toContainEqual({ type: "error", title: "Radius must be a positive number", description: undefined });

    expect(mockedPut).not.toHaveBeenCalled();
  });

  it("a refused save says why", async () => {
    mockedPut.mockRejectedValue(httpError(400, '"latitude" must be less than or equal to 90'));
    await renderLoaded();

    fireEvent.click(screen.getByRole("button", { name: "Save Geofence" }));

    await waitFor(() =>
      expect(toasts()).toContainEqual({
        type: "error",
        title: "Save failed",
        description: '"latitude" must be less than or equal to 90',
      }),
    );
  });

  describe("Use My Location", () => {
    const original = Object.getOwnPropertyDescriptor(navigator, "geolocation");
    afterEach(() => {
      if (original) Object.defineProperty(navigator, "geolocation", original);
      else Reflect.deleteProperty(navigator, "geolocation");
    });

    const setGeolocation = (value: unknown) =>
      Object.defineProperty(navigator, "geolocation", { value, configurable: true });

    it("fills the anchor from the browser's position", async () => {
      setGeolocation({
        getCurrentPosition: (onOk: (p: { coords: { latitude: number; longitude: number } }) => void) =>
          onOk({ coords: { latitude: -8.65, longitude: 115.22 } }),
      });
      await renderLoaded();

      fireEvent.click(screen.getByRole("button", { name: "Use My Location" }));

      expect(geoLat()).toHaveValue(-8.65);
      expect(geoLng()).toHaveValue(115.22);
    });

    it("says when the position cannot be read, or geolocation is missing", async () => {
      setGeolocation({ getCurrentPosition: (_ok: unknown, onError: () => void) => onError() });
      await renderLoaded();
      fireEvent.click(screen.getByRole("button", { name: "Use My Location" }));
      expect(toasts()).toContainEqual({ type: "error", title: "Could not read your location", description: undefined });

      setGeolocation(undefined);
      fireEvent.click(screen.getByRole("button", { name: "Use My Location" }));
      expect(toasts()).toContainEqual({ type: "error", title: "Geolocation is unavailable", description: undefined });
    });
  });
});

describe("network security — geofence save sends this device's position (Q-38, ADR-100)", () => {
  const original = Object.getOwnPropertyDescriptor(navigator, "geolocation");
  afterEach(() => {
    if (original) Object.defineProperty(navigator, "geolocation", original);
    else Reflect.deleteProperty(navigator, "geolocation");
  });
  const setGeolocation = (value: unknown) =>
    Object.defineProperty(navigator, "geolocation", { value, configurable: true });

  it("asks the browser once and sends currentLocation with the save", async () => {
    const getCurrentPosition = jest.fn((onOk: (p: { coords: { latitude: number; longitude: number } }) => void) =>
      onOk({ coords: { latitude: -6.25, longitude: 106.85 } }),
    );
    setGeolocation({ getCurrentPosition });
    mockedPut.mockResolvedValue(ok({ tenantId: "t-1", geofence: { latitude: -6.2, longitude: 106.8, radiusKm: 30 } }));
    await renderLoaded();

    fireEvent.change(geoLat(), { target: { value: "-6.2" } });
    fireEvent.change(geoLng(), { target: { value: "106.8" } });
    fireEvent.change(screen.getByLabelText("Radius (km)"), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Geofence" }));

    await waitFor(() =>
      expect(toasts()).toContainEqual({ type: "success", title: "Geofence saved", description: undefined }),
    );
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(mockedPut).toHaveBeenCalledWith("/api/v1/network-security/geofence", {
      latitude: -6.2,
      longitude: 106.8,
      radiusKm: 30,
      currentLocation: { latitude: -6.25, longitude: 106.85 },
    });
  });

  it("a refused position is explained, the save is still sent, and the server's 409 is shown", async () => {
    setGeolocation({ getCurrentPosition: (_ok: unknown, onError: () => void) => onError() });
    mockedPut.mockRejectedValue(
      httpError(409, "Setting a geofence needs your device's current location (currentLocation: { latitude, longitude })"),
    );
    await renderLoaded();

    fireEvent.click(screen.getByRole("button", { name: "Save Geofence" }));

    await waitFor(() =>
      expect(toasts()).toContainEqual(
        expect.objectContaining({ type: "error", title: "Save failed", description: expect.stringContaining("current location") }),
      ),
    );
    expect(toasts()).toContainEqual(expect.objectContaining({ type: "info", title: "Your location was not shared" }));
    expect(mockedPut).toHaveBeenCalledWith("/api/v1/network-security/geofence", expect.not.objectContaining({ currentLocation: expect.anything() }));
  });
});

describe("network security — who sees the write controls (ADR-102, Q-38)", () => {
  const writeControls = () => [
    screen.queryByRole("button", { name: "Add" }),
    screen.queryByRole("button", { name: "Remove 203.0.113.0/24" }),
    screen.queryByRole("button", { name: "Remove all restrictions" }),
    screen.queryByRole("button", { name: "Save Geofence" }),
    screen.queryByRole("button", { name: "Use My Location" }),
    screen.queryByLabelText("IP range (CIDR)"),
  ];

  it("a reader sees the allowlist and the geofence, and no write control is in the DOM", async () => {
    grantPermissions({ "network-security": "read" });
    await renderLoaded();
    expect(writeControls()).toEqual([null, null, null, null, null, null]);
    expect(screen.getByText("Anchor -6.2, 106.816666 — radius 25 km.")).toBeInTheDocument();
    // The dry-run evaluation is a read.
    expect(screen.getByRole("button", { name: "Evaluate" })).toBeInTheDocument();
  });

  it("nothing is writable before the permissions load", async () => {
    clearPermissions();
    await renderLoaded();
    expect(writeControls()).toEqual([null, null, null, null, null, null]);
  });

  it("a tenant administrator with network-security write, and the super admin, get every control", async () => {
    const { unmount } = await renderLoaded();
    expect(writeControls().every((c) => c !== null)).toBe(true);
    unmount();

    grantSuperAdmin();
    await renderLoaded();
    expect(writeControls().every((c) => c !== null)).toBe(true);
  });

  it("a reader with no geofence configured is told so", async () => {
    grantPermissions({ "network-security": "read" });
    geofence = null;
    render(<NetworkSecurityPage />);
    expect(await screen.findByText("No geofence is configured.")).toBeInTheDocument();
  });

  it("an IPv6 range passes the first check and is confirmed like any other (F-19)", async () => {
    await renderLoaded();
    fireEvent.change(cidrInput(), { target: { value: "2001:db8::/32" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("network security — dry-run evaluation", () => {
  it("needs an IP", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Evaluate" }));

    expect(toasts()).toContainEqual({ type: "error", title: "Enter an IP address to test", description: undefined });
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it("a blocked sign-in shows both checks, the distance and step-up", async () => {
    mockedPost.mockResolvedValue(
      ok({
        allowed: false,
        ip: { allowed: false, ip: "192.0.2.9", allowlist },
        geofence: { allowed: false, distanceKm: 812.345, radiusKm: 25 },
        requiresStepUp: true,
      }),
    );
    const { container } = await renderLoaded();

    fireEvent.change(screen.getByLabelText(/IP address/), { target: { value: " 192.0.2.9 " } });
    fireEvent.change(screen.getAllByLabelText("Latitude")[1], { target: { value: "-7.8" } });
    fireEvent.change(screen.getAllByLabelText("Longitude")[1], { target: { value: "110.4" } });
    fireEvent.click(screen.getByRole("button", { name: "Evaluate" }));

    expect(await screen.findByText("Blocked")).toBeInTheDocument();
    expect(mockedPost).toHaveBeenCalledWith("/api/v1/network-security/evaluate-login", {
      ip: "192.0.2.9",
      latitude: -7.8,
      longitude: 110.4,
    });
    expect(screen.getByText("step-up required")).toBeInTheDocument();
    expect(screen.getByText("Fail")).toBeInTheDocument();
    expect(screen.getByText("Fail — 812.3 km from anchor, limit 25 km")).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("an allowed sign-in with no restrictions shows the reasons", async () => {
    mockedPost.mockResolvedValue(
      ok({
        allowed: true,
        ip: { allowed: true, reason: "no_restrictions" },
        geofence: { allowed: true, reason: "no_geofence" },
        requiresStepUp: false,
      }),
    );
    await renderLoaded();

    fireEvent.change(screen.getByLabelText(/IP address/), { target: { value: "192.0.2.9" } });
    fireEvent.click(screen.getByRole("button", { name: "Evaluate" }));

    expect(await screen.findByText("Allowed")).toBeInTheDocument();
    expect(mockedPost).toHaveBeenCalledWith("/api/v1/network-security/evaluate-login", { ip: "192.0.2.9" });
    expect(screen.getByText("Pass (no_restrictions)")).toBeInTheDocument();
    expect(screen.getByText("Pass (no_geofence)")).toBeInTheDocument();
    expect(screen.queryByText("step-up required")).not.toBeInTheDocument();
  });

  it("a failed evaluation (no connection) says so", async () => {
    mockedPost.mockRejectedValue(networkError());
    await renderLoaded();

    fireEvent.change(screen.getByLabelText(/IP address/), { target: { value: "192.0.2.9" } });
    fireEvent.click(screen.getByRole("button", { name: "Evaluate" }));

    await waitFor(() =>
      expect(toasts()).toContainEqual({ type: "error", title: "Evaluation failed", description: "Network Error" }),
    );
  });
});
