from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT / ".env", extra="ignore")

    gemini_api_key: str = ""
    gemini_model: str = "gemini-flash-lite-latest"
    demo_mode: bool = False  # force mock outputs for LLM-dependent stages
    llm_timeout_s: float = 6.0
    data_dir: Path = ROOT / "data"
    model_dir: Path = ROOT / "backend" / "models"
    cors_origins: list[str] = ["http://localhost:3000", "http://127.0.0.1:3000"]


settings = Settings()
