import { randomUUID } from "node:crypto";

const API_BASE = "https://api.minimax.io/v1";

export class AppError extends Error {
  constructor(message, status = 500, details) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.details = details;
  }
}

function requireApiKey(apiKey) {
  if (!apiKey) {
    throw new AppError(
      "MiniMax API 키가 설정되지 않았어요. .env 파일에 MINIMAX_API_KEY를 추가해 주세요.",
      503,
    );
  }
}

export function createVoiceId() {
  const stamp = Date.now().toString(36);
  const random = randomUUID().replaceAll("-", "").slice(0, 10);
  return `MyVoice_${stamp}_${random}`;
}

export function validateSpeechInput({ text, speed, pitch }) {
  if (typeof text !== "string" || text.trim().length === 0) {
    throw new AppError("읽을 문장을 입력해 주세요.", 400);
  }

  if (text.length > 3000) {
    throw new AppError("문장은 3,000자 이내로 입력해 주세요.", 400);
  }

  const parsedSpeed = Number(speed ?? 1);
  const parsedPitch = Number(pitch ?? 0);

  if (!Number.isFinite(parsedSpeed) || parsedSpeed < 0.5 || parsedSpeed > 2) {
    throw new AppError("속도는 0.5에서 2 사이여야 해요.", 400);
  }

  if (!Number.isFinite(parsedPitch) || parsedPitch < -12 || parsedPitch > 12) {
    throw new AppError("음높이는 -12에서 12 사이여야 해요.", 400);
  }

  return { text: text.trim(), speed: parsedSpeed, pitch: parsedPitch };
}

async function parseResponse(response) {
  const rawBody = await response.text();
  // MiniMax file IDs are int64 values and can exceed JavaScript's safe integer range.
  // Quote them before parsing so the exact digits survive the upload → clone handoff.
  const safeBody = rawBody.replace(/("file_id"\s*:\s*)(\d{16,})/g, '$1"$2"');
  const payload = (() => {
    try {
      return JSON.parse(safeBody);
    } catch {
      return null;
    }
  })();
  const providerCode = payload?.base_resp?.status_code;

  if (!response.ok || (providerCode !== undefined && providerCode !== 0)) {
    const providerMessage = payload?.base_resp?.status_msg;
    throw new AppError(
      providerMessage || "MiniMax 요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.",
      response.status >= 400 && response.status < 500 ? 400 : 502,
      payload,
    );
  }

  return payload;
}

export async function cloneVoice({ apiKey, file }) {
  requireApiKey(apiKey);

  const uploadForm = new FormData();
  uploadForm.append("purpose", "voice_clone");
  uploadForm.append("file", new Blob([file.buffer], { type: file.mimetype }), file.originalname);

  const uploadResponse = await fetch(`${API_BASE}/files/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: uploadForm,
  });
  const uploadPayload = await parseResponse(uploadResponse);
  const fileId = uploadPayload?.file?.file_id;

  if (!fileId) {
    throw new AppError("업로드된 음성의 파일 ID를 확인하지 못했어요.", 502);
  }

  const voiceId = createVoiceId();
  const cloneBody = JSON.stringify({
    file_id: "__MINIMAX_FILE_ID__",
    voice_id: voiceId,
    model: "speech-2.8-hd",
    language_boost: "Korean",
    need_noise_reduction: true,
    need_volume_normalization: true,
  }).replace('"__MINIMAX_FILE_ID__"', String(fileId));
  const cloneResponse = await fetch(`${API_BASE}/voice_clone`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: cloneBody,
  });
  await parseResponse(cloneResponse);

  return { voiceId };
}

export async function synthesizeSpeech({ apiKey, voiceId, text, speed, pitch }) {
  requireApiKey(apiKey);

  if (typeof voiceId !== "string" || !/^MyVoice_[A-Za-z0-9_-]+$/.test(voiceId)) {
    throw new AppError("유효한 내 보이스가 필요해요. 먼저 목소리를 만들어 주세요.", 400);
  }

  const input = validateSpeechInput({ text, speed, pitch });
  const response = await fetch(`${API_BASE}/t2a_v2`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "speech-2.8-hd",
      text: input.text,
      stream: false,
      language_boost: "Korean",
      output_format: "hex",
      voice_setting: {
        voice_id: voiceId,
        speed: input.speed,
        vol: 1,
        pitch: input.pitch,
      },
      audio_setting: {
        sample_rate: 32000,
        bitrate: 128000,
        format: "mp3",
        channel: 1,
      },
    }),
  });
  const payload = await parseResponse(response);
  const audioHex = payload?.data?.audio;

  if (typeof audioHex !== "string" || audioHex.length === 0) {
    throw new AppError("생성된 오디오를 받지 못했어요.", 502);
  }

  return {
    audio: Buffer.from(audioHex, "hex"),
    usageCharacters: payload?.extra_info?.usage_characters ?? input.text.length,
  };
}

export async function deleteVoice({ apiKey, voiceId }) {
  requireApiKey(apiKey);

  if (typeof voiceId !== "string" || !/^MyVoice_[A-Za-z0-9_-]+$/.test(voiceId)) {
    throw new AppError("삭제할 보이스 ID가 올바르지 않아요.", 400);
  }

  const response = await fetch(`${API_BASE}/delete_voice`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ voice_type: "voice_cloning", voice_id: voiceId }),
  });
  await parseResponse(response);
}
