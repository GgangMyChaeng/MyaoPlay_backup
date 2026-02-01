/**
 * ui_settings_modal.js
 * 설정 모달 메인 허브
 * - 탭 시스템, 공통 헬퍼, 의존성 주입, 자식 모듈 조립
 */

import { ensureSettings, migrateLegacyDataUrlsToIDB, migrateNamesToNFC } from "./settings.js";
import { saveSettingsDebounced } from "./deps.js";
import { openFreeSourcesModal, initFreeSourcesInPanel } from "./ui_freesources.js";

// 분리된 자식 모듈 import
import { bindPresetPanelDeps, initPresetEvents, renderPresetSelect, renderDefaultSelect, maybeSetDefaultOnFirstAdd } from "./settings_modal/preset.js";
import { bindPlaylistPanelDeps, initPlaylistEvents, renderBgmTable, setPlayButtonsLocked, rerenderAll } from "./settings_modal/playlist.js";
import { bindModesPanelDeps, initModePanel } from "./settings_modal/modes.js";



// fallback(안전망) - 실제론 index.js에서 주입됨
let _getBgmSort = (settings) => String(settings?.ui?.presetSort ?? settings?.ui?.bgmSort ?? "added_asc");
let _getSortedBgms = (preset, sortKey) => (preset?.bgms ?? []);
let _getActivePreset = (settings) =>
  (settings?.activePresetId && settings?.presets?.[settings.activePresetId]) ||
  Object.values(settings?.presets || {})[0] ||
  {};
let _setPlayButtonsLocked = setPlayButtonsLocked;
let _saveSettingsDebounced = saveSettingsDebounced;

let _renderDefaultSelect = renderDefaultSelect;
let _rerenderAll = rerenderAll;
let _updateNowPlayingUI = () => {};
let _engineTick = () => {};
let _setDebugMode = () => {};
let _playAsset = async (_fileKey, _volume01) => {};

let _uid = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

let _abgmConfirm = async (_root, msg) => window.confirm(String(msg || ""));
let _abgmPrompt = async (_root, _title, { value = "" } = {}) =>
  window.prompt(String(_title || ""), String(value ?? "")) ?? null;

let _getSTContextSafe = () => ({});
let _getChatKeyFromContext = () => "default";

let _exportPresetFile = (preset) => ({ type: "autobgm_preset", version: 3, exportedAt: new Date().toISOString(), preset });
let _rekeyPreset = (p) => p;
let _pickPresetFromImportData = (d) => d?.preset ?? null;

let _basenameNoExt = (s = "") => (String(s).split("/").pop() || "").replace(/\.[^/.]+$/, "");
let _clone = (o) => JSON.parse(JSON.stringify(o ?? null));

let _dropboxToRaw = (u) => u;
let _importZip = async () => [];
let _isFileKeyReferenced = () => false;
let _maybeSetDefaultOnFirstAdd = maybeSetDefaultOnFirstAdd;
let _abgmPickPreset = async () => "";

let _abgmGetDurationSecFromBlob = async () => 0;
let _idbPut = async () => {};
let _idbDel = async () => {};
let _idbPutImage = async () => {};
let _idbDelImage = async () => {};
let _ensureAssetList = (settings) => {
  settings.assets ??= {};
  return settings.assets;
};

let _fitModalToHost = () => {};
let _getModalHost = () => document.body;
let _EXT_BIND_KEY = "autobgm_binding";

let _getEntryName = (bgm) => {
  const n = String(bgm?.name ?? "").trim();
  if (n) return n;
  const fk = String(bgm?.fileKey ?? "").trim();
  return fk || "(unknown)";
};
let _ensureBgmNames = (_preset) => {};
let _getRequestHeaders = () => ({});



/** ========================= 이미지 헬퍼 ========================= */
function _countImageKeyRefs(settings, imageKey) {
  const key = String(imageKey ?? "").trim();
  if (!key) return 0;
  let n = 0;
  for (const p of Object.values(settings?.presets ?? {})) {
    for (const b of (p?.bgms ?? [])) {
      if (String(b?.imageAssetKey ?? "") === key) n++;
    }
  }
  return n;
}

function _newImageAssetKey() {
  return "img_" + _uid();
}



/** ========================= 볼륨 갱신 헬퍼 ========================= */
function _findEntryByFileKeyAnywhere(settings, fk) {
  const key = String(fk ?? "").trim();
  if (!key) return null;
  const ap = _getActivePreset(settings);
  const hit1 = (ap?.bgms ?? []).find(b => String(b?.fileKey ?? "") === key);
  if (hit1) return hit1;
  for (const p of Object.values(settings?.presets ?? {})) {
    const hit = (p?.bgms ?? []).find(b => String(b?.fileKey ?? "") === key);
    if (hit) return hit;
  }
  return null;
}

function _calcVol01(settings, fk) {
  const gv = Number(settings?.globalVolume ?? 0.7);
  const entry = _findEntryByFileKeyAnywhere(settings, fk);
  const pv = Number(entry?.volume ?? 1);
  const vol = (Number.isFinite(gv) ? gv : 0.7) * (Number.isFinite(pv) ? pv : 1);
  return Math.max(0, Math.min(1, vol));
}

function _applyLiveVolumeForKey(settings, fk) {
  const key = String(fk ?? "").trim();
  if (!key) return;
  const bus = window.__ABGM_AUDIO_BUS__;
  if (!bus) return;
  const v = _calcVol01(settings, key);
  try {
    if (bus.engine && String(bus.engine.dataset?.currentFileKey ?? "") === key) {
      bus.engine.volume = v;
    }
  } catch {}
  try {
    if (bus.sfx && String(bus.sfx.dataset?.currentFileKey ?? "") === key) {
      bus.sfx.volume = v;
    }
  } catch {}
  try {
    if (bus.preview && String(bus.preview.dataset?.currentFileKey ?? "") === key) {
      bus.preview.volume = v;
    }
  } catch {}
}

function _applyLiveVolumeForCurrentAudios(settings) {
  const bus = window.__ABGM_AUDIO_BUS__;
  if (!bus) return;
  const ek = bus.engine?.dataset?.currentFileKey;
  if (ek) _applyLiveVolumeForKey(settings, ek);
  const sk = bus.sfx?.dataset?.currentFileKey;
  if (sk) _applyLiveVolumeForKey(settings, sk);
  const pk = bus.preview?.dataset?.currentFileKey;
  if (pk) _applyLiveVolumeForKey(settings, pk);
}

/** ========================= 의존성 주입 ========================= */
export function abgmBindSettingsModalDeps(deps = {}) {
  if (typeof deps.getBgmSort === "function") _getBgmSort = deps.getBgmSort;
  if (typeof deps.getSortedBgms === "function") _getSortedBgms = deps.getSortedBgms;
  if (typeof deps.getActivePreset === "function") _getActivePreset = deps.getActivePreset;
  if (typeof deps.setPlayButtonsLocked === "function") _setPlayButtonsLocked = deps.setPlayButtonsLocked;
  if (typeof deps.saveSettingsDebounced === "function") _saveSettingsDebounced = deps.saveSettingsDebounced;
  if (typeof deps.renderDefaultSelect === "function") _renderDefaultSelect = deps.renderDefaultSelect;
  if (typeof deps.rerenderAll === "function") _rerenderAll = deps.rerenderAll;
  if (typeof deps.updateNowPlayingUI === "function") _updateNowPlayingUI = deps.updateNowPlayingUI;
  if (typeof deps.engineTick === "function") _engineTick = deps.engineTick;
  if (typeof deps.setDebugMode === "function") _setDebugMode = deps.setDebugMode;
  if (typeof deps.playAsset === "function") _playAsset = deps.playAsset;
  if (typeof deps.uid === "function") _uid = deps.uid;
  if (typeof deps.abgmConfirm === "function") _abgmConfirm = deps.abgmConfirm;
  if (typeof deps.abgmPrompt === "function") _abgmPrompt = deps.abgmPrompt;
  if (typeof deps.getSTContextSafe === "function") _getSTContextSafe = deps.getSTContextSafe;
  if (typeof deps.getChatKeyFromContext === "function") _getChatKeyFromContext = deps.getChatKeyFromContext;
  if (typeof deps.exportPresetFile === "function") _exportPresetFile = deps.exportPresetFile;
  if (typeof deps.rekeyPreset === "function") _rekeyPreset = deps.rekeyPreset;
  if (typeof deps.pickPresetFromImportData === "function") _pickPresetFromImportData = deps.pickPresetFromImportData;
  if (typeof deps.basenameNoExt === "function") _basenameNoExt = deps.basenameNoExt;
  if (typeof deps.clone === "function") _clone = deps.clone;
  if (typeof deps.dropboxToRaw === "function") _dropboxToRaw = deps.dropboxToRaw;
  if (typeof deps.importZip === "function") _importZip = deps.importZip;
  if (typeof deps.isFileKeyReferenced === "function") _isFileKeyReferenced = deps.isFileKeyReferenced;
  if (typeof deps.maybeSetDefaultOnFirstAdd === "function") _maybeSetDefaultOnFirstAdd = deps.maybeSetDefaultOnFirstAdd;
  if (typeof deps.abgmPickPreset === "function") _abgmPickPreset = deps.abgmPickPreset;
  if (typeof deps.abgmGetDurationSecFromBlob === "function") _abgmGetDurationSecFromBlob = deps.abgmGetDurationSecFromBlob;
  if (typeof deps.idbPut === "function") _idbPut = deps.idbPut;
  if (typeof deps.idbDel === "function") _idbDel = deps.idbDel;
  if (typeof deps.idbPutImage === "function") _idbPutImage = deps.idbPutImage;
  if (typeof deps.idbDelImage === "function") _idbDelImage = deps.idbDelImage;
  if (typeof deps.ensureAssetList === "function") _ensureAssetList = deps.ensureAssetList;
  if (typeof deps.fitModalToHost === "function") _fitModalToHost = deps.fitModalToHost;
  if (typeof deps.getModalHost === "function") _getModalHost = deps.getModalHost;
  if (typeof deps.EXT_BIND_KEY === "string") _EXT_BIND_KEY = deps.EXT_BIND_KEY;
  if (typeof deps.getEntryName === "function") _getEntryName = deps.getEntryName;
  if (typeof deps.ensureBgmNames === "function") _ensureBgmNames = deps.ensureBgmNames;
  if (typeof deps.getRequestHeaders === "function") _getRequestHeaders = deps.getRequestHeaders;

  // 자식 모듈들에게 의존성 전달
  const childDeps = {
    getActivePreset: _getActivePreset,
    getSortedBgms: _getSortedBgms,
    getBgmSort: _getBgmSort,
    saveSettingsDebounced: _saveSettingsDebounced,
    uid: _uid,
    abgmConfirm: _abgmConfirm,
    abgmPrompt: _abgmPrompt,
    updateNowPlayingUI: _updateNowPlayingUI,
    engineTick: _engineTick,
    playAsset: _playAsset,
    clone: _clone,
    dropboxToRaw: _dropboxToRaw,
    isFileKeyReferenced: _isFileKeyReferenced,
    abgmPickPreset: _abgmPickPreset,
    abgmGetDurationSecFromBlob: _abgmGetDurationSecFromBlob,
    idbPut: _idbPut,
    idbDel: _idbDel,
    idbPutImage: _idbPutImage,
    idbDelImage: _idbDelImage,
    ensureAssetList: _ensureAssetList,
    importZip: _importZip,
    basenameNoExt: _basenameNoExt,
    getEntryName: _getEntryName,
    ensureBgmNames: _ensureBgmNames,
    countImageKeyRefs: _countImageKeyRefs,
    newImageAssetKey: _newImageAssetKey,
    applyLiveVolumeForKey: _applyLiveVolumeForKey,
    getSTContextSafe: _getSTContextSafe,
    exportPresetFile: _exportPresetFile,
    rekeyPreset: _rekeyPreset,
    pickPresetFromImportData: _pickPresetFromImportData,
    EXT_BIND_KEY: _EXT_BIND_KEY,
    rerenderAll: (root, settings) => rerenderAll(root, settings),
  };

  bindPresetPanelDeps(childDeps);
  bindPlaylistPanelDeps(childDeps);
  bindModesPanelDeps(childDeps);
}



/** ========================= 도움말(Help) 토글 ========================= */
function setupHelpToggles(root) {
  const helps = [
    ["abgm_modal_help_toggle", "abgm_modal_help"],
    ["abgm_bgm_help_toggle", "abgm_bgm_help"],
  ];
  const boxes = helps
    .map(([, boxId]) => root.querySelector(`#${boxId}`))
    .filter(Boolean);

  function closeAll(exceptEl = null) {
    for (const el of boxes) {
      if (exceptEl && el === exceptEl) continue;
      el.style.display = "none";
    }
  }
  for (const [btnId, boxId] of helps) {
    const btn = root.querySelector(`#${btnId}`);
    const box = root.querySelector(`#${boxId}`);
    if (!btn || !box) continue;
    if (btn.dataset.abgmHelpBound === "1") continue;
    btn.dataset.abgmHelpBound = "1";
    if (!box.style.display) box.style.display = "none";
    btn.addEventListener("click", () => {
      const isOpen = box.style.display !== "none";
      if (isOpen) {
        box.style.display = "none";
      } else {
        closeAll(box);
        box.style.display = "block";
      }
    });
  }
}

/** ========================= 모달 초기화 (이벤트 바인딩 본체) ========================= */
export function initModal(overlay) {
  const root = overlay;
  const settings = ensureSettings();

  // ===== Tab System =====
  const TAB_IDS = ['main', 'mode', 'sources', 'theme', 'about'];
  const savedTab = settings.settingsActiveTab || 'main';
  
  function switchTab(tabId) {
    if (!TAB_IDS.includes(tabId)) tabId = 'main';
    root.querySelectorAll('.myaoplay-tab-btn').forEach(btn => {
      const isActive = btn.dataset.tab === tabId;
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
      btn.setAttribute('tabindex', isActive ? '0' : '-1');
    });
    root.querySelectorAll('.myaoplay-tab-panel').forEach(panel => {
      const isActive = panel.id === `myaoplay-panel-${tabId}`;
      panel.classList.toggle('is-active', isActive);
    });
    settings.settingsActiveTab = tabId;
    _saveSettingsDebounced();
  }
  
  root.querySelectorAll('.myaoplay-tab-btn').forEach((btn, idx) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    btn.addEventListener('keydown', (e) => {
      let newIdx = idx;
      if (e.key === 'ArrowRight') newIdx = (idx + 1) % TAB_IDS.length;
      else if (e.key === 'ArrowLeft') newIdx = (idx - 1 + TAB_IDS.length) % TAB_IDS.length;
      else if (e.key === 'Home') newIdx = 0;
      else if (e.key === 'End') newIdx = TAB_IDS.length - 1;
      else return;
      e.preventDefault();
      switchTab(TAB_IDS[newIdx]);
      root.querySelector(`#myaoplay-tab-${TAB_IDS[newIdx]}`)?.focus();
    });
  });
  switchTab(savedTab);

  // ===== Modal Power Button (Extension Toggle) =====
  const modalPowerBtn = root.querySelector('#abgm_modal_enabled_btn');
  const modalPowerImg = root.querySelector('#abgm_modal_enabled_img');
  if (modalPowerBtn && modalPowerImg) {
    const ICON_ON = "https://i.postimg.cc/6qDv8VHV/Myao_Play_On.png";
    const ICON_OFF = "https://i.postimg.cc/tg5WBxTb/Myao_Play_Off.png";
    const updateModalPowerUI = () => {
      const enabled = !!settings.enabled;
      modalPowerImg.src = enabled ? ICON_ON : ICON_OFF;
      modalPowerBtn.title = enabled ? 'Enabled: ON' : 'Enabled: OFF';
    };
    updateModalPowerUI();
    modalPowerBtn.addEventListener('click', () => {
      settings.enabled = !settings.enabled;
      _saveSettingsDebounced();
      updateModalPowerUI();
      if (typeof window.__abgmSyncEnabledUI === 'function') {
        window.__abgmSyncEnabledUI();
      }
    });
  }

  // ===== Theme Toggle =====
  const themeBtns = root.querySelectorAll('.abgm-theme-btn');
  const applyTheme = (theme) => {
    if (theme === 'dark') {
      document.body.setAttribute('data-abgm-theme', 'dark');
    } else {
      document.body.removeAttribute('data-abgm-theme');
    }
    themeBtns.forEach(btn => {
      btn.classList.toggle('is-active', btn.dataset.theme === theme);
    });
    settings.modalTheme = theme;
    _saveSettingsDebounced();
  };
  themeBtns.forEach(btn => {
    btn.addEventListener('click', () => applyTheme(btn.dataset.theme));
  });
  applyTheme(settings.modalTheme || 'light');

  // ===== Font Select =====
  const fontSelect = root.querySelector('#abgm_font_select');
  const fontPreview = root.querySelector('#abgm_font_preview');
  const applyFont = (fontName) => {
    document.documentElement.style.setProperty('--abgm-font', `'${fontName}', sans-serif`);
    if (fontPreview) fontPreview.style.fontFamily = `'${fontName}', sans-serif`;
    settings.font = fontName;
    _saveSettingsDebounced();
  };
  if (fontSelect) {
    fontSelect.addEventListener('change', (e) => applyFont(e.target.value));
    const savedFont = settings.font || 'Noto Sans KR';
    fontSelect.value = savedFont;
    applyFont(savedFont);

    // ===== Font Size =====
    const fontSizeSlider = root.querySelector('#abgm_font_size');
    const fontSizeVal = root.querySelector('#abgm_font_size_val');
    const fontSizeBtns = root.querySelectorAll('[data-fontsize]');
    const applyFontSize = (size) => {
      const s = Math.max(80, Math.min(120, Number(size) || 100));
      document.documentElement.style.setProperty('--abgm-font-size', `${s}%`);
      if (fontSizeSlider) fontSizeSlider.value = s;
      if (fontSizeVal) fontSizeVal.textContent = `${s}%`;
      if (fontPreview) fontPreview.style.fontSize = `${s}%`;
      settings.fontSize = s;
      _saveSettingsDebounced();
    };
    if (fontSizeSlider) {
      fontSizeSlider.addEventListener('input', (e) => applyFontSize(e.target.value));
    }
    fontSizeBtns.forEach(btn => {
      btn.addEventListener('click', () => applyFontSize(btn.dataset.fontsize));
    });
    applyFontSize(settings.fontSize || 100);

    // ===== Font Weight =====
    const fontWeightSlider = root.querySelector('#abgm_font_weight');
    const fontWeightVal = root.querySelector('#abgm_font_weight_val');
    const fontWeightBtns = root.querySelectorAll('.abgm-fontweight-btn');
    const applyFontWeight = (weight) => {
      const w = Math.max(100, Math.min(900, Number(weight) || 400));
      document.documentElement.style.setProperty('--abgm-font-weight', w);
      if (fontWeightSlider) fontWeightSlider.value = w;
      if (fontWeightVal) fontWeightVal.textContent = w;
      if (fontPreview) fontPreview.style.fontWeight = w;
      settings.fontWeight = w;
      _saveSettingsDebounced();
    };
    if (fontWeightSlider) {
      fontWeightSlider.addEventListener('input', (e) => applyFontWeight(e.target.value));
    }
    fontWeightBtns.forEach(btn => {
      btn.addEventListener('click', () => applyFontWeight(btn.dataset.fontweight));
    });
    applyFontWeight(settings.fontWeight || 400);
  }

  // ===== Mode Panel (모드 탭) 초기화 =====
  initModePanel(root, settings);

  // ===== Free Sources (소스 탭) 초기화 =====
  const sourcesPanel = root.querySelector('#myaoplay-panel-sources');
  if (sourcesPanel) {
    initFreeSourcesInPanel(sourcesPanel, settings);
  }

  // ===== Selection State =====
  root.__abgmSelected = new Set();
  root.__abgmExpanded = new Set();
  const updateSelectionUI = () => {
    const preset = _getActivePreset(settings);
    const list = _getSortedBgms(preset, _getBgmSort(settings));
    const selected = root.__abgmSelected;
    const countEl = root.querySelector("#abgm_selected_count");
    if (countEl) countEl.textContent = `${selected.size} selected`;
    const allChk = root.querySelector("#abgm_sel_all");
    if (allChk) {
      const total = list.length;
      const checked = list.filter((b) => selected.has(b.id)).length;
      allChk.checked = total > 0 && checked === total;
      allChk.indeterminate = checked > 0 && checked < total;
    }
  };
  root.__abgmUpdateSelectionUI = updateSelectionUI;

  // 구버전 dataUrl 있으면 IndexedDB로 옮김
  migrateLegacyDataUrlsToIDB(settings).catch(() => {});
  migrateNamesToNFC(settings);

  // ===== 상단 옵션 =====
  const kw = root.querySelector("#abgm_keywordMode");
  const dbg = root.querySelector("#abgm_debugMode");
  const pm = root.querySelector("#abgm_playMode");
  const gv = root.querySelector("#abgm_globalVol");
  const gvText = root.querySelector("#abgm_globalVolText");
  const gvLock = root.querySelector("#abgm_globalVol_lock");
  const useDef = root.querySelector("#abgm_useDefault");

  if (kw) kw.checked = !!settings.keywordMode;
  if (dbg) dbg.checked = !!settings.debugMode;
  window.__abgmDebugMode = !!settings.debugMode;
  if (pm) {
    pm.value = settings.playMode ?? "manual";
    pm.disabled = !!settings.keywordMode;
    pm.addEventListener("change", (e) => {
      settings.playMode = e.target.value;
      _saveSettingsDebounced();
    });
  }
  if (kw) {
    kw.addEventListener("change", (e) => {
      settings.keywordMode = !!e.target.checked;
      if (pm) pm.disabled = !!settings.keywordMode;
      _setPlayButtonsLocked(root, !!settings.keywordMode);
      _saveSettingsDebounced();
    });
  }
  if (dbg) {
    dbg.addEventListener("change", (e) => {
      settings.debugMode = !!e.target.checked;
      window.__abgmDebugMode = !!settings.debugMode;
      if (!window.__abgmDebugMode) window.__abgmDebugLine = "";
      _saveSettingsDebounced();
      _updateNowPlayingUI();
    });
  }

  // ===== Global Volume + Lock =====
  settings.globalVolLocked ??= false;
  const syncGlobalVolUI = () => {
    const locked = !!settings.globalVolLocked;
    if (gv) gv.disabled = locked;
    if (gvLock) {
      gvLock.classList.toggle("abgm-locked", locked);
      gvLock.title = locked ? "Global Volume Locked" : "Lock Global Volume";
      const icon = gvLock.querySelector("i");
      if (icon) {
        icon.classList.toggle("fa-lock", locked);
        icon.classList.toggle("fa-lock-open", !locked);
      }
    }
  };
  if (gv) gv.value = String(Math.round((settings.globalVolume ?? 0.7) * 100));
  if (gvText) gvText.textContent = gv?.value ?? "70";
  syncGlobalVolUI();
  gv?.addEventListener("input", (e) => {
    if (settings.globalVolLocked) return;
    const v = Number(e.target.value);
    settings.globalVolume = Math.max(0, Math.min(1, v / 100));
    if (gvText) gvText.textContent = String(v);
    _applyLiveVolumeForCurrentAudios(settings);
    _saveSettingsDebounced();
    _engineTick();
  });
  gvLock?.addEventListener("click", () => {
    settings.globalVolLocked = !settings.globalVolLocked;
    _saveSettingsDebounced();
    syncGlobalVolUI();
  });
  if (useDef) useDef.checked = !!settings.useDefault;
  useDef?.addEventListener("change", (e) => {
    settings.useDefault = !!e.target.checked;
    _saveSettingsDebounced();
  });

  // ===== Sort =====
  const sortSel = root.querySelector("#abgm_sort");
  if (sortSel) {
    sortSel.value = _getBgmSort(settings);
    sortSel.addEventListener("change", (e) => {
      settings.ui ??= {};
      settings.ui.presetSort = e.target.value;
      _saveSettingsDebounced();
      rerenderAll(root, settings);
    });
  }

  // ===== License =====
  const licToggle = root.querySelector("#abgm_np_license_toggle");
  const licText = root.querySelector("#abgm_np_license_text");
  licToggle?.addEventListener("click", () => {
    if (!licText) return;
    const on = licText.style.display !== "none";
    licText.style.display = on ? "none" : "block";
  });

  // Free Sources 버튼 -> 소스 탭으로 전환
  const freeBtnNew = root.querySelector("#abgm_free_open");
  if (freeBtnNew) {
    freeBtnNew.addEventListener("click", (e) => {
      e.preventDefault();
      switchTab('sources');
    });
  }
  root.querySelector("#abgm_open_freesources")?.addEventListener("click", openFreeSourcesModal);

  // ===== 자식 모듈 이벤트 바인딩 =====
  initPresetEvents(root, settings, ensureSettings);
  initPlaylistEvents(root, settings);

  // 키보드/주소창 변화 대응
  overlay.addEventListener("focusin", () => {
    requestAnimationFrame(() => _fitModalToHost(overlay, _getModalHost()));
    setTimeout(() => _fitModalToHost(overlay, _getModalHost()), 120);
  });

  rerenderAll(root, settings);
  setupHelpToggles(root);
} // initModal 닫기
