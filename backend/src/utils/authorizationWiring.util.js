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
 * fatal.
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

const fs = require("fs");
const path = require("path");
const { QueryTypes } = require("sequelize");
const { logger } = require("../middlewares/activityLog.middleware");
const { MENU_SLUGS, ROLE_NAMES, ROLE_IDS, ROLE_LEVELS } = require("../constants");

const ROUTES_DIR = path.join(__dirname, "..", "routes");
const SEED_FILE = path.join(__dirname, "seedMenuGroups.util.js");

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
function stripComments(source) {
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
function readBracketed(source, open) {
  let depth = 0;
  let quote = null;
  let out = "";

  for (let i = open; i < source.length; i++) {
    const ch = source[i];

    if (quote !== null) {
      if (ch === "\\") {
        out += ch + source[i + 1];
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
function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let current = "";

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (quote !== null) {
      if (ch === "\\") {
        current += ch + text[i + 1];
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
function resolveNames(expression, source, depth) {
  const text = expression.trim();

  const literal = text.match(/^"([^"]*)"$/) || text.match(/^'([^']*)'$/);
  if (literal) {
    return [literal[1]];
  }

  if (text.startsWith("[") && text.endsWith("]")) {
    const names = [];
    for (const element of splitTopLevel(text.slice(1, -1))) {
      const resolved = resolveNames(element, source, depth);
      if (resolved === null) {
        return null;
      }
      names.push(...resolved);
    }
    return names;
  }

  const menuSlug = text.match(/^MENU_SLUGS\.([A-Za-z0-9_]+)$/);
  if (menuSlug) {
    const value = MENU_SLUGS[menuSlug[1]];
    return [value === undefined ? `MENU_SLUGS.${menuSlug[1]} (undefined)` : value];
  }

  if (depth > 0 && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(text)) {
    const declaration = source.match(
      new RegExp(`\\bconst\\s+${text}\\s*=\\s*([\\s\\S]*?);`),
    );
    if (declaration) {
      return resolveNames(declaration[1], source, depth - 1);
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
function parseGates(source, file) {
  const clean = stripComments(source);
  const gates = [];
  const call = /\bdynamicAccess\s*\(/g;
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
    const expression = args[0].trim();

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
 * List every .js file under a directory, recursively.
 *
 * @param {string} dir - directory to walk
 * @returns {string[]} absolute file paths
 */
function listJsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listJsFiles(full));
    } else if (entry.name.endsWith(".js")) {
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
function collectRouteGates(dir = ROUTES_DIR) {
  const gates = [];
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
function seededMenuVocabulary(source = fs.readFileSync(SEED_FILE, "utf8")) {
  const clean = stripComments(source);
  const start = clean.indexOf("const menuData = [");

  if (start === -1) {
    throw new Error(
      "authorizationWiring: could not find `const menuData = [` in seedMenuGroups.util.js — " +
        "the seed changed shape and this guard must be updated, not deleted",
    );
  }

  const inner = readBracketed(clean, clean.indexOf("[", start));
  const vocabulary = new Set();

  for (const m of inner.matchAll(/(?:^|[\s,{])name:\s*"([^"]+)"/g)) {
    vocabulary.add(m[1]);
  }
  for (const m of inner.matchAll(/(?:^|[\s,{])slug:\s*"([^"]+)"/g)) {
    vocabulary.add(m[1]);
  }

  return vocabulary;
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
 * still-satisfiable OR gate is a WARNING — `audit.route.js` deliberately lists
 * `"AuditLogs"` alongside the real name and slug, and refusing to boot over
 * that would make this guard cry wolf on its first day.
 *
 * @param {Array<object>} gates - gate records from collectRouteGates
 * @param {Set<string>} vocabulary - seeded menu names and slugs
 * @returns {{errors: string[], warnings: string[]}} findings
 */
function checkRouteGates(gates, vocabulary) {
  const errors = [];
  const warnings = [];

  for (const gate of gates) {
    const at = `${gate.file}:${gate.line}`;

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
function checkRoleLevels(roleNames = ROLE_NAMES, roleLevels = ROLE_LEVELS) {
  const errors = [];

  for (const key of Object.keys(roleNames)) {
    if (!Number.isFinite(roleLevels[key])) {
      errors.push(
        `ROLE_NAMES.${key} ("${roleNames[key]}") has no usable ROLE_LEVELS entry ` +
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
async function checkSeededRoles(sequelize) {
  if (!sequelize) {
    return { errors: [], skipped: "no database handle was passed to the check" };
  }

  let rows;
  try {
    rows = await sequelize.query(
      "SELECT name, role_level FROM roles WHERE is_deleted = false AND deleted_at IS NULL",
      { type: QueryTypes.SELECT },
    );
  } catch (err) {
    return {
      errors: [],
      skipped: `the roles table could not be read (${err.message}) — the role constants were NOT verified against the database`,
    };
  }

  const levelByName = new Map(rows.map((row) => [row.name, row.role_level]));
  const seededKeys = Object.keys(ROLE_IDS);
  const present = seededKeys.filter((key) => levelByName.has(ROLE_NAMES[key]));

  if (present.length === 0) {
    return {
      errors: [],
      skipped:
        "the roles table holds none of the seeded roles — the database has not been seeded yet " +
        "(GET /api/v1/migration/seeding); the role constants were NOT verified against the database",
    };
  }

  const errors = [];

  for (const key of seededKeys) {
    const name = ROLE_NAMES[key];

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
        `roles."${name}".role_level is ${actual}, ROLE_LEVELS.${key} is ${ROLE_LEVELS[key]} — ` +
          "rbac() decides by the column, so the database silently decides differently from the code (ADR-043 §1)",
      );
    }
  }

  return { errors, skipped: null };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/**
 * Validate the authorization wiring. Throws — and so refuses the boot — when a
 * route gate can never be satisfied, a role has no level, or the roles table
 * disagrees with the constants.
 *
 * @param {object} [options] - options
 * @param {object|null} [options.sequelize] - connected Sequelize instance; when
 *   absent the roles-table check is skipped, loudly
 * @param {object} [options.log] - logger (injectable for tests)
 * @returns {Promise<{gates: number, warnings: string[]}>} what was checked
 */
async function validateAuthorizationWiring({ sequelize = null, log = logger } = {}) {
  const errors = [];
  const warnings = [];
  let gates = [];

  try {
    gates = collectRouteGates();
    const gateFindings = checkRouteGates(gates, seededMenuVocabulary());
    errors.push(...gateFindings.errors);
    warnings.push(...gateFindings.warnings);
  } catch (err) {
    // The sources could not be read (a packaged snapshot, a moved directory).
    // The gates are then unchecked — which is said out loud, not crashed over.
    warnings.push(
      `the route sources could not be scanned (${err.message}) — no dynamicAccess gate was verified in this build`,
    );
  }

  errors.push(...checkRoleLevels());

  const roleFindings = await checkSeededRoles(sequelize);
  errors.push(...roleFindings.errors);
  if (roleFindings.skipped !== null) {
    log.warn(`AUTHZ_WIRING_SKIPPED: ${roleFindings.skipped}`);
  }

  for (const warning of warnings) {
    log.warn(`AUTHZ_WIRING_WARNING: ${warning}`);
  }

  if (errors.length > 0) {
    const message =
      `AUTHZ_WIRING_FAILURE: refusing to start — ${errors.length} authorization wiring defect(s):\n` +
      errors.map((e) => `  - ${e}`).join("\n");
    log.error(message);
    throw new Error(message);
  }

  log.info(
    `Authorization wiring validated: ${gates.length} dynamicAccess gate(s), ` +
      `${Object.keys(ROLE_NAMES).length} role name(s), ${warnings.length} warning(s)`,
  );

  return { gates: gates.length, warnings };
}

module.exports = {
  validateAuthorizationWiring,
  collectRouteGates,
  seededMenuVocabulary,
  checkRouteGates,
  checkRoleLevels,
  checkSeededRoles,
  parseGates,
  resolveNames,
  splitTopLevel,
  readBracketed,
  stripComments,
};
