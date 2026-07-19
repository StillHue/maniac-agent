'use client';

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { AdditiveBlending, BufferAttribute, BufferGeometry, NormalBlending, Points } from 'three';
import { makeNoise3D } from './noise3D';
import { fibonacciSphere, generatePositions, SHAPES } from './shapes';

const COUNT = 6000;
const NOISE_SCALE = 1.8;
const AMPLITUDE = 0.25;
const SPEED = 0.4;
const MORPH_SPEED = 0.35;

const noise3D = makeNoise3D(7);

function smoothstep(t: number) { return t * t * (3 - 2 * t); }

interface Props {
  shapeIndex: number;
}

export default function Orb({ shapeIndex }: Props) {
  const ref = useRef<Points>(null);
  const morphT = useRef(1);
  const prevIdx = useRef(shapeIndex);

  const { thetas, phis } = useMemo(() => fibonacciSphere(COUNT), []);

  const allTargets = useMemo(
    () => SHAPES.map(s => generatePositions(s.fn, thetas, phis)),
    [thetas, phis]
  );

  const seeds = useMemo(() => {
    const s = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) s[i] = Math.random() * 1000;
    return s;
  }, []);

  const geo = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(allTargets[0]), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(COUNT * 3), 3));
    g.setAttribute('size', new BufferAttribute(new Float32Array(COUNT), 1));
    return g;
  }, [allTargets]);

  const fromArr = useMemo(() => new Float32Array(allTargets[0]), [allTargets]);
  const tmpArr = useMemo(() => new Float32Array(COUNT * 3), []);

  useEffect(() => {
    return () => { geo.dispose(); };
  }, [geo]);

  const prevTarget = useRef(allTargets[0]);
  useEffect(() => {
    if (prevIdx.current !== shapeIndex) {
      const pos = geo.attributes.position.array as Float32Array;
      fromArr.set(pos);
      prevTarget.current = allTargets[shapeIndex];
      morphT.current = 0;
      prevIdx.current = shapeIndex;
    }
  }, [shapeIndex, allTargets, fromArr, geo]);

  useFrame(({ clock }) => {
    if (!ref.current) return;
    const pos = ref.current.geometry.attributes.position.array as Float32Array;
    const col = ref.current.geometry.attributes.color.array as Float32Array;
    const sizeArr = ref.current.geometry.attributes.size.array as Float32Array;
    const time = clock.elapsedTime;
    const target = allTargets[shapeIndex];

    if (morphT.current < 1) {
      morphT.current = Math.min(1, morphT.current + MORPH_SPEED * 0.016);
      const t = smoothstep(morphT.current);
      for (let i = 0; i < COUNT; i++) {
        const i3 = i * 3;
        tmpArr[i3] = fromArr[i3] + (target[i3] - fromArr[i3]) * t;
        tmpArr[i3 + 1] = fromArr[i3 + 1] + (target[i3 + 1] - fromArr[i3 + 1]) * t;
        tmpArr[i3 + 2] = fromArr[i3 + 2] + (target[i3 + 2] - fromArr[i3 + 2]) * t;
      }
    }

    const base = morphT.current < 1 ? tmpArr : target;

    for (let i = 0; i < COUNT; i++) {
      const i3 = i * 3;
      const bx = base[i3], by = base[i3 + 1], bz = base[i3 + 2];
      const dirLen = Math.sqrt(bx * bx + by * by + bz * bz);
      if (dirLen < 0.001) { pos[i3] = bx; pos[i3 + 1] = by; pos[i3 + 2] = bz; continue; }

      const nx = bx * NOISE_SCALE + time * SPEED;
      const ny = by * NOISE_SCALE + time * SPEED * 0.7;
      const n = noise3D(nx, ny, 0) * AMPLITUDE;
      const ratio = (dirLen + n) / dirLen;
      pos[i3] = bx * ratio;
      pos[i3 + 1] = by * ratio;
      pos[i3 + 2] = bz * ratio;

      col[i3] = 0.63; col[i3 + 1] = 0.63; col[i3 + 2] = 0.63;
      sizeArr[i] = 0.025;
    }

    ref.current.geometry.attributes.position.needsUpdate = true;
    ref.current.geometry.attributes.color.needsUpdate = true;
    ref.current.geometry.attributes.size.needsUpdate = true;

    ref.current.rotation.y += 0.002;
  });

  return (
    <points ref={ref} geometry={geo}>
      <pointsMaterial
        size={0.025}
        color="#a1a1aa"
        vertexColors
        transparent
        opacity={0.95}
        sizeAttenuation
        depthWrite={false}
        blending={NormalBlending}
      />
    </points>
  );
}
