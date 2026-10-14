"use client";
import { Canvas } from "@react-three/fiber";
import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Crosshair,
  Droplets,
  Eye,
  Focus,
  Heart,
  Layers,
  ScanLine,
  Sparkles,
  Stethoscope,
  X,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EcgFindings, Patient, Prediction, VesselAssessment, VesselId } from "@/lib/types";
import { ALL_LEADS, assessVessels, culpritVessel, STATUS_COLOR, STATUS_LABEL, VESSEL_META } from "@/lib/vessels";
import HeartScene from "./heart/Scene";
import { cameraFor, FALLBACK_ANATOMY, VIEW_PRESETS, type ViewId } from "./heart/anatomy";

export interface Heart3DProps {
  patient?: Patient;
  prediction?: Prediction | null;
  /** Tier colour used to tint the myocardium. */
  color: string;
  bpm?: number;
  risk?: number;
  vessels?: string[];
  mode?: "clinician" | "patient";
}

const TOOLBAR: { view: ViewId; text: string }[] = [
  { view: "overview", text: "Overview" },
  { view: "LAD", text: "LAD (Anterior)" },
  { view: "LCx", text: "LCx (Lateral)" },
  { view: "RCA", text: "RCA (Inferior)" },
  { view: "LM", text: "LM (Left Main)" },
];

const SOURCE_LABEL: Record<VesselAssessment["source"], string> = {
  angiography: "Angiographic finding",
  "clinical-note": "Quantified in cath note",
  model: "Model-inferred from fused risk",
  "ml-fusion": "ML fusion · tabular + ECG territory + notes",
};

const [initPos] = cameraFor("overview", FALLBACK_ANATOMY);

export default function Heart3D({
  patient: patientProp,
  prediction: predictionProp = null,
  color,
  bpm: bpmProp,
  risk: riskProp,
  vessels: vesselsProp,
  mode = "clinician",
}: Heart3DProps) {
  const isPatient = mode === "patient";

  const patient = useMemo(() => {
    if (patientProp) return patientProp;
    const f = {
      age: 55,
      sex: "M" as const,
      systolic_bp: 130,
      cholesterol: 210,
      smoker: false,
      diabetic: false,
      bmi: 25,
      resting_hr: bpmProp ?? 72,
      chest_pain_type: 0,
      exercise_angina: false,
    };
    return {
      id: "DEMO",
      name: "Patient",
      request: { features: f },
      features: f,
      vessels: vesselsProp,
    } as Patient;
  }, [patientProp, bpmProp, vesselsProp]);

  const prediction = predictionProp;
  const rawBpm = patient.features?.resting_hr ?? patient.request.features.resting_hr ?? bpmProp ?? 72;
  const bpm = Math.max(30, Math.min(220, Math.round(rawBpm)));
  const hz = bpm / 60;
  const risk = prediction?.risk ?? riskProp ?? 0;
  const assessments = useMemo(() => assessVessels(patient, prediction), [patient, prediction]);
  const culprit = culpritVessel(assessments);
  const culpritId = culprit?.id ?? null;

  const [view, setView] = useState<ViewId>(culpritId ?? "overview");
  const [nonce, setNonce] = useState(0);
  const [selected, setSelected] = useState<VesselId | null>(null);
  const [xray, setXray] = useState(false);
  const [flowParticles, setFlowParticles] = useState(true);
  const [ischemiaMap, setIschemiaMap] = useState(true);
  const [ready, setReady] = useState(false);
  const [activeStage, setActiveStage] = useState<1 | 2 | 3 | 4 | null>(null);

  const isCadPositive = prediction?.cad_status ?? (risk >= 0.50 || assessments.some((a) => a.id !== "LM" && a.stenosis >= 50));
  const targetVessels = useMemo(() => {
    return [
      { id: "LAD", name: isPatient ? "Front Wall (LAD)" : "LAD (Anterior)" },
      { id: "LCx", name: isPatient ? "Side Wall (LCx)" : "LCX (Lateral)" },
      { id: "RCA", name: isPatient ? "Bottom Wall (RCA)" : "RCA (Inferior)" },
    ].map((item) => {
      const a = assessments.find((x) => x.id === item.id);
      return {
        id: item.id as VesselId,
        name: item.name,
        stenosis: a?.stenosis ?? 0,
        status: a?.status ?? "patent",
        color: STATUS_COLOR[a?.status ?? "patent"],
      };
    });
  }, [assessments, isPatient]);

  // Patient (or culprit) change → cinematic auto-focus on the most severe lesion, close any open inspection.
  const sceneKey = `${patient.id}:${culpritId ?? "none"}`;
  const [prevKey, setPrevKey] = useState(sceneKey);
  if (sceneKey !== prevKey) {
    setPrevKey(sceneKey);
    setSelected(null);
    setView(culpritId ?? "overview");
    setNonce((n) => n + 1);
  }

  const goTo = useCallback((v: ViewId) => {
    setView(v);
    setNonce((n) => n + 1);
    if (v === "overview") setSelected(null);
  }, []);

  const inspect = useCallback((id: VesselId) => {
    setSelected(id);
    setView(id);
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSelected(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  const highlight = selected ?? (view !== "overview" ? view : null);
  const sel = selected ? assessments.find((a) => a.id === selected) ?? null : null;
  const criticalCount = assessments.filter((a) => a.status === "critical").length;
  const minFfr = assessments.reduce((min, a) => Math.min(min, a.ffr), 1.0);
  const reqFeat = patient.request?.features;
  const ca = patient.features?.ca ?? reqFeat?.ca ?? assessments.filter((a) => a.id !== "LM" && a.stenosis >= 50).length;

  const onReady = useCallback(() => setReady(true), []);
  const stageRef = useRef<HTMLDivElement>(null);

  // Active risk drivers for Stage 1 of the Pathophysiological Cascade
  const activeDrivers = useMemo(() => {
    const list: string[] = [];
    if (!reqFeat) return list;
    if (reqFeat.smoker) list.push("Smoking");
    if (reqFeat.systolic_bp >= 140) list.push(`BP ${reqFeat.systolic_bp} mmHg`);
    if (reqFeat.cholesterol >= 200) list.push(`Chol ${reqFeat.cholesterol} mg/dL`);
    if (reqFeat.diabetic) list.push("Diabetes");
    if (reqFeat.rwma && reqFeat.rwma > 0) list.push(`RWMA Gr ${reqFeat.rwma}`);
    if (reqFeat.st_elevation) list.push("ST Elevation");
    return list;
  }, [reqFeat]);

  const targetCulprit = sel ?? culprit ?? assessments[0];

  const handleStageClick = (stage: 1 | 2 | 3 | 4) => {
    setActiveStage(stage);
    if (stage === 1) {
      goTo("overview");
    } else if (stage === 2) {
      setXray(true);
      if (culpritId) inspect(culpritId);
    } else if (stage === 3) {
      setFlowParticles(true);
      setXray(false);
      if (culpritId) inspect(culpritId);
    } else if (stage === 4) {
      setIschemiaMap(true);
      setXray(false);
      if (culpritId) inspect(culpritId);
    }
  };

  return (
    <div
      className="grid grid-rows-[auto_minmax(420px,1fr)_auto] gap-3.5 w-full h-full"
      id="heart-3d-cockpit"
      data-view={view}
      data-bpm={bpm}
      data-hz={hz.toFixed(3)}
      data-xray={xray}
      data-mode={mode}
    >
      {/* =========================================================================
          TOP GRID TRACK: Dual Clinical Banner + Camera & Shader Toolbars
          ========================================================================= */}
      <div className="space-y-2.5" id="heart-top-track">
        {/* Dual Clinical / Patient Banner */}
        <div className="rounded-xl border border-white/10 bg-black/60 backdrop-blur-md p-3 space-y-2.5 shadow-xl" id="heart-clinical-banner">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* 1. Overall Status */}
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono uppercase tracking-wider text-white/50">
                {isPatient ? "Heart Artery Health:" : "Overall CAD:"}
              </span>
              <div
                id="cad-status-badge"
                className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold border transition-all ${
                  isCadPositive
                    ? "bg-rose-500/20 border-rose-400/50 text-rose-200 shadow-[0_0_16px_rgba(244,63,94,0.3)] animate-pulse"
                    : "bg-emerald-500/20 border-emerald-400/50 text-emerald-200 shadow-[0_0_16px_rgba(52,211,153,0.2)]"
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${isCadPositive ? "bg-rose-400 shadow-[0_0_8px_#f43f5e]" : "bg-emerald-400 shadow-[0_0_8px_#34d399]"}`} />
                <span>
                  {isPatient
                    ? isCadPositive
                      ? "ATTENTION: Obstructive Artery Narrowing Found"
                      : "GOOD NEWS: Clear Coronary Arteries"
                    : isCadPositive
                    ? "POSITIVE (CAD ≥ 50% Stenosis)"
                    : "NEGATIVE (No Obstructive CAD)"}
                </span>
                <span className="font-mono text-[11px] opacity-80 border-l border-current/30 pl-2">
                  {isPatient ? `Risk: ${(risk * 100).toFixed(0)}%` : `P(CAD): ${(risk * 100).toFixed(0)}%`}
                </span>
              </div>
            </div>

            {/* 2. 3 Target Vessels Summary Mini-Bars */}
            <div className="flex items-center gap-2 sm:gap-2.5 flex-wrap" id="target-vessels-summary">
              <span className="text-[10px] font-mono uppercase tracking-wider text-white/40 hidden xl:inline">
                {isPatient ? "Main Arteries:" : "Target Vessels:"}
              </span>
              {targetVessels.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => inspect(v.id)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border transition-all text-[11px] cursor-pointer ${
                    selected === v.id
                      ? "bg-white/15 border-white/40 ring-1 ring-white/30"
                      : "bg-white/[0.04] hover:bg-white/[0.08] border-white/[0.08]"
                  }`}
                  title={`Click to inspect ${v.name}`}
                >
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: v.color }} />
                  <span className="text-white/80 font-medium">{v.id}</span>
                  <div className="w-12 sm:w-16 h-1.5 rounded-full bg-white/10 overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-500" style={{ width: `${v.stenosis}%`, background: v.color }} />
                  </div>
                  <span className="font-mono font-bold text-[10px]" style={{ color: v.color }}>
                    {v.stenosis}%
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Camera Views & Shader Toggles Docked Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-2" id="heart-docked-toolbars">
          {/* Camera View Presets */}
          <div role="toolbar" aria-label="Camera views" className="flex items-center gap-1 p-1 rounded-xl bg-black/50 backdrop-blur-md border border-white/10 overflow-x-auto max-w-full no-scrollbar shadow-md">
            {TOOLBAR.map(({ view: v, text }) => {
              const active = view === v;
              const a = v === "overview" ? null : assessments.find((x) => x.id === v);
              return (
                <button
                  key={v}
                  id={`view-${v}`}
                  type="button"
                  aria-pressed={active}
                  onClick={() => goTo(v)}
                  className={`flex items-center gap-1.5 shrink-0 rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-all cursor-pointer ${
                    active
                      ? "bg-white/20 text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.22)]"
                      : "text-white/70 hover:text-white hover:bg-white/[0.08]"
                  }`}
                >
                  {v === "overview" ? <Eye size={12} /> : <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: a ? STATUS_COLOR[a.status] : "#fff" }} />}
                  <span>{text}</span>
                </button>
              );
            })}
          </div>

          {/* Visualization Shader Toggles */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              id="flow-particles-toggle"
              type="button"
              aria-pressed={flowParticles}
              onClick={() => setFlowParticles((p) => !p)}
              className={`shrink-0 flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-[11px] font-semibold border backdrop-blur-md transition-all cursor-pointer ${
                flowParticles
                  ? "bg-cyan-500/25 border-cyan-300 text-cyan-200 shadow-[0_0_14px_rgba(34,211,238,0.35)]"
                  : "bg-black/50 border-white/10 text-white/50 hover:text-white hover:bg-white/10 shadow-md"
              }`}
              title="Toggle hemodynamic blood-cell particle streams"
            >
              <Droplets size={12} /> <span className="hidden sm:inline">Flow Particles</span>
            </button>
            <button
              id="ischemia-map-toggle"
              type="button"
              aria-pressed={ischemiaMap}
              onClick={() => setIschemiaMap((m) => !m)}
              className={`shrink-0 flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-[11px] font-semibold border backdrop-blur-md transition-all cursor-pointer ${
                ischemiaMap
                  ? "bg-rose-500/25 border-rose-300 text-rose-200 shadow-[0_0_14px_rgba(244,63,94,0.35)]"
                  : "bg-black/50 border-white/10 text-white/50 hover:text-white hover:bg-white/10 shadow-md"
              }`}
              title="Toggle myocardial ischemic perfusion map"
            >
              <Layers size={12} /> <span className="hidden sm:inline">Ischemia Map</span>
            </button>
            <button
              id="xray-toggle"
              type="button"
              aria-pressed={xray}
              onClick={() => setXray((x) => !x)}
              className={`shrink-0 flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-[11px] font-semibold border backdrop-blur-md transition-all cursor-pointer ${
                xray
                  ? "bg-cyan-500/25 border-cyan-300 text-cyan-200 shadow-[0_0_18px_rgba(34,211,238,0.4)]"
                  : "bg-black/50 border-white/10 text-white/70 hover:text-white hover:bg-white/10 shadow-md"
              }`}
            >
              <ScanLine size={13} /> <span className="hidden sm:inline">X-Ray Mode</span>
            </button>
          </div>
        </div>
      </div>

      {/* =========================================================================
          CENTER GRID TRACK: Primary 3D Stage & Docked Inspection Cockpit
          ========================================================================= */}
      <div
        className={`grid gap-3.5 items-stretch transition-all duration-300 min-h-[420px] ${
          sel ? "grid-cols-1 xl:grid-cols-[1fr_360px]" : "grid-cols-1"
        }`}
        id="heart-center-track"
      >
        {/* Primary 3D Canvas Cell */}
        <div
          ref={stageRef}
          className="relative w-full h-[420px] sm:h-[480px] xl:h-full min-h-[420px] rounded-xl overflow-hidden border border-white/[0.08] bg-black/40 heart-stage shadow-xl flex flex-col justify-between"
          id="heart-3d"
          aria-label="Interactive 3D heart with coronary artery risk mapping"
        >
          <Canvas
            camera={{ position: [initPos.x, initPos.y, initPos.z], fov: 40, near: 0.05, far: 50 }}
            dpr={[1, 1.75]}
            gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
            fallback={<div className="absolute inset-0 grid place-items-center text-sm text-white/60">WebGL unavailable — vessel summary shown below.</div>}
            className="!absolute inset-0"
          >
            <HeartScene
              portal={stageRef as unknown as React.RefObject<HTMLElement>}
              assessments={assessments}
              bpm={bpm}
              tint={color}
              xray={xray}
              flowParticles={flowParticles}
              ischemiaMap={ischemiaMap}
              view={view}
              viewNonce={nonce}
              highlight={highlight}
              onSelect={inspect}
              onAnatomyReady={onReady}
            />
          </Canvas>

          {/* Canvas Overlay Legend */}
          <div className="absolute bottom-2.5 right-2.5 z-20 hidden sm:flex items-center gap-2.5 px-2.5 py-1.5 rounded-full bg-black/60 backdrop-blur-md border border-white/10 text-[10px] text-white/60 pointer-events-none">
            {(["patent", "mild", "critical"] as const).map((s) => (
              <span key={s} className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: STATUS_COLOR[s] }} />
                {s === "patent" ? "<25% Clear" : s === "mild" ? "25–50% Mild" : "≥50% Blocked"}
              </span>
            ))}
          </div>

          {!ready && (
            <div className="absolute inset-x-0 bottom-12 z-10 text-center text-[11px] text-white/40 pointer-events-none">
              Mapping coronary anatomy…
            </div>
          )}
        </div>

        {/* Docked Anatomical Inspection Cockpit */}
        <AnimatePresence mode="wait">
          {sel && (
            <motion.div
              key={sel.id}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ type: "spring", stiffness: 300, damping: 28 }}
              className="h-full flex flex-col"
              id="docked-inspection-container"
            >
              <InspectionCard
                v={sel}
                ecg={prediction?.ecg_findings ?? null}
                patient={patient}
                assessments={assessments}
                mode={mode}
                onClose={() => setSelected(null)}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* =========================================================================
          BOTTOM GRID TRACK: Interactive Pathophysiological Cascade + Telemetry + Footnote
          ========================================================================= */}
      <div className="space-y-3" id="heart-bottom-track">
        {/* Interactive "WHERE & HOW Pathology Develops" Cascade Strip */}
        <div className="rounded-xl border border-white/10 bg-black/60 backdrop-blur-md p-3 shadow-lg" id="pathology-cascade-strip">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="flex h-2 w-2 rounded-full bg-cyan-400 animate-ping" />
              <span className="text-[11px] font-bold uppercase tracking-wider text-cyan-200">
                Interactive Pathophysiological Cascade · Where &amp; How Pathology Develops
              </span>
            </div>
            <span className="text-[10px] text-white/40 hidden sm:inline">
              Click a stage to trigger targeted 3D visualization
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">
            {/* Stage 1: Systemic Triggers */}
            <button
              type="button"
              onClick={() => handleStageClick(1)}
              className={`rounded-lg p-2.5 text-left border transition-all cursor-pointer ${
                activeStage === 1
                  ? "bg-indigo-500/20 border-indigo-400/60 ring-1 ring-indigo-400/40"
                  : "bg-white/[0.03] hover:bg-white/[0.07] border-white/[0.06]"
              }`}
            >
              <div className="flex items-center justify-between text-[10px]">
                <span className="font-bold text-indigo-300">1. Systemic Triggers</span>
                <span className="px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-200 font-mono">Stage 1</span>
              </div>
              <div className="text-white text-xs font-semibold mt-1 truncate">
                {activeDrivers.slice(0, 2).join(", ") || "Baseline Biomarkers"}
              </div>
              <div className="text-[10px] text-white/50 mt-0.5 leading-tight">
                Endothelial injury &amp; lipid infiltration
              </div>
            </button>

            {/* Stage 2: Atherosclerotic Plaque & Pinching */}
            <button
              type="button"
              onClick={() => handleStageClick(2)}
              className={`rounded-lg p-2.5 text-left border transition-all cursor-pointer ${
                activeStage === 2
                  ? "bg-amber-500/20 border-amber-400/60 ring-1 ring-amber-400/40"
                  : "bg-white/[0.03] hover:bg-white/[0.07] border-white/[0.06]"
              }`}
            >
              <div className="flex items-center justify-between text-[10px]">
                <span className="font-bold text-amber-300">2. Plaque &amp; Pinching</span>
                <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-200 font-mono">Stage 2</span>
              </div>
              <div className="text-white text-xs font-semibold mt-1">
                {targetCulprit?.id ?? "Target"}: {targetCulprit?.stenosis ?? 0}% Diameter Stenosis
              </div>
              <div className="text-[10px] text-white/50 mt-0.5 leading-tight">
                Atheroma narrows lumen at 3D coordinate
              </div>
            </button>

            {/* Stage 3: Hemodynamic Flow Drop */}
            <button
              type="button"
              onClick={() => handleStageClick(3)}
              className={`rounded-lg p-2.5 text-left border transition-all cursor-pointer ${
                activeStage === 3
                  ? "bg-cyan-500/20 border-cyan-400/60 ring-1 ring-cyan-400/40"
                  : "bg-white/[0.03] hover:bg-white/[0.07] border-white/[0.06]"
              }`}
            >
              <div className="flex items-center justify-between text-[10px]">
                <span className="font-bold text-cyan-300">3. Hemodynamic Jet</span>
                <span className="px-1.5 py-0.2 rounded bg-cyan-500/20 text-cyan-200 font-mono">Stage 3</span>
              </div>
              <div className="text-white text-xs font-semibold mt-1">
                FFR {targetCulprit?.ffr.toFixed(2) ?? "1.00"} · −{targetCulprit?.flowReduction ?? 0}% Flow
              </div>
              <div className="text-[10px] text-white/50 mt-0.5 leading-tight">
                Venturi acceleration &amp; post-stenotic drop
              </div>
            </button>

            {/* Stage 4: Myocardial Ischemia & Wall Strain */}
            <button
              type="button"
              onClick={() => handleStageClick(4)}
              className={`rounded-lg p-2.5 text-left border transition-all cursor-pointer ${
                activeStage === 4
                  ? "bg-rose-500/20 border-rose-400/60 ring-1 ring-rose-400/40"
                  : "bg-white/[0.03] hover:bg-white/[0.07] border-white/[0.06]"
              }`}
            >
              <div className="flex items-center justify-between text-[10px]">
                <span className="font-bold text-rose-300">4. Myocardial Ischemia</span>
                <span className="px-1.5 py-0.2 rounded bg-rose-500/20 text-rose-200 font-mono">Stage 4</span>
              </div>
              <div className="text-white text-xs font-semibold mt-1">
                {targetCulprit?.wall ?? "Myocardium"} Hypokinesia
              </div>
              <div className="text-[10px] text-white/50 mt-0.5 leading-tight">
                Oxygen deficit &amp; systolic contraction attenuation
              </div>
            </button>
          </div>
        </div>

        {/* Telemetry Bar & Quick Vessel Strip */}
        <div className="rounded-xl border border-white/10 bg-black/60 backdrop-blur-md p-3 flex flex-wrap items-center justify-between gap-3 shadow-lg" id="heart-telemetry-bar">
          <div className="flex items-center gap-2.5 text-xs text-white/80 flex-wrap">
            <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-white/[0.05] border border-white/10">
              <span className="w-2 h-2 rounded-full heartbeat-dot" style={{ backgroundColor: color, animationDuration: `${60 / bpm}s` }} />
              <span className="font-mono font-bold text-white" id="heart-bpm">{bpm} BPM</span>
              <span className="text-white/30">·</span>
              <span className="font-mono text-white/60">{hz.toFixed(2)} Hz</span>
            </div>

            <div className="px-2.5 py-1 rounded-full bg-white/[0.05] border border-white/10 font-mono">
              <span className="text-white/50 mr-1">{isPatient ? "Risk:" : "CAD Risk:"}</span>
              <span className="font-bold text-white">{(risk * 100).toFixed(0)}%</span>
            </div>

            {!isPatient && (
              <>
                <div className="px-2.5 py-1 rounded-full bg-white/[0.05] border border-white/10 font-mono">
                  <span className="text-white/50 mr-1">Min FFR:</span>
                  <span className={`font-bold ${minFfr <= 0.8 ? "text-rose-300" : "text-emerald-300"}`}>
                    {minFfr.toFixed(2)}
                  </span>
                </div>
                <div className="px-2.5 py-1 rounded-full bg-white/[0.05] border border-white/10 font-mono">
                  <span className="text-white/50 mr-1">Fluoroscopy ca:</span>
                  <span className="font-bold text-white">{ca} / 3</span>
                </div>
              </>
            )}

            {criticalCount > 0 && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-500/20 border border-rose-400/40 text-rose-200 text-xs font-semibold animate-pulse">
                <Zap size={12} /> {criticalCount} {isPatient ? "Narrowed Artery" : "Critical Lesion"}{criticalCount > 1 ? "s" : ""}
              </div>
            )}
          </div>

          {/* Quick Vessel Strip */}
          <div className="flex items-center gap-1.5 flex-wrap" id="coronary-vessels-strip">
            {assessments.map((a) => {
              const c = STATUS_COLOR[a.status];
              const active = highlight === a.id;
              return (
                <button
                  key={a.id}
                  id={`vessel-chip-${a.id}`}
                  type="button"
                  onClick={() => inspect(a.id)}
                  data-status={a.status}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border transition-all cursor-pointer ${
                    active ? "bg-white/20 border-white/50 shadow-md" : "bg-white/[0.04] hover:bg-white/[0.08] border-white/10"
                  }`}
                  style={{ borderColor: active ? `${c}` : `${c}44` }}
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: c }} />
                  <span className="text-[11px] font-semibold text-white/90">{a.id}</span>
                  <span className="font-mono text-[10px] font-bold" style={{ color: c }}>{a.stenosis}%</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Methodological Guardrail Footnote */}
        <div className="flex items-center gap-2 text-[10.5px] text-white/55 bg-white/[0.02] border border-white/[0.06] px-3 py-1.5 rounded-xl shadow-sm" id="methodology-footnote-badge">
          <span className="text-cyan-400 font-bold shrink-0 text-xs">ℹ</span>
          <span className="leading-tight">
            <strong className="text-white/80 font-medium">Methodological Guardrail:</strong> 3D vessel narrowing &amp; perfusion deficits are projected from multi-target ML predictions (CAD, LAD, LCX, RCA); clinical &amp; echo inputs (incl. RWMA) act strictly as model features.
          </span>
        </div>

        {/* Prominent Clinical Safety Disclaimer (Track A Requirement 5) */}
        <div
          className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2 text-[11px] text-amber-200/90 leading-relaxed flex items-start gap-2 shadow-sm"
          id="heart-safety-disclaimer"
          role="note"
        >
          <span className="shrink-0 text-amber-400 font-bold text-xs mt-0.5">⚠️</span>
          <span>
            <strong className="font-semibold text-amber-300">CLINICAL SAFETY DISCLAIMER:</strong> Predictions and 3D visualizations are for clinical decision support and educational purposes only and are NOT a substitute for formal diagnostic imaging (such as coronary angiography or cardiac CT) or professional medical diagnosis.
          </span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Anatomical Inspection Card (Clinician Telemetry vs Patient Explainer Mode)
// ---------------------------------------------------------------------------------------------
const LEAD_GRID = [["I", "aVR", "V1", "V4"], ["II", "aVL", "V2", "V5"], ["III", "aVF", "V3", "V6"]];

const PLAIN_NAMES: Record<VesselId, { title: string; location: string }> = {
  LAD: {
    title: "Front Main Artery (LAD)",
    location: "Feeds oxygen & blood down the front main pumping wall of your heart.",
  },
  LCx: {
    title: "Side Circumflex Artery (LCx)",
    location: "Wraps around to nourish the left and back walls of your heart.",
  },
  RCA: {
    title: "Bottom & Right Artery (RCA)",
    location: "Feeds the bottom of your heart and the electrical timing nodes.",
  },
  LM: {
    title: "Crown Trunk Artery (Left Main)",
    location: "The master root artery branching into your front and side heart arteries.",
  },
};

function InspectionCard({
  v,
  ecg,
  patient,
  assessments,
  mode = "clinician",
  onClose,
}: {
  v: VesselAssessment;
  ecg: EcgFindings | null;
  patient: Patient;
  assessments: VesselAssessment[];
  mode?: "clinician" | "patient";
  onClose: () => void;
}) {
  const isPatient = mode === "patient";
  const c = STATUS_COLOR[v.status];
  const meta = VESSEL_META[v.id];
  const st = ecg?.st_deviation_mv ?? null;
  const stShift = st !== null && Math.abs(st) >= 0.05;

  const diameterFrac = v.stenosis / 100;
  const areaReduction = v.lumenAreaReduction ?? Math.round((1 - Math.pow(1 - diameterFrac, 2)) * 100);
  const reqFeat = patient.request?.features;
  const ca = patient.features?.ca ?? reqFeat?.ca ?? assessments.filter((a) => a.id !== "LM" && a.stenosis >= 50).length;
  const oldpeak = patient.features?.oldpeak ?? reqFeat?.oldpeak ?? (st !== null ? Math.abs(st * 10).toFixed(1) : (v.status === "critical" ? "2.2" : "0.0"));

  const plainInfo = PLAIN_NAMES[v.id];

  // Actionable prevention guidance
  const actionItems: string[] = [];
  if (reqFeat?.smoker) {
    actionItems.push("🚭 Quitting smoking relaxes coronary blood vessels and halts soft plaque inflammation.");
  }
  if (reqFeat && reqFeat.systolic_bp > 130) {
    actionItems.push(`🩺 Lowering blood pressure from ${reqFeat.systolic_bp} towards 120 mmHg directly relieves artery wall shear stress.`);
  }
  if (reqFeat && reqFeat.cholesterol > 200) {
    actionItems.push(`🥗 Managing dietary saturated fats and cholesterol helps shrink soft plaque inside your ${v.id} artery.`);
  }
  if (reqFeat?.diabetic) {
    actionItems.push("🩸 Steady blood sugar control protects the delicate endothelial inner lining of your blood vessels.");
  }
  if (reqFeat?.exercise_angina) {
    actionItems.push("🚶 Guided cardio walking (cardiac rehab) promotes natural collateral blood vessel growth around the narrowing.");
  }

  return (
    <aside
      id="vessel-inspector"
      role="dialog"
      aria-label={`${v.name} inspection`}
      className="w-full h-full max-h-[580px] overflow-y-auto no-scrollbar rounded-xl border bg-[rgba(8,10,22,0.94)] backdrop-blur-xl p-4 text-[12px] shadow-2xl flex flex-col justify-between"
      style={{ borderColor: `${c}55`, boxShadow: `0 10px 40px -15px ${c}44` }}
    >
      <div>
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-lg sm:text-xl font-bold tracking-wide text-white">
                {isPatient ? plainInfo.title : v.id}
              </span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ color: c, background: `${c}1f`, border: `1px solid ${c}55` }}>
                {isPatient ? (v.stenosis >= 50 ? "Restricted Flow" : v.stenosis >= 25 ? "Early Plaque" : "Healthy & Clear") : STATUS_LABEL[v.status]}
              </span>
            </div>
            <div className="text-white/70 text-xs mt-0.5">
              {isPatient ? plainInfo.location : v.name}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close inspection"
            id="vessel-inspector-close"
            className="p-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X size={15} />
          </button>
        </div>

        {/* Stenosis Progress Bar */}
        <div className="mt-3">
          <div className="flex items-end justify-between">
            <span className="text-white/50 text-[11px]">
              {isPatient ? "Artery Narrowing" : "Diameter stenosis"}
            </span>
            <span className="font-mono text-2xl font-bold" style={{ color: c }} id="inspector-stenosis">
              {v.stenosis}%
            </span>
          </div>
          <div className="relative mt-1.5 h-2 rounded-full overflow-hidden bg-gradient-to-r from-emerald-400/25 via-amber-400/25 to-rose-500/25">
            <motion.div className="absolute inset-y-0 left-0 rounded-full" style={{ background: c }} initial={{ width: 0 }} animate={{ width: `${v.stenosis}%` }} transition={{ duration: 0.7 }} />
            <span className="absolute inset-y-0 left-1/4 w-px bg-white/30" />
            <span className="absolute inset-y-0 left-1/2 w-px bg-white/30" />
          </div>
          <div className="flex justify-between text-[9px] text-white/35 mt-0.5 font-mono">
            <span>0%</span><span className="-ml-3">25%</span><span className="-ml-3">50%</span><span>99%</span>
          </div>
          {!isPatient && (
            <div className="mt-1 text-[10px] text-white/45 flex items-center gap-1">
              <Layers size={10} /> {SOURCE_LABEL[v.source]}
            </div>
          )}
        </div>

        {/* Lumen Cross-Section Card */}
        <section className="mt-3 rounded-lg bg-white/[0.04] border border-white/[0.06] p-2.5" id="vessel-lumen-card">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-white/60 text-[10px] uppercase tracking-wider font-semibold">
              <Crosshair size={11} className="text-amber-400" />
              {isPatient ? "Inside Your Blood Pipe" : "Lumen Cross-Section"}
            </div>
            <span
              className="text-[9px] px-2 py-0.5 rounded font-mono font-semibold"
              style={{
                color: v.ffr <= 0.8 ? "#f43f5e" : "#34d399",
                background: v.ffr <= 0.8 ? "rgba(244,63,94,0.15)" : "rgba(52,211,153,0.15)",
                border: `1px solid ${v.ffr <= 0.8 ? "rgba(244,63,94,0.4)" : "rgba(52,211,153,0.4)"}`,
              }}
            >
              {isPatient
                ? v.ffr <= 0.8
                  ? "⚡ Flow Restricted"
                  : "✓ Good Blood Supply"
                : v.ffr <= 0.8
                ? "⚡ Hemodynamically Significant"
                : "✓ Preserved Flow"}
            </span>
          </div>

          {/* Visual Lumen vs Atheroma Graphic */}
          <div className="mt-2.5 flex items-center gap-3">
            <div className="relative shrink-0 w-14 h-14 rounded-full bg-slate-950 border border-white/20 flex items-center justify-center overflow-hidden shadow-inner">
              <div
                className="absolute inset-0 rounded-full"
                style={{
                  background:
                    v.stenosis > 0
                      ? "radial-gradient(circle at 35% 35%, #fbbf24 0%, #b45309 65%, #78350f 100%)"
                      : "#1e293b",
                }}
              />
              <motion.div
                className="relative rounded-full shadow-[inset_0_0_8px_rgba(0,0,0,0.6)]"
                style={{
                  background: "radial-gradient(circle at 45% 45%, #f43f5e, #881337)",
                  border: "1px solid rgba(255,255,255,0.4)",
                }}
                initial={false}
                animate={{
                  width: `${Math.max(8, Math.round(50 * (1 - v.stenosis / 100)))}px`,
                  height: `${Math.max(8, Math.round(50 * (1 - v.stenosis / 100)))}px`,
                }}
                transition={{ duration: 0.6 }}
              />
            </div>

            <div className="flex-1 space-y-1 text-[11px]">
              <div className="flex justify-between items-baseline">
                <span className="text-white/50 text-[10px]">
                  {isPatient ? "Channel Blocked" : "Area reduction"}
                </span>
                <span className="font-mono text-sm font-bold text-amber-300">
                  {areaReduction}% <span className="text-[10px] text-white/40">{isPatient ? "occluded" : "narrowed"}</span>
                </span>
              </div>
              <div className="flex justify-between items-baseline">
                <span className="text-white/50 text-[10px]">
                  {isPatient ? "Flow Index" : "Est. FFR proxy"}
                </span>
                <span className="font-mono font-semibold" style={{ color: v.ffr <= 0.8 ? "#f43f5e" : "#34d399" }}>
                  {v.ffr.toFixed(2)}
                </span>
              </div>
              <div className="text-[9.5px] text-white/45 leading-tight">
                {isPatient
                  ? v.stenosis >= 50
                    ? "Like a pinched hose, downstream muscle receives less oxygen during activities like stairs."
                    : "Blood passes smoothly to keep heart muscle relaxed and well-oxygenated."
                  : v.stenosis >= 50
                  ? "Geometric stenosis causes exponential pressure drop across lesion."
                  : "Mild non-obstructive plaque. Subcritical lumen area impingement."}
              </div>
            </div>
          </div>

          {!isPatient && (
            <div className="mt-2.5 pt-2 border-t border-white/[0.06] grid grid-cols-2 gap-2 text-[10px]">
              <div className="rounded bg-white/[0.03] p-1.5 border border-white/[0.04]">
                <div className="text-white/40 uppercase tracking-wider text-[9px]">UCI ca feature</div>
                <div className="font-mono font-bold text-white mt-0.5">
                  {ca} / 3 <span className="font-normal text-white/50">vessels</span>
                </div>
                <div className="text-[9px] text-white/35">Fluoroscopy diseased count</div>
              </div>
              <div className="rounded bg-white/[0.03] p-1.5 border border-white/[0.04]">
                <div className="text-white/40 uppercase tracking-wider text-[9px]">UCI oldpeak</div>
                <div className="font-mono font-bold text-white mt-0.5">
                  {oldpeak} <span className="font-normal text-white/50">mm ST</span>
                </div>
                <div className="text-[9px] text-white/35">Ischemic ST displacement</div>
              </div>
            </div>
          )}
        </section>

        {/* Patient Explainer Mode: Actionable Recovery & Prevention Plan */}
        {isPatient ? (
          <section className="mt-3 rounded-lg bg-emerald-950/30 border border-emerald-500/25 p-2.5" id="patient-recovery-plan">
            <div className="flex items-center gap-1.5 text-emerald-300 text-[10px] uppercase tracking-wider font-bold">
              <Sparkles size={11} /> Actionable Recovery &amp; Prevention Plan
            </div>
            <div className="mt-2 space-y-1.5 text-[10.5px] text-white/85 leading-relaxed">
              {actionItems.length > 0 ? (
                actionItems.map((item, i) => (
                  <div key={i} className="flex items-start gap-1.5">
                    <span>{item}</span>
                  </div>
                ))
              ) : (
                <div className="text-white/70">
                  ✓ Keep up regular physical activity, balanced hydration, and routine checkups!
                </div>
              )}
            </div>
            <div className="mt-2 pt-1.5 border-t border-emerald-500/20 text-[9.5px] text-emerald-200/80">
              💡 Tip: Try adjusting the What-If sliders on the right to see how lifestyle changes reopen your arteries in live 3D!
            </div>
          </section>
        ) : (
          <>
            {/* Clinician Mode: Territory */}
            <section className="mt-2.5 rounded-lg bg-white/[0.04] border border-white/[0.06] p-2.5">
              <div className="flex items-center gap-1.5 text-white/50 text-[10px] uppercase tracking-wider">
                <Crosshair size={11} /> Territory
              </div>
              <div className="mt-1 text-white/90">{v.territory}</div>
              <div className="mt-0.5 text-white/45 text-[11px]">
                Wall: {v.wall} · ~{v.myocardiumAtRisk}% of LV myocardium
              </div>
            </section>

            {/* Clinician Mode: ECG leads */}
            <section className="mt-2.5 rounded-lg bg-white/[0.04] border border-white/[0.06] p-2.5">
              <div className="flex items-center gap-1.5 text-white/50 text-[10px] uppercase tracking-wider">
                <Activity size={11} /> Correlated ECG leads
              </div>
              <div className="mt-2 grid grid-cols-4 gap-1" id="inspector-leads">
                {LEAD_GRID.flat().map((lead) => {
                  const on = v.leads.includes(lead);
                  return (
                    <span
                      key={lead}
                      data-active={on}
                      className="text-center rounded-md py-1 font-mono text-[10px] border transition-colors"
                      style={
                        on
                          ? { color: "#fff", background: `${c}33`, borderColor: `${c}88`, boxShadow: `0 0 10px ${c}33` }
                          : { color: "rgba(255,255,255,0.35)", borderColor: "rgba(255,255,255,0.06)" }
                      }
                    >
                      {lead}
                    </span>
                  );
                })}
              </div>
              <div className="mt-1.5 text-[11px] text-white/60">{meta.leadNote}</div>
              {ecg && (
                <div className="mt-1.5 text-[10px] text-white/45">
                  Rhythm strip: ST {st !== null ? `${st > 0 ? "+" : ""}${st.toFixed(2)} mV` : "n/a"}
                  {stShift ? (v.status === "critical" ? " — ischemic shift" : " — ST shift present") : " — no significant ST shift"}
                </div>
              )}
            </section>

            {/* Clinician Mode: Flow */}
            <section className="mt-2.5 rounded-lg bg-white/[0.04] border border-white/[0.06] p-2.5">
              <div className="flex items-center gap-1.5 text-white/50 text-[10px] uppercase tracking-wider">
                <Droplets size={11} /> Blood flow estimate
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div>
                  <div className="text-white/45 text-[10px]">Flow reduction</div>
                  <div className="font-mono text-base font-semibold" style={{ color: c }} id="inspector-flow">
                    −{v.flowReduction}%
                  </div>
                </div>
                <div>
                  <div className="text-white/45 text-[10px]">Est. FFR</div>
                  <div className={`font-mono text-base font-semibold ${v.ffr <= 0.8 ? "text-rose-300" : "text-white/90"}`}>
                    {v.ffr.toFixed(2)}
                  </div>
                </div>
              </div>
              <div className="mt-1.5 h-1.5 rounded-full bg-white/10 overflow-hidden">
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: `linear-gradient(90deg, #22d3ee, ${c})` }}
                  initial={{ width: "100%" }}
                  animate={{ width: `${100 - v.flowReduction}%` }}
                  transition={{ duration: 0.8 }}
                />
              </div>
            </section>
          </>
        )}
      </div>

      <div className="mt-3 pt-2 border-t border-white/[0.06] flex items-center justify-between text-[10px] text-white/40">
        <span className="flex items-center gap-1">
          <Focus size={10} /> Camera focused on {VIEW_PRESETS[v.id].label}
        </span>
        <span>Esc to close</span>
      </div>
    </aside>
  );
}
