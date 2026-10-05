/**
 * CI first push (2026-10-02, MEMORY/records/2026-10-02-ci-first-push-fixes.md):
 * CI builds backend/.env from .env.example, which set
 * `SUPER_ADMIN_ROLE_ID=uuid-here`. roleConstants reads that variable at load,
 * so the super-admin role id became "uuid-here": every request naming the
 * real, seeded role failed the UUID validator (400 instead of the 403
 * refusal user.createSuperAdmin.dast pins), and the id half of the
 * super-admin checks compared against a value no row can hold. The
 * workstation's own .env left it unset, so the suite passed there.
 *
 * The role seed always writes ROLE_IDS.SUPER_ADMIN; the template may leave
 * the variable unset (the default is that id) or set it to that id, nothing else.
 */
import fs from "node:fs";
import path from "node:path";
import { ROLE_IDS } from "../../constants/roleConstants";

const EXAMPLE = path.resolve(__dirname, "../../../.env.example");

/** The active (uncommented) assignments of a variable in a dotenv file. */
const assignmentsOf = (text: string, name: string): string[] =>
  text
    .split(/\r?\n/)
    .map((line) => new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=\\s*(.*?)\\s*$`).exec(line)?.[1])
    .filter((value): value is string => value !== undefined)
    .map((value) => value.replace(/\s+#.*$/, "").replace(/^(["'])(.*)\1$/, "$2"));

describe("backend/.env.example — SUPER_ADMIN_ROLE_ID", () => {
  it("is unset, or the id the role seed writes", () => {
    const values = assignmentsOf(fs.readFileSync(EXAMPLE, "utf8"), "SUPER_ADMIN_ROLE_ID");
    expect(values.filter((v) => v !== "" && v !== ROLE_IDS.SUPER_ADMIN)).toEqual([]);
  });

  it("the check refuses the old placeholder and accepts the unset and seeded forms", () => {
    const bad = (text: string): string[] =>
      assignmentsOf(text, "SUPER_ADMIN_ROLE_ID").filter((v) => v !== "" && v !== ROLE_IDS.SUPER_ADMIN);
    expect(bad("A=1\r\nSUPER_ADMIN_ROLE_ID=uuid-here\r\n")).toEqual(["uuid-here"]);
    expect(bad("# SUPER_ADMIN_ROLE_ID=uuid-here\n")).toEqual([]);
    expect(bad(`SUPER_ADMIN_ROLE_ID="${ROLE_IDS.SUPER_ADMIN}" # seeded\n`)).toEqual([]);
    expect(bad("SUPER_ADMIN_ROLE_ID=\n")).toEqual([]);
  });
});
