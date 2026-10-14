"""Late fusion: tabular calibrated probability adjusted in logit space by ECG and notes evidence.

Two levels of fusion share the same evidence:
  * patient level  - overall CAD risk (``risk``): tabular cad_status + global ECG abnormality + note risk flags
  * vessel level   - LAD / LCx / RCA (+ derived LM) stenosis probability: each artery's tabular probability is shifted
                     by (a) global ECG abnormality, (b) ST/T abnormality in *that artery's ECG leads* and (c) territorial
                     terms in the clinical note, weighted proportionally. Territorial evidence also lifts overall risk
                     (damped) and vessel probabilities are capped at the overall CAD probability (P(vessel) <= P(any)).
"""
from __future__ import annotations

import math

from ..config import settings
from ..schemas import (EcgFindings, NotesEntities, PredictRequest, PredictResponse, ShapContribution,
                       VesselPrediction, tier_for)
from . import ecg as ecg_svc, notes as notes_svc, tabular, vessels as vessel_svc

W_ECG = 1.2   # logit shift at abnormality_score = 1 (centered at 0.3)
W_NOTE = 0.18  # per extra-evidence risk flag not already captured in tabular data
_TABULAR_OWNED = {"Current smoker", "Diabetes", "Hypertension"}

# Vessel-level weights (logit units)
W_ECG_DIFFUSE = 0.5          # global ECG abnormality -> every vessel (no localisation possible)
W_ECG_TERRITORY = {"LAD": 1.8, "LCx": 1.8, "RCA": 1.8, "LM": 2.2}   # at territory_score = 1 (positive only)
W_NOTE_VESSEL = {"LAD": 1.0, "LCx": 1.0, "RCA": 1.0, "LM": 1.8}     # per unit of notes vessel_weight
W_NOTE_DIFFUSE = 0.5         # generic extra note risk-flags -> every vessel, relative to W_NOTE
W_RISK_COUPLING = 0.3        # share of the strongest territorial shift that also raises overall risk
LM_OFFSET = -1.6             # left-main disease is rare: derived from mean(LAD, LCx) logit, shifted down
VESSEL_TARGET = {"LAD": "lad_stenosis", "LCx": "lcx_stenosis", "RCA": "rca_stenosis"}


def _logit(p: float) -> float:
    p = min(max(p, 1e-4), 1 - 1e-4)
    return math.log(p / (1 - p))


def _sigmoid(z: float) -> float:
    return 1 / (1 + math.exp(-z))


def _rationale(risk: float, shap: list[ShapContribution], ecg: EcgFindings | None,
               notes: NotesEntities | None, vessels: list[VesselPrediction] | None = None) -> str:
    up = [c.feature for c in shap if c.contribution > 0][:3]
    down = [c.feature for c in shap if c.contribution < 0][:2]
    bits = [f"Estimated cardiovascular risk is {risk * 100:.0f}% ({tier_for(risk).replace('_', ' ')})."]
    if up: bits.append("Main drivers: " + ", ".join(up) + ".")
    if down: bits.append("Protective factors: " + ", ".join(down) + ".")
    if ecg and ecg.flags: bits.append("ECG shows " + ", ".join(f.lower() for f in ecg.flags) + ".")
    if notes and notes.family_history: bits.append("Clinical notes report a family history of cardiac disease.")
    crit = [v for v in (vessels or []) if v.status == "critical" and not v.derived]
    if crit:
        crit.sort(key=lambda v: v.stenosis_prob, reverse=True)
        bits.append("Likely obstructive (>=50%) disease in " + ", ".join(
            f"{v.id} ({v.stenosis_prob * 100:.0f}%)" for v in crit) + ".")
    bits.append("Decision-support only; not a medical diagnosis.")
    return " ".join(bits)


def run(req: PredictRequest) -> PredictResponse:
    probs, shaps = tabular.predict_targets(req.features)
    p_tab, shap = probs["cad_status"], shaps["cad_status"]
    z = _logit(p_tab)
    z_tab = z
    ecg_f = None
    if req.ecg and (req.ecg.signal or req.ecg.leads):
        try:
            ecg_f = ecg_svc.analyze(req.ecg)
            z += W_ECG * (ecg_f.abnormality_score - 0.3)
        except ValueError:
            ecg_f = None
    z_ecg = z - z_tab
    notes_e, source = None, "mock"
    extra: list[str] = []
    if req.notes and req.notes.strip():
        notes_e, source = notes_svc.extract(req.notes)
        extra = [f for f in notes_e.risk_flags if f not in _TABULAR_OWNED]
        z += W_NOTE * len(extra)
    z_notes = z - z_tab - z_ecg

    # ---- vessel-level evidence (logit shifts per artery) --------------------------------------------------------
    terr = ecg_f.territory_scores if ecg_f else {}
    nw = notes_e.vessel_weights if notes_e else {}
    diffuse_ecg = W_ECG_DIFFUSE * (ecg_f.abnormality_score - 0.3) if ecg_f else 0.0
    diffuse_notes = W_NOTE_DIFFUSE * W_NOTE * len(extra)
    ev: dict[str, dict[str, float]] = {}
    z_v: dict[str, float] = {}
    for vid in ("LAD", "LCx", "RCA"):
        e_terr = W_ECG_TERRITORY[vid] * max(0.0, terr.get(vid, 0.0))
        n_terr = W_NOTE_VESSEL[vid] * max(0.0, nw.get(vid, 0.0))
        z0 = _logit(probs[VESSEL_TARGET[vid]])
        ev[vid] = {"tabular_prob": probs[VESSEL_TARGET[vid]], "ecg_diffuse": diffuse_ecg, "ecg_territorial": e_terr,
                   "notes_territorial": n_terr, "notes_diffuse": diffuse_notes}
        z_v[vid] = z0 + diffuse_ecg + e_terr + diffuse_notes + n_terr
    z_lm0 = 0.5 * (_logit(probs["lad_stenosis"]) + _logit(probs["lcx_stenosis"])) + LM_OFFSET
    e_lm = W_ECG_TERRITORY["LM"] * max(0.0, terr.get("LM", 0.0))
    n_lm = W_NOTE_VESSEL["LM"] * max(0.0, nw.get("LM", 0.0))
    ev["LM"] = {"tabular_prob": _sigmoid(z_lm0), "ecg_diffuse": diffuse_ecg, "ecg_territorial": e_lm,
                "notes_territorial": n_lm, "notes_diffuse": diffuse_notes}
    z_v["LM"] = z_lm0 + diffuse_ecg + e_lm + diffuse_notes + n_lm

    # Territorial (localised) evidence is also evidence for CAD overall: lift patient risk by a damped amount and
    # attribute it to the modality that supplied the strongest shift.
    strongest = max(ev.values(), key=lambda d: d["ecg_territorial"] + d["notes_territorial"])
    if strongest["ecg_territorial"] + strongest["notes_territorial"] > 0:
        z_ecg += W_RISK_COUPLING * strongest["ecg_territorial"]
        z_notes += W_RISK_COUPLING * strongest["notes_territorial"]
        z += W_RISK_COUPLING * (strongest["ecg_territorial"] + strongest["notes_territorial"])
    risk = _sigmoid(z)

    # P(specific vessel >= 50%) can never exceed P(any vessel >= 50%)
    cap = min(0.995, risk)
    vessel_out = []
    for vid in ("LAD", "LCx", "RCA", "LM"):
        p = min(_sigmoid(z_v[vid]), cap)
        if vid == "LM":
            sh = vessel_svc.average_shap(shaps["lad_stenosis"], shaps["lcx_stenosis"])
        else:
            sh = shaps[VESSEL_TARGET[vid]]
        vessel_out.append(vessel_svc.build(vid, p, sh, ev[vid], derived=(vid == "LM")))

    tot = abs(z_tab - _logit(0.1)) + abs(z_ecg) + abs(z_notes) or 1.0
    contrib = {"clinical": abs(z_tab - _logit(0.1)) / tot, "ecg": abs(z_ecg) / tot, "notes": abs(z_notes) / tot}
    n_mod = 1 + (ecg_f is not None) + (notes_e is not None)
    confidence = round(min(0.97, 0.6 + 0.12 * n_mod + 0.1 * abs(risk - 0.5)), 3)
    # Overall CAD classification: True if overall CAD probability >= 0.50 or any major target vessel LAD/LCX/RCA >= 50%
    cad_status = bool(risk >= 0.50 or any(v.stenosis_pct >= 50 for v in vessel_out if v.id in ("LAD", "LCx", "RCA")))
    return PredictResponse(
        cad_status=cad_status,
        risk=round(risk, 4), tier=tier_for(risk), confidence=confidence,
        modality_contrib={k: round(v, 3) for k, v in contrib.items()}, shap=shap,
        ecg_findings=ecg_f, notes_entities=notes_e,
        rationale=_rationale(risk, shap, ecg_f, notes_e, vessel_out),
        source="live" if (source == "live" and not settings.demo_mode) else "mock",
        vessels=vessel_out)
