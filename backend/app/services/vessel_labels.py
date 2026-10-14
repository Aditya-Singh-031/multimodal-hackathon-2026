"""Derive per-vessel (LAD / LCx / RCA) stenosis labels for datasets that only record *how many* vessels are diseased.

UCI Cleveland provides ``ca`` = number of major vessels (0-3) with >=50% narrowing on fluoroscopy and ``num`` = any
significant disease, but never *which* vessels. We therefore sample the affected-vessel subset from published
angiographic prevalence (LAD > RCA > LCx among single-vessel disease; two-vessel disease is most often LAD+RCA;
3-vessel disease involves all three). Sampling is seeded, so labels are reproducible.

IMPORTANT (honest provenance): the *count* of diseased vessels is real UCI signal, the *identity* of each vessel is
a literature-prior synthetic assignment. Per-vessel metrics therefore measure how well the model recovers the
disease burden and its prior-driven vessel split, not true anatomical localisation. The territorial evidence that
actually separates arteries comes from the ECG (per-lead ST/T) and note modalities at inference time.
"""
from __future__ import annotations

import numpy as np

VESSELS = ("LAD", "LCx", "RCA")
# Training-target column names (as requested by the Track A spec)
TARGET_COLUMNS = {"cad_status": None, "lad_stenosis": "LAD", "lcx_stenosis": "LCx", "rca_stenosis": "RCA"}
TARGETS = tuple(TARGET_COLUMNS)

# P(vessel is the culprit | single-vessel disease) and the relative weights used when drawing a k-subset.
_PRIOR = np.array([0.46, 0.22, 0.32])  # LAD, LCx, RCA


def derive_vessel_labels(cad: np.ndarray, n_vessels: np.ndarray | None, seed: int = 42) -> dict[str, np.ndarray]:
    """Return {cad_status, lad_stenosis, lcx_stenosis, rca_stenosis} 0/1 arrays.

    cad: binary overall CAD (>=50% stenosis anywhere).
    n_vessels: count of diseased major vessels (UCI ``ca``; NaN allowed). Positives get at least one vessel; negatives
        have none, so cad_status == any(vessel) holds by construction.
    """
    rng = np.random.default_rng(seed)
    cad = np.asarray(cad).astype(int)
    k_raw = np.full(len(cad), np.nan) if n_vessels is None else np.asarray(n_vessels, dtype=float)
    out = {name: np.zeros(len(cad), dtype=int) for name in TARGETS}
    out["cad_status"] = cad.copy()
    for i in range(len(cad)):
        if not cad[i]:
            continue
        k = k_raw[i]
        if np.isnan(k):
            k = rng.choice([1, 2, 3], p=[0.55, 0.30, 0.15])
        k = int(min(3, max(1, k)))
        picked = rng.choice(3, size=k, replace=False, p=_PRIOR / _PRIOR.sum())
        for j in picked:
            out[f"{VESSELS[j].lower()}_stenosis"][i] = 1
    return out


def severity_to_vessel_count(label: np.ndarray, latent: np.ndarray, seed: int = 7) -> np.ndarray:
    """Synthetic cohort has only a binary label + latent risk: draw a plausible vessel count for positives."""
    rng = np.random.default_rng(seed)
    k = np.zeros(len(label))
    for i, (y, r) in enumerate(zip(label, latent)):
        if not y:
            continue
        p3 = min(0.55, 0.05 + 0.6 * float(r))
        p2 = min(0.40, 0.18 + 0.25 * float(r))
        k[i] = rng.choice([1, 2, 3], p=[1 - p2 - p3, p2, p3])
    return k
