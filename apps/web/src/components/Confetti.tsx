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
    const pieces: Piece[] = Array.from({ length: 140 }, () => ({
      x: Math.random() * width,
      // Start above the viewport so they fall in rather than appearing.
      y: -20 - Math.random() * 400,
      vx: (Math.random() - 0.5) * 1.6,
      vy: 2 + Math.random() * 3.4,
      size: 5 + Math.random() * 7,
      rotation: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 0.22,
      colour: palette[Math.floor(Math.random() * palette.length)] ?? '#D64045',
    }));

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
        piece.vy += 0.035; // gravity
        piece.vx += Math.sin((frame + piece.size) * 0.02) * 0.04; // drift
        piece.rotation += piece.spin;

        if (piece.y > height + 20) continue;
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
