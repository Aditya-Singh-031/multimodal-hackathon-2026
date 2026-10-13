/**
 * Anatomical coordinate system for the heart GLB.
 *
 * Normalized heart frame (after centring on the bounding box and scaling to height 2):
 *   +Y cranial (base / great vessels) · −Y caudal (apex)
 *   +Z anterior (sternocostal surface) · −Z posterior
 *   +X patient-left (lateral LV wall) · −X patient-right (RA / RV free wall)
 *
 * Coronary paths are authored in cylindrical coordinates [y, azimuth°] (0° = anterior, 90° = left lateral,
 * ±180° = posterior, −90° = right) and snapped onto the actual mesh surface with raycasts at load time,
 * so the tubes, pins and perfusion glow always hug the real myocardium regardless of the asset's tessellation.
 */
import * as THREE from "three";
import type { VesselId } from "@/lib/types";

type CylPt = [y: number, azimuthDeg: number];

export const VESSEL_PATHS: Record<VesselId, CylPt[]> = {
  // Left main: short trunk from the left aortic sinus, emerging beneath the pulmonary trunk.
  LM: [[0.2, 8], [0.16, 24], [0.12, 40]],
  // LAD: anterior interventricular groove down to (and wrapping) the apex.
  LAD: [[0.12, 40], [0.0, 26], [-0.18, 18], [-0.38, 16], [-0.56, 20], [-0.72, 30], [-0.84, 48]],
  // LCx: left atrioventricular groove, curving laterally and posteriorly.
  LCx: [[0.12, 40], [0.12, 62], [0.1, 86], [0.06, 110], [0.0, 134], [-0.06, 156], [-0.1, 176]],
  // RCA: right atrioventricular groove around the acute margin to the crux (inferior / diaphragmatic surface).
  RCA: [[0.18, -12], [0.1, -38], [0.0, -66], [-0.1, -94], [-0.2, -122], [-0.3, -150], [-0.36, -178]],
};

/** Decorative side branches (inherit parent vessel's status). */
export const BRANCHES: { parent: VesselId; pts: CylPt[] }[] = [
  { parent: "LAD", pts: [[-0.14, 20], [-0.3, 40], [-0.48, 56]] }, // first diagonal
  { parent: "LCx", pts: [[0.08, 100], [-0.16, 106], [-0.42, 108]] }, // obtuse marginal (lateral wall)
  { parent: "RCA", pts: [[-0.36, -178], [-0.52, -182], [-0.7, -176]] }, // posterior descending (inferior wall)
  { parent: "RCA", pts: [[-0.06, -84], [-0.3, -88], [-0.5, -84]] }, // acute marginal
];

/** Index into VESSEL_PATHS where the stenosis pin (lesion) sits. */
export const PIN_INDEX: Record<VesselId, number> = { LM: 1, LAD: 2, LCx: 3, RCA: 4 };

export const GLOW_SAMPLES = 8; // points per vessel passed to the perfusion shader

export interface VesselGeometry {
  curve: THREE.CatmullRomCurve3;
  glowPts: THREE.Vector3[];
  pin: THREE.Vector3;
  pinNormal: THREE.Vector3;
  lesionU: number; // 0..1 position of the lesion along the curve
}
export interface Anatomy {
  vessels: Record<VesselId, VesselGeometry>;
  branches: { parent: VesselId; curve: THREE.CatmullRomCurve3 }[];
}

const DEG = Math.PI / 180;
const radial = (az: number) => new THREE.Vector3(Math.sin(az * DEG), 0, Math.cos(az * DEG));

/** Snap one cylindrical point onto the mesh surface. Falls back to an ellipsoid guess on miss. */
function snap(rc: THREE.Raycaster, target: THREE.Object3D | null, [y, az]: CylPt) {
  const dir = radial(az);
  if (target) {
    rc.set(new THREE.Vector3(0, y, 0).addScaledVector(dir, 4), dir.clone().negate());
    const hit = rc.intersectObject(target, true)[0];
    if (hit) {
      const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : dir.clone();
      if (n.dot(dir) < 0) n.negate();
      const normal = n.add(dir).normalize(); // blend with radial for a smooth, outward-facing frame
      return { p: hit.point.clone(), n: normal };
    }
  }
  const r = 0.55 * Math.sqrt(Math.max(0.05, 1 - y * y));
  return { p: new THREE.Vector3(0, y, 0).addScaledVector(dir, r), n: dir };
}

function surfaceCurve(rc: THREE.Raycaster, target: THREE.Object3D | null, pts: CylPt[], lift: number) {
  const snapped = pts.map((pt) => snap(rc, target, pt));
  const curve = new THREE.CatmullRomCurve3(
    snapped.map(({ p, n }) => p.clone().addScaledVector(n, lift)),
    false,
    "centripetal",
  );
  return { curve, snapped };
}

/** Raycast-snap every coronary path onto `target` (must already have up-to-date matrixWorld). */
export function buildAnatomy(target: THREE.Object3D | null): Anatomy {
  const rc = new THREE.Raycaster();
  const vessels = {} as Record<VesselId, VesselGeometry>;
  (Object.keys(VESSEL_PATHS) as VesselId[]).forEach((id) => {
    const pts = VESSEL_PATHS[id];
    const { curve, snapped } = surfaceCurve(rc, target, pts, 0.014);
    const pinIdx = PIN_INDEX[id];
    const { p, n } = snapped[pinIdx];
    vessels[id] = {
      curve,
      glowPts: curve.getSpacedPoints(GLOW_SAMPLES - 1),
      pin: p.clone().addScaledVector(n, 0.03),
      pinNormal: n.clone(),
      lesionU: pinIdx / (pts.length - 1),
    };
  });
  const branches = BRANCHES.map((b) => ({ parent: b.parent, curve: surfaceCurve(rc, target, b.pts, 0.012).curve }));
  return { vessels, branches };
}

/** Pre-load anchor guesses (used before the GLB resolves, and by the procedural fallback). */
export const FALLBACK_ANATOMY = buildAnatomy(null);

// ---------------------------------------------------------------------------------------------
// Cinematic camera presets
// ---------------------------------------------------------------------------------------------
export type ViewId = "overview" | VesselId;

export const VIEW_PRESETS: Record<ViewId, { dir: [number, number, number]; dist: number; label: string }> = {
  overview: { dir: [0.34, 0.18, 1], dist: 5.0, label: "Overview" },
  LAD: { dir: [0.28, 0.08, 1], dist: 3.0, label: "Anterior" },
  LCx: { dir: [1, 0.22, 0.12], dist: 3.0, label: "Lateral" },
  RCA: { dir: [-0.5, -0.72, -0.5], dist: 3.2, label: "Inferior" },
  LM: { dir: [0.3, 0.55, 1], dist: 2.7, label: "Left main" },
};

/** Returns [position, target] for a view given the (snapped) anatomy. */
export function cameraFor(view: ViewId, anatomy: Anatomy): [THREE.Vector3, THREE.Vector3] {
  const preset = VIEW_PRESETS[view];
  const target = view === "overview" ? new THREE.Vector3(0, -0.04, 0) : anatomy.vessels[view].pin.clone().multiplyScalar(0.55);
  const pos = target.clone().addScaledVector(new THREE.Vector3(...preset.dir).normalize(), preset.dist);
  return [pos, target];
}
