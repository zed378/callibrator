/**
 * Authorization wiring assertion — ADR-043 step 5.
 *
 * WHY THIS EXISTS
 *
 * `workflows.route.js` gated five routes on `dynamicAccess("workflow", …)`.
 * The seeded menu group — and `MENU_SLUGS` — say `workflows`. A menu name that
 * matches no menu group matches nothing in the permission matrix, so those five
 * routes granted nobody but SUPERADMIN, silently, for as long as they existed
 * (A-58). Nobody saw a misconfiguration; they saw a 403 and read it as a
 * permission decision. One character.
 *
 * A-80 added a fourth: a `ROLE_MENU_ASSIGNMENTS` key that is not a seeded
 * slug (`profile` for the seeded `profile-page`) — the seed skips it, so the
 * grant never exists for any role that lists it.
 *
 * The same shape has two siblings, both of which fail just as quietly:
 * a `ROLE_NAMES` entry with no `ROLE_LEVELS` entry (every level-comparing gate
 * refuses it), and a `roles` table whose `role_level` disagrees with the
 * constant the code compares against (ADR-043 §1 — every seeded role was
 * level 1 while `ROLE_LEVELS` said otherwise).
 *
 * ADR-043: "the defect is unvalidated authorization data, in whichever
 * mechanism holds it." So this module validates the data at boot and REFUSES TO
 * START, naming the offender, rather than letting the deployment answer 403 and
 * leave someone to guess why. It follows `config/index.js` and `jwt.util.js`,
 * which already refuse to boot on bad configuration.
 *
 * -------------------------------------------------------------------------
 * DESIGN POINT 1 — how the `dynamicAccess` names are enumerated WITHOUT
 * executing the routers.
 *
 * The obvious enumeration is to require every route module and record what
 * `dynamicAccess` was called with. That is rejected for three reasons:
 *
 *   a. `dynamicAccess` returns a closure. Recovering its arguments would mean
 *      changing `dynamicAccess.middleware.js` to tag the middleware — the guard
 *      would then depend on the thing it is guarding.
 *   b. Requiring a router executes its controllers, services and models at
 *      whatever moment the check runs. At boot that is before the connection is
 *      verified; in a test it drags the whole application graph in. A check
 *      that can itself crash the boot is worse than no check.
 *   c. A router that throws on require would take the guard down with it, and
 *      the guard would never report the gate it was written to report.
 *
 * So the gates are read from the route SOURCE TEXT. The scanner finds each
 * `dynamicAccess(` call, extracts the first argument with a quote- and
 * bracket-aware scan, and resolves it against `MENU_SLUGS` — which is a pure
 * data module with no database, no environment and no side effects. Nothing
 * under `src/routes/` is ever required.
 *
 * What the scanner CANNOT resolve (a computed argument, e.g.
 * `dynamicAccess(SEARCH_MENUS, …)` where `SEARCH_MENUS` is built by a `.map()`)
 * is NOT silently skipped: it is reported by file, line and expression as an
 * unverified gate. A check that passes because it failed to parse is the
 * "generated from the code it tests" failure in a different costume.
 *
 * -------------------------------------------------------------------------
 * DESIGN POINT 2 — what happens when the database is not up.
 *
 * Two of the three checks (route gates, role levels) are static: they read
 * source text and constants, they never touch the database, and they are always
 * fatal. Boot runs them FIRST (`assertStaticAuthorizationWiring`, before
 * `Connection()` in `index.js`), so a gate typo refuses the boot and names
 * itself even when the database is down — and a database outage can never be
 * misreported as an authorization defect, because these checks cannot fail
 * for a database reason.
 *
 * The roles-table check (`assertSeededRoles`) runs only after `Connection()`,
 * `db.sync()` and `migrator.up()` have succeeded. If the database is down,
 * `Connection()` has already refused the boot for THAT reason, with its own
 * message, before this check exists.
 *
 * The third needs the `roles` table. It distinguishes two outcomes that a naive
 * check would conflate:
 *
 *   "the check ran and found a disagreement"  -> fatal, named, boot refused.
 *   "the check could not run"                 -> WARNING, boot continues.
 *
 * "Could not run" covers a query that throws (no connection, missing table,
 * permission denied) and a `roles` table holding none of the seeded roles — a
 * fresh database that has not been seeded yet. Seeding is a manual call to
 * `GET /api/v1/migration/seeding`, so refusing to boot an unseeded database
 * would deadlock the install: you could never reach the endpoint that fixes it.
 *
 * The same rule covers the source scan: if the route sources cannot be read at
 * all (a packaged binary whose snapshot does not expose them), that is a
 * warning naming the reason, not a crash. The build then boots with the gate
 * check unperformed and says so, out loud, instead of dying for a reason that
 * has nothing to do with authorization.
 *
 * -------------------------------------------------------------------------
 * DESIGN POINT 3 — what "the roles table disagrees with the constants" means.
 *
 *   FATAL   a row whose name matches a constant role but whose `role_level`
 *           differs from `ROLE_LEVELS`. This is ADR-043 §1 exactly: `rbac()`
 *           decides by `role_level`, so a row that disagrees with the constant
 *           silently decides differently from the code that reads it.
 *   FATAL   a constant role with NO row, when other constant roles do have
 *           rows. The seed creates all of them together and they are
 *           `isSystem: true` (soft-delete refuses them), so a missing subset is
 *           a genuinely inconsistent database, and any gate naming that role
 *           can never match.
 *   SKIP    none of the constant roles present — not seeded yet (above).
 *   IGNORED extra rows. Tenants create their own roles; the constants are a
 *           floor, not an inventory.
 *
 * Which names are expected to be rows comes from `ROLE_IDS`, not `ROLE_NAMES`:
 * `ROLE_NAMES.TENANT_ADMIN` is a logical authorization tier, deliberately not a
 * seeded role, and `ROLE_IDS` is the list the seed actually inserts.
 *
 * The `roles` query is raw SQL and carries no tenant predicate — deliberately.
 * Roles are global (`role.model.js` has no `tenantId`), so there is no tenant
 * column to predicate on; the rows this reads are the same for every tenant.
 */

// P9-09 (ADR-087 Amendment 6): converted from authorizationWiring.util.js with
// no behaviour change. Everything the .js destructured at load is captured at
// load; `fs` and `path` are the module objects themselves. The seed is still
// read from `seedMenuGroups.util.js`, exactly as built; it must learn `.ts`
// before the seed converts.
//
// P9-21: the route scan learned `.ts` when the first routes converted. It walks
// every route SOURCE (`.js` or `.ts`; not a `.d.ts`, not a `*.openapi.ts`
// contract), and it reads the call as TypeScript 7 emits it into `dist/`
// (`(0, x.dynamicAccess)(...)`) as well as as written. Before this, a converted
// route's gates were invisible to this boot check in both places.
import fs from "fs";
import path from "path";
import { logger as activityLogger } from "../middlewares/activityLog.middleware";
import { sql } from "./sql.util";
import {
  MENU_SLUGS as CONSTANT_MENU_SLUGS,
  ROLE_NAMES as CONSTANT_ROLE_NAMES,
  ROLE_IDS as CONSTANT_ROLE_IDS,
  ROLE_LEVELS as CONSTANT_ROLE_LEVELS,
  ROLE_MENU_ASSIGNMENTS as CONSTANT_ROLE_MENU_ASSIGNMENTS,
} from "../constants";

const logger = activityLogger;
// Widened views of the constants: this module looks names up by arbitrary key.
const MENU_SLUGS: Readonly<Record<string, string | undefined>> = CONSTANT_MENU_SLUGS;
const ROLE_NAMES: Readonly<Record<string, string>> = CONSTANT_ROLE_NAMES;
const ROLE_IDS: Readonly<Record<string, string>> = CONSTANT_ROLE_IDS;
const ROLE_LEVELS: Readonly<Record<string, number | undefined>> = CONSTANT_ROLE_LEVELS;
const ROLE_MENU_ASSIGNMENTS: readonly MenuAssignment[] = CONSTANT_ROLE_MENU_ASSIGNMENTS;

/** One `dynamicAccess(...)` call found in a route file. */
export interface RouteGate {
  file: string;
  line: number;
  expression: string;
  names: string[] | null;
  requireAll: boolean;
}

/** A role's default menu grants, as the check reads them. */
interface MenuAssignment {
  roleName: string;
  menus: Readonly<Record<string, unknown>>;
}

/** The logger surface the checks use. */
interface CheckLogger {
  info(message: string): unknown;
  warn(message: string): unknown;
  error(message: string): unknown;
}

/** A database handle, as far as the roles check uses it. */
interface RolesQuery {
  query(sql: string, options: { type: string }): Promise<unknown>;
}

/** Findings of the gate check. */
interface Findings {
  errors: string[];
  warnings: string[];
}

/** The `.message` of whatever was thrown, as the .js interpolated it. */
const messageOf = (err: unknown): unknown => (err as { message?: unknown }).message;

const ROUTES_DIR = path.join(__dirname, "..", "routes");
// P9-21: the seed is `seedMenuGroups.util.ts` in src/ (run through tsx) and the
// compiled `seedMenuGroups.util.js` in dist/ — whichever this tree has (tsc keeps
// `const menuData = [` and the comments, so both parse the same).
const SEED_FILE = path.join(
  __dirname,
  fs.existsSync(path.join(__dirname, "seedMenuGroups.util.ts")) ? "seedMenuGroups.util.ts" : "seedMenuGroups.util.js",
);

// ---------------------------------------------------------------------------
// Source text helpers. None of these require anything from src/routes.
// ---------------------------------------------------------------------------

/**
 * Blank out comments while preserving line numbers, so a `dynamicAccess(` in a
 * swagger block or a commented-out route is never mistaken for a live gate and
 * the reported line still points at the real one.
 *
 * @param {string} source - JavaScript source text
 * @returns {string} the source with comment content replaced by blanks
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "))
    .split("\n")
    .map((line) => (/^\s*\/\//.test(line) ? "" : line))
    .join("\n");
}

/**
 * Read the text between a bracket at `open` and its match, quote-aware.
 *
 * @param {string} source - source text
 * @param {number} open - index of the opening bracket
 * @returns {string|null} the inner text, or null if the bracket never closes
 */
function readBracketed(source: string, open: number): string | null {
  let depth = 0;
  let quote: string | null = null;
  let out = "";

  for (let i = open; i < source.length; i++) {
    // The loop is bounded by the length, so the character exists.
    const ch = source[i] as string;

    if (quote !== null) {
      if (ch === "\\") {
        // As built: past the end, the next character reads as undefined.
        out += ch + (source[i + 1] as string);
        i++;
        continue;
      }
      out += ch;
      if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      out += ch;
      continue;
    }

    if (ch === "(" || ch === "[" || ch === "{") {
      depth++;
      if (depth === 1) {
        continue;
      }
    }

    if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) {
        return out;
      }
    }

    out += ch;
  }

  return null;
}

/**
 * Split an argument list at its top-level commas, quote- and bracket-aware.
 *
 * @param {string} text - the text between a call's parentheses
 * @returns {string[]} the argument expressions, in order
 */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = "";

  for (let i = 0; i < text.length; i++) {
    // The loop is bounded by the length, so the character exists.
    const ch = text[i] as string;

    if (quote !== null) {
      if (ch === "\\") {
        current += ch + (text[i + 1] as string);
        i++;
        continue;
      }
      current += ch;
      if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      current += ch;
      continue;
    }

    if (ch === "(" || ch === "[" || ch === "{") {
      depth++;
    }
    if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
    }

    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }

    current += ch;
  }

  parts.push(current);
  return parts.filter((part) => part.trim() !== "");
}

/**
 * Resolve a `dynamicAccess` first argument to the menu names it denotes.
 *
 * Handles a string literal, an array of them, `MENU_SLUGS.KEY`, and a bare
 * identifier declared `const X = <one of the above>` in the same file. An
 * undefined `MENU_SLUGS` key resolves to a marker name rather than to
 * "unresolvable", because `dynamicAccess(undefined, …)` is a live lockout of
 * exactly the A-58 shape and must be fatal, not merely unverified.
 *
 * @param {string} expression - the argument source text
 * @param {string} source - the file the expression came from
 * @param {number} depth - remaining identifier-resolution steps
 * @returns {string[]|null} the names, or null if the expression is computed
 */
function resolveNames(expression: string, source: string, depth: number): string[] | null {
  const text = expression.trim();

  // A template literal counts only when it interpolates nothing; `${…}` is
  // computed and falls through to "unverified".
  const literal =
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/prefer-regexp-exec -- as built: match(), and || over nulls
    text.match(/^"([^"]*)"$/) || text.match(/^'([^']*)'$/) || text.match(/^`([^`$]*)`$/);
  if (literal) {
    return [literal[1] as string];
  }

  if (text.startsWith("[") && text.endsWith("]")) {
    const names: string[] = [];
    for (const element of splitTopLevel(text.slice(1, -1))) {
      const resolved = resolveNames(element, source, depth);
      if (resolved === null) {
        return null;
      }
      names.push(...resolved);
    }
    return names;
  }

  // As written (`MENU_SLUGS.QMS`), or as TypeScript emits an imported binding
  // into dist/ (`constants_1.MENU_SLUGS.QMS`, P9-21).
  // eslint-disable-next-line @typescript-eslint/prefer-regexp-exec -- as built
  const menuSlug = text.match(/^(?:[A-Za-z_$][A-Za-z0-9_$]*_\d+\.)?MENU_SLUGS\.([A-Za-z0-9_]+)$/);
  if (menuSlug) {
    const key = menuSlug[1] as string;
    const value = MENU_SLUGS[key];
    // As built: only `undefined` falls back (a null value from a mocked barrel is kept).
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built
    return [value === undefined ? `MENU_SLUGS.${key} (undefined)` : value];
  }

  if (depth > 0 && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(text)) {
    // eslint-disable-next-line @typescript-eslint/prefer-regexp-exec -- as built
    const declaration = source.match(
      new RegExp(`\\bconst\\s+${text}\\s*=\\s*([\\s\\S]*?);`),
    );
    if (declaration) {
      return resolveNames(declaration[1] as string, source, depth - 1);
    }
  }

  return null;
}

/**
 * Find every `dynamicAccess(...)` gate in one file's source.
 *
 * @param {string} source - the route file's source text
 * @param {string} file - a label used in findings (a repo-relative path)
 * @returns {Array<object>} one record per gate: file, line, expression, names,
 *   requireAll
 */
function parseGates(source: string, file: string): RouteGate[] {
  const clean = stripComments(source);
  const gates: RouteGate[] = [];
  // As written (`dynamicAccess(`), or as TypeScript emits an imported call into
  // dist/ (`(0, dynamicAccess_middleware_1.dynamicAccess)(`, P9-21).
  const call = /(?:\bdynamicAccess|\.dynamicAccess\))\s*\(/g;
  let match;

  while ((match = call.exec(clean)) !== null) {
    const open = clean.indexOf("(", match.index);
    const inner = readBracketed(clean, open);
    const line = clean.slice(0, match.index).split("\n").length;

    if (inner === null) {
      gates.push({
        file,
        line,
        expression: clean.slice(match.index, match.index + 60),
        names: null,
        requireAll: false,
      });
      continue;
    }

    const args = splitTopLevel(inner);
    // As built: an empty argument list reads args[0] and throws here.
    const expression = (args[0] as string).trim();

    gates.push({
      file,
      line,
      expression,
      names: resolveNames(expression, clean, 1),
      requireAll: /requireAll\s*:\s*true/.test(args.slice(2).join(",")),
    });
  }

  return gates;
}

/**
 * Whether a file under src/routes is a route SOURCE: `.js`, or `.ts` that is
 * neither a declaration (`.d.ts`) nor a route module's contract (`*.openapi.ts`,
 * P9-25), which holds no gate.
 *
 * @param {string} name - a file name
 * @returns {boolean} whether its gates are scanned
 */
const isRouteSource = (name: string): boolean =>
  name.endsWith(".js") || (name.endsWith(".ts") && !name.endsWith(".d.ts") && !name.endsWith(".openapi.ts"));

/**
 * List every route source file under a directory, recursively.
 *
 * @param {string} dir - directory to walk
 * @returns {string[]} absolute file paths
 */
function listJsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listJsFiles(full));
    } else if (isRouteSource(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Collect every route gate by reading `src/routes` from disk.
 *
 * @param {string} [dir] - route directory (injectable for tests)
 * @returns {Array<object>} gate records
 */
function collectRouteGates(dir = ROUTES_DIR): RouteGate[] {
  const gates: RouteGate[] = [];
  for (const file of listJsFiles(dir)) {
    const source = fs.readFileSync(file, "utf8");
    gates.push(...parseGates(source, path.relative(path.join(__dirname, "..", ".."), file)));
  }
  return gates;
}

/**
 * The menu vocabulary the seed actually creates.
 *
 * The permission matrix is keyed by menu NAME and menu SLUG
 * (`roles.service.js#getRolePermissionsMatrix`), so a gate may legitimately
 * name either. Both go into the vocabulary.
 *
 * @param {string} [source] - seed file source (injectable for tests)
 * @returns {Set<string>} every seeded menu name and slug
 */
function seededMenuVocabulary(source = fs.readFileSync(SEED_FILE, "utf8")): Set<string> {
  const inner = seededMenuDataText(source);
  const vocabulary = new Set<string>();

  for (const m of inner.matchAll(/(?:^|[\s,{])name:\s*"([^"]+)"/g)) {
    vocabulary.add(m[1] as string);
  }
  for (const slug of seededMenuSlugs(source)) {
    vocabulary.add(slug);
  }

  return vocabulary;
}

/**
 * The text of the seed's `menuData` array, comments blanked.
 *
 * @param {string} source - seed file source
 * @returns {string} the inner text of `const menuData = [ … ]`
 * @throws {Error} when the seed no longer has that shape
 */
function seededMenuDataText(source: string): string {
  const clean = stripComments(source);
  const start = clean.indexOf("const menuData = [");

  if (start === -1) {
    throw new Error(
      "authorizationWiring: could not find `const menuData = [` in seedMenuGroups.util.js — " +
        "the seed changed shape and this guard must be updated, not deleted",
    );
  }

  // As built: an unclosed bracket returns null, and the caller's matchAll throws on it.
  return readBracketed(clean, clean.indexOf("[", start)) as string;
}

/**
 * The menu SLUGS the seed creates — slugs only, not names.
 *
 * A gate may name a menu by name or slug (the matrix is keyed by both), but
 * the seed resolves a `ROLE_MENU_ASSIGNMENTS` key with
 * `MenuGroup.findOne({ where: { slug } })`, so an assignment must be a slug.
 *
 * @param {string} [source] - seed file source (injectable for tests)
 * @returns {Set<string>} every seeded menu slug
 */
function seededMenuSlugs(source = fs.readFileSync(SEED_FILE, "utf8")): Set<string> {
  const inner = seededMenuDataText(source);
  const slugs = new Set<string>();
  for (const m of inner.matchAll(/(?:^|[\s,{])slug:\s*"([^"]+)"/g)) {
    slugs.add(m[1] as string);
  }
  return slugs;
}

// ---------------------------------------------------------------------------
// The three checks
// ---------------------------------------------------------------------------

/**
 * Check every route gate against the seeded menu vocabulary.
 *
 * A gate is FATAL when it can never be satisfied by any seeded menu group:
 * with the default OR semantics that means no name matches; with
 * `requireAll: true` it means any name fails to match. A dead alias inside a
 * still-satisfiable OR gate is a WARNING — `audit.route.ts` deliberately lists
 * `"AuditLogs"` alongside the real name and slug, and refusing to boot over
 * that would make this guard cry wolf on its first day.
 *
 * @param {Array<object>} gates - gate records from collectRouteGates
 * @param {Set<string>} vocabulary - seeded menu names and slugs
 * @returns {{errors: string[], warnings: string[]}} findings
 */
function checkRouteGates(gates: readonly RouteGate[], vocabulary: ReadonlySet<string>): Findings {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const gate of gates) {
    const at = `${gate.file}:${String(gate.line)}`;

    if (gate.names === null) {
      warnings.push(
        `${at} dynamicAccess(${gate.expression}, …) is computed — this guard could not verify it; ` +
          "if it names a menu group that is not seeded, it grants nobody but SUPERADMIN and nothing will say so",
      );
      continue;
    }

    const unmatched = gate.names.filter((name) => !vocabulary.has(name));
    const matched = gate.names.filter((name) => vocabulary.has(name));

    if (gate.requireAll && unmatched.length > 0) {
      errors.push(
        `${at} dynamicAccess([${gate.names.join(", ")}], …, { requireAll: true }) requires ` +
          `${unmatched.map((n) => `"${n}"`).join(", ")}, which no seeded menu group provides — ` +
          "the gate can never be satisfied and grants nobody but SUPERADMIN",
      );
      continue;
    }

    if (matched.length === 0) {
      errors.push(
        `${at} dynamicAccess(${unmatched.map((n) => `"${n}"`).join(", ")}, …) matches no seeded ` +
          "menu group name or slug — the gate grants nobody but SUPERADMIN, silently (A-58)",
      );
      continue;
    }

    if (unmatched.length > 0) {
      warnings.push(
        `${at} dynamicAccess names ${unmatched.map((n) => `"${n}"`).join(", ")}, which no seeded ` +
          `menu group provides; the gate still resolves through ${matched.map((n) => `"${n}"`).join(", ")}`,
      );
    }
  }

  return { errors, warnings };
}

/**
 * Check that every `ROLE_NAMES` key has a usable `ROLE_LEVELS` entry.
 *
 * The trap, from the other end: `rbac.middleware.js` decides by level, and a
 * role with no level compares against `undefined`, which fails every privileged
 * gate without saying anything.
 *
 * @param {object} [roleNames] - role name map (injectable for tests)
 * @param {object} [roleLevels] - role level map (injectable for tests)
 * @returns {string[]} findings
 */
function checkRoleLevels(
  roleNames: Readonly<Record<string, string>> = ROLE_NAMES,
  roleLevels: Readonly<Record<string, unknown>> = ROLE_LEVELS,
): string[] {
  const errors: string[] = [];

  for (const key of Object.keys(roleNames)) {
    if (!Number.isFinite(roleLevels[key])) {
      errors.push(
        `ROLE_NAMES.${key} ("${roleNames[key] as string}") has no usable ROLE_LEVELS entry ` +
          `(got: ${String(roleLevels[key])}) — every gate that compares role levels refuses it, silently`,
      );
    }
  }

  return errors;
}

/**
 * Check the `roles` table against the role constants. See DESIGN POINT 3.
 *
 * @param {object|null} sequelize - a connected Sequelize instance, or null
 * @returns {Promise<{errors: string[], skipped: string|null}>} findings, or the
 *   reason the check could not run
 */
async function checkSeededRoles(sequelize: RolesQuery | null | undefined): Promise<{ errors: string[]; skipped: string | null }> {
  if (!sequelize) {
    return { errors: [], skipped: "no database handle was passed to the check" };
  }

  let rows: { name: string; role_level: unknown }[];
  try {
    // P9-07: through the bind-only helper — the same query() call ({ type: "SELECT" }).
    rows = await sql<{ name: string; role_level: unknown }>(
      sequelize,
      "SELECT name, role_level FROM roles WHERE is_deleted = false AND deleted_at IS NULL",
    );
  } catch (err: unknown) {
    return {
      errors: [],
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- as built
      skipped: `the roles table could not be read (${messageOf(err)}) — the role constants were NOT verified against the database`,
    };
  }

  const levelByName = new Map(rows.map((row) => [row.name, row.role_level]));
  const seededKeys = Object.keys(ROLE_IDS);
  const present = seededKeys.filter((key) => levelByName.has(ROLE_NAMES[key] as string));

  if (present.length === 0) {
    return {
      errors: [],
      skipped:
        "the roles table holds none of the seeded roles — the database has not been seeded yet " +
        "(GET /api/v1/migration/seeding); the role constants were NOT verified against the database",
    };
  }

  const errors: string[] = [];

  for (const key of seededKeys) {
    const name = ROLE_NAMES[key] as string;

    if (!levelByName.has(name)) {
      errors.push(
        `the roles table has no row named "${name}" (ROLE_IDS.${key}) while it does hold other ` +
          "seeded roles — every gate naming that role can never match",
      );
      continue;
    }

    const actual = Number(levelByName.get(name));
    if (actual !== ROLE_LEVELS[key]) {
      errors.push(
        `roles."${name}".role_level is ${String(actual)}, ROLE_LEVELS.${key} is ${String(ROLE_LEVELS[key])} — ` +
          "rbac() decides by the column, so the database silently decides differently from the code (ADR-043 §1)",
      );
    }
  }

  return { errors, skipped: null };
}

/**
 * A-80. Check every `ROLE_MENU_ASSIGNMENTS` key against the slugs the seed
 * creates.
 *
 * The seed (`migration.service.js#seedMenuGroupsAndItems`) looks each key up by
 * slug and, on a miss, logs "Menu group not found" and SKIPS it. So a key that
 * is not a seeded slug is a grant that silently never exists — for every role
 * that lists it. `profile` (the seed says `profile-page`) was exactly that, on
 * all eleven roles, and nothing said so.
 *
 * @param {Array<{roleName: string, menus: Object<string, string>}>} [assignments]
 *   the assignment table (injectable for tests)
 * @param {Set<string>} [slugs] - seeded menu slugs (injectable for tests)
 * @returns {string[]} findings, one per role and slug
 */
function checkRoleMenuAssignments(
  assignments: readonly MenuAssignment[] = ROLE_MENU_ASSIGNMENTS,
  slugs: ReadonlySet<string> = seededMenuSlugs(),
): string[] {
  const errors: string[] = [];

  for (const assignment of assignments) {
    for (const slug of Object.keys(assignment.menus)) {
      if (!slugs.has(slug)) {
        errors.push(
          `ROLE_MENU_ASSIGNMENTS["${assignment.roleName}"] grants "${slug}", which is not the slug of ` +
            "any seeded menu group — the seed skips it and the role never receives that grant, silently (A-80)",
        );
      }
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/**
 * Log every error, then throw one Error naming all of them. The throw is what
 * refuses the boot; the message is what the operator reads.
 *
 * @param {string[]} errors - findings
 * @param {object} log - logger
 */
function refuse(errors: readonly string[], log: CheckLogger): never {
  const message =
    `AUTHZ_WIRING_FAILURE: refusing to start — ${String(errors.length)} authorization wiring defect(s):\n` +
    errors.map((e) => `  - ${e}`).join("\n");
  log.error(message);
  throw new Error(message);
}

/**
 * Phase 1 — the checks that need NO database: every route gate against the
 * seeded menu vocabulary, every ROLE_MENU_ASSIGNMENTS key against the seeded
 * menu slugs (A-80), and every role name against `ROLE_LEVELS`.
 *
 * Synchronous and database-free on purpose, so boot can run it BEFORE the
 * connection is attempted: a gate typo then refuses the boot for that reason
 * and names itself, whether or not the database is reachable.
 *
 * @param {object} [options] - options
 * @param {object} [options.log] - logger (injectable for tests)
 * @param {Function} [options.collect] - gate collector (injectable for tests)
 * @param {Function} [options.vocabulary] - vocabulary loader (injectable for tests)
 * @param {Array<object>} [options.assignments] - ROLE_MENU_ASSIGNMENTS (injectable for tests)
 * @param {Function} [options.slugs] - seeded-slug loader (injectable for tests)
 * @returns {{gates: number, warnings: string[]}} what was checked
 * @throws {Error} AUTHZ_WIRING_FAILURE when any gate, assignment or role level is broken
 */
function assertStaticAuthorizationWiring({
  log = logger,
  collect = collectRouteGates,
  vocabulary = seededMenuVocabulary,
  assignments = ROLE_MENU_ASSIGNMENTS,
  slugs = seededMenuSlugs,
}: {
  log?: CheckLogger;
  collect?: () => RouteGate[];
  vocabulary?: () => Set<string>;
  assignments?: readonly MenuAssignment[];
  slugs?: () => Set<string>;
} = {}): { gates: number; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  let gates: RouteGate[] = [];

  try {
    gates = collect();
    const gateFindings = checkRouteGates(gates, vocabulary());
    errors.push(...gateFindings.errors);
    warnings.push(...gateFindings.warnings);
    if (gates.length === 0) {
      // A scan that finds nothing is not a scan that passed. A build whose
      // sources read back empty (bytecode-only snapshot) lands here, and must
      // say so rather than log "0 gates validated" as though that were good.
      warnings.push(
        "the route sources were scanned but no dynamicAccess gate was found — no gate was verified in this build",
      );
    }
  } catch (err: unknown) {
    // The sources could not be read (a packaged snapshot, a moved directory).
    // The gates are then unchecked — which is said out loud, not crashed over.
    warnings.push(
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- as built
      `the route sources could not be scanned (${messageOf(err)}) — no dynamicAccess gate was verified in this build`,
    );
  }

  // A-80: every role-menu assignment must name a slug the seed creates. Its
  // own try: an unreadable seed file is "not verified", said out loud, exactly
  // as for the route scan above.
  try {
    errors.push(...checkRoleMenuAssignments(assignments, slugs()));
  } catch (err: unknown) {
    warnings.push(
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- as built
      `the menu seed could not be read (${messageOf(err)}) — ROLE_MENU_ASSIGNMENTS was not verified in this build`,
    );
  }

  errors.push(...checkRoleLevels());

  for (const warning of warnings) {
    log.warn(`AUTHZ_WIRING_WARNING: ${warning}`);
  }

  if (errors.length > 0) {
    refuse(errors, log);
  }

  log.info(
    `Authorization wiring validated: ${String(gates.length)} dynamicAccess gate(s), ` +
      `${String(assignments.length)} role-menu assignment(s), ` +
      `${String(Object.keys(ROLE_NAMES).length)} role name(s), ${String(warnings.length)} warning(s)`,
  );

  return { gates: gates.length, warnings };
}

/**
 * Phase 2 — the `roles` table against the role constants. Needs a connected,
 * MIGRATED database (migration 0020 backfills `role_level`; checking before it
 * runs would report every seeded role as level 1). See DESIGN POINT 2 for why
 * "could not run" warns and "found a disagreement" refuses.
 *
 * @param {object} [options] - options
 * @param {object|null} [options.sequelize] - connected Sequelize instance
 * @param {object} [options.log] - logger (injectable for tests)
 * @returns {Promise<{skipped: string|null}>} whether the check ran
 * @throws {Error} AUTHZ_WIRING_FAILURE when the table disagrees with the constants
 */
async function assertSeededRoles({
  sequelize = null,
  log = logger,
}: { sequelize?: RolesQuery | null; log?: CheckLogger } = {}): Promise<{ skipped: string | null }> {
  const roleFindings = await checkSeededRoles(sequelize);
  if (roleFindings.skipped !== null) {
    log.warn(`AUTHZ_WIRING_SKIPPED: ${roleFindings.skipped}`);
  }
  if (roleFindings.errors.length > 0) {
    refuse(roleFindings.errors, log);
  }
  if (roleFindings.skipped === null) {
    // Say that it RAN. A silent pass is indistinguishable from a check that was
    // never wired, which is the state this module sat in when it was found.
    log.info(
      `Authorization wiring validated: roles table agrees with ROLE_LEVELS for ${
        String(Object.keys(ROLE_IDS).length)
      } seeded role(s)`,
    );
  }
  return { skipped: roleFindings.skipped };
}

/**
 * Both phases in one call, for callers that already hold a migrated database.
 * Boot (`index.js`) calls the phases separately so the static one runs first.
 *
 * @param {object} [options] - options
 * @param {object|null} [options.sequelize] - connected Sequelize instance
 * @param {object} [options.log] - logger (injectable for tests)
 * @returns {Promise<{gates: number, warnings: string[], rolesSkipped: string|null}>}
 */
async function validateAuthorizationWiring({
  sequelize = null,
  log = logger,
}: { sequelize?: RolesQuery | null; log?: CheckLogger } = {}): Promise<{ gates: number; warnings: string[]; rolesSkipped: string | null }> {
  const { gates, warnings } = assertStaticAuthorizationWiring({ log });
  const { skipped } = await assertSeededRoles({ sequelize, log });
  return { gates, warnings, rolesSkipped: skipped };
}

export {
  assertStaticAuthorizationWiring,
  assertSeededRoles,
  validateAuthorizationWiring,
  collectRouteGates,
  seededMenuVocabulary,
  seededMenuSlugs,
  checkRoleMenuAssignments,
  checkRouteGates,
  checkRoleLevels,
  checkSeededRoles,
  parseGates,
  resolveNames,
  splitTopLevel,
  readBracketed,
  stripComments,
};
