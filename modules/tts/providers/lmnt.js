/**
 * LMNT TTS Provider
 * - 엔드포인트: api.lmnt.com
 * - 저렴하고 빠른 TTS, 감정 표현 좋음
 * - 응답: JSON { audio: base64, seed, durations } 또는 { audio: "", error: "..." }
 */

import { getRequestHeaders } from "../../deps.js";

const LMNT_ENDPOINT = "https://api.lmnt.com/v1/ai/speech";

// LMNT 전체 시스템 보이스 (44개)
// professional = 고품질, instant = 빠른 생성
export const LMNT_VOICES = [
  // === Professional (고품질) ===
  { id: "amy",      name: "Amy (여성, Pro)",      type: "professional" },
  { id: "ava",      name: "Ava (여성, Pro)",      type: "professional" },
  { id: "caleb",    name: "Caleb (남성, Pro)",    type: "professional" },
  { id: "chloe",    name: "Chloe (여성, Pro)",    type: "professional" },
  { id: "dalton",   name: "Dalton (남성, Pro)",   type: "professional" },
  { id: "daniel",   name: "Daniel (남성, Pro)",   type: "professional" },
  { id: "dustin",   name: "Dustin (남성, Pro)",   type: "professional" },
  { id: "james",    name: "James (남성, Pro)",    type: "professional" },
  { id: "lauren",   name: "Lauren (여성, Pro)",   type: "professional" },
  { id: "lily",     name: "Lily (여성, Pro)",     type: "professional" },
  { id: "magnus",   name: "Magnus (남성, Pro)",   type: "professional" },
  { id: "miles",    name: "Miles (남성, Pro)",    type: "professional" },
  { id: "morgan",   name: "Morgan (중성, Pro)",   type: "professional" },
  { id: "nathan",   name: "Nathan (남성, Pro)",   type: "professional" },
  { id: "noah",     name: "Noah (남성, Pro)",     type: "professional" },
  { id: "oliver",   name: "Oliver (남성, Pro)",   type: "professional" },
  { id: "paige",    name: "Paige (여성, Pro)",    type: "professional" },
  { id: "sophie",   name: "Sophie (여성, Pro)",   type: "professional" },
  { id: "terrence", name: "Terrence (남성, Pro)", type: "professional" },
  { id: "zain",     name: "Zain (남성, Pro)",     type: "professional" },
  { id: "zeke",     name: "Zeke (남성, Pro)",     type: "professional" },
  { id: "zoe",      name: "Zoe (여성, Pro)",      type: "professional" },
  
  // === Instant (빠른 생성) ===
  { id: "ansel",    name: "Ansel (남성)",    type: "instant" },
  { id: "autumn",   name: "Autumn (여성)",   type: "instant" },
  { id: "bella",    name: "Bella (여성)",    type: "instant" },
  { id: "brandon",  name: "Brandon (남성)",  type: "instant" },
  { id: "cassian",  name: "Cassian (남성)",  type: "instant" },
  { id: "elowen",   name: "Elowen (여성)",   type: "instant" },
  { id: "evander",  name: "Evander (남성)",  type: "instant" },
  { id: "huxley",   name: "Huxley (남성)",   type: "instant" },
  { id: "jacob",    name: "Jacob (남성)",    type: "instant" },
  { id: "juniper",  name: "Juniper (여성)",  type: "instant" },
  { id: "kennedy",  name: "Kennedy (여성)",  type: "instant" },
  { id: "leah",     name: "Leah (여성)",     type: "instant" },
  { id: "lucas",    name: "Lucas (남성)",    type: "instant" },
  { id: "natalie",  name: "Natalie (여성)",  type: "instant" },
  { id: "nyssa",    name: "Nyssa (여성)",    type: "instant" },
  { id: "ryan",     name: "Ryan (남성)",     type: "instant" },
  { id: "sadie",    name: "Sadie (여성)",    type: "instant" },
  { id: "stella",   name: "Stella (여성)",   type: "instant" },
  { id: "tyler",    name: "Tyler (남성)",    type: "instant" },
  { id: "vesper",   name: "Vesper (여성)",   type: "instant" },
  { id: "violet",   name: "Violet (여성)",   type: "instant" },
  { id: "warrick",  name: "Warrick (남성)",  type: "instant" },
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
    
    // 에러 응답 체크
    if (json.error) {
      console.error("[MyaPl][LMNT] Server error:", json.error);
      throw new Error(`LMNT 서버 에러: ${json.error}`);
    }
    
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
