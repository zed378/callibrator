/**
 * Q-42 (ADR-113) — the published privacy notice, or null.
 *
 * `PRIVACY_NOTICE_URL` is read on the SERVER at request time (not a
 * `NEXT_PUBLIC_*` value inlined at build): public pages render per request
 * under the nonce CSP (ADR-090), so an operator publishes the notice and sets
 * the variable without a rebuild. The backend reads the same variable and keeps
 * `POST /access-requests` absent while it is unset.
 *
 * Only an absolute http(s) URL counts; anything else reads as unset, so nothing
 * ever links to a document that is not there. While it is null:
 *   - /request-access shows the "not open yet" notice instead of the form;
 *   - the footer shows no privacy link.
 * Call it from server components only (a client bundle never sees the value).
 */
export const privacyNoticeUrl = (raw: string | undefined = process.env.PRIVACY_NOTICE_URL): string | null => {
  const value = raw?.trim() ?? "";
  if (value === "") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
};
