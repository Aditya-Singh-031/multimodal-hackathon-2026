"use client";
import { Canvas } from "@react-three/fiber";
import { AnimatePresence, motion } from "framer-motion";
import { Activity, Crosshair, Droplets, Eye, Focus, Layers, ScanLine, X, Zap } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
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
}

const TOOLBAR: { view: ViewId; text: string }[] = [
  { view: "overview", text: "Overview" },
  { view: "LAD", text: "Focus LAD (Anterior)" },
  { view: "LCx", text: "Focus LCx (Lateral)" },
  { view: "RCA", text: "Focus RCA (Inferior)" },
  { view: "LM", text: "Focus LM (Left Main)" },
];

const SOURCE_LABEL: Record<VesselAssessment["source"], string> = {
  angiography: "Angiographic finding",
  "clinical-note": "Quantified in cath note",
  model: "Model-inferred from fused risk",
};

const [initPos] = cameraFor("overview", FALLBACK_ANATOMY);

export default function Heart3D({
  patient: patientProp,
  prediction: predictionProp = null,
  color,
  bpm: bpmProp,
  risk: riskProp,
  vessels: vesselsProp,
}: Heart3DProps) {
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
  const [ready, setReady] = useState(false);

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
  const onReady = useCallback(() => setReady(true), []);

  return (
    <div className="flex flex-col gap-3" id="heart-3d-container" data-view={view} data-bpm={bpm} data-hz={hz.toFixed(3)} data-xray={xray}>
      <div
        className="relative w-full h-[380px] sm:h-[440px] lg:h-[500px] rounded-xl overflow-hidden border border-white/[0.07] heart-stage"
        id="heart-3d"
        aria-label="Interactive 3D heart with coronary artery risk mapping"
      >
        {/* Floating camera toolbar */}
        <div className="absolute top-2.5 inset-x-2.5 z-30 flex items-start justify-between gap-2 pointer-events-none">
          <div role="toolbar" aria-label="Camera views" className="pointer-events-auto flex gap-1 p-1 rounded-xl bg-black/60 backdrop-blur-md border border-white/10 overflow-x-auto max-w-full no-scrollbar shadow-lg">
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
                  className={`flex items-center gap-1.5 shrink-0 rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-all ${active ? "bg-white/20 text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.22)]" : "text-white/70 hover:text-white hover:bg-white/[0.08]"}`}
                >
                  {v === "overview" ? <Eye size={12} /> : <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: a ? STATUS_COLOR[a.status] : "#fff" }} />}
                  <span>{text}</span>
                </button>
              );
            })}
          </div>
          <button
            id="xray-toggle"
            type="button"
            aria-pressed={xray}
            onClick={() => setXray((x) => !x)}
            className={`pointer-events-auto shrink-0 flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[11px] font-semibold border backdrop-blur-md transition-all ${xray ? "bg-cyan-500/25 border-cyan-300 text-cyan-200 shadow-[0_0_18px_rgba(34,211,238,0.4)]" : "bg-black/60 border-white/10 text-white/70 hover:text-white hover:bg-white/10 shadow-lg"}`}
          >
            <ScanLine size={13} /> X-Ray Mode
          </button>
        </div>

        <Canvas
          camera={{ position: [initPos.x, initPos.y, initPos.z], fov: 40, near: 0.05, far: 50 }}
          dpr={[1, 1.75]}
          gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
          fallback={<div className="absolute inset-0 grid place-items-center text-sm text-white/60">WebGL unavailable — vessel summary shown below.</div>}
          className="!absolute inset-0"
        >
          <HeartScene assessments={assessments} bpm={bpm} tint={color} xray={xray} view={view} viewNonce={nonce} highlight={highlight} onSelect={inspect} onAnatomyReady={onReady} />
        </Canvas>

        {/* Live vitals HUD */}
        <div className="absolute bottom-2.5 left-2.5 z-20 flex items-center gap-2 px-2.5 py-1.5 rounded-full bg-black/60 backdrop-blur-md border border-white/10 text-[11px] pointer-events-none" id="heart-hud">
          <span className="w-2 h-2 rounded-full heartbeat-dot" style={{ backgroundColor: color, animationDuration: `${60 / bpm}s` }} />
          <span className="font-mono text-white/90" id="heart-bpm">{bpm} BPM</span>
          <span className="text-white/30">·</span>
          <span className="font-mono text-white/60">{hz.toFixed(2)} Hz</span>
          <span className="text-white/30">·</span>
          <span className="text-white/70">{(risk * 100).toFixed(0)}% risk</span>
          {criticalCount > 0 && (
            <span className="ml-1 flex items-center gap-1 text-rose-300"><Zap size={11} /> {criticalCount} critical</span>
          )}
        </div>

        {/* Legend */}
        <div className="absolute bottom-2.5 right-2.5 z-20 hidden sm:flex items-center gap-2.5 px-2.5 py-1.5 rounded-full bg-black/60 backdrop-blur-md border border-white/10 text-[10px] text-white/60 pointer-events-none">
          {(["patent", "mild", "critical"] as const).map((s) => (
            <span key={s} className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: STATUS_COLOR[s] }} />
              {s === "patent" ? "<25%" : s === "mild" ? "25–50%" : ">50%"}
            </span>
          ))}
        </div>

        {!ready && (
          <div className="absolute inset-x-0 bottom-12 z-10 text-center text-[11px] text-white/40 pointer-events-none">Mapping coronary anatomy…</div>
        )}

        <AnimatePresence>
          {sel && (
            <InspectionCard key={sel.id} v={sel} ecg={prediction?.ecg_findings ?? null} onClose={() => setSelected(null)} />
          )}
        </AnimatePresence>
      </div>

      {/* Coronary vessel summary (accessible, non-3D control surface) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" id="coronary-vessels-strip">
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
              className={`text-left rounded-lg px-2.5 py-2 border transition-all hover:-translate-y-0.5 ${active ? "bg-white/[0.08]" : "bg-white/[0.03] hover:bg-white/[0.06]"}`}
              style={{ borderColor: active ? `${c}aa` : `${c}33`, boxShadow: a.status === "critical" ? `0 0 14px ${c}22` : undefined }}
            >
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-semibold text-white/90">{a.id === "LM" ? "Left Main" : a.id}</span>
                <span className="font-mono font-semibold" style={{ color: c }}>{a.stenosis}%</span>
              </div>
              <div className="mt-1.5 h-1 rounded-full bg-white/10 overflow-hidden">
                <motion.div className="h-full rounded-full" style={{ background: c }} initial={false} animate={{ width: `${a.stenosis}%` }} transition={{ duration: 0.6 }} />
              </div>
              <div className="mt-1 text-[10px]" style={{ color: `${c}cc` }}>{STATUS_LABEL[a.status]}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Anatomical Inspection card
// ---------------------------------------------------------------------------------------------
const LEAD_GRID = [["I", "aVR", "V1", "V4"], ["II", "aVL", "V2", "V5"], ["III", "aVF", "V3", "V6"]];

function InspectionCard({ v, ecg, onClose }: { v: VesselAssessment; ecg: EcgFindings | null; onClose: () => void }) {
  const c = STATUS_COLOR[v.status];
  const meta = VESSEL_META[v.id];
  const st = ecg?.st_deviation_mv ?? null;
  const stShift = st !== null && Math.abs(st) >= 0.05;

  return (
    <motion.aside
      id="vessel-inspector"
      role="dialog"
      aria-label={`${v.name} inspection`}
      initial={{ opacity: 0, x: 24, scale: 0.98 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 24, scale: 0.98 }}
      transition={{ type: "spring", stiffness: 320, damping: 30 }}
      className="absolute z-40 right-2.5 top-[58px] bottom-12 w-[min(300px,calc(100%-1.25rem))] overflow-y-auto no-scrollbar rounded-xl border bg-[rgba(8,10,22,0.86)] backdrop-blur-xl p-4 text-[12px] shadow-2xl"
      style={{ borderColor: `${c}55`, boxShadow: `0 20px 60px -20px ${c}55` }}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold tracking-wide text-white">{v.id}</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ color: c, background: `${c}1f`, border: `1px solid ${c}55` }}>{STATUS_LABEL[v.status]}</span>
          </div>
          <div className="text-white/70 mt-0.5">{v.name}</div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close inspection" id="vessel-inspector-close" className="p-1 rounded-md text-white/50 hover:text-white hover:bg-white/10"><X size={14} /></button>
      </div>

      {/* Stenosis gauge */}
      <div className="mt-3">
        <div className="flex items-end justify-between">
          <span className="text-white/50 text-[11px]">Diameter stenosis</span>
          <span className="font-mono text-2xl font-bold" style={{ color: c }} id="inspector-stenosis">{v.stenosis}%</span>
        </div>
        <div className="relative mt-1.5 h-2 rounded-full overflow-hidden bg-gradient-to-r from-emerald-400/25 via-amber-400/25 to-rose-500/25">
          <motion.div className="absolute inset-y-0 left-0 rounded-full" style={{ background: c }} initial={{ width: 0 }} animate={{ width: `${v.stenosis}%` }} transition={{ duration: 0.7 }} />
          <span className="absolute inset-y-0 left-1/4 w-px bg-white/30" />
          <span className="absolute inset-y-0 left-1/2 w-px bg-white/30" />
        </div>
        <div className="flex justify-between text-[9px] text-white/35 mt-0.5 font-mono"><span>0</span><span className="-ml-3">25</span><span className="-ml-3">50</span><span>99</span></div>
        <div className="mt-1 text-[10px] text-white/45 flex items-center gap-1"><Layers size={10} /> {SOURCE_LABEL[v.source]}</div>
      </div>

      {/* Territory */}
      <section className="mt-3 rounded-lg bg-white/[0.04] border border-white/[0.06] p-2.5">
        <div className="flex items-center gap-1.5 text-white/50 text-[10px] uppercase tracking-wider"><Crosshair size={11} /> Territory</div>
        <div className="mt-1 text-white/90">{v.territory}</div>
        <div className="mt-0.5 text-white/45 text-[11px]">Wall: {v.wall} · ~{v.myocardiumAtRisk}% of LV myocardium</div>
      </section>

      {/* ECG leads */}
      <section className="mt-2.5 rounded-lg bg-white/[0.04] border border-white/[0.06] p-2.5">
        <div className="flex items-center gap-1.5 text-white/50 text-[10px] uppercase tracking-wider"><Activity size={11} /> Correlated ECG leads</div>
        <div className="mt-2 grid grid-cols-4 gap-1" id="inspector-leads">
          {LEAD_GRID.flat().map((lead) => {
            const on = v.leads.includes(lead);
            return (
              <span
                key={lead}
                data-active={on}
                className="text-center rounded-md py-1 font-mono text-[10px] border transition-colors"
                style={on ? { color: "#fff", background: `${c}33`, borderColor: `${c}88`, boxShadow: `0 0 10px ${c}33` } : { color: "rgba(255,255,255,0.35)", borderColor: "rgba(255,255,255,0.06)" }}
              >
                {lead}
              </span>
            );
          })}
        </div>
        <div className="mt-1.5 text-[11px] text-white/60">{meta.leadNote}</div>
        {ecg && (
          <div className="mt-1.5 text-[10px] text-white/45">
            Patient rhythm strip: ST {st !== null ? `${st > 0 ? "+" : ""}${st.toFixed(2)} mV` : "n/a"}
            {stShift ? (v.status === "critical" ? " — ischemic shift, compatible with this territory" : " — ST shift present") : " — no significant ST shift"}
            <span className="block text-white/30">Territorial localisation needs a 12-lead ECG ({ALL_LEADS.length} leads).</span>
          </div>
        )}
      </section>

      {/* Flow */}
      <section className="mt-2.5 rounded-lg bg-white/[0.04] border border-white/[0.06] p-2.5">
        <div className="flex items-center gap-1.5 text-white/50 text-[10px] uppercase tracking-wider"><Droplets size={11} /> Blood flow estimate</div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div>
            <div className="text-white/45 text-[10px]">Flow reduction</div>
            <div className="font-mono text-lg font-semibold" style={{ color: c }} id="inspector-flow">−{v.flowReduction}%</div>
          </div>
          <div>
            <div className="text-white/45 text-[10px]">Est. FFR</div>
            <div className={`font-mono text-lg font-semibold ${v.ffr <= 0.8 ? "text-rose-300" : "text-white/90"}`}>{v.ffr.toFixed(2)}</div>
          </div>
        </div>
        <div className="mt-1.5 h-1.5 rounded-full bg-white/10 overflow-hidden">
          <motion.div className="h-full rounded-full" style={{ background: `linear-gradient(90deg, #22d3ee, ${c})` }} initial={{ width: "100%" }} animate={{ width: `${100 - v.flowReduction}%` }} transition={{ duration: 0.8 }} />
        </div>
        <div className="mt-1 text-[10px] text-white/40">Hyperemic flow vs. healthy vessel · FFR ≤ 0.80 is haemodynamically significant</div>
      </section>

      <div className="mt-2.5 flex items-center gap-1.5 text-[10px] text-white/35"><Focus size={10} /> Camera locked on {VIEW_PRESETS[v.id].label.toLowerCase()} view · Esc to close</div>
    </motion.aside>
  );
}
