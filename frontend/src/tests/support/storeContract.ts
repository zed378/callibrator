/**
 * The error contract every data store in src/stores follows, asserted per
 * action rather than assumed:
 *
 * - the action calls ITS service method with the arguments it was given;
 * - success stores the result where the screen reads it, and clears
 *   `isLoading` and `error`;
 * - failure puts the backend's message (or the action's own fallback, for a
 *   non-Error rejection) in `error` and clears `isLoading`;
 * - a WRITE rethrows, so the screen that asked for it can say it failed; a
 *   READ does not — its screen renders `error`.
 *
 * The services are mocked: this proves the store's behaviour, not the
 * endpoint (the service contract tests and the live suite do that).
 */
import type { StoreApi, UseBoundStore } from "zustand";

export interface StoreCase {
  action: string;
  args: unknown[];
  /** The mocked service method the action must call. */
  method: string;
  /** The arguments that method must receive (defaults to `args`). */
  expectedArgs?: unknown[];
  resolved?: unknown;
  /** Where the result lands in the store (omit when nothing is stored). */
  stateKey?: string;
  /** What must be at stateKey (defaults to `resolved`). */
  stateValue?: unknown;
  rethrows: boolean;
  fallback: string;
}

type AnyStore = UseBoundStore<StoreApi<Record<string, unknown>>>;

export function describeStoreContract(
  title: string,
  store: AnyStore,
  service: Record<string, jest.Mock>,
  initial: Record<string, unknown>,
  cases: StoreCase[],
): void {
  describe(`${title} — store contract`, () => {
    beforeEach(() => {
      Object.values(service).forEach((m) => m.mockReset());
      store.setState(initial);
    });

    for (const c of cases) {
      const run = () =>
        (store.getState()[c.action] as (...a: unknown[]) => Promise<unknown>)(...c.args);

      it(`${c.action}: success stores the result and clears loading/error`, async () => {
        service[c.method].mockResolvedValue(c.resolved);
        store.setState({ error: "stale" });

        await run();

        expect(service[c.method]).toHaveBeenCalledWith(...(c.expectedArgs ?? c.args));
        const state = store.getState();
        expect(state.isLoading).toBe(false);
        expect(state.error).toBeNull();
        if (c.stateKey) {
          expect(state[c.stateKey]).toEqual(
            c.stateValue !== undefined ? c.stateValue : c.resolved,
          );
        }
      });

      it(`${c.action}: failure keeps the backend's message${c.rethrows ? " and rethrows" : ""}`, async () => {
        service[c.method].mockRejectedValue(new Error("backend says no"));

        if (c.rethrows) {
          await expect(run()).rejects.toThrow("backend says no");
        } else {
          await expect(run()).resolves.not.toThrow;
        }
        expect(store.getState()).toMatchObject({ isLoading: false, error: "backend says no" });
      });

      it(`${c.action}: a non-Error rejection gets the fallback message`, async () => {
        service[c.method].mockRejectedValue("opaque");
        await run().catch(() => undefined);
        expect(store.getState().error).toBe(c.fallback);
      });
    }
  });
}
