/**
 * ADR-102 — one warehouse page: /dashboard/warehouse (a second address for the
 * same page) redirects to /dashboard/warehouses, the address the menu links.
 * next.config.ts `redirects()` returns PAGE_REDIRECTS; redirects run before
 * the filesystem routes.
 *
 * Fail-before: the only redirect was /register.
 */
import { PAGE_REDIRECTS } from "./redirects";

describe("page redirects", () => {
  it("ADR-102: /dashboard/warehouse → /dashboard/warehouses (temporary)", () => {
    expect(PAGE_REDIRECTS).toContainEqual({
      source: "/dashboard/warehouse",
      destination: "/dashboard/warehouses",
      permanent: false,
    });
  });

  it("P10-06: /register → /request-access stays permanent", () => {
    expect(PAGE_REDIRECTS).toContainEqual({ source: "/register", destination: "/request-access", permanent: true });
  });
});
