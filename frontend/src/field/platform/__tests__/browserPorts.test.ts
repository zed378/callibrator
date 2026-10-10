/**
 * P22-10b — the engine's small browser ports: the clock, random bytes of the asked length, the
 * network state, a cancellable timer, and a bounded in-memory diagnostics log.
 */
import { browserPorts, LOG_LIMIT } from "../browserPorts";

describe("P22-10b — browser ports", () => {
  it("clock, random, network, a cancellable timer, a bounded log", () => {
    const cleared: number[] = [];
    let online = true;
    const ports = browserPorts({
      now: () => 42,
      getRandomValues: (a) => a.fill(7),
      onLine: () => online,
      setTimeout: () => 9,
      clearTimeout: (id) => cleared.push(id),
    });
    expect(ports.clock.now()).toBe(42);
    expect(ports.random.bytes(3)).toEqual(new Uint8Array([7, 7, 7]));
    expect(ports.network.online()).toBe(true);
    online = false;
    expect(ports.network.online()).toBe(false);
    ports.scheduler.setTimeout(() => undefined, 5)();
    expect(cleared).toEqual([9]);
    for (let i = 0; i < LOG_LIMIT + 5; i += 1) ports.log.event("op", { n: i });
    expect(ports.log.events).toHaveLength(LOG_LIMIT);
    expect(ports.log.events[0]).toEqual({ name: "op", at: 42, fields: { n: 5 } });
  });
});
