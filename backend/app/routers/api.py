import json

from fastapi import APIRouter, HTTPException

from ..config import settings
from ..schemas import PatientRecord, PredictRequest, PredictResponse, SimulateRequest, SimulateResponse
from ..services import fusion, tabular

router = APIRouter(prefix="/api")


def _patients() -> list[PatientRecord]:
    path = settings.data_dir / "synthetic" / "patients.json"
    if not path.exists():
        return []
    return [PatientRecord(**p) for p in json.loads(path.read_text())]


@router.get("/health")
def health():
    return {"status": "ok", "demo_mode": settings.demo_mode, "llm": bool(settings.gemini_api_key),
            "model_auc": round(tabular.model_auc(), 3)}


@router.post("/predict", response_model=PredictResponse)
def predict(req: PredictRequest):
    try:
        return fusion.run(req)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"Prediction failed: {exc}") from exc


@router.post("/simulate", response_model=SimulateResponse)
def simulate(req: SimulateRequest):
    base = fusion.run(req.base)
    data = req.base.features.model_dump()
    for k, v in req.overrides.items():
        if k not in data:
            raise HTTPException(422, f"Unknown feature '{k}'")
        data[k] = v
    try:
        mod_req = req.base.model_copy(update={"features": type(req.base.features)(**data)})
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(422, str(exc)) from exc
    mod = fusion.run(mod_req)
    return SimulateResponse(baseline=base, modified=mod, delta_risk=round(mod.risk - base.risk, 4))


@router.get("/patients", response_model=list[PatientRecord])
def patients():
    return _patients()


@router.get("/patients/{pid}", response_model=PatientRecord)
def patient(pid: str):
    for p in _patients():
        if p.id == pid:
            return p
    raise HTTPException(404, "Patient not found")
