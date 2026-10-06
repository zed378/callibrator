/** @jest-environment jsdom */
/**
 * P10-03 (doc 20 §6) — the landing, rendered from its server component.
 *
 *  - one <main>, one <h1>; the hero <h1> is in the server HTML with no
 *    hidden-until-hydration class (no opacity-0 LCP, 05 §7.3);
 *  - Indonesian by default, English under the cookie;
 *  - a contact channel whose configuration is empty is HIDDEN (no wa.me, no
 *    mailto), and the request-access link is always present (Q-41);
 *  - configured channels render as wa.me / mailto links with the prefilled text;
 *  - the certificate-number field is absent while P10-14 is not DONE;
 *  - FAQ is native <details>; no marquee, no pricing, no trial;
 *  - the public page graph imports no animation library (GSAP, ScrollTrigger,
 *    SplitText, Lenis, Motion) — checked on the sources;
 *  - since fb55605 the page is a prerenderable SHELL (no cookie read) with the
 *    locale-aware body in a <Suspense> boundary; its fallback is an aria-hidden
 *    skeleton with no heading and no <main>, so the first flush adds no second
 *    landmark. The body is rendered as the server streams it once resolved
 *    (tests/support/serverTree: the client renderer refuses an async component).
 */
import fs from "node:fs";
import path from "node:path";
import { render, screen, within } from "@testing-library/react";
import { findSuspense, renderServer } from "@/tests/support/serverTree";
import { axeViolations } from "@/tests/a11y/axe";

let mockLocale: string | undefined;
const mockCookies = jest.fn(async () => ({
  get: (n: string) => (n === "locale" && mockLocale ? { value: mockLocale } : undefined),
}));
jest.mock("next/headers", () => ({ cookies: () => mockCookies() }));
jest.mock("@/i18n/actions", () => ({ setLocale: jest.fn() }));
// next/font/local is a build-time transform; Jest only needs the class names.
jest.mock("@/app/fonts/public", () => ({
  publicDisplayFont: { variable: "font-pub-display" },
  publicDisplayItalicFont: { variable: "font-pub-display-italic" },
  publicBodyFont: { variable: "font-pub-sans" },
}));

import Home from "../page";
import { contactChannels } from "@/components/public/contact";
import { id } from "@/i18n/messages/id";
import { en } from "@/i18n/messages/en";

const env = process.env as Record<string, string | undefined>;

beforeEach(() => {
  mockCookies.mockClear();
  mockLocale = undefined;
  delete env.NEXT_PUBLIC_CONTACT_WHATSAPP;
  delete env.NEXT_PUBLIC_CONTACT_EMAIL;
});

const renderHome = async () => renderServer(Home());

describe("P10-03: landing", () => {
  it("one <main>, one visible <h1>, Indonesian by default, axe-clean", async () => {
    const { container } = await renderHome();
    expect(container.querySelectorAll("main")).toHaveLength(1);
    const h1s = screen.getAllByRole("heading", { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveTextContent(id["landing.hero.title"]);
    expect(h1s[0].className).not.toMatch(/opacity-0|invisible|hidden/);
    expect(container.querySelector("[data-surface='public']")).not.toBeNull();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("P10-17: the certificate explorer renders as page.tsx calls it — four named slides and dashes, in both languages", async () => {
    await renderHome();
    for (let n = 1; n <= 4; n += 1) {
      const name = id["landing.cert.slide"].replace("{n}", String(n)).replace("{total}", "4");
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
      expect(screen.getByRole("group", { name })).toBeInTheDocument();
    }
    expect(screen.getByRole("group", { name: id["landing.cert.carousel"] })).toBeInTheDocument();
  });

  it("P10-17: the certificate explorer in English", async () => {
    mockLocale = "en";
    await renderHome();
    expect(screen.getByRole("button", { name: "Explanation 4 of 4" })).toBeInTheDocument();
  });

  it("follows the English cookie", async () => {
    mockLocale = "en";
    await renderHome();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(en["landing.hero.title"]);
  });

  it("hides an unconfigured contact channel; the request-access link is always there", async () => {
    const { container } = await renderHome();
    expect(container.querySelector('a[href^="https://wa.me"]')).toBeNull();
    expect(container.querySelector('a[href^="mailto:"]')).toBeNull();
    const hero = screen.getByRole("region", { name: id["landing.hero.title"] });
    expect(within(hero).getByRole("link", { name: new RegExp(id["landing.hero.ctaRequest"]) })).toHaveAttribute(
      "href",
      "/request-access",
    );
  });

  it("builds wa.me and mailto links from configuration", () => {
    const c = contactChannels(
      { whatsappText: "Halo", emailSubject: "Diskusi" },
      { whatsapp: "0812-3456-7890", email: "sales@contoh.test" },
    );
    expect(c.whatsappUrl).toBe("https://wa.me/6281234567890?text=Halo");
    expect(c.emailUrl).toBe("mailto:sales@contoh.test?subject=Diskusi");
    expect(contactChannels({ whatsappText: "", emailSubject: "" }, { whatsapp: " ", email: "not-an-email" })).toEqual({
      whatsappUrl: null,
      emailUrl: null,
    });
  });

  it("shows no certificate-number field while P10-14 is not DONE; FAQ is native <details>", async () => {
    const { container } = await renderHome();
    expect(screen.queryByLabelText(id["landing.verify.label"])).not.toBeInTheDocument();
    expect(container.querySelectorAll("details")).toHaveLength(6);
    const text = container.textContent ?? "";
    for (const gone of ["Start free trial", "Pricing", "HIPAA", "SOC 2", "SNARS", "12,000", "randomuser"]) {
      expect([gone, text.includes(gone)]).toEqual([gone, false]);
    }
  });

  it("the page shell reads no cookie (prerenderable); the locale is read inside its Suspense boundary", async () => {
    const shell = Home();
    expect(shell).not.toBeInstanceOf(Promise);
    expect(mockCookies).not.toHaveBeenCalled();
    expect(findSuspense(shell)).not.toBeNull();
    await renderServer(shell);
    expect(mockCookies).toHaveBeenCalled();
  });

  it("the Suspense fallback is an aria-hidden skeleton: no heading, no <main>, no text", () => {
    const suspense = findSuspense(Home());
    const { container } = render(<>{suspense?.props.fallback}</>);
    const skeleton = container.firstElementChild as HTMLElement;
    expect(skeleton).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector("main, h1, h2, a, button")).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("no animation library is imported by the public page graph", () => {
    const root = path.resolve(__dirname, "../..");
    const files = [
      "app/page.tsx",
      ...fs.readdirSync(path.join(root, "components/public")).map((f) => `components/public/${f}`),
      ...fs.readdirSync(path.join(root, "components/public/landing")).map((f) => `components/public/landing/${f}`),
    ].filter((f) => /\.tsx?$/.test(f));
    for (const f of files) {
      const code = fs.readFileSync(path.join(root, f), "utf8");
      expect([f, /from "(gsap|@gsap\/react|lenis|motion\/react|motion)"|components\/motion\//.test(code)]).toEqual([f, false]);
    }
  });
});
