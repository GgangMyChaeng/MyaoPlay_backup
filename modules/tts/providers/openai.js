/**
 * OpenAI TTS Provider
 * - 엔드포인트: api.openai.com/v1/audio/speech
 * - 모델: tts-1, tts-1-hd
 */

import { getRequestHeaders } from "../../deps.js";

const OPENAI_ENDPOINT = "https://api.openai.com/v1/audio/speech";

export const OPENAI_VOICES = [
  { id: "alloy",   name: "Alloy (중성)",       lang: "multi" },
  { id: "ash",     name: "Ash (남성)",         lang: "multi" },
  { id: "coral",   name: "Coral (여성)",       lang: "multi" },
  { id: "echo",    name: "Echo (남성)",        lang: "multi" },
  { id: "fable",   name: "Fable (영국 남성)",  lang: "multi" },
  { id: "onyx",    name: "Onyx (저음 남성)",   lang: "multi" },
  { id: "nova",    name: "Nova (여성)",        lang: "multi" },
  { id: "sage",    name: "Sage (중성)",        lang: "multi" },
  { id: "shimmer", name: "Shimmer (여성)",     lang: "multi" },
];

/**
 * OpenAI TTS API 호출
 * @param {string} text - 읽을 텍스트
 * @param {object} providerSettings - { apiKey, model, voice, speed }
 * @returns {Promise<string>} - blob URL
 */
export async function getAudioUrl(text, providerSettings = {}) {
  const { apiKey, model, voice, speed } = providerSettings;
  if (!apiKey) throw new Error("OpenAI API Key가 없습니다.");
  const bodyData = {
    model: model || "tts-1",
    input: text,
    voice: voice || "nova",
    speed: speed || 1.0,
    response_format: "mp3",
  };
  //console.log("[MyaPl][OpenAI] TTS request:", {
  //  textLength: text.length,
  //  model: bodyData.model,
  //  voice: bodyData.voice,
  //});
  const proxyCandidates = [
    `/proxy/${OPENAI_ENDPOINT}`,
    `/proxy?url=${encodeURIComponent(OPENAI_ENDPOINT)}`,
  ];
  let lastError;
  for (const url of proxyCandidates) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
          ...(getRequestHeaders?.() || {}),
        },
        body: JSON.stringify(bodyData),
        credentials: "same-origin",
      });
      if (!response.ok) {
        const errorText = await response.text();
        console.error("[MyaPl][OpenAI] API Error:", response.status, errorText);
        lastError = new Error(`HTTP ${response.status}`);
        continue;
      }
      // OpenAI는 바이너리(mp3) 직접 반환 -> blob URL 변환
      const blob = await response.blob();
      return URL.createObjectURL(blob);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError || new Error("OpenAI TTS 요청 실패");
}

export const meta = {
  id: "openai",
  name: "OpenAI TTS",
  voices: OPENAI_VOICES,
  defaultVoice: "nova",
  defaultModel: "tts-1",
  maxChars: 4096,
};
