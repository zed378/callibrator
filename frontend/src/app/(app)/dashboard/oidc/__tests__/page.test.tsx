/** @jest-environment jsdom */
/**
 * OIDC provider page against the backend contract
 * (backend/src/routes/api/oidc.route.js, mounted /api/v1/oidc;
 * controllers/oidcProvider.controller.js; services/oidcProvider.service.js):
 *  - GET /.well-known/openid-configuration → the discovery document itself,
 *    NOT enveloped (`res.json(discover())`);
 *  - GET /clients → client rows in `data` (never a secret);
 *  - POST /clients { name, redirectUris, scopes } (super admin) → data with the
 *    one-time `clientSecret`;
 *  - POST /clients/:clientId/rotate-secret → data { clientId, clientSecret };
 *  - DELETE /clients/:clientId → data { deleted }.
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
import OidcPage from "../page";
import { grantPermissions, grantSuperAdmin, clearPermissions } from "@/tests/support/permissions";

const mockedGet = api.get as jest.Mock;
const mockedPost = api.post as jest.Mock;
const mockedDelete = api.delete as jest.Mock;

const ok = (data: unknown, message = "ok") => ({ success: true, status: 200, message, data });

const ISSUER = "https://kalibrasi.example";
/** oidcProvider.service.discover(), sent as the whole body. */
const discovery = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/oidc/authorize`,
  token_endpoint: `${ISSUER}/oidc/token`,
  userinfo_endpoint: `${ISSUER}/oidc/userinfo`,
  jwks_uri: `${ISSUER}/oidc/.well-known/jwks.json`,
  scopes_supported: ["openid", "profile", "email", "offline_access"],
  response_types_supported: ["code"],
  subject_types_supported: ["public"],
  id_token_signing_alg_values_supported: ["RS256"],
};

const client = (clientId: string, name: string) => ({
  clientId,
  name,
  redirectUris: [`https://${clientId}.example/callback`],
  scopes: ["openid", "profile"],
  grantTypes: ["authorization_code"],
  createdAt: "2026-09-01T00:00:00.000Z",
});

let clients: unknown[];

const backend = () => {
  mockedGet.mockImplementation(async (url: string) => {
    if (url === "/api/v1/oidc/.well-known/openid-configuration") return discovery;
    if (url === "/api/v1/oidc/clients") return ok(clients, "Fetch OIDC clients");
    throw httpError(404, "Not found");
  });
};

const toasts = () => useToastStore.getState().toasts.map((t) => ({ type: t.type, title: t.title, description: t.description }));

const writeText = jest.fn();

beforeEach(() => {
  // ADR-102: write controls follow the effective permissions.
  grantSuperAdmin();
  jest.clearAllMocks();
  useToastStore.setState({ toasts: [] });
  clients = [client("portal", "Partner Portal")];
  backend();
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});

const renderLoaded = async () => {
  const view = render(<OidcPage />);
  await screen.findByText("Partner Portal");
  return view;
};

describe("OIDC page — reading", () => {
  it("lists clients and the provider's endpoints from the unenveloped discovery document", async () => {
    const { container } = await renderLoaded();

    const row = screen.getAllByRole("row")[1];
    expect(within(row).getByText("portal")).toBeInTheDocument();
    expect(within(row).getByText("https://portal.example/callback")).toBeInTheDocument();
    expect(within(row).getByText("profile")).toBeInTheDocument();

    expect(screen.getByText(ISSUER)).toBeInTheDocument();
    expect(screen.getByText(`${ISSUER}/oidc/token`)).toBeInTheDocument();
    expect(screen.getByText(/Signing algorithm:\s*RS256/)).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("no clients is the empty state", async () => {
    clients = [];
    render(<OidcPage />);

    expect(await screen.findByText("No OIDC clients registered yet.")).toBeInTheDocument();
  });

  it("a failed client list (403) shows the error; a failed discovery just hides the endpoints", async () => {
    mockedGet.mockImplementation(async (url: string) => {
      if (url === "/api/v1/oidc/clients") throw httpError(403, "You do not have permission to read OIDC clients");
      throw httpError(503, "unavailable");
    });
    const { container } = render(<OidcPage />);

    expect(await screen.findByText("You do not have permission to read OIDC clients")).toBeInTheDocument();
    expect(screen.queryByText("Endpoints")).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("copies an endpoint to the clipboard", async () => {
    await renderLoaded();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy Token" }));
    });

    expect(writeText).toHaveBeenCalledWith(`${ISSUER}/oidc/token`);
    expect(toasts()).toContainEqual({ type: "success", title: "Token copied", description: undefined });
  });

  it("a refused clipboard says the copy failed", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    await renderLoaded();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy Issuer" }));
    });

    expect(toasts()).toContainEqual({ type: "error", title: "Copy failed", description: undefined });
  });
});

describe("OIDC page — registering a client", () => {
  const openRegister = () => {
    fireEvent.click(screen.getByRole("button", { name: "Register Client" }));
    return screen.getByRole("dialog", { name: "Register OIDC Client" });
  };

  it("validates name, redirect URIs and their scheme before sending", async () => {
    await renderLoaded();
    const dialog = openRegister();
    const register = within(dialog).getByRole("button", { name: "Register" });

    fireEvent.click(register);
    expect(toasts()).toContainEqual({ type: "error", title: "Client name is required", description: undefined });

    fireEvent.change(within(dialog).getByLabelText(/Client name/), { target: { value: "LIS" } });
    fireEvent.click(register);
    expect(toasts()).toContainEqual({ type: "error", title: "At least one redirect URI is required", description: undefined });

    fireEvent.change(within(dialog).getByLabelText(/Redirect URIs/), {
      target: { value: "https://lis.example/cb\nftp://lis.example/cb" },
    });
    fireEvent.click(register);
    expect(toasts()).toContainEqual({ type: "error", title: "Invalid redirect URI", description: "ftp://lis.example/cb" });

    expect(mockedPost).not.toHaveBeenCalled();
  });

  it("registers, then shows the one-time secret until it is dismissed", async () => {
    mockedPost.mockResolvedValue(
      ok(
        {
          clientId: "lis-id",
          clientSecret: "a1b2c3-plaintext-once",
          name: "LIS",
          redirectUris: ["https://lis.example/cb", "http://localhost:4000/cb"],
          scopes: ["openid", "profile", "offline_access"],
          grantTypes: ["authorization_code"],
        },
        "OIDC client registered",
      ),
    );
    const { container } = await renderLoaded();
    const dialog = openRegister();

    fireEvent.change(within(dialog).getByLabelText(/Client name/), { target: { value: "  LIS  " } });
    fireEvent.change(within(dialog).getByLabelText(/Redirect URIs/), {
      target: { value: " https://lis.example/cb \n\nhttp://localhost:4000/cb" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "email" })); // deselect
    fireEvent.click(within(dialog).getByRole("button", { name: "offline_access" })); // select
    clients = [...clients, client("lis-id", "LIS")];
    fireEvent.click(within(dialog).getByRole("button", { name: "Register" }));

    const secret = await screen.findByRole("dialog", { name: "Client Secret" });
    expect(mockedPost).toHaveBeenCalledWith("/api/v1/oidc/clients", {
      name: "LIS",
      redirectUris: ["https://lis.example/cb", "http://localhost:4000/cb"],
      scopes: ["openid", "profile", "offline_access"],
    });
    expect(within(secret).getByText("a1b2c3-plaintext-once")).toBeInTheDocument();
    expect(within(secret).getByText("lis-id")).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);

    await act(async () => {
      fireEvent.click(within(secret).getByRole("button", { name: "Copy" }));
    });
    expect(writeText).toHaveBeenCalledWith("a1b2c3-plaintext-once");

    fireEvent.click(within(secret).getByRole("button", { name: "I've saved it" }));
    expect(screen.queryByText("a1b2c3-plaintext-once")).not.toBeInTheDocument();
    expect(await screen.findByText("LIS")).toBeInTheDocument();
  });

  it("a refused registration (403) keeps the form and says why", async () => {
    mockedPost.mockRejectedValue(httpError(403, "Super admin access required"));
    await renderLoaded();
    const dialog = openRegister();

    fireEvent.change(within(dialog).getByLabelText(/Client name/), { target: { value: "LIS" } });
    fireEvent.change(within(dialog).getByLabelText(/Redirect URIs/), { target: { value: "https://lis.example/cb" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Register" }));

    await waitFor(() =>
      expect(toasts()).toContainEqual({
        type: "error",
        title: "Registration failed",
        description: "Super admin access required",
      }),
    );
    expect(screen.getByRole("dialog", { name: "Register OIDC Client" })).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Client name/)).toHaveValue("LIS");
    expect(screen.queryByRole("dialog", { name: "Client Secret" })).not.toBeInTheDocument();
  });
});

describe("OIDC page — rotate and delete", () => {
  it("rotating shows the new secret once", async () => {
    mockedPost.mockResolvedValue(ok({ clientId: "portal", clientSecret: "rotated-secret" }, "Client secret rotated"));
    await renderLoaded();

    fireEvent.click(screen.getByRole("button", { name: "Rotate" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Rotate client secret?" })).getByRole("button", { name: "Rotate secret" }));

    const secret = await screen.findByRole("dialog", { name: "Client Secret" });
    expect(mockedPost).toHaveBeenCalledWith("/api/v1/oidc/clients/portal/rotate-secret");
    expect(within(secret).getByText("rotated-secret")).toBeInTheDocument();
    expect(toasts()).toContainEqual({ type: "success", title: "Secret rotated", description: undefined });
  });

  it("rotating a client that is gone (404) says so", async () => {
    mockedPost.mockRejectedValue(httpError(404, "OIDC client not found"));
    await renderLoaded();

    fireEvent.click(screen.getByRole("button", { name: "Rotate" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Rotate client secret?" })).getByRole("button", { name: "Rotate secret" }));

    await waitFor(() =>
      expect(toasts()).toContainEqual({ type: "error", title: "Rotation failed", description: "OIDC client not found" }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("F-19: Rotate asks first, says the old secret stops working, and Cancel sends nothing", async () => {
    await renderLoaded();

    fireEvent.click(screen.getByRole("button", { name: "Rotate" }));
    const dialog = screen.getByRole("dialog", { name: "Rotate client secret?" });
    expect(within(dialog).getByText("Partner Portal")).toBeInTheDocument();
    expect(dialog).toHaveTextContent(/current secret stops working immediately/);
    expect(await axeViolations(dialog)).toEqual([]);

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it("delete asks first; Cancel sends nothing", async () => {
    const { container } = await renderLoaded();

    fireEvent.click(screen.getByRole("button", { name: "Delete Partner Portal" }));
    const dialog = screen.getByRole("dialog", { name: "Delete OIDC Client" });
    expect(within(dialog).getByText("Partner Portal")).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockedDelete).not.toHaveBeenCalled();
  });

  it("confirming deletes the client and reloads the list", async () => {
    mockedDelete.mockImplementation(async () => {
      clients = [];
      return ok({ deleted: true }, "OIDC client deleted");
    });
    await renderLoaded();

    fireEvent.click(screen.getByRole("button", { name: "Delete Partner Portal" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete Client" }));

    expect(await screen.findByText("No OIDC clients registered yet.")).toBeInTheDocument();
    expect(mockedDelete).toHaveBeenCalledWith("/api/v1/oidc/clients/portal");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(toasts()).toContainEqual({ type: "success", title: "Client deleted", description: undefined });
  });

  it("a refused delete keeps the confirmation open", async () => {
    mockedDelete.mockRejectedValue(httpError(403, "Super admin access required"));
    await renderLoaded();

    fireEvent.click(screen.getByRole("button", { name: "Delete Partner Portal" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete Client" }));

    await waitFor(() =>
      expect(toasts()).toContainEqual({ type: "error", title: "Delete failed", description: "Super admin access required" }),
    );
    expect(screen.getByRole("dialog", { name: "Delete OIDC Client" })).toBeInTheDocument();
  });
});

/**
 * ADR-102 — registering, rotating and deleting OIDC clients is superAdminOnly
 * (oidc.route.js). HEALTHCARE ADMIN holds `oidc` read and sees the list only.
 * Fail-before: Register shown to HA (audit 01 §4.8).
 */
describe("ADR-102 — OIDC client controls are the super admin's", () => {
  it("a tenant reader sees the clients without Register, Rotate or Delete", async () => {
    grantPermissions({ oidc: "read" });
    await renderLoaded();
    for (const name of [/Register Client/, /^Rotate$/, "Delete Partner Portal"]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });

  it("nothing is writable before the permissions load", async () => {
    clearPermissions();
    await renderLoaded();
    expect(screen.queryByRole("button", { name: /Register Client/ })).not.toBeInTheDocument();
  });
});
