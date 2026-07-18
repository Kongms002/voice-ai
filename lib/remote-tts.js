import { AppError } from "./minimax.js";

function remoteHeaders(apiKey, headers = {}) {
  return {
    ...headers,
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };
}

async function remoteResponse(response) {
  if (response.ok) return response;
  const payload = await response.json().catch(() => null);
  throw new AppError(payload?.detail || "원격 GPU TTS 서버 요청에 실패했어요.", response.status >= 400 && response.status < 500 ? response.status : 502);
}

export async function remoteCloneVoice({ baseUrl, apiKey, file }) {
  const form = new FormData();
  form.append("voice", new Blob([file.buffer], { type: file.mimetype }), file.originalname);
  form.append("consent", "true");
  const response = await fetch(`${baseUrl}/v1/voices`, {
    method: "POST",
    headers: remoteHeaders(apiKey),
    body: form,
  });
  return (await remoteResponse(response)).json();
}

export async function remoteSynthesizeSpeech({ baseUrl, apiKey, voiceId, text, speed, pitch }) {
  const response = await fetch(`${baseUrl}/v1/speech`, {
    method: "POST",
    headers: remoteHeaders(apiKey, { "Content-Type": "application/json" }),
    body: JSON.stringify({ voice_id: voiceId, text, speed: Number(speed), pitch: Number(pitch) }),
  });
  const ready = await remoteResponse(response);
  return {
    audio: Buffer.from(await ready.arrayBuffer()),
    contentType: ready.headers.get("content-type") || "audio/mpeg",
  };
}

export async function remoteDeleteVoice({ baseUrl, apiKey, voiceId }) {
  const response = await fetch(`${baseUrl}/v1/voices/${encodeURIComponent(voiceId)}`, {
    method: "DELETE",
    headers: remoteHeaders(apiKey),
  });
  await remoteResponse(response);
}

export async function remoteBatchSpeech({ baseUrl, apiKey, voiceId, subtitles, speed, pitch }) {
  const response = await fetch(`${baseUrl}/v1/speech/batch`, {
    method: "POST",
    headers: remoteHeaders(apiKey, { "Content-Type": "application/json" }),
    body: JSON.stringify({ voice_id: voiceId, subtitles, speed: Number(speed), pitch: Number(pitch) }),
  });
  const ready = await remoteResponse(response);
  return Buffer.from(await ready.arrayBuffer());
}
