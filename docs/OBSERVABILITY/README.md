# Observability

What this system emits while it runs, where it goes, and what is lost on the way. [`../DEVOPS/`](../DEVOPS/06-LOGGING.md) covers how the platform is operated; this category covers what an operator can actually see.

> **Target standard: TypeScript, strict (ADR-038).** The backend is **JavaScript/CommonJS** today. Documents here name `.js` files because those are the files, and label current behaviour **as-built**.

## Documents

| | Document | Covers |
|---|---|---|
| 01 | [Logging](./01-LOGGING.md) | transports, levels, rotation, redaction, and why `docker logs` is empty |

## The Short Version

**In production the winston logger writes to files only.** Every log line lands in the `./volumes/log` bind mount; nothing a container-log collector reads exists. Per-request lines are emitted at `http`, which is below the production level, so none of them is written at all. There is no metrics stack, no tracing and no aggregation.

Read [`01-LOGGING.md`](./01-LOGGING.md) before concluding that a subsystem was silent. It probably wrote a file.

## Related

| For | Read |
|---|---|
| how to log from application code | [`../ENGINEERING/12-LOGGING-CONVENTIONS.md`](../ENGINEERING/12-LOGGING-CONVENTIONS.md) |
| the operational summary and redaction target | [`../DEVOPS/06-LOGGING.md`](../DEVOPS/06-LOGGING.md) |
| alerting | [`../DEVOPS/07-ALERTING.md`](../DEVOPS/07-ALERTING.md) |
| the compliance trail, which is a table and not a log | [`../DATABASE/10-AUDIT-LOGS.md`](../DATABASE/10-AUDIT-LOGS.md) |
| the open remediation item | [`../../TASKS/AUDIT-2026-09-REMEDIATION.md`](../../TASKS/AUDIT-2026-09-REMEDIATION.md) § A-14 |
