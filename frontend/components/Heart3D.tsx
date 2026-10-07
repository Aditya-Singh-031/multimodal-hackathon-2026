"use client";
import { Canvas, useFrame } from "@react-three/fiber";
import { Center, Float, OrbitControls, useGLTF } from "@react-three/drei";
import { Suspense, useMemo, useRef } from "react";
import * as THREE from "three";

interface HeartProps {
  color: string;
  bpm: number;
  risk: number;
  vessels: string[];
}

// 3D anatomical vessel markers mapped to coronary artery branches
const VESSEL_PINS: { id: string; label: string; pos: [number, number, number] }[] = [
  { id: "LAD", label: "LAD (Anterior Descending)", pos: [0.15, -0.15, 0.75] },
  { id: "LCx", label: "LCx (Circumflex)", pos: [-0.65, 0.15, 0.25] },
  { id: "RCA", label: "RCA (Right Coronary)", pos: [0.65, 0.05, 0.35] },
  { id: "LM", label: "LM (Left Main)", pos: [-0.05, 0.55, 0.45] },
];

function VesselMarker({ id, isAtRisk, risk, pos }: { id: string; isAtRisk: boolean; risk: number; pos: [number, number, number] }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const ringRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (!meshRef.current || !ringRef.current) return;
    const t = clock.elapsedTime * 3;
    if (isAtRisk) {
      const pulse = 1 + Math.sin(t) * 0.25;
      meshRef.current.scale.setScalar(pulse);
      ringRef.current.scale.setScalar(1 + (Math.sin(t * 1.5) + 1) * 0.4);
    }
  });

  const markerColor = isAtRisk ? "#f43f5e" : "#34d399";
  const glowIntensity = isAtRisk ? 0.9 : 0.2;

  return (
    <group position={pos}>
      <mesh ref={meshRef}>
        <sphereGeometry args={[0.07, 16, 16]} />
        <meshStandardMaterial
          color={markerColor}
          emissive={markerColor}
          emissiveIntensity={glowIntensity}
          roughness={0.2}
        />
      </mesh>
      {isAtRisk && (
        <mesh ref={ringRef} rotation={[Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.09, 0.13, 24]} />
          <meshBasicMaterial color="#f43f5e" transparent opacity={0.6} side={THREE.DoubleSide} />
        </mesh>
      )}
    </group>
  );
}

function ModelHeart({ color, bpm, risk, vessels }: HeartProps) {
  const groupRef = useRef<THREE.Group>(null);
  const { scene } = useGLTF("/models/heart.glb");

  // Clone scene to avoid mutating cached asset across re-renders
  const clonedScene = useMemo(() => {
    const c = scene.clone(true);
    return c;
  }, [scene]);

  // Dynamically update materials to bind to risk score & emissive glow
  useMemo(() => {
    clonedScene.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        const mat = mesh.material as THREE.MeshStandardMaterial;
        if (mat) {
          mat.color = new THREE.Color(color);
          mat.emissive = new THREE.Color(color);
          mat.emissiveIntensity = 0.2 + risk * 0.75;
          mat.roughness = 0.35;
          mat.metalness = 0.2;
          mat.needsUpdate = true;
        }
      }
    });
  }, [clonedScene, color, risk]);

  // Rhythmic dual-phase cardiac contraction driven by heart rate (bpm) and risk level
  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    const t = clock.elapsedTime * (bpm / 60) * Math.PI * 2;
    const systole = Math.pow(Math.max(0, Math.sin(t)), 8) * (0.07 + risk * 0.05);
    const diastole = Math.pow(Math.max(0, Math.sin(t + 0.85)), 8) * (0.035 + risk * 0.025);
    const beat = systole + diastole;
    groupRef.current.scale.setScalar(1.45 * (1 + beat));
  });

  return (
    <group ref={groupRef}>
      <Center>
        <primitive object={clonedScene} />
        {VESSEL_PINS.map((v) => (
          <VesselMarker
            key={v.id}
            id={v.id}
            isAtRisk={vessels.includes(v.id)}
            risk={risk}
            pos={v.pos}
          />
        ))}
      </Center>
    </group>
  );
}

function ProceduralHeartFallback({ color, bpm, risk }: { color: string; bpm: number; risk: number }) {
  const ref = useRef<THREE.Mesh>(null);
  const geo = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(0, -1.1);
    s.bezierCurveTo(-0.2, -0.8, -1.5, -0.2, -1.5, 0.6);
    s.bezierCurveTo(-1.5, 1.3, -0.5, 1.6, 0, 0.9);
    s.bezierCurveTo(0.5, 1.6, 1.5, 1.3, 1.5, 0.6);
    s.bezierCurveTo(1.5, -0.2, 0.2, -0.8, 0, -1.1);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.9, bevelEnabled: true, bevelSegments: 8, bevelSize: 0.3, bevelThickness: 0.3 });
    g.center();
    return g;
  }, []);

  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.elapsedTime * (bpm / 60) * Math.PI * 2;
    const beat = Math.pow(Math.max(0, Math.sin(t)), 8) * 0.08;
    ref.current.scale.setScalar(1 + beat);
  });

  return (
    <mesh ref={ref} geometry={geo}>
      <meshPhysicalMaterial
        color={color}
        emissive={color}
        emissiveIntensity={0.2 + risk * 0.6}
        roughness={0.25}
        metalness={0.15}
      />
    </mesh>
  );
}

// Preload the GLTF heart model
useGLTF.preload("/models/heart.glb");

export interface Heart3DProps {
  color: string;
  bpm: number;
  risk: number;
  vessels?: string[];
}

export default function Heart3D({ color, bpm, risk, vessels = [] }: Heart3DProps) {
  const clampedBpm = Math.max(40, Math.min(bpm, 140));
  const activeVessels = vessels.length ? vessels : [];

  return (
    <div className="flex flex-col gap-2.5" id="heart-3d-container">
      <div className="relative w-full h-[260px] rounded-xl overflow-hidden bg-gradient-to-b from-white/[0.04] to-transparent border border-white/5" id="heart-3d" aria-label="3D heart colored by risk">
        {/* Dynamic status pill */}
        <div className="absolute top-2.5 left-2.5 z-10 flex items-center gap-2 px-2.5 py-1 rounded-full bg-black/60 backdrop-blur-md border border-white/10 text-[11px]">
          <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: color }} />
          <span className="font-mono text-white/90">{clampedBpm} BPM</span>
          <span className="text-white/40">·</span>
          <span className="text-white/70">{(risk * 100).toFixed(0)}% Risk</span>
        </div>

        <Canvas camera={{ position: [0, 0, 4.4], fov: 45 }} dpr={[1, 1.75]}>
          <ambientLight intensity={0.7} />
          <directionalLight position={[5, 5, 5]} intensity={1.4} />
          <pointLight position={[-4, -2, -3]} intensity={30} color="#22d3ee" />
          <pointLight position={[3, 2, 4]} intensity={25} color={color} />
          <Float speed={1.2} rotationIntensity={0.2} floatIntensity={0.35}>
            <Suspense fallback={<ProceduralHeartFallback color={color} bpm={clampedBpm} risk={risk} />}>
              <ModelHeart color={color} bpm={clampedBpm} risk={risk} vessels={activeVessels} />
            </Suspense>
          </Float>
          <OrbitControls enableZoom={false} enablePan={false} autoRotate autoRotateSpeed={1.0} />
        </Canvas>
      </div>

      {/* Coronary Vessels Risk Assessment Strip */}
      <div className="grid grid-cols-4 gap-1.5 text-center text-[11px]" id="coronary-vessels-strip">
        {[
          { key: "LAD", name: "LAD" },
          { key: "LCx", name: "LCx" },
          { key: "RCA", name: "RCA" },
          { key: "LM", name: "Left Main" },
        ].map(({ key, name }) => {
          const isAtRisk = activeVessels.includes(key);
          return (
            <div
              key={key}
              className={`rounded-lg py-1.5 px-1 border transition-all ${
                isAtRisk
                  ? "bg-rose-500/15 border-rose-400/40 text-rose-300 shadow-[0_0_10px_rgba(244,63,94,0.15)]"
                  : "bg-white/5 border-white/5 text-emerald-400/80"
              }`}
            >
              <div className="font-semibold">{name}</div>
              <div className="text-[10px] mt-0.5 opacity-80">
                {isAtRisk ? "Stenosis" : "Patent"}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
