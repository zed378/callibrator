# 2026-11-25 — P17-07 storage capability regression

Status: implemented in working tree; PT-17 remains partial.
Spec refs: `docs/SECURITY/15-FASKES-SCOPE-THREAT-MODEL.md` §12 PT-17;
`docs/STORAGE/04-TENANT-STORAGE.md`; P19-04 §9.3; ADR-128.

`storage.index.test.ts` now proves that a facility key without a token and an
F1 token applied to the matching F2 key are refused before a local driver is
created. `storage.s3.u09.live.test.ts` adds two real facility objects: F1's
signed URL returns its bytes, while unsigned GET, anonymous prefix listing,
and substituting F2 in the signed URL all return 403 from the S3 server.
No application behavior change was needed.

Named verification (coverage disabled for focused runs):

- `storage.index`, `storageKeyFacility`, `devicePhotos.isolation.p2102b`:
  **65/65 passed**.
- `storage.s3.u09.live`: **16/16 passed** against disposable Versity Gateway,
  image digest `sha256:8319a530d08d537426e2f855bae5280709795dc73a3f0c347973ef915d6343c5`.
  The first run was 15/16: its existing SSRF positive control timed out using
  `host.docker.internal` with the server published only on loopback. The full
  repeat passed using the suite's documented `localtest.me` loopback alias.
- ESLint on both changed suites: exit 0. `git diff --check`: exit 0.

The named disposable S3 container was stopped after verification.

Limitations: these prove capability handling and driver exposure on this
configured private bucket. They do not inspect all HTTP payloads/logs for key
leakage, prove imported filenames contain no legacy identifiers, exercise the
complete local/S3 photo upload HTTP matrix, or validate a production bucket
policy. No complete PT-17/P17 exit, full coverage, physical-device test or
production action is claimed. Existing photo route isolation uses memoryDb;
the S3 assertions above use actual HTTP and the real SDK/driver.
