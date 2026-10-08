/**
 * P10-19: the auth service — and with it axios, the API client and the store
 * the client reports access denials to — loaded on demand by the public forms
 * that call it (/request-access, /forgot-password, /invitation), as /login
 * does through app/login/hooks/authRuntime.ts. Imported statically, this graph
 * was ~20 KB brotli (~22 KB gzip) of each page's first-load JavaScript.
 *
 * The forms call `loadAuthService()` at the point of use and prefetch it with
 * `usePrefetchOnFirstInput(loadAuthService)`; the requests they send are the
 * service's own, unchanged.
 */
export const loadAuthService = () => import("@/api/services/auth.service").then((m) => m.authService);
