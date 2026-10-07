"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { Activity, AlertTriangle, FileText, HeartPulse, RefreshCw, Sparkles, SlidersHorizontal, Stethoscope, WifiOff } from "lucide-react";
import { getPatients, predict } from "@/lib/api";
import { TIER_COLOR, type Patient, type Prediction } from "@/lib/types";
import RiskGauge from "@/components/RiskGauge";
import ShapChart from "@/components/ShapChart";
import EcgViewer from "@/components/EcgViewer";
import WhatIf from "@/components/WhatIf";

const Heart3D = dynamic(() => import("@/components/Heart3D"), {
  ssr: false, loading: () => <div className="skeleton h-[280px]" />,
});

function Card({ title, icon: Icon, children, className = "", id }: { title: string; icon: LucideIcon; children: React.ReactNode; className?: string; id?: string }) {
  return (
    <motion.section id={id} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }}
      className={`glass glass-hover p-5 ${className}`}>
      <h2 className="flex items-center gap-2 text-sm font-semibold tracking-wide uppercase text-[var(--muted)] mb-4">
        <Icon size={16} className="text-[var(--accent2)]" /> {title}
      </h2>
      {children}
    </motion.section>
  );
}

const MOD_COLOR: Record<string, string> = { clinical: "#7c5cff", ecg: "#22d3ee", notes: "#fbbf24" };

export default function Home() {
  const [patients, setPatients] = useState<Patient[] | null>(null);
  const [sel, setSel] = useState<Patient | null>(null);
  const [pred, setPred] = useState<Prediction | null>(null);
  const [offline, setOffline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (p: Patient) => {
    setSel(p); setLoading(true); setError(null);
    try {
      const { data, offline: off } = await predict(p.request);
      setPred(data); setOffline((o) => o || off);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Prediction failed");
    } finally { setLoading(false); }
  }, []);

  const boot = useCallback(async () => {
    setLoading(true); setError(null);
    const { data, offline: off } = await getPatients();
    setPatients(data); setOffline(off);
    if (data.length) await run(data[data.length - 1]); else setLoading(false);
  }, [run]);

  useEffect(() => { boot(); }, [boot]);

  const color = pred ? TIER_COLOR[pred.tier] : "#7c5cff";
  const f = sel?.request.features;

  return (
    <main className="max-w-7xl mx-auto w-full px-4 md:px-8 py-8">
      <header className="flex flex-wrap items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold flex items-center gap-3">
            <span className="pulse-ring inline-flex p-2 rounded-xl bg-[var(--accent)]/20"><HeartPulse className="text-[var(--accent)]" /></span>
            <span className="gradient-text">CardioFusion</span>
          </h1>
          <p className="text-[var(--muted)] mt-1">Multimodal cardiovascular risk · clinical data × ECG × notes</p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {offline ? (
            <span id="mode-badge" className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-400/15 text-amber-300 border border-amber-400/30"><WifiOff size={13} /> Offline demo model</span>
          ) : (
            <span id="mode-badge" className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-400/15 text-emerald-300 border border-emerald-400/30"><Sparkles size={13} /> Live backend{pred?.source === "mock" ? " · rule-based notes" : ""}</span>
          )}
        </div>
      </header>

      <nav aria-label="Patients" className="flex gap-3 overflow-x-auto pb-3 mb-6">
        {patients === null && Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-16 w-44 shrink-0" />)}
        {patients?.map((p) => {
          const active = sel?.id === p.id;
          return (
            <button key={p.id} id={`patient-${p.id}`} onClick={() => run(p)}
              className={`glass shrink-0 text-left px-4 py-3 w-48 transition ${active ? "!border-[var(--accent)] ring-1 ring-[var(--accent)]/60" : "opacity-80 hover:opacity-100"}`}>
              <div className="font-semibold truncate">{p.name}</div>
              <div className="text-xs text-[var(--muted)]">{p.request.features.age}y · {p.request.features.sex} · {p.id}</div>
            </button>
          );
        })}
        {patients?.length === 0 && <div className="glass px-5 py-4 text-sm text-[var(--muted)]">No patients found. <button onClick={boot} className="text-[var(--accent2)] underline">Load demo patients</button></div>}
      </nav>

      {error && (
        <div role="alert" className="glass border-rose-500/40 p-4 mb-6 flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-rose-300"><AlertTriangle size={18} /> {error}</span>
          <button onClick={() => sel && run(sel)} className="flex items-center gap-1 text-sm px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20"><RefreshCw size={14} /> Retry</button>
        </div>
      )}

      {loading && !pred && (
        <div className="grid md:grid-cols-3 gap-5">{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="skeleton h-64" />)}</div>
      )}

      <AnimatePresence mode="wait">
        {pred && sel && f && (
          <motion.div key={sel.id} initial={{ opacity: 0 }} animate={{ opacity: loading ? 0.5 : 1 }} exit={{ opacity: 0 }}
            className="grid grid-cols-1 lg:grid-cols-3 gap-5 transition-opacity">
            <Card title="Risk assessment" icon={Activity} id="card-risk">
              <RiskGauge risk={pred.risk} tier={pred.tier} confidence={pred.confidence} />
              <p className="text-sm text-[var(--muted)] mt-4 leading-relaxed" id="rationale">{pred.rationale}</p>
            </Card>

            <Card title="3D cardiac model" icon={HeartPulse} id="card-heart">
              <Heart3D color={color} bpm={pred.ecg_findings?.heart_rate ?? f.resting_hr} risk={pred.risk} vessels={sel.vessels} />
              <div className="grid grid-cols-3 gap-2 mt-3 text-center text-xs">
                {[["BP", `${f.systolic_bp}`], ["Chol", `${f.cholesterol}`], ["BMI", `${f.bmi}`]].map(([k, v]) => (
                  <div key={k} className="rounded-lg bg-white/5 py-2"><div className="text-[var(--muted)]">{k}</div><div className="font-semibold text-sm">{v}</div></div>
                ))}
              </div>
            </Card>

            <Card title="Modality contribution" icon={Stethoscope} id="card-modality">
              <div className="space-y-3">
                {Object.entries(pred.modality_contrib).map(([k, v]) => (
                  <div key={k}>
                    <div className="flex justify-between text-sm mb-1 capitalize"><span>{k}</span><span className="font-mono text-[var(--muted)]">{(v * 100).toFixed(0)}%</span></div>
                    <div className="h-2.5 rounded-full bg-white/8 overflow-hidden">
                      <motion.div className="h-full rounded-full" style={{ background: MOD_COLOR[k] }} initial={{ width: 0 }} animate={{ width: `${v * 100}%` }} transition={{ duration: 0.8 }} />
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-[var(--muted)] mt-4">Share of evidence each modality adds to the fused logit.</p>
              <div className="mt-4 text-xs text-[var(--muted)]">{!pred.ecg_findings && "No usable ECG supplied. "}{!pred.notes_entities && "No notes supplied."}</div>
            </Card>

            <Card title="Explainability · SHAP" icon={Sparkles} className="lg:col-span-2" id="card-shap">
              <ShapChart shap={pred.shap} />
            </Card>

            <Card title="What-if simulator" icon={SlidersHorizontal} id="card-whatif">
              <WhatIf req={sel.request} />
            </Card>

            <Card title="ECG analysis" icon={Activity} className="lg:col-span-2" id="card-ecg">
              {sel.request.ecg?.signal?.length ? (
                <EcgViewer signal={sel.request.ecg.signal} fs={sel.request.ecg.sampling_rate} findings={pred.ecg_findings} />
              ) : <p className="text-sm text-[var(--muted)]">No ECG recording for this patient.</p>}
            </Card>

            <Card title="Clinical notes (NLP)" icon={FileText} id="card-notes">
              {sel.request.notes ? (
                <>
                  <p className="text-sm italic text-[var(--muted)] border-l-2 border-[var(--accent)] pl-3 mb-3">{sel.request.notes}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {pred.notes_entities?.risk_flags.map((t) => <span key={t} className="px-2 py-0.5 rounded-full text-xs bg-rose-500/15 text-rose-300 border border-rose-400/30">{t}</span>)}
                    {pred.notes_entities?.symptoms.map((t) => <span key={t} className="px-2 py-0.5 rounded-full text-xs bg-cyan-400/15 text-cyan-300 border border-cyan-400/30">{t}</span>)}
                    {pred.notes_entities?.medications.map((t) => <span key={t} className="px-2 py-0.5 rounded-full text-xs bg-violet-400/15 text-violet-300 border border-violet-400/30">{t}</span>)}
                  </div>
                </>
              ) : <p className="text-sm text-[var(--muted)]">No clinical notes for this patient.</p>}
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      <footer className="text-center text-xs text-[var(--muted)] mt-10">
        Decision-support prototype built on synthetic and public data. Not a medical device.
      </footer>
    </main>
  );
}
