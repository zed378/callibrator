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

Create `src/migrations/NNNN-description.js` (files run in lexicographic order):

```js
module.exports = {
  // context = Sequelize QueryInterface; context.sequelize is the instance.
  async up({ context }) {
    await context.addColumn("tenants", "example", { type: "VARCHAR(50)", allowNull: true });
  },
  async down({ context }) {
    await context.removeColumn("tenants", "example");
  },
};
```

Make migrations **idempotent where practical** (guard on column/table existence) so they are safe on
both fresh (`db.sync`-created) and existing databases. Applied migrations are tracked in the
`schema_migrations` table.
