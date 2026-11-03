/**
 * Tap ripples.
 *
 * Ink spreads from the exact point touched, which is the cheapest honest
 * signal that a tap landed -- especially on a phone, where the finger covers
 * whatever visual feedback sits underneath it.
 *
 * Attached as a pointerdown handler rather than a click handler on purpose:
 * it should fire the instant the finger touches, not after the gesture
 * resolves into a click. A tap that turns into a scroll still gets its
 * ripple, which is correct -- the app did register the touch.
 */

/** Spawns a ripple inside the event's own element. Safe to pass directly. */
export function ripple(event: { currentTarget: EventTarget | null; clientX: number; clientY: number }): void {
  const host = event.currentTarget;
  if (!(host instanceof HTMLElement)) return;

  // Respect the setting: no ripple, no DOM churn.
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const box = host.getBoundingClientRect();
  const size = Math.max(box.width, box.height);

  const ink = document.createElement('span');
  ink.className = 'ink';
  ink.style.width = `${size}px`;
  ink.style.height = `${size}px`;
  ink.style.left = `${event.clientX - box.left - size / 2}px`;
  ink.style.top = `${event.clientY - box.top - size / 2}px`;

  host.appendChild(ink);

  // Longer than the 0.65s animation so it never vanishes mid-fade. Using a
  // timer rather than animationend because an interrupted animation (the
  // element unmounting, the tab hiding) never fires that event, and a
  // leaked node per tap would accumulate over a long session.
  window.setTimeout(() => ink.remove(), 750);
}
