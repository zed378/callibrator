// F-03 — the shared replacement for set-state-in-effect load calls.
import { deferEffect } from "./deferEffect";

describe("deferEffect", () => {
  it("runs the load after the effect body, not during it", async () => {
    const load = jest.fn();
    deferEffect(load);
    expect(load).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("a cleanup before the microtask skips the load (dependency changed / unmounted)", async () => {
    const load = jest.fn();
    const cleanup = deferEffect(load);
    cleanup();
    await Promise.resolve();
    expect(load).not.toHaveBeenCalled();
  });
});
