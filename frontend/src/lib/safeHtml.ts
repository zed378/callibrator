import sanitizeHtml from "sanitize-html";
import { contentHtmlPolicy } from "@callibrator/contracts/contentHtml";

/**
 * A-298 — sanitize rich text AT RENDER, with the same allow-list the backend
 * applies when it stores and serves a CMS body (@callibrator/contracts/
 * contentHtml — one policy object, imported by both ends, so it cannot
 * drift). Defence in depth: a page never injects stored HTML on the strength
 * of a write-time pass alone, because a body stored before a policy fix (or
 * by a path that skipped it) would stay live.
 *
 * sanitize-html parses with htmlparser2, not the DOM, so this runs the same in
 * a server component (the public blog and news pages) and in the browser
 * (ticket detail). It emits no <script> or <style>, so the nonce CSP
 * (ADR-071) is untouched. Links get rel="noopener noreferrer".
 */
const OPTIONS: sanitizeHtml.IOptions = {
  ...contentHtmlPolicy(),
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer" }),
  },
};

/**
 * The HTML with everything outside the shared allow-list removed.
 *
 * @param html - untrusted rich text (null or undefined reads as empty)
 * @returns HTML safe to pass to dangerouslySetInnerHTML
 */
export function safeHtml(html: string | null | undefined): string {
  return sanitizeHtml(html ?? "", OPTIONS);
}
