# Research 02 — Standards, Guidelines and Benchmarks

**Date:** 2026-09-29 · **Type:** desk research (secondary sources). No users were studied. · **Status:** input to the enterprise-dense redesign. It is not a decision; the decisions it implies go through an ADR.

**Owner direction this research serves:** an enterprise-dense product (SAP/ServiceNow-like) with a collapsible sidebar grouped by domain, comfortable density with a compact toggle, a home page per role, a neutral palette plus one accent (the tenant brand) in light and dark, the existing design system (Tailwind 4 and the current components) kept and tidied, desktop first with tablets usable, WCAG 2.1 AA, and Indonesian plus English.

**Read with:** [`../00-DESIGN-DIRECTION.md`](../00-DESIGN-DIRECTION.md), [`../02-INFORMATION-ARCHITECTURE.md`](../02-INFORMATION-ARCHITECTURE.md), [`../10-COMPONENT-SPECIFICATION.md`](../10-COMPONENT-SPECIFICATION.md), [`../17-ACCESSIBILITY.md`](../17-ACCESSIBILITY.md), and ADR-090 in [`../../../MEMORY/DECISIONS.md`](../../../MEMORY/DECISIONS.md) (the contrast-token policy).

---

## 0. Method, and How Far to Trust Each Claim

| Source class | How it was read | Confidence |
|---|---|---|
| W3C (WCAG 2.1/2.2 Understanding docs, ARIA APG), 21 CFR Part 11 (Cornell LII), GDPR (gdpr-info.eu), NN/g, Carbon (source `.mdx` on GitHub), Atlassian | page fetched and read | **high**: quoted from the source |
| SAP Fiori, ServiceNow Horizon | **both sites refused automated fetch (HTTP 403)**. Content comes from search-engine extracts of the official pages, versioned Fiori pages, and SAP Help | **medium**: consistent across several extracts, but not read in full. Check before quoting a number |
| Salesforce (SLDS, Help) | search extracts of official help and developer pages | medium |
| ISO/IEC 17025:2017 | the standard is paywalled. Clause content comes from accreditation-body and training material (EA FAQ, PJLA slides) | medium: **buy or borrow the standard before a certificate layout is signed off** |
| Vendor benchmarks (GAGEtrak, eMaint, Nuvolo, Accruent, Blue Mountain, Calibration Control, Ideagen) | vendor feature pages, user guides and review sites. **No product was used hands-on** | **low to medium**: this is what vendors claim to ship, not observed UX quality |
| Locale formats | printed from `Intl` on Node 26.10 (CLDR data), shown in §5 | high |

**What this research cannot tell you:** whether Callibrator's users (the personas in [`../03-PERSONAS.md`](../03-PERSONAS.md)) actually struggle where these systems say users struggle. Every recommendation in §6 is a hypothesis to confirm with task-based usability testing. §7 proposes the smallest study that would do that.

---

## 1. Enterprise Design Systems: Applicable Patterns

### 1.1 SAP Fiori: floorplans and content density

Fiori is the most useful single reference for this redesign, because it names **page types** rather than components. It is the vocabulary the owner's "SAP-like" direction implies.

| Pattern | What it is | When to use | Callibrator mapping |
|---|---|---|---|
| **List report** | Dynamic page header, a **filter bar** with **variant management** (saved views), then a table with its own toolbar. "Find and act on relevant items within a large set of items by searching, filtering, sorting, and grouping." | The user has to *find* records in a large set | Device register (`/devices`), calibration records, certificates, stock, users, audit trail, suppliers, SOP register, risk register |
| **Worklist** | "A simplified list report without a filter bar". The focus "lies on processing the items". Usually split by tabs by status, and each item ends up completed or delegated | The user must *process* most or all items in the list | Calibration scheduler ("due / overdue / this week"), **pending e-signatures**, my maintenance work orders, ticket response queue, CAPA assigned to me, stock opname lines awaiting count |
| **Object page** | A header with the title, key facts and KPIs; **anchor-bar or tab** navigation over sections; **no header toolbar**. Actions sit in a **footer toolbar** in edit mode (Save, Post) and for display-mode finalising actions (Approve, Reject) | Viewing and editing one business object with many facets | Device detail (identity, calibration history, maintenance, attachments, audit), certificate, work order, CAPA/NC, SOP version, tenant |
| **Overview page** | A role-based page of **cards** (lists, KPIs, charts) with a global filter. Each card links to the list or object behind it | A role needs an at-a-glance picture across several objects | **The home page for each role** (see §4.7 for the cards each role gets) |
| **Variant management** | Named, saved view settings (filters, columns, sort). A system "Standard" view, a per-user default, and an asterisk when the current view differs from the saved one (`Standard*`) | Any list report that users come back to with the same question | "Overdue, high-risk, my department" on devices; "Out of tolerance this quarter" on calibration records |
| **Message popover / handling** | Field-level errors are marked on the field, and a **message button with a counter** in the footer opens a popover listing all messages. Each message jumps to its field | Long forms and object pages where an error can be scrolled out of view | Calibration entry (many measurement points), the device form, the CAPA form |
| **Draft handling** | The object stays a draft until the final Save/Create. Validation runs either on focus-out (few fields) or on demand for the whole form (many fields) | Long entries done across interruptions | Calibration entry. It already has a `draft` state for certificates, and a technician is interrupted mid-procedure |

**Content density (cozy/compact).** Fiori sizes in rem (1 rem = 16 px). **Cozy** keeps a 2.75 rem (44 px) touch target. Rows and controls are 3 rem in cozy and 2 rem (32 px) in compact. The guidance is **cozy for touch devices and compact for mouse-and-keyboard devices, set for the whole app**, not mixed within a screen.
Callibrator mapping: the owner wants comfortable density as the default with a compact toggle. That matches Fiori's rule better than its defaults do. **Default to comfortable, offer compact as a user preference on pointer devices, and force comfortable on touch** (`(pointer: coarse)`), because the tablet is a stated target.

Sources: [When to use which floorplan](https://www.sap.com/design-system/fiori-design-web/v1-108/page-types/floorplans/when-to-use-which-floorplan) · [List report](https://www.sap.com/design-system/fiori-design-web/v1-108/page-types/floorplans/list-report-floorplan-sap-fiori-element) · [Worklist](https://www.sap.com/design-system/fiori-design-web/v1-96/discover/frameworks/sap-fiori-elements/list-report/worklist-sap-fiori-elements) · [Object page usage](https://www.sap.com/design-system/fiori-design-web/v1-136/page-types/floorplans/object-page/usage) · [Object page header](https://www.sap.com/design-system/fiori-design-web/v1-96/discover/frameworks/sap-fiori-elements/object-page/object-page-header-sap-fiori-elements) · [Content density](https://www.sap.com/design-system/fiori-design-web/v1-108/foundations/visual/cozy-compact) · [SAPUI5 content densities](https://sapui5.hana.ondemand.com/sdk/docs/topics/e54f729da8e3405fae5e4fe8ae7784c1.html) · [Variant management](https://www.sap.com/design-system/fiori-design-web/v1-84/ui-elements/variant-management/usage?external) · [Managing variants (SAP Help)](https://help.sap.com/docs/ABAP_PLATFORM_NEW/468a97775123488ab3345a0c48cadd8f/8ce658e05498466d9a74823b94e840ac.html) · [Message popover](https://www.sap.com/design-system/fiori-design-web/v1-120/ui-elements/message-popover/usage) · [Form field validation](https://www.sap.com/design-system/fiori-design-web/v1-136/ui-elements/form-field-validation/usage)

### 1.2 ServiceNow Next Experience / Horizon: workspaces, lists, forms, record pages

| Pattern | What it is | When to use | Callibrator mapping |
|---|---|---|---|
| **Workspace landing page** | The first page an agent sees: "preconfigured reports and widgets specific to the agent's work responsibilities" | A role that works a queue all day | The role homes for the Technician (Budi) and the Calibration Provider Admin (Dewi) are *workspaces* (queue-first), not *overviews* (chart-first) |
| **Record list** | A header with the title and actions (which overflow into a menu when narrow), columns the user can add, remove and reorder, a footer with pagination or "view all", and a list menu for switching between lists | Every list | The existing `DataTable`. Add column chooser and an overflow for the header actions |
| **Related list** | A list of child records inside a record page. The guideline: "use only 1 or 2 highlighted columns" | Children of an object | Calibration history on a device; spare parts on a work order; CAPA actions on an NC |
| **Record page** | The "full-featured form experience": all fields, related lists, attachments and an **activity stream**, optimised for keyboard and screen reader | The detail view of a record | Same as the Fiori object page. Take the activity stream from here |
| **Contextual side panel** | A right-hand panel of tabs next to the record (for example knowledge, similar records, the agent assist) | Supporting information the user reads while editing | The device's last certificate and tolerance limits shown *beside* the calibration entry form, so no one has to remember them (Nielsen #6) |
| **Activity stream** | A timeline of comments, work notes, system updates and emails on a record | Any record with a history | Work orders, CAPA, tickets. **Keep this distinct from the audit trail**, which is a compliance view (see §3.3) |

Sources: [Horizon: Structure](https://horizon.servicenow.com/workspace/basics/structure) · [Record List](https://horizon.servicenow.com/workspace/components/record-list) · [List – Related](https://horizon.servicenow.com/workspace/components/now-record-list-connected-related) · [Record page (vertical)](https://horizon.servicenow.com/workspace/page-templates/record-page-vertical) · [Form patterns](https://horizon.servicenow.com/workspace/patterns/forms/form-patterns) · [Navigation pattern](https://horizon.servicenow.com/workspace/patterns/navigation/navigation-pattern) · [Workspace for a custom app (ServiceNow Community)](https://www.servicenow.com/community/next-experience-blog/workspace-for-a-custom-app-where-to-start/ba-p/2599404) · [Agent Workspace landing page](https://servicenowwithrunjay.com/agent-workspace/)

### 1.3 IBM Carbon: data table, density, the 2x grid, notifications, status, filtering, empty states

Carbon is the most **numerically specific** of the five, and the closest in spirit to a Tailwind token system.

**Data table** (read from Carbon's source):

| Size | Row height | Use |
|---|---|---|
| xs | 24 px | Avoid in Callibrator: its controls cannot meet a 24 px target with spacing |
| sm | 32 px | **Compact mode** |
| md | 40 px | **Comfortable mode (default)** |
| lg | 48 px | The default on touch |
| xl | 64 px | Only when a row really holds two lines |

- The header row matches the body row size. A **small toolbar (32 px)** pairs with sm/xs rows and a **large toolbar (48 px)** with lg/xl.
- **Up to five actions** in the table toolbar; the rest go into an overflow menu.
- **Batch action bar:** once any row is selected, a bar replaces the toolbar at the top of the table. It shows the selection count and the applicable actions, and exits by Cancel or by deselecting everything. **While it is active, the per-row actions are disabled**, so a user cannot mix a batch action with a single-row one.
- Selection is multi-select (checkboxes, with a tri-state header checkbox) or single-select (radios).
- **Sort:** only the sorted column shows its icon; the others show it on hover. **Pagination sits at the bottom, always.** Zebra striping is optional.
- Column titles are one or two words; wrap to two lines, then truncate with a tooltip.
- Row overflow menus persist by default. Show-on-hover is an option, and on devices without hover they persist anyway.
- **Not a spreadsheet replacement.** Tables are for finding and acting, not for heavy in-cell editing.

**2x grid:** an 8 px mini unit; breakpoints at 320/672/1056/1312/1584 px with 4/8/16/16/16 columns; 16 px padding and a 32 px gutter. The mini unit gives finer alignment inside dense regions. This matches Tailwind's 4 px scale when only even steps are used (`2, 4, 6, 8` = 8/16/24/32 px).

**Notifications:** seven kinds, each with its own job:

| Kind | Use | Persistence |
|---|---|---|
| Inline | Feedback tied to one part of the page, such as a form result | Until dismissed or resolved |
| Toast | A short, system-generated message not tied to one place; top right, newest on top, three lines at most | Auto-dismisses **only if it has no action** |
| Actionable | A toast or inline notification with **one** action of at most two words | Until dismissed. It takes focus, so it is disruptive: use rarely |
| Callout | Contextual information in the page, informational or warning only | Always visible |
| Banner | A system-level message under the header, **one at a time**, and it scrolls with the page | Until dismissed |
| Notification panel | High-volume, chronological, grouped; with user preferences | User opens it |
| Modal | Critical; one at a time | Blocks work |

Carbon also states: **no timer on a critical message** (WCAG 2.2.4 is AAA, but the reasoning applies) and **let users control non-critical notifications**.

**Status indicators:** use **at least two of colour, shape and symbol**. Shape indicators suit dense tables; icon indicators suit dashboards. High attention is red; medium is orange or yellow; low is green or blue; grey means draft. Keep icon plus text **left-aligned** in table cells.

**Filtering:** **instant** filtering for a single category; **batch** filtering (an "Apply" button) when there are several categories or the data is slow to return. When filters are in a drawer, show a count of active filters. Applied filters must be clearable without reopening the drawer, one at a time and all at once.

**Empty states:** three kinds. **No data** (first use: what will appear here and how to add it). **User action** (no search results, or a finished task). **Error** (data exists but cannot be shown, because of a permission, a system fault or configuration). One primary action; affirmative wording.

Sources: [Data table usage (.mdx)](https://github.com/carbon-design-system/carbon-website/blob/main/src/pages/components/data-table/usage.mdx) · [Data table style (.mdx)](https://github.com/carbon-design-system/carbon-website/blob/main/src/pages/components/data-table/style.mdx) · [Data table](https://carbondesignsystem.com/components/data-table/usage/) · [2x Grid](https://carbondesignsystem.com/elements/2x-grid/overview/) · [Notification pattern](https://carbondesignsystem.com/patterns/notification-pattern/) · [Status indicator pattern](https://carbondesignsystem.com/patterns/status-indicator-pattern/) · [Filtering](https://carbondesignsystem.com/patterns/filtering/) · [Empty states](https://carbondesignsystem.com/patterns/empty-states-pattern/)

### 1.4 Atlassian: navigation, breadcrumbs, empty states

| Pattern | What it is | Callibrator mapping |
|---|---|---|
| **Navigation system layout** | Five regions: an optional banner, the top nav (start/middle/end), a **side nav that is resizable and collapsible** with its own header and footer, the main area, and an optional **resizable side panel** that becomes an overlay at ≤ 1024 px. The grid applies to the main area only. Landmarks are labelled uniquely | The shell: `Sidebar.tsx` plus `TopBar.tsx`. The side panel becomes the record preview or contextual panel (§1.2). At tablet width it overlays rather than squeezes the table |
| **Panel vs modal** | A panel sits beside the main content and allows multitasking; a modal demands completion first | Row preview and quick edit belong in a **panel**, not a modal. That agrees with NN/g (§2.3) |
| **Breadcrumbs** | Secondary navigation showing position in a hierarchy. **Never replaces the main navigation. Never wraps.** Collapses to first … last when too long (auto-collapses past eight items) | Object pages and nested routes: `Equipment › Devices › INF-00231`, `Quality › CAPA › CAPA-2026-014`. The IA already caps menus at two levels, so breadcrumbs stay short |
| **Empty state** | Optional illustration, a header, an optional description, and at most one primary button. Sentence case, imperative verbs, tone matched to context (inspiring on first use, celebratory when a queue is cleared, neutral for no search results) | `EmptyState` already exists; add the three variants from Carbon and the tone rule |

Sources: [Navigation system layout](https://atlassian.design/components/navigation-system/layout/usage) · [Breadcrumbs usage](https://atlassian.design/components/breadcrumbs/breadcrumbs/usage) · [Empty state usage](https://atlassian.design/components/empty-state/usage)

### 1.5 Salesforce Lightning: record pages, list views, Path, display density

| Pattern | What it is | Callibrator mapping |
|---|---|---|
| **Highlights panel** | The top of a record page: a *compact layout* of a few key fields plus the primary actions | Object page header. For a device: asset tag, serial, model, location, **calibration status and due date**, risk class |
| **Related list cards** | Up to six records in a wide region and three in a narrow one, **up to four fields each**, plus "View all" | Device → calibration history (last six), open work orders, attachments |
| **List view inline edit** | Click a pencil-marked cell, type, press Return. Only some fields support it | Use sparingly. **Never on compliance data** (measurements, certificate fields, signed records). Acceptable on stock quantities in opname or on assignee |
| **Path** | A horizontal bar of chevrons, one per stage, with **key fields and "guidance for success" under the current stage**. With coaching content it behaves as tabs; without it, as a listbox | The calibration lifecycle `draft → submitted → reviewed → approved/signed → issued`, and CAPA and work-order states. The guidance text is where a 409 turns into the state explanation CLAUDE.md requires ("this certificate is in draft and must be submitted first") |
| **Display density (Comfy/Compact)** | Comfy puts labels above fields with more space; **Compact puts labels to the left of fields** with less space and claims up to 40% more data per page. A per-user setting in the profile menu, with an org-wide default set by the admin | The owner's comfortable/compact toggle. **Copy the model: a per-user preference in the user menu plus a tenant default.** Consider compact meaning "labels beside fields" on detail views (read mode) and **never** on data-entry forms |

Sources: [Highlights panel and record page layouts (Trailhead)](https://trailhead.salesforce.com/content/learn/modules/lex_customization/lex_customization_page_layouts) · [Related lists in Lightning](https://help.salesforce.com/s/articleView?id=xcloud.basics_understanding_related_lists_lex.htm&language=en_US&type=5) · [Inline editing in list views](https://help.salesforce.com/s/articleView?language=en_US&id=xcloud.basics_customviews_lv_lex_considerations.htm&type=5) · [lightning:path](https://developer.salesforce.com/docs/component-library/bundle/lightning:path) · [SLDS Path (archive)](https://archive-2_5_2.lightningdesignsystem.com/components/path/) · [Density settings (Winter '19)](https://developer.salesforce.com/blogs/2018/08/new-density-settings-for-the-lightning-experience-ui-in-winter-19) · [Form display density (LWC)](https://developer.salesforce.com/docs/platform/lwc/guide/data-display-density.html) · [SLDS Display Density](https://www.lightningdesignsystem.com/2e1ef8501/p/805bbe)

### 1.6 Where the five agree, and where Callibrator must choose

**They agree on:**
1. A small set of page types (list → object, worklist, overview), not a bespoke layout per screen.
2. Saved views over the filter state.
3. A batch bar that appears on selection.
4. The detail view keeps the list's context (panel or object page), not a modal.
5. Density is a whole-app setting, chosen per device or per user, never mixed on one screen.
6. Status is never colour alone.

**Callibrator has to choose:**

| Choice | Options | Recommendation |
|---|---|---|
| Object-page actions | Fiori footer toolbar vs Salesforce header actions | **Header actions for display mode, sticky footer for edit mode.** In edit mode the Save button stays in view on a long calibration form; in display mode the transitions (Submit, Approve, Sign) sit next to the status they change |
| Home page | Overview (cards and KPIs) vs workspace (queue first) | **By role.** A queue for Technician, Warehouse Staff and Calibration Admin; an overview for Engineering Manager, Healthcare Admin and Platform Operator |
| Compact mode | Row height only (Carbon) vs labels-beside-fields too (Salesforce) | Row height and spacing everywhere; labels beside fields **only on read-only detail views** |

---

## 2. Heuristics and Accessibility

### 2.1 Nielsen's ten heuristics, as they apply to Callibrator

| # | Heuristic | What it means here |
|---|---|---|
| 1 | Visibility of system status | Due and overdue counts on the role home; `BatchJobProgress`; the Socket.IO bell; **the current density, tenant and language visible in the chrome** |
| 2 | Match with the real world | Domain vocabulary (**opname**, as-found/as-left, *Teknisi*, *IPSRS*); Indonesian date and decimal conventions (§5) |
| 3 | User control and freedom | Cancel on every batch bar and draft; undo for reversible actions. **Signed records are the stated exception**: explain the amendment route instead (§3.4) |
| 4 | Consistency and standards | Four page types (§6), one `DataTable`, one `StatusBadge` vocabulary |
| 5 | Error prevention | Tolerance limits beside the measurement input; a confirm step before signing; the permitted next states only (Part 11 §11.10(f), §3) |
| 6 | Recognition rather than recall | Contextual side panel with the previous result; saved views; recent items in the command palette |
| 7 | Flexibility and efficiency | Compact density, keyboard shortcuts, the command palette, batch actions — **hidden from novices, never required** |
| 8 | Aesthetic and minimalist design | "State before decoration" (`00-DESIGN-DIRECTION.md` P1): the status and the due date first, then everything else |
| 9 | Recognise, diagnose and recover from errors | A 409 shown as a state explanation, never a stack trace; the message popover with a jump to each field |
| 10 | Help and documentation | Path "guidance for success" per stage; field hints for the measurement units |

Source: [NN/g, 10 Usability Heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/)

### 2.2 WCAG 2.1 AA requirements that bite in dense tables and forms

| SC | Level | Requirement | Dense-UI consequence |
|---|---|---|---|
| **1.3.1** Info and Relationships | A | Structure is programmatic | Real `<table>`/`<th scope>` or a correct `role=grid`; field labels tied with `for`/`id` (ADR-090 already requires this) |
| **1.4.3** Contrast (minimum) | AA | 4.5:1 for text | ADR-090's tokens already pass on `/10` tints. **Compact mode must not drop the text size below the size the tokens were checked at**, and zebra stripes and the selected-row fill count as backgrounds, so they must be checked |
| **1.4.10** Reflow | AA | No 2-D scrolling at 320 CSS px, *except* "data tables (not individual cells)" | The table may scroll horizontally; **the page heading, search, filters and pagination around it must still reflow** |
| **1.4.11** Non-text contrast | AA | 3:1 for component boundaries, focus indicators, and status icons without text | Input borders, checkbox outlines, the focus ring on a selected row, and **the shape indicators in compact rows** |
| **1.4.13** Content on hover or focus | AA | Dismissible, hoverable, persistent | The tooltip on a truncated column header or cell |
| **2.1.1** Keyboard | A | Everything works from the keyboard | Row selection, the batch bar, sort, column chooser, the side panel, the density toggle |
| **2.2.1** Timing adjustable | A | Warn before a time limit and allow extension with a simple action (≥ 20 s) | **Session timeout.** Part 11 pushes for short sessions; WCAG requires a warning with an "extend" option. A technician who is logged out mid-entry must not lose the draft |
| **2.4.3** Focus order | A | Order preserves meaning | Batch bar → table → pagination. After closing the side panel, focus returns to the row that opened it |
| **2.4.7** Focus visible | AA | Visible focus | A ring that survives the selected-row fill and zebra striping in both themes |
| **3.1.2** Language of parts | AA | Mixed-language text is marked | Indonesian terms inside English text get `lang="id"`, and English inside Indonesian gets `lang="en"`. Already stated in `17-ACCESSIBILITY.md` |
| **3.3.1** Error identification | A | The error is identified in text | Per field, plus the message popover summary |
| **3.3.2** Labels or instructions | A | Labels, and units | The unit and the tolerance next to every measurement input |
| **3.3.3** Error suggestion | AA | Suggest a fix | "Expected 0,0–10,0 mA; you entered 100" (the decimal-marker problem, §5.3) |
| **3.3.4** Error prevention (legal, financial, data) | AA | Submissions that create **legal commitments** or change user data are reversible, checked, or confirmed | **Applies directly to e-signature**: a review screen that shows exactly what is being signed, and a confirm step. Also to GDPR erasure and bulk delete |
| **4.1.3** Status messages | AA | Announced without focus | "24 results", "Saved", "3 devices moved": use `role="status"`; errors use `role="alert"` |

**Target size.** WCAG **2.1** AA has **no** target-size criterion: SC 2.5.5 (44×44 px) is **AAA**. WCAG **2.2** added SC **2.5.8 at AA: 24×24 CSS px**, or smaller targets whose 24 px circles do not overlap. **Recommendation: adopt 2.5.8 as the floor anyway.** It is the criterion that makes compact mode honest, and the next audit will be against 2.2. Consequence: **a compact row is 32 px, not 24 px** (Carbon's sm, not xs), and icon buttons within it keep a 24 px hit area.

Sources: [Reflow](https://www.w3.org/WAI/WCAG21/Understanding/reflow.html) · [Non-text contrast](https://www.w3.org/WAI/WCAG21/Understanding/non-text-contrast.html) · [Status messages](https://www.w3.org/WAI/WCAG21/Understanding/status-messages.html) · [Timing adjustable](https://www.w3.org/WAI/WCAG21/Understanding/timing-adjustable.html) · [Target size 2.5.5 (AAA)](https://www.w3.org/WAI/WCAG21/Understanding/target-size.html) · [Target size minimum 2.5.8 (WCAG 2.2 AA)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) · [Error prevention 3.3.4](https://www.w3.org/WAI/WCAG21/Understanding/error-prevention-legal-financial-data.html) · [Language of parts 3.1.2](https://www.w3.org/WAI/WCAG21/Understanding/language-of-parts.html)

### 2.3 Data tables: the ARIA grid vs the table pattern

| | Table (`<table>`) | Grid (`role="grid"`) |
|---|---|---|
| Tab stops | **Every** focusable element in the table is a tab stop | The grid is **one** tab stop; arrow keys move between cells (roving `tabindex`) |
| Keys | Tab / Shift+Tab | Arrows; Home/End (row); Ctrl+Home/End (grid); PageUp/Down; Shift+Space selects a row; Shift+arrow extends |
| Use for | Mostly static data with a few links per row | A composite widget where cells hold several controls, or where there are many rows of actions |
| APG's advice | "Authors are strongly encouraged to use a native HTML `table` element whenever possible" | Needs careful testing across browsers and screen readers |

**Recommendation for Callibrator:**
- **Default to the native `<table>`** with `aria-sort` on sortable `<th>` elements.
- **Keep row interactivity to a small, fixed set per row:** a checkbox, the row link on the identifier (the NN/g "human-readable identifier in the first column"), and one overflow menu.
- That keeps Tab costs bounded (3 stops × rows on a page) without taking on grid semantics. With 50 rows that is 150 tab stops. Provide a **"Skip to pagination"** link and put the batch bar *before* the table.
- **Reserve `role="grid"` for the few true editing surfaces:** the stock opname count sheet, and a measurement-point table in calibration entry if it becomes spreadsheet-like. Test those with NVDA before shipping.

NN/g's enterprise-table guidance agrees with the other systems:
- Four tasks: **find records, compare, view or edit one record, take action.**
- A human-readable identifier comes first.
- Frozen header and first column.
- Zebra striping, borders or hover highlight.
- Column hide and reorder with a visible state.
- **Non-modal side panels for viewing and editing one row**, so neighbouring rows stay visible.
- Batch selection instead of cramming actions into every row.

Sources: [APG Grid pattern](https://www.w3.org/WAI/ARIA/apg/patterns/grid/) · [APG Table pattern](https://www.w3.org/WAI/ARIA/apg/patterns/table/) · [NN/g, Data Tables: Four Major User Tasks](https://www.nngroup.com/articles/data-tables/)

---

## 3. What the Regulated Standards Require of the UI

### 3.1 21 CFR Part 11: the clauses that become UI

| Clause | Text (quoted) | UI requirement |
|---|---|---|
| **§11.50(a)** Signature manifestations | Signed records "shall contain information associated with the signing that clearly indicates all of the following: (1) The printed name of the signer; (2) The date and time when the signature was executed; and (3) The meaning (such as review, approval, responsibility, or authorship) associated with the signature." | **A signature block component:** full printed name (not a username or initials), the date **and** time **with the timezone**, and the meaning as a word ("Reviewed by", "Approved by", "Performed by"). Show it wherever the record is shown |
| **§11.50(b)** | These items "shall be subject to the same controls as for electronic records and shall be included as part of any human readable form of the electronic record (such as electronic display or printout)." | **The block appears on screen AND on the PDF and printout**, identically. A certificate PDF without the meaning word fails |
| **§11.70** Linking | Signatures "shall be linked to their respective electronic records to ensure that the signatures cannot be excised, copied, or otherwise transferred to falsify an electronic record by ordinary means." | Show **what** was signed: a record version or hash reference in the signature block, and the public `/verify` page confirms the link |
| **§11.200(a)(1)(i)** | In "a single, continuous period of controlled system access, the first signing shall be executed using all electronic signature components; subsequent signings … using at least one" component | **A re-authentication dialog at signing time.** The first signature in a session asks for identifier and password (or passkey); later signatures in the same session ask for at least the password. Never "click to sign" |
| **§11.200(a)(1)(ii)** | Signings not in a continuous session: "each signing shall be executed using all of the electronic signature components" | After a timeout or re-login, the dialog asks for **both** components again. The UI has to know whether the session was continuous |
| **§11.10(e)** Audit trail | "secure, computer-generated, time-stamped audit trails to independently record the date and time of operator entries and actions that create, modify, or delete electronic records. Record changes shall not obscure previously recorded information." | **An audit-trail view per record** (who, what, when, old value → new value, and the reason) that is read-only, plus a global audit trail. **An edit never overwrites the previous value on screen**; show "was X, now Y" |
| **§11.10(b)** | "accurate and complete copies of records in both human readable and electronic form" | Export per record: a PDF (human-readable) plus JSON or CSV (electronic), including the audit trail and the signatures |
| **§11.10(f)** Operational checks | "enforce permitted sequencing of steps and events" | Show only the permitted next transitions (Path, §1.5). A blocked step explains which step must come first (the 409 contract) |
| **§11.10(g)** Authority checks | Only authorised individuals can "electronically sign a record … alter a record" | "Absent, not disabled" (`00-DESIGN-DIRECTION.md`) for navigation. **On a record, though, show *why* a Sign button is absent** when the user expects it ("Only a Penyelia can approve") — a silent absence at signing time reads as a bug |

The FDA's 2003 "Scope and Application" guidance applies **enforcement discretion** to validation, audit trail, retention and copying. It does **not** relax §11.50, §11.70 or §11.200. So the signature UI is the non-negotiable part.

Sources: [21 CFR 11.10](https://www.law.cornell.edu/cfr/text/21/11.10) · [11.50](https://www.law.cornell.edu/cfr/text/21/11.50) · [11.70](https://www.law.cornell.edu/cfr/text/21/11.70) · [11.200](https://www.law.cornell.edu/cfr/text/21/11.200) · [eCFR Part 11](https://www.ecfr.gov/current/title-21/chapter-I/subchapter-A/part-11) · [FDA guidance, Scope and Application (Federal Register)](https://www.federalregister.gov/documents/2003/09/05/03-22574/guidance-for-industry-on-part-11-electronic-records-electronic-signatures-scope-and-application)

### 3.2 E-signature: the interaction pattern

A synthesis of §11.50, §11.200, WCAG 3.3.4, and GAGEtrak's "multi-level, pre-definable calibration signature options" and Blue Mountain's routed review and closure:

1. **Review:** show the record exactly as it will be signed (read-only), with the **meaning** pre-selected by the workflow step. The user should not have to choose "approve" from a free list.
2. **Confirm (WCAG 3.3.4):** a dialog that restates *what* is being signed ("Certificate CAL-2026-00412, revision 2") and the *meaning*, with the signature statement in the user's language (§5).
3. **Re-authenticate (§11.200):** all components if this is the first signing of the session or the session was interrupted; otherwise at least the secret. The dialog says which one applies.
4. **Result:** the **signature block** (name · date-time with timezone · meaning) appears on the record, and the record's status changes visibly (Path advances). Announce it through `role="status"`.
5. **Failure:** a wrong password is a field error. It does not close the dialog, does not reveal whether the account exists, and counts toward lockout. Say so in text.

Multi-signature records (performed by → reviewed by → approved by) show **one block per signature in order, including the pending ones** ("Awaiting: Approved by — Penyelia").

### 3.3 Audit trail visibility

- **Per record:** a "History" or "Audit" tab on every object page. Columns: timestamp (with timezone), actor (printed name and role), action, field, **old value → new value**, reason. Read-only, filterable, exportable.
- **Global:** the `security` → `/dashboard/audit` list report. The filters an auditor needs: date range, actor, record type, record id, action.
- **Keep the activity stream (collaboration: comments, notes) separate** from the audit trail (compliance). Mixing them teaches users that the audit trail is chatter. ServiceNow's activity stream mixes comments with system updates. The GxP vendors (Blue Mountain, GAGEtrak) market the audit trail as a distinct compliance feature, but **whether their UIs keep it apart was not observed**.
- **The seventh reader, the auditor** (`03-PERSONAS.md`), should be able to answer "who changed this and why" **from the record itself**, without an admin.

### 3.4 Record immutability, shown to the user

- **A locked indicator on signed or issued records**: a lock icon plus the text "Signed — read-only", in the object page header next to the status badge. The edit actions are *absent*, and the header says why.
- **The amendment route instead of edit.** ISO/IEC 17025 7.8.8 requires that changes to an issued report be "clearly identified" with the reason. An amended report is a *further document* identified as an amendment to the original, or a complete new report that references the one it replaces. Technical records (7.5.2) keep the original with the date, the altered aspects and the person responsible. UI: **"Amend certificate" creates a new revision**; the old revision stays viewable and is marked "Superseded by rev. 3", and the new one shows "Amends rev. 2 — reason: …".
- **A revision switcher** on the object page (rev. 1, 2, 3) with a diff view, which is the visible form of §11.10(e) "shall not obscure previously recorded information".
- **A 409 message for an attempted edit**: "This certificate was issued on 12 Sep 2026 and cannot be edited. To correct it, create an amendment." — never a disabled form with no explanation.

### 3.5 ISO/IEC 17025: the certificate and its traceability display

What a calibration certificate carries (clauses 7.8.2 and 7.8.4, from accreditation-body material):
- The title, the laboratory's name and address, a **unique certificate number on every page with "page x of y"**, the customer, and the method.
- The identification and condition of the item, the date(s) of calibration, **the results with units**, **the measurement uncertainty for each result** (stated with its coverage factor, typically k = 2).
- **A statement of metrological traceability**, the environmental conditions where relevant, **as-found and as-left results** where there was an adjustment, the conformity statement and its decision rule where relevant, and the authorised signatory.

**UI patterns:**

| Pattern | Detail |
|---|---|
| Certificate object page | The header carries the number, status, device, date of issue and **validity or next due date**. Sections follow the certificate's own order, so an auditor can compare the screen with the PDF |
| **Results table** | Per test point: nominal, as-found, as-left, tolerance, **uncertainty (k = 2)**, and a pass or fail badge (text plus shape). Numbers right-aligned in tabular figures and **never truncated** (`10-COMPONENT-SPECIFICATION.md`) |
| **Traceability chain** | The reference standards used: asset id, their certificate numbers, their due dates, and **a warning if a standard was out of calibration on the date of use**. Each links to that standard's record: the "unbroken chain" made navigable |
| Verification page (`/verify`) | The QR on the certificate resolves to a public page that shows **the verdict first** (Valid / Superseded / Revoked / Not found), then the issuer, number, device, date and signatory. The `VerificationVerdict` component already exists |

The QR verification benchmark (credential products): the scan "opens a verification page that confirms the document… and shows the issuer, recipient, and issue date", with no app required. A code that "leads nowhere, shows an error, or says the code is a duplicate" is itself a signal of forgery. So **"Not found" must be a clear verdict, not an error page.**

Sources: [EA FAQ 45.2, amendments (7.8.8.1)](https://european-accreditation.org/sp_accordion_faqs/45-2-question-on-amendments-to-test-reports-iso-iec-17025-clause-7-8-8-1/) · [EA FAQ 50.1, amendments (7.8.8)](https://european-accreditation.org/sp_accordion_faqs/50-1-question-on-amendments-to-reports-iso-iec-17025-clause-7-8-8/) · [PJLA, Section 7.8 Reporting of Results](https://www.pjlabs.com/downloads/webinar_slides/10.9.2024_Reporting-Results.pdf) · [Quality Magazine, reading 17025 certificates](https://www.qualitymag.com/articles/98235-how-to-read-and-interpret-iso-iec-17025-calibration-certificates) · [NIST SOP 1, certificate evaluation](https://www.nist.gov/document/sop-1-calibration-certificate-eval-app-b-c-20190506docx) · [QR certificate verification](https://trueoriginal.com/resources/qr-code-certificate-verification)

### 3.6 GDPR, and Indonesia's UU PDP

| Requirement | Source | UI |
|---|---|---|
| A consent request is "clearly distinguishable from the other matters, in an intelligible and easily accessible form, using clear and plain language" | GDPR Art. 7(2) | A consent item of its own, never bundled into the terms; one purpose per checkbox |
| "It shall be as easy to withdraw as to give consent" | Art. 7(3) | **Withdraw sits in the same place and takes the same number of clicks** as giving consent: a consent list in the profile with a toggle per purpose |
| Information "concise, transparent, intelligible and easily accessible" | Art. 12(1) | Plain-language notices in **both** languages |
| Respond to a request within **one month** (extendable by two) | Art. 12(3) | The DSAR list is a **worklist** with an SLA countdown badge per request |
| Portability "in a structured, commonly used and machine-readable format" | Art. 20(1) | "Export my data" gives **JSON or CSV** (machine-readable) plus, optionally, a PDF (readable) |
| **Indonesia's UU PDP (Law 27/2022)**, fully in force since 17 Oct 2024: access, rectification and restriction requests answered within **3×24 hours (72 h)**; breach notice within 3×24 h | UU PDP | **The primary market's deadline is stricter than GDPR's.** The DSAR worklist needs an **hour-level** SLA per jurisdiction, not a day-level one |
| Erasure versus retention | GDPR Art. 17(3), 17025 records, Part 11 retention | The erasure request screen must show **which data is retained and why** (legal obligation, calibration record retention) instead of pretending everything was deleted |

Sources: [GDPR Art. 7](https://gdpr-info.eu/art-7-gdpr/) · [Art. 12](https://gdpr-info.eu/art-12-gdpr/) · [Art. 20](https://gdpr-info.eu/art-20-gdpr/) · [UU PDP overview (XPND)](https://xpnd.co.id/regulatory/uu-pdp-27-2022-indonesia/) · [DLA Piper, Indonesia](https://www.dlapiperdataprotection.com/?t=law&c=ID) · [UU No. 27/2022 (JDIH BPK)](https://peraturan.bpk.go.id/Details/229798/uu-no-27-tahun-2022)

### 3.7 Hospital accreditation (the target users' auditors)

- **Indonesia (KARS / SNARS / STARKES, chapter MFK — Manajemen Fasilitas dan Keselamatan):** medical devices are tested and/or calibrated **at least once a year**, with preventive maintenance and calibration documented. The surveyor reads the equipment inventory and the calibration evidence. That is the persona "the seventh reader".
- **Joint Commission (EC.02.04.01/.03):** **100%** completion of scheduled maintenance on high-risk (life-support) equipment, and **≥ 90%** for non-high-risk equipment in an Alternative Equipment Maintenance program.

**UI consequence:** the Engineering Manager's home needs a **completion-rate KPI split by risk class**, with the threshold drawn in: 100% is a hard line for high risk, and 90% for AEM.

Sources: [MFK, STARKES 2024 (snars.web.id)](https://snars.web.id/rs/3-manajemen-fasilitas-dan-keselamatan-mfk-akreditasi-kemenkes-kmk-1128/) · [BPAFK Surakarta, device testing and calibration](https://bpafk-surakarta.go.id/pelayanan/pengujian-dan-kalibrasi-alat-kesehatan/) · [AAMI, TJC expectations](https://array.aami.org/content/news/joint-commission-ups-expectation-medical-device-maintenance-activities) · [24x7, revised TJC medical-equipment standards](https://24x7mag.com/standards/regulations/joint-commission-regulations/revised-joint-commission-standards-medical-equipment/)

---

## 4. Benchmark: Hospital CMMS, Calibration and QMS Products

**Caveat:** the evidence below is vendors' published features and documentation, not hands-on use. It shows *what the category considers table stakes*, not how well any product does it.

| Product | Category | Patterns worth taking |
|---|---|---|
| **Accruent TMS** (healthcare CMMS; the owner's brief called it "TMS/Q-Pulse") | HTM/CMMS | Work-order lifecycle from request to resolution with priority; healthcare-specific PM and EOC (environment of care) fields; compliance data "documented, reportable and retrievable"; browser-agnostic and mobile-friendly |
| **Nuvolo** (HTM on ServiceNow) | HTM/CMMS | Asset lifecycle from onboarding to disposition; **risk scoring per asset class**; AEM program monitoring; **offline mobile**; contract coverage that tells the technician the device is under a vendor contract |
| **Blue Mountain RAM** | GxP EAM plus calibration | **As-found/as-left** with tolerance checks; **out-of-tolerance investigations** as their own workflow; work-order review and closure routing with e-signatures; audit trail |
| **eMaint (Fluke)** | CMMS plus calibration | Test points, parameters, required tools and tolerance defined per asset; **auto-generate a work order when a reading is out of tolerance**; drag-and-drop calibration calendar; **QR labels: scan → a blank work request for that asset, or its history**; KPI dashboards (MTBF, MTTR, PM compliance) |
| **GAGEtrak** | Calibration management | "Calibrations Due" tab: **past-due in red, due within a look-ahead window in black**, and the window is configurable (in months); drag-and-drop calendar; check-in/out and crib transfers; **multi-level predefined signature options**; FDA Compliance Manager add-on |
| **Calibration Control** | Calibration management | Due-date tracking, **out-of-tolerance notification**, grid filtering, automated e-mail to responsible people when equipment is due |
| **Ideagen Quality Management (Q-Pulse)** | QMS | CAPA, NC, documents and audits **linked**: raising an NC links the relevant SOPs; configurable approval workflows. The **reviews call the UI dated** — Callibrator's opportunity |

Sources: [Accruent TMS](https://www.accruent.com/products/tms) · [Accruent, healthcare work-order management](https://www.accruent.com/resources/brochures/healthcare-work-order-management) · [Nuvolo HTM asset management](https://www.nuvolo.com/products/htm-asset-management/) · [Nuvolo, Connected Workplace for Healthcare](https://www.nuvolo.com/solution/connected-workplace-for-healthcare/) · [Blue Mountain, medical device asset management](https://www.bluemountain.io/life-sciences/medical-device-asset-management/) · [Blue Mountain RAM (SelectHub)](https://www.selecthub.com/p/eam-software/blue-mountain-ram/) · [eMaint calibration](https://www.emaint.com/calibration) · [eMaint CMMS](https://www.emaint.com/cmms/emaint-cmms-software/) · [GAGEtrak features](https://gagetrak.com/features/) · [GAGEtrak 7 user guide (PDF)](https://www.gagetrak.com/wp-content/uploads/GAGEtrak_7.0.3_User_Guide.pdf) · [GAGEtrak 7 features (PDF)](https://gagetrak.com/wp-content/uploads/GAGEtrak_7_Features.pdf) · [Calibration Control (Software Advice)](https://www.softwareadvice.com/cmms/calibration-control-profile/) · [Ideagen quality management](https://www.ideagen.com/solutions/quality/quality-management) · [Ideagen reviews (G2)](https://www.g2.com/products/ideagen-quality-management/reviews)

### 4.1 Due and overdue management

- **Status bands, not only dates.** Every product computes a band from the due date: *overdue*, *due within N days*, *current*, and often *out of service* or *not required*. Callibrator already has the vocabulary (`00-DESIGN-DIRECTION.md`: compliant, due soon, overdue, draft, revoked).
- **A configurable look-ahead window** (GAGEtrak specifies it in months) → a **tenant setting**, for example 30, 60 or 90 days, shown in the column header ("Due ≤ 30 d").
- **Relative plus absolute dates:** "Overdue 12 days" in the badge, and the absolute date beside it or in its tooltip. In compliance lists **the absolute date is the evidence**, so it must never be tooltip-only.
- **Escalation:** e-mail or notification to the responsible person at the due date, and to the manager when the item goes overdue (Calibration Control).

### 4.2 The calibration workflow

A synthesis: **schedule → work order → procedure with test points → as-found → adjust → as-left → pass/fail against tolerance → out-of-tolerance branch (investigation + impact assessment) → review → sign → certificate issued → next due date computed.**

UI implications:
- The **Path** (§1.5) across the top.
- The entry form lays out **test points as rows** with the tolerance shown per row.
- A pass/fail badge updates live as the value is typed, with text plus a shape.
- An **as-found failure opens the OOT branch automatically**, like eMaint's auto-work-order.
- The certificate cannot be issued while the OOT is open (409, with the state explanation).

### 4.3 Certificate generation and verification

- Pre-formatted certificate templates (GAGEtrak).
- **The on-screen record and the PDF share one field order** (§3.5).
- **Issue** is a signed transition, not a "generate PDF" button.
- The QR resolves to `/verify` (§3.5).
- **Reissue means amend**, with revisions (§3.4).

### 4.4 Work orders

The lifecycle is `requested → assigned → in progress → on hold (parts or vendor) → completed → reviewed/closed`.

- The list is a **worklist tabbed by state**.
- The object page carries: the asset summary, the problem, labour and parts (linked to stock), attachments, the **activity stream**, and a signature at closure where required.
- **Hold reasons are a controlled list**, because "waiting for parts" is a KPI.
- Contract coverage is flagged on open (Nuvolo).

### 4.5 Asset list with status

- **The first column is the human-readable asset tag or name** (NN/g), followed by model, serial, location/department, **risk class**, **calibration status band plus due date**, maintenance status, and the owner.
- A saved view per department.
- **Status columns use badges with text**, and the overdue count shows in the view tab ("Overdue (14)").
- The asset **hierarchy** (eMaint), such as system → component, goes in the object page, not the list.

### 4.6 QR and asset tags

- A printed label per asset: asset tag, name, **calibration due date (human-readable)**, and a QR.
- **The QR resolves by role.** An anonymous scanner gets the public verification or status page. A signed-in technician gets the device object page, with "Log calibration" and "Raise work request" as the primary actions (eMaint: "scan → blank work request for that asset").
- **Print labels in batches** from the list's batch bar.
- **The label must stay legible after lamination**: minimum sizes are a print spec, outside the scope here.

### 4.7 Dashboards for biomedical engineering (role homes)

| Role (persona) | Home type | Cards |
|---|---|---|
| Technician (Budi) | **Worklist-first** | My work orders by state; calibrations due to me this week; recently scanned devices |
| Engineering Manager (Rina) | **Overview** | **PM/calibration completion rate by risk class against the 100% / 90% lines**; overdue by department; OOT events this quarter; open CAPA; workload by technician |
| Warehouse Staff (Sari) | Worklist | Pending transfers; opname in progress; low-stock items |
| Calibration Provider Admin (Dewi) | Worklist plus KPIs | Certificates awaiting review or signature; turnaround time; jobs per customer tenant |
| Healthcare Admin | Overview | Compliance summary for accreditation (MFK readiness); users and roles; open tickets |
| Platform Operator (Andi) | Overview | Tenant health; ticket response queue; batch jobs; storage |

Every KPI card follows the existing rules: "never fake certainty" (unavailable, not zero), and **every figure is a link to the list report that produced it**, pre-filtered (Fiori overview page → list report).

---

## 5. Bilingual Indonesian / English

### 5.1 A conflict with the current direction document

[`00-DESIGN-DIRECTION.md`](../00-DESIGN-DIRECTION.md) § Language says the interface is English with Indonesian role names, "deliberate, not an unfinished translation". The owner's new direction is **Indonesian and English**. That is a change to `docs/` and needs an ADR under the deviation protocol; it is not something to adopt quietly. The frontend has **no i18n library today** (no `next-intl`, `i18next` or `react-intl` in `frontend/src`, checked 2026-09-29).

### 5.2 Where the locale switch goes

- **Enterprise web apps put language in the user profile or settings menu, with persistence per account.** A header switch belongs on public sites.
- Label each language **in its own language**: "Bahasa Indonesia", "English". Never translate the names or use flags.
- **Recommendation:**
  - In the dashboard, put the language in the **user dropdown** (`UserDropdown.tsx`) beside theme and density. The three are per-user display preferences (Salesforce puts density there too). Persist it on the user record, and in a cookie for the first paint.
  - On public pages (landing, `/verify`, login), a **visible header switch**. The anonymous auditor on `/verify` cannot reach a profile menu.
  - A tenant-level default (Indonesian for Indonesian hospitals), which a user can override.
- **Implementation hint (for the later ADR, not decided here):** `next-intl` supports App Router without a locale URL prefix (`localePrefix: 'never'`, cookie-driven). That fits an authenticated app whose URLs do not need to differ per language. Public marketing pages may want prefixed URLs for SEO.
- The certificate language is **a property of the certificate**, chosen at issue and recorded, not the viewer's UI language. A certificate must read the same to everyone who opens it.

Sources: [Smashing, Designing a better language selector](https://www.smashingmagazine.com/2022/05/designing-better-language-selector/) · [Smartling, language selector design](https://www.smartling.com/questions/language-selector-switcher-design) · [next-intl, without i18n routing](https://next-intl.dev/docs/getting-started/app-router/without-i18n-routing) · [next-intl routing configuration](https://next-intl.dev/docs/routing/configuration)

### 5.3 Date, time and number formats (CLDR, printed from Node 26.10 `Intl`)

| | `id-ID` | `en-US` | `en-GB` |
|---|---|---|---|
| Short date | `29/09/26` | `9/29/26` | `29/09/2026` |
| Medium date and time | `29 Sep 2026, 14.30` | `Sep 29, 2026, 2:30 PM` | `29 Sept 2026, 14:30` |
| Full date | `Selasa, 29 September 2026` | `Tuesday, September 29, 2026` | `Tuesday, 29 September 2026` |
| Time with zone | `14.30.05 WIB` | `2:30:05 PM GMT+7` | `14:30:05 GMT+7` |
| Number | `1.234.567,891` | `1,234,567.891` | `1,234,567.891` |
| Currency (IDR) | `Rp 1.500.000` | `IDR 1,500,000` | `IDR 1,500,000` |
| Percent | `93,5%` | `93.5%` | `93.5%` |
| Relative | `3 hari yang lalu` | `3 days ago` | `3 days ago` |
| Compact | `1,3 jt` | `1.3M` | `1.3m` |

**Consequences:**

1. **Never use the short numeric date in compliance views.** `09/10/26` is 9 October to an Indonesian reader and 10 September to an American one. Use the **medium format with the month as a word** (`29 Sep 2026`), or ISO `2026-09-29` in exports and audit trails. Four-digit years only.
2. **Times: 24-hour, and the timezone is part of the value.** Indonesia has three zones (WIB, WITA, WIT), a tenant may span them, and §11.50 needs the signing time unambiguous. Show the zone abbreviation on signatures and audit rows.
3. **The decimal marker is a patient-safety issue.** In `id-ID`, `1.234` means one thousand two hundred thirty-four; in `en-US` it means about 1.2.
   - **Measurement inputs must parse according to the user's locale and echo the value back formatted** ("= 1,234 mA").
   - Grouping separators are refused in measurement fields.
   - Tolerance checking runs on the parsed value, so a misread shows up as an immediate FAIL.
   - The **SI Brochure** allows either the point or the comma as the decimal marker, but groups digits in threes with a **thin space, never a point or comma**. **Measurements and certificates should use SI grouping** (`12 345,678` / `12 345.678`), so a certificate reads correctly whichever language it is printed in. Currency and counts can use the locale's grouping.
4. **Tabular figures** (`font-variant-numeric: tabular-nums`) are already the rule; keep them in both locales so the columns align.

Sources: [NIST, Writing with the SI](https://www.nist.gov/pml/owm/writing-si-metric-system-units) · [NIST J-032](https://www.nist.gov/document/j-032-writing-si) · [Decimal separator (overview)](https://en.wikipedia.org/wiki/Decimal_separator)

### 5.4 Text expansion in dense layouts

- **Expansion is inversely related to string length:** under 10 characters it can reach **+100–200%**, and past 70 characters about **+30%** (IBM guidelines, cited by W3C). Indonesian is not among W3C's named examples, and **no measured figure for Indonesian was found**. The hypothesis is that it runs longer than English in short UI labels ("Due" → "Jatuh tempo", "Overdue" → "Terlambat" or "Lewat jatuh tempo"; though "Save" → "Simpan" is equal), which is exactly the short-string case. Measure it on the real string catalogue before sizing columns.
- **Dense layouts break at:** column headers, badges, buttons, tabs, and the collapsed-sidebar tooltips.
- **Patterns:**
  - Column headers wrap to two lines, then truncate with a tooltip (Carbon).
  - **Badges never truncate** (status is evidence); choose shorter Indonesian status terms in the glossary instead.
  - Buttons size to content, with no fixed widths.
  - Tabs overflow into a "More" menu.
  - **Pseudo-localisation** (+40% padded strings) runs in CI screenshots, in both densities.
- **A glossary is a deliverable**, not an afterthought. Keep domain terms consistent across the UI, the PDFs and the notifications: *kalibrasi, pemeliharaan, sertifikat, jatuh tempo, terlambat, opname, tindakan korektif (CAPA), ketidaksesuaian (NC)*. The users already say "opname", so it stays in both languages.

Sources: [W3C, Text size in translation](https://www.w3.org/International/articles/article-text-size.en.html) · [Front-End Checklist, text expansion](https://frontendchecklist.io/rules/i18n/text-expansion)

---

## 6. Recommended Pattern Library for Callibrator (prioritised)

**P0** = the foundation that every screen depends on, or a regulatory requirement. **P1** = high value in the first redesign wave. **P2** = later.

| # | Pri | Pattern | One-line rationale | Source |
|---|---|---|---|---|
| 1 | P0 | **Four page floorplans: List report · Worklist · Object page · Overview.** Every route is assigned one | Consistency (Nielsen #4) and a finite build; 33 modules become four templates | SAP Fiori floorplans; ServiceNow record page |
| 2 | P0 | **Density tokens: comfortable 40 px rows (default) / compact 32 px rows; forced comfortable on `pointer: coarse`**; a per-user setting plus a tenant default | The owner's direction, with a floor that keeps 24 px targets (WCAG 2.2 SC 2.5.8) and keeps tablets usable | Carbon row sizes; Fiori cozy/compact; Salesforce density |
| 3 | P0 | **One `DataTable`: native `<table>`, `aria-sort`, human-readable identifier first, frozen header and first column, numbers right-aligned and tabular, never truncating identifiers or measurements** | Reuses the existing single-table contract and passes 1.3.1 without grid complexity | APG table pattern; NN/g data tables; `10-COMPONENT-SPECIFICATION.md` |
| 4 | P0 | **The e-signature pattern: review → confirm → re-authenticate (all components or one, depending on the session) → signature block** | Directly required by §11.50, §11.200 and WCAG 3.3.4 | 21 CFR 11.50 / 11.200; WCAG 3.3.4 |
| 5 | P0 | **Signature block component** (printed name · date-time with timezone · meaning), identical on screen and in the PDF | §11.50(b) requires it in *every* human-readable form | 21 CFR 11.50 |
| 6 | P0 | **Per-record audit tab (old → new, who, when, why), read-only, exportable**, separate from the activity stream | §11.10(e) "shall not obscure previously recorded information"; the auditor persona | 21 CFR 11.10(e); ISO 17025 7.5.2 |
| 7 | P0 | **Immutability indicator plus the amendment/revision route** instead of editing a signed record | Makes Part 11 and 17025 7.8.8 visible, and turns a 409 into guidance | ISO 17025 7.8.8; `CLAUDE.md` 409 contract |
| 8 | P0 | **StatusBadge: text + colour + shape, from one status vocabulary** (current / due soon / overdue / draft / revoked), never truncated | Status is regulatory; colour alone fails 1.4.1 and 1.4.11 | Carbon status indicators; `00-DESIGN-DIRECTION.md` |
| 9 | P0 | **Three list states, never conflated: skeleton / empty (no data · no results · no access) / error with retry** | "Never fake certainty"; an empty list after a failed request is a false compliance figure | Carbon empty states; Atlassian empty state; `10-COMPONENT-SPECIFICATION.md` |
| 10 | P0 | **Locale-aware measurement input** (parse by locale, echo the formatted value, refuse grouping separators, live tolerance check) with SI digit grouping on certificates | The `1.234` vs `1,234` ambiguity is a patient-safety defect in a bilingual app | SI Brochure (NIST); CLDR |
| 11 | P1 | **Filter bar with saved views (variants)**: a Standard view, a user default, a "modified" marker, filter state in the URL | Recognition over recall; supports "overdue, high-risk, my department" as a one-click question | Fiori variant management; Carbon filtering |
| 12 | P1 | **Batch action bar on selection** (count, ≤ 5 actions plus overflow, Cancel; row actions disabled while it is active) | Space-efficient bulk work (print labels, assign, schedule) without per-row clutter | Carbon data table; NN/g |
| 13 | P1 | **Object page: header with key facts and status plus the lifecycle Path; section tabs; header actions in display mode, sticky footer in edit mode** | Keeps the next legal transition and its explanation next to the status it changes | Fiori object page; Salesforce highlights panel and Path |
| 14 | P1 | **Non-modal side panel for row preview and quick view**, overlaying at ≤ 1024 px | View one record without losing the list (NN/g); tablets stay usable | NN/g data tables; Atlassian panel |
| 15 | P1 | **Role home: a worklist home for doers, an overview home for managers**; every KPI links to its pre-filtered list | The owner's role-specific home, grounded in what each persona does first | Fiori overview page; ServiceNow workspace landing |
| 16 | P1 | **Due-date bands with a configurable look-ahead window**; relative plus absolute date, absolute always visible | The core job of the product; this is how every benchmark presents it | GAGEtrak; Calibration Control; eMaint |
| 17 | P1 | **Form pattern: labels above in data entry, sections, units and tolerance beside inputs, field errors plus an error-summary popover with a counter, draft save** | Precision entry (the direction's "spacious where the user must get it right") plus 3.3.1 and 3.3.3 | Fiori message popover and draft; WCAG 3.3.x |
| 18 | P1 | **Collapsible sidebar grouped by domain** (Operations · Quality · Administration · Identity · Commercial · Platform · Collaboration), two levels at most, icon rail when collapsed with tooltips, state persisted | The owner's direction, matching the existing IA groups; keeps the main area wide for tables | Atlassian navigation layout; `02-INFORMATION-ARCHITECTURE.md` |
| 19 | P1 | **Notifications by kind: inline for forms, toast (auto-dismiss only without an action), one banner at a time, the panel (bell) for history; critical messages never timed** | Stops everything becoming a toast; meets 4.1.3 and 2.2.x | Carbon notification pattern; WCAG 4.1.3 |
| 20 | P1 | **Session-timeout warning with "extend" (≥ 20 s), and draft preservation across re-authentication** | Reconciles Part 11 short sessions with WCAG 2.2.1; nobody loses a half-typed calibration | WCAG 2.2.1; 21 CFR 11.200 |
| 21 | P1 | **Language in the user menu (with theme and density), tenant default, a public header switch on `/verify` and login; certificate language fixed at issue** | Enterprise convention; an anonymous auditor cannot open a profile menu | Smashing / Smartling selector guidance; next-intl |
| 22 | P1 | **Breadcrumbs on object pages and nested routes**, never wrapping, first … last collapse | Orientation in list → object navigation; the IA stays two levels deep | Atlassian breadcrumbs |
| 23 | P1 | **Traceability panel on the certificate**: the reference standards with their certificate and due date, a warning if a standard was expired on the date of use | Makes the 17025 "unbroken chain" navigable and auditable | ISO 17025 7.8.4; NIST SOP 1 |
| 24 | P1 | **QR by role**: anonymous → `/verify` verdict; signed-in → the device page with "Log calibration / Raise work request"; batch label printing | Turns the physical tag into the fastest entry point | eMaint QR; certificate verification practice |
| 25 | P2 | **Command palette (Ctrl/⌘+K)** over `/api/v1/search` plus navigation and actions, shortcuts printed beside commands; a visible search box as the trigger | Efficiency for experts (Nielsen #7) without hiding anything from novices; `GlobalSearch.tsx` is the seed | Command palette pattern literature |
| 26 | P2 | **Column chooser (show, hide, reorder) persisted in the saved view** | Different roles need different columns of the same register | ServiceNow record list; NN/g |
| 27 | P2 | **DSAR worklist with a per-jurisdiction SLA countdown (UU PDP 72 h, GDPR one month) and consent toggles as easy to withdraw as to give** | Legal deadlines made visible; Art. 7(3) symmetry | GDPR Art. 7 / 12 / 20; UU PDP |
| 28 | P2 | **`role="grid"` only for true editing sheets** (opname count, a measurement-point table), keyboard-tested with NVDA | Spreadsheet-speed entry where it pays, without making every table a grid | APG grid pattern |
| 29 | P2 | **Pseudo-localisation plus density screenshot matrix in CI** (id/en × comfortable/compact × light/dark) | Catches text expansion and contrast regressions before users see them | W3C text size; ADR-090 |

### Top 20, in priority order

Rows 1–20 of the table above, in order:

1. Four floorplans
2. Density tokens (40/32 px, touch forced to comfortable)
3. One native-table `DataTable`
4. The e-signature flow
5. Signature block
6. Per-record audit tab
7. Immutability plus amendment route
8. StatusBadge (text, colour and shape)
9. Three list states
10. Locale-aware measurement input
11. Filter bar with saved views
12. Batch action bar
13. Object page with Path
14. Non-modal side panel
15. Role homes
16. Due-date bands
17. Form pattern with error summary
18. Domain-grouped collapsible sidebar
19. Notification kinds
20. Session-timeout warning with draft preservation

Rows 21–29 follow in the next wave.

---

## 7. What Would Confirm These Recommendations (the next research)

This document is secondary research. The smallest study that would validate its riskiest assumptions:

| Assumption | Study | Participants |
|---|---|---|
| Compact density helps managers and hurts no one's accuracy | A within-subjects task test: find the overdue high-risk devices in department X, in both densities; measure time and errors | 5–6 people per role, Engineering Manager and Technician |
| Technicians want a queue-first home, not charts | A first-click test on two home mock-ups | 8–10 technicians (Budi) |
| Locale-aware decimal input prevents entry errors | A test entering 20 measurements in `id-ID` with and without the echo; count misreads | 6–8 technicians, **Indonesian locale on their own machines** |
| The e-signature flow is understood and not over-prompted | Think-aloud while signing three records in one session | 5 reviewers or approvers (Penyelia) |
| An auditor can answer "who changed this, and why" alone | A timed task on the audit tab, done by someone with **no training** | 3–5 people from quality or accreditation backgrounds |

**Accessibility must be part of recruitment:** at least one screen-reader user (NVDA) and one keyboard-only user across the studies. ADR-090 notes that no screen-reader walk has yet been done.

---

## Sources (consolidated)

**Design systems.**
- SAP Fiori: [floorplan selection](https://www.sap.com/design-system/fiori-design-web/v1-108/page-types/floorplans/when-to-use-which-floorplan) · [list report](https://www.sap.com/design-system/fiori-design-web/v1-108/page-types/floorplans/list-report-floorplan-sap-fiori-element) · [worklist](https://www.sap.com/design-system/fiori-design-web/v1-96/discover/frameworks/sap-fiori-elements/list-report/worklist-sap-fiori-elements) · [object page](https://www.sap.com/design-system/fiori-design-web/v1-136/page-types/floorplans/object-page/usage) · [density](https://www.sap.com/design-system/fiori-design-web/v1-108/foundations/visual/cozy-compact) · [variant management](https://www.sap.com/design-system/fiori-design-web/v1-84/ui-elements/variant-management/usage?external) · [message popover](https://www.sap.com/design-system/fiori-design-web/v1-120/ui-elements/message-popover/usage)
- ServiceNow Horizon: [structure](https://horizon.servicenow.com/workspace/basics/structure) · [record list](https://horizon.servicenow.com/workspace/components/record-list) · [record page](https://horizon.servicenow.com/workspace/page-templates/record-page-vertical) · [forms](https://horizon.servicenow.com/workspace/patterns/forms/form-patterns)
- IBM Carbon: [data table](https://carbondesignsystem.com/components/data-table/usage/) · [2x grid](https://carbondesignsystem.com/elements/2x-grid/overview/) · [notifications](https://carbondesignsystem.com/patterns/notification-pattern/) · [status](https://carbondesignsystem.com/patterns/status-indicator-pattern/) · [filtering](https://carbondesignsystem.com/patterns/filtering/) · [empty states](https://carbondesignsystem.com/patterns/empty-states-pattern/)
- Atlassian: [navigation layout](https://atlassian.design/components/navigation-system/layout/usage) · [breadcrumbs](https://atlassian.design/components/breadcrumbs/breadcrumbs/usage) · [empty state](https://atlassian.design/components/empty-state/usage)
- Salesforce: [density](https://developer.salesforce.com/blogs/2018/08/new-density-settings-for-the-lightning-experience-ui-in-winter-19) · [path](https://developer.salesforce.com/docs/component-library/bundle/lightning:path) · [related lists](https://help.salesforce.com/s/articleView?id=xcloud.basics_understanding_related_lists_lex.htm&language=en_US&type=5)

**Heuristics and accessibility.**
- [NN/g heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/) · [NN/g data tables](https://www.nngroup.com/articles/data-tables/)
- [APG grid](https://www.w3.org/WAI/ARIA/apg/patterns/grid/) · [APG table](https://www.w3.org/WAI/ARIA/apg/patterns/table/)
- WCAG Understanding: [1.4.10](https://www.w3.org/WAI/WCAG21/Understanding/reflow.html) · [1.4.11](https://www.w3.org/WAI/WCAG21/Understanding/non-text-contrast.html) · [2.2.1](https://www.w3.org/WAI/WCAG21/Understanding/timing-adjustable.html) · [2.5.5](https://www.w3.org/WAI/WCAG21/Understanding/target-size.html) · [2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) · [3.3.4](https://www.w3.org/WAI/WCAG21/Understanding/error-prevention-legal-financial-data.html) · [4.1.3](https://www.w3.org/WAI/WCAG21/Understanding/status-messages.html)

**Regulation.**
- 21 CFR: [11.10](https://www.law.cornell.edu/cfr/text/21/11.10) · [11.50](https://www.law.cornell.edu/cfr/text/21/11.50) · [11.70](https://www.law.cornell.edu/cfr/text/21/11.70) · [11.200](https://www.law.cornell.edu/cfr/text/21/11.200) · [FDA 2003 guidance](https://www.federalregister.gov/documents/2003/09/05/03-22574/guidance-for-industry-on-part-11-electronic-records-electronic-signatures-scope-and-application)
- ISO/IEC 17025: [EA FAQ 45.2](https://european-accreditation.org/sp_accordion_faqs/45-2-question-on-amendments-to-test-reports-iso-iec-17025-clause-7-8-8-1/) · [PJLA 7.8](https://www.pjlabs.com/downloads/webinar_slides/10.9.2024_Reporting-Results.pdf)
- GDPR: [Art. 7](https://gdpr-info.eu/art-7-gdpr/) · [Art. 12](https://gdpr-info.eu/art-12-gdpr/) · [Art. 20](https://gdpr-info.eu/art-20-gdpr/) · [UU PDP](https://xpnd.co.id/regulatory/uu-pdp-27-2022-indonesia/)
- Accreditation: [MFK / STARKES](https://snars.web.id/rs/3-manajemen-fasilitas-dan-keselamatan-mfk-akreditasi-kemenkes-kmk-1128/) · [AAMI on TJC](https://array.aami.org/content/news/joint-commission-ups-expectation-medical-device-maintenance-activities)

**Benchmarks.** [Accruent TMS](https://www.accruent.com/products/tms) · [Nuvolo HTM](https://www.nuvolo.com/products/htm-asset-management/) · [Blue Mountain](https://www.bluemountain.io/life-sciences/medical-device-asset-management/) · [eMaint calibration](https://www.emaint.com/calibration) · [GAGEtrak](https://gagetrak.com/features/) · [Calibration Control](https://www.softwareadvice.com/cmms/calibration-control-profile/) · [Ideagen QM](https://www.ideagen.com/solutions/quality/quality-management)

**Internationalisation.** [W3C text size](https://www.w3.org/International/articles/article-text-size.en.html) · [NIST, writing with the SI](https://www.nist.gov/pml/owm/writing-si-metric-system-units) · [Smashing, language selector](https://www.smashingmagazine.com/2022/05/designing-better-language-selector/) · [next-intl](https://next-intl.dev/docs/getting-started/app-router/without-i18n-routing)
