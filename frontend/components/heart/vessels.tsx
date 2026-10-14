"use client";
/**
 * Coronary vessel geometry, parametric pinching, and lesion markers for Heart3D.
 * Re-exports coronary domain utilities from @/lib/vessels.
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { VesselId } from "@/lib/types";

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
