/**
 * P21-09d — G-19 (spec P19-04 § 9.1; AM-19): the socket room rules, held to the source.
 *
 *  1. `tenant_<id>` is joined in exactly one place — config/socket.ts — and only in the ELSE branch
 *     of the `facilityBound === true` check: a bound socket never sits in a tenant room.
 *  2. `facility_<tenant>_<facility>` is joined in exactly one place — the handshake's bound branch,
 *     from the socket's CONTEXT — never from inside a client event handler (`socket.on(…)`): no
 *     client event joins a facility room.
 *  3. Nothing else in src/ joins either kind of room.
 *
 * The behaviour itself is proved by tests/config/socket.facilityRooms.test.ts (P21-09a).
 */
import fs from "fs";
import path from "path";

const SRC = path.join(__dirname, "../..");
const SOCKET = path.join(SRC, "config", "socket.ts");

const sourceFiles = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {return e.name === "tests" ? [] : sourceFiles(full);}
    return /\.(js|ts)$/.test(e.name) && !e.name.endsWith(".d.ts") ? [full] : [];
  });

const JOIN_TENANT = /\.join\(\s*`tenant_/g;
const JOIN_FACILITY = /\.join\(\s*`facility_/g;

/** Offsets of every match of `re` in `text`. */
const offsets = (text: string, re: RegExp): number[] => [...text.matchAll(new RegExp(re.source, "g"))].map((m) => m.index);

/** Whether `index` lies inside a `socket.on(` handler (its parentheses are still open). */
const insideClientHandler = (text: string, index: number): boolean => {
  for (const start of offsets(text, /socket\.on\(/)) {
    if (start > index) {continue;}
    let depth = 0;
    for (let i = start + "socket.on".length; i < text.length; i += 1) {
      if (text[i] === "(") {depth += 1;}
      if (text[i] === ")") {depth -= 1;}
      if (depth === 0) {
        if (i > index) {return true;}
        break;
      }
    }
  }
  return false;
};

/** The rule violations in socket.ts's text (shared with the bite case). */
const violations = (text: string): string[] => {
  const out: string[] = [];
  const tenantJoins = offsets(text, JOIN_TENANT);
  const facilityJoins = offsets(text, JOIN_FACILITY);
  if (tenantJoins.length !== 1) {out.push(`tenant_ joined ${String(tenantJoins.length)} times`);}
  if (facilityJoins.length !== 1) {out.push(`facility_ joined ${String(facilityJoins.length)} times`);}
  const branch = text.indexOf("if (socket.tenantContext.facilityBound === true) {");
  const elseAt = branch < 0 ? -1 : text.indexOf("} else {", branch);
  for (const at of tenantJoins) {
    if (branch < 0 || elseAt < 0 || at < elseAt || at - elseAt > 200) {out.push("tenant_ join outside the unbound branch");}
  }
  for (const at of facilityJoins) {
    if (branch < 0 || at < branch || (elseAt >= 0 && at > elseAt)) {out.push("facility_ join outside the bound branch");}
    if (insideClientHandler(text, at)) {out.push("facility_ join inside a client event handler");}
  }
  return out;
};

describe("G-19 — socket rooms: the tenant room only for unbound sockets, the facility room only from the context", () => {
  const text = fs.readFileSync(SOCKET, "utf8");

  it("config/socket.ts keeps both rules", () => {
    expect(violations(text)).toEqual([]);
  });

  it("no other source file joins a tenant or facility room", () => {
    const others = sourceFiles(SRC)
      .filter((f) => f !== SOCKET)
      .filter((f) => {
        const t = fs.readFileSync(f, "utf8");
        return offsets(t, JOIN_TENANT).length + offsets(t, JOIN_FACILITY).length > 0;
      })
      .map((f) => path.relative(SRC, f));
    expect(others).toEqual([]);
  });

  it("bites (fail-before): a tenant join in the bound branch, a client-event facility join", () => {
    const swapped = text
      .replace("void socket.join(`tenant_", "void socket.join(`tmp_")
      .replace("void socket.join(`facility_", "void socket.join(`tenant_")
      .replace("void socket.join(`tmp_", "void socket.join(`facility_");
    expect(violations(swapped)).toEqual(expect.arrayContaining(["tenant_ join outside the unbound branch"]));
    const planted = text.replace(
      'socket.on("disconnect", () => {',
      'socket.on("facility:join", (f) => { void socket.join(`facility_${f}`); });\n    socket.on("disconnect", () => {',
    );
    expect(violations(planted)).toEqual(expect.arrayContaining(["facility_ joined 2 times", "facility_ join inside a client event handler"]));
  });
});
