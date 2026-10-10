# P23-02: the IPM report rendered in the browser, the on-screen report, the signatures and the public verification

**Date:** 2026-10-10 · **Task:** P23-02 (Phase 23; F-58 … F-61) · **Specs:** [`P19-06`](../specs/P19-06-ipm-report-document.md) § 7, § 8.2, § 9, § 10, § 11, § 12; ADR-126 Am. 2, Am. 5 · **Base:** `b5b97e2`

> This card is frontend only: no backend change, no API change, no migration. Nothing is stored: the PDF is drawn in the browser from the served data document (ADR-126 § 8). All data used here is synthetic.

## Built

| Area | What |
|---|---|
| Renderer | `lib/ipmReportPdf.ts` → `renderIpmReportPdf(doc, { t, locale, readerName })`. It uses jsPDF and `qrcode`, imported on demand. The layout is § 11 on A4 landscape with 10 mm margins: <br>• Header: the title, the device in upper case, the issuer's letterhead. <br>• Identity grid: shows **the device's own last and next calibration dates** (L-1). <br>• Report number and visit number (`007`), plus the upstream visit number where there is one. <br>• Sections in print order, in two columns. Completeness, performance and battery span the full width. Condition and cleanliness are printed apart (L-3). The computed result is marked. Performance shows setting, reading 1, reading 2, reference and result, with a disagreement mark. <br>• The session's inspection result (L-2). The recommendation is printed in words. Notes are printed as text (L-8). <br>• Two signature columns: the technician's, signed or "not yet signed", and the IPSRS', signed or "awaiting electronic countersignature" with a blank line for a wet signature. <br>• Lineage band: supersedes / superseded by / voided / imported. <br>• On every page: a watermark (DRAFT / SUPERSEDED / VOIDED, diagonal, 15 % opacity) and a footer with the number, "Page x / y", "Generated … by <reader>", and the integrity hash. "INTEGRITY CHECK FAILED" is added on a mismatch. <br>• The verification QR on the first page. <br>• File name: `IPM_<number>_<date>.pdf`, or for a preview `IPM_DRAFT_<QR>_<date>.pdf`. No person's name is used. <br>All labels come from the `ipmReport.` namespace, in Indonesian or English as the reader chooses. Text uses the self-hosted Noto Sans font, or falls back to Helvetica. |
| Golden file | `lib/__golden__/ipmReport.synthetic.en.txt` was **written by hand from § 11**, not generated from the code. It holds 60 text runs that must appear in order. **It found a real defect:** in the Helvetica fallback, `pdfText`'s NFKD normalisation turns the micro sign (µ, U+00B5, which is in Latin-1) into the Greek mu (U+03BC, which is not). So "45 µA" printed as "45 ?A", and electrical-safety leakage is measured in µA. The renderer now keeps the micro sign (`latin1Text`). The certificate's `pdfText` itself is unchanged. |
| On-screen report | `/dashboard/ipm/sessions/<id>/report` (`ReportClient`) is **the accessible version**: the PDF is not a tagged PDF, and the page says so. It has one `<main>` and one `<h1>` ("IPM report <number>"), an `<article lang>`, `<section aria-labelledby>` blocks, tables with captions and row headers, and results and recommendations as status-tone badges with text first. It uses theme tokens only. **Download PDF** in the chosen language (Indonesian / English): the page makes a **fresh `render=pdf` read**, which the server audits before it answers (G-R10), and renders that. It never renders the copy already on screen. The reader's display name goes in the footer. Gate: `ipm` read. |
| Signatures | `SignReportDialog` puts the meaning first and requires it to be acknowledged (Part 11 § 11.50). The credential is a password (`autocomplete=current-password`) or an authenticator code, sent with `POST …/signatures` and never stored. A 401 ("Invalid password…") is shown in the dialog and the field is cleared; a 403 or 409 is shown as the server explains it. **Sign** is offered only on an issued, current report with no performer signature. **Countersign** is offered only after the performer has signed, when the setting is on and there is no countersignature. Both need `esignature` write and are never offered to the operator. The server decides who may actually sign. On success the report is re-read. |
| Credential endpoint | `client.ts`: a 401 on `/api/v1/ipm/sessions/<id>/signatures` now neither refreshes nor ends the session (G-R12). This is one exact regex beside the existing prefix list; the code is kept minimal because `client.ts` is in every page's bundle. |
| Public verification | `/verify/ipm/[reportNumber]` (`(public)` group, never indexed). It reads the token from `?t=` and sends it to `GET /api/v1/ipm/verify/:number?token=`; the token is never printed. It shows: <br>• The status band, with an icon and the word: Issued / Superseded (names the newer report and date) / Voided (the date only). <br>• The identity block and the signatures, each "valid" or "does not match this content". <br>• **The hash recomputed in the browser** from the served document (`ipmReportPayloadOfDocument` + `canonicalIpmReportPayload` + `crypto.subtle`), with the result: matches / does NOT match / could not recompute. <br>• Download the PDF in the page's language. <br>Every refusal is the same neutral "Not found". 429, failure and no network are said in the page's own words. The contracts module, the renderer, jsPDF and the font are all loaded on demand. **Bundle: 118.7 KB brotli out of 120** (a new `bundle-budget.json` entry at the `/verify/*` figure). |
| Links | The history's visit dialog has "Open the IPM report" (not shown for a discarded visit). After a submit, the capture offers "Open the report to sign it" (§ 7.2: online, the signature follows the submit). |

## Not as specified

These are deviations without an ADR; each is small.

- **`lib/pdf/` primitives were not moved** out of `certificatePdf.ts` (§ 12, G-R11). The IPM renderer imports the font loader and the text folding from `certificatePdf.ts`. That gives the same single implementation with no change to the certificate's code, so its four suites need no re-proof.
- **No `bundle-budget.json` entry for the dashboard report route.** The budget script measures public routes. jsPDF is still a dynamic import there.
- **Evidence photos are not listed on the report** (§ 11 "Photos"). The capture does not take them yet (P22-03 open item).

## Evidence — tests named

New tests:
- `lib/ipmReportPdf.test.ts` (7): the golden file in order; A4 landscape plus QR, and no watermark on an issued report; preview / superseded / voided watermarks with the lineage band and the integrity failure; a long report spans more than one page and every page is numbered; Indonesian labels and the Unicode font; result cells by kind; zoned dates, file name and signature text.
- `app/(app)/dashboard/ipm/__tests__/ReportClient.test.tsx` (6): access and load states; the semantic report checked with axe; a fresh `render=pdf` read in the chosen language with the reader's name; preview, mismatch, voided and countersignature off; Sign (meaning first, a 401 shown inline and cleared, then a re-read); Countersign refused with an explanation, and never offered to the operator.
- `__tests__/reportServer.test.tsx` (1).
- `app/(public)/verify/ipm/[reportNumber]/__tests__/VerifyIpmContent.test.tsx` (5): the hash recomputed with the **real** contracts code and node's WebCrypto, both matching and not matching.
- `__tests__/page.test.tsx` (2).
- `api/client.signature.p1906.test.ts` (2).

## Gates (2026-10-10; per-card rule)

| Gate | Result |
|---|---|
| frontend `npm run typecheck` | 0 errors |
| `npx eslint` on every changed file | 0 errors, 0 warnings |
| `npx jest --ci --findRelatedTests <changed files>` | **283 suites, 2,959 tests passed** (the i18n files relate to most suites) |
| `next build` | OK: `/dashboard/ipm/sessions/[sessionId]/report`, `/verify/ipm/[reportNumber]` |
| `node scripts/bundle-budget.mjs` | **exit 1**: `/` is at gzip **150.0 / 150 KB** (brotli 128.8 / 180, the AC-7 figure). `/verify/ipm/[reportNumber]` 118.7 / 120 brotli passes. See below. |

## The `/` budget: why it moved

Measured by building HEAD (`b5b97e2`) and this tree on the same machine:

- HEAD: framework 127.5 KB gzip, `/` 149.7.
- This tree: framework 127.7, `/` 150.0.

The change is **not** this card's code on `/`:
- Restoring `client.ts` alone to HEAD gave 150.0.
- Adding only the new `client.ts` to HEAD gave 149.7.
- Removing either new route still gave 150.0.

Diffing the root chunks shows the cause: **Turbopack's module ids widened from 5 to 6 digits** (`e.r(55682)` → `e.r(555682)`) in every framework chunk once the app's module count crossed its threshold. That adds about 0.3 KB gzip to every page, whatever is added. Any later card that adds modules hits the same limit. The decision is the coordinator's: do not raise the ceiling without a record (`bundle-budget.json` treats gzip 150 as a regression ceiling, not AC-7).

**Decision (2026-10-10, the coordinator under the owner's delegation):** the `/` gzip **regression ceiling is raised from 150 to 152 KB** in `bundle-budget.json`, the reason being the Turbopack module-id widening above; the AC-7 brotli limit for `/` stays 180.
