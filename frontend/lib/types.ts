export type Tier = "low" | "moderate" | "high" | "very_high";

export interface Features {
  age: number;
  sex: "M" | "F";
  systolic_bp: number;
  cholesterol: number;
  smoker: boolean;
  diabetic: boolean;
  bmi: number;
  resting_hr: number;
  chest_pain_type: number;
  exercise_angina: boolean;
}
export interface PredictRequest {
  features: Features;
  ecg?: { signal: number[]; sampling_rate: number } | null;
  notes?: string | null;
  patient_id?: string | null;
}
export interface Patient {
  id: string;
  name: string;
  request: PredictRequest;
  label?: number | null;
  vessels?: string[];
  profile?: string;
}
export interface Shap { feature: string; value: number; contribution: number }
export interface EcgFindings {
  heart_rate: number; hrv_rmssd: number; qrs_ms: number; st_deviation_mv: number;
  abnormality_score: number; flags: string[]; r_peaks: number[];
}
export interface NotesEntities {
  symptoms: string[]; family_history: string[]; medications: string[]; risk_flags: string[]; summary: string;
}
export interface Prediction {
  risk: number; tier: Tier; confidence: number;
  modality_contrib: Record<string, number>;
  shap: Shap[]; ecg_findings?: EcgFindings | null; notes_entities?: NotesEntities | null;
  rationale: string; source: "live" | "mock";
}
export interface Simulation { baseline: Prediction; modified: Prediction; delta_risk: number }

export const TIER_COLOR: Record<Tier, string> = {
  low: "#34d399", moderate: "#fbbf24", high: "#fb923c", very_high: "#f43f5e",
};
export const TIER_LABEL: Record<Tier, string> = {
  low: "Low", moderate: "Moderate", high: "High", very_high: "Very high",
};
