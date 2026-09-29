/**
 * P9-06 part 1 (ADR-087 Amendment 6): src/config/env reproduces, per helper,
 * the exact `process.env` expression the converted modules used before — and
 * reads at CALL time. The expected values are written out by hand from those
 * expressions, not derived from the helpers.
 */
import { env, envOr, environment, isProduction } from "../../config/env";

const VAR = "P9_06_ENV_PROBE";
// The live environment object (asserted below to BE process.env), so the test
// sets variables without a process.env read of its own.
const penv = environment();

describe("config/env (P9-06)", () => {
  const saved = { probe: penv[VAR], nodeEnv: penv["NODE_ENV"] };

  afterEach(() => {
    if (saved.probe === undefined) {
      Reflect.deleteProperty(penv, VAR);
    } else {
      penv[VAR] = saved.probe;
    }
    if (saved.nodeEnv === undefined) {
      Reflect.deleteProperty(penv, "NODE_ENV");
    } else {
      penv["NODE_ENV"] = saved.nodeEnv;
    }
  });

  it("env: undefined when unset, the raw string otherwise — including an EMPTY one", () => {
    Reflect.deleteProperty(penv, VAR);
    expect(env(VAR)).toBeUndefined();
    penv[VAR] = "";
    expect(env(VAR)).toBe("");
    penv[VAR] = "x";
    expect(env(VAR)).toBe("x");
  });

  it("envOr: the fallback when unset OR EMPTY (the `||` idiom), the value otherwise", () => {
    Reflect.deleteProperty(penv, VAR);
    expect(envOr(VAR, "dflt")).toBe("dflt");
    penv[VAR] = "";
    expect(envOr(VAR, "dflt")).toBe("dflt");
    penv[VAR] = "0";
    expect(envOr(VAR, "dflt")).toBe("0");
    penv[VAR] = "set";
    expect(envOr(VAR, "dflt")).toBe("set");
  });

  it("environment: the live process.env object, not a copy", () => {
    const e = environment();
    // Reflect.get: the process environment itself, read without the restricted property.
    expect(e).toBe(Reflect.get(process, "env"));
    penv[VAR] = "later";
    expect(e[VAR]).toBe("later");
  });

  it("isProduction: exactly NODE_ENV === 'production', read at call time", () => {
    penv["NODE_ENV"] = "production";
    expect(isProduction()).toBe(true);
    for (const v of ["", "development", "test", "Production", "production "]) {
      penv["NODE_ENV"] = v;
      expect(isProduction()).toBe(false);
    }
    Reflect.deleteProperty(penv, "NODE_ENV");
    expect(isProduction()).toBe(false);
  });
});
