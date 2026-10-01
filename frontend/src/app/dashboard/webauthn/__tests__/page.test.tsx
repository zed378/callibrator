/** @jest-environment jsdom */
/**
 * Passkeys page against the backend contract
 * (backend/src/routes/api/webauthn.route.js, mounted /api/v1/webauthn;
 * controllers/webauthn.controller.js; services/webauthn.service.ts):
 *  - GET  /status → data { enabled, signCount, lastUpdatedAt };
 *  - POST /registration-options → data (PublicKeyCredentialCreationOptionsJSON);
 *    POST /verify-registration { id, rawId, type, response, … } → data { success };
 *  - POST /login-options, /verify-login likewise;
 *  - POST /disable { currentPassword, code? } (A-213) → data { success };
 *  - ADR-108 Am. 1 (several passkeys): GET /credentials → data [{ id, name,
 *    createdAt, lastUsedAt, transports }]; PATCH /credentials/:id { name };
 *    DELETE /credentials/:id { currentPassword, code? } → data { success, remaining };
 *    POST /verify-registration also carries the new passkey's `name`.
 * The browser's navigator.credentials is faked; the real webauthn.service runs.
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

const mockAuthState: { user: { id: string; email: string; mfaEnabled: boolean } | null } = {
  user: { id: "u-1", email: "siti@h.example", mfaEnabled: false },
};
jest.mock("@/stores/authStore", () => ({
  useAuthStore: (selector: (s: typeof mockAuthState) => unknown) => selector(mockAuthState),
}));

import { api } from "@/api/client";
import { useToastStore } from "@/stores/toastStore";
import WebauthnPage from "../page";

const mockedGet = api.get as jest.Mock;
const mockedPost = api.post as jest.Mock;
const mockedPatch = api.patch as jest.Mock;
const mockedDelete = api.delete as jest.Mock;

const LAPTOP = { id: "p-1", name: "Laptop", createdAt: "2026-09-01T00:00:00.000Z", lastUsedAt: null, transports: ["internal"] };
const PHONE = { id: "p-2", name: "Phone", createdAt: "2026-09-10T00:00:00.000Z", lastUsedAt: "2026-09-20T10:00:00.000Z", transports: null };
let passkeys: typeof LAPTOP[] | (typeof LAPTOP | typeof PHONE)[];

const ok = (data: unknown, message = "ok") => ({ success: true, status: 200, message, data });

let status: { enabled: boolean; signCount: number; lastUpdatedAt: string | null };

const toasts = () => useToastStore.getState().toasts.map((t) => ({ type: t.type, title: t.title, description: t.description }));

const bytes = (...values: number[]) => new Uint8Array(values).buffer;

/** A PublicKeyCredential as a browser hands it back from create(). */
const attestation = {
  id: "cred-1",
  rawId: bytes(1, 2, 3),
  type: "public-key",
  getClientExtensionResults: () => ({}),
  authenticatorAttachment: "platform",
  response: {
    clientDataJSON: bytes(4, 5),
    attestationObject: bytes(6, 7),
    getTransports: () => ["internal"],
  },
};

/** …and from get(). */
const assertion = {
  id: "cred-1",
  rawId: bytes(1, 2, 3),
  type: "public-key",
  getClientExtensionResults: () => ({}),
  response: {
    clientDataJSON: bytes(4, 5),
    authenticatorData: bytes(8),
    signature: bytes(9),
    userHandle: bytes(10),
  },
};

const create = jest.fn();
const get = jest.fn();

const setSupported = (supported: boolean) => {
  if (supported) {
    Object.defineProperty(window, "PublicKeyCredential", { value: function PublicKeyCredential() {}, configurable: true });
  } else {
    Reflect.deleteProperty(window, "PublicKeyCredential");
  }
};

beforeEach(() => {
  jest.clearAllMocks();
  useToastStore.setState({ toasts: [] });
  mockAuthState.user = { id: "u-1", email: "siti@h.example", mfaEnabled: false };
  status = { enabled: false, signCount: 0, lastUpdatedAt: null };
  passkeys = [LAPTOP];
  mockedGet.mockImplementation(async (url: string) => {
    if (url === "/api/v1/webauthn/status") return ok(status, "WebAuthn status");
    if (url === "/api/v1/webauthn/credentials") return ok(passkeys, "Passkeys");
    throw httpError(404, "Not found");
  });
  setSupported(true);
  Object.defineProperty(navigator, "credentials", { value: { create, get }, configurable: true });
});

afterAll(() => setSupported(false));

const renderLoaded = async () => {
  const view = render(<WebauthnPage />);
  await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());
  return view;
};

describe("passkeys — status", () => {
  it("an account without a passkey can register this device, nothing else", async () => {
    const { container } = await renderLoaded();

    expect(screen.getByText("No passkey")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "siti@h.example" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Register This Device" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Test Sign-In" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Remove All Passkeys" })).toBeDisabled();
    expect(mockedGet).not.toHaveBeenCalledWith("/api/v1/webauthn/credentials");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("an enrolled account lists each passkey, with add, test and remove", async () => {
    status = { enabled: true, signCount: 1, lastUpdatedAt: "2026-09-20T10:00:00.000Z" };
    passkeys = [LAPTOP, PHONE];
    const { container } = await renderLoaded();

    expect(screen.getByText("2 passkeys")).toBeInTheDocument();
    expect(screen.getByText("Laptop")).toBeInTheDocument();
    expect(screen.getByText(/not used to sign in yet/)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`last used ${new Date("2026-09-20T10:00:00.000Z").toLocaleString().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add Another Passkey" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Test Sign-In" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Remove passkey Phone" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Remove All Passkeys" })).toBeEnabled();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("an unsupported browser is told so and cannot register", async () => {
    setSupported(false);
    const { container } = await renderLoaded();

    expect(screen.getByText(/This browser does not support WebAuthn/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Register This Device" })).toBeDisabled();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("a failed status read shows the error", async () => {
    mockedGet.mockRejectedValue(httpError(500, "Failed to read passkey status"));
    const { container } = render(<WebauthnPage />);

    expect(await screen.findByText("Failed to read passkey status")).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe("passkeys — registration", () => {
  it("runs the ceremony and sends the serialised attestation", async () => {
    mockedPost.mockImplementation(async (url: string) => {
      if (url === "/api/v1/webauthn/registration-options") {
        return ok({
          challenge: "AQID",
          rp: { name: "Callibrator", id: "localhost" },
          user: { id: "dS0x", name: "siti@h.example", displayName: "Siti" },
          pubKeyCredParams: [{ type: "public-key", alg: -7 }],
          excludeCredentials: [{ id: "BAU", type: "public-key", transports: ["usb"] }],
        });
      }
      status = { enabled: true, signCount: 0, lastUpdatedAt: null };
      return ok({ success: true }, "WebAuthn registration verified");
    });
    create.mockResolvedValue(attestation);
    await renderLoaded();
    fireEvent.change(screen.getByLabelText("Name for a new passkey"), { target: { value: "  Work laptop " } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Register This Device" }));
    });

    const publicKey = create.mock.calls[0][0].publicKey;
    expect(new Uint8Array(publicKey.challenge)).toEqual(new Uint8Array([1, 2, 3]));
    expect(new Uint8Array(publicKey.excludeCredentials[0].id)).toEqual(new Uint8Array([4, 5]));
    expect(mockedPost).toHaveBeenCalledWith("/api/v1/webauthn/verify-registration", {
      id: "cred-1",
      rawId: "AQID",
      type: "public-key",
      clientExtensionResults: {},
      authenticatorAttachment: "platform",
      response: { clientDataJSON: "BAU", attestationObject: "Bgc", transports: ["internal"] },
      name: "Work laptop",
    });
    expect(toasts()).toContainEqual({ type: "success", title: "Passkey registered", description: undefined });
    expect(await screen.findByText("1 passkey")).toBeInTheDocument();
    expect(screen.getByLabelText("Name for a new passkey")).toHaveValue("");
  });

  it.each([
    ["NotAllowedError", "The request was cancelled or timed out."],
    ["InvalidStateError", "This authenticator is already registered to your account."],
    ["SecurityError", "The page origin does not match the server's configured relying-party ID."],
    ["NotSupportedError", "This authenticator does not support the required options."],
    ["AbortError", "aborted by the page"],
  ])("a browser %s is explained", async (name, explanation) => {
    mockedPost.mockResolvedValue(
      ok({ challenge: "AQID", rp: { name: "C", id: "localhost" }, user: { id: "dS0x", name: "s", displayName: "s" }, pubKeyCredParams: [] }),
    );
    create.mockRejectedValue(new DOMException("aborted by the page", name));
    await renderLoaded();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Register This Device" }));
    });

    expect(toasts()).toContainEqual({ type: "error", title: "Registration failed", description: explanation });
    expect(mockedPost).not.toHaveBeenCalledWith("/api/v1/webauthn/verify-registration", expect.anything());
  });

  it("a cancelled ceremony (no credential) and a rate-limited request are reported", async () => {
    mockedPost.mockResolvedValue(
      ok({ challenge: "AQID", rp: { name: "C", id: "localhost" }, user: { id: "dS0x", name: "s", displayName: "s" }, pubKeyCredParams: [] }),
    );
    create.mockResolvedValue(null);
    await renderLoaded();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Register This Device" }));
    });
    expect(toasts()).toContainEqual({ type: "error", title: "Registration failed", description: "Registration was cancelled" });

    mockedPost.mockRejectedValue(httpError(429, "Too many requests"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Register This Device" }));
    });
    expect(toasts()).toContainEqual({ type: "error", title: "Registration failed", description: "Too many requests" });
  });
});

describe("passkeys — test sign-in", () => {
  beforeEach(() => {
    status = { enabled: true, signCount: 2, lastUpdatedAt: null };
  });

  it("runs the assertion and sends it for verification", async () => {
    mockedPost.mockImplementation(async (url: string) => {
      if (url === "/api/v1/webauthn/login-options") {
        return ok({ challenge: "AQID", rpId: "localhost", allowCredentials: [{ id: "AQID", type: "public-key" }] });
      }
      return ok({ success: true }, "WebAuthn login verified");
    });
    get.mockResolvedValue(assertion);
    await renderLoaded();
    expect(screen.getByText("1 passkey")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Test Sign-In" }));
    });

    expect(new Uint8Array(get.mock.calls[0][0].publicKey.allowCredentials[0].id)).toEqual(new Uint8Array([1, 2, 3]));
    expect(mockedPost).toHaveBeenCalledWith(
      "/api/v1/webauthn/verify-login",
      expect.objectContaining({
        id: "cred-1",
        response: { clientDataJSON: "BAU", authenticatorData: "CA", signature: "CQ", userHandle: "Cg" },
      }),
    );
    expect(toasts()).toContainEqual({ type: "success", title: "Passkey verified", description: undefined });
  });

  it("a failed verification says why", async () => {
    mockedPost.mockImplementation(async (url: string) => {
      if (url === "/api/v1/webauthn/login-options") return ok({ challenge: "AQID", rpId: "localhost" });
      throw httpError(400, "WebAuthn authentication verification failed");
    });
    get.mockResolvedValue(assertion);
    await renderLoaded();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Test Sign-In" }));
    });

    expect(toasts()).toContainEqual({
      type: "error",
      title: "Verification failed",
      description: "WebAuthn authentication verification failed",
    });
  });
});

describe("passkeys — removal (re-authenticated, confirmed)", () => {
  beforeEach(() => {
    status = { enabled: true, signCount: 5, lastUpdatedAt: null };
    passkeys = [LAPTOP, PHONE];
  });

  const openRemove = async (label = "Remove passkey Phone", title = 'Remove "Phone"') => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: label }));
    return screen.getByRole("dialog", { name: title });
  };

  it("removing ONE sends its id with the password; the others keep working", async () => {
    mockedDelete.mockImplementation(async () => {
      passkeys = [LAPTOP];
      return ok({ success: true, remaining: 1 }, "Passkey removed");
    });
    const dialog = await openRemove();
    expect(within(dialog).getByText(/Your other passkeys keep working/)).toBeInTheDocument();
    const confirm = within(dialog).getByRole("button", { name: "Remove Passkey" });
    expect(confirm).toBeDisabled();
    expect(within(dialog).queryByLabelText("Authenticator code")).not.toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText("Current password"), { target: { value: "s3cret" } });
    expect(confirm).toBeEnabled();
    await act(async () => {
      fireEvent.click(confirm);
    });

    expect(mockedDelete).toHaveBeenCalledWith("/api/v1/webauthn/credentials/p-2", { data: { currentPassword: "s3cret" } });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(await screen.findByText("1 passkey")).toBeInTheDocument();
    expect(toasts()).toContainEqual({ type: "success", title: 'Passkey "Phone" removed', description: undefined });
  });

  it("removing the LAST one warns that the password becomes the way in", async () => {
    passkeys = [LAPTOP];
    const dialog = await openRemove("Remove passkey Laptop", 'Remove "Laptop"');
    expect(within(dialog).getByText(/After this you will sign in with your password/)).toBeInTheDocument();
  });

  it("Remove All uses /disable with the password, and with MFA a trimmed code", async () => {
    mockAuthState.user = { id: "u-1", email: "siti@h.example", mfaEnabled: true };
    mockedPost.mockImplementation(async () => {
      status = { enabled: false, signCount: 0, lastUpdatedAt: null };
      return ok({ success: true });
    });
    const dialog = await openRemove("Remove All Passkeys", "Remove All Passkeys");
    expect(await axeViolations(document.body)).toEqual([]);

    fireEvent.change(within(dialog).getByLabelText("Current password"), { target: { value: "s3cret" } });
    const confirm = within(dialog).getByRole("button", { name: "Remove All" });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Authenticator code"), { target: { value: " 123456 " } });
    await act(async () => {
      fireEvent.click(confirm);
    });

    expect(mockedPost).toHaveBeenCalledWith("/api/v1/webauthn/disable", { currentPassword: "s3cret", code: "123456" });
    expect(await screen.findByText("No passkey")).toBeInTheDocument();
    expect(toasts()).toContainEqual({ type: "success", title: "Passkeys removed", description: undefined });
  });

  it("a wrong password keeps the dialog open and says why", async () => {
    mockedDelete.mockRejectedValue(httpError(400, "Current password is incorrect"));
    const dialog = await openRemove();

    fireEvent.change(within(dialog).getByLabelText("Current password"), { target: { value: "wrong" } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Remove Passkey" }));
    });

    expect(toasts()).toContainEqual({
      type: "error",
      title: "Could not remove passkey",
      description: "Current password is incorrect",
    });
    expect(screen.getByRole("dialog", { name: 'Remove "Phone"' })).toBeInTheDocument();
  });

  it("Cancel clears what was typed and sends nothing", async () => {
    const dialog = await openRemove();
    fireEvent.change(within(dialog).getByLabelText("Current password"), { target: { value: "s3cret" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockedDelete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Remove passkey Phone" }));
    expect(within(screen.getByRole("dialog")).getByLabelText("Current password")).toHaveValue("");
  });
});

describe("passkeys — rename", () => {
  beforeEach(() => {
    status = { enabled: true, signCount: 5, lastUpdatedAt: null };
    passkeys = [LAPTOP];
  });

  it("renames one (trimmed), and an empty name cannot be saved", async () => {
    mockedPatch.mockImplementation(async () => {
      passkeys = [{ ...LAPTOP, name: "Work laptop" }];
      return ok({ ...LAPTOP, name: "Work laptop" });
    });
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Rename passkey Laptop" }));
    const dialog = screen.getByRole("dialog", { name: "Rename Passkey" });
    const field = within(dialog).getByLabelText("Passkey name");
    expect(field).toHaveValue("Laptop");
    fireEvent.change(field, { target: { value: "  " } });
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.change(field, { target: { value: " Work laptop " } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    });
    expect(mockedPatch).toHaveBeenCalledWith("/api/v1/webauthn/credentials/p-1", { name: "Work laptop" });
    expect(await screen.findByText("Work laptop")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("a failed rename is reported and Cancel closes", async () => {
    mockedPatch.mockRejectedValue(httpError(404, "Passkey not found"));
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Rename passkey Laptop" }));
    await act(async () => {
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save" }));
    });
    expect(toasts()).toContainEqual({ type: "error", title: "Could not rename the passkey", description: "Passkey not found" });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
