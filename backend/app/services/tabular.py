"""Tabular risk model: XGBoost + SHAP. Auto-trains on the synthetic cohort if no artifact exists."""
from __future__ import annotations

import joblib
import numpy as np
import pandas as pd
import shap
from sklearn.calibration import CalibratedClassifierCV
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import train_test_split
from xgboost import XGBClassifier

from ..config import settings
from ..schemas import ClinicalFeatures, ShapContribution

FEATURES = ["age", "sex_m", "systolic_bp", "cholesterol", "smoker", "diabetic", "bmi",
            "resting_hr", "chest_pain_type", "exercise_angina"]
LABELS = {"age": "Age", "sex_m": "Male sex", "systolic_bp": "Systolic BP", "cholesterol": "Cholesterol",
          "smoker": "Smoking", "diabetic": "Diabetes", "bmi": "BMI", "resting_hr": "Resting HR",
          "chest_pain_type": "Chest pain type", "exercise_angina": "Exercise angina"}
_ART = settings.model_dir / "tabular.joblib"
_state: dict = {}


def to_frame(f: ClinicalFeatures) -> pd.DataFrame:
    return pd.DataFrame([{
        "age": f.age, "sex_m": int(f.sex == "M"), "systolic_bp": f.systolic_bp, "cholesterol": f.cholesterol,
        "smoker": int(f.smoker), "diabetic": int(f.diabetic), "bmi": f.bmi, "resting_hr": f.resting_hr,
        "chest_pain_type": f.chest_pain_type, "exercise_angina": int(f.exercise_angina)}])[FEATURES]


def train() -> dict:
    df = pd.read_csv(settings.data_dir / "synthetic" / "cohort.csv")
    df["sex_m"] = (df["sex"] == "M").astype(int)
    for c in ("smoker", "diabetic", "exercise_angina"):
        df[c] = df[c].astype(int)
    X, y = df[FEATURES], df["label"]
    Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.25, random_state=7, stratify=y)
    base = XGBClassifier(n_estimators=150, max_depth=3, learning_rate=0.08, subsample=0.9,
                         eval_metric="logloss")
    base.fit(Xtr, ytr)
    cal = CalibratedClassifierCV(XGBClassifier(**base.get_params()), method="isotonic", cv=3).fit(Xtr, ytr)
    auc = float(roc_auc_score(yte, cal.predict_proba(Xte)[:, 1]))
    art = {"model": base, "calibrated": cal, "auc": auc, "base_rate": float(y.mean())}
    settings.model_dir.mkdir(parents=True, exist_ok=True)
    joblib.dump(art, _ART)
    return art


def _load() -> dict:
    if not _state:
        art = joblib.load(_ART) if _ART.exists() else train()
        art["explainer"] = shap.TreeExplainer(art["model"])
        _state.update(art)
    return _state


def predict(f: ClinicalFeatures) -> tuple[float, list[ShapContribution]]:
    st = _load()
    X = to_frame(f)
    p = float(st["calibrated"].predict_proba(X)[0, 1])
    sv = np.asarray(st["explainer"].shap_values(X))[0]
    contribs = [ShapContribution(feature=LABELS[n], value=float(X.iloc[0][n]), contribution=float(s))
                for n, s in zip(FEATURES, sv)]
    contribs.sort(key=lambda c: abs(c.contribution), reverse=True)
    return p, contribs


def model_auc() -> float:
    return _load()["auc"]
