# My Voice AI

내 목소리 샘플을 AI 보이스로 복제하고, 원하는 문장을 같은 목소리의 MP3 나레이션으로 만드는 크리에이터용 웹 스튜디오입니다. OpenAI Build Week 제출을 위해 API 키 없이 체험 가능한 interactive mock demo를 제공합니다.

## Built with Codex and GPT-5.6

Codex와 GPT-5.6은 이 프로젝트의 제품 설계와 구현 전반에 사용했습니다. 음성 복제 UX와 동의·삭제 정책을 설계하고, MiniMax 서버 프록시와 브라우저 녹음 흐름을 구현했으며, API 키 없이 심사할 수 있는 interactive mock demo, 테스트, 배포 자산과 Devpost 데모 영상을 만들었습니다.

## 공개 데모

공개 배포에서는 샘플 보이스, 보이스 학습, 문장 생성, 재생과 다운로드까지 전체 UX를 mock으로 체험할 수 있습니다. 실제 음성 파일은 외부로 전송되지 않습니다. 로컬에서 `MINIMAX_API_KEY`를 설정하면 동일한 UI가 실제 MiniMax Voice Clone API를 사용합니다.

## 실행

```bash
npm install
cp .env.example .env
# .env에 MiniMax API 키 입력
npm run api
```

브라우저에서 `http://localhost:3000`을 엽니다.

공개 mock 사이트 개발 서버는 `npm run dev`, 배포 빌드는 `npm run build`를 사용합니다.

## 원격 GPU TTS 서버

`gpu_api/`는 GPU 머신에서 보이스 프로필을 저장하고 음성 모델을 실행하는 FastAPI 서비스입니다. 로컬 웹 서버는 `REMOTE_TTS_URL`이 설정되면 MiniMax 대신 이 서버로 보이스 생성·음성 합성·삭제 요청을 프록시합니다.

```bash
# GPU 서버
cd gpu_api
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# .env에 TTS_API_KEY, VOICE_PROFILE_DIR, TTS_COMMAND_TEMPLATE 설정
set -a && source .env && set +a
uvicorn app.main:app --host 127.0.0.1 --port 8000

# 로컬 개발 머신: 원격 API를 공개하지 않고 SSH 터널로 연결
ssh -N -L 8001:127.0.0.1:8000 your-gpu-host
```

로컬 `.env`에는 아래를 설정한 뒤 `npm run api`를 실행합니다.

```bash
REMOTE_TTS_URL=http://127.0.0.1:8001
REMOTE_TTS_API_KEY=GPU_서버의_TTS_API_KEY와_동일한_값
```

16GB VRAM 기준 기본 경로는 GPT-SoVITS입니다. GPU 서버에서 GPT-SoVITS의 `api_v2.py`를 `127.0.0.1:9880`으로 실행하고, `gpu_api/.env`의 `GPT_SOVITS_URL=http://127.0.0.1:9880`을 설정하세요. voiceme FastAPI가 `/tts`에 한국어 텍스트와 서버 내 reference audio 경로를 전달하고 받은 WAV를 로컬 앱에 반환합니다. GPT-SoVITS API는 reference audio, 텍스트, 언어, 속도, 미디어 타입을 받는 `/tts` 엔드포인트를 제공합니다. [공식 API 구현](https://github.com/RVC-Boss/GPT-SoVITS/blob/main/api_v2.py)

```bash
# GPT-SoVITS checkout on the GPU host
python api_v2.py -a 127.0.0.1 -p 9880
```

다른 엔진을 쓰고 싶으면 `TTS_COMMAND_TEMPLATE`에 실행 스크립트를 넣으면 됩니다. `{reference_audio}`, `{text_file}`, `{output_file}`, `{speed}`, `{pitch}` 플레이스홀더를 지원합니다.

여러 자막을 한 번에 생성할 때는 로컬 서버의 `POST /api/speech/batch`에 아래 형식으로 요청합니다. 응답은 각 자막 오디오와 `manifest.json`이 들어 있는 ZIP입니다.

```json
{
  "voiceId": "voice_1234",
  "subtitles": [
    { "id": "001", "text": "첫 번째 자막", "start_ms": 0, "end_ms": 1800 },
    { "id": "002", "text": "두 번째 자막", "start_ms": 1900, "end_ms": 3600 }
  ],
  "speed": 1,
  "pitch": 0
}
```

## 사용 흐름

1. 조용한 곳에서 10–60초 녹음하거나 mp3/m4a/wav 파일을 선택합니다.
2. 본인 목소리 사용 동의 후 AI 보이스를 만듭니다.
3. 원고, 속도, 높이를 정하고 MP3를 생성합니다.
4. 더 이상 필요하지 않으면 화면에서 생성한 보이스를 삭제합니다.

## 주의

- 타인의 목소리는 반드시 명시적인 허락을 받고 사용하세요.
- 녹음 파일은 보이스 복제를 위해 MiniMax API로 전송됩니다.
- MiniMax 빠른 복제 보이스는 생성 후 7일 안에 TTS로 사용하지 않으면 삭제될 수 있습니다.
- `.env`는 Git에 포함되지 않습니다.
