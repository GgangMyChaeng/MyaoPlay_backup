import { ensureSettings, migrateLegacyDataUrlsToIDB } from "./settings.js";
import { abgmEntryDetailPrompt } from "./ui_modal.js";
import { saveSettingsDebounced } from "./deps.js";
import { openFreeSourcesModal, initFreeSourcesInPanel } from "./ui_freesources.js";
import { escapeHtml } from "./utils.js";



// fallback(안전망) - 실제론 index.js에서 주입됨
let _getBgmSort = (settings) => String(settings?.ui?.presetSort ?? settings?.ui?.bgmSort ?? "added_asc");
let _getSortedBgms = (preset, sortKey) => (preset?.bgms ?? []);
let _getActivePreset = (settings) =>
  (settings?.activePresetId && settings?.presets?.[settings.activePresetId]) ||
  Object.values(settings?.presets || {})[0] ||
  {};
let _setPlayButtonsLocked = () => {};
let _saveSettingsDebounced = saveSettingsDebounced;

let _renderDefaultSelect = () => {};
let _rerenderAll = () => {};
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
let _maybeSetDefaultOnFirstAdd = () => {};
let _abgmPickPreset = async () => "";

let _abgmGetDurationSecFromBlob = async () => 0;
let _idbPut = async () => {};
let _idbDel = async () => {};
let _idbPutImage = async () => {};
let _idbDelImage = async () => {};
let _ensureAssetList = (settings) => {
  settings.assets ??= {};
  return settings.assets; // 반드시 "객체"를 리턴
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

  // 1) 현재 선택 프리셋 우선
  const ap = _getActivePreset(settings);
  const hit1 = (ap?.bgms ?? []).find(b => String(b?.fileKey ?? "") === key);
  if (hit1) return hit1;

  // 2) 전체 프리셋에서 탐색 (프리셋 바인딩 케이스 대비)
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



/** ========================= Tab System Functions ========================= */
// ===== Tab Configuration =====
const SETTINGS_TABS = [
  { id: 'preset', label: '프리셋', icon: '🎵' },
  { id: 'detail', label: '디테일', icon: '⚙️' },
  { id: 'sources', label: '소스', icon: '📁' },
  { id: 'mode', label: '모드', icon: '🎭' },
  { id: 'theme', label: '테마', icon: '🎨' },
];

const DEFAULT_TAB = 'preset';

// @@
function renderTabBar(activeTabId) {
  const tabbar = document.createElement('div');
  tabbar.className = 'myaoplay-settings-tabbar';
  tabbar.setAttribute('role', 'tablist');
  tabbar.setAttribute('aria-label', 'Settings tabs');
  SETTINGS_TABS.forEach((tab, index) => {
    const btn = document.createElement('button');
    btn.className = 'myaoplay-tab-btn' + (tab.id === activeTabId ? ' is-active' : '');
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', tab.id === activeTabId ? 'true' : 'false');
    btn.setAttribute('aria-controls', `myaoplay-tabpanel-${tab.id}`);
    btn.setAttribute('id', `myaoplay-tab-${tab.id}`);
    btn.setAttribute('tabindex', tab.id === activeTabId ? '0' : '-1');
    btn.dataset.tabId = tab.id;
    btn.innerHTML = `<span>${tab.icon}</span> ${tab.label}`;
    btn.addEventListener('click', () => switchTab(tab.id));
    btn.addEventListener('keydown', (e) => handleTabKeyboard(e, index));
    tabbar.appendChild(btn);
  });
  return tabbar;
}


function renderTabPanels(activeTabId) {
  const container = document.createElement('div');
  container.className = 'myaoplay-tab-panels';
  SETTINGS_TABS.forEach(tab => {
    const panel = document.createElement('div');
    panel.className = 'myaoplay-tab-panel' + (tab.id === activeTabId ? ' is-active' : '');
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('id', `myaoplay-tabpanel-${tab.id}`);
    panel.setAttribute('aria-labelledby', `myaoplay-tab-${tab.id}`);
    panel.setAttribute('tabindex', '0');
    // > 각 탭별 콘텐츠 렌더링
    const renderFn = TAB_RENDERERS[tab.id];
    if (renderFn) {
      panel.appendChild(renderFn());
    } else {
      panel.innerHTML = `<p style="color:#999;">[ ${tab.label} 탭 콘텐츠 준비 중 ]</p>`;
    }
    container.appendChild(panel);
  });
  return container;
}


function switchTab(tabId) {
  const modal = document.querySelector('.myaoplay-settings-modal');
  if (!modal) return;
  // 1) 탭 버튼 상태 갱신
  modal.querySelectorAll('.myaoplay-tab-btn').forEach(btn => {
    const isActive = btn.dataset.tabId === tabId;
    btn.classList.toggle('is-active', isActive);
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    btn.setAttribute('tabindex', isActive ? '0' : '-1');
  });
  // 2) 패널 상태 갱신
  modal.querySelectorAll('.myaoplay-tab-panel').forEach(panel => {
    const isActive = panel.id === `myaoplay-tabpanel-${tabId}`;
    panel.classList.toggle('is-active', isActive);
  });
  // 3) 설정에 저장
  saveSettingsTabState(tabId);
  // 4) 스크롤 상단으로
  const body = modal.querySelector('.myaoplay-modal-body');
  if (body) body.scrollTop = 0;
}


function handleTabKeyboard(e, currentIndex) {
  const tabs = SETTINGS_TABS;
  let newIndex = currentIndex;
  if (e.key === 'ArrowRight') {
    newIndex = (currentIndex + 1) % tabs.length;
  } else if (e.key === 'ArrowLeft') {
    newIndex = (currentIndex - 1 + tabs.length) % tabs.length;
  } else if (e.key === 'Home') {
    newIndex = 0;
  } else if (e.key === 'End') {
    newIndex = tabs.length - 1;
  } else {
    return; // 1) 다른 키는 무시
  }
  e.preventDefault();
  const newTabId = tabs[newIndex].id;
  switchTab(newTabId);
  // 2) 새 탭 버튼에 포커스
  const newBtn = document.getElementById(`myaoplay-tab-${newTabId}`);
  if (newBtn) newBtn.focus();
}


function saveSettingsTabState(tabId) {
  // > settings.js의 updateSettings 사용
  if (typeof updateSettings === 'function') {
    updateSettings({ settingsActiveTab: tabId });
  }
}


function getSettingsTabState() {
  const settings = getSettings();
  return settings.settingsActiveTab || DEFAULT_TAB;
}



/** ========================= 의존성 주입 / 안전망 ========================= */
// (표시용) BGM 엔트리 이름 우선, 없으면 fileKey로 라벨 뽑기 (삭제 confirm 같은 데서 씀)
function abgmEntryLabel(bgm) {
  const n = String(bgm?.name ?? "").trim();
  if (n) return n;
  const fk = String(bgm?.fileKey ?? "").trim();
  return fk || "(unknown)";
}

// index.js(또는 바깥)에서 함수/상수 deps 주입 받아서 이 모듈이 단독으로도 안 터지게 연결
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
}



/** ========================= 프리셋 선택 렌더 ========================= */
// 프리셋 셀렉트 옵션 채우고 activePresetId 반영 + 프리셋 이름 input 동기화
function renderPresetSelect(root, settings) {
  const doc = root?.ownerDocument || document;
  const sel = root.querySelector("#abgm_preset_select");
  const nameInput = root.querySelector("#abgm_preset_name");
  if (!sel) return;
  sel.innerHTML = "";
  // > 프리셋 이름순 정렬
  const presetsSorted = Object.values(settings.presets).sort((a, b) =>
    String(a?.name ?? a?.id ?? "").localeCompare(
      String(b?.name ?? b?.id ?? ""),
      undefined,
      { numeric: true, sensitivity: "base" }
    )
  );
  presetsSorted.forEach((p) => {
    const opt = doc.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name || p.id;
    if (p.id === settings.activePresetId) opt.selected = true;
    sel.appendChild(opt);
  });
  if (nameInput) nameInput.value = _getActivePreset(settings).name || "";
}



/** ========================= Default(기본곡) 선택 렌더 ========================= */
// defaultBgmKey 셀렉트 옵션 갱신 (곡 이름/파일키가 보기 좋게 뜨게)
function renderDefaultSelect(root, settings) {
  const doc = root?.ownerDocument || document;
  const preset = _getActivePreset(settings);
  const sel = root.querySelector("#abgm_default_select");
  if (!sel) return;
  const cur = String(preset.defaultBgmKey ?? "");
  const list = _getSortedBgms(preset, _getBgmSort(settings));
  sel.innerHTML = "";
  // ===== (none) =====
  const none = doc.createElement("option");
  none.value = "";
  none.textContent = "(none)";
  sel.appendChild(none);
  // > 현재 default가 룰 목록에 없으면(=missing) 옵션을 하나 만들어서 고정 유지
  if (cur && !list.some((b) => String(b.fileKey ?? "") === cur)) {
    const miss = doc.createElement("option");
    miss.value = cur;
    miss.textContent = `${cur} (missing rule)`;
    sel.appendChild(miss);
  }
  // ===== rules =====
  for (const b of list) {
    const fk = String(b.fileKey ?? "").trim();
    if (!fk) continue;
    const opt = doc.createElement("option");
    opt.value = fk;
    // > 이름 있으면 이름, 없으면 fileKey/URL에서 자동 생성된 표시명
    opt.textContent = _getEntryName(b);
    sel.appendChild(opt);
  }
  sel.value = cur;
}

// “그 프리셋에 첫 곡 들어올 때만” defaultBgmKey 자동 지정 (이미 있으면 절대 안 건드림)
function maybeSetDefaultOnFirstAdd(preset, newFileKey) {
  const cur = String(preset.defaultBgmKey ?? "").trim();
  if (cur) return; // 1) 이미 default가 있으면 절대 건드리지 않음
  const bgmCount = (preset.bgms ?? []).filter(b => String(b?.fileKey ?? "").trim()).length;
  // 2) "첫 곡"일 때만 default 자동 지정
  if (bgmCount <= 1) {
    preset.defaultBgmKey = String(newFileKey ?? "").trim();
  }
}



/** ========================= BGM 테이블 렌더 (목록/행 UI) ========================= */
// 현재 프리셋 bgm 목록을 정렬 기준대로 테이블로 그리기
// + 선택/확장(Set) 상태 유지 + (이 파일 구조상) 일부 상단 옵션/상태도 같이 동기화됨
function renderBgmTable(root, settings) {
  const preset = _getActivePreset(settings);
  const tbody = root.querySelector("#abgm_bgm_tbody");
  if (!tbody) return;
  _ensureBgmNames(preset);
  const selected = root?.__abgmSelected instanceof Set ? root.__abgmSelected : new Set();
  root.__abgmSelected = selected;
  const expanded = root?.__abgmExpanded instanceof Set ? root.__abgmExpanded : new Set();
  root.__abgmExpanded = expanded;
  const list = _getSortedBgms(preset, _getBgmSort(settings));
  tbody.innerHTML = "";
  list.forEach((b) => {
    const isOpen = expanded.has(b.id);
    // ===== summary row (collapsed) =====
    const tr = document.createElement("tr");
    tr.dataset.id = b.id;
    tr.className = `abgm-bgm-summary${isOpen ? " abgm-expanded" : ""}`;
    const entryType = b.type || "BGM";
    const typeLabel = entryType === "SFX" ? "S" : "B";
    const typeTitle = entryType === "SFX" ? "SFX (클릭하여 BGM으로 변경)" : "BGM (클릭하여 SFX로 변경)";
    tr.innerHTML = `
      <td class="abgm-col-check">
        <input type="checkbox" class="abgm_sel" ${selected.has(b.id) ? "checked" : ""}>
      </td>
      <td class="abgm-filecell">
      <input type="text" class="abgm_name" value="${escapeHtml(_getEntryName(b))}" placeholder="Entry name">
      </td>
      <td>
        <div class="menu_button abgm-iconbtn abgm_test" title="Play">
          <i class="fa-solid fa-play"></i>
        </div>
      </td>
      <td>
        <div class="menu_button abgm-iconbtn abgm_type_toggle" title="${typeTitle}" data-type="${entryType}">
          <b>${typeLabel}</b>
        </div>
      </td>
      <td>
        <div class="menu_button abgm-iconbtn abgm_toggle" title="More">
          <i class="fa-solid fa-chevron-down"></i>
        </div>
      </td>
    `;
    // ===== detail row (expanded) =====
    const tr2 = document.createElement("tr");
    tr2.dataset.id = b.id;
    tr2.className = "abgm-bgm-detail";
    if (!isOpen) tr2.style.display = "none";
    const vol100 = Math.round((b.volume ?? 1) * 100);
    const locked = !!b.volLocked;
    tr2.innerHTML = `
      <td colspan="5">
        <div class="abgm-detail-grid">
          <div class="abgm-keywords">
          <small>Keywords</small>
          <textarea class="abgm_keywords" placeholder="rain, storm...">${escapeHtml(b.keywords ?? "")}</textarea>
          <small class="abgm-src-title">Source</small>
          <div class="abgm-source-row" style="display:flex; gap:8px; align-items:center;">
            <input type="text" class="abgm_source" placeholder="file.mp3 or https://..." value="${escapeHtml(b.fileKey ?? "")}" style="flex:1; min-width:0;">
          <div class="menu_button abgm-iconbtn abgm_change_mp3" title="Change MP3" style="white-space:nowrap;">
            <i class="fa-solid fa-file-audio"></i>
            </div>
          <div class="menu_button abgm-iconbtn abgm_license_btn" title="License / Description" style="white-space:nowrap;">
            <i class="fa-solid fa-file-lines"></i>
          </div>
            <input type="file" class="abgm_change_mp3_file" accept="audio/mpeg,audio/mp3" style="display:none;">
            </div>
          </div>
          <div class="abgm-side">
            <div class="abgm-field-tight">
              <small>Priority</small>
              <input type="number" class="abgm_priority abgm_narrow" value="${Number(b.priority ?? 0)}" step="1">
            </div>
            <div class="abgm-field-tight">
              <small>Volume</small>
              <div class="abgm-volcell">
                <input type="range" class="abgm_vol" min="0" max="100" value="${vol100}" ${locked ? "disabled" : ""}>
                <input type="number" class="abgm_volnum" min="0" max="100" step="1" value="${vol100}">
                <div class="menu_button abgm-iconbtn abgm_vol_lock" title="Lock slider">
                  <i class="fa-solid ${locked ? "fa-lock" : "fa-lock-open"}"></i>
                </div>
              </div>
            </div>
          </div>
          <div class="abgm-detail-actions">
          <div class="menu_button abgm_copy" title="Copy to another preset">
            <i class="fa-solid fa-copy"></i> Copy
          </div>
          <div class="menu_button abgm_move" title="Move to another preset">
            <i class="fa-solid fa-arrow-right-arrow-left"></i> Move
          </div>
          <div class="menu_button abgm_del" title="Delete">
            <i class="fa-solid fa-trash"></i> <span class="abgm-del-label">Delete</span>
            </div>
          </div>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
    tbody.appendChild(tr2);
  });
} // renderBgmTable 닫기



/** ========================= UI 락 / 전체 리렌더 ========================= */
// Keyword Mode 켜졌을 때 “테스트 재생(Play)” 버튼들 잠그기/해제
function setPlayButtonsLocked(root, locked) {
  root?.querySelectorAll?.(".abgm_test")?.forEach((btn) => {
    btn.classList.toggle("abgm-test-locked", !!locked);
    btn.setAttribute("aria-disabled", locked ? "true" : "false");
    btn.title = locked ? "Disabled in Keyword Mode" : "Play";
  });
}

// 프리셋/디폴트/테이블 싹 다시 그리고, 선택 UI 갱신 + Play 버튼 락 상태 반영
function rerenderAll(root, settings) {
  renderPresetSelect(root, settings);
  renderDefaultSelect(root, settings);
  renderBgmTable(root, settings);
  if (typeof root?.__abgmUpdateSelectionUI === "function") {
    root.__abgmUpdateSelectionUI();
  }
  setPlayButtonsLocked(root, !!settings.keywordMode);
}

// (기본 구현) index.js에서 주입 안 해도 동작하게
_setPlayButtonsLocked = setPlayButtonsLocked;
_renderDefaultSelect = renderDefaultSelect;
_rerenderAll = rerenderAll;
_maybeSetDefaultOnFirstAdd = maybeSetDefaultOnFirstAdd;



/** ========================= 모달 초기화 (이벤트 바인딩 본체) ========================= */
// 모달 열릴 때 1회 호출
// - 프리셋 추가/삭제/이름변경
// - BGM 추가(파일), ZIP 추가
// - Import/Export
// - Sort / UseDefault / GlobalVolume(+Lock) / KeywordMode / DebugMode / PlayMode
// - bulk 액션(선택삭제/볼륨리셋) + expand/collapse all + select all
// - 엔트리별 액션(테스트재생, 이름/볼륨/락, default 지정, copy/move/delete 등)
// - “Preset Binding” 오버레이 열고 목록 렌더/적용/해제
// - 도움말 토글
export function initModal(overlay) {
  const root = overlay;
  const settings = ensureSettings();
  // ===== Tab System =====
  const TAB_IDS = ['main', 'mode', 'sources', 'theme', 'about'];
  const savedTab = settings.settingsActiveTab || 'main';
  function switchTab(tabId) {
    if (!TAB_IDS.includes(tabId)) tabId = 'main';
    // 버튼 상태 갱신
    root.querySelectorAll('.myaoplay-tab-btn').forEach(btn => {
      const isActive = btn.dataset.tab === tabId;
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
      btn.setAttribute('tabindex', isActive ? '0' : '-1');
    });
    // 패널 상태 갱신
    root.querySelectorAll('.myaoplay-tab-panel').forEach(panel => {
      const isActive = panel.id === `myaoplay-panel-${tabId}`;
      panel.classList.toggle('is-active', isActive);
    });
    // 설정 저장
    settings.settingsActiveTab = tabId;
    _saveSettingsDebounced();
  }
  // 탭 버튼 이벤트
  root.querySelectorAll('.myaoplay-tab-btn').forEach((btn, idx) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    // 키보드 네비게이션
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
  // 저장된 탭 복원
  switchTab(savedTab);
  // ===== Theme Toggle =====
  const themeBtns = root.querySelectorAll('.abgm-theme-btn');
  const applyTheme = (theme) => {
    // body에 data-abgm-theme 속성으로 전역 테마 적용
    if (theme === 'dark') {
      document.body.setAttribute('data-abgm-theme', 'dark');
    } else {
      document.body.removeAttribute('data-abgm-theme');
    }
    // 버튼 활성화 상태
    themeBtns.forEach(btn => {
      btn.classList.toggle('is-active', btn.dataset.theme === theme);
    });
    // 설정 저장
    settings.modalTheme = theme;
    _saveSettingsDebounced();
  };
  themeBtns.forEach(btn => {
    btn.addEventListener('click', () => applyTheme(btn.dataset.theme));
  });
  // 저장된 테마 복원
  applyTheme(settings.modalTheme || 'light');
  // ===== Mode Panel (모드 탭) 초기화 =====
  initModePanel(root, settings);
  // ===== Free Sources (소스 탭) 초기화 =====
  // 소스 탭 패널을 root로 사용해서 기존 initFreeSourcesModal 로직 재활용
  const sourcesPanel = root.querySelector('#myaoplay-panel-sources');
  if (sourcesPanel) {
    initFreeSourcesInPanel(sourcesPanel, settings);
  }
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
  // 구버전 dataUrl 있으면 IndexedDB로 옮김 (있어도 한번만)
  migrateLegacyDataUrlsToIDB(settings).catch(() => {});
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
      // KeywordMode 상태에 따라 Play 버튼 잠금/해제
      _setPlayButtonsLocked(root, !!settings.keywordMode);
      _saveSettingsDebounced();
    });
  }
  if (dbg) {
    dbg.addEventListener("change", (e) => {
      settings.debugMode = !!e.target.checked;
      window.__abgmDebugMode = !!settings.debugMode;
      if (!__abgmDebugMode) __abgmDebugLine = "";
      _saveSettingsDebounced();
      _updateNowPlayingUI();
    });
  }
  // ===== Global Volume + Lock =====
  settings.globalVolLocked ??= false; // 안전빵(ensureSettings에도 넣는게 정석)
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
    if (settings.globalVolLocked) return; // 락이면 입력 무시
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
      // Settings 모달 정렬은 presetSort만 변경 (플레이리스트/재생 정렬은 건드리지 않음)
      settings.ui.presetSort = e.target.value;
      _saveSettingsDebounced();
      _rerenderAll(root, settings);
    });
  }
  // ===== select all =====
  root.querySelector("#abgm_sel_all")?.addEventListener("change", (e) => {
    const preset = _getActivePreset(settings);
    const list = _getSortedBgms(preset, _getBgmSort(settings));
    const selected = root.__abgmSelected;
    if (e.target.checked) list.forEach((b) => selected.add(b.id));
    else selected.clear();
    _rerenderAll(root, settings);
  });
  // ===== row checkbox =====
  root.querySelector("#abgm_bgm_tbody")?.addEventListener("change", (e) => {
    if (!e.target.classList?.contains("abgm_sel")) return;
    const tr = e.target.closest("tr");
    if (!tr) return;
    const id = tr.dataset.id;
    if (e.target.checked) root.__abgmSelected.add(id);
    else root.__abgmSelected.delete(id);
    updateSelectionUI();
  });
  // ===== License =====
  const licToggle = root.querySelector("#abgm_np_license_toggle");
  const licText = root.querySelector("#abgm_np_license_text");
  licToggle?.addEventListener("click", () => {
    if (!licText) return;
    const on = licText.style.display !== "none";
    licText.style.display = on ? "none" : "block";
  });
  // ===== bulk delete =====
  root.querySelector("#abgm_delete_selected")?.addEventListener("click", async () => {
    const selected = root.__abgmSelected;
    if (!selected.size) return;
    const preset = _getActivePreset(settings);
    const names = [];
    for (const id of selected) {
      const bgm = preset.bgms.find((x) => x.id === id);
      names.push(abgmEntryLabel(bgm));
    }
    const preview = names.slice(0, 6).map((x) => `- ${x}`).join("\n");
    const more = names.length > 6 ? `\n...외 ${names.length - 6}개` : "";
    const ok = await _abgmConfirm(root, `선택한 ${names.length}개 BGM 삭제?\n${preview}${more}`, {
      title: "Delete selected",
      okText: "확인",
      cancelText: "취소",
    });
    if (!ok) return;
    const idsToDelete = new Set(selected);
    const removedKeys = [];
    for (const id of idsToDelete) {
      const bgm = preset.bgms.find((x) => x.id === id);
      if (bgm?.fileKey) removedKeys.push(bgm.fileKey);
    }
    preset.bgms = preset.bgms.filter((x) => !idsToDelete.has(x.id));
    if (preset.defaultBgmKey && !preset.bgms.some((b) => b.fileKey === preset.defaultBgmKey)) {
      preset.defaultBgmKey = ""; // 자동 다른 곡 지정 X
  }
    selected.clear();
    for (const fk of removedKeys) {
      if (!fk) continue;
      if (_isFileKeyReferenced(settings, fk)) continue;
      try { await _idbDel(fk); delete settings.assets[fk]; } catch {}
    }
    _saveSettingsDebounced();
    _rerenderAll(root, settings);
  });
  // ===== bulk reset volume (selected) =====
root.querySelector("#abgm_reset_vol_selected")?.addEventListener("click", async () => {
  const selected = root.__abgmSelected;
  if (!selected?.size) return;
  const preset = _getActivePreset(settings);
  const ok = await _abgmConfirm(root, `선택한 ${selected.size}개 BGM의 볼륨을 100으로 초기화?`, {
    title: "Reset volume",
    okText: "확인",
    cancelText: "취소",
  });
  if (!ok) return;
  for (const id of selected) {
    const bgm = preset.bgms.find((x) => x.id === id);
    if (!bgm) continue;
    bgm.volume = 1.0;      // 잠겨있어도 볼륨 값은 초기화
    // bgm.volLocked 는 건드리지 않음(요구사항)
  }
  _saveSettingsDebounced();
  _rerenderAll(root, settings);
  try { _engineTick(); } catch {}
});
  // ===== Add empty entry row =====
  root.querySelector("#abgm_bgm_add_row")?.addEventListener("click", () => {
  const preset = _getActivePreset(settings);
  preset.bgms ??= [];
  preset.bgms.push({
    id: _uid(),
    fileKey: "",          // Source 비어있음 (재생/모드에서 자동 무시됨)
    name: "",             // Entry name도 비어있게 (placeholder 보이게)
    keywords: "",
    priority: 0,
    volume: 1.0,
    volLocked: false,
  });
  _saveSettingsDebounced();
  _rerenderAll(root, settings);
});
  // ===== Expand/Collapse all =====
  root.querySelector("#abgm_expand_all")?.addEventListener("click", () => {
    const preset = _getActivePreset(settings);
    const list = _getSortedBgms(preset, _getBgmSort(settings));
    list.forEach((b) => root.__abgmExpanded.add(b.id));
    _rerenderAll(root, settings);
  });
  root.querySelector("#abgm_collapse_all")?.addEventListener("click", () => {
    root.__abgmExpanded.clear();
    _rerenderAll(root, settings);
  });
  // ===== lock all volume sliders =====
  root.querySelector("#abgm_lock_all_vol")?.addEventListener("click", () => {
    const preset = _getActivePreset(settings);
    (preset.bgms ?? []).forEach((b) => { b.volLocked = true; });
    _saveSettingsDebounced();
    _rerenderAll(root, settings);
  });
  // ===== preset select =====
  root.querySelector("#abgm_preset_select")?.addEventListener("change", (e) => {
    settings.activePresetId = e.target.value;
    root.__abgmSelected.clear();
    _saveSettingsDebounced();
    _rerenderAll(root, settings);
  });
  // ===== preset add/del/rename =====
  root.querySelector("#abgm_preset_add")?.addEventListener("click", () => {
    const id = _uid();
    settings.presets[id] = { id, name: "New Preset", defaultBgmKey: "", bgms: [] };
    settings.activePresetId = id;
    _saveSettingsDebounced();
    _rerenderAll(root, settings);
  });
  root.querySelector("#abgm_preset_del")?.addEventListener("click", async () => {
    const keys = Object.keys(settings.presets);
    if (keys.length <= 1) return;
    const cur = _getActivePreset(settings);
    const name = cur?.name || cur?.id || "Preset";
    const ok = await _abgmConfirm(root, `"${name}" 프리셋 삭제?`, {
      title: "Delete preset",
      okText: "삭제",
      cancelText: "취소",
    });
    if (!ok) return;
    delete settings.presets[settings.activePresetId];
    settings.activePresetId = Object.keys(settings.presets)[0];
    root.__abgmSelected?.clear?.();
    root.__abgmExpanded?.clear?.();
    _saveSettingsDebounced();
    _rerenderAll(root, settings);
  });
  // 프리셋 이름 변경
  root.querySelector("#abgm_preset_rename_btn")?.addEventListener("click", async () => {
  const preset = _getActivePreset(settings);
  const out = await _abgmPrompt(root, `Preset name 변경`, {
    title: "Rename Preset",
    okText: "확인",
    cancelText: "취소",
    resetText: "초기화",
    initialValue: preset?.name ?? "",
    placeholder: "Preset name...",
  });
  if (out === null) return;
  const name = String(out ?? "").trim();
  if (!name) return;
  preset.name = name;
  _saveSettingsDebounced();
  _rerenderAll(root, settings);
  _updateNowPlayingUI();
});
  root.querySelector("#abgm_open_freesources")?.addEventListener("click", openFreeSourcesModal);
  // ===== Preset Binding UI (bind preset to character cards) =====
  const bindOpen = root.querySelector("#abgm_bind_open");
  const bindOverlay = root.querySelector("#abgm_bind_overlay");
  const bindClose = root.querySelector("#abgm_bind_close");
  const bindList = root.querySelector("#abgm_bind_list");
  const bindTitle = root.querySelector("#abgm_bind_title");
  const bindSub = root.querySelector("#abgm_bind_sub");
  const hideBindOverlay = () => {
    if (bindOverlay) bindOverlay.style.display = "none";
  };
  const renderBindOverlay = async () => {
    if (!bindList) return;
    const settingsNow = ensureSettings();
    const preset = _getActivePreset(settingsNow);
    const presetId = String(preset?.id ?? "");
    const presetName = String(preset?.name ?? presetId);
    if (bindTitle) bindTitle.textContent = `Bind Preset → Characters`;
    if (bindSub) bindSub.textContent = `"${presetName}" 프리셋을 연결할 캐릭터를 선택`;
    const ctx = _getSTContextSafe();
    const chars = ctx?.characters;
    const writeExtensionField = ctx?.writeExtensionField;
    bindList.innerHTML = "";
    if (!chars || !Array.isArray(chars) || typeof writeExtensionField !== "function") {
      const p = document.createElement("div");
      p.style.opacity = ".8";
      p.style.fontSize = "12px";
      p.style.padding = "10px";
      p.textContent = "SillyTavern 컨텍스트를 못 불러옴 (getContext/writeExtensionField 없음)";
      bindList.appendChild(p);
      return;
    }
    // 캐릭터 정렬: 특문 → 한글 → 일본어 → 한자/중국어 → 영어
    const getCharCategory = (name) => {
      const first = (name || "")[0] || "";
      if (/^[가-힣]/.test(first)) return 1; // 한글
      if (/^[\u3040-\u309F\u30A0-\u30FF]/.test(first)) return 2; // 일본어 (히라가나/가타카나)
      if (/^[\u4E00-\u9FFF]/.test(first)) return 3; // 한자 (중국어 포함)
      if (/^[a-zA-Z]/.test(first)) return 4; // 영어
      return 0; // 특문/숫자/기타
    };
    
    const sortedChars = chars
      .map((ch, idx) => ({ ch, idx }))
      .filter(item => item.ch)
      .sort((a, b) => {
        const nameA = String(a.ch.name ?? a.ch?.data?.name ?? "").trim().toLowerCase();
        const nameB = String(b.ch.name ?? b.ch?.data?.name ?? "").trim().toLowerCase();
        const catA = getCharCategory(nameA);
        const catB = getCharCategory(nameB);
        if (catA !== catB) return catA - catB;
        return nameA.localeCompare(nameB, "ko");
      });
    for (const { ch, idx: i } of sortedChars) {
      const name =
        String(ch.name ?? ch?.data?.name ?? ch?.data?.first_mes ?? `Character #${i}`).trim() || `Character #${i}`;
      const boundId = String(ch?.data?.extensions?.[_EXT_BIND_KEY]?.presetId ?? "");
      const boundName = boundId && settingsNow.presets?.[boundId] ? String(settingsNow.presets[boundId].name ?? boundId) : "";
      
      // 현재 선택된 프리셋과 연결되어 있는지 체크
      const isBoundToCurrent = boundId === presetId;
      
      const row = document.createElement("div");
      row.className = "abgm-bind-row" + (isBoundToCurrent ? " is-bound-current" : "");
      
      // 인디케이터 (불)
      const indicator = document.createElement("div");
      indicator.className = "abgm-bind-indicator";
      
      // 캐릭터 정보
      const info = document.createElement("div");
      info.className = "abgm-bind-info";
      
      const nameEl = document.createElement("div");
      nameEl.className = "abgm-bind-name";
      nameEl.textContent = name;
      
      const statusEl = document.createElement("div");
      statusEl.className = "abgm-bind-status";
      if (isBoundToCurrent) {
        statusEl.textContent = `✓ 현재 프리셋에 연결됨`;
      } else if (boundId) {
        statusEl.textContent = `→ ${boundName || boundId}`;
      } else {
        statusEl.textContent = `연결 안 됨`;
      }
      
      info.appendChild(nameEl);
      info.appendChild(statusEl);
      
      row.appendChild(indicator);
      row.appendChild(info);
      
      // 클릭: 토글 (연결/해제)
      row.addEventListener("click", async () => {
        try {
          if (isBoundToCurrent) {
            // 이미 현재 프리셋에 연결됨 → 해제
            try {
              await writeExtensionField(i, _EXT_BIND_KEY, null);
            } catch {
              await writeExtensionField(i, _EXT_BIND_KEY, {});
            }
          } else {
            // 연결 안 됨 or 다른 프리셋 → 현재 프리셋에 연결
            await writeExtensionField(i, _EXT_BIND_KEY, { presetId, presetName, at: Date.now() });
          }
        } catch (e) {
          console.error("[MyaPl] bind toggle failed", e);
        }
        await renderBindOverlay();
        try { _engineTick(); } catch {}
      });
      
      bindList.appendChild(row);
    }
  };
  const showBindOverlay = async () => {
    if (!bindOverlay) return;
    bindOverlay.style.display = "flex";
    await renderBindOverlay();
  };
  bindOpen?.addEventListener("click", showBindOverlay);
  bindClose?.addEventListener("click", hideBindOverlay);
  bindOverlay?.addEventListener("click", (e) => {
    if (e.target === bindOverlay) hideBindOverlay();
  });
// ===== MP3 add =====
  const mp3Input = root.querySelector("#abgm_bgm_file");
  root.querySelector("#abgm_bgm_add")?.addEventListener("click", () => mp3Input?.click());
  mp3Input?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const preset = _getActivePreset(settings);
    const fileKey = file.name;
    await _idbPut(fileKey, file);
    const durationSec = await _abgmGetDurationSecFromBlob(file);
    const assets = _ensureAssetList(settings);
    assets[fileKey] = { fileKey, label: fileKey.replace(/\.mp3$/i, "") };
    const exists = preset.bgms.some((b) => b.fileKey === fileKey);
    if (!exists) {
      preset.bgms.push({
        id: _uid(),
        fileKey,
        name: _basenameNoExt(fileKey),
        keywords: "",
        priority: 0,
        volume: 1.0,
        volLocked: false,
        durationSec,
      });
    }
    _maybeSetDefaultOnFirstAdd(preset, fileKey);
    e.target.value = "";
    _saveSettingsDebounced();
    _rerenderAll(root, settings);
  });
  // ===== ZIP add =====
  const zipInput = root.querySelector("#abgm_zip_file");
  root.querySelector("#abgm_zip_add")?.addEventListener("click", () => zipInput?.click());
  zipInput?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const importedKeys = await _importZip(file, settings);
      const preset = _getActivePreset(settings);
      for (const fk of importedKeys) {
        if (!preset.bgms.some((b) => b.fileKey === fk)) {
          preset.bgms.push({
            id: _uid(),
            fileKey: fk,
            name: _basenameNoExt(fk),
            keywords: "",
            priority: 0,
            volume: 1.0,
            volLocked: false,
          });
        }
      }
      let firstAddedKey = "";
      for (const fk of importedKeys) {
        if (!firstAddedKey) firstAddedKey = fk;
          // bgm push 로직...
        }
      _maybeSetDefaultOnFirstAdd(preset, firstAddedKey);
      _saveSettingsDebounced();
      _rerenderAll(root, settings);
    } catch (err) {
      console.error("[MyaPl] zip import failed:", err);
      console.warn("[MyaPl] vendor/jszip.min.js 없으면 zip 안 됨");
    } finally {
      e.target.value = "";
    }
  });
  // ===== default select =====
  root.querySelector("#abgm_default_select")?.addEventListener("change", (e) => {
    const preset = _getActivePreset(settings);
    preset.defaultBgmKey = e.target.value;
    _saveSettingsDebounced();
  });
  // ===== tbody input =====
  root.querySelector("#abgm_bgm_tbody")?.addEventListener("input", (e) => {
    const tr = e.target.closest("tr");
    if (!tr) return;
    const id = tr.dataset.id;
    const preset = _getActivePreset(settings);
    const bgm = preset.bgms.find((x) => x.id === id);
    if (!bgm) return;
    if (e.target.classList.contains("abgm_keywords")) bgm.keywords = e.target.value;
    if (e.target.classList.contains("abgm_priority")) bgm.priority = Number(e.target.value || 0);
    // 엔트리 이름 개선
    if (e.target.classList.contains("abgm_name")) {
      bgm.name = String(e.target.value || "").trim();
      _updateNowPlayingUI(); // 엔트리 이름 바꾸면 Now Playing도 즉시 갱신
      _renderDefaultSelect(root, settings); // Default 셀렉트에 엔트리 이름 표시하려면 즉시 재렌더
      _saveSettingsDebounced();
      return;
    }
// Source (정규화된 거)
if (e.target.classList.contains("abgm_source")) {
  const oldKey = String(bgm.fileKey ?? "");
  let newKey = String(e.target.value || "").trim();
  newKey = _dropboxToRaw(newKey);     // 여기
  e.target.value = newKey;           // 입력창도 변환된 걸로 보여주기
  bgm.fileKey = newKey;
  if (oldKey && preset.defaultBgmKey === oldKey) {
    preset.defaultBgmKey = newKey;
  }
  _saveSettingsDebounced();
  _renderDefaultSelect(root, settings);
  return;
}
    const detailRow = tr.classList.contains("abgm-bgm-detail") ? tr : tr.closest("tr.abgm-bgm-detail") || tr;
    if (e.target.classList.contains("abgm_vol")) {
      if (bgm.volLocked) return;
      const v = Math.max(0, Math.min(100, Number(e.target.value || 100)));
      bgm.volume = v / 100;
      _applyLiveVolumeForKey(settings, bgm.fileKey);
      _engineTick();
      const n = detailRow.querySelector(".abgm_volnum");
      if (n) n.value = String(v);
    }
    if (e.target.classList.contains("abgm_volnum")) {
      const v = Math.max(0, Math.min(100, Number(e.target.value || 100)));
      bgm.volume = v / 100;
      _applyLiveVolumeForKey(settings, bgm.fileKey);
      _engineTick();
      if (!bgm.volLocked) {
        const r = detailRow.querySelector(".abgm_vol");
        if (r) r.value = String(v);
      }
    }
    _saveSettingsDebounced();
  });

  // ===== tbody click (toggle/lock/del/test) =====
  root.querySelector("#abgm_bgm_tbody")?.addEventListener("click", async (e) => {
    const tr = e.target.closest("tr");
    if (!tr) return;
    // type toggle (BGM <-> SFX)
    if (e.target.closest(".abgm_type_toggle")) {
      const id = tr.dataset.id;
      const preset = _getActivePreset(settings);
      const bgm = preset.bgms.find((x) => x.id === id);
      if (!bgm) return;
      // 토글
      bgm.type = (bgm.type === "SFX") ? "BGM" : "SFX";
      _saveSettingsDebounced();
      // 버튼 UI 즉시 업데이트
      const btn = e.target.closest(".abgm_type_toggle");
      if (btn) {
        const newLabel = bgm.type === "SFX" ? "S" : "B";
        const newTitle = bgm.type === "SFX" ? "SFX (클릭하여 BGM으로 변경)" : "BGM (클릭하여 SFX로 변경)";
        btn.dataset.type = bgm.type;
        btn.title = newTitle;
        btn.innerHTML = `<b>${newLabel}</b>`;
      }
      return;
    }
    // toggle
    if (e.target.closest(".abgm_toggle")) {
      const summary = tr.classList.contains("abgm-bgm-summary") ? tr : tr.closest("tr.abgm-bgm-summary");
      if (!summary) return;
      const id = summary.dataset.id;
      const open = !root.__abgmExpanded.has(id);
      if (open) root.__abgmExpanded.add(id);
      else root.__abgmExpanded.delete(id);
      const detail = summary.nextElementSibling;
      summary.classList.toggle("abgm-expanded", open);
      if (detail?.classList?.contains("abgm-bgm-detail")) {
        detail.style.display = open ? "" : "none";
      } else {
        _rerenderAll(root, settings);
      }
      return;
    }
    // id/bgm
    const id = tr.dataset.id;
    const preset = _getActivePreset(settings);
    const bgm = preset.bgms.find((x) => x.id === id);
    if (!bgm) return;
      // license / description edit
      if (e.target.closest(".abgm_license_btn")) {
        const result = await abgmEntryDetailPrompt(root, bgm, {
          title: "Entry Detail",
          okText: "확인",
          cancelText: "취소",
          resetText: "초기화",
        });
        if (result === null) return;
        bgm.license = String(result.license ?? "").trim();
        bgm.lyrics = String(result.lyrics ?? "").trim();
        // === 이미지 처리 ===
        // === 이미지 처리 (완전 호환 + 공유 안전) ===
        const prevKey = String(bgm.imageAssetKey ?? "").trim();
        const prevRefs = prevKey ? _countImageKeyRefs(settings, prevKey) : 0;
        if (result.deleteImage) {
          if (prevKey) {
            // 공유중이면 실제 파일 삭제 X (다른 엔트리까지 같이 날아가면 안 됨)
            if (prevRefs <= 1) {
              try { await _idbDelImage(prevKey); } catch (e) { console.warn("[MyaPl] Image delete failed:", e); }
            }
          }
          bgm.imageAssetKey = "";
          bgm.imageUrl = "";
        } else if (result.imageBlob) {
          // 공유중인 키에 덮어쓰면 다른 엔트리 이미지도 바뀜 → 새 키로 분리
          let nextKey = prevKey;
          if (!nextKey || prevRefs > 1) nextKey = _newImageAssetKey();
          try {
            await _idbPutImage(nextKey, result.imageBlob);
            bgm.imageAssetKey = nextKey;
            bgm.imageUrl = "";
          } catch (e) {
            console.error("[MyaPl] Image save failed:", e);
          }
        } else if (result.imageUrl) {
          const url = String(result.imageUrl).trim();
          if (prevKey) {
            // 공유중이면 실제 파일 삭제 X (그냥 연결만 끊기)
            if (prevRefs <= 1) {
              try { await _idbDelImage(prevKey); } catch {}
            }
          }
          bgm.imageAssetKey = "";
          bgm.imageUrl = url;
        }
        _saveSettingsDebounced();
        try { _updateNowPlayingUI(); } catch {}
        return;
      }
    // change mp3 (swap only this entry's asset)
    if (e.target.closest(".abgm_change_mp3")) {
      const detailRow = tr.classList.contains("abgm-bgm-detail")
        ? tr
        : tr.closest("tr.abgm-bgm-detail") || tr;
      const fileInput = detailRow.querySelector(".abgm_change_mp3_file");
      if (!fileInput) return;
      // 이 엔트리의 id를 fileInput에 기억시켜둠
      fileInput.dataset.bgmId = String(id);
      fileInput.click();
      return;
    }
    // lock volume
    if (e.target.closest(".abgm_vol_lock")) {
      bgm.volLocked = !bgm.volLocked;
      const detailRow = tr.classList.contains("abgm-bgm-detail") ? tr : tr.closest("tr.abgm-bgm-detail") || tr;
      const range = detailRow.querySelector(".abgm_vol");
      const icon = detailRow.querySelector(".abgm_vol_lock i");
      if (range) range.disabled = !!bgm.volLocked;
      if (icon) icon.className = `fa-solid ${bgm.volLocked ? "fa-lock" : "fa-lock-open"}`;
      _saveSettingsDebounced();
      return;
    }
    // copy
    if (e.target.closest(".abgm_copy")) {
      const curPreset = _getActivePreset(settings);
      const targetId = await _abgmPickPreset(root, settings, {
        title: "Copy entry",
        message: "복사할 프리셋 선택",
        okText: "확인",
        cancelText: "취소",
      });
      if (!targetId) return;
      const target = settings.presets?.[targetId];
      if (!target) return;
      target.bgms ??= [];
      target.bgms.push({
        ..._clone(bgm),
        id: _uid(), // 복사면 새 id
      });
      // target default 비어있으면 "자동으로" 바꾸고 싶냐? -> 난 비추라서 안 함
      _saveSettingsDebounced();
      // 현재 화면 프리셋은 그대로니까 그냥 UI 갱신만
      _rerenderAll(root, settings);
      return;
    }
    // Entry move
    if (e.target.closest(".abgm_move")) {
      const curPreset = _getActivePreset(settings);
      const targetId = await _abgmPickPreset(root, settings, {
        title: "Move entry",
        message: "이동할 프리셋 선택",
        okText: "확인",
        cancelText: "취소",
        excludePresetId: curPreset.id,
      });
      if (!targetId) return;
      const target = settings.presets?.[targetId];
      if (!target) return;
      target.bgms ??= [];
      target.bgms.push({
        ..._clone(bgm),
        id: _uid(), // 이동도 새 id로 안전빵(겹침 방지)
      });
      // 원본에서 제거
      const fileKey = bgm.fileKey;
      curPreset.bgms = (curPreset.bgms ?? []).filter((x) => x.id !== id);
      // default가 옮긴 항목이라면...
      if (curPreset.defaultBgmKey === fileKey) {
        curPreset.defaultBgmKey = ""; // 자동 다른 곡 지정 X
      }
      root.__abgmSelected?.delete(id);
      _saveSettingsDebounced();
      _rerenderAll(root, settings);
      return;
    }
    // delete
    if (e.target.closest(".abgm_del")) {
      const label = abgmEntryLabel(bgm);
      const ok = await _abgmConfirm(root, `"${label}" 삭제?`, {
        title: "Delete",
        okText: "확인",
        cancelText: "취소",
      });
      if (!ok) return;
      root.__abgmSelected?.delete(id);
      const fileKey = bgm.fileKey;
      preset.bgms = preset.bgms.filter((x) => x.id !== id);
      if (preset.defaultBgmKey === fileKey) {
        preset.defaultBgmKey = ""; // 자동 다른 곡 지정 X
    }
      if (fileKey && !_isFileKeyReferenced(settings, fileKey)) {
        try {
          await _idbDel(fileKey);
          delete settings.assets[fileKey];
        } catch {}
      }
      _saveSettingsDebounced();
      _rerenderAll(root, settings);
      return;
    }
    // test / preview play (1회 재생)
    if (e.target.closest(".abgm_test")) {
      // 키워드 모드에서는 개별(테스트) 재생 금지 유지
      if (settings?.keywordMode) {
        // 원하면 여기서 토스트/안내 띄워도 됨
        // toast("키워드 모드에서는 개별 재생 불가");
        return;
      }
      const fk = String(bgm?.fileKey ?? "").trim();
      if (!fk) return;
      const gv = Number(settings?.globalVolume ?? 0.7);
      const pv = Number(bgm?.volume ?? 1);
      const vol01 =
        (Number.isFinite(gv) ? gv : 0.7) * (Number.isFinite(pv) ? pv : 1);

      try {
        await _playAsset(fk, vol01);
      } catch (err) {
        console.warn("[MyaPl] preview play failed:", err);
      }
      return;
    }
  });
  // file picker change (per-entry mp3 swap)
  root.querySelector("#abgm_bgm_tbody")?.addEventListener("change", async (e) => {
    if (!e.target.classList?.contains("abgm_change_mp3_file")) return;
    const file = e.target.files?.[0];
    const bgmId = String(e.target.dataset.bgmId || "");
    e.target.value = ""; // 같은 파일 다시 선택 가능하게
    if (!file || !bgmId) return;
    const preset = _getActivePreset(settings);
    const bgm = preset.bgms.find((x) => String(x.id) === bgmId);
    if (!bgm) return;
    const oldKey = String(bgm.fileKey ?? "");
    const newKey = String(file.name ?? "").trim();
    if (!newKey) return;
    try {
      // 새 파일 저장
      await _idbPut(newKey, file);
      const assets = _ensureAssetList(settings);
      assets[newKey] = { fileKey: newKey, label: newKey.replace(/\.mp3$/i, "") };
      // 엔트리 소스 교체
      bgm.fileKey = newKey;
      // default 최초만 따라가게
      if (oldKey && preset.defaultBgmKey === oldKey) {
    preset.defaultBgmKey = newKey;
  }
      // oldKey가 더 이상 참조 안 되면 정리(선택)
      if (oldKey && oldKey !== newKey && !_isFileKeyReferenced(settings, oldKey)) {
        try { await _idbDel(oldKey); delete settings.assets[oldKey]; } catch {}
      }
      _saveSettingsDebounced();
      _rerenderAll(root, settings);
      try { _engineTick(); } catch {}
    } catch (err) {
    console.error("[MyaPl] change mp3 failed:", err);
  }
});
  // ===== Import/Export (preset 1개: 룰만) =====
  const importFile = root.querySelector("#abgm_import_file");
  root.querySelector("#abgm_import")?.addEventListener("click", () => importFile?.click());
  importFile?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const incomingPresetRaw = _pickPresetFromImportData(data);
      if (!incomingPresetRaw) return;
      const incomingPreset = _rekeyPreset(incomingPresetRaw);
      const names = new Set(Object.values(settings.presets).map((p) => p.name));
      if (names.has(incomingPreset.name)) incomingPreset.name = `${incomingPreset.name} (imported)`;
      settings.presets[incomingPreset.id] = incomingPreset;
      settings.activePresetId = incomingPreset.id;
      _saveSettingsDebounced();
      _rerenderAll(root, settings);
    } catch (err) {
      console.error("[MyaPl] import failed", err);
    } finally {
      e.target.value = "";
    }
  });
  root.querySelector("#abgm_export")?.addEventListener("click", () => {
    const preset = _getActivePreset(settings);
    const out = _exportPresetFile(preset);
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(String(preset.name || preset.id || "Preset").trim() || "Preset")
      .replace(/[\\\/:*?"<>|]+/g, "")
      .replace(/[._-]+$/g, "")}_Mya.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
// Free Sources 버튼 -> 소스 탭으로 전환
  const freeBtnNew = root.querySelector("#abgm_free_open");
  if (freeBtnNew) {
    freeBtnNew.addEventListener("click", (e) => {
      e.preventDefault();
      switchTab('sources');
    });
  }
  // 키보드/주소창 변화 대응
  overlay.addEventListener("focusin", () => {
    requestAnimationFrame(() => _fitModalToHost(overlay, _getModalHost()));
    setTimeout(() => _fitModalToHost(overlay, _getModalHost()), 120);
  });
  _rerenderAll(root, settings);
  setupHelpToggles(root);
} // initModal 닫기



/** ========================= 도움말(Help) 토글 ========================= */
// help 버튼 누르면 해당 설명 박스만 열고 나머진 닫기
function setupHelpToggles(root) {
  // 버튼ID : 박스ID
  const helps = [
    ["abgm_modal_help_toggle", "abgm_modal_help"],
    ["abgm_bgm_help_toggle", "abgm_bgm_help"],
  ];
  const boxes = helps
    .map(([, boxId]) => root.querySelector(`#${boxId}`))
    .filter(Boolean);

  // (setupHelpToggles 내부) help 박스들 전부 닫기(예외 1개만 남기는 용도 포함)
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
    // 중복 바인딩 방지
    if (btn.dataset.abgmHelpBound === "1") continue;
    btn.dataset.abgmHelpBound = "1";
    // 초기 안전빵
    if (!box.style.display) box.style.display = "none";
    btn.addEventListener("click", () => {
      const isOpen = box.style.display !== "none";
      if (isOpen) {
        box.style.display = "none";
      } else {
        closeAll(box);     // 나 말고 다 닫기
        box.style.display = "block";
      }
    });
  }
}



/** ========================= Mode Panel 초기화 ========================= */
// 모드 탭 (키워드/타임/SFX) 서브탭 및 키워드 모드 세부 설정 초기화
function initModePanel(root, settings) {
  const modePanel = root.querySelector('#myaoplay-panel-mode');
  if (!modePanel) return;

  // ===== 모드 서브탭 전환 =====
  const modeSubtabs = modePanel.querySelectorAll('.abgm-mode-subtab');
  const modeSubpanels = modePanel.querySelectorAll('.abgm-mode-subpanel');
  
  function switchModeSubtab(tabId) {
    modeSubtabs.forEach(btn => {
      const isActive = btn.dataset.modeTab === tabId;
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    modeSubpanels.forEach(panel => {
      const isActive = panel.dataset.modePanel === tabId;
      panel.classList.toggle('is-active', isActive);
      panel.style.display = isActive ? 'block' : 'none';
    });
  }
  
  modeSubtabs.forEach(btn => {
    btn.addEventListener('click', () => switchModeSubtab(btn.dataset.modeTab));
  });

  // ===== 키워드 서브모드 드롭다운 =====
  const kwSubmodeSel = modePanel.querySelector('#abgm_kw_submode');
  const descMatching = modePanel.querySelector('#abgm_kw_mode_desc_matching');
  const descToken = modePanel.querySelector('#abgm_kw_mode_desc_token');
  const descHybrid = modePanel.querySelector('#abgm_kw_mode_desc_hybrid');
  const promptSection = modePanel.querySelector('#abgm_kw_prompt_section');
  
  function updateKwSubmodeUI(mode) {
  if (descMatching) descMatching.style.display = mode === 'matching' ? 'block' : 'none';
  if (descToken) descToken.style.display = mode === 'token' ? 'block' : 'none';
  if (descHybrid) descHybrid.style.display = mode === 'hybrid' ? 'block' : 'none';
  // 추천 모드 설명
  const descRecommend = modePanel.querySelector('#abgm_kw_mode_desc_recommend');
  if (descRecommend) descRecommend.style.display = mode === 'recommend' ? 'block' : 'none';
  // 토큰/하이브리드일 때만 프롬프트 섹션 표시
  if (promptSection) promptSection.style.display = (mode === 'token' || mode === 'hybrid') ? 'block' : 'none';
  // 추천 모드일 때만 추천 섹션 표시
  const recommendSection = modePanel.querySelector('#abgm_kw_recommend_section');
  if (recommendSection) recommendSection.style.display = mode === 'recommend' ? 'block' : 'none';
  // 추천 모드일 때 공통 옵션(키워드 관련) 숨김
  const commonOptions = modePanel.querySelector('#abgm_kw_common_options');
  if (commonOptions) commonOptions.style.display = mode === 'recommend' ? 'none' : 'block';
}
  
  // 초기값 설정
  if (kwSubmodeSel) {
    kwSubmodeSel.value = settings.keywordSubMode || 'matching';
    updateKwSubmodeUI(settings.keywordSubMode || 'matching');
    
    kwSubmodeSel.addEventListener('change', (e) => {
      settings.keywordSubMode = e.target.value;
      updateKwSubmodeUI(e.target.value);
      _saveSettingsDebounced();
    });
  }

  // ===== 추천 모드 설정 =====
  const recProviderSel = modePanel.querySelector('#abgm_rec_provider');
  const recCooldownSel = modePanel.querySelector('#abgm_rec_cooldown');
  const recStopOnEnterChk = modePanel.querySelector('#abgm_rec_stop_on_enter');

  // 초기값 로드
  settings.recommendMode ??= {};
  if (recProviderSel) recProviderSel.value = settings.recommendMode.provider || 'spotify';
  if (recCooldownSel) recCooldownSel.value = String(settings.recommendMode.cooldownSec || 60);
  if (recStopOnEnterChk) recStopOnEnterChk.checked = settings.recommendMode.stopOnEnter !== false;

  recProviderSel?.addEventListener('change', (e) => {
    settings.recommendMode.provider = e.target.value;
    _saveSettingsDebounced();
  });
  recCooldownSel?.addEventListener('change', (e) => {
    settings.recommendMode.cooldownSec = parseInt(e.target.value, 10) || 60;
    _saveSettingsDebounced();
  });
  recStopOnEnterChk?.addEventListener('change', (e) => {
    settings.recommendMode.stopOnEnter = !!e.target.checked;
    _saveSettingsDebounced();
  });

  // ===== 프롬프트 프리셋 관리 =====
  const promptPresetSel = modePanel.querySelector('#abgm_kw_prompt_preset');
  const promptContent = modePanel.querySelector('#abgm_kw_prompt_content');
  const promptAddBtn = modePanel.querySelector('#abgm_kw_prompt_add');
  const promptDelBtn = modePanel.querySelector('#abgm_kw_prompt_del');
  const promptRenameBtn = modePanel.querySelector('#abgm_kw_prompt_rename');

  // ===== 추천 프롬프트 프리셋 관리 =====
  const recPromptPresetSel = modePanel.querySelector('#abgm_rec_prompt_preset');
  const recPromptContent = modePanel.querySelector('#abgm_rec_prompt_content');
  const recPromptAddBtn = modePanel.querySelector('#abgm_rec_prompt_add');
  const recPromptDelBtn = modePanel.querySelector('#abgm_rec_prompt_del');
  const recPromptRenameBtn = modePanel.querySelector('#abgm_rec_prompt_rename');

  function renderRecPromptPresetSelect() {
    if (!recPromptPresetSel) return;
    recPromptPresetSel.innerHTML = '';
    const presets = settings.recPromptPresets || {};
    const list = Object.values(presets);
    const sorted = list.sort((a, b) => {
      if (a.id === "default") return -1;
      if (b.id === "default") return 1;
      return (a.name || '').localeCompare(b.name || '', undefined, { numeric: true });
    });
    sorted.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name || p.id;
      if (p.id === settings.activeRecPromptPresetId) opt.selected = true;
      recPromptPresetSel.appendChild(opt);
    });
  }

  function loadActiveRecPromptContent() {
    if (!recPromptContent) return;
    const activePreset = settings.recPromptPresets?.[settings.activeRecPromptPresetId];
    recPromptContent.value = activePreset?.content || '';
  }

  renderRecPromptPresetSelect();
  loadActiveRecPromptContent();

  recPromptPresetSel?.addEventListener('change', (e) => {
    settings.activeRecPromptPresetId = e.target.value;
    loadActiveRecPromptContent();
    _saveSettingsDebounced();
  });

  recPromptContent?.addEventListener('input', () => {
    const activePreset = settings.recPromptPresets?.[settings.activeRecPromptPresetId];
    if (activePreset) {
      activePreset.content = recPromptContent.value;
      _saveSettingsDebounced();
    }
  });

  // 프롬프트 프리셋 추가
  recPromptAddBtn?.addEventListener('click', async () => {
    const name = await _abgmPrompt(root, '새 추천 프롬프트 프리셋 이름', {
      title: 'Recommend Prompt Preset',
      initialValue: 'New Prompt',
      placeholder: 'Preset name...',
    });
    if (!name || !name.trim()) return;
    const newId = _uid();
    settings.recPromptPresets ??= {};
    settings.recPromptPresets[newId] = {
      id: newId,
      name: name.trim(),
      content: ''
    };
    settings.activeRecPromptPresetId = newId;
    _saveSettingsDebounced();
    renderRecPromptPresetSelect();
    loadActiveRecPromptContent();
  });

  // 프롬프트 프리셋 삭제
  recPromptDelBtn?.addEventListener('click', async () => {
    const presets = settings.recPromptPresets || {};
    if (Object.keys(presets).length <= 1) {
      alert('마지막 프리셋은 삭제할 수 없습니다.');
      return;
    }
    const activePreset = presets[settings.activeRecPromptPresetId];
    const ok = await _abgmConfirm(root, '"' + (activePreset?.name || settings.activeRecPromptPresetId) + '" 프리셋을 삭제할까요?');
    if (!ok) return;
    delete presets[settings.activeRecPromptPresetId];
    settings.activeRecPromptPresetId = Object.keys(presets)[0];
    _saveSettingsDebounced();
    renderRecPromptPresetSelect();
    loadActiveRecPromptContent();
  });

  // 프롬프트 프리셋 이름 변경
  recPromptRenameBtn?.addEventListener('click', async () => {
    const activePreset = settings.recPromptPresets?.[settings.activeRecPromptPresetId];
    if (!activePreset) return;
    const newName = await _abgmPrompt(root, '프리셋 이름 변경', {
      title: 'Rename Prompt Preset',
      initialValue: activePreset.name || '',
      placeholder: 'Preset name...',
    });
    if (!newName || !newName.trim()) return;
    activePreset.name = newName.trim();
    _saveSettingsDebounced();
    renderRecPromptPresetSelect();
  });
  
  function renderPromptPresetSelect() {
    if (!promptPresetSel) return;
    promptPresetSel.innerHTML = '';
    const presets = settings.kwPromptPresets || {};
    const list = Object.values(presets);
    const sorted = list.sort((a, b) => {
      if (a.id === "default") return -1;
      if (b.id === "default") return 1;
      return (a.name || '').localeCompare(b.name || '', undefined, { numeric: true });
    });
    sorted.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name || p.id;
      if (p.id === settings.activeKwPromptPresetId) opt.selected = true;
      promptPresetSel.appendChild(opt);
    });
  }

  
  function loadActivePromptContent() {
    if (!promptContent) return;
    const activePreset = settings.kwPromptPresets?.[settings.activeKwPromptPresetId];
    promptContent.value = activePreset?.content || '';
  }
  
  renderPromptPresetSelect();
  loadActivePromptContent();
  promptPresetSel?.addEventListener('change', (e) => {
    settings.activeKwPromptPresetId = e.target.value;
    loadActivePromptContent();
    _saveSettingsDebounced();
  });
  // 프롬프트 내용 변경
  promptContent?.addEventListener('input', () => {
    const activePreset = settings.kwPromptPresets?.[settings.activeKwPromptPresetId];
    if (activePreset) {
      activePreset.content = promptContent.value;
      _saveSettingsDebounced();
    }
  });
  // 프롬프트 프리셋 추가
  promptAddBtn?.addEventListener('click', async () => {
    const name = await _abgmPrompt(root, '새 프롬프트 프리셋 이름', {
      title: 'Prompt Preset',
      initialValue: 'New Prompt',
      placeholder: 'Preset name...',
    });
    if (!name || !name.trim()) return;
    const newId = _uid();
    settings.kwPromptPresets ??= {};
    settings.kwPromptPresets[newId] = {
      id: newId,
      name: name.trim(),
      content: ''
    };
    settings.activeKwPromptPresetId = newId;
    _saveSettingsDebounced();
    renderPromptPresetSelect();
    loadActivePromptContent();
  });
  // 프롬프트 프리셋 삭제
  promptDelBtn?.addEventListener('click', async () => {
    const presets = settings.kwPromptPresets || {};
    if (Object.keys(presets).length <= 1) {
      alert('마지막 프리셋은 삭제할 수 없습니다.');
      return;
    }
    const activePreset = presets[settings.activeKwPromptPresetId];
    const ok = await _abgmConfirm(root, '"' + (activePreset?.name || settings.activeKwPromptPresetId) + '" 프리셋을 삭제할까요?');
    if (!ok) return;
    delete presets[settings.activeKwPromptPresetId];
    settings.activeKwPromptPresetId = Object.keys(presets)[0];
    _saveSettingsDebounced();
    renderPromptPresetSelect();
    loadActivePromptContent();
  });
  // 프롬프트 프리셋 이름 변경
  promptRenameBtn?.addEventListener('click', async () => {
    const activePreset = settings.kwPromptPresets?.[settings.activeKwPromptPresetId];
    if (!activePreset) return;
    const newName = await _abgmPrompt(root, '프리셋 이름 변경', {
      title: 'Rename Prompt Preset',
      initialValue: activePreset.name || '',
      placeholder: 'Preset name...',
    });
    if (!newName || !newName.trim()) return;
    activePreset.name = newName.trim();
    _saveSettingsDebounced();
    renderPromptPresetSelect();
  });
  // ===== 공통 옵션 (키워드 모드 on/off 등) =====
  const kwEnabledChk = modePanel.querySelector('#abgm_mode_kw_enabled');
  const kwOnceChk = modePanel.querySelector('#abgm_mode_kw_once');
  const useDefaultChk = modePanel.querySelector('#abgm_mode_use_default');
  // 초기값
  if (kwEnabledChk) kwEnabledChk.checked = !!settings.keywordMode;
  if (kwOnceChk) kwOnceChk.checked = !!settings.keywordOnce;
  if (useDefaultChk) useDefaultChk.checked = !!settings.useDefault;
  kwEnabledChk?.addEventListener('change', (e) => {
    settings.keywordMode = !!e.target.checked;
    _saveSettingsDebounced();
    // 메인 탭의 체크박스도 동기화
    const mainKw = root.querySelector('#abgm_keywordMode');
    if (mainKw) mainKw.checked = settings.keywordMode;
  });
  kwOnceChk?.addEventListener('change', (e) => {
    settings.keywordOnce = !!e.target.checked;
    _saveSettingsDebounced();
  });
  useDefaultChk?.addEventListener('change', (e) => {
    settings.useDefault = !!e.target.checked;
    _saveSettingsDebounced();
    // 메인 탭의 체크박스도 동기화
    const mainUseDef = root.querySelector('#abgm_useDefault');
    if (mainUseDef) mainUseDef.checked = settings.useDefault;
  });
  // > Time Mode Panel 초기화
  initTimePanel(root, settings);
  // > SFX Mode Panel 초기화
  initSfxPanel(root, settings);
} // initModePanel 닫기



/** ========================= Time Mode Panel 초기화 ========================= */
function initTimePanel(root, settings) {
  const timePanel = root.querySelector('#abgm-mode-time');
  if (!timePanel) return;
  const tm = settings.timeMode || {};
  // === 요소 참조 ===
  const enabledChk = timePanel.querySelector('#abgm_time_enabled');
  const sourceToken = timePanel.querySelector('#abgm_time_source_token');
  const sourceRealtime = timePanel.querySelector('#abgm_time_source_realtime');
  const schemeDay4 = timePanel.querySelector('#abgm_time_scheme_day4');
  const schemeAmpm2 = timePanel.querySelector('#abgm_time_scheme_ampm2');
  const day4Slots = timePanel.querySelector('#abgm_time_day4_slots');
  const ampm2Slots = timePanel.querySelector('#abgm_time_ampm2_slots');
  // === UI 업데이트 함수 ===
  function updateTimePanelUI() {
    const enabled = !!tm.enabled;
    timePanel.dataset.disabled = enabled ? "false" : "true";
    
    if (day4Slots) day4Slots.style.display = tm.scheme === 'day4' ? 'block' : 'none';
    if (ampm2Slots) ampm2Slots.style.display = tm.scheme === 'ampm2' ? 'block' : 'none';
  }
  // === 슬롯 데이터 로드 ===
  function loadSlotData(slotsContainer, dataArr) {
    if (!slotsContainer || !Array.isArray(dataArr)) return;
    const slots = slotsContainer.querySelectorAll('.abgm-time-slot');
    slots.forEach((slot, i) => {
      const data = dataArr[i];
      if (!data) return;
      const kwInput = slot.querySelector('.abgm-time-kw');
      const startInput = slot.querySelector('.abgm-time-start');
      const endInput = slot.querySelector('.abgm-time-end');
      if (kwInput) kwInput.value = data.keywords || '';
      if (startInput) startInput.value = data.start || '';
      if (endInput) endInput.value = data.end || '';
    });
  }
  // === 슬롯 데이터 저장 ===
  function saveSlotData(slotsContainer, dataArr) {
    if (!slotsContainer || !Array.isArray(dataArr)) return;
    const slots = slotsContainer.querySelectorAll('.abgm-time-slot');
    slots.forEach((slot, i) => {
      if (!dataArr[i]) return;
      const kwInput = slot.querySelector('.abgm-time-kw');
      const startInput = slot.querySelector('.abgm-time-start');
      const endInput = slot.querySelector('.abgm-time-end');
      if (kwInput) dataArr[i].keywords = kwInput.value.trim();
      if (startInput) dataArr[i].start = startInput.value || '';
      if (endInput) dataArr[i].end = endInput.value || '';
    });
  }
  // === 초기값 세팅 ===
  if (enabledChk) enabledChk.checked = !!tm.enabled;
  if (sourceToken) sourceToken.checked = tm.source === 'token';
  if (sourceRealtime) sourceRealtime.checked = tm.source === 'realtime';
  if (schemeDay4) schemeDay4.checked = tm.scheme === 'day4';
  if (schemeAmpm2) schemeAmpm2.checked = tm.scheme === 'ampm2';
  loadSlotData(day4Slots, tm.day4);
  loadSlotData(ampm2Slots, tm.ampm2);
  updateTimePanelUI();
  // === 이벤트 바인딩 ===
  enabledChk?.addEventListener('change', (e) => {
    tm.enabled = !!e.target.checked;
    updateTimePanelUI();
    _saveSettingsDebounced();
  });
  sourceToken?.addEventListener('change', () => {
    if (sourceToken.checked) {
      tm.source = 'token';
      _saveSettingsDebounced();
    }
  });
  sourceRealtime?.addEventListener('change', () => {
    if (sourceRealtime.checked) {
      tm.source = 'realtime';
      _saveSettingsDebounced();
    }
  });
  schemeDay4?.addEventListener('change', () => {
    if (schemeDay4.checked) {
      tm.scheme = 'day4';
      updateTimePanelUI();
      _saveSettingsDebounced();
    }
  });
  schemeAmpm2?.addEventListener('change', () => {
    if (schemeAmpm2.checked) {
      tm.scheme = 'ampm2';
      updateTimePanelUI();
      _saveSettingsDebounced();
    }
  });
  day4Slots?.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('input', () => {
      saveSlotData(day4Slots, tm.day4);
      _saveSettingsDebounced();
    });
  });
  ampm2Slots?.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('input', () => {
      saveSlotData(ampm2Slots, tm.ampm2);
      _saveSettingsDebounced();
    });
  });
} // initTimePanel 닫기



/** ========================= SFX Mode Panel 초기화 ========================= */
function initSfxPanel(root, settings) {
  const sfxPanel = root.querySelector('#abgm-mode-sfx');
  if (!sfxPanel) return;
  // sfxMode 보정 (혹시 없으면 여기서도 기본값 세팅)
  settings.sfxMode ??= {};
  settings.sfxMode.overlay ??= true;
  settings.sfxMode.skipInOtherModes ??= true;
  const sfx = settings.sfxMode;
  // === 요소 참조 ===
  const overlayChk = sfxPanel.querySelector('#abgm_sfx_overlay');
  const skipOtherChk = sfxPanel.querySelector('#abgm_sfx_skip_other');
  // === 초기값 세팅 ===
  if (overlayChk) overlayChk.checked = !!sfx.overlay;
  if (skipOtherChk) skipOtherChk.checked = !!sfx.skipInOtherModes;
  // === 이벤트 바인딩 ===
  overlayChk?.addEventListener('change', (e) => {
    settings.sfxMode.overlay = !!e.target.checked;
    _saveSettingsDebounced();
  });
  skipOtherChk?.addEventListener('change', (e) => {
    settings.sfxMode.skipInOtherModes = !!e.target.checked;
    _saveSettingsDebounced();
  });
} // initSfxPanel 닫기
