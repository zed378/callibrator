/** @jest-environment jsdom */
/**
 * F-18 — the webhook screen shows the signing secret the backend generates.
 *
 * Fixtures mirror backend/src/services/webhook.service.js exactly:
 * `publicWebhook()` returns { id, tenantId, url, events, description,
 * isActive, createdBy, createdAt }; create / rotateSecret / a url-changing
 * update spread `secret` onto it; the controller wraps it with `success()`
 * as { success, status, message, data } (no `meta` for single rows), and the
 * list puts rows in `data` with `meta` as a top-level sibling.
 */
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

jest.mock("@/components/layouts/DashboardLayout", () => {
  return function DashboardLayout({ children }: { children: React.ReactNode }) {
    return <div data-testid="dashboard-layout">{children}</div>;
  };
});

jest.mock("@/api/client", () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  },
}));

import { api } from "@/api/client";
import WebhooksPage from "../page";

const mockedApi = api as jest.Mocked<typeof api>;

const TENANT = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const HOOK_ID = "33333333-3333-4333-8333-333333333333";
// generateSecret() is crypto.randomBytes(32).toString("hex") — 64 hex chars.
const SECRET_A = "a".repeat(64);
const SECRET_B = "b".repeat(32) + "c".repeat(32);

const publicWebhook = (overrides: Record<string, unknown> = {}) => ({
  id: HOOK_ID,
  tenantId: TENANT,
  url: "https://receiver.example.com/hook",
  events: ["device.overdue"],
  description: null,
  isActive: true,
  createdBy: USER,
  createdAt: "2026-09-24T08:00:00.000Z",
  ...overrides,
});

const single = (data: unknown, message: string, status = 200) => ({
  success: true,
  status,
  message,
  data,
});

const list = (rows: unknown[]) => ({
  success: true,
  status: 200,
  message: "Webhooks retrieved",
  data: rows,
  meta: { total: rows.length, page: 1, limit: 10, totalPages: 1 },
});

const writeText = jest.fn().mockResolvedValue(undefined);

beforeAll(() => {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
});

beforeEach(() => {
  jest.clearAllMocks();
  mockedApi.get.mockResolvedValue(list([publicWebhook()]));
});

const renderLoaded = async () => {
  render(<WebhooksPage />);
  await screen.findByText("https://receiver.example.com/hook");
};

describe("WebhooksPage — signing secret (F-18)", () => {
  it("create: sends no secret, then shows the returned secret once with copy and a not-again warning", async () => {
    mockedApi.get.mockResolvedValueOnce(list([]));
    mockedApi.post.mockResolvedValueOnce(
      single(
        { ...publicWebhook({ url: "https://new.example.com/hook" }), secret: SECRET_A },
        "Webhook created",
        201,
      ),
    );
    render(<WebhooksPage />);
    await screen.findByText("No webhooks yet");

    fireEvent.click(screen.getByRole("button", { name: /add webhook/i }));
    fireEvent.change(
      screen.getByPlaceholderText("https://example.com/webhooks/calibrator"),
      { target: { value: "https://new.example.com/hook" } },
    );
    fireEvent.click(screen.getByText("device.overdue"));
    fireEvent.click(screen.getByRole("button", { name: /create webhook/i }));

    await screen.findByText("Webhook Created");
    expect(mockedApi.post).toHaveBeenCalledTimes(1);
    const [path, body] = mockedApi.post.mock.calls[0];
    expect(path).toBe("/api/v1/webhooks");
    expect(body).not.toHaveProperty("secret");
    expect(body).toEqual({
      url: "https://new.example.com/hook",
      events: ["device.overdue"],
    });

    expect(screen.getByTestId("webhook-signing-secret")).toHaveTextContent(SECRET_A);
    expect(screen.getByText("You will not see this secret again")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /copy signing secret/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(SECRET_A));

    const getsBeforeClose = mockedApi.get.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: /i have stored the secret/i }));
    expect(screen.queryByTestId("webhook-signing-secret")).not.toBeInTheDocument();
    expect(screen.queryByText(SECRET_A)).not.toBeInTheDocument();
    await waitFor(() =>
      expect(mockedApi.get.mock.calls.length).toBeGreaterThan(getsBeforeClose),
    );
  });

  it("rotate: asks for confirmation, and cancelling rotates nothing", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: /rotate signing secret/i }));

    expect(screen.getByText("Rotate signing secret?")).toBeInTheDocument();
    expect(screen.getByText(/stops working\s+immediately/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(screen.queryByText("Rotate signing secret?")).not.toBeInTheDocument();
    expect(mockedApi.post).not.toHaveBeenCalled();
  });

  it("rotate: on confirm POSTs /rotate-secret and shows the new secret once", async () => {
    mockedApi.post.mockResolvedValueOnce(
      single({ ...publicWebhook(), secret: SECRET_B }, "Webhook secret rotated"),
    );
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: /rotate signing secret/i }));
    fireEvent.click(screen.getByRole("button", { name: /rotate secret/i }));

    await screen.findByText("Signing Secret Rotated");
    expect(mockedApi.post).toHaveBeenCalledWith(
      `/api/v1/webhooks/${HOOK_ID}/rotate-secret`,
      {},
    );
    expect(screen.getByTestId("webhook-signing-secret")).toHaveTextContent(SECRET_B);
    expect(screen.getByText("You will not see this secret again")).toBeInTheDocument();
    expect(screen.queryByText("Rotate signing secret?")).not.toBeInTheDocument();
  });

  it("edit with a url change: warns before saving, sends no secret, and shows the rotated secret", async () => {
    mockedApi.patch.mockResolvedValueOnce(
      single(
        { ...publicWebhook({ url: "https://moved.example.com/hook" }), secret: SECRET_B },
        "Webhook updated",
      ),
    );
    await renderLoaded();
    fireEvent.click(screen.getByTitle("Edit webhook"));

    const urlInput = screen.getByPlaceholderText("https://example.com/webhooks/calibrator");
    expect(
      screen.queryByText("Changing the URL issues a new signing secret"),
    ).not.toBeInTheDocument();
    fireEvent.change(urlInput, { target: { value: "https://moved.example.com/hook" } });
    expect(
      screen.getByText("Changing the URL issues a new signing secret"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    const dialogTitle = await screen.findByText("New Signing Secret Issued");
    const [path, body] = mockedApi.patch.mock.calls[0];
    expect(path).toBe(`/api/v1/webhooks/${HOOK_ID}`);
    expect(body).not.toHaveProperty("secret");
    expect(body).toMatchObject({ url: "https://moved.example.com/hook" });
    expect(screen.getByTestId("webhook-signing-secret")).toHaveTextContent(SECRET_B);
    const dialog = dialogTitle.closest("div.bg-card") as HTMLElement;
    expect(within(dialog).getByText("https://moved.example.com/hook")).toBeInTheDocument();
  });

  it("edit without a url change: the response has no secret and nothing is revealed", async () => {
    mockedApi.patch.mockResolvedValueOnce(
      single(publicWebhook({ description: "CMMS" }), "Webhook updated"),
    );
    await renderLoaded();
    fireEvent.click(screen.getByTitle("Edit webhook"));
    fireEvent.change(
      screen.getByPlaceholderText("e.g. Notify CMMS when devices become overdue"),
      { target: { value: "CMMS" } },
    );
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(mockedApi.patch).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /save changes/i })).not.toBeInTheDocument(),
    );
    expect(screen.queryByTestId("webhook-signing-secret")).not.toBeInTheDocument();
    expect(screen.queryByText(/signing secret issued/i)).not.toBeInTheDocument();
  });
});
