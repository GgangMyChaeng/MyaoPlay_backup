/*
  MyaoPlay (SillyTavern Extension)
  - Dynamic dependency resolver so it works in both layouts:
    /scripts/extensions/<ext>/...
    /scripts/extensions/third-party/<ext>/...
*/

/** =================================================================================== */
import { abgmNormTags, abgmNormTag, tagVal, tagPretty, tagCat, sortTags } from "./modules/tags.js";
import { extension_settings, saveSettingsDebounced, __abgmResolveDeps, getSTContextSafe, getBoundPresetIdFromContext, EXT_BIND_KEY, getRequestHeaders } from "./modules/deps.js";
import { openDb, idbPut, idbGet, idbDel, ensureAssetList, importZip, abgmGetDurationSecFromBlob, idbPutImage, idbGetImage, idbDelImage, checkIdbIntegrity, listIdbKeys } from "./modules/storage.js";
import { ensureSettings, migrateLegacyDataUrlsToIDB, ensureEngineFields, exportPresetFile, rekeyPreset, pickPresetFromImportData, getActivePromptContent } from "./modules/settings.js";
import { abgmBindFloatingActions, createFloatingButton, removeFloatingButton, removeFloatingMenu, openFloatingMenu, closeFloatingMenu, updateFloatingButtonPosition, abgmGetFloatingMenuEl, updateMenuDebugIcon, toggleDebugToast, setDebugToastText } from "./modules/ui_floating.js";
import { abgmBindNowPlayingDeps, updateNowPlayingUI, bindNowPlayingEventsOnce, openNowPlayingGlass, closeNowPlayingGlass } from "./modules/ui_nowplaying.js";
import { abgmBindModalDeps, openModal, closeModal, fitModalToHost, getModalHost, fitModalToViewport, abgmConfirm, abgmPrompt, abgmPickPreset } from "./modules/ui_modal.js";
import { initModal, abgmBindSettingsModalDeps } from "./modules/ui_settings_modal.js";
import { abgmBindFreeSourcesDeps, closeFreeSourcesModal, bootFreeSourcesSync, syncFreeSourcesFromJson, syncBundledFreeSourcesIntoSettings } from "./modules/ui_freesources.js";
import { abgmBindEngineDeps, getBgmAudio, getEngineCurrentFileKey, getEngineCurrentPresetId, stopRuntime, togglePlayPause, ensurePlayFile, engineTick, startEngine, setEngineCurrentFileKey, pickRandomKey } from "./modules/engine.js";
import { uid, basenameNoExt, escapeHtml, isProbablyUrl, dropboxToRaw, clamp01, clone, parseKeywords, getChatKeyFromContext, getLastAssistantText, makeAsstSig } from "./modules/utils.js";
import { getActivePreset, getEntryName, ensureBgmNames, getBgmSort, getPresetSort, getSortedBgms, getSortedKeys, findBgmByKey, abgmCycleBgmSort, abgmSortNice, isFileKeyReferenced } from "./modules/state.js";
import { initMessageButtons } from "./modules/tts/tts_message_button.js";
/** =================================================================================== */



/** ====================== ST 확장메뉴(window.html) 아이콘 ====================== */
const ABGM_DRAWER_ICON = {
  enabledOn:  "https://i.postimg.cc/6qDv8VHV/Myao_Play_On.png",
  enabledOff: "https://i.postimg.cc/tg5WBxTb/Myao_Play_Off.png",

  // floating은 on/off를 따로 안 쓸 거면 둘 다 같은 URL로
  floatingOn:  "https://i.postimg.cc/P5Dxmj6T/Floating.png",
  floatingOff: "https://i.postimg.cc/P5Dxmj6T/Floating.png",
};



/** ====================== 테스트 재생 (index.js에 남김) ====================== */
// 테스트 오디오 객체
const _testAudio = new Audio();
let _testUrl = "";

// preview(테스트 재생)도 audio bus에 등록
window.__ABGM_AUDIO_BUS__ ??= { engine: null, freesrc: null, preview: null };
window.__ABGM_AUDIO_BUS__.preview = _testAudio;

// preview 재생 시작하면: 엔진(BGM)은 stop 말고 pause만
_testAudio.addEventListener("play", () => {
  window.abgmStopOtherAudio?.("preview");
  const eng = window.__ABGM_AUDIO_BUS__?.engine;
  if (eng && !eng.paused) {
    eng.__abgmPausedByPreview = true;
    eng.pause();
  }
});

// preview 끝나면 표시 해제
const _clearPreviewFlag = () => {
  const eng = window.__ABGM_AUDIO_BUS__?.engine;
  if (eng) eng.__abgmPausedByPreview = false;
};
_testAudio.addEventListener("ended", _clearPreviewFlag)

// 파일키나 URL로 테스트 재생 (모달에서 Play 버튼 누를 때)
async function playAsset(fileKey, volume01) {
  const fk = String(fileKey ?? "").trim();
  if (!fk) return;
  _testAudio.dataset.currentFileKey = fk;
  // 1) URL이면 그대로 재생
  if (isProbablyUrl(fk)) {
    if (_testUrl) URL.revokeObjectURL(_testUrl);
    _testUrl = ""; // 2) url은 revoke 대상 아님
    _testAudio.pause();
    _testAudio.currentTime = 0;
    _testAudio.src = fk;
    const v = Number(volume01);
    _testAudio.volume = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
    _testAudio.play().catch(() => {});
    return;
  }
  // 3) 파일키면 기존대로 IDB
  const blob = await idbGet(fk);
  if (!blob) {
    console.warn("[MyaPl] missing asset:", fk);
    return;
  }
  if (_testUrl) URL.revokeObjectURL(_testUrl);
  _testUrl = URL.createObjectURL(blob);
  _testAudio.pause();
  _testAudio.currentTime = 0;
  _testAudio.src = _testUrl;
  _testAudio.volume = Math.max(0, Math.min(1, volume01));
  _testAudio.play().catch(() => {});
}



/** ====================== 오디오 배타 제어 (index.js에 남김) ====================== */
// 메인/프리소스/테스트 중 하나만 재생되게 (다른 건 페이드아웃)
window.abgmStopOtherAudio = function(kind) {
  const bus = window.__ABGM_AUDIO_BUS__;
  if (!bus) return;
  const FADE_MS = 120;
  const hardStop = (a) => {
    try {
      if (!a) return;
      a.pause?.();
      a.currentTime = 0;
    } catch {}
  };
  const fadeStop = (a, ms = FADE_MS) => {
    try {
      if (!a) return;
      if (a.__abgmFadeRAF) cancelAnimationFrame(a.__abgmFadeRAF);
      a.__abgmFadeToken = (a.__abgmFadeToken || 0) + 1;
      const token = a.__abgmFadeToken;
      const v0 = Number(a.volume ?? 1);
      if (!Number.isFinite(v0) || v0 <= 0 || a.paused || ms <= 0) {
        hardStop(a);
        return;
      }
      const t0 = performance.now();
      const tick = (now) => {
        if (a.__abgmFadeToken !== token) return;
        const p = Math.min(1, (now - t0) / ms);
        try { a.volume = Math.max(0, v0 * (1 - p)); } catch {}
        if (p < 1 && !a.paused) a.__abgmFadeRAF = requestAnimationFrame(tick);
        else {
          hardStop(a);
          try { a.volume = v0; } catch {}
        }
      };
      a.__abgmFadeRAF = requestAnimationFrame(tick);
    } catch {
      hardStop(a);
    }
  };
  // rules:
  // - freesrc가 켜지면 engine은 꺼도 됨(기존 동작)
  // - preview(test)가 켜질 땐 engine은 "pause"로 따로 처리하니까 여기선 건드리지 말자
  if (kind !== "engine" && kind !== "preview") fadeStop(bus.engine);
  // 나머진 다 서로 배타
  if (kind !== "freesrc") fadeStop(bus.freesrc);
  if (kind !== "preview") fadeStop(bus.preview);
};



/** ====================== NP 네비게이션 (index.js에 남김) ====================== */
// NP에서 쓸 공통 컨텍스트 가져오기 (preset, keys, volume 등)
function abgmGetNavCtx() {
  try {
    const settings = ensureSettings();
    ensureEngineFields(settings);
    const ctx = getSTContextSafe();
    const chatKey = getChatKeyFromContext(ctx);
    settings.chatStates[chatKey] ??= {
      currentKey: "",
      listIndex: 0,
      lastSig: "",
      defaultPlayedSig: "",
      prevKey: "",
    };
    const st = settings.chatStates[chatKey];
    let preset = settings.presets?.[settings.activePresetId];
    if (!preset) preset = Object.values(settings.presets ?? {})[0];
    if (!preset) return null;
    const sort = getBgmSort(settings);
    const keys = getSortedKeys(preset, sort);
    const defKey = String(preset.defaultBgmKey ?? "");
    const getVol = (fk) => {
      const b = findBgmByKey(preset, fk);
      return clamp01((settings.globalVolume ?? 0.7) * (b?.volume ?? 1));
    };
    return { settings, ctx, chatKey, st, preset, keys, defKey, getVol };
  } catch {
    return null;
  }
}

// NP Prev 버튼 액션 (키워드 모드면 Use Default 토글)
function abgmNpPrevAction() {
  const info = abgmGetNavCtx();
  if (!info) return;
  const { settings, st, preset, keys, defKey, getVol } = info;
  if (!settings.enabled) return;
  // 1) 키워드 모드일 시 이전 곡 버튼을 Use Default 토글 버튼으로
  if (settings.keywordMode) {
    settings.useDefault = !settings.useDefault;
    saveSettingsDebounced();
    try { engineTick(); } catch {}
    updateNowPlayingUI();
    return;
  }
  const mode = settings.playMode || "manual";
  if (!keys.length) return;
  const cur = String(getEngineCurrentFileKey() || st.currentKey || "");
  const remember = (nextKey) => {
    if (cur && nextKey && cur !== nextKey) st.prevKey = cur;
  };
  // 2) 랜덤 모드일 시 직전에 재생하던 곡으로
  if (mode === "random") {
    const pk = String(st.prevKey || "");
    if (!pk) return;
    remember(pk);
    st.currentKey = pk;
    setEngineCurrentFileKey(pk);
    ensurePlayFile(pk, getVol(pk), false, preset.id);
    saveSettingsDebounced();
    updateNowPlayingUI();
    return;
  }
  // 3) 아무것도 없을 때
  if (!cur) {
    const startKey = defKey || keys[keys.length - 1] || keys[0] || "";
    if (!startKey) return;
    st.currentKey = startKey;
    if (mode === "loop_list") st.listIndex = Math.max(0, keys.indexOf(startKey));
    setEngineCurrentFileKey(startKey);
    ensurePlayFile(startKey, getVol(startKey), mode === "loop_one", preset.id);
    saveSettingsDebounced();
    updateNowPlayingUI();
    return;
  }
  let idx = keys.indexOf(cur);
  if (idx < 0) idx = Math.max(0, Math.min(Number(st.listIndex || 0), keys.length - 1));
  if (mode === "loop_list") {
    idx = (idx - 1 + keys.length) % keys.length;
    st.listIndex = idx;
  } else {
    // 4) Manual/Loop One: 이전 곡으로, 첫 곡이면 마지막으로 순환
    idx = (idx - 1 + keys.length) % keys.length;
  }
  const nextKey = String(keys[idx] || "");
  if (!nextKey) return;
  remember(nextKey);
  st.currentKey = nextKey;
  setEngineCurrentFileKey(nextKey);
  const loop = (mode === "loop_one");
  ensurePlayFile(nextKey, getVol(nextKey), loop, preset.id);
  saveSettingsDebounced();
  updateNowPlayingUI();
}

// NP Next 버튼 액션 (키워드 모드면 keywordOnce 토글)
function abgmNpNextAction() {
  const info = abgmGetNavCtx();
  if (!info) return;
  const { settings, st, preset, keys, defKey, getVol } = info;
  if (!settings.enabled) return;
  // 1) 키워드 모드일 시 다음 곡 버튼을 키워드 로직 토글 버튼으로 (hold ↔ once)
  if (settings.keywordMode) {
    settings.keywordOnce = !settings.keywordOnce;
    saveSettingsDebounced();
    try { engineTick(); } catch {}
    updateNowPlayingUI();
    return;
  }
  const mode = settings.playMode || "manual";
  if (!keys.length) return;
  const cur = String(getEngineCurrentFileKey() || st.currentKey || "");
  const remember = (nextKey) => {
    if (cur && nextKey && cur !== nextKey) st.prevKey = cur;
  };
  // 2) 아무것도 없을 때
  if (!cur) {
    const startKey = defKey || keys[0] || "";
    if (!startKey) return;
    st.currentKey = startKey;
    if (mode === "loop_list") st.listIndex = Math.max(0, keys.indexOf(startKey));
    setEngineCurrentFileKey(startKey);
    ensurePlayFile(startKey, getVol(startKey), mode === "loop_one", preset.id);
    saveSettingsDebounced();
    updateNowPlayingUI();
    return;
  }
  // 3) 랜덤 모드일 시 = 당연 random (avoid current)
  if (mode === "random") {
    const nextKey = pickRandomKey(keys, cur);
    if (!nextKey) return;
    remember(nextKey);
    st.currentKey = nextKey;
    setEngineCurrentFileKey(nextKey);
    ensurePlayFile(nextKey, getVol(nextKey), false, preset.id);
    saveSettingsDebounced();
    updateNowPlayingUI();
    return;
  }
  let idx = keys.indexOf(cur);
  if (idx < 0) idx = Math.max(0, Math.min(Number(st.listIndex || 0), keys.length - 1));
  if (mode === "loop_list") {
    idx = (idx + 1) % keys.length;
    st.listIndex = idx;
  } else {
    // 4) Manual/Loop One: 다음 곡으로, 마지막이면 첫 곡으로 순환
    idx = (idx + 1) % keys.length;
  }
  const nextKey = String(keys[idx] || "");
  if (!nextKey) return;
  remember(nextKey);
  st.currentKey = nextKey;
  setEngineCurrentFileKey(nextKey);
  const loop = (mode === "loop_one");
  ensurePlayFile(nextKey, getVol(nextKey), loop, preset.id);
  saveSettingsDebounced();
  updateNowPlayingUI();
}



/** ====================== UI 업데이트 훅 (index.js에 남김) ====================== */
// Now Playing 전역 변수
let _abgmNowPlayingBound = false;
// 디버그 상태 전역 변수들
let __abgmDebugLine = ""; // 키워드 모드 디버깅
let __abgmDebugMode = false;
let _engineLastPresetId = "";

// 모달의 Now Playing 제목만 간단히 업데이트
function updateModalNowPlayingSimple(title) {
  const el = document.getElementById("abgm_now_title");
  if (!el) return;
  el.textContent = String(title ?? "(none)");
}

// 플로팅 메뉴의 NP 아이콘 애니메이션 (재생 중이면 회전)
function updateMenuNPAnimation() {
  const menu = abgmGetFloatingMenuEl();
  if (!menu) return;
  const icon = menu.querySelector(".abgm-menu-icon-np");
  if (!icon) return;
  const isPlaying = !!getEngineCurrentFileKey() && !getBgmAudio().paused;
  icon.classList.toggle("is-playing", isPlaying);
}

// 디버그 모드 토글
function toggleDebugMode() {
  const s = ensureSettings();
  s.debugMode = !s.debugMode;
  __abgmDebugMode = !!s.debugMode;
  window.__abgmDebugMode = __abgmDebugMode;
  if (!__abgmDebugMode) {
    __abgmDebugLine = "";
    toggleDebugToast(false);  // 1) 토스트 숨김
  } else {
    toggleDebugToast(true);   // 2) 토스트 보임
    setDebugToastText("Debug mode ON");
  }
  saveSettingsDebounced();
  updateMenuDebugIcon();
  updateNowPlayingUI();
}

// 디버그 라인 가져오기
function getDebugLine() {
  return __abgmDebugLine;
}

// 디버그 라인 설정 (키워드 매칭 정보 표시)
function setDebugLine(text) {
  __abgmDebugLine = String(text || "");
  if (__abgmDebugMode) {
    setDebugToastText(__abgmDebugLine);
  }
}



/** ====================== 마법봉 메뉴 버튼 ====================== */
function addWandMenuButton() {
  const MENU_ID = "myaoplay-wand-item";
  if (document.getElementById(MENU_ID)) return;
  const menu = document.getElementById("extensionsMenu");
  if (!menu) {
    // 메뉴 없으면 1초 후 재시도 (최대 10회)
    if ((addWandMenuButton._retry ?? 0) < 10) {
      addWandMenuButton._retry = (addWandMenuButton._retry ?? 0) + 1;
      setTimeout(addWandMenuButton, 1000);
    }
    return;
  }
  const item = document.createElement("div");
  item.id = MENU_ID;
  item.className = "list-group-item flex-container flexGap5 interactable";
  item.innerHTML = `<i class="fa-solid fa-music extensionsMenuExtensionButton"></i> MyaoPlay`;
  item.onclick = () => {
    openFloatingMenu();
    menu.style.display = "none";
  };
  menu.appendChild(item);
}



/** ====================== 템플릿 로더 (index.js에 남김) ====================== */
// HTML 템플릿 파일 로드 (popup.html, window.html 등)
async function loadHtml(relPath) {
  const url = new URL(relPath, import.meta.url);
  url.searchParams.set("v", String(Date.now())); // > 캐시 버스터
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Template fetch failed: ${res.status} ${url}`);
  return await res.text();
}



/** ====================== 초기화 / 부팅 (index.js에 남김) ====================== */
// 확장 메뉴(drawer) 마운트
async function mount() {
  const host = document.querySelector("#extensions_settings");
  if (!host) return;
  // 1) 이미 붙었으면 끝
  if (document.getElementById("autobgm-root")) return;
  // 2) mount 레이스 방지 (핵심)
  if (window.__AUTOBGM_MOUNTING__) return;
  window.__AUTOBGM_MOUNTING__ = true;
  try {
    const settings = ensureSettings();
    let html;
    try {
      html = await loadHtml("templates/window.html");
    } catch (e) {
      console.error("[MyaPl] window.html load failed", e);
      return;
    }
    // 3) 혹시 레이스로 여기 도달 전에 다른 mount가 붙였으면 종료
    if (document.getElementById("autobgm-root")) return;
    const root = document.createElement("div");
    root.id = "autobgm-root";
    root.innerHTML = html;
  host.appendChild(root);
  // ===== Enabled / Floating만 바인딩 =====
  const enabledBtn = root.querySelector("#autobgm_enabled_btn");
  const enabledImg = root.querySelector("#autobgm_enabled_img");
  const enabledState = root.querySelector("#autobgm_enabled_state");
  const floatingToggle = root.querySelector("#autobgm_floating_toggle");
  const floatingImg = root.querySelector("#autobgm_floating_img");
  const floatingState = root.querySelector("#autobgm_floating_state");
  if (!enabledBtn || !enabledImg || !floatingToggle || !floatingImg) return;
  const syncEnabledUI = () => {
    const s = ensureSettings();
    const on = !!s.enabled;
    if (enabledState) enabledState.textContent = on ? "On" : "Off";
    enabledImg.src = on ? ABGM_DRAWER_ICON.enabledOn : ABGM_DRAWER_ICON.enabledOff;
    enabledBtn.title = on ? "Enabled: ON" : "Enabled: OFF";
  };
  const syncFloatingUI = () => {
    const s = ensureSettings();
    const on = !!s.floating.enabled;
    if (floatingState) floatingState.textContent = on ? "On" : "Off";
    floatingImg.src = on ? ABGM_DRAWER_ICON.floatingOn : ABGM_DRAWER_ICON.floatingOff;
    floatingToggle.title = on ? "Floating Button: ON" : "Floating Button: OFF";
  };
  // 1) 초기 UI
  syncEnabledUI();
  syncFloatingUI();
  // 모달에서도 호출할 수 있게 전역 노출
  window.__abgmSyncEnabledUI = syncEnabledUI;
  // 2) Enabled 토글 로직 (기존 로직 유지)
  enabledBtn.addEventListener("click", () => {
    const s = ensureSettings();
    s.enabled = !s.enabled;
    saveSettingsDebounced();
    syncEnabledUI();
    if (!s.enabled) {
      stopRuntime();          // OFF면 즉시 정리
    } else {
      try { engineTick(); } catch {}
    }
    updateNowPlayingUI();
  });
  // 3) Floating 토글 로직 (기존 로직 유지)
  floatingToggle.addEventListener("click", () => {
    const s = ensureSettings();
    s.floating.enabled = !s.floating.enabled;
    saveSettingsDebounced();
    syncFloatingUI();
    if (s.floating.enabled) createFloatingButton();
    else removeFloatingButton();
  });
  // 기존대로 유지(전체 UI 업데이트/이벤트 바인딩)
  bindNowPlayingEventsOnce();
  updateNowPlayingUI();
  // console.log("[MyaPl] mounted OK");
  } finally {
    window.__AUTOBGM_MOUNTING__ = false;
  }
} // > 마운트 닫기

// 앱 초기화 (의존성 주입 + 부팅 + 엔진 시작)
async function init() {
  // console.log("[MyaPl] init entered");
  // 1) 중복 로드/실행 방지 (메뉴 2개 뜨는 거 방지)
  if (window.__AUTOBGM_BOOTED__) return;
  window.__AUTOBGM_BOOTED__ = true;
  bindDepsOnce();
  await bootFreeSourcesSync();
  // === IDB 무결성 체크 추가 ===
  try {
    const settings = ensureSettings();
    const result = await checkIdbIntegrity(settings);
    if (result.missing.length > 0) {
      console.warn("[MyaPl] IDB integrity check: missing files:", result.missing);
      // 유저에게 경고 토스트 띄우기
      toastr?.warning?.(
        `${result.missing.length}개 파일이 손실되었습니다. 확장 설정에서 다시 추가해주세요.`,
        "MyaoPlay - 파일 손실 감지",
        { timeOut: 10000 }
      );
    }
  } catch (e) {
    console.error("[MyaPl] IDB integrity check failed:", e);
  }
  // === 체크 끝 ===
  mount();
  startEngine();
  // 완드 메뉴
  addWandMenuButton();
  // TTS 메시지 버튼 초기화
  initMessageButtons();
  // 2) 플로팅 버튼 초기화
  const settings = ensureSettings();
  // 테마 초기화 (저장된 테마 적용)
  if (settings.modalTheme === 'dark') {
    document.body.setAttribute('data-abgm-theme', 'dark');
  }
  // 폰트 초기화 (저장된 폰트 적용)
  if (settings.font) {
    document.documentElement.style.setProperty('--abgm-font', `'${settings.font}', sans-serif`);
  }
  // 폰트 크기 초기화
  if (settings.fontSize) {
    document.documentElement.style.setProperty('--abgm-font-size', `${settings.fontSize}%`);
  }
  // 폰트 굵기 초기화
  if (settings.fontWeight) {
    document.documentElement.style.setProperty('--abgm-font-weight', settings.fontWeight);
  }
  // 3) 디버그: 콘솔에서 설정 확인용
  window.__ABGM_DBG__ = {
    getSettings: () => ensureSettings(),
    checkIdb: async () => {
      const s = ensureSettings();
      const result = await checkIdbIntegrity(s);
      console.log("[MyaPl] IDB integrity check:", result);
      if (result.missing.length) {
        console.warn("[MyaPl] Missing files:", result.missing);
      }
      return result;
    },
    listIdbKeys: async () => {
      const keys = await listIdbKeys();
      console.log("[MyaPl] IDB stored keys:", keys);
      return keys;
    },
    // === 새로 추가: 손실된 파일 목록 보기 ===
    findMissingFiles: async () => {
      const s = ensureSettings();
      const result = await checkIdbIntegrity(s);
      console.table(result.missing.map(key => ({
        fileKey: key,
        type: key.startsWith('img_') ? 'Image' : 'Audio',
        action: 'Re-upload required'
      })));
      return result.missing;
    }
  };
  if (settings.floating.enabled) {
    createFloatingButton();
  }
  const obs = new MutationObserver(() => mount());
  obs.observe(document.body, { childList: true, subtree: true });
  // 4) 창 크기 변경 리스너
  window.addEventListener("resize", updateFloatingButtonPosition);
  window.addEventListener("orientationchange", updateFloatingButtonPosition);
  // [ADD] ResizeObserver로 호스트 크기 변화 감지 (다른 확장이 레이아웃 건들 때 대응)
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(() => updateFloatingButtonPosition());
    ro.observe(document.body);
  }

  // 5) {{mya_p}} 매크로 등록 (SillyTavern 커스텀 매크로)
  registerMyaoPlayMacros();
}



/** ====================== SillyTavern 매크로 등록 ====================== */
function registerMyaoPlayMacros() {
  try {
    // SillyTavern.getContext()가 있는지 확인
    if (typeof SillyTavern === 'undefined' || !SillyTavern.getContext) {
      console.warn("[MyaPl] SillyTavern.getContext not available, skipping macro registration");
      return;
    }
    const { registerMacro } = SillyTavern.getContext();
    if (typeof registerMacro !== 'function') {
      console.warn("[MyaPl] registerMacro not available");
      return;
    }
    // {{mya_p}} 매크로: 현재 프롬프트 프리셋 내용 반환
    registerMacro('mya_p', () => {
      const settings = ensureSettings();
      return getActivePromptContent(settings);
    });
    // console.log("[MyaPl] Registered {{mya_p}} macro");
  } catch (e) {
    console.warn("[MyaPl] Failed to register macros:", e);
  }
}



/** ====================== 의존성 바인딩 (index.js에 남김) ====================== */
function bindDepsOnce() {
  if (window.__AUTOBGM_DEPS_BOUND__) return;
  window.__AUTOBGM_DEPS_BOUND__ = true;
  
  abgmBindModalDeps({
    loadHtml,
    initModal,
    bindNowPlayingEventsOnce,
    updateNowPlayingUI,
  });
  
  abgmBindFloatingActions({
    openModal,
    openNowPlayingGlass,
    toggleDebugMode,
    updateMenuNPAnimation,
  });
  
  abgmBindNowPlayingDeps({
    // 1) 상태 읽기
    getBgmAudio: () => getBgmAudio(),
    getEngineCurrentFileKey: () => getEngineCurrentFileKey(),
    getEngineCurrentPresetId: () => getEngineCurrentPresetId(),

    // 2) 엔진/액션
    engineTick: () => engineTick(),
    togglePlayPause: () => togglePlayPause(),
    npPrevAction: () => abgmNpPrevAction(),
    npNextAction: () => abgmNpNextAction(),

    // 3) 모달/호스트
    getModalHost: () => getModalHost(),
    fitModalToHost: (overlay, host) => fitModalToHost(overlay, host),

    // 4) UI 훅
    updateMenuNPAnimation: () => updateMenuNPAnimation(),
    updateModalNowPlayingSimple: (title) => updateModalNowPlayingSimple(title),

    // 5) 플리/정렬/표시 헬퍼들 (ui_nowplaying에서 쓰는 것만 연결)
    getActivePreset: (settings) => getActivePreset(settings),
    getEntryName: (b) => getEntryName(b),
    getSortedBgms: (preset, sortKey) => getSortedBgms(preset, sortKey),
    getSortedKeys: (preset, sortKey) => getSortedKeys(preset, sortKey),
    getBgmSort: (settings) => getBgmSort(settings),
    abgmCycleBgmSort: (settings) => abgmCycleBgmSort(settings),
    abgmSortNice: (k) => abgmSortNice(k),
    ensurePlayFile: (fk, vol01, loop, presetId, autoplay) => ensurePlayFile(fk, vol01, loop, presetId, autoplay),

    // 6) 디버그/컨텍스트
    getDebugMode: () => __abgmDebugMode,
    getDebugLine: () => __abgmDebugLine,
    getSTContextSafe: () => getSTContextSafe(),
    getChatKeyFromContext: (ctx) => getChatKeyFromContext(ctx),
    ensureEngineFields: (settings) => ensureEngineFields(settings),

    // 7) 이미지 헬퍼
    idbGetImage: (bgmId) => idbGetImage(bgmId),
  });
  
  abgmBindFreeSourcesDeps({
    loadHtml,
    ensureSettings,
    saveSettingsDebounced,
    syncFreeSourcesFromJson,
    syncBundledFreeSourcesIntoSettings,
  });
  
  abgmBindSettingsModalDeps({
    getBgmSort: getPresetSort,
    getSortedBgms,
    getActivePreset,
    getEntryName,
    ensureBgmNames,
    saveSettingsDebounced,
    playAsset,
    
    uid,
    abgmConfirm,
    abgmPrompt,
    getSTContextSafe,
    getChatKeyFromContext,
    exportPresetFile,
    rekeyPreset,
    pickPresetFromImportData,
    basenameNoExt,
    clone,
    dropboxToRaw,
    importZip,
    isFileKeyReferenced,
    abgmPickPreset,
    abgmGetDurationSecFromBlob,

    // > storage / modal 쪽
    idbPut,
    idbDel,
    idbPutImage,
    idbDelImage,
    ensureAssetList,
    fitModalToHost,
    getModalHost,
    EXT_BIND_KEY,
    getRequestHeaders,
    
    updateNowPlayingUI,
    engineTick: () => engineTick(),
    setDebugMode: (on) => {
      __abgmDebugMode = !!on;
      if (!__abgmDebugMode) __abgmDebugLine = "";
      window.__abgmDebugMode = __abgmDebugMode;
    }
  });
  
  abgmBindEngineDeps({
    updateNowPlayingUI,
    getSTContextSafe,
    getChatKeyFromContext,
    ensureEngineFields,
    findBgmByKey,
    getSortedKeys,
    getBgmSort,
    makeAsstSig,
    getLastAssistantText,
    setDebugLine,
  });
}



/** ====================== 진입점 (index.js에 남김) ====================== */
// 앱 부트스트랩
(async () => {
  try {
    await __abgmResolveDeps();
    // console.log("[MyaPl] index.js loaded", import.meta.url);
    const onReady = () => init();
    if (typeof jQuery === "function") {
      jQuery(() => onReady());
    } else if (typeof $ === "function") {
      $(() => onReady());
    } else {
      window.addEventListener("DOMContentLoaded", onReady, { once: true });
    }
  } catch (e) {
    console.error("[MyaPl] boot failed", e);
  }
})();
