/** @jest-environment jsdom */
/**
 * A-29 / A-46 — the IoT ingest dialog on the devices page.
 *
 * Before A-29 there was no surface at all: no screen could issue a device's
 * ingest token or set its reading tolerance, so ingest answered 401 for every
 * device and anomaly detection could never run. The service calls are mocked
 * here; the backend contract they target is exercised end to end in
 * backend/src/tests/routes/iot.provisioning.a29.test.js.
 */
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { IotDeviceModal } from "../IotDeviceModal";
import { iotService, toleranceFromRows } from "@/api/services/iot.service";
import type { Device } from "@/api/services/device.service";

jest.mock("@/api/services/iot.service", () => {
  const actual = jest.requireActual("@/api/services/iot.service");
  return {
    ...actual,
    iotService: {
      getConfig: jest.fn(),
      updateConfig: jest.fn(),
      issueToken: jest.fn(),
      revokeToken: jest.fn(),
    },
  };
});

const mocked = iotService as jest.Mocked<typeof iotService>;

const device = { id: "dev-1", name: "Infusion pump", status: "active" } as Device;
const base = {
  deviceId: "dev-1",
  name: "Infusion pump",
  iotEnabled: false,
  readingTolerance: null,
  hasToken: false,
  tokenIssuedAt: null,
};

beforeEach(() => jest.clearAllMocks());

describe("A-29 — IotDeviceModal", () => {
  it("issues a token and shows it once; after close and reopen only 'a token was issued' remains", async () => {
    mocked.getConfig.mockResolvedValueOnce(base);
    mocked.issueToken.mockResolvedValueOnce({
      ...base,
      iotEnabled: true,
      hasToken: true,
      tokenIssuedAt: "2026-09-24T00:00:00Z",
      token: "iot_secret-shown-once",
      rotated: false,
    });

    const { unmount } = render(<IotDeviceModal device={device} onClose={jest.fn()} hasWriteAccess />);
    fireEvent.click(await screen.findByRole("button", { name: "Issue token" }));

    expect(await screen.findByTestId("iot-token")).toHaveTextContent("iot_secret-shown-once");
    expect(screen.getByText(/it will not be shown again/)).toBeInTheDocument();
    expect(mocked.issueToken).toHaveBeenCalledWith("dev-1");
    unmount();

    mocked.getConfig.mockResolvedValueOnce({ ...base, iotEnabled: true, hasToken: true, tokenIssuedAt: "2026-09-24T00:00:00Z" });
    render(<IotDeviceModal device={device} onClose={jest.fn()} hasWriteAccess />);
    expect(await screen.findByRole("button", { name: "Rotate token" })).toBeInTheDocument();
    expect(screen.queryByTestId("iot-token")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("iot_secret-shown-once");
  });

  it("revokes the token", async () => {
    mocked.getConfig.mockResolvedValueOnce({ ...base, iotEnabled: true, hasToken: true, tokenIssuedAt: "2026-09-24T00:00:00Z" });
    mocked.revokeToken.mockResolvedValueOnce(base);

    render(<IotDeviceModal device={device} onClose={jest.fn()} hasWriteAccess />);
    fireEvent.click(await screen.findByRole("button", { name: "Revoke token" }));

    expect(await screen.findByText("Token revoked; ingest is disabled.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Issue token" })).toBeInTheDocument();
  });

  it("A-46: saves the reading tolerance through the API", async () => {
    mocked.getConfig.mockResolvedValueOnce({ ...base, hasToken: true, iotEnabled: true });
    mocked.updateConfig.mockImplementation(async (id, update) => ({ ...base, ...update, hasToken: true }) as never);

    render(<IotDeviceModal device={device} onClose={jest.fn()} hasWriteAccess />);
    fireEvent.change(await screen.findByLabelText("Metric 1"), { target: { value: "temperature" } });
    fireEvent.change(screen.getByLabelText("Min 1"), { target: { value: "15" } });
    fireEvent.change(screen.getByLabelText("Max 1"), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "Save tolerance" }));

    await waitFor(() =>
      expect(mocked.updateConfig).toHaveBeenCalledWith("dev-1", {
        readingTolerance: { temperature: { min: 15, max: 30 } },
      }),
    );
    expect(await screen.findByText("Reading tolerance saved.")).toBeInTheDocument();
  });

  it("A-46: refuses min > max before calling the API", async () => {
    mocked.getConfig.mockResolvedValueOnce(base);

    render(<IotDeviceModal device={device} onClose={jest.fn()} hasWriteAccess />);
    fireEvent.change(await screen.findByLabelText("Metric 1"), { target: { value: "temperature" } });
    fireEvent.change(screen.getByLabelText("Min 1"), { target: { value: "40" } });
    fireEvent.change(screen.getByLabelText("Max 1"), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "Save tolerance" }));

    expect(await screen.findByText("temperature: min must not be greater than max")).toBeInTheDocument();
    expect(mocked.updateConfig).not.toHaveBeenCalled();
  });

  it("without write access it shows the state but no provisioning actions", async () => {
    mocked.getConfig.mockResolvedValueOnce(base);
    render(<IotDeviceModal device={device} onClose={jest.fn()} hasWriteAccess={false} />);
    expect(await screen.findByText(/No token has been issued/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Issue token" })).not.toBeInTheDocument();
  });

  it("shows the server's message when a call fails", async () => {
    mocked.getConfig.mockRejectedValueOnce(new Error("Calibration device not found"));
    render(<IotDeviceModal device={device} onClose={jest.fn()} hasWriteAccess />);
    expect(await screen.findByText("Calibration device not found")).toBeInTheDocument();
  });
});

describe("toleranceFromRows", () => {
  it("skips blank rows and omits blank bounds; an empty editor clears the tolerance", () => {
    expect(toleranceFromRows([{ metric: "", min: "", max: "" }])).toEqual({ tolerance: null, error: null });
    expect(toleranceFromRows([{ metric: "humidity", min: "", max: "70" }])).toEqual({
      tolerance: { humidity: { max: 70 } },
      error: null,
    });
  });

  it.each([
    [{ metric: "bad name!", min: "1", max: "" }, /not a valid metric name/],
    [{ metric: "t", min: "", max: "" }, /give a min, a max, or both/],
    [{ metric: "t", min: "hot", max: "" }, /min must be a number/],
  ])("refuses %j", (row, message) => {
    expect(toleranceFromRows([row]).error).toMatch(message);
  });
});
