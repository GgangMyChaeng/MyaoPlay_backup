/**
 * Gemini TTS Provider (Google)
 * - Gemini 2.5 Flash Native Audio Output
 * - 엔드포인트: generativelanguage.googleapis.com
 * - 출력: audio/L16 (PCM) -> WAV 변환 필요
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
 * L16 PCM 데이터를 WAV로 변환
 * Gemini TTS는 audio/L16;codec=pcm;rate=24000 포맷으로 반환
 * 브라우저에서 재생하려면 WAV 헤더를 붙여야 함
 * 
 * @param {Uint8Array} pcmData - raw PCM 데이터
 * @param {number} sampleRate - 샘플레이트 (기본 24000)
 * @param {number} numChannels - 채널 수 (기본 1 = 모노)
 * @param {number} bitsPerSample - 비트 (기본 16)
 * @returns {Uint8Array} - WAV 파일 데이터
 */
function pcmToWav(pcmData, sampleRate = 24000, numChannels = 1, bitsPerSample = 16) {
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = pcmData.length;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;
  
  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);
  
  // WAV 헤더 작성
  // "RIFF" chunk descriptor
  writeString(view, 0, 'RIFF');
  view.setUint32(4, totalSize - 8, true); // file size - 8
  writeString(view, 8, 'WAVE');
  
  // "fmt " sub-chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // subchunk1 size (16 for PCM)
  view.setUint16(20, 1, true);  // audio format (1 = PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  
  // "data" sub-chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);
  
  // PCM 데이터 복사
  const wavData = new Uint8Array(buffer);
  wavData.set(pcmData, headerSize);
  
  return wavData;
}

function writeString(view, offset, str) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

/**
 * mimeType에서 샘플레이트 파싱
 * 예: "audio/L16;codec=pcm;rate=24000" -> 24000
 */
function parseSampleRate(mimeType) {
  const match = mimeType?.match(/rate=(\d+)/);
  return match ? parseInt(match[1], 10) : 24000;
}

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
  //console.log("[MyaPl][Gemini] TTS request:", {
  //  textLength: text.length,
  //  model: modelId,
  //  voice: voice || "Kore",
  //});

  // 직접 호출 + x-goog-api-key 헤더 (가장 잘 되는 방식)
  const response = await fetch(endpointNoKey, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify(bodyData),
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    console.error("[MyaPl][Gemini] API Error:", response.status, errorText.substring(0, 300));
    throw new Error(`Gemini API Error: ${response.status}`);
  }
  
  const data = await response.json();
  
  // 응답에서 audio data 추출
  const audioPart = data?.candidates?.[0]?.content?.parts?.find(
    (p) => p.inlineData?.mimeType?.startsWith("audio/")
  );
  if (!audioPart?.inlineData?.data) {
    console.error("[MyaPl][Gemini] Response:", JSON.stringify(data).substring(0, 500));
    throw new Error("Gemini 응답에서 오디오를 찾을 수 없습니다.");
  }
  
  const audioData = audioPart.inlineData.data;
  const mimeType = audioPart.inlineData.mimeType || "audio/L16;codec=pcm;rate=24000";
  console.log("[MyaPl][Gemini] Audio mimeType:", mimeType);
  
  // base64 -> Uint8Array
  const pcmData = Uint8Array.from(atob(audioData), (c) => c.charCodeAt(0));
  
  let blob;
  // L16/PCM 포맷이면 WAV로 변환 필요
  if (mimeType.includes("L16") || mimeType.includes("pcm")) {
    const sampleRate = parseSampleRate(mimeType);
    console.log("[MyaPl][Gemini] Converting L16 PCM to WAV (rate:", sampleRate, ")");
    const wavData = pcmToWav(pcmData, sampleRate);
    blob = new Blob([wavData], { type: "audio/wav" });
  } else {
    // 다른 포맷이면 그대로 사용 (mp3 등)
    blob = new Blob([pcmData], { type: mimeType });
  }
  
  console.log("[MyaPl][Gemini] Success!", blob.size, "bytes");
  return URL.createObjectURL(blob);
}

export const meta = {
  id: "gemini",
  name: "Gemini (Google)",
  voices: GEMINI_VOICES,
  defaultVoice: "Kore",
  defaultModel: "gemini-2.5-flash-preview-tts",
  maxChars: 5000,
};
