import { useAuthStore } from "@/stores/authStore";
import { CHANGE_PASSWORD_PATH, MFA_PATH } from "@/api/client";

/**
 * Where to go once signed in: the change-password screen when the account
 * must replace an administrator-set password (A-123), the MFA page when it
 * must enrol first (P6-07), else the callback. P10-04 (05 §5.1): the SSO
 * callback page routes through this too.
 *
 * P10-17 perf addendum: its own module, because it reads the auth store, and
 * the store brings the API client (axios) with it. The sign-in hook loads it
 * with the rest of that graph on first use (authRuntime.ts), so the sign-in
 * page's first load carries none of it.
 */
export const destinationAfterSignIn = (callbackUrl: string) => {
  const user = useAuthStore.getState().user;
  if (user?.mustChangePassword) return CHANGE_PASSWORD_PATH;
  // P6-07: a platform operator without MFA has an enrolment-only session.
  if (user?.mfaEnrolmentRequired) return MFA_PATH;
  return callbackUrl;
};
