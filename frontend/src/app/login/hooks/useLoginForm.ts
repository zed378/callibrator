import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuthStore } from "@/stores/authStore";
import { authService } from "@/api/services/auth.service";
import { CHANGE_PASSWORD_PATH } from "@/api/client";

/**
 * Where to go once signed in: the change-password screen when the account
 * must replace an administrator-set password (A-123), else the callback.
 */
const destinationAfterSignIn = (callbackUrl: string) =>
  useAuthStore.getState().user?.mustChangePassword
    ? CHANGE_PASSWORD_PATH
    : callbackUrl;

export function useLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/dashboard";

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const { login, completeMfaLogin, error } = useAuthStore();

  const [loginMethod, setLoginMethod] = useState<"password" | "sso">("password");
  const [tenantCode, setTenantCode] = useState("");
  const [ssoProtocol, setSsoProtocol] = useState<"saml" | "oidc">("saml");
  const [ssoLoading, setSsoLoading] = useState(false);
  const [ssoError, setSsoError] = useState<string | null>(null);

  // Second-factor step state.
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaLoading, setMfaLoading] = useState(false);
  // A-141: sign in with a one-time recovery code instead of the app's code.
  const [useRecoveryCode, setUseRecoveryCodeState] = useState(false);

  const setUseRecoveryCode = (value: boolean) => {
    setUseRecoveryCodeState(value);
    // The two inputs have different shapes; never carry one into the other.
    setMfaCode("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const result = await login(username, password);
      if (result.mfaRequired) {
        // Switch to the code step; the session is not established yet.
        setMfaToken(result.mfaToken ?? null);
        setMfaRequired(true);
        return;
      }
      router.push(destinationAfterSignIn(callbackUrl));
    } catch (err) {
      console.error("[Login] Login failed:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleMfaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfaToken) return;
    setMfaLoading(true);
    try {
      await completeMfaLogin(mfaToken, mfaCode.trim(), useRecoveryCode);
      router.push(destinationAfterSignIn(callbackUrl));
    } catch (err) {
      console.error("[Login] MFA verification failed:", err);
    } finally {
      setMfaLoading(false);
    }
  };

  const cancelMfa = () => {
    setMfaRequired(false);
    setMfaToken(null);
    setMfaCode("");
    setUseRecoveryCodeState(false);
  };

  const handleSsoSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSsoLoading(true);
    setSsoError(null);

    try {
      const result =
        ssoProtocol === "oidc"
          ? await authService.oidcSsoLogin(tenantCode)
          : await authService.ssoLogin(tenantCode);
      if (result && result.redirectUrl) {
        window.location.href = result.redirectUrl;
      } else {
        setSsoError("Failed to initiate SSO: redirect URL missing");
      }
    } catch (err) {
      console.error("[Login] SSO failed:", err);
      setSsoError(err instanceof Error ? err.message : "Single Sign-On initialization failed");
    } finally {
      setSsoLoading(false);
    }
  };

  return {
    username,
    setUsername,
    password,
    setPassword,
    isLoading,
    showPassword,
    setShowPassword,
    error,
    loginMethod,
    setLoginMethod,
    tenantCode,
    setTenantCode,
    ssoProtocol,
    setSsoProtocol,
    ssoLoading,
    ssoError,
    handleSubmit,
    handleSsoSubmit,
    // MFA step
    mfaRequired,
    mfaCode,
    setMfaCode,
    mfaLoading,
    useRecoveryCode,
    setUseRecoveryCode,
    handleMfaSubmit,
    cancelMfa,
  };
}

export default useLoginForm;
