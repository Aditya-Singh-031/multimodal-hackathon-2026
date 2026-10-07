"use client";
import { motion } from "framer-motion";
import type { Shap } from "@/lib/types";

export default function ShapChart({ shap }: { shap: Shap[] }) {
  const top = shap.slice(0, 8);
  const max = Math.max(...top.map((s) => Math.abs(s.contribution)), 0.01);
  return (
    <div className="space-y-2" id="shap-chart">
      {top.map((s, i) => {
        const w = (Math.abs(s.contribution) / max) * 50;
        const up = s.contribution > 0;
        return (
          <div key={s.feature} className="flex items-center gap-3 text-sm">
            <span className="w-32 shrink-0 text-[var(--muted)] truncate">{s.feature}</span>
            <div className="relative flex-1 h-5">
              <div className="absolute left-1/2 top-0 bottom-0 w-px bg-white/15" />
              <motion.div className="absolute top-0.5 bottom-0.5 rounded"
                style={{ [up ? "left" : "right"]: "50%", background: up ? "linear-gradient(90deg,#fb923c,#f43f5e)" : "linear-gradient(90deg,#22d3ee,#34d399)" }}
                initial={{ width: 0 }} animate={{ width: `${w}%` }} transition={{ delay: i * 0.05, duration: 0.6 }} />
            </div>
            <span className={`w-14 text-right font-mono text-xs ${up ? "text-rose-300" : "text-emerald-300"}`}>
              {up ? "+" : ""}{s.contribution.toFixed(2)}
            </span>
          </div>
        );
      })}
      <p className="text-[11px] text-[var(--muted)] pt-1">SHAP log-odds contribution · right = raises risk, left = lowers risk</p>
    </div>
  );
}
