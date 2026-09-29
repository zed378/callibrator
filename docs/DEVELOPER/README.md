# Developer Guides

Task-shaped guides for integrating **with** this system: the paths a device, an identity provider or another service takes into it, and what a developer has to know before wiring one up.

The rest of `docs/` is organised by layer — [`../API/`](../API/00-API-STANDARDS.md) is the contract, [`../BACKEND/`](../BACKEND/00-BACKEND-STANDARDS.md) is the implementation, [`../ENGINEERING/`](../ENGINEERING/README.md) is how code here is written. This category is organised by the job you came to do.

> **Target standard: TypeScript, strict (ADR-038).** The backend is **JavaScript/CommonJS** today. Documents here name `.js` files because those are the files, and label current behaviour **as-built**.

## Documents

| | Document | Covers |
|---|---|---|
| 00 | [Integration Quickstart](./00-INTEGRATION-QUICKSTART.md) | start here: the ways in, which work, the envelope once |
| 02 | [Authentication and API-Key Reach](./02-AUTHENTICATION.md) | API keys, deny-by-default, the issuable scopes, which of the 53 route modules a key can reach |
| 03 | [Rate Limits and Error Codes](./03-RATE-LIMITS-AND-ERROR-CODES.md) | every limiter as built, what a 429 carries, whether `req.ip` is the client, the status codes a client branches on |
| 07 | [IoT Ingest](./07-IOT-INGEST.md) | HTTP and MQTT telemetry, the provisioning gap, the broker ACL requirement |
| 09 | [SCIM Provisioning](./09-SCIM-PROVISIONING.md) | directory-driven user lifecycle |

The numbering leaves gaps for guides referenced elsewhere in the repository and not yet written. A link to a `DEVELOPER/` path that is absent from the table above is a broken link, not a hidden document.

## A Standing Warning For This Category

An integration surface in this category can be **built and unreachable** — the code exists, the tests are green, and no external party can actually use it, because provisioning does not exist. IoT ingest was exactly that until 2026-09-24, when A-29 added device provisioning ([`07-IOT-INGEST.md`](./07-IOT-INGEST.md), its update banner — corrected here under ADR-088); its MQTT path still authenticates by topic only (A-17). Where it applies, the document says so in its own section, at the top, and names the remediation item.

Believe that section over anything a task board, a changelog or a green test run says. See [`../../CLAUDE.md`](../../CLAUDE.md) § Distinguish "Renders" From "Works", and [`../../TASKS/AUDIT-2026-09-REMEDIATION.md`](../../TASKS/AUDIT-2026-09-REMEDIATION.md).

## Related

| For | Read |
|---|---|
| the endpoint contract for anything here | [`../API/`](../API/00-API-STANDARDS.md) |
| tenant isolation, which every integration inherits | [`../SECURITY/05-MULTI-TENANCY-SECURITY.md`](../SECURITY/05-MULTI-TENANCY-SECURITY.md) |
| what an integration's failures look like in the logs | [`../OBSERVABILITY/01-LOGGING.md`](../OBSERVABILITY/01-LOGGING.md) |
