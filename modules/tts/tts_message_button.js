/**
 * tts_message_button.js
 * AI 메시지에 TTS 버튼 삽입 및 관리
 * 위치: modules/tts/tts_message_button.js
 */

import { providers as ttsProviders } from "./providers/index.js";
import { preprocessForTts } from "../utils.js";
import { ensureSettings } from "../settings.js";

// 현재 재생 중인 오디오
let currentAudio = null;
let currentPlayingBtn = null;

/**
 * settings 가져오기 (항상 최신)
 */
function getSettings() {
  return ensureSettings();
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
  
  // 중복 제거
  return [...new Set(dialogues)];
}

/**
 * TTS 재생
 * @param {string} text - 읽을 텍스트
 * @param {HTMLElement} btn - 버튼 요소 (상태 표시용)
 */
async function playTts(text, btn) {
  const settings = getSettings();
  
  if (!settings?.ttsMode) {
    console.warn("[MyaPl] TTS settings not found");
    return;
  }

  const providerId = settings.ttsMode.provider;
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
    const providerSettings = settings.ttsMode.providers?.[providerId] || {};
    
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
  const buttonArea = messageEl.querySelector(".mes_buttons, .mes_block .mes_text + div, .extraMesButtons");
  
  if (!buttonArea) {
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

    const settings = getSettings();

    // 메시지 텍스트 가져오기
    const mesText = messageEl.querySelector(".mes_text");
    if (!mesText) {
      console.warn("[MyaPl] Message text not found");
      return;
    }

    const fullText = mesText.innerText || mesText.textContent || "";
    
    // 읽기 모드에 따라 처리
    const readMode = settings?.ttsMode?.msgButtonReadMode || "dialogue";
    
    let textToRead = "";
    
    if (readMode === "dialogue") {
      // 대사만 추출
      const dialogues = extractDialogues(fullText);
      if (dialogues.length === 0) {
        console.log("[MyaPl] No dialogues found in message");
        alert("이 메시지에서 대사를 찾을 수 없습니다.");
        return;
      }
      // 대사들을 연결
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
  const settings = getSettings();
  if (!settings?.ttsMode?.msgButtonEnabled) return;

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
    console.warn("[MyaPl] Chat container not found, will retry...");
    // 나중에 다시 시도
    setTimeout(startMessageObserver, 2000);
    return;
  }

  messageObserver = new MutationObserver((mutations) => {
    const settings = getSettings();
    if (!settings?.ttsMode?.msgButtonEnabled) return;

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
 * 수동 초기화 (외부에서 호출 가능)
 */
export function initMessageButtons() {
  const settings = getSettings();
  
  if (settings?.ttsMode?.msgButtonEnabled) {
    console.log("[MyaPl] Initializing message TTS buttons...");
    addTtsButtonsToAllMessages();
    startMessageObserver();
  }
}

// ========================================
// 자동 초기화 - 문서 로드 후 실행
// ========================================
function autoInit() {
  const settings = getSettings();
  
  if (settings?.ttsMode?.msgButtonEnabled) {
    console.log("[MyaPl] Auto-initializing message TTS buttons...");
    // DOM이 완전히 로드된 후 실행
    setTimeout(() => {
      addTtsButtonsToAllMessages();
      startMessageObserver();
    }, 1500);
  }
}

// 문서 로드 상태에 따라 자동 초기화
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", autoInit);
} else {
  // 이미 로드됨 - 약간 딜레이 후 실행
  setTimeout(autoInit, 1000);
}
