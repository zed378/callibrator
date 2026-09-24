/**
 * ADR-043 step 5 — the authorization wiring assertion.
 *
 * Two kinds of test live here, deliberately:
 *
 *   1. The REAL repository, scanned the way boot scans it. "every dynamicAccess
 *      gate in src/routes matches a seeded menu slug or name" is the named
 *      regression test for A-58: reintroduce `"workflow"` in workflows.route.js
 *      and it fails, naming the file and line.
 *   2. Synthetic sources and fake database handles, for each branch of the
 *      scanner and each refusal — including the ones the real tree does not
 *      currently exercise (requireAll, undefined MENU_SLUGS keys, a roles table
 *      that disagrees with ROLE_LEVELS).
 *
 * Nothing here is generated from the checker's own data: the vocabulary under
 * test is read from seedMenuGroups.util.js, and the real-tree expectations are
 * written out by hand.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { logger } = require("../../middlewares/activityLog.middleware");
const {
  ROLE_NAMES,
  ROLE_IDS,
  ROLE_LEVELS,
  MENU_SLUGS,
  ROLE_MENU_ASSIGNMENTS,
} = require("../../constants");
const wiring = require("../../utils/authorizationWiring.util");

const {
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
} = wiring;

const fakeLog = () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() });

/** Rows exactly as the seed writes them: every ROLE_IDS role at its level. */
const seededRows = () =>
  Object.keys(ROLE_IDS).map((key) => ({ name: ROLE_NAMES[key], role_level: ROLE_LEVELS[key] }));

const dbReturning = (rows) => ({ query: jest.fn().mockResolvedValue(rows) });

// ===========================================================================
describe("the real repository", () => {
  it("every dynamicAccess gate in src/routes matches a seeded menu slug or name (A-58)", () => {
    const gates = collectRouteGates();
    const { errors } = checkRouteGates(gates, seededMenuVocabulary());

    expect(gates.length).toBeGreaterThan(100);
    expect(errors).toEqual([]);
  });

  it("the workflow gates name seeded slugs: `workflows`, and the action's record types (A-183)", () => {
    const gates = collectRouteGates().filter((g) => /workflows\.route\.js$/.test(g.file));

    expect(gates.map((g) => g.names)).toEqual([
      // A-183 — GET /instances/pending
      ["workflows"],
      // A-183 — POST /instances/:instanceId/action: write on a record type a
      // workflow decides on; the service then requires the instance's own.
      ["certificate", "warehouse", "maintenance"],
      ["workflows"],
      ["workflows"],
      ["workflows"],
      ["workflows"],
      ["workflows"],
    ]);
    for (const slug of ["certificate", "warehouse", "maintenance"]) {
      expect(seededMenuVocabulary().has(slug)).toBe(true);
    }
    expect(seededMenuVocabulary().has("workflows")).toBe(true);
    expect(seededMenuVocabulary().has("workflow")).toBe(false);
  });

  it("reports the computed gate as a warning, and no dead alias remains (A-07)", () => {
    const { warnings } = checkRouteGates(collectRouteGates(), seededMenuVocabulary());
    const text = warnings.join("\n");

    // Written out by hand so a change in either direction is noticed. Until
    // A-07 (2026-09-24) this also listed "AuditLogs" (audit.route.js) and
    // "Finance" ×6 (finance.route.js); every gate now names a seeded slug
    // (dynamicAccessSlugs.a07.test.js), so the computed search gate is the
    // only thing this scanner cannot verify.
    expect(text).not.toMatch(/dynamicAccess names "/);
    expect(text).toMatch(/search\.route\.js:\d+ dynamicAccess\(SEARCH_MENUS, …\) is computed/);
    expect(warnings).toHaveLength(1);
  });

  it("every ROLE_NAMES key has a ROLE_LEVELS entry", () => {
    expect(checkRoleLevels()).toEqual([]);
  });

  it("boot's static phase passes on the repository as it stands", () => {
    const log = fakeLog();

    const result = assertStaticAuthorizationWiring({ log });

    expect(result.gates).toBeGreaterThan(100);
    expect(log.error).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith(
      expect.stringMatching(/^Authorization wiring validated: \d+ dynamicAccess gate\(s\)/),
    );
  });

  it("uses the module logger when none is injected", () => {
    logger.info.mockClear();
    assertStaticAuthorizationWiring();
    expect(logger.info).toHaveBeenCalled();
  });
});

// ===========================================================================
describe("A-58 reproduced: a gate on an unseeded slug refuses the boot", () => {
  const typo = [
    'router.get("/", auth, dynamicAccess("workflow", "read"), ctrl.list);',
    'router.post("/", auth, dynamicAccess("workflows", "write"), ctrl.create);',
  ].join("\n");

  it("names the file, the line and the unseeded name", () => {
    const log = fakeLog();

    expect(() =>
      assertStaticAuthorizationWiring({
        log,
        collect: () => parseGates(typo, "src/routes/api/workflows.route.js"),
        vocabulary: seededMenuVocabulary,
      }),
    ).toThrow(
      /AUTHZ_WIRING_FAILURE: refusing to start — 1 authorization wiring defect\(s\):\n {2}- src\/routes\/api\/workflows\.route\.js:1 dynamicAccess\("workflow", …\) matches no seeded menu group/,
    );
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('"workflow"'));
  });
});

// ===========================================================================
describe("assertStaticAuthorizationWiring — when the scan cannot run", () => {
  it("warns, and does not refuse, when the sources cannot be read", () => {
    const log = fakeLog();

    const result = assertStaticAuthorizationWiring({
      log,
      collect: () => {
        throw new Error("ENOENT: no such file or directory, scandir '/snapshot/src/routes'");
      },
    });

    expect(result.gates).toBe(0);
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringMatching(/route sources could not be scanned \(ENOENT.*no dynamicAccess gate was verified/),
    );
  });

  it("warns when the scan finds no gate at all, instead of reporting a pass", () => {
    const log = fakeLog();

    const result = assertStaticAuthorizationWiring({
      log,
      collect: () => [],
      vocabulary: () => new Set(),
    });

    expect(result.warnings).toEqual([
      "the route sources were scanned but no dynamicAccess gate was found — no gate was verified in this build",
    ]);
    expect(log.warn).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
describe("assertSeededRoles — the database phase", () => {
  it("refuses when a seeded role's role_level disagrees with ROLE_LEVELS, naming it", async () => {
    const rows = seededRows();
    rows.find((r) => r.name === ROLE_NAMES.HEALTCARE_ADMIN).role_level = 1;
    const log = fakeLog();

    await expect(assertSeededRoles({ sequelize: dbReturning(rows), log })).rejects.toThrow(
      `roles."${ROLE_NAMES.HEALTCARE_ADMIN}".role_level is 1, ROLE_LEVELS.HEALTCARE_ADMIN is ${ROLE_LEVELS.HEALTCARE_ADMIN}`,
    );
    expect(log.error).toHaveBeenCalled();
  });

  it("says out loud that it ran and passed", async () => {
    const log = fakeLog();

    const result = await assertSeededRoles({ sequelize: dbReturning(seededRows()), log });

    expect(result).toEqual({ skipped: null });
    expect(log.info).toHaveBeenCalledWith(
      expect.stringMatching(/roles table agrees with ROLE_LEVELS for \d+ seeded role/),
    );
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("warns and continues when it cannot run, so an unreachable database never masquerades as an authz defect", async () => {
    const log = fakeLog();
    const sequelize = { query: jest.fn().mockRejectedValue(new Error("connect ECONNREFUSED")) };

    const result = await assertSeededRoles({ sequelize, log });

    expect(result.skipped).toMatch(/could not be read \(connect ECONNREFUSED\)/);
    expect(log.warn).toHaveBeenCalledWith(expect.stringMatching(/^AUTHZ_WIRING_SKIPPED: /));
    expect(log.error).not.toHaveBeenCalled();
  });

  it("defaults to no database handle and the module logger", async () => {
    logger.warn.mockClear();
    const result = await assertSeededRoles();
    expect(result.skipped).toBe("no database handle was passed to the check");
    expect(logger.warn).toHaveBeenCalled();
  });
});

// ===========================================================================
describe("checkSeededRoles", () => {
  it("skips a database that has not been seeded yet, rather than deadlocking the install", async () => {
    const result = await checkSeededRoles(dbReturning([{ name: "CUSTOM", role_level: 3 }]));

    expect(result.errors).toEqual([]);
    expect(result.skipped).toMatch(/has not been seeded yet/);
  });

  it("refuses a partially seeded table, naming the missing role", async () => {
    const rows = seededRows().filter((r) => r.name !== ROLE_NAMES.USER);

    const result = await checkSeededRoles(dbReturning(rows));

    expect(result.skipped).toBeNull();
    expect(result.errors).toEqual([
      expect.stringContaining(`no row named "${ROLE_NAMES.USER}" (ROLE_IDS.USER)`),
    ]);
  });

  it("ignores extra, tenant-created roles and compares numerically", async () => {
    const rows = seededRows().map((r) => ({ ...r, role_level: String(r.role_level) }));
    rows.push({ name: "HOSPITAL QA LEAD", role_level: 6 });

    const result = await checkSeededRoles(dbReturning(rows));

    expect(result).toEqual({ errors: [], skipped: null });
  });

  it("reads roles with raw SQL that excludes soft-deleted rows", async () => {
    const sequelize = dbReturning(seededRows());
    await checkSeededRoles(sequelize);
    expect(sequelize.query.mock.calls[0][0]).toBe(
      "SELECT name, role_level FROM roles WHERE is_deleted = false AND deleted_at IS NULL",
    );
  });
});

// ===========================================================================
describe("validateAuthorizationWiring — both phases", () => {
  it("runs the static phase, then the database phase", async () => {
    const log = fakeLog();

    const result = await validateAuthorizationWiring({ sequelize: dbReturning(seededRows()), log });

    expect(result.gates).toBeGreaterThan(100);
    expect(result.rolesSkipped).toBeNull();
  });

  it("defaults to no database and the module logger", async () => {
    const result = await validateAuthorizationWiring();
    expect(result.rolesSkipped).toMatch(/no database handle/);
  });
});

// ===========================================================================
describe("checkRouteGates", () => {
  const vocabulary = new Set(["workflows", "Audit Logs", "audit"]);
  const gate = (names, requireAll = false) => ({
    file: "r.js",
    line: 7,
    expression: "X",
    names,
    requireAll,
  });

  it("passes a gate whose every name is seeded", () => {
    expect(checkRouteGates([gate(["workflows"])], vocabulary)).toEqual({ errors: [], warnings: [] });
  });

  it("refuses an OR gate in which nothing is seeded", () => {
    const { errors } = checkRouteGates([gate(["workflow", "Workflow"])], vocabulary);
    expect(errors).toEqual([
      'r.js:7 dynamicAccess("workflow", "Workflow", …) matches no seeded menu group name or slug — ' +
        "the gate grants nobody but SUPERADMIN, silently (A-58)",
    ]);
  });

  it("only warns about a dead alias inside an OR gate that still resolves", () => {
    const { errors, warnings } = checkRouteGates([gate(["AuditLogs", "audit"])], vocabulary);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([
      'r.js:7 dynamicAccess names "AuditLogs", which no seeded menu group provides; the gate still resolves through "audit"',
    ]);
  });

  it("refuses a requireAll gate with any unseeded name", () => {
    const { errors } = checkRouteGates([gate(["audit", "Finance"], true)], vocabulary);
    expect(errors[0]).toMatch(/requireAll: true \}\) requires "Finance", which no seeded menu group provides/);
  });

  it("warns — never silently passes — on a gate it could not resolve", () => {
    const { errors, warnings } = checkRouteGates([gate(null)], vocabulary);
    expect(errors).toEqual([]);
    expect(warnings[0]).toMatch(/r\.js:7 dynamicAccess\(X, …\) is computed — this guard could not verify it/);
  });
});

// ===========================================================================
describe("checkRoleLevels", () => {
  it("refuses a role name with no usable level", () => {
    expect(checkRoleLevels({ A: "Alpha", B: "Beta" }, { A: 3, B: "3" })).toEqual([
      'ROLE_NAMES.B ("Beta") has no usable ROLE_LEVELS entry (got: 3) — every gate that compares role levels refuses it, silently',
    ]);
  });
});

// ===========================================================================
describe("parseGates", () => {
  it("reads the first argument, the line, and requireAll", () => {
    const source = [
      "const WF = MENU_SLUGS.WORKFLOWS;",
      'router.get("/", dynamicAccess(WF, "read"), h);',
      "router.post(",
      '  "/",',
      '  dynamicAccess(["a", \'b\'], ["read", "write"], { requireAll: true }),',
      ");",
    ].join("\n");

    expect(parseGates(source, "f.js")).toEqual([
      { file: "f.js", line: 2, expression: "WF", names: ["workflows"], requireAll: false },
      { file: "f.js", line: 5, expression: '["a", \'b\']', names: ["a", "b"], requireAll: true },
    ]);
  });

  it("does not count a gate inside a comment", () => {
    const source = [
      "/**",
      ' * router.get("/", dynamicAccess("ghost", "read"))',
      " */",
      '// dynamicAccess("ghost", "read")',
      'dynamicAccess("real", "read");',
    ].join("\n");

    const gates = parseGates(source, "f.js");
    expect(gates.map((g) => [g.line, g.names])).toEqual([[5, ["real"]]]);
  });

  it("records an unterminated call as unresolvable instead of dropping it", () => {
    const [gate] = parseGates('dynamicAccess("x", "read"', "f.js");
    expect(gate).toMatchObject({ file: "f.js", line: 1, names: null, requireAll: false });
  });
});

// ===========================================================================
describe("resolveNames", () => {
  it.each([
    ['"workflows"', ["workflows"]],
    ["'workflows'", ["workflows"]],
    ["`workflows`", ["workflows"]],
    ['["a", "b"]', ["a", "b"]],
    ["MENU_SLUGS.WORKFLOWS", [MENU_SLUGS.WORKFLOWS]],
    ["MENU_SLUGS.WORKFLOW", ["MENU_SLUGS.WORKFLOW (undefined)"]],
  ])("%s -> %j", (expression, names) => {
    expect(resolveNames(expression, "", 1)).toEqual(names);
  });

  it.each([
    ["`${prefix}s`", "an interpolated template"],
    ['["a", computed()]', "an array with a computed element"],
    ["NOT_DECLARED", "an identifier with no const declaration"],
    ["items.map((x) => x.menu)", "an expression"],
  ])("%s is unresolvable (%s)", (expression) => {
    expect(resolveNames(expression, "const OTHER = 'x';", 1)).toBeNull();
  });

  it("follows one const indirection, and no further", () => {
    const source = 'const A = B;\nconst B = "deep";\nconst C = "one";';
    expect(resolveNames("C", source, 1)).toEqual(["one"]);
    expect(resolveNames("A", source, 1)).toBeNull();
    expect(resolveNames("C", source, 0)).toBeNull();
  });
});

// ===========================================================================
describe("source helpers", () => {
  it("splitTopLevel splits at top-level commas only, respecting quotes and escapes", () => {
    expect(splitTopLevel('"a,b", [1, 2], { k: (1, 2) }, "q\\"x,", ')).toEqual([
      '"a,b"',
      " [1, 2]",
      " { k: (1, 2) }",
      ' "q\\"x,"',
    ]);
  });

  it("readBracketed returns the inner text of a balanced bracket, quote-aware", () => {
    const source = 'call("a)b", [1, (2)], "e\\")") tail';
    expect(readBracketed(source, source.indexOf("("))).toBe('"a)b", [1, (2)], "e\\")"');
  });

  it("readBracketed returns null for a bracket that never closes", () => {
    expect(readBracketed("(a, [b", 0)).toBeNull();
  });

  it("stripComments blanks comments but keeps line numbers", () => {
    const out = stripComments("a\n/* x\n y */\n  // z\nb");
    expect(out.split("\n")).toHaveLength(5);
    expect(out).not.toMatch(/[xyz]/);
    expect(out.split("\n")[4]).toBe("b");
  });
});

// ===========================================================================
describe("collectRouteGates / seededMenuVocabulary on injected inputs", () => {
  let dir;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "authz-wiring-"));
    fs.mkdirSync(path.join(dir, "api"));
    fs.writeFileSync(path.join(dir, "api", "x.route.js"), 'dynamicAccess("x", "read");\n');
    fs.writeFileSync(path.join(dir, "README.md"), 'dynamicAccess("not-js", "read");\n');
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("walks subdirectories and reads only .js files", () => {
    const gates = collectRouteGates(dir);
    expect(gates).toHaveLength(1);
    expect(gates[0].names).toEqual(["x"]);
    expect(gates[0].file).toMatch(/x\.route\.js$/);
  });

  it("builds the vocabulary from both menu names and slugs", () => {
    const vocabulary = seededMenuVocabulary(
      'const menuData = [\n  { name: "Work Flows", slug: "workflows", children: [{ name: "Kid", slug: "kid" }] },\n];',
    );
    expect([...vocabulary].sort()).toEqual(["Kid", "Work Flows", "kid", "workflows"]);
  });

  it("refuses to guess when the seed changes shape", () => {
    expect(() => seededMenuVocabulary("module.exports = {};")).toThrow(
      /could not find `const menuData = \[` .* must be updated, not deleted/,
    );
  });
});

// ===========================================================================
describe("A-80 — ROLE_MENU_ASSIGNMENTS against the seeded menu slugs", () => {
  it("every assignment key in the real constants is a slug the real seed creates", () => {
    expect(checkRoleMenuAssignments()).toEqual([]);
  });

  it("the Profile page is assigned by its seeded slug, `profile-page` — not `profile`", () => {
    const slugs = seededMenuSlugs();
    expect(slugs.has("profile-page")).toBe(true);
    expect(slugs.has("profile")).toBe(false);
    expect(MENU_SLUGS.PROFILE).toBe("profile-page");
  });

  it("A-80 reproduced: the pre-fix `profile` key is refused, naming the role and the slug", () => {
    const preFix = ROLE_MENU_ASSIGNMENTS.map((a) => {
      const menus = { ...a.menus };
      delete menus["profile-page"];
      return { roleName: a.roleName, menus: { profile: "write", ...menus } };
    });

    const errors = checkRoleMenuAssignments(preFix);

    expect(errors).toHaveLength(ROLE_MENU_ASSIGNMENTS.length);
    expect(errors[0]).toMatch(
      /^ROLE_MENU_ASSIGNMENTS\["SUPERADMIN"\] grants "profile", which is not the slug of any seeded menu group .*\(A-80\)$/,
    );
  });

  it("a menu NAME is not a slug: `Profile` is refused although the matrix would accept it from a gate", () => {
    const errors = checkRoleMenuAssignments(
      [{ roleName: "USER", menus: { Profile: "write" } }],
      seededMenuSlugs(),
    );
    expect(errors).toHaveLength(1);
    expect(seededMenuVocabulary().has("Profile")).toBe(true);
  });

  it("boot's static phase REFUSES to start on a mismatched assignment", () => {
    const log = fakeLog();

    expect(() =>
      assertStaticAuthorizationWiring({
        log,
        collect: () => [],
        assignments: [{ roleName: "TECHNICIAN", menus: { profile: "write" } }],
      }),
    ).toThrow(
      /AUTHZ_WIRING_FAILURE: refusing to start — 1 authorization wiring defect\(s\):\n {2}- ROLE_MENU_ASSIGNMENTS\["TECHNICIAN"\] grants "profile"/,
    );
  });

  it("warns, and does not refuse, when the seed file cannot be read for the assignment check", () => {
    const log = fakeLog();

    assertStaticAuthorizationWiring({
      log,
      collect: () => [],
      slugs: () => {
        throw new Error("ENOENT: seedMenuGroups.util.js");
      },
    });

    expect(log.warn).toHaveBeenCalledWith(
      expect.stringMatching(/menu seed could not be read \(ENOENT.*ROLE_MENU_ASSIGNMENTS was not verified/),
    );
    expect(log.error).not.toHaveBeenCalled();
  });

  it("seededMenuSlugs reads slugs only, never names", () => {
    const slugs = seededMenuSlugs(
      'const menuData = [\n  { name: "Profile", slug: "profile-page" },\n];',
    );
    expect([...slugs]).toEqual(["profile-page"]);
  });
});
