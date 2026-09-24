// F-02 — the System Health panel must reflect GET /api/v1/health, not assert
// health it has not measured.
//
// The response bodies below are the shape built by
// backend/src/controllers/health.controller.js#readinessDetail over
// backend/src/services/health.service.js#buildReport: 200 when every required
// dependency is healthy, 503 (WITH the breakdown in `data`) when one is not,
// 403 for anyone who is not a super admin.

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import apiClient from "@/api/client";
import { DashboardSystemHealth } from "./DashboardSystemHealth";

jest.mock("@/api/client", () => {
  const get = jest.fn();
  return { __esModule: true, default: { get }, api: { get } };
});

const getMock = apiClient.get as unknown as jest.Mock;

const envelope = (
  statusCode: number,
  data: unknown,
): { status: number; data: unknown } => ({
  status: statusCode,
  data: {
    success: statusCode === 200,
    status: statusCode,
    message:
      statusCode === 200
        ? "All required dependencies are healthy"
        : "One or more required dependencies are unhealthy",
    data,
  },
});

const postgresDown = {
  status: "unhealthy",
  checkedAt: "2026-09-24T08:15:00.000Z",
  dependencies: [
    {
      name: "postgres",
      required: true,
      status: "unhealthy",
      latencyMs: 2001,
      error: "PostgreSQL probe timed out after 2000ms",
    },
    { name: "redis", required: true, status: "healthy", latencyMs: 4 },
    { name: "rabbitmq", required: true, status: "healthy", latencyMs: 17 },
    {
      name: "mqtt",
      required: false,
      status: "not configured",
      detail: "MQTT_HOST and MQTT_PORT are not both set",
    },
    {
      name: "clamav",
      required: false,
      status: "unknown",
      detail: "enabled; this process has no reachability probe for ClamAV",
    },
  ],
};

const allHealthy = {
  status: "healthy",
  checkedAt: "2026-09-24T08:15:00.000Z",
  dependencies: [
    { name: "postgres", required: true, status: "healthy", latencyMs: 3 },
    { name: "redis", required: true, status: "healthy", latencyMs: 1 },
    { name: "rabbitmq", required: true, status: "healthy", latencyMs: 12 },
  ],
};

const httpError = (statusCode: number) =>
  Object.assign(new Error(`Request failed with status code ${statusCode}`), {
    isAxiosError: true,
    response: { status: statusCode, data: { success: false } },
  });

describe("DashboardSystemHealth (F-02)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("F-02: a failing required dependency (503) turns its indicator and the verdict red", async () => {
    getMock.mockResolvedValueOnce(envelope(503, postgresDown));

    render(<DashboardSystemHealth isSuperAdmin />);

    const postgres = await screen.findByTestId("health-dependency-postgres");
    expect(postgres).toHaveAttribute("data-status", "unhealthy");
    expect(postgres).toHaveTextContent("Down");
    expect(postgres).toHaveTextContent(
      "PostgreSQL probe timed out after 2000ms",
    );

    expect(screen.getByTestId("health-verdict")).toHaveAttribute(
      "data-status",
      "unhealthy",
    );
    expect(screen.queryByText(/All Systems Go/i)).not.toBeInTheDocument();

    // The healthy ones still say so, with the MEASURED latency.
    expect(screen.getByTestId("health-dependency-redis")).toHaveAttribute(
      "data-status",
      "healthy",
    );
    expect(screen.getByTestId("health-dependency-redis")).toHaveTextContent(
      "4 ms",
    );
  });

  it("F-02: optional dependencies that are off or unprobed are neutral, never green", async () => {
    getMock.mockResolvedValueOnce(envelope(503, postgresDown));

    render(<DashboardSystemHealth isSuperAdmin />);

    const mqtt = await screen.findByTestId("health-dependency-mqtt");
    expect(mqtt).toHaveAttribute("data-status", "not configured");
    expect(mqtt).not.toHaveTextContent("Operational");

    const clamav = screen.getByTestId("health-dependency-clamav");
    expect(clamav).toHaveAttribute("data-status", "unknown");
    expect(clamav).not.toHaveTextContent("Operational");
  });

  it("F-02: renders exactly what a healthy response says, and nothing invented", async () => {
    getMock.mockResolvedValueOnce(envelope(200, allHealthy));

    render(<DashboardSystemHealth isSuperAdmin />);

    const postgres = await screen.findByTestId("health-dependency-postgres");
    expect(postgres).toHaveAttribute("data-status", "healthy");
    expect(postgres).toHaveTextContent("3 ms");
    expect(screen.getByTestId("health-verdict")).toHaveAttribute(
      "data-status",
      "healthy",
    );
    expect(getMock).toHaveBeenCalledWith(
      "/api/v1/health",
      expect.objectContaining({ validateStatus: expect.any(Function) }),
    );

    // None of the old fabricated figures survive.
    expect(screen.queryByText(/99\.9% uptime/)).not.toBeInTheDocument();
    expect(screen.queryByText(/2ms/)).not.toBeInTheDocument();
    expect(screen.queryByText(/messages pending/)).not.toBeInTheDocument();
    expect(screen.queryByText(/API Server/)).not.toBeInTheDocument();
  });

  it("F-02: a non-super-admin sees no panel and no request is made", () => {
    const { container } = render(<DashboardSystemHealth isSuperAdmin={false} />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(/Operational/)).not.toBeInTheDocument();
    expect(getMock).not.toHaveBeenCalled();
  });

  it("F-02: a 403 from the backend removes the panel instead of showing green", async () => {
    getMock.mockRejectedValueOnce(httpError(403));

    const { container } = render(<DashboardSystemHealth isSuperAdmin />);

    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(screen.queryByText(/Operational/)).not.toBeInTheDocument();
  });

  it("F-02: a failed request shows 'could not load', not a status", async () => {
    getMock.mockRejectedValueOnce(new Error("Network Error"));

    render(<DashboardSystemHealth isSuperAdmin />);

    expect(await screen.findByText(/could not load/i)).toBeInTheDocument();
    expect(screen.getByTestId("health-verdict")).toHaveAttribute(
      "data-status",
      "unknown",
    );
    expect(screen.queryByText(/Operational/)).not.toBeInTheDocument();
    expect(screen.queryByText(/All Systems Go/i)).not.toBeInTheDocument();
  });

  it("F-02: a response without a breakdown is treated as not loaded", async () => {
    getMock.mockResolvedValueOnce({ status: 200, data: { success: true } });

    render(<DashboardSystemHealth isSuperAdmin />);

    expect(await screen.findByText(/could not load/i)).toBeInTheDocument();
    expect(screen.queryByText(/Operational/)).not.toBeInTheDocument();
  });

  it("F-02: shows a loading state, not a verdict, before the response arrives", () => {
    getMock.mockReturnValueOnce(new Promise(() => undefined));

    render(<DashboardSystemHealth isSuperAdmin />);

    expect(screen.getByTestId("health-verdict")).toHaveAttribute(
      "data-status",
      "loading",
    );
    expect(screen.queryByText(/Operational/)).not.toBeInTheDocument();
  });

  it("F-02: re-check asks the backend again and shows the new answer", async () => {
    getMock
      .mockResolvedValueOnce(envelope(503, postgresDown))
      .mockResolvedValueOnce(envelope(200, allHealthy));

    render(<DashboardSystemHealth isSuperAdmin />);
    await screen.findByTestId("health-dependency-postgres");
    expect(screen.getByTestId("health-verdict")).toHaveAttribute(
      "data-status",
      "unhealthy",
    );

    fireEvent.click(screen.getByRole("button", { name: /re-check/i }));

    await waitFor(() =>
      expect(screen.getByTestId("health-verdict")).toHaveAttribute(
        "data-status",
        "healthy",
      ),
    );
    expect(getMock).toHaveBeenCalledTimes(2);
  });
});
