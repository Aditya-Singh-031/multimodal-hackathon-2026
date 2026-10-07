"""Late fusion: tabular calibrated probability adjusted in logit space by ECG and notes evidence."""
from __future__ import annotations

import math

from ..config import settings
from ..schemas import (EcgFindings, NotesEntities, PredictRequest, PredictResponse, ShapContribution, tier_for)
from . import ecg as ecg_svc, notes as notes_svc, tabular

W_ECG = 1.2   # logit shift at abnormality_score = 1 (centered at 0.3)
W_NOTE = 0.18  # per extra-evidence risk flag not already captured in tabular data
_TABULAR_OWNED = {"Current smoker", "Diabetes", "Hypertension"}


def _logit(p: float) -> float:
    p = min(max(p, 1e-4), 1 - 1e-4)
    return math.log(p / (1 - p))


def _rationale(risk: float, shap: list[ShapContribution], ecg: EcgFindings | None,
               notes: NotesEntities | None) -> str:
    up = [c.feature for c in shap if c.contribution > 0][:3]
    down = [c.feature for c in shap if c.contribution < 0][:2]
    bits = [f"Estimated cardiovascular risk is {risk * 100:.0f}% ({tier_for(risk).replace('_', ' ')})."]
    if up: bits.append("Main drivers: " + ", ".join(up) + ".")
    if down: bits.append("Protective factors: " + ", ".join(down) + ".")
    if ecg and ecg.flags: bits.append("ECG shows " + ", ".join(f.lower() for f in ecg.flags) + ".")
    if notes and notes.family_history: bits.append("Clinical notes report a family history of cardiac disease.")
    bits.append("Decision-support only; not a medical diagnosis.")
    return " ".join(bits)


def run(req: PredictRequest) -> PredictResponse:
    p_tab, shap = tabular.predict(req.features)
    z = _logit(p_tab)
    z_tab = z
    ecg_f = None
    if req.ecg and req.ecg.signal:
        try:
            ecg_f = ecg_svc.analyze(req.ecg)
            z += W_ECG * (ecg_f.abnormality_score - 0.3)
        except ValueError:
            ecg_f = None
    z_ecg = z - z_tab
    notes_e, source = None, "mock"
    if req.notes and req.notes.strip():
        notes_e, source = notes_svc.extract(req.notes)
        extra = [f for f in notes_e.risk_flags if f not in _TABULAR_OWNED]
        z += W_NOTE * len(extra)
    z_notes = z - z_tab - z_ecg
    risk = 1 / (1 + math.exp(-z))

    tot = abs(z_tab - _logit(0.1)) + abs(z_ecg) + abs(z_notes) or 1.0
    contrib = {"clinical": abs(z_tab - _logit(0.1)) / tot, "ecg": abs(z_ecg) / tot, "notes": abs(z_notes) / tot}
    n_mod = 1 + (ecg_f is not None) + (notes_e is not None)
    confidence = round(min(0.97, 0.6 + 0.12 * n_mod + 0.1 * abs(risk - 0.5)), 3)
    return PredictResponse(
        risk=round(risk, 4), tier=tier_for(risk), confidence=confidence,
        modality_contrib={k: round(v, 3) for k, v in contrib.items()}, shap=shap,
        ecg_findings=ecg_f, notes_entities=notes_e, rationale=_rationale(risk, shap, ecg_f, notes_e),
        source="live" if (source == "live" and not settings.demo_mode) else "mock")
