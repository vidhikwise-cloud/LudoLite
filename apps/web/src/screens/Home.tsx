import type { PublicConfig } from '@ludolite/shared';

import { BrandBar, TickIcon } from '../components/Brand.js';
import { MuteToggle } from '../components/MuteToggle.js';

/**
 * Home.
 *
 * The headline carries the price so nobody discovers the fee late. The three
 * promises are the product's actual constraints rather than marketing — each
 * is something the codebase is forbidden from doing.
 *
 * "No cash prizes" sits here on purpose: the Act's test turns on whether
 * players can win money, so a product that never pays out should say so
 * where a reviewer lands first.
 */
export function Home({
  config,
  onCreate,
  onJoin,
  onPlayComputer,
}: {
  config: PublicConfig | null;
  onCreate: () => void;
  onJoin: () => void;
  onPlayComputer: () => void;
}) {
  return (
    <>
      <BrandBar>
        <MuteToggle />
      </BrandBar>

      <div>
        <h1 className="headline">
          Ludo With Friends. <span className="rupee">₹1</span> Per Hosted Match.
        </h1>
        <p className="sub">
          No paid ads. No monthly subscription. Create a room and invite your friends.
        </p>
      </div>

      <div className="btn-stack">
        <button type="button" className="btn btn-primary" onClick={onCreate}>
          Create Private Room
        </button>
        <button type="button" className="btn btn-ghost" onClick={onJoin}>
          Join With Room Code
        </button>
        {/* Nobody to play with right now is the most common reason someone
            opens and closes a multiplayer game. */}
        <button type="button" className="btn btn-ghost" onClick={onPlayComputer}>
          Play Against the Computer
        </button>
      </div>

      <div className="promises">
        <div className="promise" style={{ color: 'var(--green)' }}>
          <TickIcon />
          <span style={{ color: 'var(--ink-2)' }}>
            <b style={{ color: 'var(--ink)' }}>Zero paid ads.</b> No banners, no forced videos.
          </span>
        </div>
        <div className="promise" style={{ color: 'var(--green)' }}>
          <TickIcon />
          <span style={{ color: 'var(--ink-2)' }}>
            <b style={{ color: 'var(--ink)' }}>Only the host pays.</b> Friends join free.
          </span>
        </div>
        <div className="promise" style={{ color: 'var(--green)' }}>
          <TickIcon />
          <span style={{ color: 'var(--ink-2)' }}>
            <b style={{ color: 'var(--ink)' }}>No cash prizes.</b> Play for bragging rights.
          </span>
        </div>
      </div>

      {config && !config.paidHostingEnabled ? (
        <p className="footnote">
          Free private matches are available while paid hosting is being prepared.
        </p>
      ) : null}
    </>
  );
}
