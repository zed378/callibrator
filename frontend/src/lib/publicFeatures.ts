/**
 * Switches for public-surface features that wait on another card.
 *
 * CERTIFICATE_LOOKUP_ENABLED — the landing's "certificate number" field
 * (doc 20 §6.5). It ships ONLY once P10-14 (the random verification token and
 * the minimal verdict for a typed number, A-293 / ADR-100) is DONE; until then
 * the section shows the QR explanation and the phone mock-up. Flipping it is a
 * reviewed change with the P10-14 record cited (TASKS/PHASE-10 P10-03 DoD).
 */
export const CERTIFICATE_LOOKUP_ENABLED = false;

/**
 * PASSKEY_SIGN_IN_ENABLED — the sign-in page's passkey button (doc 20 §7.5).
 * On since 2026-09-30: P10-10's pre-authentication ceremony
 * (POST /auth/passkey/options|verify, ADR-108) is merged, and the coordinator
 * asked for the button to be wired. P10-10 itself stays IN REVIEW until its
 * virtual-authenticator live E2E (P10-13) runs. Turning this off hides the
 * button and nothing else.
 */
export const PASSKEY_SIGN_IN_ENABLED = true;
