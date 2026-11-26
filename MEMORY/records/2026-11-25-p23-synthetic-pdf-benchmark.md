# 2026-11-25 — P23-03 synthetic browser PDF benchmark

Status: reproducible harness implemented; browser measurements not obtained.
Spec refs: `TASKS/PHASE-23-UPSTREAM-REPORTS.md` P23-03;
`docs/UPSTREAM/09-REPORT-LAYOUTS.md` §3.3 and §5.

`automate/inventory-pdf-benchmark.mts` bundles the actual frontend
`lib/export/inventoryPdf.ts` and `photoThumbs.ts` with installed esbuild.
It runs cold isolated Chromium contexts for 100/500/1,000 rows, with and without
photos. Every photo has an independent deterministic synthetic 320px JPEG q70
texture; this prevents a repeated fixture image from benefiting from jsPDF's
identical-image deduplication. The actual signed-link client, concurrency-limited
thumbnail loader and browser 80px JPEG codec run against synthetic local HTTP
responses. Real self-hosted NotoSans font files must load; fallback is a failure.
No application route or real-data fixture is added.

For each case the harness records photo source bytes, approximate downscaled
JPEG bytes, thumbnail loading time, rendering time, total build time, timer gaps,
before/after and observed maximum JavaScript heap, and output PDF size. The heap
maximum is sampled at thumbnail callbacks and rendering boundaries; it is a
lower bound on the true peak, especially during synchronous rendering. Timer
gaps expose main-thread stalls. It verifies an object-URL fetch and an actual
Chromium download, its PDF signature/byte count and exactly two distinct embedded
images per photo-bearing row. Unique run directories prevent stale downloads
from satisfying those checks.

Run: `node automate/inventory-pdf-benchmark.mts`. Optional `CHROME_PATH`,
`PDF_BENCH_ROWS` and `PDF_BENCH_ARTIFACTS`; default rows `100,500,1000`.
Output goes to a fresh timestamped directory under the chosen artifact root or
the operating system's temporary `callibrator-inventory-pdf-benchmark` directory.
The resulting `report.json` records browser/Node/CPU/RAM metadata and methodology.

## Verification and limitation

- TypeScript 7: `node node_modules/@typescript/native/bin/tsc -p automate/tsconfig.json`
  passed, exit 0.
- The installed esbuild successfully bundled the actual frontend modules during
  `node automate/inventory-pdf-benchmark.mts`.
- Chromium launch in the default sandbox failed with exit code **2147483651**,
  before any case ran. No benchmark timing, heap figure, generated PDF or successful
  download is claimed. No optional escalation was requested, honoring the owner's
  instruction to avoid further approval prompts while absent.

The provisional `PHOTO_ROW_LIMIT = 1000` in `ExportsClient.tsx` is unchanged.
Even a successful synthetic run would establish this workstation's behavior,
not the actual largest facility's dry-run size, storage latency or phone budget.
P23-03's measured production-size threshold and P23-05 owner parity signoff remain
open. No production dataset, photo, deployment or signoff was used or invented.
