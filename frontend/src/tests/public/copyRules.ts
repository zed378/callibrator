/**
 * P10-11 (ADR-098, doc 20 §3 principle 4, §11, §12) — the ONE reviewed list of
 * what public copy may not say. Each entry carries the reason it is banned.
 * Adding, removing or narrowing an entry is a reviewed change: the guard
 * (copyTruthfulness.p1011.test.ts) is only as good as this list, and it is
 * deliberately written from the rules (research 04 §4.1, 05 §1), NOT from the
 * strings the dictionaries happen to contain today — a guard generated from
 * the copy it checks verifies consistency, never correctness (CLAUDE.md).
 */

export interface BannedTerm {
  pattern: RegExp;
  why: string;
}

export const BANNED_TERMS: readonly BannedTerm[] = [
  { pattern: /\bHIPAA\b/i, why: "US health-privacy law; the product holds no patient data and no HIPAA assessment exists (00-PROJECT-OVERVIEW § Non-Goals, research 04 C13)" },
  { pattern: /\bSOC\s*-?\s*2\b/i, why: "no SOC 2 report exists; naming it implies an audit that never happened (research 04 C16)" },
  { pattern: /\bSNARS\b/i, why: "working decision Q-39: the accreditation standard is never named; SNARS is superseded and implies packaged evidence the code does not produce" },
  {
    pattern: /\bPermenkes\b|\bKepmenkes\b|\bPeraturan Menteri\b|\bUU\s*(?:No\.?\s*)?\d+|\bUndang-Undang\s+(?:No(?:mor)?\.?\s*)?\d+|\bNomor\s+\d+\s+Tahun\s+\d{4}\b|\bPP\s+(?:No\.?\s*)?\d+/i,
    why: "working decision Q-40 (doc 20 §14): the copy cites no regulation or decree number (Permenkes 54/2015, once quoted, is no longer in force); the legal review confirms",
  },
  { pattern: /\bKARS\b/i, why: "the accreditation body is not named on public copy (Q-39); the old page used it as a badge" },
  { pattern: /\bcertified\b/i, why: "the product holds no certification; it supports compliance (doc 20 §1 goal 2). The disclaimer's 'not itself certified' uses 'certified' — see ALLOWED_PHRASES" },
  { pattern: /\bbersertifikat\b/i, why: "Indonesian 'certified' — same reason; the disclaimer's 'tidak bersertifikat' is allowed" },
  { pattern: /\bterakreditasi\b/i, why: "'accredited' — the product is not accredited and is not an accreditation body" },
  { pattern: /\bcompliant (?:from|out of|by)\b|\bfully compliant\b|\b(?:guarantees?|ensures?) compliance\b|\bkepatuhan (?:terjamin|penuh)\b/i, why: "'compliant' as an OUTCOME the software delivers (research 04 §4.1); compliance is the hospital's, the software supports it" },
  { pattern: /100\s*%\s*(?:secure|aman)|aman\s*100\s*%/i, why: "an absolute security claim nobody can substantiate (UU 8/1999 Pasal 9, 17)" },
  { pattern: /\bterbaik\b|\bthe best\b|\bbest-in-class\b/i, why: "a superlative with no comparative evidence (Etika Pariwara Indonesia)" },
  { pattern: /#\s*1\b|\bnomor satu\b|\bnumber one\b|\bno\.\s*1\b/i, why: "a ranking claim with no source" },
  { pattern: /\bfree trial\b|\buji coba gratis\b|\bno credit card\b/i, why: "no trial exists: the tenant status ENUM has no trial state (ADR-098 §8.9)" },
  { pattern: /\btraceable\b|\bketertelusuran\b|\btertelusur\b/i, why: "metrological traceability is the laboratory's property; calibration_records.standard is free text with no reference chain (05 H2)" },
  { pattern: /\bend-to-end encrypt/i, why: "not implemented (05 §1 item 2)" },
  { pattern: /\bAI-powered\b|\bberbasis AI\b|\bpredictive\b|\bprediktif\b/i, why: "not on the calibration spine; not shown (doc 20 §6.3)" },
  { pattern: /\bscan(?:ning)? (?:devices|barcodes?)\b|\bpindai (?:alat|barcode)\b/i, why: "barcode/QR scanning of DEVICES does not exist (05 §1 item 2); scanning a certificate's QR to verify it is fine" },
  { pattern: /\bautomatic(?:ally)? (?:pass\/fail|evaluated)\b|\botomatis (?:lulus|sesuai)\b/i, why: "pass/fail is entered, not computed (05 W5)" },
  { pattern: /\bdata residency\b|\bmulti-region\b/i, why: "enable_data_residency defaults to false; no multi-region deployment exists" },
  { pattern: /\btrusted by\b|\bdipercaya oleh\b|\bour customers\b|\bpelanggan kami\b/i, why: "social proof with no real, permitted customer material (doc 20 §1 non-goals)" },
];

/**
 * Exact phrases in which a banned word is TRUE and required — each reviewed.
 * They are removed from a string before the banned terms are applied.
 */
export const ALLOWED_PHRASES: readonly { phrase: string; why: string }[] = [
  { phrase: "is not itself certified", why: "the disclaimer that says the opposite of the banned claim (doc 20 §11.1 landing.compliance.disclaimer)" },
  { phrase: "tidak bersertifikat", why: "the same disclaimer in Indonesian" },
];

/** A figure used as marketing proof: 12,000+ · 40% · 3x · 99.2% · 1.000+. */
export const NUMERIC_CLAIM = /\d[\d.,]*\s*(?:%|\+|x\b|×)|\b\d{1,3}(?:[.,]\d{3})+\b/i;

/**
 * Keys whose text may carry such a figure, each with its source. Every other
 * key fails on one.
 */
export const NUMERIC_ALLOW_LIST: Readonly<Record<string, string>> = {
  "access.band.lt_100": "a device-count BAND on a form, not a claim (spec P10-05 deviceCountBand)",
  "access.band.100_499": "form band, not a claim",
  "access.band.500_1999": "form band, not a claim",
  "access.band.gte_2000": "form band, not a claim",
  "access.needsHelp": "the field's 2,000-character limit (spec P10-05 validator)",
  "access.error.max": "a validation limit placeholder, not a claim",
  "access.whatsappHelp": "an example phone number format (+62), not a claim",
};

/** Image hosts of stock faces and stock photos the old page hot-linked or copied. */
export const BANNED_URLS = /randomuser\.me|pravatar|unsplash\.com|pexels\.com|images\.unsplash/i;

/**
 * Keys that state something about the product (a capability, a control, a
 * standard). Every one must appear in doc 20 §11 with a non-empty source.
 * Headings, labels, form text, errors and navigation are not claims.
 */
export const CLAIM_KEY_PREFIXES: readonly string[] = [
  "landing.hero.eyebrow",
  "landing.hero.title",
  "landing.hero.lead",
  "landing.flow.device",
  "landing.flow.schedule",
  "landing.flow.calibrate",
  "landing.flow.certificate",
  "landing.flow.sign",
  "landing.flow.verify",
  "landing.caps.",
  "landing.compliance.",
  "landing.security.",
  "landing.faq.a",
  "landing.verify.lead",
  "landing.verify.help",
  // P10-17 (ADR-118): the warm landing's new statements about the product or
  // about how the team works with a hospital — each needs its §11 row.
  "landing.flow.lead",
  "landing.moments.1.after",
  "landing.moments.2.after",
  "landing.moments.3.after",
  "landing.work.step1Text",
  "landing.work.step2Text",
  "landing.work.step3Text",
  "landing.cert.hs.1.text",
  "landing.cert.hs.2.text",
  "landing.cert.hs.3.text",
  "landing.cert.hs.4.text",
];

/** Within the claim prefixes, the keys that are titles or labels, not claims. */
export const NOT_A_CLAIM: readonly string[] = [
  "landing.caps.title",
  "landing.compliance.eyebrow",
  "landing.compliance.title",
  "landing.compliance.standardsTitle",
  "landing.security.title",
  "landing.flow.deviceTitle",
  "landing.flow.scheduleTitle",
  "landing.flow.calibrateTitle",
  "landing.flow.certificateTitle",
  "landing.flow.signTitle",
  "landing.flow.verifyTitle",
  // P10-17: the alt text of an illustrative photograph (doc 20 §12), not a claim.
  "landing.compliance.photoAlt",
];
