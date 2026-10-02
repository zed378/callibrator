/**
 * P9-21 — authorizationWiring.util reads the menu seed's SOURCE TEXT
 * (`const menuData = [ … ]`). The seed is `seedMenuGroups.util.ts` in src/
 * (run through tsx and jest) and the compiled `seedMenuGroups.util.js` in dist/
 * (tsc keeps the declaration and its comments): the util reads whichever its
 * tree has. Both branches are pinned here, with `fs` stubbed.
 */
import path from "path";
import type * as Fs from "fs";
import type * as AuthorizationWiring from "../../utils/authorizationWiring.util";

type Wiring = typeof AuthorizationWiring;

/** The util, loaded with a stubbed `fs`; answers which file the seed read asked for. */
const loadWith = (hasTs: boolean): { read: () => string; asked: string[] } => {
  const asked: string[] = [];
  let wiring: Wiring | undefined;
  jest.isolateModules(() => {
    jest.doMock("fs", () => {
      const real = jest.requireActual<typeof Fs>("fs");
      return {
        ...real,
        existsSync: (file: string): boolean => (file.endsWith("seedMenuGroups.util.ts") ? hasTs : real.existsSync(file)),
        readFileSync: (file: string, encoding: BufferEncoding): string => {
          if (file.includes("seedMenuGroups.util")) {
            asked.push(path.basename(file));
            return "const menuData = [ { slug: \"home\" } ];";
          }
          return real.readFileSync(file, encoding);
        },
      };
    });
    wiring = jest.requireActual<Wiring>("../../utils/authorizationWiring.util");
  });
  return { read: () => [...(wiring as Wiring).seededMenuVocabulary()].join(","), asked };
};

afterEach(() => {
  jest.dontMock("fs");
});

describe("P9-21 — the menu seed the authorization wiring reads", () => {
  it("reads seedMenuGroups.util.ts where the source tree has it (src/, tsx, jest)", () => {
    const { read, asked } = loadWith(true);
    expect(read()).toContain("home");
    expect(asked).toEqual(["seedMenuGroups.util.ts"]);
  });

  it("reads the compiled seedMenuGroups.util.js where there is no .ts (dist/)", () => {
    const { read, asked } = loadWith(false);
    expect(read()).toContain("home");
    expect(asked).toEqual(["seedMenuGroups.util.js"]);
  });
});
