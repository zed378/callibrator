# P24-05 finding fixed: the electrical-safety limits and the performance units the transform did not read

**Date:** 2026-10-28 · **Card:** P24-05 follow-up (step 4, `catalogue.ts`, P24-02c) · **Status:** fixed; to be re-measured on the real dump · **Found by:** the first real-dump dry run ([record](./2026-10-28-p24-05-dry-run-real-dump.md))

## Defect

The dry run quarantined 866 template items as `item_content_incomplete`:

- all 638 rows of `mapping_keamanan_listrik`;
- 228 of the 282 rows of `mapping_kinerja_alat`.

No published IPM template had electrical safety. The cause was in `definitionOf`, which built each
item definition from `nilai_acuan` only.

- **Electrical safety.** `mst_pemeriksaan_keamanan_listrik` has **no `nilai_acuan`**; the limit
  and its unit are in `symbol` (`≤ 0,2 Ω`, `≤ 100 µA`, `≤ 10 µA`). 03 § 4 had recorded this.
  Every definition therefore came out with no limit and no unit, and the catalogue's publish check
  ("a measured item needs its unit") refused all ten.
- **Performance.** 96 items write their unit as a parenthesised `symbol` (`(g)`) beside a text
  reference (`≤ 3 Kali Rsolusi`). The unit was taken only from a parsed `nilai_acuan`, so those
  items had none either.

The synthetic worlds could not see this. They gave the electrical-safety table a `nilai_acuan`
column, and their performance symbols were letters (`Q`, `P`), not units. A fixture that invents a
schema proves the code against itself.

## Fix

[`backend/src/services/upstreamImport/transform/catalogue.ts`](../../backend/src/services/upstreamImport/transform/catalogue.ts) `definitionOf`:

1. A limit kind (performance, electrical safety) **without a `nilai_acuan`** takes a `symbol` that
   `parseLimit` reads as a limit (any operator but `text`) as its limit, and the limit's unit as
   its unit. That symbol is not also kept as the symbol.
2. An item still **without a unit** takes a parenthesised `symbol` (`(g)` → `g`, through
   `normaliseUnit`) as its unit. That symbol is not also kept as the symbol.
3. A `nilai_acuan`, where the table has one, still wins. A symbol that is neither a limit nor a
   parenthesised unit stays the symbol.

Performance items with **no unit anywhere** (86 whose reference is `± 10 %` or `...`, and 2 whose
symbol is a bare number) stay `item_content_incomplete`. The data does not say their unit, so the
operator completes it in the catalogue, and the next run adds them (ADR-129 Am. 6, as designed).

## Tests

| Suite | Result |
|---|---|
| `services/upstreamImport/transform.p2402c` | 2 new cases with the real shapes. Electrical safety `≤ 0,2 Ω` in `symbol` gives Ω, `lte`, 0.2, no symbol, and **no publish problem**. A `nilai_acuan` still wins; a non-limit symbol stays. Performance `(g)` gives unit g and no publish problem. `± 10%` with no symbol still has the unit problem |
| `src/tests/services/upstreamImport` (all) | 15 suites, 328 tests |
| **Live, PostgreSQL 18:** `p2402c` | 3/3. The world gains the two real shapes: `≤ 0,2 Ω` stored as unit Ω, `lte`; `(g)` stored as unit g. Definitions 8 (was 6) |
| Live, PostgreSQL 18: `p2402d`, `p2402g`, `p2403` | pass |
| eslint | clean |

## Re-measured on the real dump (2026-10-28, the second dry run)

Same dump (`2026-10-06-skp_ipm.sql`), same script, a fresh throwaway PostgreSQL 18 and ClamAV,
removed after the run.

| Template source | First dry run | After the fix |
|---|---|---|
| `mapping_keamanan_listrik` | 0 of 638 (638 incomplete) | **638 of 638** |
| `mapping_kinerja_alat` | 54 of 282 (228 incomplete) | **176 of 282** (106 incomplete: their item has no unit anywhere in the data, for the operator to complete) |

All other template sources are unchanged: `mapping_fugsi_alat` 860, `mapping_alat_kerja_digunakan`
758, `mapping_kelengkapan_alat` 338. Every reconciliation check passes again. R-7 is now
**27,299 / 27,299**: 3,640 `trx_kalibrasi` rows plus 23,659 device dates.
