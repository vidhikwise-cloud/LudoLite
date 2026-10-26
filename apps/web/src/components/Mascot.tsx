/**
 * Pippo, the fox.
 *
 * A recurring character who reacts to what just happened: cheers a capture,
 * winces when you get cut, celebrates a win, naps while nobody is playing.
 * He is the one element in the app with a personality, and personality is
 * what makes a game feel like somewhere rather than something.
 *
 * Drawn as SVG rather than shipped as images or GIFs:
 *
 *   * one file, no assets, nothing to host or cache
 *   * crisp at any size on any screen, which a raster mascot is not
 *   * expressions are a prop rather than a different file each, so adding
 *     one is a few path changes and not a new download
 *
 * Deliberately never says anything discouraging. A mascot that taunts you
 * after a loss is a mascot people turn off.
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

/**
 * A line for a mood, chosen by index rather than randomly.
 *
 * Callers pass a counter (turn number, match id hash) so the same render
 * produces the same line. Randomising here would reshuffle the text on
 * every React re-render, which reads as the mascot talking over itself.
 */
export function mascotLine(mood: Mood, seed: number): string {
  const lines = LINES[mood];
  return lines[Math.abs(seed) % lines.length] ?? lines[0] ?? '';
}

export function Mascot({
  mood = 'idle',
  size = 72,
}: {
  mood?: Mood;
  size?: number;
}) {
  // Eyes, brows and mouth carry the whole expression. The body never
  // changes, which is what keeps him recognisably the same character.
  const asleep = mood === 'sleeping';
  const shut = asleep;
  const wide = mood === 'cheer' || mood === 'worried';

  // The viewBox is cropped to the art's real bounds -- ear tips sit at
  // y=12 and the shadow at y=97, so a nominal 0..100 box renders the fox
  // small inside his own padding at every call site. Kept square (92x92) so
  // width and height stay in proportion and he is not stretched.
  return (
    <svg
      className={`mascot mascot-${mood}`}
      width={size}
      height={size}
      viewBox="4 6 92 92"
      role="img"
      aria-label={`Pippo the fox looks ${mood}`}
    >
      <defs>
        <radialGradient id="foxFur" cx="38%" cy="28%" r="78%">
          <stop offset="0%" stopColor="#ff9d5c" />
          <stop offset="60%" stopColor="#f4793a" />
          <stop offset="100%" stopColor="#d85f27" />
        </radialGradient>
        <radialGradient id="foxBelly" cx="50%" cy="34%" r="70%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#ffeede" />
        </radialGradient>
      </defs>

      {/* Contact shadow: he is standing on something. */}
      <ellipse cx="50" cy="92" rx="26" ry="5" fill="#2a211d" opacity="0.14" />

      <g className="mascot-body">
        {/* Ears. Tilted outward so the silhouette reads as a fox at a glance,
            which matters at 40px in the corner of a lobby. */}
        <path d="M22 38 L16 12 L40 26 Z" fill="url(#foxFur)" />
        <path d="M78 38 L84 12 L60 26 Z" fill="url(#foxFur)" />
        <path d="M25 35 L22 19 L36 27 Z" fill="#ffd0b0" opacity="0.85" />
        <path d="M75 35 L78 19 L64 27 Z" fill="#ffd0b0" opacity="0.85" />

        {/* Head */}
        <ellipse cx="50" cy="52" rx="33" ry="30" fill="url(#foxFur)" />

        {/* Cheeks and muzzle */}
        <ellipse cx="50" cy="64" rx="22" ry="17" fill="url(#foxBelly)" />

        {/* Brows: the fastest signal of mood after the eyes. */}
        {mood === 'worried' ? (
          <>
            <path d="M30 36 L44 41" stroke="#b44f1c" strokeWidth="3" strokeLinecap="round" />
            <path d="M70 36 L56 41" stroke="#b44f1c" strokeWidth="3" strokeLinecap="round" />
          </>
        ) : null}
        {mood === 'thinking' ? (
          <path d="M28 37 L44 35" stroke="#b44f1c" strokeWidth="3" strokeLinecap="round" />
        ) : null}

        {/* Eyes */}
        {shut ? (
          <>
            <path d="M33 54 Q38 50 43 54" stroke="#3a2416" strokeWidth="3" fill="none" strokeLinecap="round" />
            <path d="M57 54 Q62 50 67 54" stroke="#3a2416" strokeWidth="3" fill="none" strokeLinecap="round" />
          </>
        ) : (
          <>
            <ellipse className="mascot-eye" cx="38" cy="51" rx={wide ? 6 : 5} ry={wide ? 7 : 6} fill="#3a2416" />
            <ellipse className="mascot-eye" cx="62" cy="51" rx={wide ? 6 : 5} ry={wide ? 7 : 6} fill="#3a2416" />
            {/* Catchlights. Without these the eyes read as dead buttons. */}
            <circle cx="40" cy="49" r="2" fill="#fff" opacity="0.95" />
            <circle cx="64" cy="49" r="2" fill="#fff" opacity="0.95" />
          </>
        )}

        {/* Nose */}
        <ellipse cx="50" cy="62" rx="5" ry="4" fill="#3a2416" />

        {/* Mouth, per mood */}
        {mood === 'cheer' || mood === 'happy' ? (
          <path
            d="M42 68 Q50 77 58 68"
            stroke="#3a2416"
            strokeWidth="2.6"
            fill={mood === 'cheer' ? '#c4443f' : 'none'}
            strokeLinecap="round"
          />
        ) : mood === 'sad' ? (
          <path d="M43 73 Q50 67 57 73" stroke="#3a2416" strokeWidth="2.6" fill="none" strokeLinecap="round" />
        ) : mood === 'worried' ? (
          <path d="M44 71 L56 71" stroke="#3a2416" strokeWidth="2.6" strokeLinecap="round" />
        ) : (
          <path d="M44 69 Q50 73 56 69" stroke="#3a2416" strokeWidth="2.4" fill="none" strokeLinecap="round" />
        )}

        {/* Blush on the happy moods */}
        {mood === 'cheer' || mood === 'happy' ? (
          <>
            <ellipse cx="26" cy="62" rx="6" ry="4" fill="#ff8a8a" opacity="0.5" />
            <ellipse cx="74" cy="62" rx="6" ry="4" fill="#ff8a8a" opacity="0.5" />
          </>
        ) : null}
      </g>

      {/* Sleep bubbles, drawn outside the body group so the bob animation
          on the body does not drag them around. */}
      {asleep ? (
        <g className="mascot-zzz">
          <text x="74" y="30" fontSize="13" fill="#9c8d85" fontWeight="700">
            z
          </text>
          <text x="84" y="19" fontSize="10" fill="#9c8d85" fontWeight="700">
            z
          </text>
        </g>
      ) : null}
    </svg>
  );
}

/** The mascot with a speech bubble beside it. */
export function MascotSays({
  mood = 'idle',
  line,
  size = 64,
}: {
  mood?: Mood;
  line: string;
  size?: number;
}) {
  return (
    <div className="mascotsays">
      <Mascot mood={mood} size={size} />
      <p className="mascot-bubble">{line}</p>
    </div>
  );
}
