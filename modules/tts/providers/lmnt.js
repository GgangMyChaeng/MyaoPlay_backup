/**
 * LMNT TTS Provider
 * - 엔드포인트: api.lmnt.com
 * - 저렴하고 빠른 TTS, 감정 표현 좋음
 * - 출력: binary audio (mp3/wav)
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

  // 프록시 후보
  const proxyCandidates = [
    `/proxy/${LMNT_ENDPOINT}`,
    `/proxy?url=${encodeURIComponent(LMNT_ENDPOINT)}`,
  ];

  let lastError;
  for (const url of proxyCandidates) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": apiKey,
          "X-Requested-With": "XMLHttpRequest",
          ...(getRequestHeaders?.() || {}),
        },
        body: JSON.stringify(bodyData),
        credentials: "same-origin",
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("[MyaPl][LMNT] API Error:", response.status, errorText.substring(0, 200));
        lastError = new Error(`HTTP ${response.status}`);
        continue;
      }

      // LMNT는 바이너리 오디오 직접 반환
      const blob = await response.blob();
      console.log("[MyaPl][LMNT] Success!", blob.size, "bytes");
      return URL.createObjectURL(blob);
    } catch (e) {
      console.error("[MyaPl][LMNT] Attempt failed:", e.message);
      lastError = e;
    }
  }

  // 프록시 실패 시 직접 호출 시도
  try {
    console.log("[MyaPl][LMNT] Trying direct call...");
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

    const blob = await response.blob();
    console.log("[MyaPl][LMNT] Success (direct)!", blob.size, "bytes");
    return URL.createObjectURL(blob);
  } catch (e) {
    console.error("[MyaPl][LMNT] Direct call failed:", e.message);
    lastError = e;
  }

  throw lastError || new Error("LMNT TTS 요청 실패");
}

export const meta = {
  id: "lmnt",
  name: "LMNT",
  voices: LMNT_VOICES,
  defaultVoice: "lily",
  defaultModel: "blizzard",
  maxChars: 5000,
};
