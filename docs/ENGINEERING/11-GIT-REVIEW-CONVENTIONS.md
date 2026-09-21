# 11 — Git and Review Conventions

How changes are shaped, named and reviewed. The rules are in [`../../TASKS/00-TASK-CONVENTIONS.md`](../../TASKS/00-TASK-CONVENTIONS.md); this is the engineering view of them.

---

## Branches and Commits

```
{type}/{task-id}-{kebab-description}        fix/A-01-tenant-hierarchy-gate
{TASK-ID}: {imperative summary}             A-01: Gate tenant-hierarchy writes to super-admins
```

Types: `feat`, `fix`, `refactor`, `docs`, `chore`, `test`.

A commit body says **why**, what was verified, and how. "Fix bug" is not a commit message; "`$1` passed as `replacements` fails on PostgreSQL; verified against pg 17; `getUsage` returned zero for every tenant" is.

Commits authored with an AI agent end with its `Co-Authored-By` trailer.

## One Change, One Purpose

| Mixed into one PR | Why it is refused |
|---|---|
| a TypeScript conversion **and** a bug fix | ADR-038 rule 3: neither can be reviewed. The fix goes first, in its own PR, against an audit task |
| a refactor **and** a behaviour change | a reviewer cannot tell which lines change behaviour |
| a migration **and** the code that depends on it being applied | deploy order becomes a coin toss — ship the migration first |
| a documentation claim **and** no check against the code | PR-4 |

## As-Built Practice, Stated Plainly

`CLAUDE.md` says "always PR and code review; never commit to `main`". In practice this repository has been committed to `main` directly, including by agents, with no CI and no hook to stop it. The rule stands; the practice is the gap P7-01 and a branch protection rule close.

## What Review Is For

Review checks what no tool here checks yet:

1. **the permission gate** on every new route (P6-04 is not built);
2. **the tenant predicate** in every new raw query;
3. **the two-tenant test** for every new `:id` route;
4. **the audit row inside the transaction** for every mutation;
5. **the document** the change contradicts — updated in the same PR, with an ADR if it is a deviation.

The full list: [`14-CODE-REVIEW-CHECKLIST.md`](./14-CODE-REVIEW-CHECKLIST.md).

## Documentation Travels With Code

- A new environment variable: `.env.example` **and** `docs/BACKEND/11-CONFIGURATION.md`, same commit.
- A deviation from `docs/`: an ADR in `MEMORY/DECISIONS.md`, then the doc amended to cite it.
- A finished task: its `MEMORY/records/` entry, an index line, a changelog line, `TASKS/PROGRESS.md` — same commit.

**Never amend `docs/` quietly.** The 2026-09-21 audit found five documented mechanisms that did not exist. Every one of them had been written down without being checked.

## Deployment Follows `main`

The reference deployment pulls `main` and rebuilds the affected image after every source change. A commit to `main` is therefore a deploy candidate: it must build, boot, and pass `/health`.
