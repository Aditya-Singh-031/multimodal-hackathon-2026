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
