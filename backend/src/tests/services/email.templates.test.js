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
const ALL_TEMPLATES = [...LIVE_TEMPLATES, "account.html", "certificate.html"];

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
