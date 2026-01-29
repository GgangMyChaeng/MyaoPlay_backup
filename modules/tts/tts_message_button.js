/**
 * tts_message_button.js
 * AI 메시지에 TTS 버튼 삽입 및 관리
 * 위치: modules/tts/tts_message_button.js
 */

import { providers as ttsProviders } from "./providers/index.js";
import { preprocessForTts } from "../utils.js";
import { ensureSettings } from "../settings.js";

// 의존성
let _settings = null;
let _saveSettingsDebounced = () => {};

// 현재 재생 중인 오디오
let currentAudio = null;
let currentPlayingBtn = null;

/**
 * 의존성 주입
 */
export function bindMessageButtonDeps(deps = {}) {
  if (deps.settings) _settings = deps.settings;
  if (typeof deps.saveSettingsDebounced === "function") {
    _saveSettingsDebounced = deps.saveSettingsDebounced;
  }
}

/**
 * settings 참조 업데이트 (외부에서 호출)
 */
export function updateSettingsRef(settings) {
  _settings = settings;
}

/**
 * 대사만 추출 (따옴표 안의 텍스트)
 * @param {string} text - 원본 텍스트
 * @returns {string[]} - 대사 배열
 */
function extractDialogues(text) {
  const dialogues = [];
  
  // 다양한 따옴표 패턴 지원
  // "대사", "대사", 「대사」, 『대사』, "대사"
  const patterns = [
    /"([^"]+)"/g,      // 한국어 큰따옴표
    /"([^"]+)"/g,      // 영어 큰따옴표
    /「([^」]+)」/g,    // 일본어 낫표
    /『([^』]+)』/g,    // 일본어 겹낫표
    /'([^']+)'/g,      // 영어 작은따옴표 (대사용)
  ];
  
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const dialogue = match[1].trim();
      if (dialogue.length > 0) {
        dialogues.push(dialogue);
      }
    }
  }
  
  // 중복 제거 및 순서 유지 (원본 텍스트에서의 위치 기준)
  // 간단하게 Set으로 중복만 제거
  return [...new Set(dialogues)];
}

/**
 * TTS 재생
 * @param {string} text - 읽을 텍스트
 * @param {HTMLElement} btn - 버튼 요소 (상태 표시용)
 */
async function playTts(text, btn) {
  const _settings = ensureSettings();
  if (!_settings?.ttsMode) {
    console.warn("[MyaPl] TTS settings not found");
    return;
  }
  const providerId = _settings.ttsMode.provider;
  const provider = ttsProviders[providerId];
  if (!provider) {
    console.error("[MyaPl] TTS provider not found:", providerId);
    return;
  }
  // 이전 재생 중지
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
    if (currentPlayingBtn) {
      currentPlayingBtn.classList.remove("is-playing");
      currentPlayingBtn.textContent = "🔊";
    }
  }
  // 같은 버튼 다시 누르면 정지만
  if (currentPlayingBtn === btn) {
    currentPlayingBtn = null;
    return;
  }
  try {
    btn.classList.add("is-playing");
    btn.textContent = "⏹️";
    currentPlayingBtn = btn;
    // provider settings 가져오기
    const providerSettings = _settings.ttsMode.providers?.[providerId] || {};
    // 텍스트 전처리
    const processedText = preprocessForTts(text);
    if (!processedText || processedText.length === 0) {
      console.warn("[MyaPl] No text to speak after preprocessing");
      btn.classList.remove("is-playing");
      btn.textContent = "🔊";
      currentPlayingBtn = null;
      return;
    }
    console.log("[MyaPl] TTS Message Button - Playing:", {
      provider: providerId,
      textLength: processedText.length,
      preview: processedText.substring(0, 50) + "..."
    });
    // TTS 호출
    const audioUrl = await provider.getAudioUrl(processedText, providerSettings);
    // 오디오 재생
    currentAudio = new Audio(audioUrl);
    currentAudio.onended = () => {
      btn.classList.remove("is-playing");
      btn.textContent = "🔊";
      currentPlayingBtn = null;
      currentAudio = null;
      URL.revokeObjectURL(audioUrl);
    };
    currentAudio.onerror = (e) => {
      console.error("[MyaPl] Audio playback error:", e);
      btn.classList.remove("is-playing");
      btn.textContent = "🔊";
      currentPlayingBtn = null;
      currentAudio = null;
    };
    await currentAudio.play();
  } catch (e) {
    console.error("[MyaPl] TTS error:", e);
    btn.classList.remove("is-playing");
    btn.textContent = "🔊";
    currentPlayingBtn = null;
  }
}

/**
 * 메시지 요소에 TTS 버튼 추가
 * @param {HTMLElement} messageEl - 메시지 컨테이너 요소
 */
function addTtsButtonToMessage(messageEl) {
  // 이미 버튼이 있으면 스킵
  if (messageEl.querySelector(".myaoplay-msg-tts-btn")) return;

  // 버튼 영역 찾기 (SillyTavern의 메시지 버튼 영역)
  // 연두색으로 표시한 영역: .mes_buttons 또는 유사한 클래스
  const buttonArea = messageEl.querySelector(".mes_buttons, .mes_block .mes_text + div, .extraMesButtons");
  
  if (!buttonArea) {
    // 대안: 메시지 텍스트 영역 찾아서 그 옆에 삽입
    const mesText = messageEl.querySelector(".mes_text");
    if (mesText && mesText.parentElement) {
      // 버튼 영역이 없으면 새로 만들거나 스킵
      console.log("[MyaPl] Button area not found for message");
      return;
    }
    return;
  }

  // TTS 버튼 생성
  const ttsBtn = document.createElement("button");
  ttsBtn.className = "myaoplay-msg-tts-btn";
  ttsBtn.textContent = "🔊";
  ttsBtn.title = "TTS로 읽기";
  ttsBtn.type = "button";

  // 클릭 이벤트
  ttsBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();

    // 메시지 텍스트 가져오기
    const mesText = messageEl.querySelector(".mes_text");
    if (!mesText) {
      console.warn("[MyaPl] Message text not found");
      return;
    }

    const fullText = mesText.innerText || mesText.textContent || "";
    
    // 읽기 모드에 따라 처리
    const _settings = ensureSettings();
    const readMode = _settings?.ttsMode?.msgButtonReadMode || "dialogue";
    
    let textToRead = "";
    
    if (readMode === "dialogue") {
      // 대사만 추출
      const dialogues = extractDialogues(fullText);
      if (dialogues.length === 0) {
        console.log("[MyaPl] No dialogues found in message");
        // 대사가 없으면 전체 텍스트 사용? 아니면 알림?
        // 일단 알림
        alert("이 메시지에서 대사를 찾을 수 없습니다.");
        return;
      }
      // 대사들을 연결 (나중에 순차 재생으로 변경 가능)
      textToRead = dialogues.join(" ");
    } else {
      // 전체 (나중에 구현)
      textToRead = fullText;
    }

    await playTts(textToRead, ttsBtn);
  });

  // 버튼 영역 앞쪽에 삽입
  buttonArea.insertBefore(ttsBtn, buttonArea.firstChild);
}

/**
 * 모든 AI 메시지에 TTS 버튼 추가
 */
export function addTtsButtonsToAllMessages() {
  const _settings = ensureSettings();
  if (!_settings?.ttsMode?.msgButtonEnabled) return;

  // AI 메시지만 선택 (is_user가 아닌 것)
  const messages = document.querySelectorAll(".mes:not(.is_user)");
  
  messages.forEach(msg => {
    addTtsButtonToMessage(msg);
  });
  
  console.log(`[MyaPl] Added TTS buttons to ${messages.length} messages`);
}

/**
 * 모든 TTS 버튼 제거
 */
export function removeTtsButtonsFromAllMessages() {
  const buttons = document.querySelectorAll(".myaoplay-msg-tts-btn");
  buttons.forEach(btn => btn.remove());
  console.log(`[MyaPl] Removed ${buttons.length} TTS buttons`);
}

/**
 * 새 메시지 감지를 위한 MutationObserver 설정
 */
let messageObserver = null;

export function startMessageObserver() {
  if (messageObserver) return;

  const chatContainer = document.querySelector("#chat");
  if (!chatContainer) {
    console.warn("[MyaPl] Chat container not found");
    return;
  }

  messageObserver = new MutationObserver((mutations) => {
    const _settings = ensureSettings();
    if (!_settings?.ttsMode?.msgButtonEnabled) return;

    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          // 새로 추가된 메시지 확인
          if (node.classList?.contains("mes") && !node.classList?.contains("is_user")) {
            addTtsButtonToMessage(node);
          }
          // 내부에 메시지가 있는 경우
          const innerMsgs = node.querySelectorAll?.(".mes:not(.is_user)");
          innerMsgs?.forEach(msg => addTtsButtonToMessage(msg));
        }
      }
    }
  });

  messageObserver.observe(chatContainer, {
    childList: true,
    subtree: true
  });

  console.log("[MyaPl] Message observer started");
}

export function stopMessageObserver() {
  if (messageObserver) {
    messageObserver.disconnect();
    messageObserver = null;
    console.log("[MyaPl] Message observer stopped");
  }
}

/**
 * 토글 상태에 따라 활성화/비활성화
 */
export function setMessageButtonsEnabled(enabled) {
  if (enabled) {
    addTtsButtonsToAllMessages();
    startMessageObserver();
  } else {
    removeTtsButtonsFromAllMessages();
    stopMessageObserver();
    // 재생 중이면 중지
    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }
    if (currentPlayingBtn) {
      currentPlayingBtn.classList.remove("is-playing");
      currentPlayingBtn = null;
    }
  }
}

/**
 * 초기화 (확장 로드 시 호출)
 */
export function initMessageButtons(settings) {
  const _settings = ensureSettings();
  if (settings?.ttsMode?.msgButtonEnabled) {
    // 약간의 딜레이 후 실행 (DOM 로드 대기)
    setTimeout(() => {
      addTtsButtonsToAllMessages();
      startMessageObserver();
    }, 1000);
  }
}
