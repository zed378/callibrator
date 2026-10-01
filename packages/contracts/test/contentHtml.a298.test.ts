/**
 * A-298 / A-299 — the two data-only contracts, as sanitize-html and the
 * API-key dialog read them.
 *
 * Fail-before (A-298): the policy content.service used until A-298 listed
 * `data` in allowedSchemes, and sanitize-html kept
 * `<a href="data:text/html,...">`; the first test runs the attack through the
 * shared policy and asserts the href is gone.
 */
import sanitizeHtml from "sanitize-html";
import * as barrel from "@callibrator/contracts";
import {
  CONTENT_HTML_IMAGE_SCHEMES,
  CONTENT_HTML_LINK_SCHEMES,
  contentHtmlPolicy,
} from "@callibrator/contracts/contentHtml";
import { API_KEY_SCOPE_ACTIONS, API_KEY_SCOPE_RESOURCES, apiKeyScope } from "@callibrator/contracts/apiKeyScopes";

const clean = (html: string): string => sanitizeHtml(html, contentHtmlPolicy());

describe("contentHtmlPolicy (A-298)", () => {
  it("drops a data: link, keeping its text", () => {
    const out = clean('<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">x</a>');
    expect(out).toBe("<a>x</a>");
  });

  it("drops data: and javascript: images and links of every spelling", () => {
    expect(clean('<img src="data:image/svg+xml,<svg onload=alert(1)>">')).toBe("<img />");
    expect(clean('<img src="data:image/png;base64,AAAA">')).toBe("<img />");
    expect(clean('<a href="JaVaScRiPt:alert(1)">x</a>')).toBe("<a>x</a>");
    expect(clean('<a href=" data:text/html,x">x</a>')).toBe("<a>x</a>");
  });

  it("strips script, handlers and unknown tags", () => {
    expect(clean('<p onclick="x()">a<script>alert(1)</script></p><iframe src="https://e.x"></iframe>')).toBe("<p>a</p>");
    expect(clean('<img src="https://e.x/a.png" onerror="alert(1)">')).toBe('<img src="https://e.x/a.png" />');
  });

  it("keeps http(s), mailto and relative links and images", () => {
    expect(clean('<a href="https://e.x">a</a><a href="mailto:a@e.x">m</a>')).toBe(
      '<a href="https://e.x">a</a><a href="mailto:a@e.x">m</a>',
    );
    expect(clean('<img src="/uploads/public/a.png" alt="a">')).toBe('<img src="/uploads/public/a.png" alt="a" />');
    expect(clean('<p style="text-align:center">c</p>')).toBe('<p style="text-align:center">c</p>');
  });

  it("names no data scheme anywhere and hands out a fresh copy each call", () => {
    expect(CONTENT_HTML_LINK_SCHEMES).toEqual(["http", "https", "mailto"]);
    expect(CONTENT_HTML_IMAGE_SCHEMES).toEqual(["http", "https"]);
    const a = contentHtmlPolicy();
    a.allowedSchemes.push("data");
    expect(contentHtmlPolicy().allowedSchemes).not.toContain("data");
    expect(barrel.contentHtmlPolicy).toBe(contentHtmlPolicy);
  });
});

describe("API-key scopes (A-299)", () => {
  it("are lowercase slugs with read or write, no wildcard", () => {
    expect(API_KEY_SCOPE_ACTIONS).toEqual(["read", "write"]);
    for (const r of API_KEY_SCOPE_RESOURCES) {
      expect(r).toMatch(/^[a-z][a-z-]*$/);
    }
    expect(new Set(API_KEY_SCOPE_RESOURCES).size).toBe(API_KEY_SCOPE_RESOURCES.length);
    expect(apiKeyScope("equipment", "read")).toBe("equipment:read");
    expect(barrel.API_KEY_SCOPE_RESOURCES).toBe(API_KEY_SCOPE_RESOURCES);
  });
});
