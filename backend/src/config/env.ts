/**
 * The environment, read in ONE place (P9-06 part 1, ADR-087 Amendment 6).
 *
 * Outside `src/config/`, `process.env` is a lint error (docs/ENGINEERING/04,
 * `no-restricted-properties`). Converted modules read their variables through
 * these helpers instead, and each helper reproduces exactly the expression the
 * module used before:
 *
 *   env(name)             process.env[name]                    (unset: undefined)
 *   envOr(name, dflt)     process.env[name] || dflt            (unset OR "": dflt)
 *   isProduction()        process.env.NODE_ENV === "production"
 *
 * Every read happens at CALL time, never cached at load: tests (and the boot
 * sequence, after dotenv) set variables after this module is loaded, and a
 * module that read a variable at load still does so by calling the helper at
 * load. `envOr` keeps `||` on purpose — throughout this codebase an EMPTY
 * variable has always meant "use the default", which `??` would change.
 *
 * NOT here yet (P9-06 part 2): the single Zod schema over every variable in
 * .env.example that fails the boot listing every problem at once. That changes
 * behaviour (a boot that starts today would refuse), so it is its own change.
 */

/** The raw value of an environment variable, or `undefined` when it is unset. */
export const env = (name: string): string | undefined => process.env[name];

/**
 * The variable's value, or `fallback` when it is unset OR EMPTY — the
 * `process.env.X || fallback` idiom, in one place.
 */
export const envOr = (name: string, fallback: string): string =>
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- an empty variable means "use the default" (see the file header)
  process.env[name] || fallback;

/**
 * The environment object itself — for the modules whose functions take an
 * injectable `env = process.env` (tests pass their own). The same object, not
 * a copy: a variable set later is seen by every reader.
 */
export const environment = (): NodeJS.ProcessEnv => process.env;

/** `NODE_ENV === "production"`, read now. */
export const isProduction = (): boolean => process.env["NODE_ENV"] === "production";
