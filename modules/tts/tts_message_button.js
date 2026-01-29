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
let _delegationSetup = false;

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
 * 이벤트 위임 설정 (document 레벨에서 한 번만)
 */
function setupEventDelegation() {
  if (_delegationSetup) return;
  _delegationSetup = true;
  document.addEventListener("click", async (e) => {
    const btn = e.target.closest(".myaoplay-msg-tts-btn");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    console.log("[MyaPl] TTS Button clicked! (delegation)");
    // 메시지 컨테이너 찾기
    const messageEl = btn.closest(".mes");
    if (!messageEl) {
      console.warn("[MyaPl] Message container not found");
      return;
    }
    // 메시지 텍스트 가져오기
    const mesText = messageEl.querySelector(".mes_text");
    if (!mesText) {
      console.warn("[MyaPl] Message text not found");
      return;
    }
    const fullText = mesText.innerText || mesText.textContent || "";
    // 읽기 모드에 따라 처리
    const settings = ensureSettings();
    const readMode = settings?.ttsMode?.msgButtonReadMode || "dialogue";
    let textToRead = "";
    if (readMode === "dialogue") {
      const dialogues = extractDialogues(fullText);
      if (dialogues.length === 0) {
        console.log("[MyaPl] No dialogues found in message");
        alert("이 메시지에서 대사를 찾을 수 없습니다.");
        return;
      }
      textToRead = dialogues.join(" ");
    } else {
      textToRead = fullText;
    }
    await playTts(textToRead, btn);
  });
  console.log("[MyaPl] Event delegation setup complete");
}



/**
 * 메시지 요소에 TTS 버튼 추가
 * @param {HTMLElement} messageEl - 메시지 컨테이너 요소
 */
function addTtsButtonToMessage(messageEl) {
  // 이미 버튼이 있으면 스킵
  if (messageEl.querySelector(".myaoplay-msg-tts-btn")) return;
  // 버튼 영역 찾기
  const buttonArea = messageEl.querySelector(".mes_buttons, .extraMesButtons");
  if (!buttonArea) {
    return;
  }
  // TTS 버튼 생성 (이벤트는 delegation으로 처리)
  const ttsBtn = document.createElement("div");
  ttsBtn.className = "myaoplay-msg-tts-btn mes_button";
  ttsBtn.textContent = "🔊";
  ttsBtn.title = "TTS로 읽기";
  ttsBtn.style.cursor = "pointer";
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
  let addedCount = 0;
  messages.forEach(msg => {
    // 이미 버튼 있으면 스킵
    if (msg.querySelector(".myaoplay-msg-tts-btn")) return;
    addTtsButtonToMessage(msg);
    addedCount++;
  });
  // 실제로 추가했을 때만 로그
  if (addedCount > 0) {
    console.log(`[MyaPl] Added TTS buttons to ${addedCount} new messages`);
  }
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
  // 기존 observer 정리
  if (messageObserver) {
    messageObserver.disconnect();
    messageObserver = null;
  }
  const chatContainer = document.querySelector("#chat");
  if (!chatContainer) {
    console.warn("[MyaPl] Chat container not found, will retry");
    // 채팅방이 아직 안 열렸으면 나중에 다시 시도
    setTimeout(() => startMessageObserver(), 1000);
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
            setTimeout(() => addTtsButtonToMessage(node), 50); // 약간 딜레이
          }
          // 내부에 메시지가 있는 경우
          const innerMsgs = node.querySelectorAll?.(".mes:not(.is_user)");
          innerMsgs?.forEach(msg => setTimeout(() => addTtsButtonToMessage(msg), 50));
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
  // 이벤트 위임 설정 (최초 1회)
  setupEventDelegation();
  // ST 이벤트 등록 (최초 1회)
  registerSTEvents();
  const s = ensureSettings();
  if (s?.ttsMode?.msgButtonEnabled) {
    setTimeout(() => {
      addTtsButtonsToAllMessages();
      startMessageObserver();
    }, 1000);
  }
}

/**
 * ST 이벤트 기반 자동 초기화
 * - chatLoaded: 채팅방 로드/전환 시
 * - CHARACTER_MESSAGE_RENDERED: 새 AI 메시지 렌더링 시
 */
let _stEventsRegistered = false;

export function registerSTEvents() {
  if (_stEventsRegistered) return;
  _stEventsRegistered = true;
  // ST 이벤트 타입 가져오기
  const eventSource = window.eventSource;
  const event_types = window.event_types;
  if (!eventSource || !event_types) {
    console.warn("[MyaPl] ST event system not found, falling back to interval check");
    // fallback: 주기적으로 체크
    setInterval(() => {
      const settings = ensureSettings();
      if (settings?.ttsMode?.msgButtonEnabled) {
        addTtsButtonsToAllMessages();
      }
    }, 2000);
    return;
  }
  // 채팅방 로드/전환 시
  eventSource.on(event_types.CHAT_CHANGED, () => {
    console.log("[MyaPl] CHAT_CHANGED event");
    setTimeout(() => {
      const settings = ensureSettings();
      if (settings?.ttsMode?.msgButtonEnabled) {
        // observer 재시작 (새 #chat 컨테이너에 연결)
        stopMessageObserver();
        addTtsButtonsToAllMessages();
        startMessageObserver();
      }
    }, 500); // DOM 렌더링 대기
  });
  // 새 AI 메시지 렌더링 시
  eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, () => {
    console.log("[MyaPl] CHARACTER_MESSAGE_RENDERED event");
    const settings = ensureSettings();
    if (settings?.ttsMode?.msgButtonEnabled) {
      // 약간의 딜레이 후 버튼 추가 (DOM 안정화 대기)
      setTimeout(() => addTtsButtonsToAllMessages(), 100);
    }
  });
  console.log("[MyaPl] ST events registered for TTS message buttons");
}
