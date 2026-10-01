/**
 * The app's page redirects, read by next.config.ts `redirects()` (kept here,
 * under src/, so a unit test can read them — as securityHeaders.ts is).
 */
export interface PageRedirect {
  source: string;
  destination: string;
  permanent: boolean;
}

export const PAGE_REDIRECTS: PageRedirect[] = [
  // P10-06 (ADR-098 §6): self-registration is replaced by Request access.
  // `permanent: true` answers 308, which keeps the method.
  { source: "/register", destination: "/request-access", permanent: true },
  // ADR-102: one warehouse page. The menu links /dashboard/warehouses;
  // /dashboard/warehouse served the same page under a second address. Not
  // permanent: the page's source still lives in app/dashboard/warehouse.
  { source: "/dashboard/warehouse", destination: "/dashboard/warehouses", permanent: false },
];
