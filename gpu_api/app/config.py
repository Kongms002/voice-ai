from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _bool(name: str, default: bool = False) -> bool:
    return os.getenv(name, str(default)).strip().lower() in {"1", "true", "yes"}


@dataclass(frozen=True)
class Settings:
    api_key: str
    profile_dir: Path
    command_template: str
    gpt_sovits_url: str
    output_extension: str
    demo_tts: bool
    max_batch_items: int


def get_settings() -> Settings:
    return Settings(
        api_key=os.getenv("TTS_API_KEY", ""),
        profile_dir=Path(os.getenv("VOICE_PROFILE_DIR", "./data/voices")).resolve(),
        command_template=os.getenv("TTS_COMMAND_TEMPLATE", "").strip(),
        gpt_sovits_url=os.getenv("GPT_SOVITS_URL", "").rstrip("/"),
        output_extension=os.getenv("TTS_OUTPUT_EXTENSION", "mp3").lstrip("."),
        demo_tts=_bool("DEMO_TTS"),
        max_batch_items=int(os.getenv("MAX_BATCH_ITEMS", "120")),
    )
