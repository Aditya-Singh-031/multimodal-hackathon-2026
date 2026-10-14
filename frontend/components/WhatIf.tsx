"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Loader2, RotateCcw } from "lucide-react";
import { simulate } from "@/lib/api";
import type { PredictRequest, Simulation } from "@/lib/types";

type Ov = Record<string, number | boolean>;

export interface WhatIfProps {
  req: PredictRequest;
  onSimulate?: (sim: Simulation | null) => void;
  resetKey?: number;
}

const RWMA_LABELS = ["0 - Normal", "1 - Mild Hypo", "2 - Moderate", "3 - Akinesia", "4 - Dyskinetic"];

export default function WhatIf({ req, onSimulate, resetKey }: WhatIfProps) {
  const f = req.features;
  const [ov, setOv] = useState<Ov>({});
  const [res, setRes] = useState<Simulation | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    setOv({});
    setRes(null);
    onSimulate?.(null);
  }, [req.patient_id, resetKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    clearTimeout(timer.current);
    if (!Object.keys(ov).length) {
      setRes(null);
      onSimulate?.(null);
      return;
    }
    setBusy(true);
    timer.current = setTimeout(async () => {
      const { data } = await simulate(req, ov);
      setRes(data);
      setBusy(false);
      onSimulate?.(data);
    }, 320);
    return () => clearTimeout(timer.current);
  }, [ov, req]); // eslint-disable-line react-hooks/exhaustive-deps

  const numVal = <K extends keyof typeof f>(k: K) => (k in ov ? (ov[k as string] as number) : (f[k] as number ?? 0));
  const boolVal = <K extends keyof typeof f>(k: K) => (k in ov ? Boolean(ov[k as string]) : Boolean(f[k]));

  const handleReset = () => {
    setOv({});
    setRes(null);
    onSimulate?.(null);
  };

  const sliders: [string, string, number, number, number][] = [
    ["systolic_bp", "Systolic BP (mmHg)", 90, 200, 1],
    ["cholesterol", "Cholesterol (mg/dL)", 120, 320, 1],
  ];

  const toggles: [string, string, string][] = [
    ["smoker", "Smoker", "Smoking status"],
    ["diabetic", "Diabetic", "Diabetes status"],
    ["st_elevation", "ST Elevation", "ECG ST elevation"],
    ["t_inversion", "T Inversion", "ECG T-wave inversion"],
    ["lvh", "LVH", "Left ventricular hypertrophy"],
    ["cardiac_enzymes_elevated", "Enzymes", "Troponin / CK-MB elevation"],
  ];

  const d = res?.delta_risk ?? 0;
  const hasOverrides = Object.keys(ov).length > 0;

  return (
    <div id="what-if" className="space-y-4">
      {/* Sliders */}
      {sliders.map(([k, label, min, max, step]) => (
        <label key={k} className="block text-sm">
          <div className="flex justify-between text-[var(--muted)] mb-1">
            <span>{label}</span>
            <span className={`font-mono font-semibold ${k in ov ? "text-amber-300" : "text-white"}`}>
              {numVal(k as keyof typeof f)}
              {k in ov && <span className="ml-1 text-[10px] text-amber-400 font-sans">modified</span>}
            </span>
          </div>
          <input
            type="range"
            className="w-full accent-[var(--accent)] cursor-pointer"
            min={min}
            max={max}
            step={step}
            value={numVal(k as keyof typeof f)}
            onChange={(e) => setOv((o) => ({ ...o, [k]: +e.target.value }))}
          />
        </label>
      ))}

      {/* Regional Wall Motion Abnormality (RWMA) Echo Score Slider */}
      <div className="block text-sm">
        <div className="flex justify-between text-[var(--muted)] mb-1">
          <span>RWMA Echo Score</span>
          <span className={`font-mono font-semibold ${"rwma" in ov ? "text-amber-300" : "text-white"}`}>
            {RWMA_LABELS[numVal("rwma")] ?? numVal("rwma")}
            {"rwma" in ov && <span className="ml-1 text-[10px] text-amber-400 font-sans">modified</span>}
          </span>
        </div>
        <input
          type="range"
          className="w-full accent-[var(--accent)] cursor-pointer"
          min={0}
          max={4}
          step={1}
          value={numVal("rwma")}
          onChange={(e) => setOv((o) => ({ ...o, rwma: +e.target.value }))}
        />
        <div className="flex justify-between text-[9px] text-white/35 mt-0.5 font-mono">
          <span>0 Normal</span>
          <span>1 Mild</span>
          <span>2 Mod</span>
          <span>3 Akinetic</span>
          <span>4 Dyskinetic</span>
        </div>
      </div>

      {/* Clinical & ECG Toggles Grid */}
      <div className="pt-1">
        <div className="text-[11px] font-semibold text-[var(--muted)] uppercase tracking-wider mb-2">
          Clinical & Diagnostic Flags
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {toggles.map(([k, label, title]) => {
            const on = boolVal(k as keyof typeof f);
            const isOverridden = k in ov;
            return (
              <button
                key={k}
                type="button"
                id={`whatif-toggle-${k}`}
                title={title}
                onClick={() => setOv((o) => ({ ...o, [k]: !on }))}
                className={`relative rounded-lg px-2.5 py-2 text-xs font-medium border text-left transition-all ${
                  on
                    ? "bg-rose-500/20 border-rose-400/50 text-rose-200 shadow-[0_0_10px_rgba(244,63,94,0.15)]"
                    : "bg-white/5 border-white/10 text-white/60 hover:text-white hover:bg-white/10"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="truncate">{label}</span>
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      on ? "bg-rose-400 animate-pulse" : "bg-white/20"
                    }`}
                  />
                </div>
                <div className="text-[10px] font-mono mt-0.5 opacity-80">
                  {on ? "Positive" : "None"}
                  {isOverridden && <span className="ml-1 text-amber-400 font-sans">★</span>}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Simulation Result Banner */}
      <div className="rounded-xl bg-white/5 border border-white/10 p-3 flex items-center justify-between min-h-[68px]">
        {!res && !busy && (
          <span className="text-xs text-[var(--muted)] leading-relaxed">
            Adjust clinical factors, ECG findings, or Echo RWMA above to live-simulate altered risk and vessel stenosis.
          </span>
        )}
        {busy && (
          <span className="flex items-center gap-2 text-xs text-[var(--accent2)]">
            <Loader2 className="animate-spin" size={15} /> Simulating multimodal hemodynamics…
          </span>
        )}
        {res && !busy && (
          <>
            <div className="text-xs">
              <div className="text-[var(--muted)]">Projected Risk</div>
              <div className="text-2xl font-bold font-mono text-white">
                {(res.modified.risk * 100).toFixed(1)}%
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] text-[var(--muted)]">Risk Delta</div>
              <div
                className={`flex items-center justify-end gap-0.5 text-base font-bold font-mono ${
                  d < 0 ? "text-emerald-300" : d > 0 ? "text-rose-300" : "text-white/60"
                }`}
              >
                {d < 0 ? <ArrowDown size={16} /> : d > 0 ? <ArrowUp size={16} /> : null}
                {Math.abs(d * 100).toFixed(1)} pts
              </div>
            </div>
          </>
        )}
      </div>

      {hasOverrides && (
        <button
          type="button"
          onClick={handleReset}
          className="flex items-center gap-1.5 text-xs text-[var(--accent2)] hover:text-white transition-colors"
        >
          <RotateCcw size={12} /> Reset to patient baseline
        </button>
      )}
    </div>
  );
}
