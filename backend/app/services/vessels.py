"""Per-artery metadata + conversion of fused stenosis probabilities into the VesselPrediction contract."""
from __future__ import annotations

from ..schemas import ShapContribution, VesselPrediction
from .ecg import TERRITORY_LEADS

VESSEL_ORDER = ("LAD", "LCx", "RCA", "LM")
VESSEL_META: dict[str, dict] = {
    "LAD": {"name": "Left Anterior Descending", "territory": "Anterior wall · interventricular septum · apex",
            "leads": TERRITORY_LEADS["LAD"]},
    "LCx": {"name": "Left Circumflex", "territory": "Lateral wall · posterolateral LV", "leads": TERRITORY_LEADS["LCx"]},
    "RCA": {"name": "Right Coronary Artery", "territory": "Inferior wall · RV · SA/AV nodes", "leads": TERRITORY_LEADS["RCA"]},
    "LM": {"name": "Left Main Trunk", "territory": "LAD + LCx territories (~75% of LV)", "leads": ["aVR", "V1"]},
}
PATENT_BELOW_PCT = 25
CRITICAL_FROM_PCT = 50  # == the >=50% diameter-stenosis target definition


def prob_to_pct(p: float) -> int:
    """Monotone display mapping: probability 0.5 <-> 50% diameter stenosis, so the 'critical' threshold of the
    trained target (>=50%) and the rendered lumen narrowing agree exactly."""
    return int(round(min(99.0, max(0.0, p * 100.0))))


def status_for(pct: int) -> str:
    return "critical" if pct >= CRITICAL_FROM_PCT else "mild" if pct >= PATENT_BELOW_PCT else "patent"


def ffr_proxy(pct: int) -> float:
    """Coarse pressure-derived FFR proxy (illustrative): ~1.0 below 30%, ~0.8 near 60%, steep fall beyond 70%."""
    return round(min(1.0, max(0.2, 1 - 0.9 * (pct / 100) ** 3)), 2)


def average_shap(*lists: list[ShapContribution]) -> list[ShapContribution]:
    acc: dict[str, list[float]] = {}
    ref: dict[str, ShapContribution] = {}
    for lst in lists:
        for c in lst:
            acc.setdefault(c.feature, []).append(c.contribution)
            ref[c.feature] = c
    out = [ShapContribution(feature=f, value=ref[f].value, contribution=sum(v) / len(v)) for f, v in acc.items()]
    return sorted(out, key=lambda c: abs(c.contribution), reverse=True)


def build(vessel_id: str, prob: float, shap: list[ShapContribution], evidence: dict[str, float],
          derived: bool = False) -> VesselPrediction:
    meta = VESSEL_META[vessel_id]
    pct = prob_to_pct(prob)
    return VesselPrediction(
        id=vessel_id, name=meta["name"], territory=meta["territory"], stenosis_prob=round(prob, 4),
        stenosis_pct=pct, status=status_for(pct), ecg_leads=list(meta["leads"]), ffr_proxy=ffr_proxy(pct),
        top_shap=shap[0] if shap else None, derived=derived, evidence={k: round(v, 3) for k, v in evidence.items()})
