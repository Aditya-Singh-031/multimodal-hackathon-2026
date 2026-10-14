"use client";
import { motion } from "framer-motion";
import type { Features, Shap } from "@/lib/types";

interface ShapChartProps {
  shap: Shap[];
  features?: Features;
}

interface FormattedFeature {
  label: string;
  badge: string;
  isAbnormal?: boolean;
}

function formatMeasurement(featureName: string, value: number, f?: Features): FormattedFeature {
  const norm = featureName.toLowerCase();

  if (norm.includes("systolic") || norm === "systolic_bp") {
    const v = f?.systolic_bp ?? Math.round(value);
    return { label: "Systolic BP", badge: `${v} mmHg`, isAbnormal: v >= 140 };
  }
  if (norm.includes("cholesterol")) {
    const v = f?.cholesterol ?? Math.round(value);
    return { label: "Cholesterol", badge: `${v} mg/dL`, isAbnormal: v >= 200 };
  }
  if (norm.includes("resting hr") || norm.includes("resting_hr") || norm.includes("heart rate")) {
    const v = f?.resting_hr ?? Math.round(value);
    return { label: "Resting HR", badge: `${v} BPM`, isAbnormal: v > 80 };
  }
  if (norm.includes("bmi")) {
    const v = f?.bmi ?? +value.toFixed(1);
    return { label: "BMI", badge: `${v} kg/m²`, isAbnormal: v >= 25 };
  }
  if (norm === "age") {
    const v = f?.age ?? Math.round(value);
    return { label: "Age", badge: `${v} yrs`, isAbnormal: v >= 60 };
  }
  if (norm.includes("rwma") || norm.includes("wall motion")) {
    const v = f?.rwma !== undefined ? f.rwma : Math.round(value);
    return {
      label: "RWMA (Echo)",
      badge: v === 0 ? "Grade 0 (Normal)" : `Grade ${v}/4`,
      isAbnormal: v > 0,
    };
  }
  if (norm.includes("st elevation") || norm.includes("st_elevation")) {
    const v = f?.st_elevation !== undefined ? f.st_elevation : Boolean(value);
    return {
      label: "ST Elevation",
      badge: v ? "Present (Ischemic)" : "Absent",
      isAbnormal: v,
    };
  }
  if (norm.includes("t-wave") || norm.includes("t_inversion") || norm.includes("t wave")) {
    const v = f?.t_inversion !== undefined ? f.t_inversion : Boolean(value);
    return {
      label: "T-Wave Inversion",
      badge: v ? "Present (Ischemic)" : "Absent",
      isAbnormal: v,
    };
  }
  if (norm === "lvh" || norm.includes("hypertrophy")) {
    const v = f?.lvh !== undefined ? f.lvh : Boolean(value);
    return {
      label: "LVH (Estes ECG)",
      badge: v ? "Present" : "Absent",
      isAbnormal: v,
    };
  }
  if (norm.includes("enzymes") || norm.includes("cardiac_enzymes") || norm.includes("troponin")) {
    const v = f?.cardiac_enzymes_elevated !== undefined ? f.cardiac_enzymes_elevated : Boolean(value);
    return {
      label: "Cardiac Enzymes",
      badge: v ? "Elevated (Troponin+)" : "Normal",
      isAbnormal: v,
    };
  }
  if (norm.includes("smoking") || norm.includes("smoker")) {
    const v = f?.smoker !== undefined ? f.smoker : Boolean(value);
    return {
      label: "Smoking Status",
      badge: v ? "Active Smoker" : "Non-Smoker",
      isAbnormal: v,
    };
  }
  if (norm.includes("diabet")) {
    const v = f?.diabetic !== undefined ? f.diabetic : Boolean(value);
    return {
      label: "Diabetes",
      badge: v ? "Type 2 Diabetic" : "Non-Diabetic",
      isAbnormal: v,
    };
  }
  if (norm.includes("chest pain") || norm.includes("chest_pain")) {
    const v = f?.chest_pain_type !== undefined ? f.chest_pain_type : Math.round(value);
    const names = ["None (0)", "Atypical (1)", "Non-Anginal (2)", "Typical Angina (3)"];
    return {
      label: "Chest Pain Type",
      badge: names[v] || `Grade ${v}`,
      isAbnormal: v >= 2,
    };
  }
  if (norm.includes("exercise angina") || norm.includes("exercise_angina")) {
    const v = f?.exercise_angina !== undefined ? f.exercise_angina : Boolean(value);
    return {
      label: "Exertional Angina",
      badge: v ? "Present" : "Absent",
      isAbnormal: v,
    };
  }
  if (norm.includes("sex") || norm === "sex_m") {
    const isM = f?.sex ? f.sex === "M" : Boolean(value);
    return {
      label: "Biological Sex",
      badge: isM ? "Male" : "Female",
    };
  }

  return {
    label: featureName,
    badge: String(value),
  };
}

export default function ShapChart({ shap, features }: ShapChartProps) {
  const top = shap.slice(0, 8);
  const max = Math.max(...top.map((s) => Math.abs(s.contribution)), 0.01);
  const totalAbs = top.reduce((sum, s) => sum + Math.abs(s.contribution), 0);

  return (
    <div className="space-y-2.5" id="shap-chart">
      {top.map((s, i) => {
        const w = (Math.abs(s.contribution) / max) * 48;
        const up = s.contribution > 0;
        const relPct = totalAbs > 0 ? ((Math.abs(s.contribution) / totalAbs) * 100).toFixed(1) : "0.0";
        const meta = formatMeasurement(s.feature, s.value, features);

        return (
          <div key={s.feature} className="p-2 rounded-xl bg-white/[0.03] border border-white/5 hover:border-white/10 transition-colors">
            {/* Top row: Label, Measurement badge, relative %, and signed log-odds */}
            <div className="flex items-center justify-between gap-2 mb-1.5 text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-semibold text-slate-200 truncate">{meta.label}</span>
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] font-mono border shrink-0 ${
                    meta.isAbnormal
                      ? "bg-rose-500/15 border-rose-400/30 text-rose-300 font-semibold"
                      : "bg-slate-800/80 border-slate-700/60 text-slate-300"
                  }`}
                >
                  {meta.badge}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0 font-mono text-[11px]">
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-slate-400 font-medium">
                  {relPct}% contrib
                </span>
                <span className={`w-12 text-right font-bold ${up ? "text-rose-300" : "text-emerald-300"}`}>
                  {up ? "+" : ""}
                  {s.contribution.toFixed(2)}
                </span>
              </div>
            </div>

            {/* Middle row: Bidirectional Diverging Bar Chart */}
            <div className="relative h-2 w-full bg-slate-900/80 rounded-full overflow-hidden border border-white/10">
              <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-white/30 z-10" />
              <motion.div
                className="absolute top-0 bottom-0 rounded-full"
                style={{
                  [up ? "left" : "right"]: "50%",
                  background: up
                    ? "linear-gradient(90deg, #fb923c, #f43f5e)"
                    : "linear-gradient(90deg, #22d3ee, #10b981)",
                }}
                initial={{ width: 0 }}
                animate={{ width: `${w}%` }}
                transition={{ delay: i * 0.04, duration: 0.55 }}
              />
            </div>
          </div>
        );
      })}

      <div className="flex items-center justify-between text-[11px] text-[var(--muted)] pt-1 px-1">
        <span>← Lowers CAD risk (Protective)</span>
        <span className="font-mono text-[10px] text-slate-500">Center = 0.0 (Log-Odds Baseline)</span>
        <span>Raises CAD risk (Atherogenic) →</span>
      </div>
    </div>
  );
}
