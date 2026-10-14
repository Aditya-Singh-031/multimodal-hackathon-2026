"use client";
import { useFrame, useThree } from "@react-three/fiber";
import { CameraControls, CameraControlsImpl, Html, useGLTF, useProgress } from "@react-three/drei";
import { Component, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import type { VesselAssessment, VesselId } from "@/lib/types";
import { STATUS_COLOR, VESSEL_IDS } from "@/lib/vessels";
import { buildAnatomy, cameraFor, FALLBACK_ANATOMY, GLOW_SAMPLES, type Anatomy, type ViewId } from "./anatomy";
import { createPerfusionUniforms, createVesselMaterial, patchMyocardium, type SharedPerfusionUniforms } from "./shaders";
import { createPinchedTubeGeometry, FIXED_VESSEL_IDS, PlaqueCuff, CoronaryFlowParticles } from "./vessels";

export const HEART_URL = "/models/heart.glb";
useGLTF.preload(HEART_URL);

export interface SceneProps {
  portal?: React.RefObject<HTMLElement>;
  assessments: VesselAssessment[];
  bpm: number;
  tint: string;
  xray: boolean;
  ischemiaMap?: boolean;
  flowParticles?: boolean;
  view: ViewId;
  viewNonce: number;
  highlight: VesselId | null;
  onSelect: (id: VesselId) => void;
  onAnatomyReady?: () => void;
}

/** Live values shared between frame loops without triggering React renders. */
interface Live { beat: number; xray: number; ischemiaMap: number }

// ---------------------------------------------------------------------------------------------
// Model preparation (normalize → clone & patch materials → raycast-snap coronary anatomy). Cached per asset.
// ---------------------------------------------------------------------------------------------
interface PreparedModel { root: THREE.Group; anatomy: Anatomy; materials: THREE.MeshStandardMaterial[]; uniforms: SharedPerfusionUniforms }
const prepared = new WeakMap<THREE.Object3D, PreparedModel>();

function prepareModel(scene: THREE.Object3D): PreparedModel {
  const cached = prepared.get(scene);
  if (cached) return cached;

  const clone = scene.clone(true);
  clone.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(clone);
  const center = box.getCenter(new THREE.Vector3());
  const height = box.getSize(new THREE.Vector3()).y || 1;
  clone.position.sub(center);

  const root = new THREE.Group();
  root.name = "heart-normalized";
  root.add(clone);
  root.scale.setScalar(2 / height); // normalized frame: height 2, centred at origin
  root.updateMatrixWorld(true);

  const uniforms = createPerfusionUniforms();
  const materials: THREE.MeshStandardMaterial[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const src = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const mat = (src instanceof THREE.MeshStandardMaterial ? src.clone() : new THREE.MeshStandardMaterial()) as THREE.MeshStandardMaterial;
    mat.roughness = 0.42;
    mat.metalness = 0.12;
    patchMyocardium(mat, uniforms, mesh.matrixWorld.clone());
    mesh.material = mat;
    materials.push(mat);
  });

  const anatomy = buildAnatomy(root);
  VESSEL_IDS.forEach((id, slot) =>
    anatomy.vessels[id].glowPts.forEach((p, i) => uniforms.uPts.value[slot * GLOW_SAMPLES + i].copy(p)),
  );
  const result = { root, anatomy, materials, uniforms };
  prepared.set(scene, result);
  return result;
}

const glowTarget = (assessments: VesselAssessment[]) => {
  const byId = Object.fromEntries(assessments.map((a) => [a.id, a])) as Record<VesselId, VesselAssessment | undefined>;
  const own = (id: VesselId) => {
    const a = byId[id];
    return a && a.stenosis >= 50 ? 0.55 + ((a.stenosis - 50) / 50) * 0.45 : 0;
  };
  const lm = own("LM");
  // Left-main disease jeopardises both LAD and LCx territories.
  return VESSEL_IDS.map((id) => (id === "LAD" || id === "LCx" ? Math.max(own(id), lm * 0.85) : own(id)));
};

function ModelHeart({ assessments, tint, live, onAnatomy }: { assessments: VesselAssessment[]; tint: string; live: React.RefObject<Live>; onAnatomy: (a: Anatomy) => void }) {
  const { scene } = useGLTF(HEART_URL);
  const model = useMemo(() => prepareModel(scene), [scene]);
  const targets = useMemo(() => glowTarget(assessments), [assessments]);
  const ischemicDeficit = useMemo(() => new THREE.Color("#6b21a8"), []);

  useEffect(() => {
    const t = setTimeout(() => {
      onAnatomy(model.anatomy);
    }, 0);
    return () => clearTimeout(t);
  }, [model, onAnatomy]);

  useEffect(() => {
    const c = new THREE.Color("#ffffff").lerp(new THREE.Color(tint), 0.32);
    model.materials.forEach((m) => {
      m.color.copy(c);
      m.emissive.set(tint);
      m.emissiveIntensity = 0.06;
    });
  }, [model, tint]);

  useFrame(({ clock }, dt) => {
    const u = model.uniforms;
    u.uTime.value = clock.elapsedTime;
    u.uBeat.value = live.current.beat;
    u.uXray.value = live.current.xray;
    u.uIschemiaMap.value = live.current.ischemiaMap;
    const k = 1 - Math.exp(-dt * 4);
    u.uGlow.value.forEach((g, i) => {
      g.set(ischemicDeficit.r, ischemicDeficit.g, ischemicDeficit.b, THREE.MathUtils.lerp(g.w, targets[i], k));
    });
    const transparent = live.current.xray > 0.02;
    model.materials.forEach((m) => {
      if (m.transparent !== transparent) {
        m.transparent = transparent;
        m.depthWrite = !transparent;
        m.needsUpdate = true;
      }
    });
  });

  return <primitive object={model.root} />;
}

// ---------------------------------------------------------------------------------------------
// Procedural fallback (loading state + asset failure)
// ---------------------------------------------------------------------------------------------
function ProceduralHeart({ tint, dim = false }: { tint: string; dim?: boolean }) {
  const geo = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(0, -1.1);
    s.bezierCurveTo(-0.2, -0.8, -1.5, -0.2, -1.5, 0.6);
    s.bezierCurveTo(-1.5, 1.3, -0.5, 1.6, 0, 0.9);
    s.bezierCurveTo(0.5, 1.6, 1.5, 1.3, 1.5, 0.6);
    s.bezierCurveTo(1.5, -0.2, 0.2, -0.8, 0, -1.1);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.9, bevelEnabled: true, bevelSegments: 8, bevelSize: 0.3, bevelThickness: 0.3 });
    g.center();
    g.scale(0.62, 0.62, 0.62);
    return g;
  }, []);
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <mesh geometry={geo} rotation={[0, 0, Math.PI * 0.06]}>
      <meshPhysicalMaterial color={tint} emissive={tint} emissiveIntensity={dim ? 0.15 : 0.3} roughness={0.3} metalness={0.1} transparent opacity={dim ? 0.35 : 0.95} wireframe={dim} />
    </mesh>
  );
}

function LoadingHeart({ tint }: { tint: string }) {
  return <ProceduralHeart tint={tint} dim />;
}

class ModelBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    console.warn("[Heart3D] GLB failed to load, using procedural fallback:", err);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

// ---------------------------------------------------------------------------------------------
// Coronary tree: surface-hugging tubes with animated flow and hemodynamic particles
// ---------------------------------------------------------------------------------------------
function VesselTube({
  curve,
  radius,
  a,
  lesionU,
  highlighted,
  live,
  flowParticles = true,
}: {
  curve: THREE.Curve<THREE.Vector3>;
  radius: number;
  a: VesselAssessment;
  lesionU: number | null;
  highlighted: boolean;
  live: React.RefObject<Live>;
  flowParticles?: boolean;
}) {
  const geo = useMemo(
    () => createPinchedTubeGeometry(curve, 96, radius, 12, lesionU, a.stenosis),
    [curve, radius, lesionU, a.stenosis],
  );
  const mat = useMemo(() => createVesselMaterial(), []);
  useEffect(() => () => geo.dispose(), [geo]);
  useEffect(() => () => mat.dispose(), [mat]);

  useEffect(() => {
    const u = mat.uniforms;
    u.uColor.value.set(STATUS_COLOR[a.status]);
    u.uSpeed.value = 0.08 + 0.62 * (1 - a.flowReduction / 100);
    u.uLesionU.value = lesionU !== null && a.status !== "patent" ? lesionU : 2;
    u.uDownstream.value = a.status === "critical" ? Math.max(0.28, 1 - a.flowReduction / 100) : 1;
  }, [mat, a, lesionU]);

  useFrame(({ clock }, dt) => {
    const u = mat.uniforms;
    u.uTime.value = clock.elapsedTime;
    u.uXray.value = live.current.xray;
    u.uSelected.value = THREE.MathUtils.lerp(u.uSelected.value, highlighted ? 1 : 0, 1 - Math.exp(-dt * 6));
    mat.depthTest = live.current.xray < 0.5;
  });

  return (
    <group>
      <mesh geometry={geo} material={mat} renderOrder={5} />
      {lesionU !== null && a.stenosis >= 50 && (
        <PlaqueCuff curve={curve} lesionU={lesionU} radius={radius} />
      )}
      {flowParticles && (
        <CoronaryFlowParticles
          curve={curve}
          a={a}
          lesionU={lesionU}
          vesselRadius={radius}
          count={a.id === "LM" ? 18 : 34}
        />
      )}
    </group>
  );
}

function CoronaryTree({
  anatomy,
  assessments,
  highlight,
  live,
  flowParticles = true,
}: {
  anatomy: Anatomy;
  assessments: VesselAssessment[];
  highlight: VesselId | null;
  live: React.RefObject<Live>;
  flowParticles?: boolean;
}) {
  const byId = useMemo(() => Object.fromEntries(assessments.map((a) => [a.id, a])) as Record<VesselId, VesselAssessment>, [assessments]);
  const safeAssessment = (id: VesselId): VesselAssessment =>
    byId[id] ?? {
      id,
      name: id,
      territory: "",
      wall: "",
      leads: [],
      stenosis: 0,
      status: "patent",
      source: "model",
      ffr: 1,
      flowReduction: 0,
      myocardiumAtRisk: 25,
    };

  return (
    <group>
      {VESSEL_IDS.map((id) => (
        <VesselTube
          key={id}
          curve={anatomy.vessels[id].curve}
          radius={id === "LM" ? 0.022 : 0.017}
          a={safeAssessment(id)}
          lesionU={anatomy.vessels[id].lesionU}
          highlighted={highlight === id}
          live={live}
          flowParticles={flowParticles}
        />
      ))}
      {anatomy.branches.map((b, i) => (
        <VesselTube
          key={i}
          curve={b.curve}
          radius={0.01}
          a={safeAssessment(b.parent)}
          lesionU={null}
          highlighted={highlight === b.parent}
          live={live}
          flowParticles={flowParticles}
        />
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------------------------
// HTML spatial pins (permanently mounted with stable keys to avoid React 19 root unmount race)
// ---------------------------------------------------------------------------------------------
interface VesselPinProps {
  id: VesselId;
  portal?: React.RefObject<HTMLElement>;
  a?: VesselAssessment;
  pos: THREE.Vector3;
  normal: THREE.Vector3;
  selected: boolean;
  onSelect: (id: VesselId) => void;
  live: React.RefObject<Live>;
}

function VesselPin({ id, portal, a, pos, normal, selected, onSelect, live }: VesselPinProps) {
  const group = useRef<THREE.Group>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const { camera } = useThree();
  const tmp = useMemo(() => ({ w: new THREE.Vector3(), d: new THREE.Vector3() }), []);
  const color = a ? STATUS_COLOR[a.status] : "#ffffff";
  const stenosis = a ? a.stenosis : 0;
  const isCritical = a ? a.status === "critical" : false;

  // Native listener: stop pointerdown reaching the orbit controls (React's delegated stopPropagation is too late).
  useEffect(() => {
    const el = btn.current;
    if (!el) return;
    const stop = (e: Event) => e.stopPropagation();
    el.addEventListener("pointerdown", stop);
    return () => el.removeEventListener("pointerdown", stop);
  }, []);

  useFrame(() => {
    if (!group.current || !wrap.current) return;
    group.current.position.copy(pos);
    group.current.getWorldPosition(tmp.w);
    tmp.d.copy(camera.position).sub(tmp.w).normalize();
    const facing = THREE.MathUtils.smoothstep(normal.dot(tmp.d), -0.35, 0.2);
    const vis = Math.max(facing, live.current.xray, selected ? 1 : 0);
    const active = Boolean(a);
    const opacityVal = active ? 0.2 + 0.8 * vis : 0;
    const scaleVal = active ? (selected ? 1.1 : 1.0) : 0.001;
    wrap.current.style.opacity = opacityVal.toFixed(3);
    wrap.current.style.transform = `translate(-50%, calc(-100% + 7px)) scale(${scaleVal})`;
    wrap.current.style.pointerEvents = active && vis > 0.35 ? "auto" : "none";
    wrap.current.style.visibility = active && opacityVal > 0.01 ? "visible" : "hidden";
    wrap.current.style.filter = vis < 0.35 ? "grayscale(0.6) opacity(0.7)" : "none";
  });

  return (
    <group ref={group} position={pos}>
      <Html portal={portal} zIndexRange={[20, 10]} style={{ pointerEvents: "none" }}>
        <div
          ref={wrap}
          className="flex flex-col items-center select-none"
          style={{ transform: "translate(-50%, calc(-100% + 7px))", transition: "opacity 120ms linear, transform 150ms ease-out" }}
        >
          <button
            ref={btn}
            type="button"
            id={`vessel-pin-${id}`}
            data-status={a?.status ?? "patent"}
            data-stenosis={stenosis}
            aria-label={`${a?.name ?? id}: ${stenosis}% stenosis, ${a?.status ?? "patent"}`}
            aria-pressed={selected}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(id);
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className={`pointer-events-auto flex items-center gap-1.5 rounded-full border px-2 py-[3px] text-[11px] font-semibold whitespace-nowrap backdrop-blur-md transition-all duration-200 hover:scale-110 cursor-pointer ${selected ? "scale-110 ring-2 ring-white/60" : ""}`}
            style={{
              borderColor: `${color}${selected ? "ff" : "aa"}`,
              background: "rgba(7,9,20,0.85)",
              boxShadow: `0 0 ${selected ? 22 : 12}px ${color}${selected ? "88" : "44"}`,
            }}
          >
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
            <span className="text-white tracking-wide font-bold">{id}</span>
            <span className="font-mono font-bold" style={{ color }}>{stenosis}%</span>
          </button>
          <span className="w-px h-3.5" style={{ background: `linear-gradient(${color}, ${color}22)` }} />
          <span className="relative w-3.5 h-3.5">
            <span
              className={`absolute inset-0 rounded-full animate-ping transition-opacity duration-300 ${isCritical ? "opacity-60" : "opacity-0 pointer-events-none"}`}
              style={{ background: color }}
            />
            <span className="absolute inset-[2px] rounded-full ring-2 ring-white/80" style={{ background: color }} />
          </span>
        </div>
      </Html>
    </group>
  );
}

// ---------------------------------------------------------------------------------------------
// Heartbeat rig (exact BPM → Hz) + holographic platform
// ---------------------------------------------------------------------------------------------
const gauss = (x: number, m: number, s: number) => Math.exp(-0.5 * ((x - m) / s) ** 2);

function HeartRig({ bpm, live, children }: { bpm: number; live: React.RefObject<Live>; children: ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const hz = bpm / 60; // one full cardiac cycle every 60/BPM seconds
    const phase = (clock.elapsedTime * hz) % 1;
    // Atrial kick then dominant ventricular systole within each cycle.
    const beat = 0.35 * gauss(phase, 0.06, 0.03) + gauss(phase, 0.22, 0.05);
    live.current.beat = beat;
    ref.current.scale.setScalar(1 + beat * 0.05);
  });
  return <group ref={ref}>{children}</group>;
}

function Platform({ tint }: { tint: string }) {
  const outerRef = useRef<THREE.Group>(null);
  const innerRef = useRef<THREE.Group>(null);

  useFrame((_, dt) => {
    if (outerRef.current) outerRef.current.rotation.z += dt * 0.18;
    if (innerRef.current) innerRef.current.rotation.z -= dt * 0.12;
  });

  return (
    <group position={[0, -1.18, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      {/* Outer sweep radar ring */}
      <group ref={outerRef}>
        <mesh>
          <ringGeometry args={[0.96, 0.99, 96, 1, 0, Math.PI * 1.5]} />
          <meshBasicMaterial color="#22d3ee" transparent opacity={0.45} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
        <mesh>
          <ringGeometry args={[1.18, 1.20, 64, 1, 0, Math.PI * 0.8]} />
          <meshBasicMaterial color="#7c5cff" transparent opacity={0.3} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      </group>

      {/* Inner counter-rotating calibration ring */}
      <group ref={innerRef}>
        <mesh>
          <ringGeometry args={[0.62, 0.64, 48, 1, 0, Math.PI * 1.2]} />
          <meshBasicMaterial color="#38bdf8" transparent opacity={0.35} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      </group>

      {/* Static concentric diagnostic rings */}
      <mesh>
        <ringGeometry args={[0.35, 0.36, 64]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.12} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh>
        <ringGeometry args={[0.78, 0.79, 64]} />
        <meshBasicMaterial color="#22d3ee" transparent opacity={0.15} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh>
        <ringGeometry args={[1.28, 1.30, 96]} />
        <meshBasicMaterial color="#7c5cff" transparent opacity={0.18} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>

      {/* Soft ground pedestal glow */}
      <mesh>
        <circleGeometry args={[1.35, 64]} />
        <meshBasicMaterial color={tint} transparent opacity={0.06} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------------------------------------
// Cinematic camera rig
// ---------------------------------------------------------------------------------------------
function CameraRig({ view, nonce, anatomy }: { view: ViewId; nonce: number; anatomy: Anatomy }) {
  const ref = useRef<CameraControlsImpl>(null);
  const lastUser = useRef(-1e9);
  const lastView = useRef(0);
  const clock = useThree((s) => s.clock);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.mouseButtons.wheel = CameraControlsImpl.ACTION.NONE; // never hijack page scroll
    c.mouseButtons.right = CameraControlsImpl.ACTION.NONE;
    c.mouseButtons.middle = CameraControlsImpl.ACTION.DOLLY;
    c.touches.one = CameraControlsImpl.ACTION.TOUCH_ROTATE;
    c.touches.two = CameraControlsImpl.ACTION.TOUCH_DOLLY_ROTATE;
    c.touches.three = CameraControlsImpl.ACTION.NONE;
  }, []);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const [p, t] = cameraFor(view, anatomy);
    lastView.current = clock.elapsedTime;
    void c.setLookAt(p.x, p.y, p.z, t.x, t.y, t.z, true);
  }, [view, nonce, anatomy, clock]);

  useFrame((state, dt) => {
    const c = ref.current;
    if (!c || view !== "overview") return;
    const t = state.clock.elapsedTime;
    if (t - lastUser.current > 6 && t - lastView.current > 2.2 && c.currentAction === CameraControlsImpl.ACTION.NONE) {
      c.azimuthAngle += dt * 0.16; // idle turntable in overview
    }
  });

  return (
    <CameraControls
      ref={ref}
      makeDefault
      smoothTime={0.55}
      draggingSmoothTime={0.12}
      minDistance={1.8}
      maxDistance={7.5}
      minPolarAngle={0.08}
      maxPolarAngle={Math.PI - 0.08}
      onControlStart={() => { lastUser.current = clock.elapsedTime; }}
      onControl={() => { lastUser.current = clock.elapsedTime; }}
    />
  );
}

// ---------------------------------------------------------------------------------------------
// Scene root
// ---------------------------------------------------------------------------------------------
export default function HeartScene({
  portal,
  assessments,
  bpm,
  tint,
  xray,
  ischemiaMap = true,
  flowParticles = true,
  view,
  viewNonce,
  highlight,
  onSelect,
  onAnatomyReady,
}: SceneProps) {
  const live = useRef<Live>({ beat: 0, xray: 0, ischemiaMap: 1 });
  const anatomyRef = useRef<Anatomy>(FALLBACK_ANATOMY);
  const [anatomy, setAnatomyState] = useState<Anatomy>(FALLBACK_ANATOMY);
  const byId = useMemo(() => Object.fromEntries(assessments.map((a) => [a.id, a])) as Record<VesselId, VesselAssessment>, [assessments]);

  const onAnatomy = useMemo(
    () => (a: Anatomy) => {
      if (anatomyRef.current === a) return;
      anatomyRef.current = a;
      setAnatomyState(a);
      onAnatomyReady?.();
    },
    [setAnatomyState, onAnatomyReady],
  );

  useFrame((_, dt) => {
    live.current.xray = THREE.MathUtils.lerp(live.current.xray, xray ? 1 : 0, 1 - Math.exp(-dt * 5));
    if (Math.abs(live.current.xray - (xray ? 1 : 0)) < 0.002) live.current.xray = xray ? 1 : 0;
    live.current.ischemiaMap = THREE.MathUtils.lerp(live.current.ischemiaMap, ischemiaMap ? 1 : 0, 1 - Math.exp(-dt * 6));
    if (Math.abs(live.current.ischemiaMap - (ischemiaMap ? 1 : 0)) < 0.002) live.current.ischemiaMap = ischemiaMap ? 1 : 0;
  });

  const ready = anatomy !== FALLBACK_ANATOMY;

  return (
    <>
      <ambientLight intensity={0.55} />
      <hemisphereLight args={["#bfe9ff", "#2a0a14", 0.6]} />
      <directionalLight position={[4, 5, 6]} intensity={1.7} />
      <directionalLight position={[-5, 1, -4]} intensity={0.6} color="#7c5cff" />
      <pointLight position={[-3, -2, 3]} intensity={18} color="#22d3ee" />
      <pointLight position={[3, 2, 4]} intensity={14} color={tint} />

      <HeartRig bpm={bpm} live={live}>
        <ModelBoundary fallback={<ProceduralHeart tint={tint} />}>
          <Suspense fallback={<LoadingHeart tint={tint} />}>
            <ModelHeart assessments={assessments} tint={tint} live={live} onAnatomy={onAnatomy} />
          </Suspense>
        </ModelBoundary>
        <CoronaryTree
          anatomy={anatomy}
          assessments={assessments}
          highlight={highlight}
          live={live}
          flowParticles={flowParticles}
        />
        {FIXED_VESSEL_IDS.map((id) => (
          <VesselPin
            key={`vessel-pin-${id}`}
            id={id}
            portal={portal}
            a={byId[id]}
            pos={anatomy.vessels[id]?.pin ?? FALLBACK_ANATOMY.vessels[id].pin}
            normal={anatomy.vessels[id]?.pinNormal ?? FALLBACK_ANATOMY.vessels[id].pinNormal}
            selected={highlight === id}
            onSelect={onSelect}
            live={live}
          />
        ))}
      </HeartRig>
      <Platform tint={tint} />
      <CameraRig view={view} nonce={viewNonce} anatomy={anatomy} />
    </>
  );
}
