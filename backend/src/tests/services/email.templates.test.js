/**
 * Template-level checks, against the REAL template files rather than mocks.
 *
 * email.service.test.js mocks `fs` and `mustache`, so it can prove the service
 * passes the right context and nothing about what the templates actually
 * render. These two defects both lived entirely inside the HTML:
 *
 *   1. every template hard-coded https://fullfind.co — another company's logo
 *      and contact address, inherited from the boilerplate. Beyond the wrong
 *      branding, it made each recipient's mail client fetch from a third party.
 *   2. mustache's {{ }} escapes "/" to &#x2F;, so an interpolated URL rendered
 *      as src="https:&#x2F;&#x2F;host&#x2F;..." — which a strict parser decodes
 *      but email clients handle inconsistently. URLs need {{{ }}}.
 */
const fs = require("fs");
const path = require("path");
const mustache = require("mustache");

const TEMPLATE_DIR = path.join(__dirname, "..", "..", "templates");
const LIVE_TEMPLATES = ["template.html", "otp.html"];
// certificate.html is gone: the backend renders no certificate PDF (M-11, ADR-095).
const ALL_TEMPLATES = [...LIVE_TEMPLATES, "account.html"];

const CTX = {
  appUrl: "https://calibrator.example.com",
  appName: "Device Calibrator",
  logoUrl: "https://calibrator.example.com/brand/logo-email.png",
  supportEmail: "noreply@calibrator.example.com",
  firstName: "Budi",
  lastName: "Santoso",
  link: "https://calibrator.example.com/activate/abc",
  otp: "123456",
};

describe("email templates", () => {
  // Case-INSENSITIVE on purpose. A case-sensitive grep for the domain reported
  // the templates clean while "FullFind" still sat in the footer as readable
  // text, which every recipient would have seen.
  it.each(ALL_TEMPLATES)("%s names no third party", (name) => {
    const raw = fs.readFileSync(path.join(TEMPLATE_DIR, name), "utf8");
    expect(raw).not.toMatch(/fullfind/i);
  });

  // The boilerplate these templates came from carried another product's copy
  // ("students", "$1000++ jobs", a fictional street address) and a blue
  // (#669ae9) that is in neither the logo nor the app's tokens.
  it.each(ALL_TEMPLATES)("%s carries no boilerplate copy", (name) => {
    const raw = fs.readFileSync(path.join(TEMPLATE_DIR, name), "utf8");
    expect(raw).not.toMatch(/antahberantah|student|\$1000|quests|submission/i);
  });

  // Brand palette (ADR-118 Amendment 2): the warm light palette of the public
  // site and of frontend/public/brand/mark.svg — charcoal text, copper accent,
  // cream page, paper card. The retired navy #001250 / teal #00DAB4 and the
  // slate neutrals they came with must not return, nor the boilerplate blues.
  it.each(ALL_TEMPLATES)("%s uses the brand palette and nothing off-brand", (name) => {
    const raw = fs.readFileSync(path.join(TEMPLATE_DIR, name), "utf8").toLowerCase();
    expect(raw).toContain("#1f1b17"); // charcoal text
    expect(raw).toContain("#9a4e22"); // copper accent
    expect(raw).toContain("#f4ecdf"); // cream page
    expect(raw).toContain("#fffdf8"); // paper card
    expect(raw).not.toMatch(/#001250|#00dab4/);
    expect(raw).not.toMatch(/#0f172a|#475569|#f1f5f9|#e2e8f0/);
    expect(raw).not.toMatch(/#669ae9|#4f46e5/);
  });

  // The accent bar is copper: the 4px row directly above the logo.
  it.each(ALL_TEMPLATES)("%s draws the accent bar in copper", (name) => {
    const raw = fs.readFileSync(path.join(TEMPLATE_DIR, name), "utf8");
    expect(raw).toMatch(/height:4px;[^"]*background-color:#9A4E22/);
  });

  // The logo is a 480x200 wordmark: once, in the header, at a legible size —
  // not a hidden 600px spacer and a 35px footer icon as before.
  it.each(ALL_TEMPLATES)("%s shows the logo once, with alt text", (name) => {
    const out = mustache.render(fs.readFileSync(path.join(TEMPLATE_DIR, name), "utf8"), CTX);
    const imgs = [...out.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
    expect(imgs).toHaveLength(1);
    expect(imgs[0]).toContain(`alt="${CTX.appName}"`);
  });

  describe.each(LIVE_TEMPLATES)("%s", (name) => {
    const render = () =>
      mustache.render(fs.readFileSync(path.join(TEMPLATE_DIR, name), "utf8"), CTX);

    it("renders the logo as a usable URL, not an entity-escaped one", () => {
      const out = render();
      expect(out).toContain(`src="${CTX.logoUrl}"`);
      // The failure this guards: src="https:&#x2F;&#x2F;host&#x2F;..."
      expect(out).not.toContain("&#x2F;");
    });

    it("points every branded link at this deployment", () => {
      const out = render();
      const hosts = [...out.matchAll(/(?:src|href)="(https?:\/\/[^/"]+)/g)].map(
        (m) => m[1],
      );
      const foreign = hosts.filter((h) => h !== CTX.appUrl);
      expect(foreign).toEqual([]);
    });

    it("leaves no placeholder unresolved", () => {
      const out = render();
      expect(out).not.toMatch(/\{\{\{?\s*\w+\s*\}?\}\}/);
    });
  });
});
