from __future__ import annotations

import json
import shutil
import tempfile
import uuid
import zipfile
from pathlib import Path
from typing import Optional

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

from .config import Settings, get_settings
from .engine import EngineConfigurationError, EngineExecutionError, synthesize

app = FastAPI(title="voiceme-ai GPU API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:3000", "http://localhost:3000"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class SpeechRequest(BaseModel):
    voice_id: str = Field(min_length=1, max_length=80)
    text: str = Field(min_length=1, max_length=3_000)
    speed: float = Field(default=1, ge=0.5, le=2)
    pitch: float = Field(default=0, ge=-12, le=12)


class Subtitle(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    text: str = Field(min_length=1, max_length=3_000)
    start_ms: Optional[int] = Field(default=None, ge=0)
    end_ms: Optional[int] = Field(default=None, ge=0)


class BatchSpeechRequest(BaseModel):
    voice_id: str = Field(min_length=1, max_length=80)
    subtitles: list[Subtitle] = Field(min_length=1)
    speed: float = Field(default=1, ge=0.5, le=2)
    pitch: float = Field(default=0, ge=-12, le=12)


def settings() -> Settings:
    value = get_settings()
    value.profile_dir.mkdir(parents=True, exist_ok=True)
    return value


def authorize(
    authorization: Optional[str] = Header(default=None),
    value: Settings = Depends(settings),
) -> None:
    if value.api_key and authorization != f"Bearer {value.api_key}":
        raise HTTPException(status_code=401, detail="Invalid API token")


def profile_path(value: Settings, voice_id: str) -> Path:
    candidate = value.profile_dir / voice_id
    if not candidate.is_dir() or candidate.parent != value.profile_dir:
        raise HTTPException(status_code=404, detail="Voice profile not found")
    return candidate


def reference_path(profile: Path) -> Path:
    files = [path for path in profile.glob("reference.*") if path.suffix in {".wav", ".mp3", ".m4a"}]
    if len(files) != 1:
        raise HTTPException(status_code=500, detail="Voice profile reference audio is missing")
    return files[0]


async def create_audio(value: Settings, request: SpeechRequest, work_dir: Path) -> tuple[Path, str]:
    profile = profile_path(value, request.voice_id)
    reference_audio = reference_path(profile)
    work_dir.mkdir(parents=True, exist_ok=True)
    output_path = work_dir / f"speech.{value.output_extension}"
    try:
        media_type = await synthesize(
            value,
            reference_audio=reference_audio,
            text=request.text.strip(),
            speed=request.speed,
            pitch=request.pitch,
            output_path=output_path,
        )
    except EngineConfigurationError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except EngineExecutionError as error:
        raise HTTPException(status_code=502, detail=f"TTS 엔진 오류: {error}") from error
    if media_type == "audio/wav":
        output_path = output_path.with_suffix(".wav")
    return output_path, media_type


@app.get("/health")
def health(value: Settings = Depends(settings)) -> dict[str, object]:
    return {
        "ready": bool(value.gpt_sovits_url or value.command_template or value.demo_tts),
        "mode": "demo" if value.demo_tts else "gpt-sovits" if value.gpt_sovits_url else "gpu",
        "batch_limit": value.max_batch_items,
    }


@app.post("/v1/voices", dependencies=[Depends(authorize)])
async def create_voice(
    voice: UploadFile = File(...),
    consent: bool = Form(...),
    value: Settings = Depends(settings),
) -> dict[str, str]:
    if not consent:
        raise HTTPException(status_code=400, detail="본인 목소리 사용 동의가 필요해요.")
    if voice.content_type not in {"audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp4", "audio/x-m4a"}:
        raise HTTPException(status_code=400, detail="wav, mp3, m4a 파일만 지원해요.")
    voice_id = f"voice_{uuid.uuid4().hex[:16]}"
    profile = value.profile_dir / voice_id
    profile.mkdir()
    extension = {
        "audio/wav": ".wav",
        "audio/x-wav": ".wav",
        "audio/mpeg": ".mp3",
        "audio/mp4": ".m4a",
        "audio/x-m4a": ".m4a",
    }[voice.content_type]
    reference_audio = profile / f"reference{extension}"
    with reference_audio.open("wb") as destination:
        shutil.copyfileobj(voice.file, destination)
    (profile / "metadata.json").write_text(
        json.dumps({"source_name": voice.filename, "content_type": voice.content_type}, ensure_ascii=False),
        encoding="utf-8",
    )
    return {"voiceId": voice_id}


@app.post("/v1/speech", dependencies=[Depends(authorize)])
async def speech(request: SpeechRequest, value: Settings = Depends(settings)) -> Response:
    temporary = Path(tempfile.mkdtemp(prefix="voiceme-speech-"))
    output, media_type = await create_audio(value, request, temporary)
    payload = output.read_bytes()
    shutil.rmtree(temporary, ignore_errors=True)
    extension = "mp3" if media_type == "audio/mpeg" else "wav"
    return Response(payload, media_type=media_type, headers={"Content-Disposition": f'inline; filename="speech.{extension}"'})


@app.post("/v1/speech/batch", dependencies=[Depends(authorize)])
async def batch_speech(request: BatchSpeechRequest, value: Settings = Depends(settings)) -> Response:
    if len(request.subtitles) > value.max_batch_items:
        raise HTTPException(status_code=400, detail=f"자막은 최대 {value.max_batch_items}개까지 가능해요.")
    temporary = Path(tempfile.mkdtemp(prefix="voiceme-batch-"))
    try:
        manifest: list[dict[str, object]] = []
        archive_path = temporary / "voiceover.zip"
        with zipfile.ZipFile(archive_path, "w", zipfile.ZIP_DEFLATED) as archive:
            for index, subtitle in enumerate(request.subtitles, start=1):
                output, media_type = await create_audio(
                    value,
                    SpeechRequest(voice_id=request.voice_id, text=subtitle.text, speed=request.speed, pitch=request.pitch),
                    temporary / f"item-{index}",
                )
                filename = f"{index:03d}_{subtitle.id}.{output.suffix.lstrip('.')}"
                archive.write(output, filename)
                manifest.append({"id": subtitle.id, "file": filename, "start_ms": subtitle.start_ms, "end_ms": subtitle.end_ms, "media_type": media_type})
            archive.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
        payload = archive_path.read_bytes()
    finally:
        shutil.rmtree(temporary, ignore_errors=True)
    return Response(payload, media_type="application/zip", headers={"Content-Disposition": 'attachment; filename="voiceover.zip"'})


@app.delete("/v1/voices/{voice_id}", status_code=204, dependencies=[Depends(authorize)])
def delete_voice(voice_id: str, value: Settings = Depends(settings)) -> Response:
    profile = profile_path(value, voice_id)
    shutil.rmtree(profile)
    return Response(status_code=204)
