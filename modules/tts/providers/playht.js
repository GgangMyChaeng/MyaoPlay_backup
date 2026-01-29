/**
 * PlayHT TTS Provider
 * - 엔드포인트: api.play.ht
 * - 감정 표현 뛰어남, Play3.0-mini / PlayDialog 모델
 * - 출력: binary audio stream (mp3)
 */

import { getRequestHeaders } from "../../deps.js";

const PLAYHT_ENDPOINT = "https://api.play.ht/api/v2/tts/stream";

// PlayHT 프리빌트 보이스 (일부 주요 보이스)
// voice 값은 PlayHT의 voice manifest URL 또는 프리셋 이름
export const PLAYHT_VOICES = [
  { id: "s3://voice-cloning-zero-shot/775ae416-49bb-4fb6-bd45-740f205d20a1/jennifersaad/manifest.json", name: "Jennifer (여성, 자연스러움)", lang: "en" },
  { id: "s3://voice-cloning-zero-shot/d9ff78ba-d016-47f6-b0ef-dd630f59414e/female-cs/manifest.json", name: "Female CS (여성, 고객센터)", lang: "en" },
  { id: "s3://voice-cloning-zero-shot/e040bd1b-f190-4bdb-83f0-75ef85b18f84/original/manifest.json", name: "Matthew (남성, 친절)", lang: "en" },
  // Play3.0-mini용 간단한 보이스 ID
  { id: "Angelo-PlayAI",  name: "Angelo (남성)",    lang: "multi" },
  { id: "Arsenio-PlayAI", name: "Arsenio (남성)",   lang: "multi" },
  { id: "Atlas-PlayAI",   name: "Atlas (남성)",     lang: "multi" },
  { id: "Briggs-PlayAI",  name: "Briggs (남성)",    lang: "multi" },
  { id: "Deedee-PlayAI",  name: "Deedee (여성)",    lang: "multi" },
  { id: "Fritz-PlayAI",   name: "Fritz (남성)",     lang: "multi" },
  { id: "Gigi-PlayAI",    name: "Gigi (여성)",      lang: "multi" },
  { id: "Inara-PlayAI",   name: "Inara (여성)",     lang: "multi" },
];

/**
 * PlayHT TTS API 호출
 * @param {string} text - 읽을 텍스트
 * @param {object} providerSettings - { apiKey, userId, voice, voiceEngine }
 * @returns {Promise<string>} - blob URL
 */
export async function getAudioUrl(text, providerSettings = {}) {
  const { apiKey, userId, voice, voiceEngine } = providerSettings;
  if (!apiKey) throw new Error("PlayHT API Key가 없습니다.");
  if (!userId) throw new Error("PlayHT User ID가 없습니다.");

  const bodyData = {
    text,
    voice: voice || "s3://voice-cloning-zero-shot/775ae416-49bb-4fb6-bd45-740f205d20a1/jennifersaad/manifest.json",
    voice_engine: voiceEngine || "Play3.0-mini",
    output_format: "mp3",
  };

  console.log("[MyaPl][PlayHT] TTS request:", {
    textLength: text.length,
    voice: bodyData.voice.substring(0, 50) + "...",
    engine: bodyData.voice_engine,
  });

  // 프록시 후보
  const proxyCandidates = [
    `/proxy/${PLAYHT_ENDPOINT}`,
    `/proxy?url=${encodeURIComponent(PLAYHT_ENDPOINT)}`,
  ];

  let lastError;
  for (const url of proxyCandidates) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": apiKey,
          "X-USER-ID": userId,
          "Accept": "audio/mpeg",
          "X-Requested-With": "XMLHttpRequest",
          ...(getRequestHeaders?.() || {}),
        },
        body: JSON.stringify(bodyData),
        credentials: "same-origin",
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("[MyaPl][PlayHT] API Error:", response.status, errorText.substring(0, 200));
        lastError = new Error(`HTTP ${response.status}`);
        continue;
      }

      // PlayHT는 바이너리 오디오 스트림 반환
      const blob = await response.blob();
      console.log("[MyaPl][PlayHT] Success!", blob.size, "bytes");
      return URL.createObjectURL(blob);
    } catch (e) {
      console.error("[MyaPl][PlayHT] Attempt failed:", e.message);
      lastError = e;
    }
  }

  // 프록시 실패 시 직접 호출 시도
  try {
    console.log("[MyaPl][PlayHT] Trying direct call...");
    const response = await fetch(PLAYHT_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": apiKey,
        "X-USER-ID": userId,
        "Accept": "audio/mpeg",
      },
      body: JSON.stringify(bodyData),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText.substring(0, 100)}`);
    }

    const blob = await response.blob();
    console.log("[MyaPl][PlayHT] Success (direct)!", blob.size, "bytes");
    return URL.createObjectURL(blob);
  } catch (e) {
    console.error("[MyaPl][PlayHT] Direct call failed:", e.message);
    lastError = e;
  }

  throw lastError || new Error("PlayHT TTS 요청 실패");
}

export const meta = {
  id: "playht",
  name: "PlayHT",
  voices: PLAYHT_VOICES,
  defaultVoice: "s3://voice-cloning-zero-shot/775ae416-49bb-4fb6-bd45-740f205d20a1/jennifersaad/manifest.json",
  defaultModel: "Play3.0-mini",
  maxChars: 3000,
};
