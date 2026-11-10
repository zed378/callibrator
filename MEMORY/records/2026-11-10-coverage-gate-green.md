# 2026-11-10 — The backend coverage gate exits 0 again

**Task:** "perbaiki gate coverage backend" · **Branch:** `main`

## What was wrong
Full `npm run test:coverage -- --ci` runs failed on a different suite each time, on a loaded workstation:
- `auditLedger` fixture lost its original `AuditLog.create` and `auditSchema` export (`255ad197`).
- `ingest`, `corsPolicy.dast`, `alertRouting.p702` passed alone and missed jest's 10 s ceiling under ~15 workers (`eaba79dd`: 30 s ceiling, webhook timeout env).
- `routeClient`'s request double had no `emit`; the 15-minute `uploadTimeBudget` timer fired inside another suite (`32869bf3`, test `routeClient.emit.test.ts`).
- `clamAv.service` "clean multi-chunk file" against the real clamd missed 30 s (`25dc2c7f`: 120 s service timeout, 150 s ceiling, `maxWorkers: "75%"`).

## Gate
Node 26, ClamAV on 127.0.0.1 (`CLAMAV_LIVE_PORT`), 14:12–14:25: **1,085 of 1,085 suites, 18,215 of 18,215 tests passed, coverage 100 / 100 / 100 / 100, exit 0.**
