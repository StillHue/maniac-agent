import { makeNoise3D } from './noise3D';

const COUNT = 6000;
const noise3D = makeNoise3D(7);

export function fibonacciSphere(count: number) {
  const thetas = new Float32Array(count);
  const phis = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const k = i + 0.5;
    phis[i] = Math.acos(1 - 2 * k / count);
    thetas[i] = Math.PI * (1 + Math.sqrt(5)) * k;
  }
  return { thetas, phis };
}

export type ShapeFn = (theta: number, phi: number, i: number) => [number, number, number];

export function generatePositions(fn: ShapeFn, thetas: Float32Array, phis: Float32Array): Float32Array {
  const out = new Float32Array(COUNT * 3);
  for (let i = 0; i < COUNT; i++) {
    const [x, y, z] = fn(thetas[i], phis[i], i);
    out[i * 3] = x;
    out[i * 3 + 1] = y;
    out[i * 3 + 2] = z;
  }
  return out;
}

const CR = 1.6;

const sphere: ShapeFn = (theta, phi) => [
  CR * Math.sin(phi) * Math.cos(theta),
  CR * Math.sin(phi) * Math.sin(theta),
  CR * Math.cos(phi),
];

const heart: ShapeFn = (theta, phi) => {
  const t = theta;
  const hx = 16 * Math.pow(Math.sin(t), 3);
  const hy = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
  const s = CR / 17;
  return [hx * Math.cos(phi) * s, hy * s - 0.15, hx * Math.sin(phi) * s];
};

const cube: ShapeFn = (theta, phi) => {
  const dx = Math.sin(phi) * Math.cos(theta);
  const dy = Math.sin(phi) * Math.sin(theta);
  const dz = Math.cos(phi);
  const m = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
  return [dx / m * CR * 0.95, dy / m * CR * 0.95, dz / m * CR * 0.95];
};

const torus: ShapeFn = (theta, phi) => {
  const major = CR * 0.85;
  const minor = CR * 0.35;
  return [
    (major + minor * Math.cos(phi)) * Math.cos(theta),
    minor * Math.sin(phi),
    (major + minor * Math.cos(phi)) * Math.sin(theta),
  ];
};

const star: ShapeFn = (theta, phi) => {
  const spikes = 5;
  const angle = Math.atan2(Math.sin(phi) * Math.sin(theta), Math.cos(phi));
  const mod = Math.abs(Math.cos(angle * spikes * 0.5));
  const rf = 1 - 0.5 * mod;
  return [
    rf * CR * Math.sin(phi) * Math.cos(theta),
    rf * CR * Math.sin(phi) * Math.sin(theta),
    rf * CR * Math.cos(phi),
  ];
};

const dna: ShapeFn = (theta, phi, i) => {
  const t = theta + phi * 2;
  const r1 = CR * 0.6;
  const twist = i * 0.01;
  return [
    r1 * Math.cos(t + twist) * (1 + 0.3 * Math.sin(phi * 4)),
    (i / COUNT) * CR * 2.2 - CR * 1.1,
    r1 * Math.sin(t + twist) * (1 + 0.3 * Math.sin(phi * 4)),
  ];
};

const bubble: ShapeFn = (theta, phi) => {
  const x = Math.sin(phi) * Math.cos(theta);
  const y = Math.sin(phi) * Math.sin(theta);
  const z = Math.cos(phi);
  const tail = 0.7 * Math.max(0, -x) * Math.exp(-Math.pow(y, 2) * 3 - Math.pow(z, 2) * 3);
  const r = CR + tail;
  const d = Math.sqrt(x * x + y * y + z * z) || 1;
  return [x / d * r, y / d * r, z / d * r];
};

const pencil: ShapeFn = (theta, phi, i) => {
  const height = (i / COUNT) * 3.4 - 1.7;
  const t = (height + 1.7) / 3.4;
  const tipEnd = 0.1;
  const maxR = CR * 0.35;
  const r = t < tipEnd ? (t / tipEnd) * maxR : maxR;
  return [r * Math.cos(theta), height, r * Math.sin(theta)];
};

const gear: ShapeFn = (theta, phi) => {
  const teeth = 10;
  const mod = 0.6 + 0.4 * Math.max(0, Math.cos(theta * teeth));
  return [
    mod * CR * Math.sin(phi) * Math.cos(theta),
    mod * CR * Math.sin(phi) * Math.sin(theta),
    mod * CR * Math.cos(phi),
  ];
};

export interface ShapeDef {
  name: string;
  label: string;
  fn: ShapeFn;
}

export const SHAPES: ShapeDef[] = [
  { name: 'sphere', label: '⬤ esfera', fn: sphere },
  { name: 'heart', label: '♥ coração', fn: heart },
  { name: 'bubble', label: '✎ balão', fn: bubble },
  { name: 'pencil', label: '✎ lápis', fn: pencil },
  { name: 'gear', label: '⚙ ferramenta', fn: gear },
  { name: 'cube', label: '◻ cubo', fn: cube },
  { name: 'torus', label: '◎ toro', fn: torus },
  { name: 'star', label: '★ estrela', fn: star },
  { name: 'dna', label: '⧖ dna', fn: dna },
];
