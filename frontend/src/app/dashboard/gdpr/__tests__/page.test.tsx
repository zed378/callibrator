/** @jest-environment jsdom */
/**
 * The GDPR data-subject page against the backend contract
 * (backend/src/routes/api/gdpr.route.js, controllers/gdpr.controller.js,
 * services/gdpr.service.js):
 *  - GET  /api/v1/gdpr/consent/history → ConsentRecord rows in `data`
 *    ({ purpose, status: "granted" | "withdrawn", ipAddress, consentedAt, … });
 *  - GET  /api/v1/gdpr/processing      → the Article 30 document in `data`
 *    (activities carry `legalBasis` / `dataCategories`);
 *  - PUT  /consent { categories, consent }, POST /erasure { reason, confirm },
 *    PUT /rectify { field, value, currentPassword?, code? },
 *    POST /restrict { reason }, POST /export.
 * `@/api/client` is mocked; the real gdpr.service runs.
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

const mockAuthState: { user: { id: string; mfaEnabled: boolean } | null } = {
  user: { id: "u-1", mfaEnabled: false },
};
jest.mock("@/stores/authStore", () => ({
  useAuthStore: (selector: (s: typeof mockAuthState) => unknown) => selector(mockAuthState),
}));

import { api } from "@/api/client";
import { useToastStore } from "@/stores/toastStore";
import GdprPage from "../page";

const mockedGet = api.get as jest.Mock;
const mockedPost = api.post as jest.Mock;
const mockedPut = api.put as jest.Mock;

const ok = (data: unknown, message = "ok", status = 200) => ({ success: true, status, message, data });

/** A ConsentRecord row as consentRecord.model.ts serialises it. */
const consentRow = (purpose: string, status: "granted" | "withdrawn", ip = "10.0.0.7") => ({
  id: `c-${purpose}`,
  tenantId: "t-1",
  userId: "u-1",
  purpose,
  version: "1.0",
  ipAddress: ip,
  status,
  consentedAt: "2026-09-20T08:00:00.000Z",
  withdrawnAt: status === "withdrawn" ? "2026-09-21T08:00:00.000Z" : null,
  createdAt: "2026-09-20T08:00:00.000Z",
  updatedAt: "2026-09-21T08:00:00.000Z",
});

/** gdpr.service.getProcessingActivities, verbatim in shape. */
const processing = {
  controller: "Hospital Device Calibration Platform",
  tenantId: "t-1",
  subjectId: "u-1",
  generatedAt: "2026-09-29T09:00:00.000Z",
  activities: [
    {
      purpose: "Account & authentication",
      legalBasis: "Contract",
      dataCategories: ["identity", "credentials"],
      retention: "Life of the account",
    },
    {
      purpose: "Audit trail",
      legalBasis: "Legal obligation (FDA 21 CFR Part 11)",
      dataCategories: ["actor", "action"],
      retention: "At least the lifetime of the underlying record",
    },
  ],
};

let history: unknown[] = [];

const backend = () => {
  mockedGet.mockImplementation(async (url: string) => {
    if (url === "/api/v1/gdpr/consent/history") return ok(history, "Consent history retrieved");
    if (url === "/api/v1/gdpr/processing") return ok(processing, "Processing activities retrieved");
    throw httpError(404, "Not found");
  });
};

const toasts = () => useToastStore.getState().toasts.map((t) => ({ type: t.type, title: t.title, description: t.description }));

beforeEach(() => {
  jest.clearAllMocks();
  useToastStore.setState({ toasts: [] });
  mockAuthState.user = { id: "u-1", mfaEnabled: false };
  history = [consentRow("analytics", "granted"), consentRow("marketing", "withdrawn", "10.0.0.8")];
  backend();
});

const renderLoaded = async () => {
  const view = render(<GdprPage />);
  await screen.findByText("Hospital Device Calibration Platform");
  return view;
};

describe("GDPR page — reading", () => {
  it("shows each consent decision by its purpose and status, and the Art. 30 record", async () => {
    const { container } = await renderLoaded();

    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row");
    expect(within(rows[1]).getByText("analytics")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Granted")).toBeInTheDocument();
    expect(within(rows[1]).getByText("10.0.0.7")).toBeInTheDocument();
    expect(within(rows[2]).getByText("marketing")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Withdrawn")).toBeInTheDocument();

    // legalBasis / dataCategories are normalised by the service.
    expect(screen.getByText("Account & authentication")).toBeInTheDocument();
    expect(screen.getByText(/Basis: Contract · Retention: Life of the account/)).toBeInTheDocument();
    expect(screen.getByText("credentials")).toBeInTheDocument();

    expect(await axeViolations(container)).toEqual([]);
  });

  it("says it is loading until the reads answer", async () => {
    mockedGet.mockImplementation(() => new Promise(() => undefined));
    const { container } = render(<GdprPage />);

    expect(await screen.findByText("Loading…")).toBeInTheDocument();
    expect(screen.queryByText("No consent decisions recorded.")).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("an empty history is the empty state", async () => {
    history = [];
    await renderLoaded();

    expect(screen.getByText("No consent decisions recorded.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("a failed history read shows the error, never the empty state", async () => {
    mockedGet.mockImplementation(async (url: string) => {
      if (url === "/api/v1/gdpr/consent/history") throw httpError(500, "Failed to read consent history");
      return ok(processing);
    });
    const { container } = render(<GdprPage />);

    expect(await screen.findByText("Failed to read consent history")).toBeInTheDocument();
    expect(screen.getByText("Consent history could not be loaded.")).toBeInTheDocument();
    expect(screen.queryByText("No consent decisions recorded.")).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("a failed processing read leaves the history and says no record is available", async () => {
    mockedGet.mockImplementation(async (url: string) => {
      if (url === "/api/v1/gdpr/processing") throw httpError(403, "Forbidden");
      return ok(history);
    });
    render(<GdprPage />);

    expect(await screen.findByText("No processing record available.")).toBeInTheDocument();
    expect(within(screen.getByRole("table")).getByText("analytics")).toBeInTheDocument();
    expect(screen.queryByText("Forbidden")).not.toBeInTheDocument();
  });
});

describe("GDPR page — consent", () => {
  it("grants the selected categories in one PUT and reloads the history", async () => {
    mockedPut.mockResolvedValue(ok({ updated: 2, consent: true, categories: ["functional", "marketing"] }));
    await renderLoaded();

    const grant = screen.getByRole("button", { name: "Grant" });
    expect(grant).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "functional" }));
    fireEvent.click(screen.getByRole("button", { name: "marketing" }));
    fireEvent.click(screen.getByRole("button", { name: "necessary" }));
    fireEvent.click(screen.getByRole("button", { name: "necessary" })); // unselected again
    expect(grant).toBeEnabled();

    history = [consentRow("functional", "granted"), ...history];
    fireEvent.click(grant);

    await waitFor(() =>
      expect(mockedPut).toHaveBeenCalledWith("/api/v1/gdpr/consent", {
        categories: ["functional", "marketing"],
        consent: true,
      }),
    );
    expect(await screen.findByText("functional", { selector: "span" })).toBeInTheDocument();
    expect(toasts()).toContainEqual({ type: "success", title: "Consent granted", description: undefined });
  });

  it("a refused withdrawal says why", async () => {
    mockedPut.mockRejectedValue(httpError(400, "Consent management is disabled"));
    await renderLoaded();

    fireEvent.click(screen.getByRole("button", { name: "analytics" }));
    fireEvent.click(screen.getByRole("button", { name: "Withdraw" }));

    await waitFor(() =>
      expect(toasts()).toContainEqual({
        type: "error",
        title: "Action failed",
        description: "Consent management is disabled",
      }),
    );
    expect(mockedPut).toHaveBeenCalledWith("/api/v1/gdpr/consent", { categories: ["analytics"], consent: false });
  });
});

describe("GDPR page — erasure (Art. 17)", () => {
  const openErasure = () => {
    fireEvent.click(screen.getByRole("button", { name: /Request erasure/ }));
    return screen.getByRole("dialog", { name: "Request Erasure" });
  };

  it("needs a reason AND the confirmation before anything is sent", async () => {
    const { container } = await renderLoaded();
    const dialog = openErasure();
    expect(await axeViolations(container)).toEqual([]);

    fireEvent.click(within(dialog).getByRole("button", { name: "Submit Request" }));
    expect(toasts()).toContainEqual({ type: "error", title: "A reason is required", description: undefined });

    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "  leaving the hospital  " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Submit Request" }));
    expect(toasts()).toContainEqual({ type: "error", title: "You must confirm the request", description: undefined });

    expect(mockedPost).not.toHaveBeenCalled();
  });

  it("files the request with the trimmed reason and confirm: true, then closes", async () => {
    mockedPost.mockResolvedValue(ok({ dsarId: "dsar-1" }, "Erasure request submitted", 201));
    await renderLoaded();
    const dialog = openErasure();

    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "  leaving the hospital  " } });
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Submit Request" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockedPost).toHaveBeenCalledWith("/api/v1/gdpr/erasure", {
      reason: "leaving the hospital",
      confirm: true,
    });
    expect(toasts()).toContainEqual({ type: "success", title: "Erasure request submitted", description: undefined });
  });

  it("a rate-limited request keeps the dialog open with the reason", async () => {
    mockedPost.mockRejectedValue(httpError(429, "Too many requests, please try again later"));
    await renderLoaded();
    const dialog = openErasure();

    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "leaving" } });
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Submit Request" }));

    await waitFor(() =>
      expect(toasts()).toContainEqual({
        type: "error",
        title: "Action failed",
        description: "Too many requests, please try again later",
      }),
    );
    expect(screen.getByRole("dialog", { name: "Request Erasure" })).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Reason/)).toHaveValue("leaving");
  });

  it("Cancel closes without sending", async () => {
    await renderLoaded();
    const dialog = openErasure();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockedPost).not.toHaveBeenCalled();
  });
});

describe("GDPR page — rectification (Art. 16)", () => {
  const openRectify = () => {
    fireEvent.click(screen.getByRole("button", { name: /Correct my data/ }));
    return screen.getByRole("dialog", { name: "Correct My Data" });
  };

  const chooseField = (dialog: HTMLElement, field: string) => {
    fireEvent.click(within(dialog).getByRole("button", { name: /Field/ }));
    fireEvent.click(within(dialog).getByRole("option", { name: field }));
  };

  it("corrects a name with no re-authentication", async () => {
    mockedPut.mockResolvedValue(ok({ field: "firstName", updated: true }, "Data rectified"));
    await renderLoaded();
    const dialog = openRectify();

    expect(within(dialog).queryByLabelText(/Current password/)).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Correct" }));
    expect(toasts()).toContainEqual({ type: "error", title: "Enter the corrected value", description: undefined });

    fireEvent.change(within(dialog).getByLabelText(/Corrected value/), { target: { value: " Ana " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Correct" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockedPut).toHaveBeenCalledWith("/api/v1/gdpr/rectify", { field: "firstName", value: "Ana" });
  });

  it("an email change asks for the password and, with MFA, a code — and sends both", async () => {
    mockAuthState.user = { id: "u-1", mfaEnabled: true };
    mockedPut.mockResolvedValue(ok({ field: "email", updated: true }, "Data rectified"));
    const { container } = await renderLoaded();
    const dialog = openRectify();
    chooseField(dialog, "email");

    fireEvent.change(within(dialog).getByLabelText(/Corrected value/), { target: { value: "new@h.example" } });
    fireEvent.change(within(dialog).getByLabelText(/Current password/), { target: { value: "s3cret" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Correct" }));
    expect(toasts()).toContainEqual({
      type: "error",
      title: "Enter your current password and authenticator code",
      description: undefined,
    });
    expect(mockedPut).not.toHaveBeenCalled();
    expect(await axeViolations(container)).toEqual([]);

    fireEvent.change(within(dialog).getByLabelText(/Authenticator code/), { target: { value: " 123456 " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Correct" }));

    await waitFor(() =>
      expect(mockedPut).toHaveBeenCalledWith("/api/v1/gdpr/rectify", {
        field: "email",
        value: "new@h.example",
        currentPassword: "s3cret",
        code: "123456",
      }),
    );
  });

  it("an email change without MFA needs only the password; a wrong one keeps the dialog open", async () => {
    mockedPut.mockRejectedValue(httpError(401, "Current password is incorrect"));
    await renderLoaded();
    const dialog = openRectify();
    chooseField(dialog, "email");

    expect(within(dialog).queryByLabelText(/Authenticator code/)).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/Corrected value/), { target: { value: "new@h.example" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Correct" }));
    expect(toasts()).toContainEqual({ type: "error", title: "Enter your current password", description: undefined });

    fireEvent.change(within(dialog).getByLabelText(/Current password/), { target: { value: "wrong" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Correct" }));

    await waitFor(() =>
      expect(toasts()).toContainEqual({
        type: "error",
        title: "Action failed",
        description: "Current password is incorrect",
      }),
    );
    expect(mockedPut).toHaveBeenCalledWith("/api/v1/gdpr/rectify", {
      field: "email",
      value: "new@h.example",
      currentPassword: "wrong",
    });
    expect(screen.getByRole("dialog", { name: "Correct My Data" })).toBeInTheDocument();
  });
});

describe("GDPR page — restriction (Art. 18) and export (Art. 20)", () => {
  it("restricting needs a reason, then POSTs it", async () => {
    mockedPost.mockResolvedValue(ok({ restricted: true, requestId: "dsar-2" }, "Processing restricted"));
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: /Restrict processing/ }));
    const dialog = screen.getByRole("dialog", { name: "Restrict Processing" });

    fireEvent.click(within(dialog).getByRole("button", { name: "Restrict" }));
    expect(toasts()).toContainEqual({ type: "error", title: "A reason is required", description: undefined });

    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "disputing accuracy" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Restrict" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockedPost).toHaveBeenCalledWith("/api/v1/gdpr/restrict", { reason: "disputing accuracy" });
    expect(toasts()).toContainEqual({ type: "success", title: "Processing restricted", description: undefined });
  });

  describe("export", () => {
    const createObjectURL = jest.fn(() => "blob:export");
    const revokeObjectURL = jest.fn();
    let click: jest.SpyInstance;

    beforeEach(() => {
      Object.assign(URL, { createObjectURL, revokeObjectURL });
      click = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    });
    afterEach(() => click.mockRestore());

    it("downloads the export as my-data-export.json", async () => {
      mockedPost.mockResolvedValue(ok({ user: { id: "u-1" }, consents: [] }, "Data export initiated"));
      await renderLoaded();

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /Export my data/ }));
      });

      expect(mockedPost).toHaveBeenCalledWith("/api/v1/gdpr/export");
      expect(createObjectURL).toHaveBeenCalledTimes(1);
      const anchor = click.mock.instances[0] as unknown as HTMLAnchorElement;
      expect(anchor.download).toBe("my-data-export.json");
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:export");
      expect(toasts()).toContainEqual({ type: "success", title: "Export downloaded", description: undefined });
    });

    it("a failed export says so and downloads nothing", async () => {
      mockedPost.mockRejectedValue(httpError(429, "Too many requests"));
      await renderLoaded();

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /Export my data/ }));
      });

      expect(click).not.toHaveBeenCalled();
      expect(toasts()).toContainEqual({ type: "error", title: "Export failed", description: "Too many requests" });
    });
  });
});
