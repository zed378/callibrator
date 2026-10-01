# 2026-10-01 — A-325 and A-332: the image build no longer depends on a build-time download, and compose declares its build context once

**Findings:** A-325 (found by the P9 lead, 2026-09-30) and A-332 (claimed 2026-09-30 for the compose context trap). **Asked by:** the coordinator: "make the Docker build robust against pkg-fetch's build-time download … keep the pin and verify it fails on a wrong checksum", and "document it, or make the build context explicit". **Agent:** the Phase 9 lead.

## A-325 — the pkg base binary is pinned and pre-fetched

**The defect.** `pkg . --targets node26-linux-x64` downloads an 80 MB `node-v26.5.1-linux-x64` from the pkg-fetch GitHub release on every uncached build. When the download failed, pkg's fallback (compiling Node from source) is refused on Alpine. On 2026-09-30 the build failed three times this way: once with "Network error during fetch", and twice with a stall until the timeout.

**The change** (`backend/Dockerfile`):
- **A new stage, `pkg-base`, on the same digest-pinned `node:26.10.0-alpine`:**
  - pinned `ARG`s: `PKG_BASE_TAG=v3.6`, `PKG_BASE_NAME=node-v26.5.1-linux-x64`, `PKG_BASE_SHA256=02b77b99…c9e436`;
  - `wget` with 5 attempts, a 60-second timeout and backoff;
  - `sha256sum -c` against the pin; on a mismatch the build stops with "sha256 mismatch";
  - the file is placed at `/pkg-cache/<tag>/fetched-<node>-linux-x64`, where pkg-fetch looks before downloading (`places.js#localPlace`).
- **`PKG_BASE_URL`** can point at a mirror or a file server; the checksum still decides whether the file is used.
- **The builder** runs `COPY --from=pkg-base /pkg-cache /tmp/pkg-cache`, then `PKG_CACHE_PATH=/tmp/pkg-cache npx --no-install pkg …`.
- **The layer depends only on the pins**, so a source change never downloads the binary again.

**The pin cannot drift:** `backend/src/tests/guards/pkgBasePin.a325.guard.test.ts` derives the expected values from the installed pkg-fetch:
- the tag from its version (`v<major>.<minor>`);
- the binary from `satisfyingNodeVersion` for the Dockerfile's own `--targets`;
- the sha256 from its `expected-shas.json`.

It also asserts that the pkg step reads the copied cache, and that the stage runs `sha256sum -c`.

**Evidence:**
- **The guard:**
  - passes 4/4 on the new Dockerfile;
  - fails 4/4 on HEAD's Dockerfile;
  - fails exactly one test with the sha pin altered, and exactly one with the node version pinned stale (26.4.0).
- **Docker** (`docker build --target pkg-base -f backend/Dockerfile .`):
  - **the real pin:** built, with `/tmp/pkg-base: OK`;
  - **`--build-arg PKG_BASE_SHA256=000…0`:** `/tmp/pkg-base: FAILED`, "pkg base: sha256 mismatch for node-v26.5.1-linux-x64", and the build failed (exit 1), so no image;
  - **`--build-arg PKG_BASE_URL=http://127.0.0.1:1/unreachable`:** five attempts at 1 s, 6 s, 16 s, 31 s and 51 s, then "could not be downloaded" and exit 1.
- **A full image build** from a frozen snapshot with the new Dockerfile: see § Full build below.

## A-332 — the compose build context is declared once

**The defect.** `deploy/compose/docker-compose.dev.yml` and `docker-compose.vm.yml` restated `build.context: ../..`, and an overlay's value wins. A build pointed at another tree was silently pointed back at the live working tree, so an image claim could come from an unintended tree. It did, in the P9-12 baseline's first snapshot builds.

**The change:**
- `docker-compose.yml` declares `context: ${BUILD_CONTEXT:-../..}` for the backend and the frontend.
- `dev` and `vm` no longer carry a `context` or `dockerfile`. The frontend keeps only its `build.args`.
- `staging` and `prod` never declared either.

**The guard:** `backend/src/tests/guards/composeBuildContext.a332.guard.test.ts` requires that no overlay declares `context:` or `dockerfile:`, and that every base context goes through `BUILD_CONTEXT`. It passes 3/3 on the new files. On the pre-change files, 2 of 3 fail.

**No other change to what compose builds:**
- Every overlay (dev, vm, prod, staging) was rendered with `docker compose … config`, using CI's `.env` recipe, in scratch copies: the pre-change files (the current tree with only this edit reversed) against the new files.
- **With the default values, the renders are identical** (0 differing lines once the scratch directory names are normalised).
- **With `BUILD_CONTEXT` set,** the new files carry it through `dev` and `vm`, while the pre-change `dev` overlay silently put the context back. The trap was reproduced.

**Documentation:** `docs/DEVOPS/02-CONTAINERIZATION.md` gained two sections, "The pkg base binary is pinned and pre-fetched (A-325)" and "The Compose Build Context Is Declared Once (A-332)", and the Dockerfile excerpt shows the new stage.

## Full build

RESULT_PLACEHOLDER
