# 2026-11-10 — `./backend import-key`: the operator's way to give a tenant its upstream import key

**Task:** P24-04 follow-up · **ADR:** ADR-133 Amendment 6 · **Branch:** `main`

## What was wrong

The transform needs a usable per-tenant import key for every imported device that names a calibration date (Am. 5, P24-02h, 2026-10-28), and for any calibration whose upstream user is NULL or deleted. Without one it fails `IMPORT_KEY_MISSING`. `provisionImportKey` had one caller, the development dry-run script. There is no route, by design (the secret is discarded). So a deployment could not give a tenant its key, and the cutover runbook said "provisioned" without saying how.

The full-suite run of 2026-11-06 found it: `p21-upstream-flows.e2e` (15/15 on 2026-10-23) failed its transform case on every run, with `transform_failed` / `IMPORT_KEY_MISSING`.

## What changed

- **`backend/src/scripts/importKey.ts`** (new): `provision`, `status`, `revoke`. Registered as `import-key` in `cliDispatch.ts`; `npm run import-key` from a checkout.
- **`services/upstreamImport/importKey.ts`**: two helpers, `importKeyStatus` and `importOperator`.
- **`p21-upstream-flows.e2e.test.ts`**: a new case provisions the provider tenant's key through the CLI in the backend container (`E2E_BACKEND_CONTAINER`), checks that a second run changes nothing, and checks that another tenant's administrator is refused.
- **Docs:** ADR-133 Am. 6, the cutover runbook §§ 5 and 10, a note in the P19-05 spec § 9.2.

## Evidence

- `importKey.cli.test` (new, 30): the real CLI, services, models and tenant hooks over `memoryDb`.
  - Two tenants: an operator of the other tenant is refused for `provision` and `revoke`, and a tenant's `status` never shows the other's key.
  - The DPIA gate holds: `real` is refused, then allowed once the gate is on.
  - Every usage error exits 2 with the usage.
  - A revocation that leaves a live key reports FAILED and exits 1.
  - Neither the key's hash nor any secret reaches stdout.
- `importKey.p2404.test` (31, 8 added): `importKey.ts` is at 100 / 100 / 100 / 100.
- **Mutation:** removing both tenant confinements (the `tenantId` clause and `runForTenant`) fails exactly the two other-tenant tests; restored, 30/30.
- Typecheck 0; lint 0 on the changed files.
- **The compiled binary:** see § Gates.

## Not done

- No HTTP route (Am. 6 item 2).
- A platform with no `docker exec` has no way to run the command yet (Am. 6, implications).

## Gates

- **Live E2E, compiled binary** (a disposable production-mode compose stack `ft1110`, built from this tree, fresh volumes, `FACILITY_BINDING_ENABLED=true`): `npm run test:e2e` **58 of 58 suites, 462 of 462 tests**, with `p21-upstream-flows` 16/16. Its new case runs `docker exec <backend> ./backend import-key provision` twice (the second changes nothing), `status`, and a refusal for another tenant's administrator. The transform and the invitation cases, red since 2026-10-28, pass.
- **The binary recognises the command** (`./backend import-key` prints the usage, it does not start the server).
- Unit: `importKey.cli.test` 30/30, `importKey.p2404.test` 31/31, the service at 100 / 100 / 100 / 100; typecheck 0; lint 0 on the changed files.

### Two mistakes of mine on the way, kept because they cost runs

- **`execFileSync` in the spec.** Four synchronous `docker exec` calls block the test process's event loop for about 10 s. In that time the HTTP client cannot see the server close an idle keep-alive socket (5 s), and the next `fetch` (the dump upload) reused it: `TypeError: fetch failed … other side closed`. It showed only on a re-run, because the first full run failed its CLI case before the later `exec` calls. The helper is asynchronous now. Any E2E helper that shells out must not block.
- **Stack preparation.** On a fresh stack the super admin exists only after `GET /api/v1/migration/seeding`; reading `/app/.bootstrap/superadmin-password` before it gives an empty value, every sign-in then fails, and the failures trip the sign-in throttle for that identity (the next run answers 429 until the Redis state is gone). Order: up, seeding, read the password, run.
