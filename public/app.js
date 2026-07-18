const $ = (selector) => document.querySelector(selector);

const elements = {
  setupNotice: $("#setupNotice"),
  recorder: $("#recorder"),
  recordButton: $("#recordButton"),
  recordLabel: $("#recordLabel"),
  recordHint: $("#recordHint"),
  recordTimer: $("#recordTimer"),
  voiceFile: $("#voiceFile"),
  samplePreview: $("#samplePreview"),
  sampleAudio: $("#sampleAudio"),
  clearSampleButton: $("#clearSampleButton"),
  sampleState: $("#sampleState"),
  consent: $("#consent"),
  cloneButton: $("#cloneButton"),
  voiceState: $("#voiceState"),
  voiceReady: $("#voiceReady"),
  voiceIdLabel: $("#voiceIdLabel"),
  deleteVoiceButton: $("#deleteVoiceButton"),
  scriptText: $("#scriptText"),
  characterCount: $("#characterCount"),
  speed: $("#speed"),
  speedOutput: $("#speedOutput"),
  pitch: $("#pitch"),
  pitchOutput: $("#pitchOutput"),
  generateButton: $("#generateButton"),
  resultEmpty: $("#resultEmpty"),
  resultPlayer: $("#resultPlayer"),
  resultAudio: $("#resultAudio"),
  downloadButton: $("#downloadButton"),
  toast: $("#toast"),
};

let voiceFile = null;
let voiceId = sessionStorage.getItem("myVoiceId");
let audioContext = null;
let mediaStream = null;
let mediaSource = null;
let recorderNode = null;
let silentGain = null;
let chunks = [];
let sampleRate = 48000;
let recordingStartedAt = 0;
let timerId = null;
let sampleUrl = null;
let resultUrl = null;
let toastId = null;

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  clearTimeout(toastId);
  toastId = setTimeout(() => elements.toast.classList.remove("show"), 3600);
}

function setBusy(button, busy, label) {
  if (busy) {
    button.dataset.label = button.querySelector("span").textContent;
    button.querySelector("span").textContent = label;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    return;
  }
  button.querySelector("span").textContent = button.dataset.label;
  button.removeAttribute("aria-busy");
  updateControls();
}

function updateControls() {
  elements.cloneButton.disabled = !(voiceFile && elements.consent.checked);
  const ready = Boolean(voiceId);
  elements.scriptText.disabled = !ready;
  elements.speed.disabled = !ready;
  elements.pitch.disabled = !ready;
  elements.generateButton.disabled = !ready || elements.scriptText.value.trim().length === 0;
}

function formatTime(seconds) {
  const rounded = Math.floor(seconds);
  return `${String(Math.floor(rounded / 60)).padStart(2, "0")}:${String(rounded % 60).padStart(2, "0")}`;
}

function releaseUrl(url) {
  if (url) URL.revokeObjectURL(url);
}

function setSample(file, duration) {
  releaseUrl(sampleUrl);
  voiceFile = file;
  sampleUrl = URL.createObjectURL(file);
  elements.sampleAudio.src = sampleUrl;
  elements.samplePreview.classList.remove("hidden");
  elements.recordLabel.textContent = file.name;
  elements.recordHint.textContent = duration ? `${duration.toFixed(1)}초 녹음` : "음성 파일 선택됨";
  elements.sampleState.textContent = "샘플 준비";
  elements.sampleState.classList.add("active");
  updateControls();
}

function clearSample() {
  releaseUrl(sampleUrl);
  sampleUrl = null;
  voiceFile = null;
  elements.voiceFile.value = "";
  elements.sampleAudio.removeAttribute("src");
  elements.samplePreview.classList.add("hidden");
  elements.recordLabel.textContent = "눌러서 녹음하기";
  elements.recordHint.textContent = "최소 10초 · 최대 60초";
  elements.recordTimer.textContent = "00:00";
  elements.sampleState.textContent = "대기 중";
  elements.sampleState.classList.remove("active");
  updateControls();
}

function mergeChunks(parts) {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const merged = new Float32Array(length);
  let offset = 0;
  for (const part of parts) {
    merged.set(part, offset);
    offset += part.length;
  }
  return merged;
}

function encodeWav(samples, rate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeText = (offset, value) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  };

  writeText(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

async function startRecording() {
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    audioContext = new AudioContext();
    sampleRate = audioContext.sampleRate;
    chunks = [];
    mediaSource = audioContext.createMediaStreamSource(mediaStream);
    recorderNode = audioContext.createScriptProcessor(4096, 1, 1);
    silentGain = audioContext.createGain();
    silentGain.gain.value = 0;
    recorderNode.onaudioprocess = (event) => chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
    mediaSource.connect(recorderNode);
    recorderNode.connect(silentGain);
    silentGain.connect(audioContext.destination);
    recordingStartedAt = Date.now();
    elements.recorder.classList.add("recording");
    elements.recordButton.setAttribute("aria-label", "녹음 중지");
    elements.recordLabel.textContent = "목소리를 듣고 있어요";
    elements.recordHint.textContent = "다 읽으면 정지 버튼을 눌러주세요";
    timerId = setInterval(() => {
      const elapsed = (Date.now() - recordingStartedAt) / 1000;
      elements.recordTimer.textContent = formatTime(elapsed);
      if (elapsed >= 60) stopRecording();
    }, 200);
  } catch (error) {
    showToast(error?.name === "NotAllowedError" ? "마이크 사용을 허용해 주세요." : "마이크를 시작하지 못했어요.");
  }
}

async function stopRecording() {
  const duration = (Date.now() - recordingStartedAt) / 1000;
  clearInterval(timerId);
  recorderNode?.disconnect();
  mediaSource?.disconnect();
  silentGain?.disconnect();
  mediaStream?.getTracks().forEach((track) => track.stop());
  await audioContext?.close();
  audioContext = null;
  elements.recorder.classList.remove("recording");
  elements.recordButton.setAttribute("aria-label", "녹음 시작");

  if (duration < 10) {
    chunks = [];
    elements.recordLabel.textContent = "조금 더 길게 녹음해 주세요";
    elements.recordHint.textContent = "좋은 복제를 위해 최소 10초가 필요해요";
    showToast("녹음은 최소 10초 이상이어야 해요.");
    return;
  }

  const blob = encodeWav(mergeChunks(chunks), sampleRate);
  setSample(new File([blob], `my-voice-${Date.now()}.wav`, { type: "audio/wav" }), duration);
  chunks = [];
}

function setVoiceReady(id) {
  voiceId = id;
  sessionStorage.setItem("myVoiceId", id);
  elements.voiceIdLabel.textContent = id;
  elements.voiceReady.classList.remove("hidden");
  elements.voiceState.textContent = "준비 완료";
  elements.voiceState.classList.add("active");
  updateControls();
}

async function getError(response) {
  const payload = await response.json().catch(() => null);
  return payload?.error || "요청을 처리하지 못했어요.";
}

elements.recordButton.addEventListener("click", () => {
  if (audioContext) stopRecording();
  else startRecording();
});

elements.voiceFile.addEventListener("change", () => {
  const file = elements.voiceFile.files?.[0];
  if (!file) return;
  if (file.size > 20 * 1024 * 1024) {
    showToast("음성 파일은 20MB 이하여야 해요.");
    clearSample();
    return;
  }
  setSample(file);
});

elements.clearSampleButton.addEventListener("click", clearSample);
elements.consent.addEventListener("change", updateControls);

elements.cloneButton.addEventListener("click", async () => {
  if (!voiceFile) return;
  setBusy(elements.cloneButton, true, "목소리를 배우는 중…");
  const form = new FormData();
  form.append("voice", voiceFile);
  form.append("consent", String(elements.consent.checked));
  try {
    const response = await fetch("/api/voices/clone", { method: "POST", body: form });
    if (!response.ok) throw new Error(await getError(response));
    const payload = await response.json();
    setVoiceReady(payload.voiceId);
    showToast("내 AI 보이스가 준비됐어요!");
    $("#scriptCard").scrollIntoView({ behavior: "smooth", block: "center" });
  } catch (error) {
    showToast(error.message);
  } finally {
    setBusy(elements.cloneButton, false);
  }
});

elements.scriptText.addEventListener("input", () => {
  elements.characterCount.textContent = elements.scriptText.value.length.toLocaleString("ko-KR");
  updateControls();
});
elements.speed.addEventListener("input", () => { elements.speedOutput.textContent = `${Number(elements.speed.value).toFixed(1)}×`; });
elements.pitch.addEventListener("input", () => { elements.pitchOutput.textContent = Number(elements.pitch.value) > 0 ? `+${elements.pitch.value}` : elements.pitch.value; });

elements.generateButton.addEventListener("click", async () => {
  setBusy(elements.generateButton, true, "나레이션 만드는 중…");
  try {
    const response = await fetch("/api/speech", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voiceId, text: elements.scriptText.value, speed: elements.speed.value, pitch: elements.pitch.value }),
    });
    if (!response.ok) throw new Error(await getError(response));
    releaseUrl(resultUrl);
    resultUrl = URL.createObjectURL(await response.blob());
    elements.resultAudio.src = resultUrl;
    elements.downloadButton.href = resultUrl;
    elements.resultEmpty.classList.add("hidden");
    elements.resultPlayer.classList.remove("hidden");
    showToast("나레이션이 완성됐어요.");
    $("#resultCard").scrollIntoView({ behavior: "smooth", block: "center" });
  } catch (error) {
    showToast(error.message);
  } finally {
    setBusy(elements.generateButton, false);
  }
});

elements.deleteVoiceButton.addEventListener("click", async () => {
  try {
    const response = await fetch(`/api/voices/${encodeURIComponent(voiceId)}`, { method: "DELETE" });
    if (!response.ok) throw new Error(await getError(response));
    voiceId = null;
    sessionStorage.removeItem("myVoiceId");
    elements.voiceReady.classList.add("hidden");
    elements.voiceState.textContent = "보이스 필요";
    elements.voiceState.classList.remove("active");
    releaseUrl(resultUrl);
    resultUrl = null;
    elements.resultPlayer.classList.add("hidden");
    elements.resultEmpty.classList.remove("hidden");
    updateControls();
    showToast("생성한 보이스를 삭제했어요.");
  } catch (error) {
    showToast(error.message);
  }
});

async function initialize() {
  elements.characterCount.textContent = elements.scriptText.value.length.toLocaleString("ko-KR");
  if (voiceId) setVoiceReady(voiceId);
  updateControls();
  try {
    const response = await fetch("/api/health");
    const health = await response.json();
    elements.setupNotice.classList.toggle("hidden", health.ready);
  } catch {
    elements.setupNotice.classList.remove("hidden");
  }
}

initialize();
