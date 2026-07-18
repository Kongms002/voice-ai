from __future__ import annotations

import asyncio
import json
import math
import shlex
import wave
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .config import Settings


class EngineConfigurationError(RuntimeError):
    pass


class EngineExecutionError(RuntimeError):
    pass


def _write_demo_wav(output_path: Path, text: str) -> None:
    """Produces a tiny tone only for end-to-end API wiring tests."""
    sample_rate = 24_000
    duration = max(0.4, min(2.0, len(text) / 18))
    total = int(sample_rate * duration)
    with wave.open(str(output_path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(sample_rate)
        frames = bytearray()
        for index in range(total):
            amplitude = int(3_000 * math.sin(2 * math.pi * 220 * index / sample_rate))
            frames.extend(amplitude.to_bytes(2, byteorder="little", signed=True))
        output.writeframes(bytes(frames))


async def synthesize(
    settings: Settings,
    *,
    reference_audio: Path,
    text: str,
    speed: float,
    pitch: float,
    output_path: Path,
) -> str:
    if settings.demo_tts:
        demo_path = output_path.with_suffix(".wav")
        _write_demo_wav(demo_path, text)
        return "audio/wav"

    if settings.gpt_sovits_url:
        payload = {
            "text": text,
            "text_lang": "ko",
            "ref_audio_path": str(reference_audio),
            "aux_ref_audio_paths": [],
            "prompt_lang": "ko",
            "prompt_text": "",
            "text_split_method": "cut5",
            "speed_factor": speed,
            "media_type": "wav",
            "streaming_mode": False,
            "parallel_infer": True,
        }

        def request_tts() -> tuple[bytes, str]:
            request = Request(
                f"{settings.gpt_sovits_url}/tts",
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urlopen(request, timeout=300) as response:  # nosec B310: configured local GPU URL
                return response.read(), response.headers.get_content_type()

        try:
            audio, media_type = await asyncio.to_thread(request_tts)
        except HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")[-1_000:]
            raise EngineExecutionError(detail or f"GPT-SoVITS HTTP {error.code}") from error
        except URLError as error:
            raise EngineConfigurationError(f"GPT-SoVITS API에 연결하지 못했어요: {error.reason}") from error
        if not audio:
            raise EngineExecutionError("GPT-SoVITS가 빈 오디오를 반환했어요.")
        wav_path = output_path.with_suffix(".wav")
        wav_path.write_bytes(audio)
        return media_type or "audio/wav"

    if not settings.command_template:
        raise EngineConfigurationError(
            "GPT_SOVITS_URL 또는 TTS_COMMAND_TEMPLATE가 설정되지 않았어요. 원격 GPU의 음성 모델을 연결해 주세요."
        )

    values = {
        "reference_audio": str(reference_audio),
        "text_file": str(output_path.with_suffix(".txt")),
        "output_file": str(output_path),
        "speed": str(speed),
        "pitch": str(pitch),
    }
    Path(values["text_file"]).write_text(text, encoding="utf-8")
    command = [part.format(**values) for part in shlex.split(settings.command_template)]
    process = await asyncio.create_subprocess_exec(
        *command,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    _stdout, stderr = await process.communicate()
    if process.returncode != 0:
        message = stderr.decode("utf-8", errors="replace").strip()[-1_000:]
        raise EngineExecutionError(message or "원격 TTS 엔진이 실패했어요.")
    if not output_path.is_file() or output_path.stat().st_size == 0:
        raise EngineExecutionError("TTS 엔진이 오디오 파일을 만들지 않았어요.")
    return "audio/mpeg" if output_path.suffix == ".mp3" else "audio/wav"
