/**
 * P10-17 (ADR-118 §2, doc 20 §12): the landing's photographs — free-licence
 * (Unsplash License), self-hosted as WebP under public/marketing/people/
 * because the CSP allows no third-party image origin. Each file has a row in
 * the asset register (doc 20 §12: source URL, author, licence, subject), which
 * src/tests/public/copyTruthfulness.p1011.test.ts enforces.
 *
 * Rules: every photograph is captioned as an illustration; nobody in one is
 * presented as a customer, as our staff, or as the speaker of a quote.
 */
import type { MessageKey } from "@/i18n";

export interface LandingPhoto {
  src: string;
  width: number;
  height: number;
  altKey: MessageKey;
}

export const LANDING_PHOTOS = {
  /** The landing hero (P10-17 second pass): a clinician adjusting a patient monitor. */
  clinician: {
    src: "/marketing/people/clinician-monitor.webp",
    width: 1600,
    height: 1067,
    altKey: "landing.hero.photoAlt",
  },
  /** The auth panel: a technician measuring a circuit board with a multimeter. */
  technician: {
    src: "/marketing/people/technician-bench.webp",
    width: 1278,
    height: 1597,
    altKey: "auth.panel.photoAlt",
  },
  /** Stacks of folders and paper files. */
  paperwork: {
    src: "/marketing/people/paper-stacks.webp",
    width: 1400,
    height: 933,
    altKey: "landing.story.before",
  },
  /** The full-bleed "human moment": hands at a desk of papers, late, low light. */
  latePaperwork: {
    src: "/marketing/people/late-paperwork.webp",
    width: 2000,
    height: 1125,
    altKey: "landing.story.human",
  },
  /** Two people going through printed records at a table (no faces). */
  inspection: {
    src: "/marketing/people/records-review.webp",
    width: 1800,
    height: 1200,
    altKey: "landing.compliance.photoAlt",
  },
  /** A staff member setting a wall-mounted monitor, seen from behind (no face). */
  deviceCheck: {
    src: "/marketing/people/device-check.webp",
    width: 1120,
    height: 1400,
    altKey: "landing.work.photoAlt",
  },
} as const satisfies Record<string, LandingPhoto>;
