# 02 — Full-Text Search

How `GET /api/v1/search` matches text: which tables carry a `tsvector`, how the query is built, when it falls back to `ILIKE` and why, and what happens when both fail. Read [`01-GLOBAL-SEARCH.md`](./01-GLOBAL-SEARCH.md) first for the endpoint, the per-type permission filter and the response envelope. This document covers only the matching underneath.

> **Target standard: TypeScript, strict (ADR-038).** As built, every search file named here is **JavaScript/CommonJS**: `search.service.js`, `search.controller.js`, `search.route.js` and migration `0003-add-search-vectors.js`. Conversion is tracked in [`../../TASKS/PHASE-9-TYPESCRIPT-MIGRATION.md`](../../TASKS/PHASE-9-TYPESCRIPT-MIGRATION.md) and changes no behaviour.

**Sources:**

- `backend/src/services/search.service.js`: `TYPES`, `ftsSearch`, `ilikeSearch`, `searchType`, `search`
- `backend/src/controllers/search.controller.js`
- `backend/src/migrations/0003-add-search-vectors.js`
- `backend/src/utils/controllerWrapper.util.js`, for how a failure is answered
- the findings in [`../../TASKS/AUDIT-2026-09-REMEDIATION.md`](../../TASKS/AUDIT-2026-09-REMEDIATION.md): A-04, A-23, A-56

---

## The Short Version

- **Three tables carry a generated `search_vector tsvector` with a GIN index:** `calibration_devices`, `stocks` and `certificates`. Only migration `0003` creates them. No model declares the column, so a database built by `db.sync()` alone has none.
- **The primary path is PostgreSQL full-text search:** `search_vector @@ plainto_tsquery('english', :q)`, ranked by `ts_rank`, tenant predicate written into the SQL.
- **`ILIKE '%term%'` is a fallback for an FTS statement that errors**, which in practice means a database without migration 0003. It is **not** a fallback for an FTS statement that succeeds with zero rows. The two paths match different things (§ The Two Paths Match Different Things).
- **A-56 is fixed in code.** A type whose FTS and ILIKE statements both fail now fails the whole request with a 500. Before, it returned `[]` and the screen said "No results". See § When Both Fail.

## Where The Vectors Are

`0003-add-search-vectors.js` runs this for each table:

```sql
ALTER TABLE "<table>" ADD COLUMN IF NOT EXISTS "search_vector" tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce("c1",'') || ' ' || coalesce("c2",'') || …)) STORED;
CREATE INDEX IF NOT EXISTS "idx_<table>_search" ON "<table>" USING GIN ("search_vector");
```

| Table | Columns concatenated into `search_vector` (in this order) | Index |
|---|---|---|
| `calibration_devices` | `name`, `serial_number`, `manufacturer`, `model`, `category` | `idx_calibration_devices_search` |
| `stocks` | `item_name`, `sku`, `serial_number`, `description` | `idx_stocks_search` |
| `certificates` | `certificate_number`, `standard`, `summary` | `idx_certificates_search` |

Properties that follow from that statement:

- **It maintains itself.** A `GENERATED … STORED` column is recomputed by PostgreSQL on every insert and update, so there are no triggers and no backfill job. It needs PostgreSQL 12 or later. The repository targets 18 (ADR-041).
- **All columns weigh the same.** There is no `setweight`, so a hit in `name` ranks no higher than a hit in `category`.
- **The dictionary is `english`**, fixed in both the column and the query. Words are stemmed and English stop words are dropped. Nothing is configured per tenant or per language, which is worth knowing for Indonesian-language hospital data (KARS/SNARS context). No document or test covers non-English content.
- **Idempotent and reversible.** Both statements are `IF NOT EXISTS`. `down` drops the index and then the column. The migration has no `try/catch`, so a failure fails the migration rather than being recorded as applied.
- **Invisible to the models.** No `*.model.js` declares `search_vector`. That is why a test database built by `db.sync()` lacks it, and why the ILIKE fallback exists.

### Two lists that must agree, and nothing makes them

The searchable columns are written down twice: in the migration's `TABLES` (`0003-add-search-vectors.js:6–10`) and in the service's `TYPES[*].cols` (`search.service.js:20–42`). Neither is derived from the other. **They agree today** (checked by reading both on 2026-09-28). No test compares them.

If one changes without the other, FTS searches the migration's columns and ILIKE searches the service's columns, and no error is raised. Changing the columns of an existing table also needs a **new** migration that drops and re-adds the generated column. Editing `0003` in place does nothing on a database where it has already run.

## The Full-Text Query

`ftsSearch` (`search.service.js:44–55`):

```sql
SELECT <TYPES[t].select>, ts_rank("search_vector", plainto_tsquery('english', :q)) AS rank
  FROM "<TYPES[t].table>"
 WHERE tenant_id = :tenantId AND <TYPES[t].softDelete>
   AND "search_vector" @@ plainto_tsquery('english', :q)
 ORDER BY rank DESC LIMIT :limit
```

- **`plainto_tsquery`** turns the user's text into an AND of its normalised words. It has no operators, no phrase matching and no prefix matching. `:q` is the trimmed term (`search.service.js:114`).
- **Bound, not interpolated.** `:q`, `:tenantId` and `:limit` are Sequelize replacements. The only strings interpolated into the SQL are the table name, the select list and the soft-delete clause, and all three come from the `TYPES` constant, never from the request.
- **The tenant predicate is written into the SQL.** Raw SQL bypasses the global Sequelize hooks ([`../SECURITY/05-MULTI-TENANCY-SECURITY.md`](../SECURITY/05-MULTI-TENANCY-SECURITY.md)), so `tenant_id = :tenantId` is the entire isolation, and it comes from `req.user.tenantId` (`search.controller.js:52`). `backend/src/tests/controllers/search.twoTenants.a56.test.js` pins it on both paths, including "keeps tenant B out on the ILIKE fallback path too" and "ignores a tenantId supplied in the query string".
- **Soft delete is spelled per table.** It is `is_deleted = false` for devices and stock, and `deleted_at IS NULL` for certificates ([`01`](./01-GLOBAL-SEARCH.md) § What Is Searchable).
- **`limit` is per type,** clamped to 1…50, default 10 (`search.service.js:118`).

### Per request

`search()` runs one `searchType` per permitted type **concurrently** (`Promise.all`, `search.service.js:133–135`, A-23). `requested` is a de-duplicated subset of the three types, so at most three statements are in flight per request. The results are merged and sorted by `rank` descending (`:145`).

## The ILIKE Fallback

`searchType` (`search.service.js:76–111`) tries FTS first. **If the FTS statement throws, for any reason,** it runs `ilikeSearch` (`:57–68`):

```sql
SELECT <select>, 0 AS rank
  FROM "<table>"
 WHERE tenant_id = :tenantId AND <softDelete> AND ("c1" ILIKE :like OR "c2" ILIKE :like OR …)
 LIMIT :limit
```

with `:like` = `` `%${q}%` ``.

**Why it is a fallback and not the primary path.** The service's header comment names the case it exists for: "a DB without the migration, or the test DB built from `db.sync()`" (`search.service.js:5–6`). On such a database the FTS statement fails with an undefined-column error, and without the fallback search would not work at all. On a migrated database FTS is the intended path. It has an index, it ranks, and a leading-wildcard `ILIKE` over up to five columns cannot use a B-tree index and scans the tenant's rows. That the fallback is slower has not been measured here. It follows from the SQL, and no benchmark exists in this repository.

What the fallback does, as built:

- **The rank is 0 and there is no `ORDER BY`,** so fallback rows come back in whatever order PostgreSQL returns them. When results are merged, any FTS hit sorts above every fallback row.
- **`%` and `_` in the user's term are not escaped.** They act as `LIKE` wildcards. A search for `_` matches every row with a non-empty searched column. They are still bound parameters, so this is a matching quirk, not an injection.
- **It logs once, then quietly.** The first fallback per table per process is a `warn`: `FTS unavailable for <table> (<error message>); using ILIKE`. Every later one for that table logs at `debug` (A-23, `search.service.js:74, 82–88`). That line is how you tell which path a deployment is on.

### The two paths match different things

The fallback runs only when FTS **errors**. An FTS statement that succeeds with zero rows returns zero rows, and ILIKE is not tried (`searchType` returns the FTS result at `:79`). Taken together with the SQL, this means (read from the code, **not verified against a live database**):

| Search for | On a database **with** 0003 (FTS) | On a database **without** 0003 (ILIKE) |
|---|---|---|
| a whole word, e.g. a manufacturer's name | matches, stemmed (`calibrators` also finds `calibrator`) | matches as a substring |
| a word fragment or prefix, e.g. the first four characters of a model name | **no match**: `plainto_tsquery` has no prefix matching | matches |
| part of a serial number or SKU | depends on how the `english` parser tokenises that value; **not verified** | matches as a substring |
| two words | only rows containing **both** | only rows containing the two words **adjacent, in that order**, as one substring |

So search behaves differently on a unit-test database (ILIKE) and on a migrated one (FTS). A test that passes by finding a substring does not show that production finds it. `search.service.test.js` mocks `db.query` and asserts which statement was issued, not what PostgreSQL matches. `backend/src/tests/e2e/modules/search.e2e.test.js` exists, but this document does not record a run of it.

## When Both Fail — A-56, As It Stands In Code

**Status: fixed.** The A-56 card is DONE (2026-09-24), and the code matches it.

Until 2026-09-24 a second failure was caught and turned into `return []`. A statement failing for any reason, such as a missing column, a type error or a missing grant, rendered as "No results". Today (`search.service.js:89–109`):

```js
} catch (ilikeErr) {
  logger.error(`Search failed for ${cfg.table}`, { type, ftsError: ftsErr.message, ilikeError: ilikeErr.message });
  throw new AppError(500, `Search failed for ${type}`, false, { ftsError: …, ilikeError: … });
}
```

- **Both causes are logged,** with the type, at `error`.
- **The error is non-operational** (`isOperational = false`, the third argument).
- **One failing type fails the whole search.** `Promise.all` rejects, so the types that worked are not returned either. The card chose this over partial results with a per-type marker, and records the trade-off as an accepted bad implication.
- **How it is answered:** the controller is wrapped in `asyncHandler`, whose `sendCaughtError` (`controllerWrapper.util.js:36–52`) answers with the error's status. In production it sends the generic message and the `requestId` and never the SQL text (the A-132 rule). Outside production it sends the message `Search failed for <type>`. The `details` object carrying both SQL messages is **not** put in the response. The response carries the stack string instead, which holds the AppError's message and frames.
- **The frontend says so.** `GlobalSearch.tsx` renders `searchErrorMessage(err)` (`frontend/src/api/services/search.service.ts:69`) as a failure with the reference id, not as "No results".

Tests: `backend/src/tests/services/search.service.test.js` › "A-56: fails the search with a non-operational 500 when BOTH FTS and ILIKE fail, logging both causes" and "A-56: one failing type fails the whole search instead of returning the others as a complete answer". `backend/src/tests/controllers/search.twoTenants.a56.test.js` › "answers 500 with success:false when a type fails on both FTS and ILIKE" and "in production shows the generic message and the request id, never the SQL error". This document did not run them.

### What A-56 did not change

**A first failure is still silent to the caller.** Any FTS error falls back to ILIKE, whatever caused it. An FTS path that breaks on a migrated database, whether from a dropped column, a lost grant or a malformed vector, keeps serving ILIKE results with `rank: 0`. It shows up as one `warn` per table per process and then only at `debug`. The card chose this deliberately ("FTS failing is expected on a database without `search_vector`"). The consequence is that the log line above is the only signal. Check it after any migration or grant change.

## The Permission Probe, In One Paragraph

The FTS and ILIKE statements only run for the types the caller may read. The controller decides that by running the real `dynamicAccess(<menu>, "read")` middleware against a probe response object (`search.controller.js:19–28`). A bare `next()` means allowed. A written 401/403/404, or `next(err)`, means denied: since A-13 an internal failure of the permission check denies rather than failing open (`resolve(!err)`, `:27`). The probe is still a fake `res`, and it is awaited once per type in a loop (`:33–39`). **Review finding V-10** ([`../../TASKS/REVIEW-2026-09-23-REMEDIATION.md`](../../TASKS/REVIEW-2026-09-23-REMEDIATION.md) § V-10, status TODO) records the risk: a denial path that ever answers other than `res.status().json()` would leave the promise unsettled and hang the request until the timeout. Nothing in the code has replaced the probe yet. [`01`](./01-GLOBAL-SEARCH.md) § Authorization explains the design.

## Operating It

| Question | How to answer it |
|---|---|
| Is FTS in use on this database? | `\d calibration_devices` (and `stocks`, `certificates`) in `psql` should show `search_vector tsvector` generated always, and index `idx_calibration_devices_search` using gin. The migration log is not evidence (`CLAUDE.md`, `make migrate-verify`) |
| Is a deployment on the fallback? | the `warn` line `FTS unavailable for <table> (…); using ILIKE`, once per table per process after start |
| A search "finds nothing" | on a migrated database, first try a whole word, because FTS does not match fragments (§ The Two Paths Match Different Things). A broken statement is no longer a silent empty list: it is a 500 with a request id |
| A search returns 500 | grep the log for `Search failed for <table>`. The line carries `ftsError` and `ilikeError`, which are both causes |

## Not Covered Here

- **Semantic or vector retrieval.** The pgvector search over `document_chunks` belongs to the RAG module. It is a different mechanism with its own isolation risk ([`../SECURITY/05-MULTI-TENANCY-SECURITY.md`](../SECURITY/05-MULTI-TENANCY-SECURITY.md) § vector similarity search) and it is not part of `/api/v1/search`.
- **Highlighting, snippets, fuzzy or typo-tolerant matching, synonyms, per-tenant dictionaries.** None of these is built.

## Related

| For | Read |
|---|---|
| the endpoint, the permission filter, the response | [`01-GLOBAL-SEARCH.md`](./01-GLOBAL-SEARCH.md) |
| why raw SQL must carry the tenant predicate | [`../SECURITY/05-MULTI-TENANCY-SECURITY.md`](../SECURITY/05-MULTI-TENANCY-SECURITY.md) |
| migrations that silently do nothing, and how to verify one | [`../../CLAUDE.md`](../../CLAUDE.md) § The Traps |
| the findings | [`../../TASKS/AUDIT-2026-09-REMEDIATION.md`](../../TASKS/AUDIT-2026-09-REMEDIATION.md) § A-04, A-23, A-56 · [`../../TASKS/REVIEW-2026-09-23-REMEDIATION.md`](../../TASKS/REVIEW-2026-09-23-REMEDIATION.md) § V-10 |
