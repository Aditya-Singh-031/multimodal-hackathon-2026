"""Pydantic contracts shared by all services and routers."""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

RiskTier = Literal["low", "moderate", "high", "very_high"]
VesselId = Literal["LAD", "LCx", "RCA", "LM"]
VesselStatus = Literal["patent", "mild", "critical"]


class ClinicalFeatures(BaseModel):
    """Tabular modality (UCI/Framingham-style)."""

    age: int = Field(ge=18, le=100)
    sex: Literal["M", "F"]
    systolic_bp: float = Field(ge=70, le=250)
    cholesterol: float = Field(ge=80, le=600, description="Total cholesterol mg/dL")
    smoker: bool = False
    diabetic: bool = False
    bmi: float = Field(ge=12, le=60, default=25.0)
    resting_hr: float = Field(ge=30, le=220, default=72.0)
    chest_pain_type: int = Field(ge=0, le=3, default=0, description="0 none .. 3 typical angina")
    exercise_angina: bool = False
    st_elevation: bool = Field(default=False, description="ECG ST-segment elevation")
    t_inversion: bool = Field(default=False, description="ECG T-wave inversion")
    lvh: bool = Field(default=False, description="Left Ventricular Hypertrophy")
    rwma: int = Field(ge=0, le=4, default=0, description="Regional Wall Motion Abnormality score, 0 to 4")
    cardiac_enzymes_elevated: bool = Field(default=False, description="Troponin / CK-MB elevation")


class EcgInput(BaseModel):
    signal: Optional[list[float]] = Field(default=None, description="Single-lead samples (rhythm strip / lead II)")
    sampling_rate: int = 250
    leads: Optional[dict[str, list[float]]] = Field(
        default=None,
        description="Optional multi-lead recording keyed by lead name (I, II, III, aVR, aVL, aVF, V1..V6). "
                    "Enables per-lead ST/T analysis and coronary-territory localisation.")


class PredictRequest(BaseModel):
    features: ClinicalFeatures
    ecg: Optional[EcgInput] = None
    notes: Optional[str] = None
    patient_id: Optional[str] = None


class ShapContribution(BaseModel):
    feature: str
    value: float
    contribution: float


class EcgFindings(BaseModel):
    heart_rate: float
    hrv_rmssd: float
    qrs_ms: float
    st_deviation_mv: float
    abnormality_score: float = Field(ge=0, le=1)
    flags: list[str] = []
    r_peaks: list[int] = []
    # Per-lead measurements (empty for single-lead input, where territory cannot be localised)
    lead_st_mv: dict[str, float] = {}
    lead_t_mv: dict[str, float] = {}
    # 0..1 localised ischaemia evidence per coronary territory (LAD / LCx / RCA / LM)
    territory_scores: dict[str, float] = {}
    abnormal_leads: list[str] = []


class NotesEntities(BaseModel):
    symptoms: list[str] = []
    family_history: list[str] = []
    medications: list[str] = []
    risk_flags: list[str] = []
    summary: str = ""
    # Territorial terms flagged as *affected* (anterior, lateral, inferior, LAD, LCx, RCA, left main ...)
    territories: list[str] = []
    # Proportional per-vessel evidence weight derived from territories (+ quantified % when present)
    vessel_weights: dict[str, float] = {}


class VesselPrediction(BaseModel):
    """Per-artery ML output: the single source the 3D heart renders from."""

    id: VesselId
    name: str
    territory: str
    stenosis_prob: float = Field(ge=0, le=1, description="P(>=50% diameter stenosis) after multimodal fusion")
    stenosis_pct: int = Field(ge=0, le=100, description="Display diameter stenosis, monotone in stenosis_prob (50 == threshold)")
    status: VesselStatus
    ecg_leads: list[str]
    ffr_proxy: float = Field(ge=0, le=1)
    top_shap: Optional[ShapContribution] = None
    derived: bool = Field(default=False, description="True when not a directly trained target (left main)")
    # Logit-space evidence: tabular prob + ecg / notes shifts that produced stenosis_prob
    evidence: dict[str, float] = {}


class PredictResponse(BaseModel):
    cad_status: bool = Field(default=False, description="Overall CAD status: True if risk >= 0.50 or any major vessel >= 50% stenosis")
    risk: float = Field(ge=0, le=1)
    tier: RiskTier
    confidence: float = Field(ge=0, le=1)
    modality_contrib: dict[str, float]
    shap: list[ShapContribution]
    ecg_findings: Optional[EcgFindings] = None
    notes_entities: Optional[NotesEntities] = None
    rationale: str
    source: Literal["live", "mock"]
    vessels: list[VesselPrediction] = []


class SimulateRequest(BaseModel):
    base: PredictRequest
    overrides: dict[str, float | bool | int]


class SimulateResponse(BaseModel):
    baseline: PredictResponse
    modified: PredictResponse
    delta_risk: float
    delta_vessels: dict[str, float] = {}  # per-vessel change in stenosis_prob (modified - baseline)


class PatientRecord(BaseModel):
    id: str
    name: str
    request: PredictRequest
    label: Optional[int] = None
    vessels: list[str] = []  # synthetic angiographic findings: LM / LAD / LCx / RCA
    profile: str = ""


def tier_for(risk: float) -> RiskTier:
    if risk < 0.10:
        return "low"
    if risk < 0.25:
        return "moderate"
    if risk < 0.50:
        return "high"
    return "very_high"
