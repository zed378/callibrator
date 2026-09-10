# 13 — Integration API

External and adjacent surfaces: API keys, webhooks, SCIM, storage, attachments, GDPR, AI, content, Kanban and the support desk.

---

## `/api/v1/api-keys` — 4 endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/` | create a key |
| GET | `/` | list |
| GET | `/:id` | one |
| DELETE | `/:id` | revoke |

`api_keys`: `name`, `keyPrefix`, `keyHash`, `scopes` (JSONB), `lastUsedAt`, `expiresAt`, `isActive`, `createdBy`.

Only `keyHash` is stored — the plaintext key is returned **once**, at creation, and never again. `keyPrefix` is what a list can display so a human can tell two keys apart without the platform holding either.

`lastUsedAt` is what makes revocation safe: a key nobody has used in six months can be revoked without a conversation.

`expiresAt` should be set. A key with no expiry is a credential that outlives the person who created it and the reason it existed.

## `/api/v1/webhooks` — 7 endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/` | register |
| GET | `/` | list |
| GET | `/:id` | one |
| PATCH | `/:id` | update |
| DELETE | `/:id` | remove |
| GET | `/:id/deliveries` | delivery history |
| POST | `/:id/test` | send a test event |

`webhooks`: `url`, `events` (JSONB), `secret`, `description`, `isActive`, `createdBy`.
`webhook_deliveries`: `event`, `payload` (JSONB), `status` (`pending`, `success`, `failed`, `exhausted`), `attempts`, `responseStatus`, `lastError`, `deliveredAt`.

`exhausted` is a distinct terminal state from `failed`. `failed` means this attempt failed and another will follow; `exhausted` means we have stopped. Collapsing them loses the ability to answer "did we give up, or are we still trying?".

Payloads are signed with the per-webhook `secret` so the receiver can verify origin.

**A tenant-supplied webhook URL is an SSRF vector.** The platform makes an outbound request, with its own network position, to an address the tenant chose — `http://169.254.169.254/`, or an internal service. Destination validation is not optional here.

## `/api/v1/scim/v2` — 12 endpoints

SCIM 2.0, with SCIM-cased paths.

| Method | Path | Method | Path |
|---|---|---|---|
| GET | `/Users` | GET | `/Groups` |
| GET | `/Users/:id` | GET | `/Groups/:id` |
| POST | `/Users` | POST | `/Groups` |
| PUT | `/Users/:id` | PUT | `/Groups/:id` |
| PATCH | `/Users/:id` | PATCH | `/Groups/:id` |
| DELETE | `/Users/:id` | DELETE | `/Groups/:id` |

Capital `U` and `G` are required by the SCIM specification; a lowercase path is not SCIM.

SCIM responses have their **own** envelope (`schemas`, `totalResults`, `Resources`) and their own error format. They do **not** use the platform envelope from [`00-API-STANDARDS.md`](./00-API-STANDARDS.md). That is correct — a SCIM client will not parse anything else.

`DELETE /Users/:id` deprovisions. Given that a user is never hard-deleted (calibration attribution depends on them), this must deactivate, not erase.

## `/api/v1/storage` — 6 endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/object` | fetch an object |
| GET | `/settings` | tenant storage configuration |
| PUT | `/settings` | set it |
| DELETE | `/settings` | revert to the platform default |
| POST | `/settings/test` | test connectivity before saving |
| GET | `/usage` | storage usage |

`POST /settings/test` before `PUT /settings` is the right order: saving a configuration that does not work leaves the tenant unable to upload and unable to see why.

Credentials are encrypted at rest with `ENCRYPT_KEY` and must never be returned by `GET /settings`.

**Tenant-supplied S3 endpoints are SSRF-checked; operator-configured ones are not.** The operator is allowed to name an internal host (`http://minio:9000`); a tenant is not. Any refactor that unifies the two paths must keep the tenant side checked.

## `/api/v1/attachments` — 7 endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/:id/signed` | signature | serve a signed download |
| POST | `/` | bearer | upload (multipart) |
| GET | `/` | bearer | list |
| GET | `/:id` | bearer | metadata |
| GET | `/:id/download` | bearer | download |
| POST | `/:id/signed-url` | bearer | mint a signed URL |
| DELETE | `/:id` | bearer | soft delete |

Signed URLs are HMAC-signed with `ATTACHMENT_URL_SECRET` and time-limited. The URL is the capability; expiry bounds the damage when one leaks into a chat log.

Uploads are virus-scanned when `VIRUS_SCAN_PROVIDER=clamav`. `VIRUS_SCAN_FAIL_OPEN` defaults to **false** — a scanner error rejects the upload. Fail-closed is inconvenient when ClamAV is down and correct anyway: the alternative silently disables scanning at exactly the moment it is not working.

## `/api/v1/gdpr` — 8 endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/export` | DSAR export |
| POST | `/erasure` | DSAR erasure |
| GET | `/erasure/:requestId` | erasure status |
| PUT | `/consent` | record consent |
| GET | `/consent/history` | consent history |
| GET | `/processing` | processing activities |
| PUT | `/rectify` | rectification |
| POST | `/restrict` | restriction of processing |

`dsar_requests`: `type` (`export`, `erasure`, `rectification`, `restriction`), `status` (`pending`, `in_progress`, `completed`, `rejected`), `details` (JSONB), `requestedAt`, `completedAt`.

`consent_records`: `purpose`, **`version`**, `status` (`granted`, `withdrawn`), `ipAddress`, `consentedAt`, `withdrawnAt`.

`version` is what makes a consent record meaningful. Without it the row proves someone clicked agree; with it, it proves what they agreed to — which is the question asked at audit.

**Erasure anonymises, it does not delete.** A calibration record whose `performedBy` resolves to nothing has lost the attribution that made it evidence. Erasure severs the identity and preserves the record.

Erasure checks legal hold **first** (BR-16).

### Known drift

Swagger bodies for these endpoints diverge from the enforced Joi validators. Documented drift, tracked in [`../../TASKS/BACKLOG.md`](../../TASKS/BACKLOG.md).

`POST /export` also returns errors when no AI/embeddings provider is configured — an environment condition, not a code defect.

## `/api/v1/ai` — 2 endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/ocr` | extract text from an image or PDF |
| POST | `/query` | RAG question answering |

Backed by `document_chunks` with a `vector(1536)` embedding (migration `0018`, requires `CREATE EXTENSION vector` — hence `pgvector/pgvector:pg17` in compose).

Configuration is OpenAI-compatible: `OPENAI_API_KEY`, `OPENAI_BASE_URL`, with per-tenant keys overriding the platform default.

**Vector search does not respect tenancy unless the query says so.** A similarity search that omits the tenant predicate will return another hospital documents as context and paraphrase them into an answer, with no error and nothing in the response marking where the content came from. `document_chunks.tenantId` is indexed and the scoping hooks apply, but this is the module where a review should look hardest.

## `/api/v1/content` — 13 endpoints

### Public

| Method | Path |
|---|---|
| GET | `/posts/public` |
| GET | `/posts/public/:slug` |
| GET | `/categories/public` |

Unauthenticated, serving the marketing site.

### Authenticated

| Method | Path | Purpose |
|---|---|---|
| GET | `/posts` | list, including drafts |
| GET | `/slug-check` | availability |
| POST | `/posts` | create |
| GET | `/posts/:id` | one |
| PATCH | `/posts/:id` | update |
| DELETE | `/posts/:id` | soft delete |
| GET/POST/PATCH/DELETE | `/categories`, `/categories/:id` | category CRUD |

`posts` is **not tenant-scoped** — blog and news content is platform marketing, not tenant data. `type` is `BLOG` or `NEWS`; `status` is `DRAFT`, `PUBLISHED`, `ARCHIVED`.

Author fields (`authorName`, `authorRole`, `authorAvatarUrl`) are denormalised rather than joined to `users`, so a published article keeps its byline after the author account is deactivated or anonymised.

`contentHtml` comes from the TipTap editor and is user-supplied HTML rendered into a public page — the stored-XSS surface of this system. It must be sanitised on the way in and rendered with a CSP that does not permit inline script.

## `/api/v1/kanban` — 28 endpoints

Projects, members, sprints, columns, cards, card relations, labels and metrics across nine `kanban_*` tables.

| Group | Paths |
|---|---|
| Projects | `/projects`, `/projects/:projectId` |
| Members | `/projects/:projectId/members[/:memberId]` |
| Sprints | `/projects/:projectId/sprints[/:sprintId]`, `/sprints/migrate` |
| Columns | `/projects/:projectId/columns[/:columnId]`, `/columns/reorder` |
| Cards | `/projects/:projectId/cards[/:cardId]`, `/cards/:cardId/move`, `/cards/:cardId/relations[/:relationId]` |
| Labels | `/projects/:projectId/labels[/:labelId]` |
| Metrics | `/projects/:projectId/metrics` |

`kanban_cards` carries a stable `cardKey` derived from the project `code` and a per-project `cardSeq`, so a card referenced in a commit message stays findable after it moves column or sprint.

`kanban_columns.isDone` marks the terminal column, which is what makes cycle-time metrics computable.

**Socket gotcha:** the room join takes the **raw `projectId`**, not a prefixed room name. A prefixed string joins a room nobody publishes to, and the symptom is silence, not an error.

## `/api/v1/tickets` — 8 endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | list |
| POST | `/` | raise |
| GET | `/metrics` | desk metrics |
| GET | `/:ticketId` | one |
| PATCH | `/:ticketId` | update |
| DELETE | `/:ticketId` | soft delete |
| POST | `/:ticketId/assign` | assign |
| POST | `/:ticketId/comments` | comment |

`tickets`: `number`, `ticketKey`, `subject`, `description`, `status`, `priority`, `category`, `createdBy`, `assignedTo`, `dueDate`, `resolvedAt`, `closedAt`. `ticket_counters` gives each tenant its own sequence.

`ticket_comments.isInternal` marks a note visible to responders only. A comment endpoint that returns internal notes to the raiser is a disclosure bug, and the flag is easy to forget in a list query.

**Two sides, and the operator is only on one.** `SUPERADMIN` holds `tickets-response` and deliberately **not** `tickets-raise` — the platform operator answers tickets and never raises them (BR-13). The response side is cross-tenant, because otherwise the operator could not answer anyone.

## `/api/v1/webauthn`, `/api/v1/oidc`

Covered in [`01-AUTHENTICATION-API.md`](./01-AUTHENTICATION-API.md).
