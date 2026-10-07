"use client";
import { motion } from "framer-motion";
import { TIER_COLOR, TIER_LABEL, type Tier } from "@/lib/types";

export default function RiskGauge({ risk, tier, confidence }: { risk: number; tier: Tier; confidence: number }) {
  const R = 84, C = Math.PI * R; // half circle
  const color = TIER_COLOR[tier];
  return (
    <div className="flex flex-col items-center" id="risk-gauge">
      <svg viewBox="0 0 200 120" className="w-full max-w-[280px]">
        <defs>
          <filter id="glow"><feGaussianBlur stdDeviation="4" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        </defs>
        <path d="M16 100 A84 84 0 0 1 184 100" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="14" strokeLinecap="round" />
        <motion.path d="M16 100 A84 84 0 0 1 184 100" fill="none" stroke={color} strokeWidth="14" strokeLinecap="round"
          filter="url(#glow)" strokeDasharray={C} initial={{ strokeDashoffset: C }}
          animate={{ strokeDashoffset: C * (1 - Math.min(risk / 0.6, 1)) }} transition={{ duration: 1.1, ease: "easeOut" }} />
        <text x="100" y="86" textAnchor="middle" fontSize="38" fontWeight="700" fill="white">{(risk * 100).toFixed(0)}%</text>
        <text x="100" y="106" textAnchor="middle" fontSize="11" fill="#8b95b0">10-year event risk</text>
      </svg>
      <span className="px-3 py-1 rounded-full text-sm font-semibold -mt-1" style={{ background: `${color}22`, color, border: `1px solid ${color}55` }}>
        {TIER_LABEL[tier]} risk
      </span>
      <p className="text-xs text-[var(--muted)] mt-2">Model confidence {(confidence * 100).toFixed(0)}%</p>
    </div>
  );
}
