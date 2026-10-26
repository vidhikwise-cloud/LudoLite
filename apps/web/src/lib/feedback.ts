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

/**
 * One wooden knock: a die striking a table, or another die.
 *
 * A real impact is a burst of noise shaped by the resonance of whatever was
 * hit, not a tone. So this is a very short noise transient through a
 * bandpass with a high Q, which rings briefly at the filter frequency the
 * way a small hard object does. Varying `freq` across several knocks is
 * what makes a handful of them read as different objects rather than one
 * sound repeated.
 */
function knock({
  freq = 900,
  durationMs = 55,
  gain = 0.1,
  delayMs = 0,
  q = 7,
}: {
  freq?: number;
  durationMs?: number;
  gain?: number;
  delayMs?: number;
  q?: number;
}): void {
  const context = audio();
  if (!context) return;

  const frames = Math.max(1, Math.floor((context.sampleRate * durationMs) / 1000));
  const buffer = context.createBuffer(1, frames, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    // Sharp attack, fast exponential decay: the envelope of a hard strike.
    const t = i / frames;
    data[i] = (Math.random() * 2 - 1) * Math.exp(-t * 18);
  }

  const src = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const amp = context.createGain();

  filter.type = 'bandpass';
  filter.frequency.value = freq;
  filter.Q.value = q;
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
  /**
   * A die rattling in a cup and landing on wood.
   *
   * Seven knocks over ~420ms with irregular spacing and pitch, getting
   * quieter and more spread out, then a final heavier one as it settles.
   * Even spacing reads as a machine; the irregularity is what makes it a
   * physical object bouncing.
   */
  roll(): void {
    const hits: ReadonlyArray<readonly [number, number, number]> = [
      // [delayMs, freq, gain]
      [0, 1500, 0.1],
      [38, 1150, 0.09],
      [88, 1750, 0.075],
      [150, 1280, 0.065],
      [222, 1600, 0.05],
      [300, 1050, 0.04],
      [368, 1380, 0.03],
    ];
    for (const [delayMs, freq, gain] of hits) {
      knock({ delayMs, freq, gain, durationMs: 42, q: 9 });
    }
    // The settle: lower, longer, with a little body under it.
    knock({ delayMs: 430, freq: 420, gain: 0.12, durationMs: 110, q: 3.5 });
    tone({ freq: 160, durationMs: 90, type: 'sine', gain: 0.05, delayMs: 430, sweepTo: 110 });
    buzz([10, 28, 8, 34, 10, 46, 18]);
  },

  /**
   * One token hop: a counter tapping the board.
   *
   * Fires many times per move, so it must be tiny and must not accumulate
   * into a drone. A short high knock rather than a tone -- a pitched beep
   * repeated eight times in a row is the fastest way to make someone mute a
   * game.
   */
  hop(): void {
    knock({ freq: 2000, durationMs: 26, gain: 0.05, q: 6 });
  },

  /** A token settling on its destination: the same click with weight under it. */
  land(): void {
    knock({ freq: 900, durationMs: 70, gain: 0.1, q: 4 });
    tone({ freq: 300, durationMs: 90, type: 'sine', gain: 0.045, sweepTo: 220 });
    buzz(14);
  },

  /**
   * You knocked somebody out. Should feel good.
   *
   * A hard wooden crack -- one counter striking another -- then a short
   * scatter as the loser's piece skitters off, and a rising pair of tones
   * underneath so the whole thing reads as a win rather than a collision.
   */
  capture(): void {
    knock({ freq: 1250, durationMs: 60, gain: 0.14, q: 5 });
    knock({ delayMs: 55, freq: 780, gain: 0.09, durationMs: 70, q: 4 });
    noise(150, 0.05, 70);
    tone({ freq: 520, durationMs: 110, type: 'triangle', gain: 0.07, delayMs: 60, sweepTo: 760 });
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
