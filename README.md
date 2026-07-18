# My Voice AI

내 목소리 샘플을 AI 보이스로 복제하고, 원하는 문장을 같은 목소리의 MP3 나레이션으로 만드는 크리에이터용 웹 스튜디오입니다. OpenAI Build Week 제출을 위해 API 키 없이 체험 가능한 interactive mock demo를 제공합니다.

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
