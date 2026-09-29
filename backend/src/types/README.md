# `backend/src/types/` — the backend's shared type definitions

The one place for types that more than one backend module uses (ADR-087, amending ADR-038;
`docs/ENGINEERING/04-TYPESCRIPT-STANDARDS.md` § Where types live).

## What belongs here

| Kind | Example | File |
|---|---|---|
| Augmentations of a runtime or library global | `process.pkg` | `node-process.d.ts` |
| The request / principal context | `req.user`, `req.tenantId` | `express.d.ts` (P9-05, not written yet) |
| Branded identifiers and their constructors | `TenantId`, `toTenantId()` | `ids.ts` (P9-05, not written yet) |
| The response envelope | `{ success, status, message, data, meta }` | not written yet — the first converted module that builds one adds it |
| Domain and model attribute types shared across layers | | added with the module that first needs them |

## What does not belong here

- **A type derived from a constant's value** stays beside the value, so the two cannot drift:
  `AuditAction` is `(typeof AUDIT_ACTIONS)[number]` in `constants/auditActions.ts`. Import it
  from there.
- **A type used by one module only** stays in that module.
- **A contract shared with the frontend** goes in the `packages/contracts` workspace (P9-22,
  ADR-038), not here. Types here are backend-internal.

## Rules

- Seeded only with types a converted module already uses. No speculative types, and no `any`.
- Type-only imports from here must add nothing at run time: use `import type`
  (`consistent-type-imports` is an error). A `.d.ts` file here is never copied into `dist/`
  and never reaches the binary.
- `declare global` augmentations, and type or interface declarations named like the response
  envelope (`*Envelope`, `ApiResponse*`), are a lint error anywhere else under `backend/`
  (`backend/eslint.config.js`, the `no-restricted-syntax` entry for `.ts` files).
