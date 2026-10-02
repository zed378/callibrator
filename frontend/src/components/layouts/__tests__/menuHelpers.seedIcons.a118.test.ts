/**
 * A-118 — every icon the backend seeds for a menu group renders in the sidebar.
 *
 * The sidebar is built from the backend's menu groups; each carries an icon
 * NAME, which menuHelpers maps to a component. A name missing from the map
 * falls back to a generic icon silently. The AI Assistant entry added a new
 * one (`Sparkles`), so this reads the seed's source — the data, not this
 * workspace's copy of it — and checks every name against the map it renders
 * from.
 */
import fs from "fs";
import path from "path";
import { iconMap, smallIconMap } from "../menuHelpers";

// The seed is TypeScript since P9-21 (seedMenuGroups.util.ts); read whichever
// extension exists, so this keeps reading the data across the conversion.
const SEED_BASE = path.join(__dirname, "../../../../../backend/src/utils/seedMenuGroups.util");
const SEED = fs.readFileSync(
  fs.existsSync(`${SEED_BASE}.ts`) ? `${SEED_BASE}.ts` : `${SEED_BASE}.js`,
  "utf8",
);

// Each seeded group is a flat `{ name, slug, icon, …, parentSlug? }` literal.
// A top-level group renders from iconMap; a child (it has a parentSlug) from
// smallIconMap (menuHelpers#convertBackendMenuToFrontend).
const entries = [...SEED.matchAll(/\{([^{}]*\bicon:\s*"([A-Za-z0-9]+)"[^{}]*)\}/g)].map((m) => ({
  icon: m[2],
  child: /\bparentSlug:/.test(m[1]),
}));
const topLevelIcons = [...new Set(entries.filter((e) => !e.child).map((e) => e.icon))];
const childIcons = [...new Set(entries.filter((e) => e.child).map((e) => e.icon))];

describe("A-118 — seeded menu icons are mapped", () => {
  it("the seed was read (a scan that finds nothing has not passed)", () => {
    expect(topLevelIcons.length).toBeGreaterThan(3);
    expect(childIcons.length).toBeGreaterThan(20);
    expect(childIcons).toContain("Sparkles");
  });

  it.each(topLevelIcons)("top-level icon %s is in iconMap", (icon) => {
    expect(iconMap[icon]).toBeDefined();
  });

  it.each(childIcons)("child icon %s is in smallIconMap", (icon) => {
    expect(smallIconMap[icon]).toBeDefined();
  });

  it("the AI Assistant entry is seeded with the icon it maps to", () => {
    expect(SEED).toMatch(/name: "AI Assistant",\s*slug: "ai-assistant",\s*icon: "Sparkles"/);
  });
});
