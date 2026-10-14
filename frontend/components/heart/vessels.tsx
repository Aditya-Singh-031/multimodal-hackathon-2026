"use client";
/**
 * Coronary vessel geometry, parametric pinching, and lesion markers for Heart3D.
 * Re-exports coronary domain utilities from @/lib/vessels.
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import type { VesselAssessment, VesselId, VesselStatus } from "@/lib/types";
import { STATUS_COLOR } from "@/lib/vessels";

export * from "@/lib/vessels";

/** The 4 primary anatomical coronary arteries permanently tracked in the 3D scene */
export const FIXED_VESSEL_IDS: VesselId[] = ["LAD", "LCx", "RCA", "LM"];

/**
 * Parametric Vessel Pinching:
 * Generates a 3D tube geometry along a 3D curve with dynamic caliber narrowing.
 * For vessels with stenosis >= 50%, visually tapers the tube mesh radius at the lesion point
 * by (1 - stenosis_fraction) with smooth Gaussian axial falloff.
 */
export function createPinchedTubeGeometry(
  curve: THREE.Curve<THREE.Vector3>,
  tubularSegments = 96,
  baseRadius = 0.017,
  radialSegments = 12,
  lesionU: number | null = null,
  stenosis = 0,
): THREE.BufferGeometry {
  const frames = curve.computeFrenetFrames(tubularSegments, false);
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const stenosisFrac = Math.min(0.95, Math.max(0, stenosis / 100));
  const hasPinch = lesionU !== null && stenosis >= 50;

  for (let i = 0; i <= tubularSegments; i++) {
    const u = i / tubularSegments;
    const p = curve.getPointAt(u);
    const N = frames.normals[i];
    const B = frames.binormals[i];

    let r = baseRadius;
    if (hasPinch) {
      const dist = Math.abs(u - lesionU);
      // Gaussian pinch falloff centered at the lesion site
      const pinch = Math.exp(-Math.pow(dist / 0.055, 2.0));
      // For vessels with stenosis >= 50%, visually narrow the tube mesh by (1 - stenosis_fraction)
      const minFrac = Math.max(0.15, 1.0 - stenosisFrac);
      r = baseRadius * (1.0 - pinch * (1.0 - minFrac));
    }

    for (let j = 0; j <= radialSegments; j++) {
      const v = (j / radialSegments) * Math.PI * 2;
      const sin = Math.sin(v);
      const cos = -Math.cos(v);

      const nx = cos * N.x + sin * B.x;
      const ny = cos * N.y + sin * B.y;
      const nz = cos * N.z + sin * B.z;
      const len = Math.hypot(nx, ny, nz) || 1;
      const normX = nx / len;
      const normY = ny / len;
      const normZ = nz / len;

      positions.push(p.x + r * normX, p.y + r * normY, p.z + r * normZ);
      normals.push(normX, normY, normZ);
      uvs.push(u, j / radialSegments);
    }
  }

  for (let j = 1; j <= tubularSegments; j++) {
    for (let i = 1; i <= radialSegments; i++) {
      const a = (radialSegments + 1) * (j - 1) + (i - 1);
      const b = (radialSegments + 1) * j + (i - 1);
      const c = (radialSegments + 1) * j + i;
      const d = (radialSegments + 1) * (j - 1) + i;

      indices.push(a, b, d);
      indices.push(b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

/**
 * Plaque Lesion Marker:
 * Renders a subtle golden/amber plaque calcification ring or cuff at the constriction site.
 */
export function PlaqueCuff({
  curve,
  lesionU,
  radius,
}: {
  curve: THREE.Curve<THREE.Vector3>;
  lesionU: number;
  radius: number;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const geo = useMemo(() => new THREE.TorusGeometry(radius * 1.05, radius * 0.32, 12, 24), [radius]);
  const mat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#f59e0b",
        emissive: "#b45309",
        emissiveIntensity: 0.65,
        roughness: 0.3,
        metalness: 0.8,
      }),
    [],
  );

  useEffect(() => () => {
    geo.dispose();
    mat.dispose();
  }, [geo, mat]);

  useLayoutEffect(() => {
    if (!meshRef.current) return;
    const p = curve.getPointAt(lesionU);
    const t = curve.getTangentAt(lesionU).normalize();
    meshRef.current.position.copy(p);
    meshRef.current.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), t);
  }, [curve, lesionU]);

  return <mesh ref={meshRef} geometry={geo} material={mat} renderOrder={6} />;
}

/**
 * Coronary Blood-Flow Particle Stream:
 * InstancedMesh of glowing hemodynamic blood cells/particles traveling along the 3D spline paths of LAD, LCx, and RCA.
 * Particles flow smoothly in patent arteries, accelerate into a tight high-speed jet across the stenotic pinch (lesionU),
 * and slow/dim downstream when predicted stenosis >= 50%.
 */
export function CoronaryFlowParticles({
  curve,
  a,
  lesionU,
  count = 32,
  vesselRadius = 0.017,
}: {
  curve: THREE.Curve<THREE.Vector3>;
  a: VesselAssessment;
  lesionU: number | null;
  count?: number;
  vesselRadius?: number;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => new THREE.SphereGeometry(0.005, 8, 8), []);
  const mat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: STATUS_COLOR[a.status],
        emissive: STATUS_COLOR[a.status],
        emissiveIntensity: 1.4,
        roughness: 0.25,
        metalness: 0.1,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    [a.status],
  );

  useEffect(() => () => {
    geo.dispose();
    mat.dispose();
  }, [geo, mat]);

  // Particle distribution parameters
  const seeds = useMemo(() => {
    return Array.from({ length: count }, (_, i) => ({
      u0: i / count,
      phaseOffset: (i * 0.137) % 1,
      radialAngle: (i * 2.399) % (Math.PI * 2),
      radiusFrac: 0.2 + 0.6 * ((i * 0.618) % 1),
    }));
  }, [count]);

  const dummy = useMemo(() => new THREE.Object3D(), []);
  const normalVec = useMemo(() => new THREE.Vector3(), []);
  const binormalVec = useMemo(() => new THREE.Vector3(), []);
  const upRef = useMemo(() => new THREE.Vector3(0, 1, 0), []);

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const t = clock.elapsedTime;
    const hasLesion = lesionU !== null && a.stenosis >= 50;
    const baseSpeed = 0.18 + 0.45 * (1 - a.flowReduction / 100);

    for (let i = 0; i < count; i++) {
      const s = seeds[i];
      // Parametric progress along the 3D spline:
      const u = (s.u0 + t * baseSpeed) % 1.0;
      let particleScale = 1.0;

      if (hasLesion) {
        const dist = u - lesionU;
        if (Math.abs(dist) < 0.05) {
          // Venturi jet acceleration through stenotic constriction
          particleScale = 0.7; // compressed jet
        } else if (dist > 0.05) {
          // Downstream post-stenotic sluggish flow
          particleScale = 0.85;
        }
      }

      const p = curve.getPointAt(u);
      const tangent = curve.getTangentAt(u).normalize();

      // Form orthogonal basis for cross-sectional particle dispersion inside the lumen
      if (Math.abs(tangent.dot(upRef)) > 0.9) {
        normalVec.set(1, 0, 0).cross(tangent).normalize();
      } else {
        normalVec.crossVectors(tangent, upRef).normalize();
      }
      binormalVec.crossVectors(tangent, normalVec).normalize();

      // Taper particle spread at the lesion pinch site
      let r = vesselRadius * 0.75 * s.radiusFrac;
      if (hasLesion && Math.abs(u - lesionU) < 0.05) {
        r *= 0.25; // compress into tight central jet stream
      }

      const cos = Math.cos(s.radialAngle);
      const sin = Math.sin(s.radialAngle);
      p.addScaledVector(normalVec, cos * r);
      p.addScaledVector(binormalVec, sin * r);

      dummy.position.copy(p);
      dummy.scale.setScalar(particleScale);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return <instancedMesh ref={meshRef} args={[geo, mat, count]} renderOrder={7} />;
}
