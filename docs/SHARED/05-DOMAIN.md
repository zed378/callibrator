# 05 — `@callibrator/domain` (TARGET)

> **Status: TARGET (ADR-134). Not built.** The rules it composes are specified (target) in ADR-124
> Am. 1, ADR-125 Am. 1, ADR-126 Am. 1–2, ADR-132, ADR-133 and their specs (`MEMORY/specs/P18-03`,
> `P19-01` … `P19-08`), and partly **as built** in `frontend/src/lib/statusTone.ts` (ADR-122),
> `actorLabel.ts` (Q-51, ADR-100 Am. 2) and `menuAccess.ts` (F-10). Built by P35-05.

---

## 1. The Boundary With `contracts` — One Home per Rule

`domain` holds **client-side** pure rules: how a client *reads*, *classifies* and *presents* domain
facts. It never holds a rule the **server enforces** — those live in `@callibrator/contracts`, which
the backend imports, so server and client compute them from one source (ADR-097, `01` § 3):

| Rule | Home | Why |
|---|---|---|
| `normaliseQrCode(input, { prefix, digits })` — trim, upper-case, pad a bare number (ADR-132 § 1, P19-03 § 4.2) | **contracts** | the validator, the lookup path parameter and the ETL use it; a client that normalised differently would look up a different sticker |
| `deriveNextCalibrationDate`, `computeCalibrationDue` (ADR-133 § 1, § 4) | **contracts** | the server derives and stores; the client must agree when it recomputes offline |
| `computeIpmDue`, `normaliseResult`, `missingRequiredItems` (P19-02 § 13) | **contracts** | the submit's 400 and the offline checklist validation must name the same missing items |
| `canonicalIpmReportPayload` (ADR-126 Am. 2) | **contracts** | the hash the server stores is recomputed in the browser |
| conflict-code tuples (`IPM_CONFLICT_CODES`, `IDEMPOTENCY_CONFLICT_CODES`, `SCOPE_LOSS_CODES`, device codes) | **contracts** | the server emits them; clients switch on them |
| reading a scanned code (§ 3), classifying a due state for display (§ 2), the limit hint (§ 4), the capability check (§ 5), the state→tone registry (§ 6), the actor label (§ 7) | **domain** | presentation and client decisions; the server has no use for them |

`domain` **imports** contracts' functions and composes them; it never re-implements or re-exports one.
A guard test lists contracts' exported functions and fails if `domain` exports a function of the same
name (`01` § 11).

**Not a client authority.** Nothing in `domain` decides scope, permission or validity on the
server's behalf. A rule here answers "what should this screen show or offer?"; the server's answer
to the request is final, and the client shows it (404, 409 with its explanation).

## 2. Due Dates, Online and Offline (ADR-133, ADR-126 § 6)

The server computes "calibration due" and "IPM due" **at read** (ADR-133 § 4; P19-02 § 11) and sends
the result (`calibrationDue`, `ipmDue` in `fieldDeviceSummary`, P19-08 § 7.2). Online, a client shows
the server's value. Offline, the value ages: a device `due_soon` when the working set was downloaded
three days ago may be `overdue` today.

```ts
// packages/domain/src/due.ts (target API)
export type DueState = "overdue" | "due_soon" | "requested" | "ok" | "not_scheduled";   // ADR-133 § 4 names
export interface DueView { state: DueState; tone: StatusTone; daysUntil: number | null; estimatedOffline: boolean }

/** Online: present the server's computed state. */
export function presentDue(serverState: DueState, dueDate: string | null, today: LocalDate): DueView;

/** Offline: recompute with contracts' computeCalibrationDue / computeIpmDue from the stored inputs and
 *  TODAY IN THE TENANT'S TIME ZONE (tenantSettings.timeZone from the working set), flagged as estimated. */
export function recomputeDueOffline(input: StoredDueInputs, today: LocalDate, settings: { dueSoonDays: number }): DueView;
```

- **"Today" is the tenant's local day** (UD-7), computed from the device clock *and* the time zone in
  the working set — never the device's own zone. A device clock rolled back cannot make a set
  younger: the purge rules of `06` § 8 use the server `Date` too.
- An offline-recomputed value is **always labelled** ("estimated, as of last sync <time>") and never
  written back; the next online read replaces it.
- Tone: `overdue → alarm`, `due_soon → attention`, `requested → attention`, `ok → current`,
  `not_scheduled → draft` (the `calibrationDue` row of the as-built registry, extended with ADR-133's
  states).

## 3. Reading a Scanned Code (ADR-132, ADR-100, ADR-126 Am. 2, UD-16)

The camera returns text. What it means depends on its shape, and the answer drives a different
screen:

```ts
// packages/domain/src/scan.ts (target API)
export type ScanResult =
  | { kind: "device"; qrCode: string }                                 // a device sticker → GET /calibration-devices/by-qr/:qrCode
  | { kind: "certificate_verification"; number: string; token: string } // ADR-100 → the public verification read
  | { kind: "ipm_report_verification"; number: string; token: string } // ADR-126 Am. 2 → GET /ipm/verify/:reportNumber?token=
  | { kind: "legacy_sticker"; candidate: string | null }               // an upstream URL (UD-16; resolver rules of Phase 27)
  | { kind: "unknown"; reason: "foreign_host" | "unreadable" | "too_long" };

export function readScan(
  text: string,
  context: { verificationHosts: readonly string[]; legacyHosts: readonly string[]; qr: { prefix: string | null; digits: number } },
): ScanResult;
```

- A **URL** is accepted only on a host in `verificationHosts` (this deployment's public origins, from
  configuration) or `legacyHosts` (the upstream's, until Phase 27 retires it). A URL on any other host
  is `unknown/foreign_host` — the app never opens an arbitrary scanned link (phishing by sticker).
- A verification URL is parsed for its number and token **without** being fetched as given: the client
  calls the API route itself. The token is a capability (ADR-100); it is never logged.
- A **bare code** goes through contracts' `normaliseQrCode` with the tenant's prefix and digits (from
  the working set or the online settings read). Its 400 cases ("longer than <digits> digits", "3 – 32
  letters, digits or hyphens") become `unknown` with the same wording the server would give.
- The **404 of a lookup is the same everywhere** (ADR-132 § 2): unknown, deleted, another facility's
  and another tenant's sticker are one answer. `domain` offers one message for it ("No device with
  this code in your access") and nothing that hints which case it was.
- Offline, a `device` result is looked up in the decrypted working set (`06` § 6); a miss offline is
  "not in the devices you took offline", never "does not exist".

## 4. Limits and the Checklist Preview (ADR-125 Am. 1, P19-02)

Catalogue items carry **structured limits** with hard and soft ranges and typed outcomes per section
(ADR-125 Am. 1). Whether a measured value passes is decided by contracts' `normaliseResult(item,
input)` — the same function the server runs on `PUT …/results` (whose 400 names an out-of-hard-range
value). `domain` adds only what a screen needs **before** the server answers:

```ts
export interface LimitHint { kind: "range" | "max" | "min" | "boolean" | "text"; hard: Range | null; soft: Range | null; unit: string | null }
export function limitHint(item: CatalogueItem): LimitHint;                     // structured; worded by i18n
export function previewOutcome(item: CatalogueItem, input: ResultInput): PreviewOutcome; // = contracts' normaliseResult, plus "soft-range warning"
export function checklistProgress(items: CatalogueItem[], results: ResultInput[]): { required: number; done: number; missing: ItemRef[] }; // via missingRequiredItems
```

The pinned catalogue version (ADR-125 § 3) is what both sides evaluate against; the client's copy of
labels, limits and kinds is **never trusted** by the server (P19-02 § 9), so a client that evaluated
an outdated copy is corrected by the server's 400, which the capture shows against the item.

## 5. What a User May Do Here — Capability, Not Role (ADR-102, ADR-124 Am. 1)

As built (ADR-102): the sidebar and every page's write actions derive from **the one effective
permission the API checks**, read from `GET /menu-groups/my-permissions`; pages never test role names
(`docs/FRONTEND/05-RBAC-IN-UI.md`). ADR-124 Am. 1 (target) caps a facility-bound principal's
effective permission by `BOUND_MENU_CEILING` **on the server** and adds `facilityBound` to the answer.

```ts
// packages/domain/src/capability.ts (target API)
export interface EffectivePermissions { superAdmin: boolean; facilityBound: boolean; permissions: Readonly<Record<MenuSlug, { read: boolean; write: boolean }>> }
export function can(p: EffectivePermissions, slug: MenuSlug, action: "read" | "write"): boolean;
/** For a bound principal, a write is offered only if the operation is facility-accessible. */
export function canInvoke(p: EffectivePermissions, op: OperationRef): boolean;
```

- `can` is a lookup in the server's answer — **no ceiling is recomputed on the client.** The ceiling
  table stays a backend constant.
- `canInvoke` answers the ADR-124 Am. 1 § 8 rule ("a page hides a write action whose route is unmarked
  for a bound user") **once**, instead of per page. It needs to know which operations are
  facility-accessible. **Target addition (P36-08):** the backend publishes its reviewed
  `FACILITY_ACCESSIBLE_ROUTES` list in the OpenAPI document as an operation extension
  (`x-facility-accessible: true`), generated from the same constant the route gate reads, so the list
  reaches both clients through `@callibrator/api-client`'s generated types and cannot drift. Until
  P36-08 lands, the web keeps its per-page bound tests (P18-03 G-P8) and the app hides every write
  that is not one of the capture operations for bound users.
- Offline, the effective permission is the one cached at the last sync; a change takes effect at the
  next sync (the scope fingerprint, `06` § 8, purges the working set when the scope changed).

## 6. The State → Tone Registry (ADR-122 § 6)

The as-built `STATUS_REGISTRY` (`statusTone.ts`, 54 domains counted 2026-10-08) is split three ways (`02` § 5):

- **here** — `STATE_TONES: Record<Domain, Record<State, StatusTone>>` and `toneOf(domain, state)`;
- `@callibrator/tokens` — what each tone looks like;
- `@callibrator/i18n` — `status.<domain>.<state>` label keys (the as-built English words become the
  `en` values verbatim).

New domains from the upstream adoption join it here: IPM session states (draft, submitted, voided,
superseded — ADR-126), recommendations (`fit_for_use → current`, `needs_calibration → attention`,
`needs_repair → attention`, `not_fit_for_use → alarm`), device condition (`good → current`,
`not_good → attention`, `broken → alarm` — ADR-132 § 3), client-facility status, and the sync states
of a capture (`06` § 7). Each addition is a design decision that maps onto the five tones; a sixth
tone is an ADR-122 amendment, not an entry here.

## 7. Smaller Rules Moved From the Web

| Function | From (as built) | Rule |
|---|---|---|
| `actorLabel(row)` | `frontend/src/lib/actorLabel.ts` (Q-51, ADR-100 Am. 2) | a row names a user **or** the API key that wrote it; never "-" |
| `menuHasAnyPath`, `SEARCHABLE_MENU_PATHS` | `frontend/src/lib/menuAccess.ts` (F-10) | answered from the server-resolved menu tree, never a client permission list — the paths are web routes, so the app uses the slug form of the same rule |
| `performerLabel(snapshot)` | target (ADR-133 § 3, ADR-124 Am. 2 § 7) | prints the snapshot when present, the redacting projection otherwise; a bound reader sees another facility's author redacted |

## 7a. Report Layout Models — Data, Not PDF (ADR-126 § 8, Am. 2)

The IPM report and the certificate are **rendered by the client** from the API's data document
(ADR-095, ADR-126 § 8); nothing is stored as a file. The web renders PDFs with jsPDF primitives
(`frontend/src/lib/certificatePdf.ts`; ADR-126 Am. 2 moves them to `lib/pdf/`). Whether jsPDF can
render under **Hermes** (no DOM canvas; fonts, images and the QR drawn without browser APIs) is an
**open feasibility item** (P37-01, beside the Zod and `Intl` proofs): if it can, the app can share the
issued certificate and facility-staff documents as the same PDF the web produces; if it cannot, the app
renders from the layout model below through the OS print pipeline. Either way the shared part is the
**layout model**, not the PDF:

| Function | Returns | Used by |
|---|---|---|
| `buildIpmReportPreview(capture, catalogueVersion, device)` | the draft's sections, rows, outcomes and the watermark flag "DRAFT — NOT A RECORD" as plain data | the PWA's and the app's offline draft preview (P19-08 § 12; `../MOBILE/04` § 9) |
| `buildIpmReportLayout(dataDocument)` | the issued report's ordered blocks (header, issuer snapshot, device, checklist by section, signatures, verification QR payload, integrity line) as plain data, labelled by i18n keys | the web's jsPDF renderer and the app's renderer |

Each platform renders the model its own way — the web through `lib/pdf/`, the app through native
screen components and, for a printable/shareable PDF, the OS print pipeline (`expo-print`, HTML built
from the model). The two PDFs will not be pixel-identical; what binds them is the **data**: the hash
of ADR-126 Am. 2 is computed by contracts' `canonicalIpmReportPayload` over the document, not over a
layout, and both renderers print the same fields in the same order because they read one model.
Whether the app produces PDFs at all in its first release is `../MOBILE/04` § 9's decision.

## 8. Tests

At the package's **100 %** gate. Every rule above has fail-before cases taken from its spec
(P19-03 § 4.2's examples `"42" → "TST000042"`, the ADR-133 due table, the scan shapes of § 3 including
a foreign-host URL and a verification URL with no token). Rules that compose contracts are tested
**through** contracts (no mock of `normaliseQrCode`): a mock would prove the composition, not the
answer.

## 9. Bad Implications

- Two packages hold "domain" knowledge (`contracts` for server-enforced rules, `domain` for
  client-side ones); a contributor must know the boundary of § 1. The guard test catches only exact
  name collisions, not a re-implementation under another name — review must.
- `canInvoke` depends on a backend addition (P36-08); until then the app is deliberately more
  restrictive than the web for bound users.
- An offline "estimated" due state can show `overdue` for a device whose certificate was renewed while
  the phone was offline. The label says "estimated"; the next sync corrects it.
