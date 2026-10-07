# Upstream PHP adoption — code, module and feature research

> **Card ids renumbered 2026-10-07: see PHASE-12 mapping** — [`TASKS/PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md`](../../TASKS/PHASE-12-UPSTREAM-DECISIONS-AND-ADRS.md) § 7 (`UP-xx-yy` → `P(12+xx)-yy`; the plan file `PHASE-UPSTREAM-PHP-ADOPTION.md` was split into Phases 12 … 31 and deleted). This record keeps the ids it was written with.

**Date:** 2026-10-07 · **Task:** Upstream PHP Feature Adoption, research phases UP-01, UP-03, UP-04 (BACKLOG Q-57) · **Decision:** none taken; the tenancy decision is raised for the owner (`docs/UPSTREAM/00-OVERVIEW.md` § 10) · **Base commit:** `25521ff` (working tree, not committed) · **Companion record:** [`2026-10-07-upstream-database-research.md`](./2026-10-07-upstream-database-research.md) (DB agent, in parallel)

> **Privacy:** this record holds structure only. No data value, credential, key, e-mail, phone, person name, facility name or password hash from the upstream was copied into the repository.

## Source

- `mozivid/skpipm.id/apps-ipm/` — CodeIgniter 4.3.8 application (11 controllers, 30 models, ~40 views, 11 migrations, 12 seeders), `myth/auth`, `firebase/php-jwt`, Dompdf, Spout, DataTables. Read only; nothing under `mozivid/` was modified; `mozivid/` stays gitignored.
- `mozivid/skpipm.id/info.php` (a `phpinfo()` page).
- `CREATE TABLE` blocks of `mozivid/db_dump/2026-10-06-skp_ipm.sql` (schema only); the DB deliverables belong to the DB agent.

## Method

1. Read every controller, model, filter, route, config file and the significant views.
2. Ran the app on a **throwaway local copy**: containers `up-code-mariadb` (`mariadb:10.5`) and `up-code-php` (`php:8.1-apache` + mysqli/intl/gd/zip, committed locally as `up-code-php-img:local`), network `up-code-net`, volume `up-code-writable`; ports bound to `127.0.0.1` only. The app tree was mounted read-only; its `.env` was shadowed by an empty file and configuration came from container environment variables. The latest dump was restored into the throwaway database.
3. Created throwaway accounts **in the throwaway copy only** (an admin, a technician, a group-less user, all with `example.invalid` addresses and a random password kept outside the repository). No real account was used and no hash was cracked.
4. Probed routes with `curl` (status codes, sizes and content types only) and took screenshots with headless Chrome (puppeteer from the root `node_modules`). Screens showing real data stay in the session scratchpad (`…/scratchpad/upstream-code/`), never in the repository.
5. Ran aggregate-only SQL (counts, distinct code values) to understand behaviour (e.g. stored condition codes, recommendation codes, truncated accessory values).
6. **Cleanup by name:** removed `up-code-php`, `up-code-mariadb`, volume `up-code-writable`, image `up-code-php-img:local`, the pulled `php:8.1-apache` image and network `up-code-net`; deleted cookie jars and password files. The DB agent's `up-db-mariadb` and the pre-existing `mariadb:10.5` image were not touched. No prune was run.

## Verified on the local copy (status codes only)

| Check | Result |
|---|---|
| `GET /register` anonymous | 200 — open registration |
| Group-less account: `inventory_download_admin_xls?id_client=<any>` | 200 XLSX of that facility |
| Group-less account: `ipm/htmlToPDF?...` | 200 IPM report |
| Group-less account: `details/Total`, `teknisi_list`, `dashboard`, `group` | 200 |
| Anonymous: `readQr/<QR>`, `ipm/getIPM/<QR>/<date>` | 200 HTML |
| Anonymous: `ipm/downloadSertifikatIPM?...` | 200 PDF |
| Anonymous: the APK, an operator `.txt` in `uploads/inventory/` | 200 |
| Role denial (e.g. technician route as admin) | 500 with a stack trace (development mode) |
| Inventory PDF with photos off for a large facility | exhausts 512 MB |

## Output

- `docs/UPSTREAM/00-OVERVIEW.md` — app, stack, architecture, auth/groups, routes map, API, reports, uploads, **18 security findings S-01..S-18** (location and type only), tenancy gap (§ 10), **13 drift notes D-01..D-13**, and the **draft phase list UP-00..UP-19**.
- `docs/UPSTREAM/01-MODULES.md` — **15 modules**: Exists 3 · Partial 8 · Missing 2 · N/A 2; draft role mapping.
- `docs/UPSTREAM/02-FEATURES.md` — **81 features**: Exists 17 · Partial 29 · Missing 30 · N/A 5; implementation notes per feature in our conventions.
- `TASKS/BACKLOG.md` Q-57 — one-sentence update: the source is identified and the research lives in `docs/UPSTREAM/`.

No code, test, migration or ADR was written; no `docs/` document other than the new `docs/UPSTREAM/` files was amended. Nothing was committed.

## Needs the owner

1. **Tenancy model** for a provider serving many facilities (00 § 10; F-17) — ADR before any build.
2. **Rotate the upstream secrets** (DB password, JWT secret in `.env`) and close the open registration, `development` mode, `info.php` and the public QR/PDF routes on the live site — the fork copy makes them disclosed (S-01..S-06).
3. **What the physical QR stickers encode** (scan one): a bare number or a URL on the old host (F-76, UP-15).
4. Whether **"one IPM per device per month, a re-submission replaces it"** is a business rule to keep (F-55).
5. **Mobile/offline capture**: retire the APK for a PWA, or keep a native app (UP-16, F-77..F-79).
6. Legal basis and contracts for moving each facility's data (UP-05).
