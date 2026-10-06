/**
 * The continuation-local namespace Sequelize keeps its managed transaction in
 * (`Sequelize.useCLS`, config/index.ts), on node:async_hooks AsyncLocalStorage.
 *
 * U-06 (ADR-119). This was `cls-hooked`'s namespace. cls-hooked tracks context
 * with an `async_hooks` hook that has a `destroy` callback, so every promise
 * the process creates pays for init and destroy tracking — on every query,
 * every middleware and every response, not only inside a transaction. Under
 * the P8-07 load the backend's event loop was the saturated resource (the main
 * thread at 99%, PostgreSQL at about 190% of 16 cores). The CPU saved per call
 * was measured on a shared, contended host and is within its noise (ADR-119);
 * the change rests on removing the process-wide hook, with cls-hooked's
 * semantics pinned by clsNamespace.u06 (the same tests pass over cls-hooked).
 * The tenant context has used AsyncLocalStorage since it was written
 * (tenantContext.middleware); this moves the last cls-hooked user to it.
 *
 * The surface is the one Sequelize v6 reads (sequelize.js `useCLS`/`_clsRun`,
 * model.js and transaction.js), with cls-hooked's semantics:
 *  - `run(fn)` enters a NEW context that inherits the active one (a child
 *    created with Object.create), calls `fn(context)` synchronously, and
 *    returns the context. Async work started inside keeps the context;
 *  - `set` writes the ACTIVE context only, so a nested transaction never
 *    replaces its parent's; with no active context it throws, as cls-hooked's
 *    did ("No context available");
 *  - `get` reads the active context (and what it inherits); with none, undefined;
 *  - `bind(fn)` runs `fn` in the context active when it was bound (a new one
 *    when none was).
 *
 * `export =` stands alone (ADR-087 Am. 15).
 */
import { AsyncLocalStorage } from "async_hooks";

/** One context: keys Sequelize sets (`transaction`), inheriting the parent's. */
type ClsContext = Record<string, unknown>;

/** The namespace surface Sequelize.useCLS checks (`run`, `bind`) and uses (`get`, `set`). */
interface ClsNamespace {
  run(fn: (context: ClsContext) => unknown): ClsContext;
  bind<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R;
  get(key: string): unknown;
  set<T>(key: string, value: T): T;
}

/**
 * @returns a fresh namespace over its own AsyncLocalStorage
 */
const createNamespace = (): ClsNamespace => {
  const storage = new AsyncLocalStorage<ClsContext>();
  return {
    run(fn) {
      const context = Object.create(storage.getStore() ?? null) as ClsContext;
      storage.run(context, () => fn(context));
      return context;
    },
    bind(fn) {
      // cls-hooked: bound outside any context, the function gets a new one.
      const context = storage.getStore() ?? (Object.create(null) as ClsContext);
      return (...args) => storage.run(context, () => fn(...args));
    },
    get(key) {
      return storage.getStore()?.[key];
    },
    set(key, value) {
      const context = storage.getStore();
      if (context === undefined) {
        throw new Error("No context available. ns.run() or ns.bind() must be called first.");
      }
      context[key] = value;
      return value;
    },
  };
};

export = { createNamespace };
