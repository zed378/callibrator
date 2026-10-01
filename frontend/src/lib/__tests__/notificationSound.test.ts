/** @jest-environment jsdom */
/**
 * The notification chime: two short notes through Web Audio, resumed when
 * the browser suspended the context, silent when muted, and never throwing —
 * a missing or failing audio stack must not break the notification it
 * accompanies.
 */

interface FakeNode {
  connect: jest.Mock;
  start?: jest.Mock;
  stop?: jest.Mock;
  type?: string;
  frequency?: { value: number };
  gain?: { setValueAtTime: jest.Mock; exponentialRampToValueAtTime: jest.Mock };
}

const makeCtx = (state: "running" | "suspended") => {
  const oscillators: FakeNode[] = [];
  const ctx = {
    state,
    currentTime: 10,
    destination: {},
    resume: jest.fn().mockResolvedValue(undefined),
    createOscillator: jest.fn(() => {
      const osc: FakeNode = { connect: jest.fn((n) => n), start: jest.fn(), stop: jest.fn(), frequency: { value: 0 } };
      oscillators.push(osc);
      return osc;
    }),
    createGain: jest.fn(() => {
      const gain: FakeNode = {
        connect: jest.fn((n) => n),
        gain: { setValueAtTime: jest.fn(), exponentialRampToValueAtTime: jest.fn() },
      };
      return gain;
    }),
  };
  return { ctx, oscillators };
};

type AudioWindow = Window & { AudioContext?: unknown; webkitAudioContext?: unknown };
const w = window as AudioWindow;

// A fresh module per test: the module caches its AudioContext.
const load = () => {
  let mod!: typeof import("../notificationSound");
  jest.isolateModules(() => {
    mod = jest.requireActual("../notificationSound");
  });
  return mod;
};

afterEach(() => {
  delete w.AudioContext;
  delete w.webkitAudioContext;
});

describe("notificationSound", () => {
  it("plays two rising notes and reuses one audio context", () => {
    const { ctx, oscillators } = makeCtx("running");
    const Ctor = jest.fn(() => ctx);
    w.AudioContext = Ctor;
    const { playNotificationSound } = load();

    playNotificationSound();
    playNotificationSound();

    expect(Ctor).toHaveBeenCalledTimes(1);
    expect(oscillators.slice(0, 2).map((o) => o.frequency?.value)).toEqual([880, 1174.66]);
    expect(oscillators[0].start).toHaveBeenCalledWith(10);
    expect(oscillators[1].start).toHaveBeenCalledWith(10.12);
    expect(ctx.resume).not.toHaveBeenCalled();
  });

  it("resumes a context the browser suspended", () => {
    const { ctx } = makeCtx("suspended");
    w.AudioContext = jest.fn(() => ctx);
    load().playNotificationSound();

    expect(ctx.resume).toHaveBeenCalled();
  });

  it("uses the prefixed WebKit constructor when that is all there is", () => {
    const { ctx } = makeCtx("running");
    const Webkit = jest.fn(() => ctx);
    w.webkitAudioContext = Webkit;
    load().playNotificationSound();

    expect(Webkit).toHaveBeenCalled();
  });

  it("muted, it makes no sound, and the mute can be read back and lifted", () => {
    const { ctx } = makeCtx("running");
    const Ctor = jest.fn(() => ctx);
    w.AudioContext = Ctor;
    const mod = load();

    mod.setNotificationSoundMuted(true);
    expect(mod.isNotificationSoundMuted()).toBe(true);
    mod.playNotificationSound();
    expect(Ctor).not.toHaveBeenCalled();

    mod.setNotificationSoundMuted(false);
    mod.playNotificationSound();
    expect(Ctor).toHaveBeenCalledTimes(1);
  });

  it("no Web Audio, or a failing one, is silent and never throws", () => {
    const mod = load();
    expect(() => mod.playNotificationSound()).not.toThrow();

    w.AudioContext = jest.fn(() => {
      throw new Error("audio blocked");
    });
    expect(() => load().playNotificationSound()).not.toThrow();
  });
});
