"""ECG feature extraction (scipy-only for robustness) + heuristic abnormality score + coronary-territory localisation.

Single-lead input yields global features only. When a multi-lead recording is supplied (`EcgInput.leads`), ST deviation
and T-wave polarity are measured per lead and mapped onto the coronary territory that lead faces:

    LAD  -> V1 V2 V3 V4   (anterior / septal)
    LCx  -> I aVL V5 V6   (lateral)
    RCA  -> II III aVF    (inferior)
    LM   -> aVR elevation + diffuse depression (global subendocardial ischaemia pattern)
"""
from __future__ import annotations

import numpy as np
from scipy.signal import butter, filtfilt, find_peaks

from ..schemas import EcgFindings, EcgInput

ALL_LEADS = ["I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6"]
TERRITORY_LEADS: dict[str, list[str]] = {
    "LAD": ["V1", "V2", "V3", "V4"],
    "LCx": ["I", "aVL", "V5", "V6"],
    "RCA": ["II", "III", "aVF"],
}
TERRITORY_WALL = {"LAD": "Anterior/septal", "LCx": "Lateral", "RCA": "Inferior", "LM": "Global (left main)"}
# T polarity is physiologically variable in V1, III, aVL, aVR -> only judge T-wave abnormality where upright T is the norm
_T_ELIGIBLE = {"I", "II", "aVF", "V2", "V3", "V4", "V5", "V6"}
_ST_DEADZONE, _ST_SATURATION = 0.04, 0.20  # mV
LEAD_ABNORMAL = 0.35


def _bandpass(x: np.ndarray, fs: int) -> np.ndarray:
    b, a = butter(2, [0.5 / (fs / 2), 40 / (fs / 2)], btype="band")
    return filtfilt(b, a, x)


def _st_and_t(x: np.ndarray, peaks: np.ndarray, fs: int) -> tuple[float, float]:
    """Mean ST level (R+80..120ms) and T level (R+200..300ms), both relative to the pre-QRS baseline (R-80..-40ms)."""
    st, t = [], []
    for p in peaks:
        b0, b1 = p - int(0.08 * fs), p - int(0.04 * fs)
        lo, hi = p + int(0.08 * fs), p + int(0.12 * fs)
        tlo, thi = p + int(0.20 * fs), p + int(0.30 * fs)
        if b0 >= 0 and thi < x.size:
            base = x[b0:b1].mean()
            st.append(x[lo:hi].mean() - base)
            t.append(x[tlo:thi].mean() - base)
    return (float(np.mean(st)) if st else 0.0, float(np.mean(t)) if t else 0.0)


def _lead_abnormality(lead: str, st: float, t: float) -> float:
    st_abn = float(np.clip((abs(st) - _ST_DEADZONE) / (_ST_SATURATION - _ST_DEADZONE), 0, 1))
    t_abn = float(np.clip((0.05 - t) / 0.20, 0, 1)) if lead in _T_ELIGIBLE else 0.0
    return max(st_abn, t_abn)


def _territory_scores(lead_st: dict[str, float], lead_abn: dict[str, float]) -> dict[str, float]:
    scores: dict[str, float] = {}
    for vessel, names in TERRITORY_LEADS.items():
        vals = sorted((lead_abn[n] for n in names if n in lead_abn), reverse=True)
        if not vals:
            continue
        top = vals[:2]
        # Localised ischaemia involves >=2 contiguous leads; a single deviant lead counts for less (artefact guard)
        scores[vessel] = round(float(np.mean(top)) if len(top) >= 2 else 0.6 * top[0], 3)
    if "aVR" in lead_st:
        others = [v for k, v in lead_st.items() if k != "aVR"]
        n_dep = sum(v < -0.05 for v in others)
        if lead_st["aVR"] > 0.05 and n_dep >= 4:
            scores["LM"] = round(float(np.clip(0.5 * lead_st["aVR"] / 0.15 + 0.5 * n_dep / 6, 0, 1)), 3)
    return scores


def analyze(ecg: EcgInput) -> EcgFindings:
    fs = ecg.sampling_rate
    leads_in = {k: np.asarray(v, dtype=float) for k, v in (ecg.leads or {}).items()}
    if ecg.signal:
        primary_raw = np.asarray(ecg.signal, dtype=float)
    elif "II" in leads_in:
        primary_raw = leads_in["II"]
    elif leads_in:
        primary_raw = next(iter(leads_in.values()))
    else:
        primary_raw = np.asarray([], dtype=float)
    if primary_raw.size < fs * 2:
        raise ValueError("ECG too short (need >= 2 seconds)")
    x = _bandpass(primary_raw, fs)
    thr = np.percentile(x, 99) * 0.5
    peaks, _ = find_peaks(x, height=thr, distance=int(0.3 * fs))
    if len(peaks) < 3:
        raise ValueError("Could not detect enough R peaks")
    rr = np.diff(peaks) / fs
    hr = float(60 / rr.mean())
    rmssd = float(np.sqrt(np.mean(np.diff(rr * 1000) ** 2)))
    st_primary, _ = _st_and_t(x, peaks, fs)
    qrs_ms = float(np.mean([_qrs_width(x, p, fs) for p in peaks]))

    # --- per-lead ST / T and territory localisation (R-peak fiducials come from the primary lead) -----------------
    lead_st, lead_t, lead_abn = {}, {}, {}
    for name, raw in leads_in.items():
        if raw.size != primary_raw.size or raw.size < fs * 2:
            continue  # misaligned / too-short lead: skip rather than guess
        st_l, t_l = _st_and_t(_bandpass(raw, fs), peaks, fs)
        lead_st[name], lead_t[name] = round(st_l, 3), round(t_l, 3)
        lead_abn[name] = _lead_abnormality(name, st_l, t_l)
    territory = _territory_scores(lead_st, lead_abn) if lead_st else {}
    abnormal = [n for n, a in lead_abn.items() if a >= LEAD_ABNORMAL and n != "aVR"]

    # Global ST: lead-agnostic worst depression when a multi-lead ECG is available, else the single lead
    st_dev = st_primary
    depressed = sorted(v for k, v in lead_st.items() if k != "aVR")
    if len(depressed) >= 3:
        st_dev = min(st_primary, float(np.mean(depressed[:3])))

    flags = []
    if hr > 100: flags.append("Tachycardia")
    if hr < 50: flags.append("Bradycardia")
    if rmssd > 90: flags.append("Irregular rhythm (high HRV)")
    if st_dev < -0.08: flags.append("ST depression")
    if qrs_ms > 120: flags.append("Wide QRS")
    for vessel, s in territory.items():
        if s >= LEAD_ABNORMAL:
            names = [n for n in TERRITORY_LEADS.get(vessel, ["aVR"]) if lead_abn.get(n, 0) >= LEAD_ABNORMAL] or ["aVR"]
            flags.append(f"{TERRITORY_WALL[vessel]} ST/T abnormality ({', '.join(names)})")
    score = float(np.clip(0.45 * min(max(-st_dev, 0) / 0.25, 1) + 0.3 * min(rmssd / 150, 1)
                          + 0.15 * (hr > 100 or hr < 50) + 0.1 * (qrs_ms > 120), 0, 1))
    return EcgFindings(heart_rate=round(hr, 1), hrv_rmssd=round(rmssd, 1), qrs_ms=round(qrs_ms, 1),
                       st_deviation_mv=round(st_dev, 3), abnormality_score=round(score, 3),
                       flags=flags, r_peaks=[int(p) for p in peaks],
                       lead_st_mv=lead_st, lead_t_mv=lead_t, territory_scores=territory, abnormal_leads=abnormal)


def _qrs_width(x: np.ndarray, p: int, fs: int) -> float:
    half = x[p] * 0.25
    l = p
    while l > 0 and x[l] > half and p - l < 0.1 * fs:
        l -= 1
    r = p
    while r < x.size - 1 and x[r] > half and r - p < 0.1 * fs:
        r += 1
    return (r - l) / fs * 1000 * 2.2  # scale: threshold at 25% height underestimates base width
