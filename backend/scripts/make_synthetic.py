"""Generate synthetic multimodal cohort: tabular + ECG waveform + clinical note.

Usage: python scripts/make_synthetic.py [--n 1500]
Outputs data/synthetic/{cohort.csv, ecg/<id>.npy, notes.json} and data/synthetic/patients.json (demo patients).
Also tries to merge real UCI Heart data if data/raw/heart.csv exists (see download_data.py).
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "synthetic"
FS = 250
RNG = np.random.default_rng(2026)

NAMES = ["Asha Verma", "Rohan Mehta", "Meera Iyer", "Vikram Rao", "Sana Khan", "Arjun Nair",
         "Priya Sharma", "Kabir Singh", "Lata Pillai", "Dev Malhotra"]


def synth_ecg(hr: float, abnormal: float, seconds: int = 8) -> np.ndarray:
    """Pseudo-ECG: gaussian P,Q,R,S,T per beat; abnormal => ST depression + jitter."""
    n = FS * seconds
    t = np.arange(n) / FS
    sig = np.zeros(n)
    rr = 60.0 / hr
    beat = 0.3
    while beat < seconds:
        jitter = RNG.normal(0, 0.01 + 0.06 * abnormal)
        c = beat + jitter
        for amp, off, w in [(0.12, -0.2, 0.025), (-0.12, -0.04, 0.012), (1.0, 0.0, 0.012),
                            (-0.2, 0.035, 0.012), (0.3 - 0.4 * abnormal, 0.25, 0.05)]:
            sig += amp * np.exp(-((t - (c + off)) ** 2) / (2 * w ** 2))
        sig -= 0.15 * abnormal * np.exp(-((t - (c + 0.12)) ** 2) / (2 * 0.04 ** 2))  # ST depression
        beat += rr * (1 + RNG.normal(0, 0.02 + 0.08 * abnormal))
    return (sig + RNG.normal(0, 0.02, n)).astype(np.float32)


def make_note(row) -> str:
    parts = []
    if row.chest_pain_type >= 2:
        parts.append("Patient reports exertional chest tightness radiating to the left arm.")
    elif row.chest_pain_type == 1:
        parts.append("Occasional atypical chest discomfort, non-exertional.")
    else:
        parts.append("Denies chest pain.")
    if row.exercise_angina:
        parts.append("Symptoms provoked by climbing stairs; relieved by rest.")
    if row.smoker:
        parts.append(f"Current smoker, approx {RNG.integers(5, 30)} pack-years.")
    if row.diabetic:
        parts.append("Type 2 diabetes on metformin.")
    if RNG.random() < 0.25 + 0.3 * row.risk_latent:
        parts.append("Father had myocardial infarction at age " + str(RNG.integers(45, 62)) + ".")
    if row.systolic_bp > 150:
        parts.append("Hypertensive, prescribed amlodipine.")
    return " ".join(parts)


def generate(n: int) -> pd.DataFrame:
    age = RNG.integers(30, 85, n)
    sex = RNG.choice(["M", "F"], n)
    bmi = np.clip(RNG.normal(27, 4.5, n), 16, 50)
    sbp = np.clip(RNG.normal(100 + 0.6 * age, 15, n), 90, 220)
    chol = np.clip(RNG.normal(190 + 0.4 * age, 35, n), 110, 400)
    smoker = RNG.random(n) < 0.22
    diabetic = RNG.random(n) < (0.06 + 0.002 * (age - 30))
    cp = RNG.integers(0, 4, n)
    ex_ang = RNG.random(n) < 0.12 + 0.06 * (cp >= 2)
    hr = np.clip(RNG.normal(72, 10, n), 45, 130)
    logit = (-8.2 + 0.06 * age + 0.5 * (sex == "M") + 0.018 * (sbp - 120) + 0.006 * (chol - 200)
             + 0.8 * smoker + 0.7 * diabetic + 0.03 * (bmi - 25) + 0.35 * cp + 0.7 * ex_ang)
    p = 1 / (1 + np.exp(-logit))
    label = (RNG.random(n) < p).astype(int)
    df = pd.DataFrame(dict(age=age, sex=sex, systolic_bp=sbp.round(0), cholesterol=chol.round(0),
                           smoker=smoker, diabetic=diabetic, bmi=bmi.round(1), resting_hr=hr.round(0),
                           chest_pain_type=cp, exercise_angina=ex_ang, risk_latent=p, label=label))
    df.insert(0, "id", [f"P{i:04d}" for i in range(n)])
    return df


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=1500)
    n = ap.parse_args().n
    (OUT / "ecg").mkdir(parents=True, exist_ok=True)
    df = generate(n)
    df["note"] = [make_note(r) for r in df.itertuples()]
    for r in df.itertuples():
        abn = float(np.clip(r.risk_latent * 1.6 + RNG.normal(0, 0.1), 0, 1))
        np.save(OUT / "ecg" / f"{r.id}.npy", synth_ecg(r.resting_hr, abn))
    df.drop(columns=["note"]).to_csv(OUT / "cohort.csv", index=False)
    json.dump(dict(zip(df.id, df.note)), open(OUT / "notes.json", "w"), indent=1)

    # Curated demo patients: verified against the real fusion pipeline (see demo_cohort.py)
    from demo_cohort import build
    patients = build(synth_ecg, FS, OUT)
    json.dump(patients, open(OUT / "patients.json", "w"))
    print(f"Wrote {n} patients, {len(patients)} demo patients -> {OUT}")


if __name__ == "__main__":
    main()
