/** @jest-environment jsdom */
/**
 * Q-42 (ADR-113) — a form collecting personal data does not open before its
 * privacy notice exists.
 *
 * PRIVACY_NOTICE_URL unset (or not an absolute http(s) URL):
 *  - /request-access shows a short neutral "not open yet" notice, no form, no
 *    input that collects anything, and the contact channels only if configured;
 *  - the footer has no privacy link, and nothing on the page links to a notice.
 * Set:
 *  - the form is shown and its consent links to the notice (new tab, announced);
 *  - the footer shows "Kebijakan Privasi" / "Privacy Notice" linking to it.
 *
 * Fail-before: the page rendered the form (and a consent naming a notice that
 * did not exist) whatever the configuration, and the footer had no privacy link.
 */
import { render, screen, within } from "@testing-library/react";
import { renderServer } from "@/tests/support/serverTree";
import { axeViolations } from "@/tests/a11y/axe";

let mockLocale: string | undefined;
const mockCookies = jest.fn(async () => ({
  get: (n: string) => (n === "locale" && mockLocale ? { value: mockLocale } : undefined),
}));
jest.mock("next/headers", () => ({ cookies: () => mockCookies() }));
jest.mock("@/i18n/actions", () => ({ setLocale: jest.fn() }));
jest.mock("@/api/client", () => ({ api: { post: jest.fn() } }));
jest.mock("@/app/fonts/public", () => ({
  publicDisplayFont: { variable: "font-pub-display" },
  publicDisplayItalicFont: { variable: "font-pub-display-italic" },
  publicBodyFont: { variable: "font-pub-sans" },
}));

import RequestAccessPage from "../page";
import { PublicFooter } from "@/components/public/PublicFooter";
import { privacyNoticeUrl } from "@/components/public/privacyNotice";
import { createTranslator } from "@/i18n";
import { en } from "@/i18n/messages/en";
import { id } from "@/i18n/messages/id";

const env = process.env as Record<string, string | undefined>;
const NOTICE = "https://example.test/privacy-notice";

beforeEach(() => {
  mockLocale = undefined;
  delete env.PRIVACY_NOTICE_URL;
  delete env.NEXT_PUBLIC_CONTACT_WHATSAPP;
  delete env.NEXT_PUBLIC_CONTACT_EMAIL;
});
afterAll(() => {
  delete env.PRIVACY_NOTICE_URL;
});

const renderPage = async () => renderServer(RequestAccessPage());

describe("Q-42: privacyNoticeUrl", () => {
  it.each([
    [undefined, null],
    ["", null],
    ["  ", null],
    ["/privacy", null],
    ["javascript:alert(1)", null],
    ["ftp://example.test/p", null],
    [` ${NOTICE} `, NOTICE],
    ["http://localhost:3000/privacy", "http://localhost:3000/privacy"],
  ])("%j -> %j", (raw, expected) => {
    expect(privacyNoticeUrl(raw)).toBe(expected);
  });
});

describe("Q-42: /request-access with no published notice", () => {
  it("shows the neutral 'not open yet' notice: one <h1>, no form, no input, no notice link, axe-clean", async () => {
    mockLocale = "en";
    const { container } = await renderPage();
    const main = screen.getByRole("main");
    expect(within(main).getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(within(main).getByRole("heading", { level: 1 })).toHaveTextContent(en["access.closed.title"]);
    expect(within(main).getByText(en["access.closed.leadNoChannels"])).toBeInTheDocument();
    expect(container.querySelector("main form")).toBeNull();
    expect(container.querySelectorAll("main input, main textarea, main select")).toHaveLength(0);
    expect(screen.queryByRole("link", { name: /Privacy Notice/ })).not.toBeInTheDocument();
    expect(container.innerHTML).not.toContain("wa.me");
    expect(container.innerHTML).not.toContain("mailto:");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("offers the configured contact channels, and only those", async () => {
    env.NEXT_PUBLIC_CONTACT_EMAIL = "sales@example.test";
    const { container } = await renderPage();
    expect(screen.getByText(id["access.closed.lead"])).toBeInTheDocument();
    const mail = screen.getByRole("link", { name: id["landing.hero.ctaEmail"] });
    expect(mail.getAttribute("href")).toMatch(/^mailto:sales@example\.test\?subject=/);
    expect(container.innerHTML).not.toContain("wa.me");
  });

  it("a malformed URL is the same as none", async () => {
    env.PRIVACY_NOTICE_URL = "/privacy";
    const { container } = await renderPage();
    expect(container.querySelector("main form")).toBeNull();
  });
});

describe("Q-42: /request-access with the notice published", () => {
  it("shows the form, and its consent links to the notice in a new tab (announced)", async () => {
    env.PRIVACY_NOTICE_URL = NOTICE;
    mockLocale = "en";
    const { container } = await renderPage();
    expect(container.querySelector("main form")).not.toBeNull();
    const link = screen.getByRole("link", { name: `${en["access.consent.notice"]} (${en["access.newTab"]})` });
    expect(link).toHaveAttribute("href", NOTICE);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    // The checkbox is named by the whole sentence, the notice's name included.
    expect(screen.getByRole("checkbox")).toHaveAccessibleName(/^I agree that the data in this form .* Privacy Notice \(opens in a new tab\)/);
  });
});

describe("Q-42: the footer links to the notice only once it exists", () => {
  const renderFooter = (locale: "id" | "en") =>
    render(<PublicFooter locale={locale} t={createTranslator(locale === "en" ? en : id)} year={2026} />);

  it("unset: no privacy link", () => {
    renderFooter("id");
    expect(screen.queryByRole("link", { name: id["pub.footer.privacy"] })).not.toBeInTheDocument();
  });

  it("set: 'Kebijakan Privasi' / 'Privacy Notice', linking to it", () => {
    env.PRIVACY_NOTICE_URL = NOTICE;
    const { unmount } = renderFooter("id");
    expect(screen.getByRole("link", { name: "Kebijakan Privasi" })).toHaveAttribute("href", NOTICE);
    unmount();
    renderFooter("en");
    expect(screen.getByRole("link", { name: "Privacy Notice" })).toHaveAttribute("href", NOTICE);
  });
});
