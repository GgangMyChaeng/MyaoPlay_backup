/**
 * LMNT TTS Provider
 * - 엔드포인트: api.lmnt.com
 * - 저렴하고 빠른 TTS, 감정 표현 좋음
 * - 응답: JSON { audio: base64, seed, durations }
 */

import { getRequestHeaders } from "../../deps.js";

const LMNT_ENDPOINT = "https://api.lmnt.com/v1/ai/speech";

// LMNT 프리빌트 보이스 (일부 주요 보이스만)
// 전체 목록: https://app.lmnt.com/voices
export const LMNT_VOICES = [
  { id: "lily",     name: "Lily (여성, 차분)",       lang: "en" },
  { id: "daniel",   name: "Daniel (남성, 내레이션)", lang: "en" },
  { id: "mia",      name: "Mia (여성, 밝음)",        lang: "en" },
  { id: "leah",     name: "Leah (여성, 자연스러움)", lang: "en" },
  { id: "morgan",   name: "Morgan (중성)",          lang: "en" },
  { id: "ava",      name: "Ava (여성, 부드러움)",    lang: "en" },
  { id: "zoe",      name: "Zoe (여성, 활기)",        lang: "en" },
  { id: "chloe",    name: "Chloe (여성, 따뜻함)",    lang: "en" },
];

/**
 * base64 → Blob 변환
 */
function base64ToBlob(base64, mimeType = "audio/mpeg") {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

/**
 * LMNT TTS API 호출
 * @param {string} text - 읽을 텍스트 (max 5000자)
 * @param {object} providerSettings - { apiKey, voice, model, speed }
 * @returns {Promise<string>} - blob URL
 */
export async function getAudioUrl(text, providerSettings = {}) {
  const { apiKey, voice, model, speed, language } = providerSettings;
  if (!apiKey) throw new Error("LMNT API Key가 없습니다.");

  const bodyData = {
    text,
    voice: voice || "lily",
    model: model || "blizzard",
    format: "mp3",
  };

  // 옵션 파라미터
  if (speed) bodyData.speed = speed;
  if (language) bodyData.language = language;

  console.log("[MyaPl][LMNT] TTS request:", {
    textLength: text.length,
    voice: bodyData.voice,
    model: bodyData.model,
  });

  // LMNT는 CORS 허용하므로 직접 호출
  try {
    const response = await fetch(LMNT_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
      },
      body: JSON.stringify(bodyData),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText.substring(0, 100)}`);
    }

    // JSON 응답에서 base64 audio 추출
    const json = await response.json();
    
    if (!json.audio) {
      throw new Error("응답에 audio 필드가 없습니다.");
    }

    console.log("[MyaPl][LMNT] Got audio data, seed:", json.seed);
    
    // base64 → Blob 변환
    const blob = base64ToBlob(json.audio, "audio/mpeg");
    console.log("[MyaPl][LMNT] Success!", blob.size, "bytes");
    
    return URL.createObjectURL(blob);
  } catch (e) {
    console.error("[MyaPl][LMNT] API call failed:", e.message);
    throw e;
  }
}

export const meta = {
  id: "lmnt",
  name: "LMNT",
  voices: LMNT_VOICES,
  defaultVoice: "lily",
  defaultModel: "blizzard",
  maxChars: 5000,
};
