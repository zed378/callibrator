/**
 * A-07 / P9-19 — `SEEDED_MENU_SLUGS` (the type `dynamicAccess` takes) is the
 * seed, exactly.
 *
 * The list is written out as literals so TypeScript can type a gate's resource
 * with it; this suite is what keeps the literals honest. It reads the seed with
 * the A-58 boot check's own reader (`authorizationWiring#seededMenuSlugs`, over
 * `utils/seedMenuGroups.util.js`), so a slug added to or removed from the seed
 * without the same change here fails the build — in either direction.
 * `MENU_SLUGS` must sit inside it (it is a known subset, A-311).
 */
import { SEEDED_MENU_SLUGS } from "../../constants/seededMenuSlugs";
import { MENU_SLUGS } from "../../constants/roleConstants";
import { seededMenuSlugs } from "../../utils/authorizationWiring.util";

describe("SEEDED_MENU_SLUGS — the literal list is the seed (A-07, P9-19)", () => {
  it("equals the slugs the seed source creates, with no duplicate", () => {
    expect([...SEEDED_MENU_SLUGS].sort()).toEqual([...seededMenuSlugs()].sort());
    expect(new Set(SEEDED_MENU_SLUGS).size).toBe(SEEDED_MENU_SLUGS.length);
  });

  it("holds every MENU_SLUGS value", () => {
    const seeded: readonly string[] = SEEDED_MENU_SLUGS;
    const missing = Object.values(MENU_SLUGS).filter((slug) => !seeded.includes(slug));
    expect(missing).toEqual([]);
  });
});
