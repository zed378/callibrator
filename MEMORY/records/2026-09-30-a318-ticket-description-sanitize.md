# 2026-09-30 — A-318: a ticket description is sanitized when it is saved

**Finding:** A-318 (`TASKS/AUDIT-2026-09-REMEDIATION.md`). The coordinator raised it as a follow-up to A-298.

## Decision: rich HTML, not plain text

The description is written in the TipTap `RichTextEditor` (`CreateTicketModal`, pasted images uploaded as Ticket attachments), and the detail page renders it as HTML (`[ticketId]/page.tsx`, `safeHtml`). Stripping it to text would break every existing ticket's formatting and images. So it stays rich HTML, sanitized **at save** with the one shared policy (`@callibrator/contracts/contentHtml`, A-298), the same one the page applies again at render.

## The change

- **New `backend/src/utils/richText.util.ts`:**
  - `sanitizeRichText(html)`: `sanitize-html` with `contentHtmlPolicy()`, and `rel="noopener noreferrer"` on links, as content.service does.
  - `storedRichText(value)`: null, undefined or an empty string stay null; anything else is sanitized.
- **`backend/src/services/ticket.service.js`:** `createTicket` stores `storedRichText(data.description)`, and `updateTicket` sanitizes a `description` in the patch.
- `content.service.ts` keeps its own copy of the same options. Adopting the helper there is left to its owner.

## Evidence

**`backend/src/tests/routes/ticket.descriptionSanitize.a318.test.ts`** runs the real router, validate, controller, ticket service and models over memoryDb. Its only raw SQL, the ticket-counter upsert, is answered deliberately.
- **Before the fix, 2 of 4 failed.** POST / and PATCH /:ticketId stored `<script>`, `onerror`, `javascript:` and `<iframe>` verbatim.
- The two controls passed: the editor's own markup is kept, and null clears.
- **After the fix, 4 of 4 pass.**

**Ticket suites:** `npm test -- --testPathPatterns "descriptionSanitize\.a318|ticket|tickets"` passed 107/107.
- `richText.util.ts` is at 100%.
- `ticket.service.js` is at 99.4%. Its one uncovered line, 92 (the assignee 404), is in another lane's in-flight change to that file, not this one.

**Lint** is clean on all three files.
