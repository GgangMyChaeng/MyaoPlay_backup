/**
 * settings_modal/tts.js
 * TTS Mode Panel 초기화 및 이벤트 바인딩
 */

import { providers as ttsProviders } from "../tts/providers/index.js";
import { QWEN_VOICES } from "../tts/providers/qwen.js";
import { OPENAI_VOICES } from "../tts/providers/openai.js";
import { GEMINI_VOICES } from "../tts/providers/gemini.js";
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
  // === 공통 요소 ===
  const providerSel = ttsPanel.querySelector('#abgm_tts_provider');
  const commonActions = ttsPanel.querySelector('#abgm_tts_common_actions');
  const corsWarning = ttsPanel.querySelector('#abgm_tts_cors_warning');
  const testBtn = ttsPanel.querySelector('#abgm_tts_test_btn');
  const testResult = ttsPanel.querySelector('#abgm_tts_test_result');
  const speakBtn = ttsPanel.querySelector('#abgm_tts_speak_btn');
  const speakStatus = ttsPanel.querySelector('#abgm_tts_speak_status');

  // === Qwen 요소 ===
  const qwenSettings = ttsPanel.querySelector('#abgm_tts_qwen_settings');
  const qwenModelSel = ttsPanel.querySelector('#abgm_tts_qwen_model');
  const qwenVoiceSel = ttsPanel.querySelector('#abgm_tts_qwen_voice');
  const qwenApiKeyInput = ttsPanel.querySelector('#abgm_tts_qwen_apikey');

  // === OpenAI 요소 ===
  const openaiSettings = ttsPanel.querySelector('#abgm_tts_openai_settings');
  const openaiModelSel = ttsPanel.querySelector('#abgm_tts_openai_model');
  const openaiVoiceSel = ttsPanel.querySelector('#abgm_tts_openai_voice');
  const openaiSpeedInput = ttsPanel.querySelector('#abgm_tts_openai_speed');
  const openaiSpeedVal = ttsPanel.querySelector('#abgm_tts_openai_speed_val');
  const openaiInstructionsInput = ttsPanel.querySelector('#abgm_tts_openai_instructions');
  const openaiApiKeyInput = ttsPanel.querySelector('#abgm_tts_openai_apikey');

  // === Gemini 요소 ===
  const geminiSettings = ttsPanel.querySelector('#abgm_tts_gemini_settings');
  const geminiModelSel = ttsPanel.querySelector('#abgm_tts_gemini_model');
  const geminiVoiceSel = ttsPanel.querySelector('#abgm_tts_gemini_voice');
  const geminiApiKeyInput = ttsPanel.querySelector('#abgm_tts_gemini_apikey');

  // === settings.ttsMode 구조 보장 ===
  settings.ttsMode ??= {};
  settings.ttsMode.provider ??= "";
  settings.ttsMode.providers ??= {};
  settings.ttsMode.providers.qwen ??= {};
  settings.ttsMode.providers.openai ??= {};
  settings.ttsMode.providers.gemini ??= {};
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

  // === Voice 드롭다운 채우기 (한 번만) ===
  function fillVoiceSelect(selectEl, voices, defaultVoice) {
    if (!selectEl || selectEl.options.length > 0) return;
    voices.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v.id;
      opt.textContent = v.name || v.id;
      selectEl.appendChild(opt);
    });
    if (defaultVoice) selectEl.value = defaultVoice;
  }

  fillVoiceSelect(qwenVoiceSel, QWEN_VOICES, "Cherry");
  fillVoiceSelect(openaiVoiceSel, OPENAI_VOICES, "nova");
  fillVoiceSelect(geminiVoiceSel, GEMINI_VOICES, "Kore");

  function updateTtsUI() {
    const provider = settings.ttsMode?.provider || "";
    
    // Provider 드롭다운
    if (providerSel) providerSel.value = provider;
    
    // Provider 설정 박스 show/hide
    if (qwenSettings) qwenSettings.style.display = (provider === 'qwen') ? 'block' : 'none';
    if (openaiSettings) openaiSettings.style.display = (provider === 'openai') ? 'block' : 'none';
    if (geminiSettings) geminiSettings.style.display = (provider === 'gemini') ? 'block' : 'none';
    
    // 공통 액션 버튼 & CORS 경고
    if (commonActions) commonActions.style.display = provider ? 'block' : 'none';
    if (corsWarning) corsWarning.style.display = provider ? 'block' : 'none';

    // Qwen 값 복원
    if (provider === 'qwen') {
      const s = settings.ttsMode.providers.qwen;
      if (qwenModelSel) qwenModelSel.value = s.model || "qwen3-tts-flash";
      if (qwenVoiceSel) qwenVoiceSel.value = s.voice || "Cherry";
      if (qwenApiKeyInput) qwenApiKeyInput.value = s.apiKey || "";
    }

    // OpenAI 값 복원
    if (provider === 'openai') {
      const s = settings.ttsMode.providers.openai;
      if (openaiModelSel) openaiModelSel.value = s.model || "tts-1";
      if (openaiVoiceSel) openaiVoiceSel.value = s.voice || "nova";
      if (openaiSpeedInput) openaiSpeedInput.value = s.speed ?? 1.0;
      if (openaiSpeedVal) openaiSpeedVal.textContent = `${s.speed ?? 1.0}x`;
      if (openaiInstructionsInput) openaiInstructionsInput.value = s.instructions || "";
      if (openaiApiKeyInput) openaiApiKeyInput.value = s.apiKey || "";
    }

    // Gemini 값 복원
    if (provider === 'gemini') {
      const s = settings.ttsMode.providers.gemini;
      if (geminiModelSel) geminiModelSel.value = s.model || "gemini-2.5-flash-preview-tts";
      if (geminiVoiceSel) geminiVoiceSel.value = s.voice || "Kore";
      if (geminiApiKeyInput) geminiApiKeyInput.value = s.apiKey || "";
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
  // === OpenAI 설정 이벤트 ===
  openaiSettings?.addEventListener('input', (e) => {
    const s = settings.ttsMode.providers.openai;
    if (!s) return;
    if (e.target.id === 'abgm_tts_openai_model') s.model = e.target.value;
    if (e.target.id === 'abgm_tts_openai_voice') s.voice = e.target.value;
    if (e.target.id === 'abgm_tts_openai_speed') {
      s.speed = parseFloat(e.target.value);
      if (openaiSpeedVal) openaiSpeedVal.textContent = `${s.speed}x`;
    }
    if (e.target.id === 'abgm_tts_openai_instructions') s.instructions = e.target.value;
    if (e.target.id === 'abgm_tts_openai_apikey') s.apiKey = e.target.value;
    _saveSettingsDebounced();
  });

  // === Gemini 설정 이벤트 ===
  geminiSettings?.addEventListener('input', (e) => {
    const s = settings.ttsMode.providers.gemini;
    if (!s) return;
    if (e.target.id === 'abgm_tts_gemini_model') s.model = e.target.value;
    if (e.target.id === 'abgm_tts_gemini_voice') s.voice = e.target.value;
    if (e.target.id === 'abgm_tts_gemini_apikey') s.apiKey = e.target.value;
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
