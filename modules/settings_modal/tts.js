/**
 * settings_modal/tts.js
 * TTS Mode Panel 초기화 및 이벤트 바인딩
 */

import { providers as ttsProviders } from "../tts/providers/index.js";
import { QWEN_VOICES } from "../tts/providers/qwen.js";
import { OPENAI_VOICES } from "../tts/providers/openai.js";
import { GEMINI_VOICES } from "../tts/providers/gemini.js";
import { LMNT_VOICES } from "../tts/providers/lmnt.js";
import { ELEVENLABS_VOICES, ELEVENLABS_MODELS } from "../tts/providers/elevenlabs.js";
import { getLastAssistantText, preprocessForTts } from "../utils.js";
import { setMessageButtonsEnabled, updateSettingsRef as updateMsgBtnSettingsRef, initMessageButtons, setLastAudioBlob, getLastAudioBlob } from "../tts/tts_message_button.js";

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

  // === LMNT 요소 ===
  const lmntSettings = ttsPanel.querySelector('#abgm_tts_lmnt_settings');
  const lmntModelSel = ttsPanel.querySelector('#abgm_tts_lmnt_model');
  const lmntVoiceSel = ttsPanel.querySelector('#abgm_tts_lmnt_voice');
  const lmntSpeedInput = ttsPanel.querySelector('#abgm_tts_lmnt_speed');
  const lmntSpeedVal = ttsPanel.querySelector('#abgm_tts_lmnt_speed_val');
  const lmntApiKeyInput = ttsPanel.querySelector('#abgm_tts_lmnt_apikey');

  // === ElevenLabs 요소 ===
  const elevenlabsSettings = ttsPanel.querySelector('#abgm_tts_elevenlabs_settings');
  const elevenlabsModelSel = ttsPanel.querySelector('#abgm_tts_elevenlabs_model');
  const elevenlabsVoiceSel = ttsPanel.querySelector('#abgm_tts_elevenlabs_voice');
  const elevenlabsStabilityInput = ttsPanel.querySelector('#abgm_tts_elevenlabs_stability');
  const elevenlabsStabilityVal = ttsPanel.querySelector('#abgm_tts_elevenlabs_stability_val');
  const elevenlabsSimilarityInput = ttsPanel.querySelector('#abgm_tts_elevenlabs_similarity');
  const elevenlabsSimilarityVal = ttsPanel.querySelector('#abgm_tts_elevenlabs_similarity_val');
  const elevenlabsApiKeyInput = ttsPanel.querySelector('#abgm_tts_elevenlabs_apikey');

  // === 메시지 버튼 토글 요소 ===
  const msgButtonToggle = ttsPanel.querySelector('#abgm_tts_msg_button_toggle');
  const msgButtonOptions = ttsPanel.querySelector('#abgm_tts_msg_button_options');
  const msgReadModeSel = ttsPanel.querySelector('#abgm_tts_msg_read_mode');

  // === settings.ttsMode 구조 보장 ===
  settings.ttsMode ??= {};
  settings.ttsMode.provider ??= "";
  settings.ttsMode.providers ??= {};
  settings.ttsMode.providers.qwen ??= {};
  settings.ttsMode.providers.openai ??= {};
  settings.ttsMode.providers.gemini ??= {};
  settings.ttsMode.providers.lmnt ??= {};
  settings.ttsMode.providers.elevenlabs ??= {};
  settings.ttsMode.msgButtonEnabled ??= false;
  settings.ttsMode.msgButtonReadMode ??= "dialogue";
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
  fillVoiceSelect(lmntVoiceSel, LMNT_VOICES, "lily");
  fillVoiceSelect(elevenlabsVoiceSel, ELEVENLABS_VOICES, "21m00Tcm4TlvDq8ikWAM");
  // 모델도 채우기
  if (elevenlabsModelSel && elevenlabsModelSel.options.length === 0) {
    ELEVENLABS_MODELS.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.name;
      elevenlabsModelSel.appendChild(opt);
    });
  }

  function updateTtsUI() {
    const provider = settings.ttsMode?.provider || "";
    
    // Provider 드롭다운
    if (providerSel) providerSel.value = provider;
    
    // Provider 설정 박스 show/hide
    if (qwenSettings) qwenSettings.style.display = (provider === 'qwen') ? 'block' : 'none';
    if (openaiSettings) openaiSettings.style.display = (provider === 'openai') ? 'block' : 'none';
    if (geminiSettings) geminiSettings.style.display = (provider === 'gemini') ? 'block' : 'none';
    if (lmntSettings) lmntSettings.style.display = (provider === 'lmnt') ? 'block' : 'none';
    if (elevenlabsSettings) elevenlabsSettings.style.display = (provider === 'elevenlabs') ? 'block' : 'none';
    
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

    // LMNT 값 복원
    if (provider === 'lmnt') {
      const s = settings.ttsMode.providers.lmnt;
      if (lmntModelSel) lmntModelSel.value = s.model || "blizzard";
      if (lmntVoiceSel) lmntVoiceSel.value = s.voice || "lily";
      if (lmntSpeedInput) lmntSpeedInput.value = s.speed ?? 1.0;
      if (lmntSpeedVal) lmntSpeedVal.textContent = `${s.speed ?? 1.0}x`;
      if (lmntApiKeyInput) lmntApiKeyInput.value = s.apiKey || "";
    }

  // ElevenLabs 값 복원
  if (provider === 'elevenlabs') {
    const s = settings.ttsMode.providers.elevenlabs;
    if (elevenlabsModelSel) elevenlabsModelSel.value = s.model || "eleven_flash_v2_5";
    if (elevenlabsVoiceSel) elevenlabsVoiceSel.value = s.voice || "21m00Tcm4TlvDq8ikWAM";
    if (elevenlabsStabilityInput) elevenlabsStabilityInput.value = s.stability ?? 0.5;
    if (elevenlabsStabilityVal) elevenlabsStabilityVal.textContent = s.stability ?? 0.5;
    if (elevenlabsSimilarityInput) elevenlabsSimilarityInput.value = s.similarityBoost ?? 0.75;
    if (elevenlabsSimilarityVal) elevenlabsSimilarityVal.textContent = s.similarityBoost ?? 0.75;
    if (elevenlabsApiKeyInput) elevenlabsApiKeyInput.value = s.apiKey || "";
  }

    // 메시지 버튼 토글 상태 복원
    if (msgButtonToggle) {
      msgButtonToggle.checked = settings.ttsMode.msgButtonEnabled || false;
    }
    if (msgButtonOptions) {
      msgButtonOptions.style.display = settings.ttsMode.msgButtonEnabled ? 'block' : 'none';
    }
    if (msgReadModeSel) {
      msgReadModeSel.value = settings.ttsMode.msgButtonReadMode || 'dialogue';
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

  // === LMNT 설정 이벤트 ===
  lmntSettings?.addEventListener('input', (e) => {
    const s = settings.ttsMode.providers.lmnt;
    if (!s) return;
    if (e.target.id === 'abgm_tts_lmnt_model') s.model = e.target.value;
    if (e.target.id === 'abgm_tts_lmnt_voice') s.voice = e.target.value;
    if (e.target.id === 'abgm_tts_lmnt_speed') {
      s.speed = parseFloat(e.target.value);
      if (lmntSpeedVal) lmntSpeedVal.textContent = `${s.speed}x`;
    }
    if (e.target.id === 'abgm_tts_lmnt_apikey') s.apiKey = e.target.value;
    _saveSettingsDebounced();
  });

  // === ElevenLabs 설정 이벤트 ===
  elevenlabsSettings?.addEventListener('input', (e) => {
    const s = settings.ttsMode.providers.elevenlabs;
    if (!s) return;
    if (e.target.id === 'abgm_tts_elevenlabs_model') s.model = e.target.value;
    if (e.target.id === 'abgm_tts_elevenlabs_voice') s.voice = e.target.value;
    if (e.target.id === 'abgm_tts_elevenlabs_stability') {
      s.stability = parseFloat(e.target.value);
      if (elevenlabsStabilityVal) elevenlabsStabilityVal.textContent = s.stability;
    }
    if (e.target.id === 'abgm_tts_elevenlabs_similarity') {
      s.similarityBoost = parseFloat(e.target.value);
      if (elevenlabsSimilarityVal) elevenlabsSimilarityVal.textContent = s.similarityBoost;
    }
    if (e.target.id === 'abgm_tts_elevenlabs_apikey') s.apiKey = e.target.value;
    _saveSettingsDebounced();
  });

  // TTS 테스트
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
  // === 마지막 오디오 다운로드 ===
  speakBtn?.addEventListener('click', async () => {
    const blob = getLastAudioBlob();
    if (!blob) {
      if (speakStatus) {
        speakStatus.textContent = "❌ 다운로드할 오디오가 없습니다. 먼저 TTS를 재생해주세요.";
        speakStatus.style.color = "#ff6666";
      }
      return;
    }
    try {
      // 다운로드 링크 생성
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `tts_${Date.now()}.mp3`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      if (speakStatus) {
        speakStatus.textContent = "✅ 다운로드 완료!";
        speakStatus.style.color = "#66ff66";
      }
    } catch (e) {
      console.error("[MyaPl] Download error:", e);
      if (speakStatus) {
        speakStatus.textContent = `❌ 다운로드 실패: ${e.message}`;
        speakStatus.style.color = "#ff6666";
      }
    }
  });
  // === 메시지 버튼 토글 이벤트 ===
  msgButtonToggle?.addEventListener('change', (e) => {
    settings.ttsMode.msgButtonEnabled = e.target.checked;
    // 옵션 영역 표시/숨김
    if (msgButtonOptions) {
      msgButtonOptions.style.display = e.target.checked ? 'block' : 'none';
    }
    // 실제 버튼 활성화/비활성화
    setMessageButtonsEnabled(e.target.checked);
    _saveSettingsDebounced();
  });
  msgReadModeSel?.addEventListener('change', (e) => {
    settings.ttsMode.msgButtonReadMode = e.target.value;
    _saveSettingsDebounced();
  });
  // settings 참조 업데이트 (tts_message_button.js에 전달)
  updateMsgBtnSettingsRef(settings);
  // 저장된 설정에 따라 메시지 버튼 초기화
  initMessageButtons(settings);
}
