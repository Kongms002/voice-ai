import test from "node:test";
import assert from "node:assert/strict";
import {
  AppError,
  cloneVoice,
  createVoiceId,
  synthesizeSpeech,
  validateSpeechInput,
} from "../lib/minimax.js";

test("voice ids satisfy MiniMax custom id rules", () => {
  const id = createVoiceId();
  assert.match(id, /^[A-Za-z][A-Za-z0-9_-]{7,255}$/);
  assert.doesNotMatch(id, /[-_]$/);
});

test("speech input is normalized", () => {
  assert.deepEqual(validateSpeechInput({ text: "  안녕하세요  ", speed: "1.2", pitch: "-2" }), {
    text: "안녕하세요",
    speed: 1.2,
    pitch: -2,
  });
});

test("speech input rejects unsafe bounds", () => {
  assert.throws(
    () => validateSpeechInput({ text: "안녕", speed: 9, pitch: 0 }),
    (error) => error instanceof AppError && error.status === 400,
  );
  assert.throws(
    () => validateSpeechInput({ text: " ", speed: 1, pitch: 0 }),
    (error) => error instanceof AppError && error.status === 400,
  );
});

test("voice clone preserves an int64 file id exactly", async (context) => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  context.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith("/files/upload")) {
      return new Response('{"file":{"file_id":123456789012345678},"base_resp":{"status_code":0,"status_msg":"success"}}');
    }
    return new Response('{"base_resp":{"status_code":0,"status_msg":"success"}}');
  };

  const result = await cloneVoice({
    apiKey: "test-key",
    file: { buffer: Buffer.from("wav"), mimetype: "audio/wav", originalname: "voice.wav" },
  });

  assert.match(result.voiceId, /^MyVoice_/);
  assert.match(requests[1].options.body, /"file_id":123456789012345678/);
});

test("speech synthesis returns decoded MP3 bytes", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response(JSON.stringify({
    data: { audio: "494433", status: 2 },
    extra_info: { usage_characters: 2 },
    base_resp: { status_code: 0, status_msg: "success" },
  }));

  const result = await synthesizeSpeech({
    apiKey: "test-key",
    voiceId: "MyVoice_12345678",
    text: "안녕",
    speed: 1,
    pitch: 0,
  });

  assert.deepEqual(result.audio, Buffer.from("ID3"));
  assert.equal(result.usageCharacters, 2);
});
