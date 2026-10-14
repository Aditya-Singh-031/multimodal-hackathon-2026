"use client";
// TEMPORARY orientation probe — deleted after pin calibration.
import { Canvas } from "@react-three/fiber";
import { Html, useGLTF } from "@react-three/drei";
import { Suspense, useMemo } from "react";
import * as THREE from "three";

const HEART_URL = `${process.env.NEXT_PUBLIC_BASE_PATH || ""}/models/heart.glb`;

function M() {
  const { scene } = useGLTF(HEART_URL);
  const obj = useMemo(() => {
    const c = scene.clone(true);
    const box = new THREE.Box3().setFromObject(c);
    const s = 2 / (box.max.y - box.min.y);
    const ctr = box.getCenter(new THREE.Vector3());
    const g = new THREE.Group();
    c.position.sub(ctr);
    g.add(c);
    g.scale.setScalar(s);
    return g;
  }, [scene]);
  return <primitive object={obj} />;
}

export default function Page() {
  const dir = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("d") ?? "0,0,4" : "0,0,4";
  const pos = dir.split(",").map(Number) as [number, number, number];
  const marks: [string, [number, number, number]][] = [["+X", [1.1, 0, 0]], ["-X", [-1.1, 0, 0]], ["+Y", [0, 1.1, 0]], ["-Y", [0, -1.1, 0]], ["+Z", [0, 0, 1.1]], ["-Z", [0, 0, -1.1]]];
  return (
    <div style={{ width: 700, height: 700, background: "#111" }}>
      <Canvas camera={{ position: pos, fov: 45 }}>
        <ambientLight intensity={1.2} />
        <directionalLight position={pos} intensity={2} />
        <Suspense fallback={null}><M /></Suspense>
        <axesHelper args={[1.4]} />
        {marks.map(([l, p]) => <Html key={l} position={p}><b style={{ color: "#ff0", fontSize: 18 }}>{l}</b></Html>)}
        {Array.from({ length: 9 }).map((_, i) => Array.from({ length: 9 }).map((_, j) => {
          const x = -0.8 + i * 0.2, y = -0.8 + j * 0.2;
          return <Html key={`${i}-${j}`} position={[x, y, pos[2] > 0 ? 1.2 : -1.2]} center><span style={{ color: "#0ff", fontSize: 8 }}>{x.toFixed(1)},{y.toFixed(1)}</span></Html>;
        }))}
      </Canvas>
    </div>
  );
}
