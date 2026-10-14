"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AlertTriangle,
  FileText,
  HeartPulse,
  Loader2,
  RefreshCw,
  RotateCcw,
  Sparkles,
  SlidersHorizontal,
  Stethoscope,
  WifiOff,
  Send,
  CheckCircle2,
} from "lucide-react";
import { getPatients, predict } from "@/lib/api";
import { TIER_COLOR, type Patient, type Prediction, type Simulation } from "@/lib/types";
import RiskGauge from "@/components/RiskGauge";
import ShapChart from "@/components/ShapChart";
import EcgViewer from "@/components/EcgViewer";
import WhatIf from "@/components/WhatIf";

const Heart3D = dynamic(() => import("@/components/Heart3D"), {
  ssr: false,
  loading: () => <div className="skeleton min-h-[460px] h-full w-full rounded-xl" />,
});

function Card({
  title,
  icon: Icon,
  children,
  className = "",
  id,
}: {
  title: string;
  icon: LucideIcon;
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <motion.section
      id={id}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45 }}
      className={`glass glass-hover p-5 h-full flex flex-col justify-between ${className}`}
    >
      <h2 className="flex items-center gap-2 text-xs font-bold tracking-wider uppercase text-[var(--muted)] mb-3 shrink-0">
        <Icon size={15} className="text-[var(--accent2)]" /> {title}
      </h2>
      <div className="flex-1 flex flex-col min-h-0">{children}</div>
    </motion.section>
  );
}

const MOD_COLOR: Record<string, string> = { clinical: "#7c5cff", ecg: "#22d3ee", notes: "#fbbf24" };

const PATIENT_TIER_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  low: { bg: "bg-emerald-500/15", text: "text-emerald-300", border: "border-emerald-400/30" },
  moderate: { bg: "bg-amber-500/15", text: "text-amber-300", border: "border-amber-400/30" },
  high: { bg: "bg-orange-500/15", text: "text-orange-300", border: "border-orange-400/30" },
  critical: { bg: "bg-rose-500/15", text: "text-rose-300", border: "border-rose-400/30" },
};

export default function Home() {
  const [patients, setPatients] = useState<Patient[] | null>(null);
  const [sel, setSel] = useState<Patient | null>(null);
  const [pred, setPred] = useState<Prediction | null>(null);
  const [sim, setSim] = useState<Simulation | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [offline, setOffline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Interactive Clinical Note Editor state
  const [editedNotes, setEditedNotes] = useState<string>("");
  const [noteAnalyzing, setNoteAnalyzing] = useState(false);
  const [noteSuccess, setNoteSuccess] = useState(false);

  const run = useCallback(async (p: Patient) => {
    setSel(p);
    setEditedNotes(p.request.notes ?? "");
    setLoading(true);
    setError(null);
    setSim(null);
    try {
      const { data, offline: off } = await predict(p.request);
      setPred(data);
      setOffline((o) => o || off);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Prediction failed");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleResetSimulation = useCallback(() => {
    setSim(null);
    setResetKey((k) => k + 1);
  }, []);

  const handleReanalyzeNotes = async () => {
    if (!sel) return;
    setNoteAnalyzing(true);
    setError(null);
    try {
      const updatedReq = {
        ...sel.request,
        notes: editedNotes,
      };
      const { data, offline: off } = await predict(updatedReq);
      setPred(data);
      setOffline((o) => o || off);
      setSel((prev) => (prev ? { ...prev, request: updatedReq } : prev));
      setNoteSuccess(true);
      setTimeout(() => setNoteSuccess(false), 2400);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Note re-analysis failed");
    } finally {
      setNoteAnalyzing(false);
    }
  };

  const handleResetNotes = () => {
    if (!sel || !patients) return;
    const orig = patients.find((p) => p.id === sel.id)?.request.notes ?? "";
    setEditedNotes(orig);
  };

  const boot = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, offline: off } = await getPatients();
    setPatients(data);
    setOffline(off);
    if (data.length) await run(data[data.length - 1]);
    else setLoading(false);
  }, [run]);

  useEffect(() => {
    boot();
  }, [boot]);

  const activePred = sim?.modified ?? pred;
  const isSimulating = sim !== null;
  const color = activePred ? TIER_COLOR[activePred.tier] : "#7c5cff";
  const f = sel?.request.features;

  return (
    <main className="max-w-[1560px] mx-auto w-full px-4 sm:px-6 lg:px-8 py-6">
      {/* Header bar */}
      <header className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl md:text-4xl font-extrabold flex items-center gap-3 tracking-tight">
            <span className="pulse-ring inline-flex p-2 rounded-xl bg-[var(--accent)]/20 shadow-lg">
              <HeartPulse className="text-[var(--accent)]" size={28} />
            </span>
            <span className="gradient-text">CardioFusion</span>
          </h1>
          <p className="text-[var(--muted)] text-xs sm:text-sm mt-1">
            Multimodal CAD Risk Intelligence · Tabular Clinical × 12-Lead ECG × Clinical Notes NLP
          </p>
        </div>
        <div className="flex items-center gap-2.5 text-xs">
          {offline ? (
            <span id="mode-badge" className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-400/15 text-amber-300 border border-amber-400/30 font-medium">
              <WifiOff size={13} /> Offline demo model
            </span>
          ) : (
            <span id="mode-badge" className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-400/15 text-emerald-300 border border-emerald-400/30 font-medium">
              <Sparkles size={13} /> Live backend{pred?.source === "mock" ? " · rule-based fallback" : " · Gemini live"}
            </span>
          )}
        </div>
      </header>

      {/* Top Cohort Selector Bar (Responsive Auto-Fit Grid for 10 Calibrated Demo Patients) */}
      <nav aria-label="Demo Cohort" className="grid grid-cols-2 sm:grid-cols-5 lg:grid-cols-10 gap-2 mb-6" id="cohort-selector-grid">
        {patients === null && Array.from({ length: 10 }).map((_, i) => <div key={i} className="skeleton h-20 rounded-xl" />)}
        {patients?.map((p) => {
          const active = sel?.id === p.id;
          const profile = p.profile ?? "low";
          const tierStyle = PATIENT_TIER_STYLES[profile] ?? PATIENT_TIER_STYLES.low;
          return (
            <button
              key={p.id}
              id={`patient-${p.id}`}
              onClick={() => run(p)}
              className={`glass rounded-xl p-2.5 text-left transition-all duration-200 cursor-pointer flex flex-col justify-between ${
                active
                  ? "!border-[var(--accent)] ring-2 ring-[var(--accent)]/70 bg-white/10 shadow-[0_0_16px_rgba(124,92,255,0.3)] scale-[1.02]"
                  : "opacity-80 hover:opacity-100 hover:bg-white/[0.06]"
              }`}
            >
              <div>
                <div className="font-bold text-xs truncate text-white">{p.name}</div>
                <div className="text-[10px] text-[var(--muted)] font-mono mt-0.5">
                  {p.request.features.age}y · {p.request.features.sex} · {p.id}
                </div>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider border ${tierStyle.bg} ${tierStyle.text} ${tierStyle.border}`}>
                  {profile}
                </span>
                {active && <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-ping" />}
              </div>
            </button>
          );
        })}
      </nav>

      {error && (
        <div role="alert" className="glass border-rose-500/40 p-4 mb-6 flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-rose-300 text-sm">
            <AlertTriangle size={18} /> {error}
          </span>
          <button
            onClick={() => sel && run(sel)}
            className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
          >
            <RefreshCw size={13} /> Retry
          </button>
        </div>
      )}

      {/* Live Counterfactual Simulation Alert Banner */}
      <AnimatePresence>
        {isSimulating && (
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.98 }}
            id="simulation-active-banner"
            className="mb-6 rounded-2xl border border-cyan-400/40 bg-gradient-to-r from-cyan-950/80 via-indigo-950/70 to-slate-900/80 backdrop-blur-xl p-4 shadow-[0_0_30px_rgba(34,211,238,0.25)] flex flex-wrap items-center justify-between gap-4"
          >
            <div className="flex items-center gap-3">
              <span className="relative flex h-3.5 w-3.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-cyan-400 shadow-[0_0_12px_#22d3ee]" />
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-sm tracking-wide text-cyan-200 uppercase">
                    SIMULATION ACTIVE — LIVE 3D PREVIEW
                  </span>
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-400/30 font-mono font-bold">
                    Δ {sim.delta_risk >= 0 ? "+" : ""}
                    {(sim.delta_risk * 100).toFixed(1)}% Risk
                  </span>
                </div>
                <p className="text-xs text-white/70 mt-0.5">
                  Live counterfactual prediction active. Morphing 3D coronary geometry, particle flow, and wall motion.
                </p>
              </div>
            </div>

            <button
              id="sim-reset-btn"
              type="button"
              onClick={handleResetSimulation}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-400/40 text-xs font-semibold text-cyan-100 transition-all shadow-md active:scale-95 cursor-pointer"
            >
              <RotateCcw size={13} /> Reset to Baseline
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {loading && !pred && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="skeleton h-64 rounded-2xl" />
          ))}
        </div>
      )}

      {/* =========================================================================
          DYNAMIC 12-COLUMN BENTO DASHBOARD GRID
          ========================================================================= */}
      <AnimatePresence mode="wait">
        {activePred && sel && f && (
          <motion.div
            key="dashboard"
            initial={{ opacity: 0 }}
            animate={{ opacity: loading ? 0.6 : 1 }}
            exit={{ opacity: 0 }}
            className="grid grid-cols-1 lg:grid-cols-12 gap-5 auto-rows-min items-stretch transition-opacity"
          >
            {/* -----------------------------------------------------------------------
                1. PRIMARY LEFT STAGE (lg:col-span-7 xl:col-span-8): 3D Cardiac Twin
                ----------------------------------------------------------------------- */}
            <Card
              title="3D Cardiac Digital Twin · Hemodynamic Cockpit"
              icon={HeartPulse}
              id="card-heart"
              className="lg:col-span-7 xl:col-span-8 flex flex-col justify-between"
            >
              <div className="flex-1 flex flex-col min-h-0">
                <Heart3D patient={sel} prediction={activePred} color={color} />
              </div>
            </Card>

            {/* -----------------------------------------------------------------------
                2. PRIMARY RIGHT TELEMETRY STACK (lg:col-span-5 xl:col-span-4):
                   Risk Assessment + Modality Contribution + What-If Simulator
                ----------------------------------------------------------------------- */}
            <div className="lg:col-span-5 xl:col-span-4 flex flex-col gap-5">
              {/* Risk Assessment Card */}
              <Card title="Cardiovascular Risk Assessment" icon={Activity} id="card-risk">
                <RiskGauge risk={activePred.risk} tier={activePred.tier} confidence={activePred.confidence} />
                {isSimulating && (
                  <div className="mt-3 p-2.5 rounded-xl bg-cyan-950/40 border border-cyan-500/30 text-xs text-cyan-200 flex items-center justify-between">
                    <span className="text-white/70">Counterfactual Shift</span>
                    <span className="font-mono font-bold">
                      {(sim.baseline.risk * 100).toFixed(0)}% → {(sim.modified.risk * 100).toFixed(0)}% (Δ{" "}
                      {sim.delta_risk >= 0 ? "+" : ""}
                      {(sim.delta_risk * 100).toFixed(1)}%)
                    </span>
                  </div>
                )}
                <div className="grid grid-cols-3 gap-2 mt-3.5 text-center text-xs">
                  {[
                    ["BP", `${f.systolic_bp} mmHg`],
                    ["Chol", `${f.cholesterol} mg/dL`],
                    ["BMI", `${f.bmi}`],
                  ].map(([k, v]) => (
                    <div key={k} className="rounded-xl bg-white/[0.04] border border-white/[0.06] py-2">
                      <div className="text-[10px] text-[var(--muted)] uppercase font-semibold">{k}</div>
                      <div className="font-bold text-white text-xs mt-0.5">{v}</div>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-[var(--muted)] mt-3 leading-relaxed" id="rationale">
                  {activePred.rationale}
                </p>
              </Card>

              {/* Modality Contribution Card */}
              <Card title="Modality Evidence Weight" icon={Stethoscope} id="card-modality">
                <div className="space-y-3">
                  {Object.entries(activePred.modality_contrib).map(([k, v]) => (
                    <div key={k}>
                      <div className="flex justify-between text-xs mb-1 capitalize">
                        <span className="font-medium text-white/80">{k}</span>
                        <span className="font-mono text-white/50">{(v * 100).toFixed(0)}%</span>
                      </div>
                      <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                        <motion.div
                          className="h-full rounded-full"
                          style={{ background: MOD_COLOR[k] }}
                          initial={{ width: 0 }}
                          animate={{ width: `${v * 100}%` }}
                          transition={{ duration: 0.8 }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-[10.5px] text-[var(--muted)] mt-3">
                  Proportionate share of evidence contributed to the fused logit.
                </p>
              </Card>

              {/* What-If Counterfactual Simulator Card */}
              <Card title="Interactive What-If Simulator" icon={SlidersHorizontal} id="card-whatif">
                <WhatIf req={sel.request} onSimulate={setSim} resetKey={resetKey} />
              </Card>
            </div>

            {/* -----------------------------------------------------------------------
                3. LOWER MULTIMODAL EVIDENCE ROW (lg:col-span-12):
                   ECG Viewer (1/3) + SHAP Explainability (1/3) + Interactive Clinical Notes (1/3)
                ----------------------------------------------------------------------- */}
            <div className="lg:col-span-12 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 items-stretch">
              {/* Panel 1: ECG Waveform & Lead Corroboration */}
              <Card title="12-Lead ECG Analysis & Waveform" icon={Activity} id="card-ecg">
                {sel.request.ecg?.signal?.length ? (
                  <EcgViewer signal={sel.request.ecg.signal} fs={sel.request.ecg.sampling_rate} findings={activePred.ecg_findings} />
                ) : (
                  <p className="text-sm text-[var(--muted)]">No ECG waveform recording for this patient.</p>
                )}
              </Card>

              {/* Panel 2: Multi-Target SHAP Attributions */}
              <Card title="Explainability · Multi-Target SHAP" icon={Sparkles} id="card-shap">
                <ShapChart shap={activePred.shap} />
              </Card>

              {/* Panel 3: Interactive Clinical Notes NLP & Live Extractor */}
              <Card title="Clinical Notes NLP & Live Extractor" icon={FileText} id="card-notes">
                <div className="space-y-3 flex-1 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between text-xs text-[var(--muted)] mb-1.5">
                      <span>Interactive Clinical Narrative</span>
                      {editedNotes !== sel.request.notes && (
                        <button
                          type="button"
                          onClick={handleResetNotes}
                          className="text-[10px] text-cyan-300 hover:underline flex items-center gap-1 cursor-pointer"
                        >
                          <RotateCcw size={10} /> Reset Note
                        </button>
                      )}
                    </div>
                    <textarea
                      value={editedNotes}
                      onChange={(e) => setEditedNotes(e.target.value)}
                      placeholder="Type or modify clinical narrative (e.g. mention LAD, RCA, chest discomfort, smoker, metformin)..."
                      rows={3}
                      className="w-full rounded-xl bg-white/[0.04] border border-white/10 p-2.5 text-xs text-white placeholder-white/30 focus:outline-none focus:border-[var(--accent)] font-sans resize-y leading-relaxed transition-all"
                    />

                    <div className="mt-2 flex items-center justify-between">
                      <button
                        type="button"
                        id="reanalyze-notes-btn"
                        onClick={handleReanalyzeNotes}
                        disabled={noteAnalyzing || !editedNotes.trim()}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--accent)] hover:opacity-90 disabled:opacity-40 text-xs font-semibold text-white transition-all shadow-md active:scale-95 cursor-pointer"
                      >
                        {noteAnalyzing ? (
                          <>
                            <Loader2 size={13} className="animate-spin" /> Analyzing &amp; Fusing…
                          </>
                        ) : noteSuccess ? (
                          <>
                            <CheckCircle2 size={13} className="text-emerald-300" /> Note Fused!
                          </>
                        ) : (
                          <>
                            <Send size={13} /> Re-Analyze Note &amp; Fuse
                          </>
                        )}
                      </button>
                      <span className="text-[10px] text-white/40">Real-time NLP territorial extraction</span>
                    </div>
                  </div>

                  {/* Extracted Structured Entities Display */}
                  <div className="pt-2 border-t border-white/[0.06] space-y-2">
                    <div className="text-[10.5px] uppercase font-bold tracking-wider text-[var(--muted)]">
                      Extracted Clinical Entities
                    </div>
                    <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto no-scrollbar">
                      {activePred.notes_entities?.risk_flags?.map((t) => (
                        <span key={t} className="px-2 py-0.5 rounded-full text-[10px] bg-rose-500/15 text-rose-300 border border-rose-400/30">
                          {t}
                        </span>
                      ))}
                      {activePred.notes_entities?.symptoms?.map((t) => (
                        <span key={t} className="px-2 py-0.5 rounded-full text-[10px] bg-cyan-400/15 text-cyan-300 border border-cyan-400/30">
                          {t}
                        </span>
                      ))}
                      {activePred.notes_entities?.medications?.map((t) => (
                        <span key={t} className="px-2 py-0.5 rounded-full text-[10px] bg-violet-400/15 text-violet-300 border border-violet-400/30">
                          {t}
                        </span>
                      ))}
                      {activePred.notes_entities?.territories?.map((t) => (
                        <span key={t} className="px-2 py-0.5 rounded-full text-[10px] bg-amber-400/15 text-amber-300 border border-amber-400/30 font-mono">
                          Territory: {t}
                        </span>
                      ))}
                      {(!activePred.notes_entities?.risk_flags?.length &&
                        !activePred.notes_entities?.symptoms?.length &&
                        !activePred.notes_entities?.medications?.length) && (
                        <span className="text-[11px] text-white/40 italic">No positive pathological entities flagged.</span>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <footer className="text-center text-xs text-[var(--muted)] mt-8 pb-4">
        CardioFusion · Multimodal AI Hackathon 2026 Prototype · Decision-support only, not a medical device.
      </footer>
    </main>
  );
}
