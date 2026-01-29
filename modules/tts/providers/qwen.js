/**
 * Qwen TTS Provider (Alibaba DashScope)
 * - 엔드포인트: dashscope-intl.aliyuncs.com
 * - 모델: qwen3-tts-flash
 */

import { getRequestHeaders } from "../../deps.js";

const QWEN_ENDPOINT = "https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";

export const QWEN_VOICES = [
  { id: "Cherry",  name: "Cherry",  lang: "multi" },
  { id: "Serena",  name: "Serena",  lang: "multi" },
  { id: "Ethan",   name: "Ethan",   lang: "multi" },
  { id: "Chelsie", name: "Chelsie", lang: "multi" },
  { id: "Momo",    name: "Momo",    lang: "multi" },
  { id: "Vivian",  name: "Vivian",  lang: "multi" },
  { id: "Moon",    name: "Moon",    lang: "multi" },
  { id: "Maia",    name: "Maia",    lang: "multi" },
  { id: "Kai",     name: "Kai",     lang: "multi" },
  { id: "Nofish",  name: "Nofish",  lang: "multi" },
  { id: "Bella",   name: "Bella",   lang: "multi" },
];

/**
 * Qwen TTS API 호출
 * @param {string} text - 읽을 텍스트
 * @param {object} providerSettings - { apiKey, model, voice, languageType }
 * @returns {Promise<string>} - 오디오 URL (24시간 유효)
 */
export async function getAudioUrl(text, providerSettings = {}) {
  const { apiKey, model, voice, languageType } = providerSettings;
  if (!apiKey) throw new Error("Qwen API Key가 없습니다.");
  const bodyData = {
    model: model || "qwen3-tts-flash",
    input: {
      text,
      voice: voice || "Cherry",
      language_type: languageType || "Auto",
    },
  };
  //console.log("[MyaPl][Qwen] TTS request:", {
  //  textLength: text.length,
  //  textPreview: text.slice(0, 100),
  //  model: bodyData.model,
  //  voice: bodyData.input.voice,
  //});
  const tryPostFetch = async (url) => {
    const headers = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
      ...(getRequestHeaders?.() || {}),
    };
    return fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(bodyData),
      credentials: "same-origin",
    });
  };
  const proxyCandidates = [
    `/proxy/${QWEN_ENDPOINT}`,
    `/proxy?url=${encodeURIComponent(QWEN_ENDPOINT)}`,
  ];
  let lastError;
  for (const url of proxyCandidates) {
    try {
      const response = await tryPostFetch(url);
      if (!response.ok) {
        const errorText = await response.text();
        console.error("[MyaPl][Qwen] API Error:", response.status, errorText);
        lastError = new Error(`HTTP ${response.status} on ${url}`);
        continue;
      }
      const data = await response.json();
      if (data.code || data.message) {
        throw new Error(`API 오류: ${data.message || data.code}`);
      }
      const audioUrl = data?.output?.audio?.url;
      if (!audioUrl) {
        throw new Error("API 응답에서 오디오 URL을 찾을 수 없습니다.");
      }
      return audioUrl;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError || new Error("Qwen TTS 요청 실패");
}

export const meta = {
  id: "qwen",
  name: "Qwen (Alibaba)",
  voices: QWEN_VOICES,
  defaultVoice: "Cherry",
  defaultModel: "qwen3-tts-flash",
  maxChars: 600,
};
