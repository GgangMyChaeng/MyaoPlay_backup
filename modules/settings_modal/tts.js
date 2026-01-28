/**
 * settings_modal/tts.js
 * TTS Mode Panel 초기화 및 이벤트 바인딩
 */

import { providers as ttsProviders } from "../tts/providers/index.js";
import { QWEN_VOICES } from "../tts/providers/qwen.js";
import { getLastAssistantText, preprocessForTts } from "../utils.js";

// 의존성 (부모 모듈에서 주입받음)
let _saveSettingsDebounced = () => {};

/**
 * 의존성 주입 함수
 */
export function bindTtsPanelDeps(deps = {}) {
  if (typeof deps.saveSettingsDebounced === "function") {
    _saveSettingsDebounced = deps.saveSettingsDebounced;
  }
}

/**
 * TTS Mode Panel 초기화
 * @param {HTMLElement} root - 모달 루트 요소
 * @param {Object} settings - 설정 객체
 */
export function initTtsPanel(root, settings) {
  const ttsPanel = root.querySelector('#abgm-mode-tts');
  if (!ttsPanel) return;
  const providerSel = ttsPanel.querySelector('#abgm_tts_provider');
  const qwenSettings = ttsPanel.querySelector('#abgm_tts_qwen_settings');
  const corsWarning = ttsPanel.querySelector('#abgm_tts_cors_warning');
  const qwenModelSel = ttsPanel.querySelector('#abgm_tts_qwen_model');
  const qwenApiKeyInput = ttsPanel.querySelector('#abgm_tts_qwen_apikey');
  const qwenVoiceSel = ttsPanel.querySelector('#abgm_tts_qwen_voice');
  const testBtn = ttsPanel.querySelector('#abgm_tts_test_btn');
  const testResult = ttsPanel.querySelector('#abgm_tts_test_result');
  // Provider 드롭다운 채우기
  if (providerSel) {
    providerSel.innerHTML = '<option value="">(사용 안 함)</option>';
    Object.values(ttsProviders).forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      providerSel.appendChild(opt);
    });
  }

  function updateTtsUI() {
    const provider = settings.ttsMode?.provider || "";
    if (providerSel) providerSel.value = provider;
    if (qwenSettings) qwenSettings.style.display = (provider === 'qwen') ? 'block' : 'none';
    if (corsWarning) corsWarning.style.display = provider ? 'block' : 'none';
    if (provider === 'qwen' && settings.ttsMode.providers.qwen) {
      const s = settings.ttsMode.providers.qwen;
      if (qwenModelSel) qwenModelSel.value = s.model || "qwen3-tts-flash";
      if (qwenApiKeyInput) qwenApiKeyInput.value = s.apiKey || "";
  
      // Voice 드롭다운 채우기
      if (qwenVoiceSel) {
        if (qwenVoiceSel.options.length === 0) {
          // Voice 드롭다운 채우기
          if (qwenVoiceSel) {
            if (qwenVoiceSel.options.length === 0) {
              // QWEN_VOICES로부터 채움
              QWEN_VOICES.forEach(v => {
                const opt = document.createElement('option');
                opt.value = v.id;
                opt.textContent = v.name || v.id;
                qwenVoiceSel.appendChild(opt);
              });
            }
            qwenVoiceSel.value = s.voice || "Cherry";
          }
        }
        qwenVoiceSel.value = s.voice || "Cherry";
      }
    }
  }
  updateTtsUI();
  providerSel?.addEventListener('change', (e) => {
    settings.ttsMode.provider = e.target.value;
    _saveSettingsDebounced();
    updateTtsUI();
  });
  qwenSettings?.addEventListener('input', (e) => {
    const s = settings.ttsMode.providers.qwen;
    if (!s) return;
    if (e.target.id === 'abgm_tts_qwen_model') s.model = e.target.value;
    if (e.target.id === 'abgm_tts_qwen_apikey') s.apiKey = e.target.value;
    if (e.target.id === 'abgm_tts_qwen_voice') s.voice = e.target.value;
    _saveSettingsDebounced();
  });
  testBtn?.addEventListener('click', async () => {
    const providerId = settings.ttsMode.provider;
    const provider = ttsProviders[providerId];
    if (!provider) {
      if (testResult) {
        testResult.textContent = "❌ TTS 프로바이더를 선택해주세요.";
        testResult.style.color = "#ff6666";
      }
      return;
    }
    const providerSettings = settings.ttsMode.providers[providerId] || {};
    if (testResult) {
      testResult.textContent = "⏳ 연결 중...";
      testResult.style.color = "var(--abgm-text-dim)";
    }
    try {
      const audioUrl = await provider.getAudioUrl("Mia", providerSettings);
      const audio = new Audio(audioUrl);
      audio.volume = 0.8;
      audio.play().catch(e => console.warn("Auto-play blocked:", e));
      if (testResult) {
        testResult.textContent = `✅ 연결 성공! (${provider.name})`;
        testResult.style.color = "#66ff66";
      }
    } catch (e) {
      console.error("[MyaPl] TTS Test Failed:", e);
      if (testResult) {
        testResult.innerHTML = `❌ 오류: ${e.message}<br><span style="font-size:0.85em; opacity:0.7;">엔드포인트/API키를 확인하거나, ST config.yaml에서 <b>enableCorsProxy: true</b>를 켜보세요.</span>`;
        testResult.style.color = "#ff6666";
      }
    }
  });
  // === AI 응답 TTS 재생 ===
  const speakBtn = ttsPanel.querySelector('#abgm_tts_speak_btn');
  const speakStatus = ttsPanel.querySelector('#abgm_tts_speak_status');
  speakBtn?.addEventListener('click', async () => {
    const providerId = settings.ttsMode?.provider;
    const provider = ttsProviders[providerId];
    if (!provider) {
      if (speakStatus) {
        speakStatus.textContent = "❌ TTS 프로바이더를 먼저 선택해주세요.";
        speakStatus.style.color = "#ff6666";
      }
      return;
    }
    // 1) 마지막 AI 메시지 가져오기
    const rawText = getLastAssistantText();
    console.log("[MyaPl] TTS rawText:", rawText?.slice(0, 200), "...");
    console.log("[MyaPl] TTS rawText length:", rawText?.length);
    if (!rawText) {
      if (speakStatus) {
        speakStatus.textContent = "❌ 읽을 AI 응답이 없습니다.";
        speakStatus.style.color = "#ff6666";
      }
      return;
    }
    // 2) 전처리
    const text = preprocessForTts(rawText);
    if (!text) {
      if (speakStatus) {
        speakStatus.textContent = "❌ 전처리 후 읽을 텍스트가 없습니다.";
        speakStatus.style.color = "#ff6666";
      }
      return;
    }
    // 3) 길이 체크 (테스트용 200자)
    const truncated = text.length > 200 ? text.slice(0, 197) + "..." : text;
    if (speakStatus) {
      speakStatus.textContent = `⏳ 변환 중... (${truncated.length}자)`;
      speakStatus.style.color = "var(--abgm-text-dim)";
    }
    try {
      // 4) TTS API 호출
      const providerSettings = settings.ttsMode.providers[providerId] || {};
      const audioUrl = await provider.getAudioUrl(truncated, providerSettings);
      // 5) 재생
      const audio = new Audio(audioUrl);
      audio.volume = settings.globalVolume ?? 0.7;
      audio.onended = () => {
        if (speakStatus) {
          speakStatus.textContent = "✅ 재생 완료";
          speakStatus.style.color = "#66ff66";
        }
      };
      audio.onerror = () => {
        if (speakStatus) {
          speakStatus.textContent = "❌ 오디오 재생 실패";
          speakStatus.style.color = "#ff6666";
        }
      };
      await audio.play();
      if (speakStatus) {
        speakStatus.textContent = `🔊 재생 중... (${truncated.length}자)`;
        speakStatus.style.color = "#8af";
      }
    } catch (e) {
      console.error("[MyaPl] TTS Speak Error:", e);
      if (speakStatus) {
        speakStatus.textContent = `❌ 오류: ${e.message}`;
        speakStatus.style.color = "#ff6666";
      }
    }
  });
}