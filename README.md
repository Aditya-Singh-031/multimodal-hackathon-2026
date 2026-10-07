# CardioFusion — Multimodal Cardiovascular Risk Visualization & Prediction

**Multimodal AI Hackathon 2026 · Track A**

CardioFusion fuses three modalities into one calibrated, explainable cardiovascular risk score:

| Modality | Source | Processing |
|---|---|---|
| Clinical data | UCI Heart / synthetic cohort | XGBoost + isotonic calibration, SHAP explanations |
| ECG signal | PTB-XL samples / synthetic | Band-pass filter, R-peak, HRV, QRS, ST-deviation features |
| Clinical notes | Synthetic notes | Gemini structured extraction, with a rule-based fallback |

Fusion is late and logit-space; the dashboard shows a per-modality contribution breakdown, a 3D heart, SHAP bars, an ECG viewer and a **what-if simulator**.

## Architecture
```
frontend (Next.js, Tailwind, R3F, Framer Motion)  ──HTTP──>  backend (FastAPI)
   │  offline mock model if backend is down                    ├─ services/tabular.py  (XGBoost+SHAP)
   └─ lib/mock.ts                                              ├─ services/ecg.py
                                                               ├─ services/notes.py    (Gemini | regex)
                                                               └─ services/fusion.py
data/ raw (UCI, PTB-XL samples) + synthetic (cohort, ECG, notes)
```

## Run it
```powershell
# Backend (Python 3.11)
cd backend
python -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
.\.venv\Scripts\python scripts\download_data.py     # optional real data, safe to fail
.\.venv\Scripts\python scripts\make_synthetic.py    # required for demo patients
.\.venv\Scripts\python -m uvicorn app.main:app --port 8000

# Frontend
cd frontend
npm install
npm run dev        # http://localhost:3000
```
Optional `.env` at repo root: `GEMINI_API_KEY=...`, `DEMO_MODE=true` (forces rule-based notes).

## Reliability / fallbacks
- No Gemini key, timeout (6s) or error → deterministic rule-based note extraction (UI badge shows it).
- Backend unreachable → frontend switches to a built-in offline model and shows an "Offline demo model" badge.
- Too-short or noisy ECG → prediction continues with the ECG modality dropped.
- Loading skeletons, error + retry banner and empty states on every view.

## Tests
```powershell
cd backend; .\.venv\Scripts\python -m pytest -q tests          # 7 API tests
cd frontend; node scripts\screenshot.mjs                        # visual smoke test (needs Edge/Chromium)
```

## Demo script (3 min)
1. Open the dashboard: the highest-risk patient loads, with its gauge and 3D heart.
2. Point at the modality contribution bars: clinical, ECG and notes each add evidence.
3. SHAP: why this patient is high-risk (diabetes, age, smoking).
4. ECG viewer: R-peaks and highlighted ST-depression segments.
5. What-if: toggle Smoker/Diabetic, drag BP and watch risk change live.
6. Switch to a low-risk patient to show contrast; kill the backend to show the offline fallback.

## Model Benchmarks & Metrics
- **Real UCI Cleveland Heart Dataset (5-fold Stratified CV out-of-fold)**:
  - **ROC-AUC**: `0.8567`
  - **PR-AUC**: `0.8129`
  - **Brier Score**: `0.1546`
  - **Accuracy**: `76.90%` | **Precision**: `75.18%` | **Recall**: `74.10%`
  - See full evaluation details in [docs/metrics.json](docs/metrics.json).
- **Synthetic Multimodal Cohort**: 1,500 synthetic patient records calibrated across 4 distinct risk tiers with late-fusion multi-modal contributions.

## Limitations
This is a clinical decision-support and visualization research prototype for the hackathon, **not an FDA-cleared medical device**. Real clinical deployments require multi-center prospective validation and institutional review.