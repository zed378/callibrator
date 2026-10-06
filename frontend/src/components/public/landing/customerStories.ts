/**
 * P10-17 (ADR-118, brief §5 "Social proof"): the slot for real customer
 * stories. EMPTY ON PURPOSE — there is no real, permitted customer material
 * yet (doc 20 §1 non-goals), and an invented quote, face, logo or number is
 * exactly what P10-00 removed. The landing renders this list only when it is
 * non-empty.
 *
 * To add a story: the hospital's written permission first, then a row here
 * with its source recorded in doc 20 §11 and the permission in the asset
 * register (§12) — the P10-11 guard checks the dictionary, not this file, so
 * the review is the control. No photograph of a patient, ever.
 */
import type { Locale } from "@/i18n/config";

export interface CustomerStory {
  id: string;
  /** The person's real name, with their permission. */
  name: string;
  role: Record<Locale, string>;
  /** The facility's real name, with its permission. */
  facility: string;
  quote: Record<Locale, string>;
  /** Where the permission is recorded (a record or the asset register row). */
  permission: string;
}

export const CUSTOMER_STORIES: readonly CustomerStory[] = [];
