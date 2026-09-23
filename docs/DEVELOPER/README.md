# Developer Guides

Task-shaped guides for integrating **with** this system: the paths a device, an identity provider or another service takes into it, and what a developer has to know before wiring one up.

The rest of `docs/` is organised by layer — [`../API/`](../API/00-API-STANDARDS.md) is the contract, [`../BACKEND/`](../BACKEND/00-BACKEND-STANDARDS.md) is the implementation, [`../ENGINEERING/`](../ENGINEERING/README.md) is how code here is written. This category is organised by the job you came to do.

> **Target standard: TypeScript, strict (ADR-038).** The backend is **JavaScript/CommonJS** today. Documents here name `.js` files because those are the files, and label current behaviour **as-built**.

## Documents

| | Document | Covers |
|---|---|---|
| 07 | [IoT Ingest](./07-IOT-INGEST.md) | HTTP and MQTT telemetry, the provisioning gap, the broker ACL requirement |
| 09 | [SCIM Provisioning](./09-SCIM-PROVISIONING.md) | directory-driven user lifecycle |

The numbering leaves gaps for guides referenced elsewhere in the repository and not yet written. A link to a `DEVELOPER/` path that is absent from the table above is a broken link, not a hidden document.

## A Standing Warning For This Category

An integration surface in this category can be **built and unreachable** — the code exists, the tests are green, and no external party can actually use it, because provisioning does not exist. IoT ingest is exactly that ([`07-IOT-INGEST.md`](./07-IOT-INGEST.md) § Read This First). Where it applies, the document says so in its own section, at the top, and names the remediation item.

Believe that section over anything a task board, a changelog or a green test run says. See [`../../CLAUDE.md`](../../CLAUDE.md) § Distinguish "Renders" From "Works", and [`../../TASKS/AUDIT-2026-09-REMEDIATION.md`](../../TASKS/AUDIT-2026-09-REMEDIATION.md).

## Related

| For | Read |
|---|---|
| the endpoint contract for anything here | [`../API/`](../API/00-API-STANDARDS.md) |
| tenant isolation, which every integration inherits | [`../SECURITY/05-MULTI-TENANCY-SECURITY.md`](../SECURITY/05-MULTI-TENANCY-SECURITY.md) |
| what an integration's failures look like in the logs | [`../OBSERVABILITY/01-LOGGING.md`](../OBSERVABILITY/01-LOGGING.md) |
