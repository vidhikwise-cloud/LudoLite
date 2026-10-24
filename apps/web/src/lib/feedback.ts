/**
 * Sound and haptics.
 *
 * Every sound is synthesized with WebAudio rather than loaded from a file:
 * no assets to host, no CDN, nothing to cache, and the whole thing is about
 * 2KB. The tones are short, soft, and pitched to sit under conversation —
 * people play Ludo in a room together, and a shrill app is one people mute.
 *
 * Muted state persists. Browsers also block audio until the first gesture, so
 * the context is created lazily on the first real interaction.
 */

const MUTE_KEY = 'ludolite.muted';

let ctx: AudioContext | null = null;
let muted = readMuted();

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(value: boolean): void {
  muted = value;
  try {
    localStorage.setItem(MUTE_KEY, String(value));
  } catch {
    // Private mode; the setting just will not persist.
  }
}

/** Lazily create the context — browsers reject one made before a gesture. */
function audio(): AudioContext | null {
  if (muted) return null;
  if (ctx) {
    // Safari suspends the context when the tab backgrounds.
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  }
  try {
    const Ctor = window.AudioContext ?? (window as never as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new Ctor();
    return ctx;
  } catch {
    return null;
  }
}

interface ToneOptions {
  readonly freq: number;
  readonly durationMs: number;
  readonly type?: OscillatorType;
  readonly gain?: number;
  readonly delayMs?: number;
  /** Slide to this frequency over the tone's life. */
  readonly sweepTo?: number;
}

function tone(options: ToneOptions): void {
  const context = audio();
  if (!context) return;

  const { freq, durationMs, type = 'sine', gain = 0.09, delayMs = 0, sweepTo } = options;
  const start = context.currentTime + delayMs / 1000;
  const end = start + durationMs / 1000;

  const osc = context.createOscillator();
  const amp = context.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (sweepTo !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, sweepTo), end);
  }

  // Quick attack, smooth decay. A linear cut-off would click audibly.
  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.exponentialRampToValueAtTime(gain, start + 0.012);
  amp.gain.exponentialRampToValueAtTime(0.0001, end);

  osc.connect(amp).connect(context.destination);
  osc.start(start);
  osc.stop(end + 0.02);
}

/** Short noise burst — used for the dice tumble. */
function noise(durationMs: number, gain = 0.05, delayMs = 0): void {
  const context = audio();
  if (!context) return;

  const frames = Math.floor((context.sampleRate * durationMs) / 1000);
  const buffer = context.createBuffer(1, frames, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    // Decaying noise reads as something tumbling and settling.
    data[i] = (Math.random() * 2 - 1) * (1 - i / frames) ** 2;
  }

  const src = context.createBufferSource();
  const amp = context.createGain();
  const filter = context.createBiquadFilter();

  filter.type = 'bandpass';
  filter.frequency.value = 1400;
  amp.gain.value = gain;

  src.buffer = buffer;
  src.connect(filter).connect(amp).connect(context.destination);
  src.start(context.currentTime + delayMs / 1000);
}

// ---------------------------------------------------------------------------
// Haptics
// ---------------------------------------------------------------------------

function buzz(pattern: number | number[]): void {
  if (muted) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Unsupported or blocked; nothing to do.
  }
}

// ---------------------------------------------------------------------------
// The sounds themselves
// ---------------------------------------------------------------------------

export const sfx = {
  /** Dice tumbling, then the clack of it settling. */
  roll(): void {
    noise(380, 0.055);
    tone({ freq: 220, durationMs: 70, type: 'square', gain: 0.05, delayMs: 360 });
    buzz([12, 40, 12, 40, 22]);
  },

  /** One token hop. Deliberately tiny — it fires many times per move. */
  hop(): void {
    tone({ freq: 640, durationMs: 42, type: 'triangle', gain: 0.045 });
  },

  /** A token settling on its destination. */
  land(): void {
    tone({ freq: 480, durationMs: 110, type: 'triangle', gain: 0.07, sweepTo: 380 });
    buzz(14);
  },

  /** You knocked somebody out. Should feel good. */
  capture(): void {
    tone({ freq: 760, durationMs: 90, type: 'square', gain: 0.08, sweepTo: 240 });
    tone({ freq: 300, durationMs: 170, type: 'sawtooth', gain: 0.06, delayMs: 70, sweepTo: 150 });
    buzz([22, 36, 48]);
  },

  /** You got knocked out. Should not. */
  captured(): void {
    tone({ freq: 300, durationMs: 220, type: 'sine', gain: 0.07, sweepTo: 120 });
    buzz([40, 50, 40]);
  },

  /** A token reached the centre. */
  home(): void {
    [523, 659, 784].forEach((freq, i) =>
      tone({ freq, durationMs: 160, type: 'triangle', gain: 0.07, delayMs: i * 85 }),
    );
    buzz([18, 40, 18, 40, 30]);
  },

  /** Your turn has come round. */
  yourTurn(): void {
    tone({ freq: 587, durationMs: 110, type: 'sine', gain: 0.06 });
    tone({ freq: 784, durationMs: 150, type: 'sine', gain: 0.06, delayMs: 100 });
    buzz([16, 60, 16]);
  },

  /** Somebody joined the room. */
  join(): void {
    tone({ freq: 523, durationMs: 90, type: 'sine', gain: 0.05 });
    tone({ freq: 698, durationMs: 120, type: 'sine', gain: 0.05, delayMs: 80 });
  },

  /** Victory fanfare. */
  win(): void {
    [523, 659, 784, 1047].forEach((freq, i) =>
      tone({ freq, durationMs: 260, type: 'triangle', gain: 0.085, delayMs: i * 115 }),
    );
    buzz([40, 60, 40, 60, 90]);
  },

  /** Match over, somebody else won. */
  lose(): void {
    [440, 392, 330].forEach((freq, i) =>
      tone({ freq, durationMs: 240, type: 'sine', gain: 0.06, delayMs: i * 140 }),
    );
  },

  /** An illegal or impossible action. */
  nope(): void {
    tone({ freq: 180, durationMs: 120, type: 'square', gain: 0.05 });
    buzz(60);
  },
};
