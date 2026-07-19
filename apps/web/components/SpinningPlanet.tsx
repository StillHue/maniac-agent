'use client';

import { useEffect, useRef } from 'react';

const CHARS = ' .,:;=!*#$@';
const W = 48;
const H = 28;

export default function SpinningPlanet() {
  const ref = useRef<HTMLPreElement>(null);

  useEffect(() => {
    let id: number;
    let frame = 0;

    const render = () => {
      frame++;
      const A = frame * 0.025;
      const B = frame * 0.015;
      const sinA = Math.sin(A), cosA = Math.cos(A);
      const sinB = Math.sin(B), cosB = Math.cos(B);
      const lines: string[] = [];

      for (let y = 0; y < H; y++) {
        let row = '';
        for (let x = 0; x < W; x++) {
          const u = (x / W) * 2 - 1;
          const v = (y / H) * 2 - 1;
          const u2 = u;

          const r2 = u2 * u2 + v * v;
          if (r2 > 1) {
            row += ' ';
            continue;
          }

          const z = Math.sqrt(1 - r2);
          const nx = u2, ny = v, nz = z;

          const rx = nx * cosA + nz * sinA;
          const rz = -nx * sinA + nz * cosA;
          const ry = ny * cosB + rz * sinB;
          const rrx = rx;
          const rry = ry;
          const rrz = -ny * sinB + rz * cosB;

          const lx = 0.5, ly = -0.3, lz = 0.8;
          const len = Math.sqrt(lx * lx + ly * ly + lz * lz);
          const dot = (rrx * lx + rry * ly + rrz * lz) / len;
          const bright = Math.max(0, dot * 0.55 + 0.45);

          const continent = Math.sin(nx * 5 + 0.3) * Math.cos(ny * 4 + 1.7) * Math.sin(nz * 3 + 2.1);
          const isLand = continent > 0.15;
          const final = Math.min(1, bright * (isLand ? 0.95 : 0.65));
          row += CHARS[Math.floor(final * (CHARS.length - 1))];
        }
        lines.push(row);
      }

      if (ref.current) ref.current.textContent = lines.join('\n');
      id = requestAnimationFrame(render);
    };

    id = requestAnimationFrame(render);
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <pre
      ref={ref}
      style={{
        color: '#ffffff',
        fontSize: '0.3rem',
        lineHeight: 1.15,
        margin: 0,
      }}
    />
  );
}
