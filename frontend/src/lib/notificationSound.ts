// src/lib/notificationSound.ts
//
// Plays a short two-tone notification chime using the Web Audio API — no audio
// asset required. Best-effort: browsers may suspend audio until a user gesture,
// so we resume the context on play and swallow any error.

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };

let audioCtx: AudioContext | null = null;
let muted = false;

export function setNotificationSoundMuted(value: boolean): void {
  muted = value;
}

export function isNotificationSoundMuted(): boolean {
  return muted;
}

export function playNotificationSound(): void {
  if (typeof window === "undefined" || muted) return;
  try {
    const Ctx =
      window.AudioContext || (window as WebkitWindow).webkitAudioContext;
    if (!Ctx) return;

    audioCtx = audioCtx || new Ctx();
    const ctx = audioCtx;
    if (ctx.state === "suspended") {
      void ctx.resume();
    }

    const now = ctx.currentTime;
    // A pleasant rising two-note chime (A5 → D6).
    const notes = [
      { freq: 880.0, at: 0 },
      { freq: 1174.66, at: 0.12 },
    ];

    for (const { freq, at } of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      // Quick attack, gentle decay.
      gain.gain.setValueAtTime(0.0001, now + at);
      gain.gain.exponentialRampToValueAtTime(0.16, now + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.26);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + at);
      osc.stop(now + at + 0.28);
    }
  } catch {
    // Sound is best-effort; never throw.
  }
}

export default playNotificationSound;
