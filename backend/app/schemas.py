"""Pydantic contracts shared by all services and routers."""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

RiskTier = Literal["low", "moderate", "high", "very_high"]


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


class EcgInput(BaseModel):
    signal: Optional[list[float]] = Field(default=None, description="Single-lead samples")
    sampling_rate: int = 250


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


class NotesEntities(BaseModel):
    symptoms: list[str] = []
    family_history: list[str] = []
    medications: list[str] = []
    risk_flags: list[str] = []
    summary: str = ""


class PredictResponse(BaseModel):
    risk: float = Field(ge=0, le=1)
    tier: RiskTier
    confidence: float = Field(ge=0, le=1)
    modality_contrib: dict[str, float]
    shap: list[ShapContribution]
    ecg_findings: Optional[EcgFindings] = None
    notes_entities: Optional[NotesEntities] = None
    rationale: str
    source: Literal["live", "mock"]


class SimulateRequest(BaseModel):
    base: PredictRequest
    overrides: dict[str, float | bool | int]


class SimulateResponse(BaseModel):
    baseline: PredictResponse
    modified: PredictResponse
    delta_risk: float


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
