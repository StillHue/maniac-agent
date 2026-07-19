'use client';

import { Canvas } from '@react-three/fiber';
import { Suspense } from 'react';
import Orb from './Orb';

interface Props {
  shapeIndex: number;
}

export default function OrbScene({ shapeIndex }: Props) {
  return (
    <div style={{ width: '160px', height: '160px', margin: '0 auto' }}>
      <Canvas
        camera={{ position: [0, 0, 4.5], fov: 50 }}
        gl={{ alpha: false, antialias: true }}
        style={{ background: '#000000' }}
      >
        <Suspense fallback={null}>
          <Orb shapeIndex={shapeIndex} />
        </Suspense>
      </Canvas>
    </div>
  );
}
