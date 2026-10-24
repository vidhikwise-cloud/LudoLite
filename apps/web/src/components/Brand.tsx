/**
 * Four round tokens around a centre diamond — the shape of a Ludo board,
 * rather than four squares, which read as a generic app grid.
 */
export function LudoMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" aria-hidden="true">
      <circle cx="7" cy="7" r="5.2" fill="var(--red)" />
      <circle cx="19" cy="7" r="5.2" fill="var(--green)" />
      <circle cx="7" cy="19" r="5.2" fill="var(--blue)" />
      <circle cx="19" cy="19" r="5.2" fill="var(--yellow)" />
      <path d="M13 9.6 16.4 13 13 16.4 9.6 13Z" fill="var(--ink)" opacity="0.22" />
    </svg>
  );
}

export function BrandBar({ children }: { children?: React.ReactNode }) {
  return (
    <div className="brandbar">
      <LudoMark />
      <b>Ludo With Friends</b>
      {children ? <span className="spacer">{children}</span> : null}
    </div>
  );
}

export function TickIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 17 17" aria-hidden="true">
      <circle cx="8.5" cy="8.5" r="7.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M5 8.7l2.4 2.4L12 6.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function InfoIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 17 17" aria-hidden="true">
      <circle cx="8.5" cy="8.5" r="7.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8.5 5v4.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="8.5" cy="12" r="1" fill="currentColor" />
    </svg>
  );
}
