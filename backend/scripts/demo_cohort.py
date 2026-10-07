"""Curated 10-patient demo cohort spanning the clinical risk spectrum.

Each spec declares a target band; the builder scores the patient through the *real* fusion pipeline
and fails loudly if the result is outside the band (so the demo can't silently drift after retraining).
Vessel findings and cath narratives are synthetic.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.schemas import PredictRequest  # noqa: E402
from app.services import fusion  # noqa: E402

BANDS = {"low": (0.0, 0.10), "moderate": (0.10, 0.25), "high": (0.25, 0.50), "critical": (0.50, 1.01)}

# name, band, features, ecg_abnormality, vessels, note
SPECS = [
    ("Asha Verma", "low", dict(age=34, sex="F", systolic_bp=112, cholesterol=172, smoker=False, diabetic=False, bmi=22.4, resting_hr=64, chest_pain_type=0, exercise_angina=False),
     0.05, [], "Denies chest pain. Runs 5km three times weekly. No family history of heart disease."),
    ("Meera Iyer", "low", dict(age=41, sex="F", systolic_bp=118, cholesterol=188, smoker=False, diabetic=False, bmi=24.0, resting_hr=68, chest_pain_type=0, exercise_angina=False),
     0.05, [], "Denies chest pain. Routine check-up, normotensive."),
    ("Rohan Mehta", "low", dict(age=30, sex="M", systolic_bp=115, cholesterol=180, smoker=False, diabetic=False, bmi=22.5, resting_hr=66, chest_pain_type=0, exercise_angina=False),
     0.05, [], "Denies chest pain. Regular runner, healthy diet. No cardiovascular symptoms."),
    ("Sana Khan", "moderate", dict(age=61, sex="F", systolic_bp=150, cholesterol=230, smoker=False, diabetic=False, bmi=29.0, resting_hr=78, chest_pain_type=1, exercise_angina=False),
     0.25, [], "Occasional atypical chest discomfort, non-exertional. Prescribed low-dose amlodipine."),
    ("Arjun Nair", "moderate", dict(age=56, sex="M", systolic_bp=145, cholesterol=230, smoker=False, diabetic=True, bmi=28.0, resting_hr=76, chest_pain_type=1, exercise_angina=False),
     0.25, [], "Occasional atypical chest discomfort. Type 2 diabetes on metformin."),
    ("Lata Pillai", "moderate", dict(age=63, sex="F", systolic_bp=155, cholesterol=230, smoker=False, diabetic=True, bmi=29.5, resting_hr=80, chest_pain_type=1, exercise_angina=False),
     0.25, [], "Occasional atypical chest discomfort. Type 2 diabetes on metformin. Hypertensive, prescribed amlodipine."),
    ("Kabir Singh", "high", dict(age=54, sex="M", systolic_bp=148, cholesterol=240, smoker=True, diabetic=False, bmi=28.5, resting_hr=78, chest_pain_type=2, exercise_angina=False),
     0.35, ["LAD"], "Patient reports exertional chest tightness radiating to the left arm. Provoked by climbing stairs. Current smoker, approx 18 pack-years. Angiography: 70% LAD stenosis."),
    ("Priya Sharma", "high", dict(age=64, sex="F", systolic_bp=155, cholesterol=250, smoker=True, diabetic=True, bmi=30.0, resting_hr=80, chest_pain_type=2, exercise_angina=False),
     0.35, ["RCA"], "Patient reports exertional chest tightness radiating to the jaw. Provoked by exercise. Type 2 diabetes on metformin. Current smoker. Angiography: 75% mid-RCA stenosis."),
    ("Vikram Rao", "critical", dict(age=72, sex="M", systolic_bp=172, cholesterol=275, smoker=True, diabetic=True, bmi=32.0, resting_hr=90, chest_pain_type=3, exercise_angina=True),
     0.85, ["LAD", "RCA", "LCx"], "Patient reports exertional chest tightness radiating to the left arm. Provoked by minimal exertion. Current smoker, approx 28 pack-years. Type 2 diabetes. Father had MI at age 51. Angiography: severe 3-vessel disease."),
    ("Dev Malhotra", "critical", dict(age=78, sex="M", systolic_bp=180, cholesterol=290, smoker=True, diabetic=True, bmi=33.0, resting_hr=94, chest_pain_type=3, exercise_angina=True),
     0.95, ["LM", "LAD", "RCA", "LCx"], "Patient reports severe exertional chest tightness radiating to the arm and jaw. Current smoker. Type 2 diabetes. Father had MI at age 48. Angiography: left main and multivessel disease."),
]


def build(synth_ecg, fs: int, out: Path) -> list[dict]:
    patients, report = [], []
    for i, (name, band, feats, abn, vessels, note) in enumerate(SPECS, 1):
        pid = f"DEMO{i:02d}"
        sig = synth_ecg(feats["resting_hr"], abn)
        req = {"patient_id": pid, "features": feats, "notes": note,
               "ecg": {"signal": sig[: fs * 6].round(4).tolist(), "sampling_rate": fs}}
        res = fusion.run(PredictRequest(**req))
        lo, hi = BANDS[band]
        report.append(f"  {pid} {name:<13} target={band:<8} risk={res.risk * 100:5.1f}%  tier={res.tier}")
        if not lo <= res.risk < hi:
            report.append(f"    ^^ OUT OF BAND [{lo:.0%}, {hi:.0%})")
        patients.append({"id": pid, "name": name, "label": None, "vessels": vessels,
                         "profile": band, "request": req})
    print("\n".join(report))
    bad = [r for r in report if "OUT OF BAND" in r]
    if bad:
        raise SystemExit("Demo cohort calibration failed; adjust SPECS.")
    return patients
