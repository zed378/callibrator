/**
 * A-274 — the unused `includeDeleted` scope is removed from 12 models.
 *
 * Thirteen soft-deleting models declared `scopes: { includeDeleted: { where:
 * null } }`. Combined as `.scope(["defaultScope", "includeDeleted"])` it
 * SILENTLY drops the soft-delete predicate — a trap with no user. On
 * 2026-09-30 one model's scope had callers: `ApiKey.scope("includeDeleted")` in
 * calibrationRecords.service and stock.service (Q-51 / ADR-100 Amendment 2, a
 * row made by a since-revoked key still names it). So ApiKey keeps its scope,
 * documented; the other twelve lose theirs. The behaviour change is nil
 * because nothing called them. The sets are COMPUTED from source — declaring
 * models must equal scoped-by-a-caller models — so an unused scope cannot grow
 * back unnoticed and a new caller does not need this file edited.
 */
import fs from "node:fs";
import path from "node:path";
import { DataTypes, Sequelize } from "sequelize";
import defineStock from "../../models/stock.model";
import defineApiKey from "../../models/apiKey.model";

const SRC = path.resolve(__dirname, "../..");
const MODELS = path.join(SRC, "models");

const sourceFiles = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return full === path.join(SRC, "tests") ? [] : sourceFiles(full);
    }
    return /\.(c|m)?(j|t)s$/.test(entry.name) && !entry.name.endsWith(".d.ts") ? [full] : [];
  });

describe("A-274 — the includeDeleted scope", () => {
  /** `<Model>.scope("includeDeleted")` in source (comments excluded), by model name. */
  const uses = (): Map<string, string[]> => {
    const found = new Map<string, string[]>();
    for (const file of sourceFiles(SRC)) {
      for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
        if (/^\s*(\/\/|\*)/.test(line)) {
          continue;
        }
        for (const match of line.matchAll(/(\w+)\.scope\(([^)]*)\)/g)) {
          if ((match[2] ?? "").includes("includeDeleted")) {
            const model = match[1] ?? "";
            found.set(model, [...(found.get(model) ?? []), path.relative(SRC, file).split(path.sep).join("/")]);
            // Never combined with defaultScope: that is the silent predicate drop.
            expect(match[2]).not.toContain("defaultScope");
          }
        }
      }
    }
    return found;
  };

  /** Model files that declare the scope, by the model name `sequelize.define`/`init` gives them. */
  const declaring = (): string[] =>
    fs
      .readdirSync(MODELS)
      .filter((name) => name.endsWith(".model.ts"))
      .map((name) => fs.readFileSync(path.join(MODELS, name), "utf8"))
      .filter((text) => /includeDeleted:\s*\{/.test(text))
      .map((text) => /modelName:\s*"(\w+)"/.exec(text)?.[1] ?? "?");

  it("is declared by exactly the models some caller scopes with it — no unused scope", () => {
    const used = [...uses().keys()].sort();
    expect(used.length).toBeGreaterThan(0);
    expect(declaring().sort()).toEqual(used);
  });

  it("today that is ApiKey alone (Q-51 / ADR-100 Am. 2: a revoked key still names its rows)", () => {
    expect([...uses().keys()]).toEqual(["ApiKey"]);
  });

  it("a removed scope is now an error, not a silent predicate drop", () => {
    const db = new Sequelize({ dialect: "postgres", logging: false });
    const Stock = defineStock(db, DataTypes);
    expect(() => Stock.scope("includeDeleted")).toThrow(/includeDeleted/);
    const ApiKey = defineApiKey(db, DataTypes);
    expect(() => ApiKey.scope("includeDeleted")).not.toThrow();
  });
});
