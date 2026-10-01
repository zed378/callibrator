/** @jest-environment jsdom */
/**
 * P10-04 — the identifier-first sign-in, end to end in the browser half: the
 * real panel, form hook, auth store and auth service; only `@/api/client`'s
 * transport and next/navigation are mocked.
 *
 *  - step 1 asks the server what comes next (POST /auth/login/discover); a
 *    missing endpoint (404) falls back to the password step;
 *  - a domain whose tenant uses SSO is redirected — the user never picks SAML/OIDC;
 *  - the answers shown are dictionary sentences mapped by status/code, never
 *    the backend's English (doc 20 §7.4): 401, 429 with minutes from
 *    retryAfter, 403 suspended, network;
 *  - A-288 (ADR-100): 403 LOCATION_REQUIRED → one geolocation request, one
 *    retry carrying `location`; a denial shows the message and sends nothing
 *    more; NETWORK_POLICY never asks for the position;
 *  - the organisation-code fallback posts only the code to /auth/sso/start and
 *    shows ONE generic refusal;
 *  - autocomplete tokens (SC 1.3.5), the forgot link, one role="alert", one <h1>;
 *  - the Indonesian dictionary is what a provider with `id` renders.
 */
import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AxiosError, AxiosHeaders } from "axios";
import { axeViolations } from "@/tests/a11y/axe";

const mockPush = jest.fn();
let mockParams = new URLSearchParams();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), prefetch: jest.fn() }),
  useSearchParams: () => mockParams,
  usePathname: () => "/login",
}));
jest.mock("@/api/client", () => ({
  ...jest.requireActual("@/api/client"),
  api: { get: jest.fn(), post: jest.fn() },
}));

import { api } from "@/api/client";
import { LoginPanel } from "../components/LoginPanel";
import { MessagesProvider } from "@/i18n/MessagesProvider";
import { en } from "@/i18n/messages/en";
import { id } from "@/i18n/messages/id";
import { useAuthStore } from "@/stores/authStore";

const mockedPost = api.post as jest.Mock;
const assign = jest.fn();
jest.mock("@/lib/navigate", () => ({ assignLocation: (url: string) => assign(url) }));

const refusal = (status: number, body: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  new AxiosError("refused", "ERR_BAD_REQUEST", { headers: new AxiosHeaders() }, {}, {
    status,
    statusText: String(status),
    headers,
    config: { headers: new AxiosHeaders() },
    data: { success: false, status, message: "English backend text that must not show", ...body },
  });

const user = { id: "u-1", username: "ada", email: "ada@rs.test", tenantId: "t-1", roleId: "r-1" };
const signedIn = { success: true, status: 200, message: "Login successful", data: user, session: { id: "s-1" } };

const renderPanel = (locale: "en" | "id" = "en") =>
  render(
    <MessagesProvider locale={locale} messages={locale === "en" ? en : id}>
      <LoginPanel />
    </MessagesProvider>,
  );

/** Step 1 with the discovery endpoint absent (404) → the password step. */
const toPasswordStep = async (identifier = "ada@rs.test") => {
  fireEvent.change(screen.getByLabelText(en["auth.login.identifier"]), { target: { value: identifier } });
  fireEvent.click(screen.getByRole("button", { name: en["auth.login.continue"] }));
  return screen.findByLabelText(en["auth.login.password"]);
};

let geolocation: { getCurrentPosition: jest.Mock };


beforeEach(() => {
  jest.clearAllMocks();
  mockParams = new URLSearchParams();
  useAuthStore.setState({ user: null, isAuthenticated: false, error: null, isLoading: false });
  geolocation = { getCurrentPosition: jest.fn() };
  Object.defineProperty(navigator, "geolocation", { value: geolocation, configurable: true });
});

const routeByUrl = (handlers: Record<string, (body: unknown) => unknown>) =>
  mockedPost.mockImplementation(async (url: string, body: unknown) => {
    const handler = handlers[url];
    if (!handler) throw new Error(`unexpected ${url}`);
    return handler(body);
  });

describe("P10-04: identifier-first sign-in", () => {
  it("one <h1>, autocomplete on the identifier, no protocol choice, axe-clean", async () => {
    const { container } = renderPanel();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(en["auth.login.title"]);
    expect(screen.getByLabelText(en["auth.login.identifier"])).toHaveAttribute("autocomplete", "username");
    expect(screen.queryByText("SAML")).not.toBeInTheDocument();
    expect(screen.queryByText("OIDC")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: en["auth.login.noAccount"] })).toHaveAttribute("href", "/request-access");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("renders the Indonesian dictionary under an `id` provider", () => {
    renderPanel("id");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Masuk ke Device Calibrator");
    expect(screen.getByLabelText("Email atau nama pengguna")).toBeInTheDocument();
  });

  it("a missing discovery endpoint falls back to the password step; sign-in lands on the callback", async () => {
    mockParams = new URLSearchParams({ callbackUrl: "/dashboard/devices" });
    routeByUrl({
      "/api/v1/auth/login/discover": () => {
        throw refusal(404);
      },
      "/api/v1/auth/login": () => signedIn,
    });
    const { container } = renderPanel();
    const password = await toPasswordStep();

    expect(password).toHaveAttribute("autocomplete", "current-password");
    expect(screen.getByRole("link", { name: en["auth.login.forgot"] })).toHaveAttribute("href", "/forgot-password");
    expect(await axeViolations(container)).toEqual([]);

    fireEvent.change(password, { target: { value: "Secret123" } });
    fireEvent.click(screen.getByRole("button", { name: en["auth.login.submit"] }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/dashboard/devices"));
    expect(mockedPost).toHaveBeenCalledWith("/api/v1/auth/login/discover", { identifier: "ada@rs.test" });
    expect(mockedPost).toHaveBeenCalledWith("/api/v1/auth/login", { user: "ada@rs.test", password: "Secret123" });
  });

  it("a domain whose tenant uses SSO is redirected to its identity provider", async () => {
    routeByUrl({
      "/api/v1/auth/login/discover": () => ({ success: true, data: { next: "sso", redirectUrl: "https://idp.rs.test/x" } }),
    });
    renderPanel();
    fireEvent.change(screen.getByLabelText(en["auth.login.identifier"]), { target: { value: "ada@rs.test" } });
    fireEvent.click(screen.getByRole("button", { name: en["auth.login.continue"] }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://idp.rs.test/x"));
  });

  it.each([
    [401, {}, {}, en["auth.error.credentials"]],
    [429, { retryAfter: 125 }, {}, "Too many attempts. Try again in 3 minutes."],
    [429, {}, { "retry-after": "60" }, "Too many attempts. Try again in 1 minutes."],
    [403, {}, {}, en["auth.error.suspended"]],
    [403, { code: "NETWORK_POLICY" }, {}, en["auth.error.networkPolicy"]],
  ])("a %i answer shows the dictionary sentence, never the backend's text", async (status, body, headers, shown) => {
    routeByUrl({
      "/api/v1/auth/login/discover": () => ({ success: true, data: { next: "password" } }),
      "/api/v1/auth/login": () => {
        throw refusal(status, body, headers);
      },
    });
    renderPanel();
    const password = await toPasswordStep();
    fireEvent.change(password, { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: en["auth.login.submit"] }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(shown);
    expect(alert).not.toHaveTextContent("English backend text");
    expect(password).toHaveAttribute("aria-describedby", "login-error");
    expect(mockPush).not.toHaveBeenCalled();
    expect(geolocation.getCurrentPosition).not.toHaveBeenCalled();
  });

  it("A-288: LOCATION_REQUIRED → the position is asked once and the same request is resent with it", async () => {
    geolocation.getCurrentPosition.mockImplementation((ok: (p: unknown) => void) =>
      ok({ coords: { latitude: -6.2, longitude: 106.8 } }),
    );
    let calls = 0;
    routeByUrl({
      "/api/v1/auth/login/discover": () => ({ success: true, data: { next: "password" } }),
      "/api/v1/auth/login": () => {
        calls += 1;
        if (calls === 1) throw refusal(403, { code: "LOCATION_REQUIRED" });
        return signedIn;
      },
    });
    renderPanel();
    const password = await toPasswordStep();
    fireEvent.change(password, { target: { value: "Secret123" } });
    fireEvent.click(screen.getByRole("button", { name: en["auth.login.submit"] }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/dashboard"));
    expect(geolocation.getCurrentPosition).toHaveBeenCalledTimes(1);
    const loginCalls = mockedPost.mock.calls.filter(([url]) => url === "/api/v1/auth/login");
    expect(loginCalls).toHaveLength(2);
    expect(loginCalls[0][1]).toEqual({ user: "ada@rs.test", password: "Secret123" });
    expect(loginCalls[1][1]).toEqual({
      user: "ada@rs.test",
      password: "Secret123",
      location: { latitude: -6.2, longitude: 106.8 },
    });
  });

  it("A-288: a denied position shows the message and sends nothing more", async () => {
    geolocation.getCurrentPosition.mockImplementation((_ok: unknown, fail: (e: unknown) => void) => fail({ code: 1 }));
    routeByUrl({
      "/api/v1/auth/login/discover": () => ({ success: true, data: { next: "password" } }),
      "/api/v1/auth/login": () => {
        throw refusal(403, { code: "LOCATION_REQUIRED" });
      },
    });
    renderPanel();
    const password = await toPasswordStep();
    fireEvent.change(password, { target: { value: "Secret123" } });
    fireEvent.click(screen.getByRole("button", { name: en["auth.login.submit"] }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(en["auth.error.locationRequired"]);
    expect(alert).toHaveTextContent(en["auth.error.locationDenied"]);
    expect(mockedPost.mock.calls.filter(([url]) => url === "/api/v1/auth/login")).toHaveLength(1);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("A-288: after the password step supplied a position, the MFA step sends it proactively", async () => {
    geolocation.getCurrentPosition.mockImplementation((ok: (p: unknown) => void) =>
      ok({ coords: { latitude: 1, longitude: 2 } }),
    );
    let calls = 0;
    routeByUrl({
      "/api/v1/auth/login/discover": () => ({ success: true, data: { next: "password" } }),
      "/api/v1/auth/login": () => {
        calls += 1;
        if (calls === 1) throw refusal(403, { code: "LOCATION_REQUIRED" });
        return { success: true, status: 202, data: { mfaRequired: true }, token: "mfa-temp" };
      },
      "/api/v1/auth/mfa/login": () => signedIn,
    });
    renderPanel();
    const password = await toPasswordStep();
    fireEvent.change(password, { target: { value: "Secret123" } });
    fireEvent.click(screen.getByRole("button", { name: en["auth.login.submit"] }));
    const code = await screen.findByLabelText(en["auth.mfa.title"]);
    expect(code).toHaveAttribute("autocomplete", "one-time-code");
    expect(code).toHaveAttribute("aria-describedby", "mfa-help");

    fireEvent.change(code, { target: { value: "123 456" } });
    fireEvent.click(screen.getByRole("button", { name: en["auth.mfa.submit"] }));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/dashboard"));
    expect(mockedPost).toHaveBeenCalledWith("/api/v1/auth/mfa/login", {
      token: "mfa-temp",
      code: "123456",
      location: { latitude: 1, longitude: 2 },
    });
    expect(geolocation.getCurrentPosition).toHaveBeenCalledTimes(1);
  });

  it("a wrong MFA code says so in the dictionary's words", async () => {
    routeByUrl({
      "/api/v1/auth/login/discover": () => ({ success: true, data: { next: "password" } }),
      "/api/v1/auth/login": () => ({ success: true, status: 202, data: { mfaRequired: true }, token: "t" }),
      "/api/v1/auth/mfa/login": () => {
        throw refusal(401);
      },
    });
    renderPanel();
    const password = await toPasswordStep();
    fireEvent.change(password, { target: { value: "Secret123" } });
    fireEvent.click(screen.getByRole("button", { name: en["auth.login.submit"] }));
    fireEvent.change(await screen.findByLabelText(en["auth.mfa.title"]), { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: en["auth.mfa.submit"] }));
    expect(await screen.findByRole("alert")).toHaveTextContent(en["auth.error.mfa"]);
  });

  it("the organisation-code fallback posts only the code and gives one generic refusal", async () => {
    routeByUrl({
      "/api/v1/auth/sso/start": () => {
        throw refusal(404, { message: "Tenant not found" });
      },
    });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: en["auth.login.ssoFallback"] }));
    const org = await screen.findByLabelText(en["auth.login.orgCode"]);
    fireEvent.change(org, { target: { value: "rs-contoh" } });
    fireEvent.click(screen.getByRole("button", { name: en["auth.login.ssoContinue"] }));

    expect(await screen.findByRole("alert")).toHaveTextContent(en["auth.sso.unavailable"]);
    expect(mockedPost).toHaveBeenCalledWith("/api/v1/auth/sso/start", { orgCode: "rs-contoh" });
    expect(screen.queryByText("Tenant not found")).not.toBeInTheDocument();
  });

  it("?org=<code> goes straight to the tenant's SSO", async () => {
    mockParams = new URLSearchParams({ org: "rs-contoh" });
    routeByUrl({ "/api/v1/auth/sso/start": () => ({ success: true, data: { redirectUrl: "https://idp.test/a" } }) });
    await act(async () => {
      renderPanel();
    });
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://idp.test/a"));
  });

  describe("P10-10: passkey sign-in", () => {
    const assertion = {
      id: "c",
      rawId: new Uint8Array([1]).buffer,
      type: "public-key",
      authenticatorAttachment: "platform",
      getClientExtensionResults: () => ({}),
      response: {
        clientDataJSON: new Uint8Array([1]).buffer,
        authenticatorData: new Uint8Array([2]).buffer,
        signature: new Uint8Array([3]).buffer,
        userHandle: new Uint8Array([4]).buffer,
      },
    };
    beforeEach(() => {
      (window as unknown as { PublicKeyCredential: unknown }).PublicKeyCredential = function PublicKeyCredential() {};
    });
    afterEach(() => {
      delete (window as unknown as { PublicKeyCredential?: unknown }).PublicKeyCredential;
    });

    it("asks for no identifier, runs one ceremony and signs in", async () => {
      const get = jest.fn().mockResolvedValue(assertion);
      Object.defineProperty(navigator, "credentials", { value: { get }, configurable: true });
      routeByUrl({
        "/api/v1/auth/passkey/options": () => ({ success: true, data: { ceremonyId: "cer-1", options: { challenge: "AQID" } } }),
        "/api/v1/auth/passkey/verify": () => signedIn,
      });
      renderPanel();
      fireEvent.click(await screen.findByRole("button", { name: en["auth.login.passkey"] }));
      await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/dashboard"));
      expect(mockedPost).toHaveBeenCalledWith("/api/v1/auth/passkey/options", {});
      const [, body] = mockedPost.mock.calls.find(([url]) => url === "/api/v1/auth/passkey/verify")!;
      expect(body).toMatchObject({ ceremonyId: "cer-1", credential: { id: "c", rawId: "AQ", response: { signature: "Aw" } } });
      expect(get.mock.calls[0][0].publicKey).not.toHaveProperty("allowCredentials");
    });

    it("a cancelled ceremony is silent; a refused one says so in the dictionary's words", async () => {
      const get = jest.fn().mockRejectedValueOnce(new DOMException("x", "NotAllowedError")).mockResolvedValueOnce(assertion);
      Object.defineProperty(navigator, "credentials", { value: { get }, configurable: true });
      routeByUrl({
        "/api/v1/auth/passkey/options": () => ({ success: true, data: { ceremonyId: "c", options: { challenge: "AA" } } }),
        "/api/v1/auth/passkey/verify": () => {
          throw refusal(401);
        },
      });
      renderPanel();
      const button = await screen.findByRole("button", { name: en["auth.login.passkey"] });
      fireEvent.click(button);
      await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(button).toBeEnabled());
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      fireEvent.click(button);
      expect(await screen.findByRole("alert")).toHaveTextContent(en["auth.error.passkey"]);
      expect(mockPush).not.toHaveBeenCalled();
    });

    it("no WebAuthn in the browser: no passkey button", () => {
      delete (window as unknown as { PublicKeyCredential?: unknown }).PublicKeyCredential;
      renderPanel();
      expect(screen.queryByRole("button", { name: en["auth.login.passkey"] })).not.toBeInTheDocument();
    });
  });

  it("?status=reset shows the reset notice as a status message", () => {
    mockParams = new URLSearchParams({ status: "reset" });
    renderPanel();
    expect(screen.getByRole("status")).toHaveTextContent(en["auth.login.resetDone"]);
  });
});
