/**
 * Victory confetti.
 *
 * Canvas rather than DOM nodes — 140 animated elements would thrash layout,
 * and this runs on phones. Pieces are Ludo's four token colours, so the
 * celebration still belongs to this board rather than looking bolted on.
 *
 * Respects prefers-reduced-motion by not running at all.
 */

import { useEffect, useRef } from 'react';

interface Piece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rotation: number;
  spin: number;
  colour: string;
}

const COLOURS = ['--red', '--green', '--yellow', '--blue'];

export function Confetti({ active }: { active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!active) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      canvas.width = canvas.offsetWidth * dpr;
      canvas.height = canvas.offsetHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const styles = getComputedStyle(document.documentElement);
    const palette = COLOURS.map((name) => styles.getPropertyValue(name).trim() || '#D64045');

    const width = canvas.offsetWidth;
    const height0 = canvas.offsetHeight;
    const pick = () => palette[Math.floor(Math.random() * palette.length)] ?? '#EF4352';

    /*
     * Two populations, because a single falling curtain reads as weather
     * rather than as a celebration:
     *
     *   cannons  fired up and inward from the bottom corners at the moment
     *            of the win. This is the burst -- fast, wide, and over in
     *            about a second.
     *   fall     a slower curtain drifting down behind it, which is what
     *            keeps the screen alive while the result sinks in.
     */
    const cannon = (originX: number, direction: number): Piece[] =>
      Array.from({ length: 70 }, () => {
        // Aim up and inward, with spread. Straight up looks like a fountain.
        const angle = -Math.PI / 2 + direction * (0.15 + Math.random() * 0.5);
        const speed = 11 + Math.random() * 9;
        return {
          x: originX,
          y: height0 + 10,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          size: 6 + Math.random() * 8,
          rotation: Math.random() * Math.PI * 2,
          spin: (Math.random() - 0.5) * 0.4,
          colour: pick(),
        };
      });

    const falling: Piece[] = Array.from({ length: 110 }, () => ({
      x: Math.random() * width,
      // Start above the viewport so they fall in rather than appearing.
      y: -20 - Math.random() * 500,
      vx: (Math.random() - 0.5) * 1.6,
      vy: 2 + Math.random() * 3.4,
      size: 5 + Math.random() * 7,
      rotation: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 0.22,
      colour: pick(),
    }));

    const pieces: Piece[] = [
      ...cannon(0, 1),
      ...cannon(width, -1),
      ...falling,
    ];

    let frame = 0;
    let raf = 0;

    const draw = () => {
      const height = canvas.offsetHeight;
      ctx.clearRect(0, 0, width, height);
      frame++;

      let visible = 0;
      for (const piece of pieces) {
        piece.x += piece.vx;
        piece.y += piece.vy;
        piece.vy += 0.085; // gravity
        piece.vx += Math.sin((frame + piece.size) * 0.02) * 0.04; // drift
        piece.rotation += piece.spin;

        // Cannon pieces start below the viewport, so only cull downward
        // travel -- culling on position alone would delete them at birth.
        if (piece.y > height + 20 && piece.vy > 0) continue;
        visible++;

        ctx.save();
        ctx.translate(piece.x, piece.y);
        ctx.rotate(piece.rotation);
        ctx.fillStyle = piece.colour;
        // Rectangles read as paper; circles read as bubbles.
        ctx.fillRect(-piece.size / 2, -piece.size / 4, piece.size, piece.size / 2);
        ctx.restore();
      }

      // Stop once everything has fallen past the bottom.
      if (visible > 0) raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    window.addEventListener('resize', resize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [active]);

  if (!active) return null;

  return <canvas ref={canvasRef} className="confetti" aria-hidden="true" />;
}
