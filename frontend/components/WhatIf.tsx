"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Loader2 } from "lucide-react";
import { simulate } from "@/lib/api";
import type { PredictRequest, Simulation } from "@/lib/types";

type Ov = Record<string, number | boolean>;

export default function WhatIf({ req }: { req: PredictRequest }) {
  const f = req.features;
  const [ov, setOv] = useState<Ov>({});
  const [res, setRes] = useState<Simulation | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => { setOv({}); setRes(null); }, [req.patient_id]);
  useEffect(() => {
    clearTimeout(timer.current);
    if (!Object.keys(ov).length) { setRes(null); return; }
    setBusy(true);
    timer.current = setTimeout(async () => {
      const { data } = await simulate(req, ov);
      setRes(data); setBusy(false);
    }, 350);
    return () => clearTimeout(timer.current);
  }, [ov, req]);

  const val = <K extends keyof typeof f>(k: K) => (k in ov ? ov[k as string] : f[k]) as number;
  const sliders: [string, string, number, number, number][] = [
    ["systolic_bp", "Systolic BP (mmHg)", 90, 200, 1], ["cholesterol", "Cholesterol (mg/dL)", 120, 320, 1],
    ["bmi", "BMI", 17, 45, 0.5],
  ];
  const d = res?.delta_risk ?? 0;
  return (
    <div id="what-if" className="space-y-4">
      {sliders.map(([k, label, min, max, step]) => (
        <label key={k} className="block text-sm">
          <div className="flex justify-between text-[var(--muted)]"><span>{label}</span><span className="text-white font-mono">{val(k as keyof typeof f)}</span></div>
          <input type="range" className="w-full" min={min} max={max} step={step} value={val(k as keyof typeof f)}
            onChange={(e) => setOv((o) => ({ ...o, [k]: +e.target.value }))} />
        </label>
      ))}
      <div className="flex gap-2">
        {([["smoker", "Smoker"], ["diabetic", "Diabetic"]] as const).map(([k, l]) => {
          const on = k in ov ? (ov[k] as boolean) : f[k];
          return (
            <button key={k} onClick={() => setOv((o) => ({ ...o, [k]: !on }))}
              className={`flex-1 rounded-lg px-3 py-2 text-sm border transition ${on ? "bg-rose-500/20 border-rose-400/50 text-rose-200" : "bg-white/5 border-white/10 text-[var(--muted)]"}`}>
              {l}: {on ? "Yes" : "No"}
            </button>
          );
        })}
      </div>
      <div className="rounded-xl bg-white/5 p-3 flex items-center justify-between min-h-[64px]">
        {!res && !busy && <span className="text-sm text-[var(--muted)]">Adjust a factor to simulate the effect on risk.</span>}
        {busy && <span className="flex items-center gap-2 text-sm text-[var(--muted)]"><Loader2 className="animate-spin" size={16} /> Simulating…</span>}
        {res && !busy && (
          <>
            <div className="text-sm"><div className="text-[var(--muted)]">New risk</div>
              <div className="text-2xl font-bold">{(res.modified.risk * 100).toFixed(1)}%</div></div>
            <div className={`flex items-center gap-1 text-lg font-semibold ${d < 0 ? "text-emerald-300" : "text-rose-300"}`}>
              {d < 0 ? <ArrowDown size={18} /> : <ArrowUp size={18} />}{Math.abs(d * 100).toFixed(1)} pts
            </div>
          </>
        )}
      </div>
      {Object.keys(ov).length > 0 && <button onClick={() => setOv({})} className="text-xs text-[var(--accent2)] hover:underline">Reset to patient values</button>}
    </div>
  );
}
