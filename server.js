import "dotenv/config";
import express from "express";
import multer from "multer";
import { AppError, cloneVoice, deleteVoice, synthesizeSpeech } from "./lib/minimax.js";
import { remoteBatchSpeech, remoteCloneVoice, remoteDeleteVoice, remoteSynthesizeSpeech } from "./lib/remote-tts.js";

const app = express();
const port = Number(process.env.PORT || 3000);
const apiKey = process.env.MINIMAX_API_KEY;
const remoteTtsUrl = process.env.REMOTE_TTS_URL?.replace(/\/$/, "");
const remoteTtsApiKey = process.env.REMOTE_TTS_API_KEY;
const allowedMimeTypes = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/x-m4a",
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  fileFilter: (_request, file, callback) => {
    if (!allowedMimeTypes.has(file.mimetype)) {
      callback(new AppError("mp3, m4a, wav 파일만 사용할 수 있어요.", 400));
      return;
    }
    callback(null, true);
  },
});

app.disable("x-powered-by");
app.use(express.json({ limit: "512kb" }));
app.use(express.static("public", { extensions: ["html"] }));

app.get("/api/health", (_request, response) => {
  response.json({ ready: Boolean(remoteTtsUrl || apiKey), mode: remoteTtsUrl ? "remote-gpu" : apiKey ? "minimax" : "demo" });
});

app.post("/api/voices/clone", upload.single("voice"), async (request, response, next) => {
  try {
    if (request.body.consent !== "true") {
      throw new AppError("본인 목소리 사용 동의가 필요해요.", 400);
    }
    if (!request.file) {
      throw new AppError("목소리 파일을 녹음하거나 선택해 주세요.", 400);
    }

    const result = remoteTtsUrl
      ? await remoteCloneVoice({ baseUrl: remoteTtsUrl, apiKey: remoteTtsApiKey, file: request.file })
      : await cloneVoice({ apiKey, file: request.file });
    response.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

app.post("/api/speech", async (request, response, next) => {
  try {
    const result = remoteTtsUrl
      ? await remoteSynthesizeSpeech({ baseUrl: remoteTtsUrl, apiKey: remoteTtsApiKey, ...request.body })
      : await synthesizeSpeech({ apiKey, ...request.body });
    response.set({
      "Content-Type": result.contentType || "audio/mpeg",
      "Content-Length": result.audio.length,
      "X-Usage-Characters": result.usageCharacters,
      "Cache-Control": "no-store",
    });
    response.send(result.audio);
  } catch (error) {
    next(error);
  }
});

app.post("/api/speech/batch", async (request, response, next) => {
  try {
    if (!remoteTtsUrl) {
      throw new AppError("자막 배치 생성은 REMOTE_TTS_URL이 설정된 GPU 서버에서만 사용할 수 있어요.", 503);
    }
    const { voiceId, subtitles, speed, pitch } = request.body;
    if (!Array.isArray(subtitles) || subtitles.length === 0) {
      throw new AppError("생성할 자막 목록이 필요해요.", 400);
    }
    const archive = await remoteBatchSpeech({ baseUrl: remoteTtsUrl, apiKey: remoteTtsApiKey, voiceId, subtitles, speed, pitch });
    response.set({
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="voiceover.zip"',
      "Content-Length": archive.length,
      "Cache-Control": "no-store",
    });
    response.send(archive);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/voices/:voiceId", async (request, response, next) => {
  try {
    if (remoteTtsUrl) await remoteDeleteVoice({ baseUrl: remoteTtsUrl, apiKey: remoteTtsApiKey, voiceId: request.params.voiceId });
    else await deleteVoice({ apiKey, voiceId: request.params.voiceId });
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.use((error, _request, response, _next) => {
  const isUploadLimit = error?.code === "LIMIT_FILE_SIZE";
  const status = isUploadLimit ? 400 : error instanceof AppError ? error.status : 500;
  const message = isUploadLimit
    ? "목소리 파일은 20MB 이하여야 해요."
    : error instanceof AppError
      ? error.message
      : "예상하지 못한 오류가 발생했어요.";

  if (status >= 500) console.error(error);
  response.status(status).json({ error: message });
});

app.listen(port, () => {
  console.log(`My Voice AI is running at http://localhost:${port}`);
  if (!apiKey) console.log("MINIMAX_API_KEY is not configured yet.");
});
