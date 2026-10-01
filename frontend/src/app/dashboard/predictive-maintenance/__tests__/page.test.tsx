/** @jest-environment jsdom */
/**
 * Predictive maintenance page against the backend contract
 * (backend/src/routes/api/predictiveMaintenance.route.js, mounted
 * /api/v1/predictive-maintenance; controllers/predictiveMaintenance.controller.js):
 *  - GET  /recommendations → device rows in `data` ({ id, name, serialNumber,
 *    calibrationIntervalDays, recommendedCalibrationInterval, recommendationReason });
 *  - POST /analyze/:deviceId → data { status: analyzed|skipped|unchanged, … }
 *    (404 for a device without IoT, 400 with no baseline interval);
 *  - POST /recommendations/:deviceId/approve.
 *  - the device picker reads GET /api/v1/calibration-devices.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { axeViolations } from "@/tests/a11y/axe";
import { httpError } from "@/tests/support/httpError";

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
import PredictiveMaintenancePage from "../page";
import { grantPermissions, grantSuperAdmin, clearPermissions } from "@/tests/support/permissions";

const mockedGet = api.get as jest.Mock;
const mockedPost = api.post as jest.Mock;

const ok = (data: unknown, message = "ok", meta?: unknown) => ({
  success: true,
  status: 200,
  message,
  data,
  ...(meta ? { meta } : {}),
});

let recommendations: unknown[];

const backend = () => {
  mockedGet.mockImplementation(async (url: string) => {
    if (url === "/api/v1/calibration-devices") {
      return ok(
        [
          { id: "dev-1", name: "Infusion Pump", serialNumber: "IP-7" },
          { id: "dev-2", name: "Thermometer" },
        ],
        "ok",
        { total: 2, page: 1, limit: 100, totalPages: 1 },
      );
    }
    if (url === "/api/v1/predictive-maintenance/recommendations") return ok(recommendations, "Recommendations retrieved");
    throw httpError(404, "Not found");
  });
};

const toasts = () => useToastStore.getState().toasts.map((t) => ({ type: t.type, title: t.title, description: t.description }));

beforeEach(() => {
  // ADR-102: write controls follow the effective permissions.
  grantPermissions({ calibration: "write" });
  jest.clearAllMocks();
  useToastStore.setState({ toasts: [] });
  recommendations = [
    {
      id: "dev-1",
      name: "Infusion Pump",
      serialNumber: "IP-7",
      calibrationIntervalDays: 365,
      recommendedCalibrationInterval: 180,
      recommendationReason: "Anomaly rate 12% over 30 days",
    },
    {
      id: "dev-3",
      name: "Scale",
      serialNumber: null,
      calibrationIntervalDays: 180,
      recommendedCalibrationInterval: 270,
      recommendationReason: null,
    },
  ];
  backend();
});

const renderLoaded = async () => {
  const view = render(<PredictiveMaintenancePage />);
  await screen.findByText("Infusion Pump");
  return view;
};

const pickDevice = (label: string) => {
  fireEvent.click(screen.getByRole("button", { name: /^Analyze a device/ }));
  fireEvent.click(screen.getByRole("option", { name: label }));
};

describe("predictive maintenance — recommendations", () => {
  it("lists each pending recommendation against the current interval", async () => {
    const { container } = await renderLoaded();

    const pump = screen.getByText("Infusion Pump").closest("tr") as HTMLElement;
    expect(within(pump).getByText("365 days")).toBeInTheDocument();
    // Shorter than now: calibrate more often — flagged.
    expect(within(pump).getByText("180 days")).toHaveClass("text-warning");
    expect(within(pump).getByText("Anomaly rate 12% over 30 days")).toBeInTheDocument();

    const scale = screen.getByText("Scale").closest("tr") as HTMLElement;
    expect(within(scale).getByText("270 days")).toHaveClass("text-success");
    expect(within(scale).getAllByText("—")).toHaveLength(2);
    expect(await axeViolations(container)).toEqual([]);
  });

  it("none pending is the empty state", async () => {
    recommendations = [];
    render(<PredictiveMaintenancePage />);

    expect(await screen.findByText("No pending recommendations. Run an analysis to generate one.")).toBeInTheDocument();
  });

  it("a failed read shows the error, not the empty state", async () => {
    mockedGet.mockImplementation(async (url: string) => {
      if (url.includes("recommendations")) throw httpError(403, "You do not have permission to read predictive maintenance");
      return ok([]);
    });
    const { container } = render(<PredictiveMaintenancePage />);

    expect(await screen.findByText("You do not have permission to read predictive maintenance")).toBeInTheDocument();
    expect(screen.getByText("Recommendations could not be loaded.")).toBeInTheDocument();
    expect(screen.queryByText(/No pending recommendations/)).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("Refresh reads them again", async () => {
    await renderLoaded();
    const before = mockedGet.mock.calls.length;

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    });

    expect(mockedGet.mock.calls.length).toBe(before + 1);
  });

  it("approving POSTs for that device and reloads", async () => {
    mockedPost.mockImplementation(async () => {
      recommendations = recommendations.slice(1);
      return ok({ deviceId: "dev-1", calibrationIntervalDays: 180 }, "Recommendation applied successfully");
    });
    await renderLoaded();

    await act(async () => {
      fireEvent.click(within(screen.getByText("Infusion Pump").closest("tr") as HTMLElement).getByRole("button", { name: "Approve" }));
    });

    expect(mockedPost).toHaveBeenCalledWith("/api/v1/predictive-maintenance/recommendations/dev-1/approve");
    await waitFor(() => expect(screen.queryByText("Infusion Pump", { selector: "td" })).not.toBeInTheDocument());
    expect(toasts()).toContainEqual({
      type: "success",
      title: "Recommendation applied",
      description: "The device's calibration interval has been updated.",
    });
  });

  it("a refused approval (404) says why", async () => {
    mockedPost.mockRejectedValue(httpError(404, "Device not found"));
    await renderLoaded();

    await act(async () => {
      fireEvent.click(within(screen.getByText("Scale").closest("tr") as HTMLElement).getByRole("button", { name: "Approve" }));
    });

    expect(toasts()).toContainEqual({ type: "error", title: "Approval failed", description: "Device not found" });
  });
});

describe("predictive maintenance — analysis", () => {
  it("needs a device", async () => {
    await renderLoaded();

    fireEvent.click(screen.getByRole("button", { name: "Run Analysis" }));

    expect(toasts()).toContainEqual({ type: "error", title: "Select a device to analyze", description: undefined });
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it.each([
    [
      { status: "analyzed", recommendedCalibrationInterval: 120, recommendationReason: "Anomaly rate 20%" },
      { type: "success", title: "Recommendation generated", description: "Anomaly rate 20%" },
    ],
    [
      { status: "skipped" },
      {
        type: "info",
        title: "Not enough data",
        description: "At least 10 IoT readings in the last 30 days are required to analyze this device.",
      },
    ],
    [
      { status: "unchanged" },
      { type: "info", title: "Interval already optimal", description: "No change to the calibration interval is recommended." },
    ],
  ])("an analysis answering %o is reported", async (answer, expected) => {
    mockedPost.mockResolvedValue(ok({ deviceId: "dev-1", ...answer }, "Analysis complete"));
    const { container } = await renderLoaded();
    pickDevice("Infusion Pump (IP-7)");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Run Analysis" }));
    });

    expect(mockedPost).toHaveBeenCalledWith("/api/v1/predictive-maintenance/analyze/dev-1");
    expect(toasts()).toContainEqual(expected);
    expect(await axeViolations(container)).toEqual([]);
  });

  it("a device with no baseline interval (400) is explained", async () => {
    mockedPost.mockRejectedValue(httpError(400, "Device has no baseline calibration interval to optimize"));
    await renderLoaded();
    pickDevice("Thermometer");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Run Analysis" }));
    });

    expect(mockedPost).toHaveBeenCalledWith("/api/v1/predictive-maintenance/analyze/dev-2");
    expect(toasts()).toContainEqual({
      type: "error",
      title: "Analysis failed",
      description: "Device has no baseline calibration interval to optimize",
    });
  });
});

/**
 * ADR-102 — predictive maintenance writes are gated on `calibration` write. HEALTHCARE ADMIN and ENGINEERING MANAGER hold it read (audit 01 §4.2: "Approve shown to read-only roles").
 * Before the permissions load nothing is writable; the super admin writes.
 * Fail-before: Run Analysis and Approve rendered for every role.
 */
describe("ADR-102 — predictive maintenance write controls follow the effective permission", () => {
  const writeControls = [
      /Run Analysis/,
      /Approve/,
  ];

  it("a reader gets none of the write controls", async () => {
    grantPermissions({ "calibration": "read" });
    render(<PredictiveMaintenancePage />);
    await screen.findByText("Infusion Pump");
    for (const name of writeControls) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });

  it("nothing is writable before the permissions load", async () => {
    clearPermissions();
    render(<PredictiveMaintenancePage />);
    await screen.findByText("Infusion Pump");
    for (const name of writeControls) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });

  it("the super admin gets them", async () => {
    grantSuperAdmin();
    render(<PredictiveMaintenancePage />);
    await screen.findByText("Infusion Pump");
    expect(screen.getAllByRole("button", { name: /Run Analysis/ }).length).toBeGreaterThan(0);
  });
});
