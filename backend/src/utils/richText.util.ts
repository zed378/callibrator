/**
 * Sanitize user-written rich HTML at save time with the ONE shared allow-list
 * (@callibrator/contracts/contentHtml, A-298) that the frontend applies again
 * at render, so the two passes cannot drift.
 *
 * Used by the ticket description (A-318). content.service keeps its own copy
 * of the same options (A-298) until it adopts this helper.
 */
import sanitizeHtml from "sanitize-html";
import { contentHtmlPolicy } from "@callibrator/contracts/contentHtml";

const OPTIONS: sanitizeHtml.IOptions = {
  ...contentHtmlPolicy(),
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer" }),
  },
};

/**
 * The HTML with everything outside the shared policy removed.
 *
 * @param html - rich text as the editor sent it
 * @returns the sanitized HTML
 */
export const sanitizeRichText = (html: string): string => sanitizeHtml(html, OPTIONS);

/**
 * A nullable rich-text field as stored: absent or empty stays null, anything
 * else is sanitized.
 *
 * @param value - the field as sent (the validators admit a string or null)
 * @returns the sanitized HTML, or null
 */
export const storedRichText = (value: string | null | undefined): string | null =>
  value === null || value === undefined || value === "" ? null : sanitizeRichText(value);
