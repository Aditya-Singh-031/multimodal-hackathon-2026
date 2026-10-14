import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app

client = TestClient(app)


def _patients():
    return json.loads((settings.data_dir / "synthetic" / "patients.json").read_text())


def test_health():
    r = client.get("/api/health")
    assert r.status_code == 200 and r.json()["model_auc"] > 0.65


def test_predict_all_modalities():
    p = _patients()[-1]
    r = client.post("/api/predict", json=p["request"])
    assert r.status_code == 200, r.text
    d = r.json()
    assert 0 <= d["risk"] <= 1 and d["ecg_findings"] and d["notes_entities"] and d["shap"]
    assert "cad_status" in d
    assert isinstance(d["cad_status"], bool)
    assert "vessels" in d and len(d["vessels"]) == 4
    assert [v["id"] for v in d["vessels"]] == ["LAD", "LCx", "RCA", "LM"]
    # Check that high risk patient has cad_status True
    assert d["cad_status"] is True


def test_risk_orders_across_patients():
    ps = _patients()
    lo = client.post("/api/predict", json=ps[0]["request"]).json()["risk"]
    hi = client.post("/api/predict", json=ps[-1]["request"]).json()["risk"]
    assert hi > lo


def test_simulate_quit_smoking_lowers_risk():
    smoker = next(p for p in _patients() if p["request"]["features"]["smoker"])
    r = client.post("/api/simulate", json={"base": smoker["request"], "overrides": {"smoker": False}})
    assert r.status_code == 200 and r.json()["delta_risk"] < 0


def test_validation_error():
    r = client.post("/api/predict", json={"features": {"age": 5, "sex": "M", "systolic_bp": 120, "cholesterol": 200}})
    assert r.status_code == 422


def test_unknown_override():
    p = _patients()[0]["request"]
    assert client.post("/api/simulate", json={"base": p, "overrides": {"foo": 1}}).status_code == 422


def test_short_ecg_degrades_gracefully():
    p = _patients()[0]["request"]
    p["ecg"]["signal"] = [0.0] * 10
    r = client.post("/api/predict", json=p)
    assert r.status_code == 200 and r.json()["ecg_findings"] is None


def test_clinical_features_boundary():
    """Verify core ECG/Echo features are accepted as ML inputs and affect prediction."""
    req = {
        "features": {
            "age": 55, "sex": "M", "systolic_bp": 140, "cholesterol": 220,
            "smoker": False, "diabetic": False, "bmi": 26.0, "resting_hr": 72,
            "chest_pain_type": 1, "exercise_angina": False,
            "st_elevation": True, "t_inversion": True, "lvh": True, "rwma": 2,
            "cardiac_enzymes_elevated": True,
        }
    }
    r = client.post("/api/predict", json=req)
    assert r.status_code == 200
    d = r.json()
    assert d["cad_status"] is True
    # Verify SHAP includes the new clinical features
    shap_feats = {s["feature"] for s in d["shap"]}
    assert "ST elevation" in shap_feats
    assert "RWMA score" in shap_feats
    assert "Cardiac enzymes" in shap_feats


def test_no_target_leakage_in_features():
    """Requirement 1d: Verify strict target leakage prevention.

    Coronary vessel labels (LAD, LCX, RCA, LM), catheterization/fluoroscopy findings (Cath/ca),
    and target labels (cad_status, stenosis) must NEVER be present in the model's feature set
    or accepted as input predictors in ClinicalFeatures.
    """
    from app.schemas import ClinicalFeatures
    from app.services.tabular import FEATURES, FORBIDDEN_LEAKAGE_FEATURES

    # 1. Assert module-level leakage guard
    assert FORBIDDEN_LEAKAGE_FEATURES.isdisjoint(FEATURES), (
        f"Target leakage detected in FEATURES: {FORBIDDEN_LEAKAGE_FEATURES & set(FEATURES)}"
    )

    # 2. Key target/cath strings must be in the forbidden set
    for key in ["LAD", "LCX", "RCA", "LM", "Cath", "cad_status", "lad_stenosis", "lcx_stenosis", "rca_stenosis"]:
        assert key in FORBIDDEN_LEAKAGE_FEATURES

    # 3. Input schema (ClinicalFeatures) must never accept target / vessel / cath fields as model inputs
    schema_fields = set(ClinicalFeatures.model_fields.keys())
    assert FORBIDDEN_LEAKAGE_FEATURES.isdisjoint(schema_fields)
    assert "lad" not in schema_fields
    assert "lcx" not in schema_fields
    assert "rca" not in schema_fields
    assert "cath" not in schema_fields

    # 4. Feature vector must be pure pre-catheterization clinical/ECG/echo predictors
    features_lower = {f.lower() for f in FEATURES}
    for forbidden in ["lad", "lcx", "rca", "cath", "stenosis", "cad_status", "target"]:
        assert forbidden not in features_lower, f"Forbidden predictor '{forbidden}' found in FEATURES vector!"

