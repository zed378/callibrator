# 12 — Platform Tables

`notifications` · `notification_states` · `attachments` · `batch_jobs` · `api_keys` · `webhooks` · `webhook_deliveries` · `dsar_requests` · `document_chunks` · content tables · Kanban tables · ticket tables

---

## `notifications` and `notification_states`

### `notifications`

`tenantId`, `userId`, `type` (ENUM `SYSTEM`, `CALIBRATION`, `INVENTORY`, `MAINTENANCE`), `title`, `message`, `isRead`, `actionUrl`.

### `notification_states`

`notificationId`, `userId`, `isRead`, `readAt`, `deletedAt`. Indexed on `(notification_id, user_id)` and `user_id`.

### Why two tables

One event fanned out to twelve technicians stores its body **once**, and one of them dismissing it does not affect the other eleven.

`notification_states.deletedAt` is a **per-user dismissal**, not a delete of the notification. The underlying row survives, which is what makes "why was I not told" answerable.

Note `notifications.isRead` also exists — a leftover from before the state table. `notification_states` is authoritative; two sources for one fact can disagree, and this one already can.

`actionUrl` is what makes a notification useful rather than merely informative: it points at the screen where the thing can be dealt with.

## `attachments` — `paranoid`

| Column | Type | Notes |
|---|---|---|
| `tenantId` | `UUID` | indexed |
| `resourceType`, `resourceId` | `STRING`, `UUID` | **polymorphic**, indexed as a pair |
| `fileName` | `STRING` | sanitised, collision-safe |
| `originalName` | `STRING` | what the uploader called it |
| `folder` | `STRING` | logical grouping |
| `storageKey` | `STRING` | the object key (migration `0016`) |
| `mimeType` | `STRING` | |
| `size` | **`BIGINT`** | scanned certificate archives exceed 2 GB |
| `checksum` | `STRING` | integrity and duplicate detection |
| `uploadedBy` | `UUID` | |

`originalName` alongside `fileName` matters: the stored name is sanitised, the original is what the user recognises in a list.

`storageKey` rather than a path is what lets the same row be served from local disk, S3 or NFS without rewriting anything — and what makes migration between drivers a data operation rather than a code change.

**The key encodes tenant identity**, which makes key construction a tenant-isolation control rather than a formatting concern. Key building belongs in the storage service and nowhere else.

Downloads go through HMAC-signed, time-limited URLs (`ATTACHMENT_URL_SECRET`). The URL is the capability; expiry bounds the damage when one leaks into a chat log.

## `batch_jobs`

`tenantId`, `userId`, `type`, `status` (ENUM `PENDING`, `PROCESSING`, `COMPLETED`, `FAILED`), `progress`, `totalItems`, `processedItems`, `resultUrl`, `errorDetails`. Migration `0005`.

**`PROCESSING` is not a resting state.** A job stuck there is indistinguishable from one that is working. A worker crash must leave the row recoverable — reclaimed by another consumer, or swept to `FAILED`.

`totalItems` and `processedItems` alongside `progress` because a percentage alone cannot tell a user whether "47%" means 47 rows or 47,000.

## `api_keys` — `paranoid`

`tenantId`, `name`, `keyPrefix`, `keyHash`, `scopes` (JSONB), `lastUsedAt`, `expiresAt`, `isActive`, `createdBy`. Indexed on `tenant_id`, `key_hash`, `is_deleted`.

Only the **hash** is stored. The plaintext key is returned once, at creation, and never again.

`keyPrefix` is what a list can display so a human can tell two keys apart without the platform holding either.

`lastUsedAt` is what makes revocation safe: a key nobody has used in six months can be revoked without a conversation.

`expiresAt` should always be set. A key with no expiry outlives the person who created it and the reason it existed.

## `webhooks` and `webhook_deliveries`

### `webhooks` — `paranoid`

`tenantId`, `url`, `events` (JSONB), `secret`, `description`, `isActive`, `createdBy`.

**A tenant-supplied URL is an SSRF vector.** The platform makes an outbound request, from its own network position, to an address the tenant chose — `http://169.254.169.254/`, or an internal service. Destination validation is not optional.

### `webhook_deliveries`

`tenantId`, `webhookId`, `event`, `payload` (JSONB), `status` (ENUM `pending`, `success`, `failed`, `exhausted`), `attempts`, `responseStatus`, `lastError`, `deliveredAt`.

`exhausted` is a distinct terminal state from `failed`: `failed` means this attempt failed and another will follow, `exhausted` means we have stopped trying. Collapsing them loses the ability to answer "did we give up, or are we still going?".

## `dsar_requests`

`tenantId`, `userId`, `type` (ENUM `export`, `erasure`, `rectification`, `restriction`), `status` (ENUM `pending`, `in_progress`, `completed`, `rejected`), `details` (JSONB), `requestedAt`, `completedAt`.

`rejected` is a legitimate outcome — a request may be refused where an exemption applies — and it must be recorded with its reason, because refusing quietly is indistinguishable from ignoring.

Erasure checks legal hold **first** (BR-16), and anonymises rather than deletes.

## `document_chunks`

`tenantId`, `sourceType`, `sourceId`, `chunkIndex`, `content`, and an `embedding` column of type **`vector(1536)`**. Migration `0018` runs `CREATE EXTENSION vector`.

Indexed on `tenant_id` and `(source_type, source_id)`.

**PostgreSQL only.** On MySQL the AI/RAG module is unavailable rather than differently implemented — a documented capability difference, not a portability claim. This is why the compose stack uses `pgvector/pgvector:pg17` rather than plain `postgres:17-alpine`.

**Vector similarity search does not respect tenancy unless the query says so.** A retrieval omitting the tenant predicate will return another hospital's documents as context and paraphrase them into an answer, with no error and nothing in the response marking where the content came from. This is the module where a security review should look hardest.

## Content — `posts`, `categories`, `post_categories`

### `posts` — `paranoid`, **global**

`type` (ENUM `BLOG`, `NEWS`), `title`, `slug` (indexed), `excerpt`, `coverImageUrl`, `contentHtml`, `status` (ENUM `DRAFT`, `PUBLISHED`, `ARCHIVED`), `publishedAt` (indexed), `authorName`, `authorRole`, `authorAvatarUrl`, `readingMinutes`, `featured`, `createdBy`.

Not tenant-scoped, deliberately: blog and news content is platform marketing served on the public site, not tenant data.

Author fields are **denormalised** rather than joined to `users`, so a published article keeps its byline after the author account is deactivated or anonymised.

`contentHtml` is user-supplied HTML rendered into a public page — **the stored-XSS surface of this system**. It must be sanitised on the way in and rendered under a CSP that does not permit inline script.

### `categories` — global

`name`, `slug` (indexed), `description`, `isDeleted`.

### `post_categories`

`postId`, `categoryId`. Indexed as a pair and individually.

## Kanban — nine tables

| Table | Notes |
|---|---|
| `kanban_projects` | `paranoid`, `code`, **`cardSeq`** — the per-project counter behind stable card keys |
| `kanban_columns` | `position`, `wipLimit`, **`isDone`** — marks the terminal column, which is what makes cycle time computable |
| `kanban_cards` | `paranoid`, `number`, **`cardKey`**, `sprintId`, `position`, `priority`, `archivedAt` |
| `kanban_card_assignees` | many-to-many |
| `kanban_card_labels` | many-to-many |
| `kanban_card_relations` | `sourceCardId`, `targetCardId`, `type` — indexed as a triple |
| `kanban_labels` | per project |
| `kanban_sprints` | `goal`, `status`, `startDate`, `endDate`, `position` |
| `kanban_project_members` | `roleId`, `accessLevel` |

`cardKey` is derived from the project `code` and `cardSeq`, so a card referenced in a commit message stays findable after it moves column or sprint.

Only `kanban_projects` and `kanban_cards` carry `tenantId`; the rest inherit tenancy through `projectId`. That is a deliberate denormalisation and it means a query starting from a child table **must** join to the project to be scoped.

**Socket gotcha:** the room join takes the raw `projectId`, not a prefixed room name. A prefixed string joins a room nobody publishes to, and the symptom is silence rather than an error.

## Support — three tables

| Table | Notes |
|---|---|
| `tickets` | `paranoid`, `number`, `ticketKey`, `status`, `priority`, `category`, `createdBy`, `assignedTo`, `dueDate`, `resolvedAt`, `closedAt` |
| `ticket_comments` | `body`, **`isInternal`** |
| `ticket_counters` | `tenantId`, `seq` — per-tenant sequence |

`ticket_comments.isInternal` marks a note visible to responders only. A list query that forgets the flag returns internal notes to the raiser, which is a disclosure bug and an easy one to write.

`resolvedAt` and `closedAt` are separate: resolved means the responder believes it is fixed, closed means the raiser agrees or time ran out. One column cannot express both, and the gap between them is the metric worth watching.
