/**
 * The buddy.
 *
 * A character who reacts to what just happened: cheers a capture, winces
 * when you get cut, celebrates a win, naps while nobody is playing. It is
 * the one element in the app with a personality, and personality is what
 * makes a game feel like somewhere rather than something.
 *
 * It wears WHOEVER THE PLAYER PICKED. Choosing the fox avatar means a fox
 * follows you around the app; pick the panda and the panda does. Tying the
 * character to the avatar makes the choice matter everywhere instead of
 * being a thumbnail on one screen, and it means twelve characters ship for
 * the price of one.
 *
 * The face is an emoji, which is why that is affordable: it renders
 * natively at any size, costs no download, and already reads as friendly to
 * both children and adults. What makes it a character rather than clip art
 * is everything around it -- the lit disc it sits on, the contact shadow,
 * and a distinct motion per mood.
 */

export type Mood =
  | 'idle'
  | 'happy'
  | 'cheer'
  | 'worried'
  | 'sad'
  | 'thinking'
  | 'sleeping';

const LINES: Readonly<Record<Mood, readonly string[]>> = {
  idle: ['Ready when you are.', 'Who are we playing?', 'Roll one for me.'],
  happy: ['Lovely move.', 'That worked.', 'Good spot.'],
  cheer: ['Got them!', 'Straight home!', 'What a roll!'],
  worried: ['Careful now.', 'They are close.', 'Mind that one.'],
  sad: ['Unlucky.', 'Next one is yours.', 'Shake it off.'],
  thinking: ['Hmm.', 'Let me see.', 'Working on it.'],
  sleeping: ['Zzz.', 'Wake me for the dice.'],
};

/** Tint of the disc behind the character, per mood. */
const TINT: Readonly<Record<Mood, string>> = {
  idle: 'var(--blue)',
  happy: 'var(--green)',
  cheer: 'var(--yellow)',
  worried: 'var(--red)',
  sad: 'var(--blue)',
  thinking: 'var(--blue)',
  sleeping: 'var(--ink-3)',
};

/**
 * A line for a mood, chosen by index rather than randomly.
 *
 * Callers pass a counter (turn number, match version) so the same render
 * produces the same line. Randomising here would reshuffle the text on
 * every React re-render, which reads as the character talking over itself.
 */
export function mascotLine(mood: Mood, seed: number): string {
  const lines = LINES[mood];
  return lines[Math.abs(seed) % lines.length] ?? lines[0] ?? '';
}

export function Mascot({
  avatar,
  mood = 'idle',
  size = 72,
}: {
  avatar: string;
  mood?: Mood;
  size?: number;
}) {
  return (
    <span
      className={`mascot mascot-${mood}`}
      style={{
        ['--m-size' as string]: `${size}px`,
        ['--tint' as string]: TINT[mood],
      }}
      role="img"
      aria-label={`Your buddy looks ${mood}`}
    >
      <span className="mascot-disc" aria-hidden="true">
        <span className="mascot-face">{avatar}</span>
      </span>
      {mood === 'sleeping' ? (
        <span className="mascot-zzz" aria-hidden="true">
          <i>z</i>
          <i>z</i>
        </span>
      ) : null}
      {mood === 'cheer' ? (
        <span className="mascot-spark" aria-hidden="true">
          <i>✨</i>
          <i>✨</i>
        </span>
      ) : null}
    </span>
  );
}

/** The character with a speech bubble beside it. */
export function MascotSays({
  avatar,
  mood = 'idle',
  line,
  size = 64,
}: {
  avatar: string;
  mood?: Mood;
  line: string;
  size?: number;
}) {
  return (
    <div className="mascotsays">
      <Mascot avatar={avatar} mood={mood} size={size} />
      <p className="mascot-bubble">{line}</p>
    </div>
  );
}
