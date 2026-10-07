"use client";
import { useEffect, useMemo, useState } from "react";
import type { EcgFindings } from "@/lib/types";

export default function EcgViewer({ signal, fs, findings }: { signal: number[]; fs: number; findings?: EcgFindings | null }) {
  const W = 900, H = 180;
  const [sweep, setSweep] = useState(0);
  useEffect(() => {
    let raf = 0, t0 = performance.now();
    const loop = (t: number) => { setSweep(((t - t0) / 4000) % 1); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [signal]);

  const { path, lo, hi } = useMemo(() => {
    const mn = Math.min(...signal), mx = Math.max(...signal), rng = mx - mn || 1;
    const pts = signal.map((v, i) => `${((i / (signal.length - 1)) * W).toFixed(1)},${(H - 16 - ((v - mn) / rng) * (H - 32)).toFixed(1)}`);
    return { path: pts.join(" "), lo: mn, hi: mx };
  }, [signal]);

  const peaks = findings?.r_peaks ?? [];
  const peakY = (i: number) => H - 16 - ((signal[i] - lo) / (hi - lo || 1)) * (H - 32);
  const stColor = (findings?.st_deviation_mv ?? 0) < -0.08;
  return (
    <div id="ecg-viewer">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-xl bg-black/30" role="img" aria-label="ECG waveform">
        {Array.from({ length: 18 }).map((_, i) => <line key={i} x1={(i * W) / 17} x2={(i * W) / 17} y1="0" y2={H} stroke="rgba(244,63,94,0.07)" />)}
        {Array.from({ length: 5 }).map((_, i) => <line key={i} y1={(i * H) / 4} y2={(i * H) / 4} x1="0" x2={W} stroke="rgba(244,63,94,0.07)" />)}
        <polyline points={path} fill="none" stroke="#34d399" strokeWidth="1.8" strokeLinejoin="round" style={{ filter: "drop-shadow(0 0 4px #34d399aa)" }} />
        {peaks.map((p) => <circle key={p} cx={(p / (signal.length - 1)) * W} cy={peakY(p) - 6} r="3.5" fill="#f43f5e" />)}
        {stColor && peaks.map((p) => (
          <rect key={`s${p}`} x={((p + 0.08 * fs) / (signal.length - 1)) * W} width={(0.06 * fs / (signal.length - 1)) * W} y="0" height={H} fill="rgba(251,146,60,0.18)" />
        ))}
        <rect x={sweep * W} width="60" y="0" height={H} fill="url(#sw)" opacity="0.5" />
        <defs><linearGradient id="sw"><stop offset="0" stopColor="transparent" /><stop offset="1" stopColor="rgba(34,211,238,0.35)" /></linearGradient></defs>
      </svg>
      {findings && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3 text-sm">
          {[["Heart rate", `${findings.heart_rate} bpm`], ["HRV (RMSSD)", `${findings.hrv_rmssd} ms`],
            ["QRS", `${findings.qrs_ms} ms`], ["ST deviation", `${findings.st_deviation_mv} mV`]].map(([k, v]) => (
            <div key={k} className="rounded-lg bg-white/5 px-3 py-2"><div className="text-[11px] text-[var(--muted)]">{k}</div><div className="font-semibold">{v}</div></div>
          ))}
        </div>
      )}
      {findings && findings.flags.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-3">{findings.flags.map((f) => <span key={f} className="px-2.5 py-1 rounded-full text-xs bg-orange-400/15 text-orange-300 border border-orange-400/30">⚠ {f}</span>)}</div>
      )}
    </div>
  );
}
