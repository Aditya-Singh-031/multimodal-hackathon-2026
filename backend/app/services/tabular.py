"""Tabular risk models: one calibrated XGBoost + SHAP explainer per target (cad_status, LAD, LCx, RCA).

Auto-trains on the synthetic cohort if no artifact exists (production artifact comes from scripts/train_tabular.py).
"""
from __future__ import annotations

import joblib
import numpy as np
import pandas as pd
import shap
from sklearn.calibration import CalibratedClassifierCV
from sklearn.metrics import average_precision_score, roc_auc_score
from sklearn.model_selection import train_test_split
from xgboost import XGBClassifier

from ..config import settings
from ..schemas import ClinicalFeatures, ShapContribution
from .vessel_labels import TARGETS, derive_vessel_labels, severity_to_vessel_count

FEATURES = ["age", "sex_m", "systolic_bp", "cholesterol", "smoker", "diabetic", "bmi",
            "resting_hr", "chest_pain_type", "exercise_angina",
            "st_elevation", "t_inversion", "lvh", "rwma", "cardiac_enzymes_elevated"]
LABELS = {"age": "Age", "sex_m": "Male sex", "systolic_bp": "Systolic BP", "cholesterol": "Cholesterol",
          "smoker": "Smoking", "diabetic": "Diabetes", "bmi": "BMI", "resting_hr": "Resting HR",
          "chest_pain_type": "Chest pain type", "exercise_angina": "Exercise angina",
          "st_elevation": "ST elevation", "t_inversion": "T-wave inversion", "lvh": "LVH",
          "rwma": "RWMA score", "cardiac_enzymes_elevated": "Cardiac enzymes"}
# Clinical priors: every modifiable/ordinal risk factor may only *increase* risk. This keeps the what-if simulator
# physiologically sensible (lowering BP / quitting smoking can never raise a vessel's stenosis probability).
MONOTONE = {"age": 1, "sex_m": 1, "systolic_bp": 1, "cholesterol": 1, "smoker": 1, "diabetic": 1, "bmi": 1,
            "resting_hr": 0, "chest_pain_type": 1, "exercise_angina": 1,
            "st_elevation": 1, "t_inversion": 1, "lvh": 1, "rwma": 1, "cardiac_enzymes_elevated": 1}
_ART = settings.model_dir / "tabular.joblib"
_state: dict = {}


def xgb_params(seed: int = 42) -> dict:
    return dict(n_estimators=100, max_depth=3, learning_rate=0.05, subsample=0.85, colsample_bytree=0.85,
                eval_metric="logloss", random_state=seed,
                monotone_constraints=tuple(MONOTONE[f] for f in FEATURES))


def new_base(seed: int = 42) -> XGBClassifier:
    return XGBClassifier(**xgb_params(seed))


def new_calibrated(seed: int = 42) -> CalibratedClassifierCV:
    # Platt (sigmoid) scaling: smooth + strictly monotone, so small what-if changes always move the probability
    # (isotonic regression yields plateaus on ~300 rows).
    return CalibratedClassifierCV(new_base(seed), method="sigmoid", cv=3)


def to_frame(f: ClinicalFeatures) -> pd.DataFrame:
    return pd.DataFrame([{
        "age": f.age, "sex_m": int(f.sex == "M"), "systolic_bp": f.systolic_bp, "cholesterol": f.cholesterol,
        "smoker": int(f.smoker), "diabetic": int(f.diabetic), "bmi": f.bmi, "resting_hr": f.resting_hr,
        "chest_pain_type": f.chest_pain_type, "exercise_angina": int(f.exercise_angina),
        "st_elevation": int(f.st_elevation), "t_inversion": int(f.t_inversion),
        "lvh": int(f.lvh), "rwma": int(f.rwma),
        "cardiac_enzymes_elevated": int(f.cardiac_enzymes_elevated)}])[FEATURES]


def fit_targets(X: pd.DataFrame, labels: dict[str, np.ndarray], seed: int = 42) -> dict[str, dict]:
    """Fit an uncalibrated base model (for SHAP) and a calibrated model (for probabilities) per target."""
    out = {}
    for name in TARGETS:
        y = np.asarray(labels[name]).astype(int)
        base = new_base(seed).fit(X, y)
        cal = new_calibrated(seed).fit(X, y)
        out[name] = {"model": base, "calibrated": cal, "base_rate": float(y.mean()), "n_pos": int(y.sum())}
    return out


def build_artifact(targets: dict[str, dict], metrics: dict[str, dict], dataset: str, provenance: str, trained_at: str) -> dict:
    cad = targets["cad_status"]
    return {
        "targets": targets, "target_metrics": metrics, "dataset": dataset, "features": FEATURES,
        "vessel_label_provenance": provenance, "trained_at": trained_at,
        # Back-compat keys (single-target consumers)
        "model": cad["model"], "calibrated": cad["calibrated"], "base_rate": cad["base_rate"],
        "auc": metrics["cad_status"]["roc_auc"], "metrics": metrics["cad_status"],
    }


def train() -> dict:
    """Fallback trainer on the synthetic cohort (vessel identity is synthetic here too)."""
    from datetime import datetime, timezone

    df = pd.read_csv(settings.data_dir / "synthetic" / "cohort.csv")
    df["sex_m"] = (df["sex"] == "M").astype(int)
    for c in ("smoker", "diabetic", "exercise_angina"):
        df[c] = df[c].astype(int)
    X, y = df[FEATURES], df["label"].astype(int).to_numpy()
    k = severity_to_vessel_count(y, df["risk_latent"].to_numpy())
    labels = derive_vessel_labels(y, k, seed=42)
    idx = np.arange(len(df))
    tr, te = train_test_split(idx, test_size=0.25, random_state=7, stratify=y)
    held = fit_targets(X.iloc[tr], {n: labels[n][tr] for n in TARGETS})
    metrics = {}
    for n in TARGETS:
        p = held[n]["calibrated"].predict_proba(X.iloc[te])[:, 1]
        yt = labels[n][te]
        metrics[n] = {"roc_auc": round(float(roc_auc_score(yt, p)), 4),
                      "pr_auc": round(float(average_precision_score(yt, p)), 4),
                      "prevalence": round(float(labels[n].mean()), 4), "n_samples": int(len(yt))}
    targets = fit_targets(X, labels)
    art = build_artifact(targets, metrics, "Synthetic Cohort (auto-trained fallback)",
                         "synthetic vessel identity (seeded literature priors)", datetime.now(timezone.utc).isoformat())
    settings.model_dir.mkdir(parents=True, exist_ok=True)
    joblib.dump(art, _ART)
    return art


def _load() -> dict:
    if not _state:
        art = joblib.load(_ART) if _ART.exists() else None
        if art is None or "targets" not in art:  # missing or legacy single-target artifact
            art = train()
        art["explainers"] = {n: shap.TreeExplainer(t["model"]) for n, t in art["targets"].items()}
        _state.update(art)
    return _state


def _contribs(sv: np.ndarray, X: pd.DataFrame) -> list[ShapContribution]:
    contribs = [ShapContribution(feature=LABELS[n], value=float(X.iloc[0][n]), contribution=float(s))
                for n, s in zip(FEATURES, sv)]
    contribs.sort(key=lambda c: abs(c.contribution), reverse=True)
    return contribs


def predict_targets(f: ClinicalFeatures) -> tuple[dict[str, float], dict[str, list[ShapContribution]]]:
    """Calibrated probability + SHAP (log-odds) for every target."""
    st = _load()
    X = to_frame(f)
    probs, shaps = {}, {}
    for n in TARGETS:
        probs[n] = float(st["targets"][n]["calibrated"].predict_proba(X)[0, 1])
        shaps[n] = _contribs(np.asarray(st["explainers"][n].shap_values(X))[0], X)
    return probs, shaps


def predict(f: ClinicalFeatures) -> tuple[float, list[ShapContribution]]:
    probs, shaps = predict_targets(f)
    return probs["cad_status"], shaps["cad_status"]


def model_auc() -> float:
    return _load()["auc"]


def target_metrics() -> dict[str, dict]:
    return _load().get("target_metrics", {})
