/** @jest-environment jsdom */
/**
 * API keys, against the backend contract (apiKey.controller.js / apiKey.service.js):
 *  - GET    /api/v1/api-keys      → rows in `data` (never the key or its hash), top-level `meta`
 *  - POST   /api/v1/api-keys      → 201, `data` carries the raw `key` ONCE; 400 on bad scopes
 *  - DELETE /api/v1/api-keys/:id  → `data: { id }`; 404 "API key not found"
 *
 * The raw key is shown once, with a warning, and can be copied; the list only
 * ever shows the display prefix. Real: the page, useApiKeys, the service.
 * Mocked: `@/api/client`'s transport, the layout, the clipboard.
 *
 * Fail-before: a failed list load showed the error AND "No API keys yet".
 */
import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { axeViolations } from "@/tests/a11y/axe";

jest.mock("@/components/layouts/DashboardLayout", () =>
  function DashboardLayout({ children }: { children: React.ReactNode }) {
    return <main>{children}</main>;
  },
);
jest.mock("@/api/client", () => ({
  ...jest.requireActual("@/api/client"),
  api: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));

import { api } from "@/api/client";
import ApiKeysPage from "../page";
import { useToastStore } from "@/stores/toastStore";
import { httpError, networkError } from "@/tests/support/httpErrors";

// Whole-page renders with axe: allow for a loaded machine (as calibration/devices page tests do).
jest.setTimeout(20000);

const mockedGet = api.get as jest.Mock;
const mockedPost = api.post as jest.Mock;
const mockedDelete = api.delete as jest.Mock;

const DAY = 24 * 60 * 60 * 1000;
const key = (over: Record<string, unknown> = {}) => ({
  id: "k1",
  tenantId: "t1",
  name: "CI Pipeline",
  keyPrefix: "cbk_1a2b",
  scopes: ["vendors:read"],
  lastUsedAt: null,
  expiresAt: null,
  isActive: true,
  createdBy: "u1",
  createdAt: "2026-09-01T00:00:00.000Z",
  ...over,
});
const list = (rows: unknown[], meta: Record<string, number> = {}) => ({
  success: true,
  status: 200,
  message: "API keys retrieved",
  data: rows,
  meta: { total: rows.length, page: 1, limit: 10, totalPages: 1, ...meta },
});
const RAW = "cbk_" + "f".repeat(56);

const toasts = () => useToastStore.getState().toasts;

beforeEach(() => {
  jest.clearAllMocks();
  useToastStore.setState({ toasts: [] });
});

describe("API keys page", () => {
  it("lists keys by prefix only, with status, scopes, last use and expiry", async () => {
    mockedGet.mockResolvedValue(
      list([
        key({ scopes: ["vendors:read", "equipment:read", "warehouse:write", "billing:read"], lastUsedAt: "2026-09-20T10:00:00.000Z" }),
        key({ id: "k2", name: "Old export", isActive: false }),
        key({ id: "k3", name: "Lapsed", expiresAt: new Date(Date.now() - DAY).toISOString() }),
      ]),
    );
    const { container } = render(<ApiKeysPage />);

    const active = (await screen.findByText("CI Pipeline")).closest("tr") as HTMLElement;
    expect(within(active).getByText("cbk_1a2b••••")).toBeInTheDocument();
    expect(within(active).getByText("Active")).toBeInTheDocument();
    expect(within(active).getByText("+1")).toBeInTheDocument();
    expect(within(active).getByRole("button", { name: /Revoke/ })).toBeInTheDocument();
    const revoked = screen.getByText("Old export").closest("tr") as HTMLElement;
    expect(within(revoked).getByText("Revoked")).toBeInTheDocument();
    expect(within(revoked).queryByRole("button", { name: /Revoke/ })).not.toBeInTheDocument();
    const expired = screen.getByText("Lapsed").closest("tr") as HTMLElement;
    expect(within(expired).getByText("Expired")).toBeInTheDocument();
    expect(within(expired).queryByRole("button", { name: /Revoke/ })).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("no keys: the empty state", async () => {
    mockedGet.mockResolvedValue(list([]));
    render(<ApiKeysPage />);

    expect(await screen.findByText("No API keys yet")).toBeInTheDocument();
  });

  it.each([
    ["403", () => httpError(403, "You do not have permission to read api keys")],
    ["network failure", () => networkError()],
  ])("a failed load (%s) shows the error, not the empty state", async (_l, make) => {
    const err = make();
    mockedGet.mockRejectedValue(err);
    const { container } = render(<ApiKeysPage />);

    expect(await screen.findByText(err.message)).toBeInTheDocument();
    expect(screen.queryByText("No API keys yet")).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("creates a key with named scopes and an expiry, reveals it once, and copies it", async () => {
    mockedGet.mockResolvedValue(list([]));
    mockedPost.mockResolvedValue({
      success: true,
      status: 201,
      message: "API key created — copy the key now, it will not be shown again",
      data: { ...key({ scopes: ["vendors:read", "vendors:write"] }), key: RAW },
    });
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<ApiKeysPage />);
    await screen.findByText("No API keys yet");

    fireEvent.click(screen.getByRole("button", { name: /Create API Key/ }));
    const dialog = await screen.findByRole("dialog", { name: "Create API Key" });
    fireEvent.change(within(dialog).getByLabelText(/Name/), { target: { value: "  CI Pipeline " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Scope resource" }));
    fireEvent.click(within(dialog).getByRole("option", { name: "Vendors" }));
    fireEvent.click(within(dialog).getByRole("button", { name: /Add scope/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: /Add scope/ })); // a duplicate is not added twice
    fireEvent.click(within(dialog).getByRole("button", { name: "Scope action" }));
    fireEvent.click(within(dialog).getByRole("option", { name: "Write (includes read)" }));
    fireEvent.click(within(dialog).getByRole("button", { name: /Add scope/ }));
    expect(within(dialog).getAllByRole("button", { name: /^Remove scope/ })).toHaveLength(2);
    fireEvent.change(within(dialog).getByLabelText(/Expires At/), { target: { value: "2027-01-31" } });
    expect(await axeViolations(dialog)).toEqual([]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Create API Key" }));

    const reveal = await screen.findByRole("dialog", { name: "API Key Created" });
    expect(mockedPost).toHaveBeenCalledWith("/api/v1/api-keys", {
      name: "CI Pipeline",
      scopes: ["vendors:read", "vendors:write"],
      expiresAt: new Date("2027-01-31").toISOString(),
    });
    expect(within(reveal).getByText(RAW)).toBeInTheDocument();
    expect(within(reveal).getByText(/shown only once/)).toBeInTheDocument();
    expect(await axeViolations(reveal)).toEqual([]);

    await act(async () => {
      fireEvent.click(within(reveal).getByRole("button", { name: /Copy/ }));
    });
    expect(writeText).toHaveBeenCalledWith(RAW);
    expect(toasts()).toEqual(expect.arrayContaining([expect.objectContaining({ title: "API key copied to clipboard" })]));

    // Closing refreshes the list, and the key is never shown again.
    const reads = mockedGet.mock.calls.length;
    fireEvent.click(within(reveal).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(mockedGet.mock.calls.length).toBe(reads + 1));
    expect(screen.queryByText(RAW)).not.toBeInTheDocument();
  });

  it("a key with no scopes is not sent", async () => {
    mockedGet.mockResolvedValue(list([]));
    render(<ApiKeysPage />);
    await screen.findByText("No API keys yet");

    fireEvent.click(screen.getByRole("button", { name: /Create API Key/ }));
    const dialog = await screen.findByRole("dialog", { name: "Create API Key" });
    fireEvent.change(within(dialog).getByLabelText(/Name/), { target: { value: "x" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create API Key" }));

    await waitFor(() => expect(toasts()).toEqual([expect.objectContaining({ type: "error", title: "Add at least one scope" })]));
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it("a scope the backend refuses (400) is reported, the form stays, and no key is revealed", async () => {
    mockedGet.mockResolvedValue(list([]));
    mockedPost.mockRejectedValue(httpError(400, 'Unknown scope resource: "stock"'));
    render(<ApiKeysPage />);
    await screen.findByText("No API keys yet");

    fireEvent.click(screen.getByRole("button", { name: /Create API Key/ }));
    const dialog = await screen.findByRole("dialog", { name: "Create API Key" });
    fireEvent.change(within(dialog).getByLabelText(/Name/), { target: { value: "x" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Add scope/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: /^Remove scope/ }));
    expect(within(dialog).getByText(/No scopes added yet/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Scope resource" }));
    fireEvent.click(within(dialog).getByRole("option", { name: "Stock" }));
    fireEvent.click(within(dialog).getByRole("button", { name: /Add scope/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Create API Key" }));

    await waitFor(() =>
      expect(toasts()).toEqual([expect.objectContaining({ type: "error", title: 'Unknown scope resource: "stock"' })]),
    );
    expect(screen.queryByRole("dialog", { name: "API Key Created" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Create API Key" })).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("a refused clipboard asks the user to copy by hand", async () => {
    mockedGet.mockResolvedValue(list([]));
    mockedPost.mockResolvedValue({ success: true, status: 201, message: "created", data: { ...key(), key: RAW } });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: jest.fn().mockRejectedValue(new Error("denied")) },
    });
    render(<ApiKeysPage />);
    await screen.findByText("No API keys yet");

    fireEvent.click(screen.getByRole("button", { name: /Create API Key/ }));
    const dialog = await screen.findByRole("dialog", { name: "Create API Key" });
    fireEvent.change(within(dialog).getByLabelText(/Name/), { target: { value: "x" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Add scope/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Create API Key" }));
    fireEvent.click(await screen.findByRole("button", { name: /Copy/ }));

    await waitFor(() =>
      expect(toasts()).toEqual(expect.arrayContaining([expect.objectContaining({ title: "Failed to copy — copy it manually" })])),
    );
  });

  it("revokes a key after confirmation and reloads the list", async () => {
    mockedGet.mockResolvedValue(list([key()]));
    mockedDelete.mockResolvedValue({ success: true, status: 200, message: "API key revoked", data: { id: "k1" } });
    render(<ApiKeysPage />);

    fireEvent.click(await screen.findByRole("button", { name: /Revoke/ }));
    const dialog = await screen.findByRole("dialog", { name: "Revoke API Key" });
    expect(within(dialog).getByText('Revoke "CI Pipeline"?')).toBeInTheDocument();
    expect(await axeViolations(dialog)).toEqual([]);

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Revoke/ }));
    const reads = mockedGet.mock.calls.length;
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Revoke Key" }));

    await waitFor(() => expect(mockedDelete).toHaveBeenCalledWith("/api/v1/api-keys/k1"));
    await waitFor(() => expect(mockedGet.mock.calls.length).toBe(reads + 1));
    expect(toasts()).toEqual(expect.arrayContaining([expect.objectContaining({ type: "success", title: "API key revoked" })]));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("revoking a key that is gone (404) is reported and the dialog stays", async () => {
    mockedGet.mockResolvedValue(list([key()]));
    mockedDelete.mockRejectedValue(httpError(404, "API key not found"));
    render(<ApiKeysPage />);

    fireEvent.click(await screen.findByRole("button", { name: /Revoke/ }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Revoke Key" }));

    await waitFor(() => expect(toasts()).toEqual([expect.objectContaining({ type: "error", title: "API key not found" })]));
    expect(screen.getByRole("dialog", { name: "Revoke API Key" })).toBeInTheDocument();
  });

  it("pages through keys", async () => {
    mockedGet.mockResolvedValue(list([key()], { total: 25, totalPages: 3 }));
    render(<ApiKeysPage />);
    await screen.findByText("CI Pipeline");

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));

    await waitFor(() =>
      expect(mockedGet).toHaveBeenLastCalledWith("/api/v1/api-keys", { params: { page: "2", limit: "10" } }),
    );
  });
});
