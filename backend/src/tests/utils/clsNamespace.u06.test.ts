/**
 * U-06 (ADR-119) — Sequelize's managed-transaction namespace is AsyncLocalStorage,
 * not cls-hooked.
 *
 * cls-hooked enables an async_hooks hook with destroy tracking for the whole
 * process, so every promise pays for it. The namespace in
 * utils/clsNamespace.util keeps cls-hooked's semantics for the surface
 * Sequelize v6 uses (run, bind, get, set); these tests pin those semantics,
 * then drive a REAL Sequelize managed transaction through it (the connection
 * is a double) to show the transaction still reaches every query inside the
 * callback and no query outside it.
 */
import * as fs from "fs";
import * as path from "path";
import type * as SequelizeModule from "sequelize";
import type { QueryOptions, Sequelize as SequelizeInstance, Transaction } from "sequelize";
import type * as ClsNamespaceModule from "../../utils/clsNamespace.util";

// eslint-disable-next-line @typescript-eslint/no-require-imports -- the module under test (export =)
const { createNamespace } = require("../../utils/clsNamespace.util") as typeof ClsNamespaceModule;

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** Query options carrying a tag the beforeQuery hook records (Sequelize passes unknown keys through). */
const tagged = (tag: string): QueryOptions => {
  const options: QueryOptions & { u06Tag: string } = { u06Tag: tag };
  return options;
};

describe("U-06 — clsNamespace keeps cls-hooked's semantics", () => {
  it("outside any context: get reads undefined and set throws, as cls-hooked did", () => {
    const ns = createNamespace();
    expect(ns.get("transaction")).toBeUndefined();
    expect(() => ns.set("transaction", 1)).toThrow("No context available");
  });

  it("run calls fn synchronously with the new context, returns that context, and the value survives awaits", async () => {
    const ns = createNamespace();
    let seen: unknown = "not yet";
    let later: Promise<unknown> = Promise.resolve();
    const returned = ns.run((context) => {
      ns.set("transaction", "t1");
      seen = context["transaction"];
      later = (async () => {
        await tick();
        await tick();
        return ns.get("transaction");
      })();
    });
    expect(seen).toBe("t1");
    expect(returned["transaction"]).toBe("t1");
    await expect(later).resolves.toBe("t1");
    expect(ns.get("transaction")).toBeUndefined();
  });

  it("a nested run inherits the parent's values, and its own set never reaches the parent", async () => {
    const ns = createNamespace();
    const observed: unknown[] = [];
    await new Promise<void>((resolve) => {
      ns.run(() => {
        ns.set("transaction", "outer");
        ns.run(() => {
          observed.push(ns.get("transaction"));
          ns.set("transaction", "inner");
          observed.push(ns.get("transaction"));
        });
        observed.push(ns.get("transaction"));
        resolve();
      });
    });
    expect(observed).toEqual(["outer", "inner", "outer"]);
  });

  it("two concurrent contexts never see each other's values", async () => {
    const ns = createNamespace();
    const read = (value: string): Promise<unknown> =>
      new Promise((resolve) => {
        ns.run(() => {
          ns.set("transaction", value);
          void (async () => {
            await tick();
            resolve(ns.get("transaction"));
          })();
        });
      });
    await expect(Promise.all([read("a"), read("b"), read("c")])).resolves.toEqual(["a", "b", "c"]);
  });

  it("bind runs the function in the context it was bound in; bound outside one, it gets a fresh one", () => {
    const ns = createNamespace();
    let bound: () => unknown = () => "unset";
    ns.run(() => {
      ns.set("transaction", "bound-here");
      bound = ns.bind(() => ns.get("transaction"));
    });
    expect(bound()).toBe("bound-here");

    const outside = ns.bind((value: string) => ns.set("transaction", value));
    expect(outside("fresh")).toBe("fresh");
    expect(ns.get("transaction")).toBeUndefined();
  });
});

describe("U-06 — a real Sequelize managed transaction through the namespace", () => {
  /**
   * A Sequelize instance whose connections are doubles: every statement is
   * answered with no rows, and each query's options (its transaction) are recorded.
   * @returns the instance and the recorded statements
   */
  const sequelizeWithNamespace = (): { sequelize: SequelizeInstance; seen: { sql: string; transaction: unknown }[] } => {
    let made: { sequelize: SequelizeInstance; seen: { sql: string; transaction: unknown }[] } | undefined;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- a fresh Sequelize class: useCLS is static
      const { Sequelize } = require("sequelize") as typeof SequelizeModule;
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded in the same registry
      const ns = (require("../../utils/clsNamespace.util") as typeof ClsNamespaceModule).createNamespace();
      Sequelize.useCLS(ns);
      const sequelize = new Sequelize("postgres://u:p@127.0.0.1:1/none", { logging: false });
      const seen: { sql: string; transaction: unknown }[] = [];
      // The statement is named by a tag in its options: the hook sees the options, not the SQL.
      sequelize.addHook("beforeQuery", (options: { transaction?: unknown; u06Tag?: string }) => {
        if (options.u06Tag !== undefined) {
          seen.push({ sql: options.u06Tag, transaction: options.transaction ?? null });
        }
      });
      const connection = {
        query(_sql: string, a: unknown, b?: unknown): void {
          const done = (typeof a === "function" ? a : b) as (e: null, r: { rows: unknown[]; rowCount: number }) => void;
          setImmediate(() => {
            done(null, { rows: [], rowCount: 0 });
          });
        },
        on(): void {
          // a double: it emits nothing
        },
        once(): void {
          // a double: it emits nothing
        },
        removeListener(): void {
          // a double: it emits nothing
        },
      };
      const manager = sequelize.connectionManager as unknown as {
        getConnection: () => Promise<unknown>;
        releaseConnection: () => Promise<void>;
      };
      manager.getConnection = () => Promise.resolve(connection);
      manager.releaseConnection = () => Promise.resolve();
      made = { sequelize, seen };
    });
    return made as { sequelize: SequelizeInstance; seen: { sql: string; transaction: unknown }[] };
  };

  it("every query inside the callback carries the transaction, without passing it; a query outside carries none", async () => {
    const { sequelize, seen } = sequelizeWithNamespace();
    let tx: Transaction | undefined;

    await sequelize.transaction(async (t) => {
      tx = t;
      await sequelize.query("SELECT 1", tagged("inside_first"));
      await tick();
      await sequelize.query("SELECT 2", tagged("inside_after_a_tick"));
    });
    await sequelize.query("SELECT 3", tagged("outside"));

    const inside = seen.filter((s) => s.sql.includes("inside"));
    expect(inside).toHaveLength(2);
    for (const s of inside) {
      expect(s.transaction).toBe(tx);
    }
    expect(seen.find((s) => s.sql.includes("outside"))?.transaction).toBeNull();
  });

  it("two concurrent managed transactions each see only their own", async () => {
    const { sequelize, seen } = sequelizeWithNamespace();
    const txs: Record<string, Transaction> = {};
    const work = (name: string): Promise<void> =>
      sequelize.transaction(async (t) => {
        txs[name] = t;
        await tick();
        await sequelize.query("SELECT 4", tagged(`'${name}'`));
      });

    await Promise.all([work("a"), work("b")]);

    expect(seen.find((s) => s.sql.includes("'a'"))?.transaction).toBe(txs["a"]);
    expect(seen.find((s) => s.sql.includes("'b'"))?.transaction).toBe(txs["b"]);
    expect(txs["a"]).not.toBe(txs["b"]);
  });
});

describe("U-06 — the backend no longer loads cls-hooked (fail-before: config/index required it)", () => {
  it("config/index installs the AsyncLocalStorage namespace and never requires cls-hooked", () => {
    let cls: unknown;
    jest.isolateModules(() => {
      jest.doMock("cls-hooked", () => {
        throw new Error("cls-hooked was loaded");
      }, { virtual: true });
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- loading the module under test
      require("../../config");
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- the same registry's Sequelize
      cls = (require("sequelize") as { Sequelize: { _cls?: unknown } }).Sequelize._cls;
    });
    const installed = cls as { run?: unknown; bind?: unknown; get?: unknown; set?: unknown } | undefined;
    expect(typeof installed?.run).toBe("function");
    expect(typeof installed?.bind).toBe("function");
    expect(typeof installed?.get).toBe("function");
    expect(typeof installed?.set).toBe("function");
  });

  it("cls-hooked is not a backend dependency", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    expect(manifest.dependencies ?? {}).not.toHaveProperty("cls-hooked");
  });
});
