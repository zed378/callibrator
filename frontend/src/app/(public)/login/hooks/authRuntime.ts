/**
 * P10-17 perf addendum: everything the sign-in steps need from the API layer,
 * in one module the hook loads with `import()` — on first use, or when the
 * browser is idle after the page is up (useLoginForm). Statically imported,
 * this graph (axios, the auth service, the auth store and the stores it
 * resets) was ~32 KB gzip of the page's first-load JavaScript, downloaded and
 * evaluated before the sign-in heading could count as painted.
 */
export { authService } from "@/api/services/auth.service";
export { useAuthStore } from "@/stores/authStore";
export { describeApiError } from "@/api/client";
export { destinationAfterSignIn } from "./destination";
