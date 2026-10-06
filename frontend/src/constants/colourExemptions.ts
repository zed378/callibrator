/**
 * ADR-122 (P11-01): the reviewed exceptions to the dashboard colour guard
 * (`src/tests/guards/dashboardColours.p1101.guard.test.ts`).
 *
 * The dashboard colours through semantic tokens only (globals.css). A raw
 * colour in a dashboard file is allowed only when it is listed here with the
 * file, the exact literal, how many times it occurs and why. Growing this list
 * to pass the guard instead of fixing the file is an abuse case (spec P11-00
 * §9): each entry is a review item.
 */
export interface ColourExemption {
  /** Path under `frontend/src`, forward slashes. */
  file: string;
  /** The exact text the guard matched. */
  literal: string;
  /** How many times it occurs in the file; the guard fails on more or fewer. */
  count: number;
  reason: string;
}

const USER_COLOUR = "user data: a colour the user chooses and the server stores, not a theme colour";

export const COLOUR_EXEMPTIONS: readonly ColourExemption[] = [
  // Kanban: a project's and a label's colour are user-chosen data. These are
  // the defaults offered in the picker and the fallback for a row that has
  // none; the text drawn on them is chosen by contrast (lib/readableOn.ts).
  { file: "app/dashboard/kanban/hooks/useKanbanProjects.ts", literal: "#4f46e5", count: 2, reason: `${USER_COLOUR} (project colour default)` },
  { file: "app/dashboard/kanban/page.tsx", literal: "#4f46e5", count: 2, reason: `${USER_COLOUR} (project colour fallback)` },
  { file: "app/dashboard/kanban/[projectId]/page.tsx", literal: "#4f46e5", count: 2, reason: `${USER_COLOUR} (project colour fallback)` },
  { file: "app/dashboard/kanban/[projectId]/components/CardTile.tsx", literal: "#94a3b8", count: 1, reason: `${USER_COLOUR} (label colour fallback)` },
  { file: "app/dashboard/kanban/[projectId]/components/ManageBoardModal.tsx", literal: "#ef4444", count: 1, reason: `${USER_COLOUR} (new label default)` },
  { file: "app/dashboard/kanban/[projectId]/components/ManageBoardModal.tsx", literal: "#94a3b8", count: 2, reason: `${USER_COLOUR} (label colour fallback)` },
  // Tenants: the brand colour picker's default. The stored colour is turned
  // into an accessible --primary per theme by lib/brandColor.ts (ADR-090 am.).
  { file: "app/dashboard/tenants/components/TenantFormFields.tsx", literal: "#4f46e5", count: 2, reason: `${USER_COLOUR} (tenant brand picker default)` },
  { file: "app/dashboard/tenants/hooks/useTenants.ts", literal: "#4f46e5", count: 3, reason: `${USER_COLOUR} (tenant brand default)` },
  // A QR code must be dark modules on a light ground in both themes, or
  // authenticator apps cannot read it (like the public .lp-paper objects).
  { file: "app/dashboard/mfa/page.tsx", literal: "bg-white", count: 1, reason: "the TOTP QR code needs a white quiet zone in both themes to scan" },
  // Not a colour: a matter number in placeholder copy ("matter #1234").
  { file: "app/dashboard/data-retention/page.tsx", literal: "#1234", count: 1, reason: "not a colour: a reference number in a placeholder's example text" },
];
