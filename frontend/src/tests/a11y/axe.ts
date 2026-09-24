/**
 * F-12: axe-core in the component suite. `axe` runs against the rendered DOM
 * (jsdom) and the helper fails with the rule ids and the offending markup, so
 * a failure says what to fix.
 *
 * jsdom has no layout, so rules that need rendering (colour contrast) are
 * off here — they belong to the browser suite.
 */
import axe from "axe-core";

export async function axeViolations(root: Element): Promise<string[]> {
  const result = await axe.run(root, {
    rules: {
      "color-contrast": { enabled: false },
      // A component rendered on its own has no page landmarks or <h1>.
      region: { enabled: false },
      "page-has-heading-one": { enabled: false },
      "landmark-one-main": { enabled: false },
    },
  });
  return result.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.html).join(" | ")}`,
  );
}
