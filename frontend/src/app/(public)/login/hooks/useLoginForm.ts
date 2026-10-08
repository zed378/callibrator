import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { safeCallbackPath } from "@/lib/safeCallback";
import { useI18n } from "@/i18n/MessagesProvider";
import { minutesFrom, readApiFailure, signInMessage, ssoErrorKey } from "@/i18n/apiErrors";
import type { SignInLocation } from "@/types";
import { assignLocation } from "@/lib/navigate";
import { getPasskeyAssertion } from "@/lib/passkey";
import { usePrefetchOnFirstInput } from "@/hooks/usePrefetchOnFirstInput";

// A-188: the `?error=` codes the backend's SSO callbacks return with map to
// fixed dictionary messages (`SSO_ERROR_KEYS` / `ssoErrorKey`, i18n/apiErrors);
// the query string is never rendered as text. P10-13: the English-only
// `SSO_ERROR_MESSAGES` / `ssoErrorMessage` exports that lived here imported the
// whole English dictionary into the sign-in page's JavaScript for tests alone;
// the test now builds them from the dictionary itself.

/**
 * P10-17 perf addendum: the API layer (axios, the auth service and store) is
 * not in the page's first-load JavaScript. It is loaded here on first use, and
 * prefetched once the browser is idle after the page is up, so a submit does
 * not wait for it. `destinationAfterSignIn` lives in ./destination for the
 * same reason (the SSO callback page imports it from there).
 */
const loadAuth = () => import("./authRuntime");

/**
 * A-288 (ADR-100): the device position, asked for ONLY after the backend
 * answered 403 LOCATION_REQUIRED (a geofenced tenant). Null on denial, timeout
 * or no geolocation.
 */
export const requestSignInLocation = (): Promise<SignInLocation | null> =>
  new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
  });

/** The sign-in page's steps (doc 20 §7.2). */
export type LoginStep = "identifier" | "password" | "sso" | "mfa" | "first";

const isLocationRequired = (err: unknown) => readApiFailure(err).code === "LOCATION_REQUIRED";

export function useLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useI18n();
  // F-60: only a same-origin path — never an open redirect.
  const callbackUrl = safeCallbackPath(searchParams.get("callbackUrl"));

  // A-188: a refused SSO callback lands here with `?error=<code>`; open the
  // organisation-code step and say what happened.
  const callbackErrorKey = ssoErrorKey(searchParams.get("error"));
  const orgParam = searchParams.get("org");
  const statusParam = searchParams.get("status");

  const [step, setStep] = useState<LoginStep>(callbackErrorKey ? "sso" : "identifier");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [discovering, setDiscovering] = useState(false);

  const [tenantCode, setTenantCode] = useState(orgParam ?? "");
  const [ssoLoading, setSsoLoading] = useState(false);
  const [ssoError, setSsoError] = useState<string | null>(callbackErrorKey ? t(callbackErrorKey) : null);

  // Second-factor step state.
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaLoading, setMfaLoading] = useState(false);
  // A-141: sign in with a one-time recovery code instead of the app's code.
  const [useRecoveryCode, setUseRecoveryCodeState] = useState(false);

  // P10-16 (ADR-099): a one-time password was just used; it is spent, and the
  // only way on is a new password posted with the password-change token.
  const [passwordChangeToken, setPasswordChangeToken] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [firstChangeLoading, setFirstChangeLoading] = useState(false);
  const [firstChangeError, setFirstChangeError] = useState<string | null>(null);

  // A-288: once the backend has asked for the position, it is sent with the
  // MFA step proactively (never before it asks).
  const locationRef = useRef<SignInLocation | null>(null);

  const notice =
    statusParam === "reset" ? t("auth.login.resetDone") : statusParam === "invited" ? t("auth.login.invitationDone") : null;

  const mfaRequired = step === "mfa";
  const firstPasswordChangeRequired = step === "first";
  const loginMethod: "password" | "sso" = step === "sso" ? "sso" : "password";
  const setLoginMethod = (m: "password" | "sso") => {
    setError(null);
    setSsoError(null);
    setStep(m === "sso" ? "sso" : username ? "password" : "identifier");
  };

  const setUseRecoveryCode = (value: boolean) => {
    setUseRecoveryCodeState(value);
    // The two inputs have different shapes; never carry one into the other.
    setMfaCode("");
  };

  const startSso = async (code: string): Promise<boolean> => {
    setSsoLoading(true);
    setSsoError(null);
    try {
      const { authService } = await loadAuth();
      const result = await authService.ssoStart(code.trim());
      if (result?.redirectUrl) {
        assignLocation(result.redirectUrl);
        return true;
      }
      setSsoError(t("auth.sso.unavailable"));
    } catch (err) {
      const failure = readApiFailure(err);
      // A-292: one generic refusal for an unknown code, SSO off, or misconfigured.
      setSsoError(
        failure.status === 429
          ? t("auth.error.rateLimited", { minutes: minutesFrom(failure.retryAfterSeconds) })
          : failure.status === null
            ? t("auth.error.network")
            : t("auth.sso.unavailable"),
      );
    } finally {
      setSsoLoading(false);
    }
    return false;
  };

  // P10-17 perf addendum: fetch the API layer at the visitor's first key press,
  // tap or click in the sign-in panel (<main>), so it is there by the time they
  // submit (typing an address takes seconds), yet costs the page's load
  // nothing. Not on focus: the identifier field takes focus as the page
  // hydrates. Not for the theme toggle or language form outside <main>: that
  // work would land on their interaction (INP). A failed prefetch is retried
  // on use. P10-19: the listener is the shared hook the other public forms use.
  usePrefetchOnFirstInput(loadAuth);

  // `/login?org=<code>`: a tenant deep link goes straight to that tenant's SSO
  // when it is enabled, and otherwise shows the password step (doc 20 §7.2).
  const orgTried = useRef(false);
  useEffect(() => {
    if (!orgParam || orgTried.current || callbackErrorKey) return;
    orgTried.current = true;
    void (async () => {
      try {
        const { authService } = await loadAuth();
        const result = await authService.ssoStart(orgParam.trim());
        if (result?.redirectUrl) assignLocation(result.redirectUrl);
      } catch {
        // SSO not available for this code: the sign-in form stays, as for any user.
      }
    })();
  }, [orgParam, callbackErrorKey]);

  /** Step 1 → step 2: ask the server what comes next for this identifier. */
  const handleIdentifierSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const identifier = username.trim();
    if (!identifier) return;
    setError(null);
    setDiscovering(true);
    try {
      const { authService } = await loadAuth();
      const result = await authService.discoverLogin(identifier);
      if (result?.next === "sso" && result.redirectUrl) {
        assignLocation(result.redirectUrl);
        return;
      }
      setStep("password");
    } catch (err) {
      const failure = readApiFailure(err);
      if (failure.status === 429) {
        setError(t("auth.error.rateLimited", { minutes: minutesFrom(failure.retryAfterSeconds) }));
        return;
      }
      if (failure.status === null) {
        setError(t("auth.error.network"));
        return;
      }
      // The discovery endpoint answers the same for every account; any other
      // failure (including its absence on an older backend) falls back to the
      // password step, which is always available.
      setStep("password");
    } finally {
      setDiscovering(false);
    }
  };

  const signIn = async (user: string, pass: string) => {
    const { useAuthStore } = await loadAuth();
    const login = useAuthStore.getState().login;
    try {
      // The position is passed only once the backend has asked for it.
      return locationRef.current ? await login(user, pass, locationRef.current) : await login(user, pass);
    } catch (err) {
      if (!isLocationRequired(err) || locationRef.current) throw err;
      // Retry at most once per submit, and only because the backend asked.
      const location = await requestSignInLocation();
      if (!location) {
        const denied = new Error("location denied") as Error & { locationDenied: true };
        denied.locationDenied = true;
        throw denied;
      }
      locationRef.current = location;
      return await login(user, pass, location);
    }
  };

  const failureMessage = (err: unknown, stepKind: "password" | "mfa"): string => {
    if ((err as { locationDenied?: boolean })?.locationDenied) {
      return `${t("auth.error.locationRequired")} ${t("auth.error.locationDenied")}`;
    }
    const mapped = signInMessage(readApiFailure(err), stepKind);
    return t(mapped.key, mapped.values);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const result = await signIn(username, password);
      if (result.mfaRequired) {
        // Switch to the code step; the session is not established yet.
        setMfaToken(result.mfaToken ?? null);
        setStep("mfa");
        return;
      }
      if (result.passwordChangeRequired) {
        setPasswordChangeToken(result.passwordChangeToken ?? null);
        setFirstChangeError(null);
        setPassword("");
        setStep("first");
        return;
      }
      router.push((await loadAuth()).destinationAfterSignIn(callbackUrl));
    } catch (err) {
      setError(failureMessage(err, "password"));
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * P10-16: save the new password, then sign in with it — the normal path from
   * there (an operator without MFA is sent to enrol it, P6-07).
   */
  const handleFirstPasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordChangeToken) return;
    setFirstChangeLoading(true);
    setFirstChangeError(null);
    try {
      const { authService } = await loadAuth();
      await authService.completeFirstSignIn(passwordChangeToken, newPassword);
    } catch (err) {
      const { describeApiError } = await loadAuth();
      const { status, message } = describeApiError(err);
      setFirstChangeError(
        status === 401
          ? t("auth.first.expired")
          : status === 400 && message
            ? message
            : t("auth.first.failed"),
      );
      setFirstChangeLoading(false);
      return;
    }
    // The token is spent either way; never keep it.
    setPasswordChangeToken(null);
    try {
      const result = await signIn(username, newPassword);
      setNewPassword("");
      setConfirmPassword("");
      if (result.mfaRequired) {
        setMfaToken(result.mfaToken ?? null);
        setStep("mfa");
        return;
      }
      setStep("password");
      router.push((await loadAuth()).destinationAfterSignIn(callbackUrl));
    } catch (err) {
      setStep("password");
      setError(failureMessage(err, "password"));
    } finally {
      setFirstChangeLoading(false);
    }
  };

  const cancelFirstPasswordChange = () => {
    setStep("password");
    setPasswordChangeToken(null);
    setNewPassword("");
    setConfirmPassword("");
    setFirstChangeError(null);
  };

  const handleMfaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfaToken) return;
    setMfaLoading(true);
    setError(null);
    try {
      const { useAuthStore } = await loadAuth();
      const complete = useAuthStore.getState().completeMfaLogin;
      try {
        if (locationRef.current) {
          await complete(mfaToken, mfaCode.trim(), useRecoveryCode, locationRef.current);
        } else {
          await complete(mfaToken, mfaCode.trim(), useRecoveryCode);
        }
      } catch (err) {
        if (!isLocationRequired(err) || locationRef.current) throw err;
        const location = await requestSignInLocation();
        if (!location) {
          const denied = new Error("location denied") as Error & { locationDenied: true };
          denied.locationDenied = true;
          throw denied;
        }
        locationRef.current = location;
        await complete(mfaToken, mfaCode.trim(), useRecoveryCode, location);
      }
      router.push((await loadAuth()).destinationAfterSignIn(callbackUrl));
    } catch (err) {
      const message = failureMessage(err, "mfa");
      if (message === t("auth.error.mfaExpired")) {
        // The MFA token itself expired: the code step cannot succeed any more.
        setMfaToken(null);
        setMfaCode("");
        setStep("password");
      }
      setError(message);
    } finally {
      setMfaLoading(false);
    }
  };

  const cancelMfa = () => {
    setStep("password");
    setMfaToken(null);
    setMfaCode("");
    setUseRecoveryCodeState(false);
    setError(null);
  };

  /**
   * P10-10: passwordless passkey sign-in. No identifier is asked for (the
   * credential is discoverable). A cancelled ceremony is silent. A-288: a
   * geofenced tenant's LOCATION_REQUIRED runs ONE new ceremony with the
   * position (a ceremony is single-use, so the assertion cannot be resent).
   */
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const handlePasskey = async () => {
    setError(null);
    setPasskeyLoading(true);
    const ceremony = async (location?: SignInLocation): Promise<boolean> => {
      const { authService, useAuthStore } = await loadAuth();
      const { ceremonyId, options } = await authService.passkeyOptions();
      const credential = await getPasskeyAssertion(options);
      if (!credential) return false;
      const loginWithPasskey = useAuthStore.getState().loginWithPasskey;
      if (location) await loginWithPasskey(ceremonyId, credential, location);
      else await loginWithPasskey(ceremonyId, credential);
      return true;
    };
    try {
      let signedIn: boolean;
      try {
        signedIn = await ceremony(locationRef.current ?? undefined);
      } catch (err) {
        if (!isLocationRequired(err) || locationRef.current) throw err;
        const location = await requestSignInLocation();
        if (!location) {
          const denied = new Error("location denied") as Error & { locationDenied: true };
          denied.locationDenied = true;
          throw denied;
        }
        locationRef.current = location;
        signedIn = await ceremony(location);
      }
      if (signedIn) router.push((await loadAuth()).destinationAfterSignIn(callbackUrl));
    } catch (err) {
      const failure = readApiFailure(err);
      setError(
        failure.status === 401 || failure.status === 400
          ? t("auth.error.passkey")
          : failureMessage(err, "password"),
      );
    } finally {
      setPasskeyLoading(false);
    }
  };

  /** Back from the password step to the identifier step. */
  const changeAccount = () => {
    setStep("identifier");
    setPassword("");
    setShowPassword(false);
    setError(null);
  };

  const handleSsoSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantCode.trim()) return;
    await startSso(tenantCode);
  };

  return {
    step,
    setStep,
    notice,
    username,
    setUsername,
    password,
    setPassword,
    isLoading,
    discovering,
    showPassword,
    setShowPassword,
    error,
    loginMethod,
    setLoginMethod,
    tenantCode,
    setTenantCode,
    ssoLoading,
    ssoError,
    handleIdentifierSubmit,
    handleSubmit,
    handleSsoSubmit,
    changeAccount,
    // P10-10 passkey
    passkeyLoading,
    handlePasskey,
    // MFA step
    mfaRequired,
    mfaCode,
    setMfaCode,
    mfaLoading,
    useRecoveryCode,
    setUseRecoveryCode,
    handleMfaSubmit,
    cancelMfa,
    // P10-16 first-password step
    firstPasswordChangeRequired,
    newPassword,
    setNewPassword,
    confirmPassword,
    setConfirmPassword,
    firstChangeLoading,
    firstChangeError,
    handleFirstPasswordChange,
    cancelFirstPasswordChange,
  };
}

export default useLoginForm;
