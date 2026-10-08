# 08 — `@callibrator/icons` — The Semantic Icon Map (TARGET)

> **Status: TARGET (ADR-134). Not built.** As built today: the web imports glyphs directly from
> `lucide-react` (`frontend/package.json`: `lucide-react ^1.48.0`) in each component; the five status
> tones have fixed icons (ADR-122 § 6, `frontend/src/lib/statusTone.ts`: `octagon-alert`,
> `triangle-alert`, `circle-check`, `circle-dashed`, `info`). Built by P35-03.

---

## 1. Purpose

A **name** for every icon that carries meaning — a status, an action, an entity — mapped to **one
glyph set**, so the web and the app show the same symbol for the same meaning. The package is
**data only**: it exports names and the glyph each maps to; it imports no icon library.

## 2. One Glyph Set: Lucide

**Decision (ADR-134 § A.9):** both platforms render **Lucide** glyphs — `lucide-react` on the web (as
built) and `lucide-react-native` (on `react-native-svg`) in the app. The two libraries share glyph
names, so the map has one target per name. "Native feel" is not traded away: platform-specific
*chrome* (the navigation bar's back chevron, the share icon, system menus) stays native and is not in
this map — only **meaning-bearing** icons are.

Alternatives: SF Symbols / Material Symbols per platform (native look, but two glyphs per meaning and
no Windows/web counterpart — a technician switching between the PWA and the app would see different
symbols for "overdue"); an icon font (accessibility and tree-shaking worse than SVG components).

## 3. The Map

```ts
// packages/icons/src/index.ts (target API)
export const ICONS = {
  // status tones (ADR-122 § 6) — fixed; changing one is an ADR-122 amendment
  "status.alarm": "octagon-alert",
  "status.attention": "triangle-alert",
  "status.current": "circle-check",
  "status.draft": "circle-dashed",
  "status.info": "info",
  // entities
  "entity.device": "stethoscope",
  "entity.facility": "hospital",
  "entity.room": "door-open",
  "entity.certificate": "file-badge",
  "entity.ipm": "clipboard-check",
  // actions
  "action.scan": "scan-qr-code",
  "action.photo": "camera",
  "action.sync": "refresh-cw",
  "action.sign": "signature",
  // sync states (05 § 6)
  "sync.offline": "cloud-off",
  "sync.pending": "cloud-upload",
  "sync.attention": "triangle-alert",
} as const satisfies Record<string, LucideGlyphName>;
export type IconName = keyof typeof ICONS;
```

The entity and action glyphs above are a **proposal**; P35-03 fixes them against what the web shows
today (the map adopts the as-built glyph for every meaning the web already has, so no screen changes).
`LucideGlyphName` is a string-literal type maintained by a script that reads the installed
`lucide-react` glyph list, so a misspelt or removed glyph fails the typecheck.

## 4. How Each Platform Renders

```tsx
// frontend/src/components/ui/Icon.tsx (web) — the only file that maps names to lucide-react components
// apps/mobile/src/ui/Icon.tsx (native)       — the only file that maps names to lucide-react-native components
<Icon name="status.alarm" label={t("status.calibrationDue.overdue")} />
```

- Each app has **one** `Icon` component that resolves a name to its library's component, importing
  only the glyphs in the map (tree-shaken), sized from `tokens` and coloured from the theme.
- **Accessibility:** an icon that carries meaning **alone** (an icon-only button) must have a label
  named after its object (ADR-090: "icon-only controls are named after their object"); an icon beside
  its text is decorative (`aria-hidden` / `accessible={false}`). The status tone always renders its
  text (`02` § 5).

## 5. Tests and Bad Implications

- Tests (100 %): every name maps to a glyph present in both libraries' published lists (the script's
  output for each); the five status icons equal ADR-122's.
- The web keeps direct `lucide-react` imports for decorative icons; only meaning-bearing icons go
  through the map — a reviewer decides which is which, and a guard only catches the five tones.
- A Lucide release that renames a glyph breaks both apps' typecheck at the same time — intended.
