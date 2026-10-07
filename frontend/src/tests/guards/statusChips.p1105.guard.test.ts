/**
 * P11-05 follow-up (ADR-122 §6, Amendment 1, 2026-10-07): a status is shown
 * through the status-tone registry (`lib/statusTone.ts` → `Badge tone` /
 * `StatusBadge`) — shape, icon, label AND colour — never as a colour-only chip.
 *
 * The P11-05 sweep converted 28 local maps; the inline chips it left
 * (`<Badge variant={x ? "success" : "default"}>`, a hand-made red count pill)
 * still said "status" by colour alone, which ADR-122 calls a defect. This
 * guard scans every non-test `.ts`/`.tsx` file under `app/**` and
 * `components/**` for three forms:
 *
 *   variant   a `<Badge>` whose `variant` names success / warning / danger —
 *             the colour-only status chip. (The Badge type no longer accepts
 *             those three, so a typed caller fails `npm run typecheck` too;
 *             this catches a cast.)
 *   tone      a `<Badge>` given a LITERAL tone (`tone="alarm"`): the tone
 *             must come from the registry (`toneOf`, `statusOf`,
 *             `StatusBadge`), so the meaning lives in one table.
 *   pill      a hand-made pill: one `className` with `rounded-full`, padding
 *             and a status tint + text (`bg-destructive/10 text-destructive`)
 *
 * There is no allow-list: a chip that is not a status (a plan tier, a role
 * level, an audit verb) uses a neutral variant. The fixture below proves each
 * form fires (CLAUDE.md "Evidence").
 */
import fs from "fs";
import path from "path";

const SRC = path.resolve(__dirname, "../..");
const ROOTS = ["app", "components"];
/** The registry's own renderers. */
const OWNERS = new Set(["components/ui/Badge.tsx", "components/ui/StatusBadge.tsx"]);

const STATUS_WORD = /["'](?:success|warning|danger)["']/;
const STATUS_TINT = /\bbg-(?:success|warning|destructive|info|status-[a-z]+)\/\d+/;
const STATUS_TEXT = /\btext-(?:success|warning|destructive|info|status-[a-z]+)\b/;

interface Finding {
  kind: "variant" | "tone" | "pill";
  line: number;
  text: string;
}

const lineOf = (text: string, index: number) => text.slice(0, index).split("\n").length;

const scanStatusChips = (text: string): Finding[] => {
  const out: Finding[] = [];
  // A <Badge …> opening tag, attributes possibly over several lines. `[^>]`
  // stops at the first `>`, so an arrow function inside an attribute ends the
  // match early — the variant/tone of every Badge in this tree sits before any.
  for (const m of text.matchAll(/<Badge\b([^>]*)>/g)) {
    const attrs = m[1];
    const variant = attrs.match(/\bvariant=(\{[^}]*\}|"[^"]*"|'[^']*')/);
    if (variant && STATUS_WORD.test(variant[1])) {
      out.push({ kind: "variant", line: lineOf(text, m.index), text: variant[0].replace(/\s+/g, " ") });
    }
    const tone = attrs.match(/\btone=(?:"([^"]*)"|\{\s*["']([^"']*)["']\s*\})/);
    if (tone) out.push({ kind: "tone", line: lineOf(text, m.index), text: tone[0] });
  }
  for (const m of text.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
    const v = m[1] ?? m[2] ?? "";
    if (/\brounded-full\b/.test(v) && /\bpx-/.test(v) && STATUS_TINT.test(v) && STATUS_TEXT.test(v)) {
      out.push({ kind: "pill", line: lineOf(text, m.index), text: v.replace(/\s+/g, " ").slice(0, 120) });
    }
  }
  return out;
};

const files = (): string[] => {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== "__tests__") walk(p);
      } else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.|\.d\.ts$/.test(e.name)) {
        out.push(p);
      }
    }
  };
  for (const r of ROOTS) walk(path.join(SRC, r));
  return out;
};

const rel = (abs: string) => path.relative(SRC, abs).split(path.sep).join("/");

describe("status chips go through the status-tone registry (ADR-122 §6)", () => {
  const all = files();

  it("scans app/** and components/**", () => {
    expect(all.length).toBeGreaterThan(350);
  });

  it("no colour-only status chip, no literal tone, no hand-made status pill", () => {
    const found: string[] = [];
    for (const f of all) {
      const r = rel(f);
      if (OWNERS.has(r)) continue;
      for (const x of scanStatusChips(fs.readFileSync(f, "utf8"))) found.push(`${r}:${x.line} ${x.kind} ${x.text}`);
    }
    expect(found).toEqual([]);
  });
});

describe("status chip guard: each form is caught (fixture)", () => {
  it.each([
    ["variant", `<Badge variant="success">Active</Badge>`],
    ["variant", `<Badge size="sm" variant={value ? "success" : "default"}>x</Badge>`],
    ["variant", `<Badge\n  variant={\n    high ? "danger" : "warning"\n  }\n>`],
    ["tone", `<Badge tone="alarm">Overdue</Badge>`],
    ["tone", `<Badge size="sm" tone={"attention"}>3</Badge>`],
    ["pill", `<span className="rounded-full px-2 py-0.5 bg-destructive/10 text-destructive">3</span>`],
    ["pill", "<span className={`text-xs rounded-full px-2 ${over ? \"bg-warning/10 text-warning\" : \"bg-muted\"}`}>"],
  ])("%s: %s", (kind, sample) => {
    expect(scanStatusChips(sample).map((f) => f.kind)).toContain(kind);
  });

  it.each([
    `<Badge variant="secondary">Level 2</Badge>`,
    `<Badge variant="info" size="sm">override</Badge>`,
    `<Badge tone={toneOf("post", p.status)} size="sm">x</Badge>`,
    `<StatusBadge domain="device" state={d.status} />`,
    `<Button variant="danger">Delete</Button>`,
    `<Alert variant="warning">Careful</Alert>`,
    `<div className="w-11 h-11 rounded-full bg-destructive/10 text-destructive">icon</div>`,
    `<span className="rounded-full px-2 bg-muted text-muted-foreground">3</span>`,
  ])("allowed: %s", (sample) => {
    expect(scanStatusChips(sample)).toEqual([]);
  });
});
