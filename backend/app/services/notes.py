"""Clinical notes -> structured entities. Gemini when available, deterministic regex fallback otherwise."""
from __future__ import annotations

import json
import re
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutTimeout

from ..config import settings
from ..schemas import NotesEntities

_SYMPTOMS = {"chest tightness": r"chest (tightness|pain|discomfort)", "dyspnea": r"short(ness)? of breath|dyspnea",
             "radiating pain": r"radiat", "exertional symptoms": r"exertion|stairs|exercise"}
_MEDS = ["metformin", "amlodipine", "atorvastatin", "aspirin", "lisinopril", "metoprolol"]


def _rule_based(text: str) -> NotesEntities:
    t = text.lower()
    neg_cp = "denies chest pain" in t
    symptoms = [k for k, rx in _SYMPTOMS.items() if re.search(rx, t) and not (neg_cp and k == "chest tightness")]
    fam = re.findall(r"(father|mother|brother|sister)[^.]*?(infarction|heart|stroke|cardiac)[^.]*", t)
    family = [f"{a} - {b}" for a, b in fam]
    meds = [m for m in _MEDS if m in t]
    flags = []
    if "smoker" in t and "former" not in t: flags.append("Current smoker")
    if "diabet" in t: flags.append("Diabetes")
    if family: flags.append("Premature family CVD history")
    if "hypertens" in t: flags.append("Hypertension")
    if "exertional" in " ".join(symptoms): flags.append("Exertional symptoms")
    return NotesEntities(symptoms=symptoms, family_history=family, medications=meds, risk_flags=flags,
                         summary=text[:160])


def _gemini(text: str) -> NotesEntities:
    from google import genai

    client = genai.Client(api_key=settings.gemini_api_key)
    prompt = ("Extract from this clinical note JSON with keys symptoms[], family_history[], medications[], "
              "risk_flags[], summary (<=25 words). Only JSON.\n\n" + text)
    r = client.models.generate_content(model=settings.gemini_model, contents=prompt,
                                       config={"response_mime_type": "application/json"})
    return NotesEntities(**json.loads(r.text))


def extract(text: str) -> tuple[NotesEntities, str]:
    """Returns (entities, source) where source is 'live' or 'mock'."""
    if settings.gemini_api_key and not settings.demo_mode:
        try:
            with ThreadPoolExecutor(max_workers=1) as ex:
                return ex.submit(_gemini, text).result(timeout=settings.llm_timeout_s), "live"
        except (FutTimeout, Exception):  # noqa: BLE001
            pass
    return _rule_based(text), "mock"
