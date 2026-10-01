# Database migrations

Versioned schema/data changes applied by [Umzug](https://github.com/sequelize/umzug), on top of the
model-driven `db.sync()` (which only creates missing tables). Use migrations for what `sync` can't do
safely on an existing DB: **column renames, custom indexes (GIN/tsvector), backfills, constraints.**

## Running

```bash
npm run migrate          # apply all pending migrations
npm run migrate:undo     # revert the most recent migration
npm run migrate:status   # list pending migrations
```

Pending migrations also run automatically on server startup (after `db.sync()`), non-destructively.

## Writing a migration

Migrations are **TypeScript** (P9-23, ADR-087). Create `src/migrations/NNNN-description.ts` and register it
in the static manifest in `src/config/migrator.js`. The manifest is what runs them, in its order: Umzug's glob
resolver finds nothing inside the packaged binary.

```ts
import type { QueryInterface } from "sequelize";

export = {
  // context = the Sequelize QueryInterface itself (never { queryInterface }); context.sequelize is the instance.
  up: async ({ context }: { context: QueryInterface }): Promise<void> => {
    await context.addColumn("tenants", "example", { type: "VARCHAR(50)", allowNull: true });
  },
  down: async ({ context }: { context: QueryInterface }): Promise<void> => {
    await context.removeColumn("tenants", "example");
  },
};
```

```js
// src/config/migrator.js — the name ENDS IN ".js" even though the file is .ts
["NNNN-description.js", require("../migrations/NNNN-description")],
```

### Names are frozen (P9-23)

`schema_migrations` records the manifest's name string, not the file. Every migration applied so far was
recorded as `NNNN-description.js`, and that is still its name after the file became `.ts`. Change the string
and Umzug sees a migration it has never run, and runs it again on every existing database. So:

- the name is `<module path>.js`, for a TypeScript file too. It is fixed when the migration is first applied and never changes;
- the `require` is extensionless: `tsx` and jest resolve the `.ts`, and the built `dist/` resolves the compiled `.js`;
- `src/tests/migrations/manifestNames.p923.test.ts` holds the 63 historical names, typed by hand, and fails on
  a renamed, reordered or unregistered migration.

Make migrations **idempotent where practical** (guard on column/table existence) so they are safe on
both fresh (`db.sync`-created) and existing databases. Never wrap one in a blanket `try/catch`: a swallowed
error is recorded as applied while having done nothing. Applied migrations are tracked in the
`schema_migrations` table; `npm run migrate:verify` checks the columns, because the log is not evidence.
