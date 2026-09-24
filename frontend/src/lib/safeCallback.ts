/**
 * F-60: the page to return to after sign-in, from a `callbackUrl` query
 * parameter — only when it is a path on THIS origin. Anything else falls back
 * to `fallback`.
 *
 * `callbackUrl` arrives in the URL, so anyone can write it: without this check
 * `/login?callbackUrl=https://evil.example` signed the user in and then sent
 * them, via router.push, to a page the attacker controls — an open redirect
 * that borrows the hospital's login page for phishing. Refused:
 * absolute URLs (`https:`, `javascript:`), protocol-relative `//host`, the
 * backslash forms browsers normalise to `//` (`/\host`), and control
 * characters.
 */
export const safeCallbackPath = (
  callbackUrl: string | null | undefined,
  fallback = "/dashboard",
): string => {
  if (!callbackUrl) return fallback;
  if (!callbackUrl.startsWith("/")) return fallback;
  if (callbackUrl.startsWith("//") || callbackUrl.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(callbackUrl)) return fallback;
  return callbackUrl;
};
