# Engineering Conventions

How code in this repository is written, laid out, named, layered, tested, logged and reviewed. The rest of `docs/` says **what** the system does; this category says **how** it is built, so that work done by different people and different agent sessions lands as one codebase.

> **Target standard: TypeScript, strict (ADR-038).** The backend is still **JavaScript/CommonJS** while [`../../TASKS/PHASE-9-TYPESCRIPT-MIGRATION.md`](../../TASKS/PHASE-9-TYPESCRIPT-MIGRATION.md) runs. Documents here state the target for new and converted code and label current behaviour **as-built**. The database is PostgreSQL only (ADR-039).

Start with [`00-CODING-CONTEXT.md`](./00-CODING-CONTEXT.md) — it fits in one read and points at everything else.

## Documents

| | Document | Covers |
|---|---|---|
| 00 | [Coding Context](./00-CODING-CONTEXT.md) | the master reference: stack, layers, non-negotiables, traps |
| 01 | [Coding Standards](./01-CODING-STANDARDS.md) | the numbered rules (`CS-x.y`) to cite in review |
| 02 | [Project Structure](./02-PROJECT-STRUCTURE.md) | where everything lives, and where new things go |
| 03 | [Naming Conventions](./03-NAMING-CONVENTIONS.md) | files, URLs, tables, roles, events, keys — and the known inconsistencies |
| 04 | [TypeScript Standards](./04-TYPESCRIPT-STANDARDS.md) | compiler flags, lint rules, branded ids, exhaustive unions |
| 05 | [Layer Templates](./05-LAYER-TEMPLATES.md) | a copyable template per layer, target and as-built side by side |
| 06 | [Error and Response Standards](./06-ERROR-RESPONSE-STANDARDS.md) | the envelope, status codes, who may write an error |
| 07 | [Database Access Standards](./07-DATABASE-ACCESS-STANDARDS.md) | scoping hooks, raw SQL, includes, attribute traps, migrations |
| 08 | [Cache and Queue Standards](./08-CACHE-QUEUE-STANDARDS.md) | the two Redis clients, locks and claims, RabbitMQ |
| 09 | [Testing Conventions](./09-TESTING-CONVENTIONS.md) | the layers, and the specific ways tests here have lied |
| 10 | [Tooling, Lint and Format](./10-TOOLING-LINT-FORMAT.md) | commands, configs as they are, and the targets |
| 11 | [Git and Review Conventions](./11-GIT-REVIEW-CONVENTIONS.md) | branches, commits, one-purpose PRs |
| 12 | [Logging Conventions](./12-LOGGING-CONVENTIONS.md) | the shared logger, levels, never-log list |
| 13 | [Security Coding Rules](./13-SECURITY-CODING-RULES.md) | the keyboard-level rules, each tied to the defect behind it |
| 14 | [Code Review Checklist](./14-CODE-REVIEW-CHECKLIST.md) | copy into the PR |

## Relationship to the Rest of the Repository

| For | Read |
|---|---|
| what the backend does, module by module | [`../BACKEND/`](../BACKEND/00-BACKEND-STANDARDS.md) |
| the security model behind the rules in 13 | [`../SECURITY/`](../SECURITY/00-SECURITY-REQUIREMENTS.md) |
| the decisions these conventions implement | [`../../MEMORY/DECISIONS.md`](../../MEMORY/DECISIONS.md) — ADR-029, 038, 039 especially |
| the defects that produced most of these rules | [`../../TASKS/AUDIT-2026-09-REMEDIATION.md`](../../TASKS/AUDIT-2026-09-REMEDIATION.md) |
