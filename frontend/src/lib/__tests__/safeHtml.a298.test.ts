/**
 * A-298 — the render-time sanitizer is the backend's policy.
 *
 * lib/safeHtml builds its options from @callibrator/contracts/contentHtml,
 * the policy the backend applies on write and on read.
 */
import { safeHtml } from "../safeHtml";

describe("safeHtml (A-298)", () => {
  it("removes data: links, handlers and scripts; keeps https, mailto and relative URLs", () => {
    expect(safeHtml('<a href="data:text/html,x">a</a>')).toBe('<a rel="noopener noreferrer">a</a>');
    expect(safeHtml('<img src="data:image/svg+xml,x" onerror="alert(1)">')).toBe("<img />");
    expect(safeHtml("<p>a<script>alert(1)</script></p>")).toBe("<p>a</p>");
    expect(safeHtml('<a href="mailto:a@e.x">m</a><img src="/uploads/public/a.png">')).toBe(
      '<a href="mailto:a@e.x" rel="noopener noreferrer">m</a><img src="/uploads/public/a.png" />',
    );
  });

  it("reads null and undefined as empty", () => {
    expect(safeHtml(null)).toBe("");
    expect(safeHtml(undefined)).toBe("");
  });
});
