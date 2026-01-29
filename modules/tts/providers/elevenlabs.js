/**
 * ElevenLabs TTS Provider
 * - 엔드포인트: api.elevenlabs.io
 * - 업계 최고 품질, 다양한 모델/보이스
 * - 응답: binary audio stream (mp3)
 */

import { getRequestHeaders } from "../../deps.js";

const ELEVENLABS_ENDPOINT = "https://api.elevenlabs.io/v1/text-to-speech";

// ElevenLabs 프리빌트 보이스 (주요 보이스)
export const ELEVENLABS_VOICES = [
  // === 여성 ===
  { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel (여성, 차분)", lang: "en" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Bella (여성, 부드러움)", lang: "en" },
  { id: "MF3mGyEYCl7XYWbV9V6O", name: "Elli (여성, 젊음)", lang: "en" },
  { id: "jBpfuIE2acCO8z3wKNLl", name: "Gigi (여성, 애니)", lang: "en" },
  { id: "oWAxZDx7w5VEj9dCyTzz", name: "Grace (여성, 서던)", lang: "en" },
  { id: "ThT5KcBeYPX3keUQqHPh", name: "Dorothy (여성, 영국)", lang: "en" },
  { id: "AZnzlk1XvdvUeBnXmlld", name: "Domi (여성, 강인)", lang: "en" },
  
  // === 남성 ===
  { id: "ErXwobaYiN019PkySvjV", name: "Antoni (남성, 친근)", lang: "en" },
  { id: "VR6AewLTigWG4xSOukaG", name: "Arnold (남성, 굵음)", lang: "en" },
  { id: "pNInz6obpgDQGcFmaJgB", name: "Adam (남성, 내레이션)", lang: "en" },
  { id: "yoZ06aMxZJJ28mfd3POQ", name: "Sam (남성, 거침)", lang: "en" },
  { id: "TxGEqnHWrfWFTfGW9XjX", name: "Josh (남성, 젊음)", lang: "en" },
  { id: "onwK4e9ZLuTAKqWW03F9", name: "Daniel (남성, 영국)", lang: "en" },
  { id: "ZQe5CZNOzWyzPSCn5a3c", name: "James (남성, 뉴스)", lang: "en" },
  
  // === 중성/특수 ===
  { id: "Zlb1dXrM653N07WRdFW3", name: "Callum (중성, 비디오)", lang: "en" },
  { id: "GBv7mTt0atIp3Br8iCZE", name: "Thomas (남성, 명상)", lang: "en" },
  { id: "SOYHLrjzK2X1ezoPC6cr", name: "Harry (남성, 불안)", lang: "en" },
];

// ElevenLabs 모델
export const ELEVENLABS_MODELS = [
  { id: "eleven_flash_v2_5", name: "Flash v2.5 (빠름, 저렴)" },
  { id: "eleven_turbo_v2_5", name: "Turbo v2.5 (균형)" },
  { id: "eleven_multilingual_v2", name: "Multilingual v2 (최고 품질)" },
];

/**
 * ElevenLabs TTS API 호출
 * @param {string} text - 읽을 텍스트
 * @param {object} providerSettings - { apiKey, voice, model, stability, similarityBoost }
 * @returns {Promise<string>} - blob URL
 */
export async function getAudioUrl(text, providerSettings = {}) {
  const { apiKey, voice, model, stability, similarityBoost } = providerSettings;
  if (!apiKey) throw new Error("ElevenLabs API Key가 없습니다.");

  const voiceId = voice || "21m00Tcm4TlvDq8ikWAM"; // 기본: Rachel
  const endpoint = `${ELEVENLABS_ENDPOINT}/${voiceId}`;

  const bodyData = {
    text,
    model_id: model || "eleven_flash_v2_5",
    voice_settings: {
      stability: stability ?? 0.5,
      similarity_boost: similarityBoost ?? 0.75,
    },
  };

  //console.log("[MyaPl][ElevenLabs] TTS request:", {
  //  textLength: text.length,
  //  voice: voiceId,
  //  model: bodyData.model_id,
  //});

  // ElevenLabs는 CORS 허용 - 직접 호출
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": apiKey,
        "Accept": "audio/mpeg",
      },
      body: JSON.stringify(bodyData),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[MyaPl][ElevenLabs] API Error:", response.status, errorText.substring(0, 200));
      // quota 초과 에러 친절하게 처리
      if (errorText.includes("quota_exceeded")) {
        throw new Error("ElevenLabs 크레딧이 부족합니다. 대시보드에서 확인해주세요.");
      }
      throw new Error(`HTTP ${response.status}: ${errorText.substring(0, 100)}`);
    }

    // 바이너리 오디오 스트림 반환
    const blob = await response.blob();
    //console.log("[MyaPl][ElevenLabs] Success!", blob.size, "bytes");
    return URL.createObjectURL(blob);
  } catch (e) {
    console.error("[MyaPl][ElevenLabs] API call failed:", e.message);
    
    // 프록시 폴백 시도
    console.log("[MyaPl][ElevenLabs] Trying proxy fallback...");
    const proxyCandidates = [
      `/proxy/${endpoint}`,
      `/proxy?url=${encodeURIComponent(endpoint)}`,
    ];

    for (const proxyUrl of proxyCandidates) {
      try {
        const response = await fetch(proxyUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "xi-api-key": apiKey,
            "Accept": "audio/mpeg",
            "X-Requested-With": "XMLHttpRequest",
            ...(getRequestHeaders?.() || {}),
          },
          body: JSON.stringify(bodyData),
          credentials: "same-origin",
        });

        if (!response.ok) continue;

        const blob = await response.blob();
        console.log("[MyaPl][ElevenLabs] Success (proxy)!", blob.size, "bytes");
        return URL.createObjectURL(blob);
      } catch (proxyErr) {
        console.warn("[MyaPl][ElevenLabs] Proxy attempt failed:", proxyErr.message);
      }
    }

    throw e;
  }
}

export const meta = {
  id: "elevenlabs",
  name: "ElevenLabs",
  voices: ELEVENLABS_VOICES,
  models: ELEVENLABS_MODELS,
  defaultVoice: "21m00Tcm4TlvDq8ikWAM",
  defaultModel: "eleven_flash_v2_5",
  maxChars: 5000,
};
