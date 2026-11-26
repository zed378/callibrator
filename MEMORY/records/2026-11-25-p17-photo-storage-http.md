# 2026-11-25 — PT-17 actual local photo HTTP exposure

Status: implemented and focused HTTP verification passed in the working tree;
no PT-17/P17 exit claimed.
Spec refs: `docs/SECURITY/15-FASKES-SCOPE-THREAT-MODEL.md` §12 PT-17;
`docs/STORAGE/04-TENANT-STORAGE.md`; P19-03 §7.2 and §13; ADR-128.

`backend/src/tests/e2e/modules/p1707-photo-storage.e2e.test.ts` creates a new
synthetic tenant, administrator, facility and device on the existing disposable
production-mode p17 stack. It posts actual multipart JPEG bytes with a crafted
original filename containing a synthetic legacy/serial canary and HTML event
markup. The real image pipeline and local storage run; nothing is mocked.

The persisted storage key has only tenant/facility UUIDs and a random attachment
UUID. The retained original name is the canonical `device_front.jpg`. The
upload response, attachment metadata, signed-URL response, attachment audit
changes and container stdout/stderr during the upload/read window contain
neither the object key nor the original filename canary/HTML marker.

The signed attachment URL returns an actual JPEG (200, image/jpeg and JPEG magic
bytes). Anonymous direct key requests, a bogus capability, raw uploads paths,
an alternate storage path and the gated attachment download all refuse access
with 4xx and do not return image bytes. This positive control prevents a missing
object from making all denials falsely reassuring.

Named verification:

- `p1707-photo-storage.e2e`: **2/2 passed**, exit 0, first run 9.788 s.
- The complete repeat including container log assertions: **2/2 passed**,
  exit 0, 20.395 s.
- Backend TypeScript 7 `npm run typecheck`: exit 0.
- Read-only ESLint on the new E2E file: exit 0. `git diff --check`: exit 0.

Limitations: only local device-photo upload success paths and their normal logs
were inspected. This does not cover imported photo filenames, every error log,
all payloads, application HTTP backed by S3, report-render escaping, production
storage configuration, or exhaustive signed-link revocation. S3 driver evidence
is separately named in `2026-11-25-p17-storage-capabilities.md`. No production
data or action, physical-device test or owner signature is involved.
