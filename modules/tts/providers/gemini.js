/**
 * Gemini TTS Provider (Google)
 * - Gemini 2.5 Flash Native Audio Output
 * - 엔드포인트: generativelanguage.googleapis.com
 */

import { getRequestHeaders } from "../../deps.js";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export const GEMINI_VOICES = [
  { id: "Zephyr", name: "Zephyr (Bright)",      lang: "multi" },
  { id: "Puck",   name: "Puck (Upbeat)",        lang: "multi" },
  { id: "Charon", name: "Charon (Informative)", lang: "multi" },
  { id: "Kore",   name: "Kore (Firm)",          lang: "multi" },
  { id: "Fenrir", name: "Fenrir (Excitable)",   lang: "multi" },
  { id: "Leda",   name: "Leda (Youthful)",      lang: "multi" },
  { id: "Orus",   name: "Orus (Firm)",          lang: "multi" },
  { id: "Aoede",  name: "Aoede (Breezy)",       lang: "multi" },
];

/**
 * Gemini TTS API 호출
 * @param {string} text - 읽을 텍스트
 * @param {object} providerSettings - { apiKey, model, voice }
 * @returns {Promise<string>} - blob URL
 */
export async function getAudioUrl(text, providerSettings = {}) {
  const { apiKey, model, voice } = providerSettings;
  if (!apiKey) throw new Error("Gemini API Key가 없습니다.");
  const modelId = model || "gemini-2.5-flash-preview-tts";
  
  // URL에 key 포함 (기존 방식)
  const endpointWithKey = `${GEMINI_BASE}/${modelId}:generateContent?key=${apiKey}`;
  // URL에 key 없이 (헤더로만)
  const endpointNoKey = `${GEMINI_BASE}/${modelId}:generateContent`;
  
  const bodyData = {
    contents: [
      {
        parts: [{ text }],
      },
    ],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: voice || "Kore",
          },
        },
      },
    },
  };
  console.log("[MyaPl][Gemini] TTS request:", {
    textLength: text.length,
    model: modelId,
    voice: voice || "Kore",
  });

  // 여러 조합 시도
  const attempts = [
    // 1) 프록시 + URL에 key (기존 방식, 헤더 추가)
    {
      url: `/proxy/${endpointWithKey}`,
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
        ...(getRequestHeaders?.() || {}),
      },
    },
    // 2) 프록시 + 헤더에 key
    {
      url: `/proxy/${endpointNoKey}`,
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
        "X-Requested-With": "XMLHttpRequest",
        ...(getRequestHeaders?.() || {}),
      },
    },
    // 3) 직접 호출 + 헤더에 key (CORS 안 되면 실패)
    {
      url: endpointNoKey,
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
    },
    // 4) 직접 호출 + URL에 key
    {
      url: endpointWithKey,
      headers: {
        "Content-Type": "application/json",
      },
    },
  ];

  let lastError;
  for (const attempt of attempts) {
    try {
      console.log("[MyaPl][Gemini] Trying:", attempt.url.substring(0, 80) + "...");
      const response = await fetch(attempt.url, {
        method: "POST",
        headers: attempt.headers,
        body: JSON.stringify(bodyData),
        credentials: "same-origin",
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error("[MyaPl][Gemini] API Error:", response.status, errorText.substring(0, 200));
        lastError = new Error(`HTTP ${response.status}`);
        continue;
      }
      
      const data = await response.json();
      console.log("[MyaPl][Gemini] Response received, extracting audio...");
      
      // 응답에서 audio data 추출
      const audioPart = data?.candidates?.[0]?.content?.parts?.find(
        (p) => p.inlineData?.mimeType?.startsWith("audio/")
      );
      if (!audioPart?.inlineData?.data) {
        throw new Error("Gemini 응답에서 오디오를 찾을 수 없습니다.");
      }
      // base64 -> blob URL
      const audioData = audioPart.inlineData.data;
      const mimeType = audioPart.inlineData.mimeType || "audio/mp3";
      const byteArray = Uint8Array.from(atob(audioData), (c) => c.charCodeAt(0));
      const blob = new Blob([byteArray], { type: mimeType });
      console.log("[MyaPl][Gemini] Success! Audio blob created");
      return URL.createObjectURL(blob);
    } catch (e) {
      console.error("[MyaPl][Gemini] Attempt failed:", e.message);
      lastError = e;
    }
  }
  throw lastError || new Error("Gemini TTS 요청 실패");
}

export const meta = {
  id: "gemini",
  name: "Gemini (Google)",
  voices: GEMINI_VOICES,
  defaultVoice: "Kore",
  defaultModel: "gemini-2.5-flash-preview-tts",
  maxChars: 5000,
};
