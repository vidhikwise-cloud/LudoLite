import { useEffect, useRef } from 'react';

/**
 * The ambient particle field.
 *
 * A slow drift of seat-coloured motes behind the whole app. It is pure
 * atmosphere -- nothing is readable from it and nothing responds to it --
 * and it exists to stop the app reading as a static sheet between turns.
 *
 * Three things keep it from being a battery problem on a phone, which
 * matters more here than on a desktop page:
 *
 *   1. It stops drawing entirely when the tab is hidden. A canvas nobody is
 *      looking at must not cost anything.
 *   2. It is capped by area rather than fixed, so a small phone draws far
 *      fewer particles than a tablet instead of the same count either way.
 *   3. It never starts at all under `prefers-reduced-motion` -- the hook
 *      returns before allocating the context, so there is no loop to pause.
 *
 * Drawn on a canvas rather than as DOM nodes because fifty independently
 * animated elements is fifty things for the compositor to track on every
 * frame; one canvas is one.
 */
export function Sky() {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    // Asked for less motion: draw nothing, ever. The CSS also hides the
    // element, but not allocating the loop is what actually saves the work.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const COLOURS = ['#ffb612', '#ff4d5d', '#00a868', '#3e7bfa', '#7a5cf0'];

    type Mote = { x: number; y: number; r: number; vx: number; vy: number; c: string; a: number };
    let motes: Mote[] = [];
    let width = 0;
    let height = 0;
    let frame = 0;
    let running = true;

    function reset(): void {
      width = canvas!.width = window.innerWidth;
      height = canvas!.height = window.innerHeight;

      // Roughly one mote per 26,000 css pixels, clamped. A 360px phone gets
      // about 10; a desktop gets the cap.
      const count = Math.max(8, Math.min(46, Math.round((width * height) / 26000)));

      motes = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        r: 1 + Math.random() * 2.6,
        vx: (Math.random() - 0.5) * 0.22,
        vy: -0.1 - Math.random() * 0.28,
        c: COLOURS[Math.floor(Math.random() * COLOURS.length)]!,
        a: 0.14 + Math.random() * 0.3,
      }));
    }

    function draw(): void {
      if (!running) return;
      ctx!.clearRect(0, 0, width, height);

      for (const m of motes) {
        m.x += m.vx;
        m.y += m.vy;

        // Wrap rather than respawn, so the field never visibly thins out.
        if (m.y < -12) {
          m.y = height + 12;
          m.x = Math.random() * width;
        }
        if (m.x < -12) m.x = width + 12;
        if (m.x > width + 12) m.x = -12;

        ctx!.globalAlpha = m.a;
        ctx!.fillStyle = m.c;
        ctx!.beginPath();
        ctx!.arc(m.x, m.y, m.r, 0, Math.PI * 2);
        ctx!.fill();
      }

      ctx!.globalAlpha = 1;
      frame = requestAnimationFrame(draw);
    }

    function onVisibility(): void {
      running = !document.hidden;
      if (running) frame = requestAnimationFrame(draw);
      else cancelAnimationFrame(frame);
    }

    reset();
    frame = requestAnimationFrame(draw);
    window.addEventListener('resize', reset);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      running = false;
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', reset);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return <canvas ref={ref} className="sky" aria-hidden="true" />;
}
