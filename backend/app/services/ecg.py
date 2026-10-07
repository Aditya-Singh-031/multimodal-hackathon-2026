"""ECG feature extraction (scipy-only for robustness) + heuristic abnormality score."""
from __future__ import annotations

import numpy as np
from scipy.signal import butter, filtfilt, find_peaks

from ..schemas import EcgFindings, EcgInput


def analyze(ecg: EcgInput) -> EcgFindings:
    fs = ecg.sampling_rate
    x = np.asarray(ecg.signal or [], dtype=float)
    if x.size < fs * 2:
        raise ValueError("ECG too short (need >= 2 seconds)")
    b, a = butter(2, [0.5 / (fs / 2), 40 / (fs / 2)], btype="band")
    x = filtfilt(b, a, x)
    thr = np.percentile(x, 99) * 0.5
    peaks, _ = find_peaks(x, height=thr, distance=int(0.3 * fs))
    if len(peaks) < 3:
        raise ValueError("Could not detect enough R peaks")
    rr = np.diff(peaks) / fs
    hr = float(60 / rr.mean())
    rmssd = float(np.sqrt(np.mean(np.diff(rr * 1000) ** 2)))
    # ST deviation: mean(R+80..120ms) - mean(R-80..-40ms baseline)
    st = []
    for p in peaks:
        lo, hi = p + int(0.08 * fs), p + int(0.12 * fs)
        b0, b1 = p - int(0.08 * fs), p - int(0.04 * fs)
        if b0 >= 0 and hi < x.size:
            st.append(x[lo:hi].mean() - x[b0:b1].mean())
    st_dev = float(np.mean(st)) if st else 0.0
    qrs_ms = float(np.mean([_qrs_width(x, p, fs) for p in peaks]))
    flags = []
    if hr > 100: flags.append("Tachycardia")
    if hr < 50: flags.append("Bradycardia")
    if rmssd > 90: flags.append("Irregular rhythm (high HRV)")
    if st_dev < -0.08: flags.append("ST depression")
    if qrs_ms > 120: flags.append("Wide QRS")
    score = float(np.clip(0.45 * min(max(-st_dev, 0) / 0.25, 1) + 0.3 * min(rmssd / 150, 1)
                          + 0.15 * (hr > 100 or hr < 50) + 0.1 * (qrs_ms > 120), 0, 1))
    return EcgFindings(heart_rate=round(hr, 1), hrv_rmssd=round(rmssd, 1), qrs_ms=round(qrs_ms, 1),
                       st_deviation_mv=round(st_dev, 3), abnormality_score=round(score, 3),
                       flags=flags, r_peaks=[int(p) for p in peaks])


def _qrs_width(x: np.ndarray, p: int, fs: int) -> float:
    half = x[p] * 0.25
    l = p
    while l > 0 and x[l] > half and p - l < 0.1 * fs:
        l -= 1
    r = p
    while r < x.size - 1 and x[r] > half and r - p < 0.1 * fs:
        r += 1
    return (r - l) / fs * 1000 * 2.2  # scale: threshold at 25% height underestimates base width
