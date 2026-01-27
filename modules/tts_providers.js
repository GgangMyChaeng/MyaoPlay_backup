import { getRequestHeaders } from "./deps.js";

// --- Qwen Provider ---
const QWEN_ENDPOINT = "https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";

async function getQwenAudioUrl(text, providerSettings) {
    const { apiKey, model, voice } = providerSettings;
    if (!apiKey) throw new Error("Qwen API Key가 없습니다.");
    const bodyData = {
        model: model || 'qwen3-tts-flash',
        input: { text },
        parameters: { voice: voice || 'Cherry', format: 'mp3' },
    };
    console.log("[MyaPl] Qwen TTS request:", {
      textLength: text.length,
      textPreview: text.slice(0, 100),
      model: bodyData.model,
      voice: bodyData.parameters.voice
    });
    const tryPostFetch = async (url) => {
        const headers = {
            "Authorization": `Bearer ${apiKey}`,
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
    // SillyTavern 프록시 경로가 버전에 따라 다를 수 있어서 여러 개 시도
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
              console.error("[MyaPl] Qwen API Error Response:", response.status, errorText);
            }
            if (response.ok) {
                const data = await response.json();
                if (data.code || data.message) {
                    throw new Error(`API 오류: ${data.message || data.code}`);
                }
                const audioUrl = data?.output?.audio?.url;
                if (!audioUrl) {
                    throw new Error("API 응답에서 오디오 URL을 찾을 수 없습니다.");
                }
                return audioUrl; // 성공!
            }
            lastError = new Error(`HTTP ${response.status} on ${url}`);
        } catch (e) {
            lastError = e;
        }
    }
    throw lastError || new Error("TTS 요청 실패. 모든 프록시 시도 실패.");
}


// --- ElevenLabs Provider (나중에 추가할 때 예시) ---
async function getElevenLabsAudioUrl(text, providerSettings) {
    // const { apiKey, voiceId } = providerSettings;
    // const url = `/proxy/https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
    // ... 여기에 ElevenLabs 호출 로직을 구현하면 됨.
    throw new Error("ElevenLabs는 아직 구현되지 않았습니다.");
}


// --- 프로바이더 등록부 ---
// 여기에 새 TTS 프로바이더를 추가하기만 하면 설정창에 자동으로 나타나게 됨. 어휴 ㅅㅂ 이것도 일이노
export const ttsProviders = {
    qwen: {
        id: 'qwen',
        name: 'Qwen (Alibaba)',
        getAudioUrl: getQwenAudioUrl,
    },
    elevenlabs: {
        id: 'elevenlabs',
        name: 'ElevenLabs (미구현)',
        getAudioUrl: getElevenLabsAudioUrl,
    },
};
