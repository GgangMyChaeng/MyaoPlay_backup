/**
 * settings_modal/preset.js
 * 프리셋 관리 (선택, 추가, 삭제, 이름변경, import/export, 바인딩)
 */

// 의존성 (부모 모듈에서 주입받음)
let _getActivePreset = (settings) =>
  (settings?.activePresetId && settings?.presets?.[settings.activePresetId]) ||
  Object.values(settings?.presets || {})[0] ||
  {};
let _getSortedBgms = (preset, sortKey) => (preset?.bgms ?? []);
let _getBgmSort = (settings) => String(settings?.ui?.presetSort ?? settings?.ui?.bgmSort ?? "added_asc");
let _saveSettingsDebounced = () => {};
let _uid = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
let _abgmConfirm = async (_root, msg) => window.confirm(String(msg || ""));
let _abgmPrompt = async (_root, _title, { value = "" } = {}) =>
  window.prompt(String(_title || ""), String(value ?? "")) ?? null;
let _rerenderAll = () => {};
let _updateNowPlayingUI = () => {};
let _engineTick = () => {};
let _getSTContextSafe = () => ({});
let _exportPresetFile = (preset) => ({ type: "autobgm_preset", version: 3, exportedAt: new Date().toISOString(), preset });
let _rekeyPreset = (p) => p;
let _pickPresetFromImportData = (d) => d?.preset ?? null;
let _clone = (o) => JSON.parse(JSON.stringify(o ?? null));
let _EXT_BIND_KEY = "autobgm_binding";
let _getEntryName = (bgm) => {
  const n = String(bgm?.name ?? "").trim();
  if (n) return n;
  const fk = String(bgm?.fileKey ?? "").trim();
  return fk || "(unknown)";
};

/**
 * 의존성 주입 함수
 */
export function bindPresetPanelDeps(deps = {}) {
  if (typeof deps.getActivePreset === "function") _getActivePreset = deps.getActivePreset;
  if (typeof deps.getSortedBgms === "function") _getSortedBgms = deps.getSortedBgms;
  if (typeof deps.getBgmSort === "function") _getBgmSort = deps.getBgmSort;
  if (typeof deps.saveSettingsDebounced === "function") _saveSettingsDebounced = deps.saveSettingsDebounced;
  if (typeof deps.uid === "function") _uid = deps.uid;
  if (typeof deps.abgmConfirm === "function") _abgmConfirm = deps.abgmConfirm;
  if (typeof deps.abgmPrompt === "function") _abgmPrompt = deps.abgmPrompt;
  if (typeof deps.rerenderAll === "function") _rerenderAll = deps.rerenderAll;
  if (typeof deps.updateNowPlayingUI === "function") _updateNowPlayingUI = deps.updateNowPlayingUI;
  if (typeof deps.engineTick === "function") _engineTick = deps.engineTick;
  if (typeof deps.getSTContextSafe === "function") _getSTContextSafe = deps.getSTContextSafe;
  if (typeof deps.exportPresetFile === "function") _exportPresetFile = deps.exportPresetFile;
  if (typeof deps.rekeyPreset === "function") _rekeyPreset = deps.rekeyPreset;
  if (typeof deps.pickPresetFromImportData === "function") _pickPresetFromImportData = deps.pickPresetFromImportData;
  if (typeof deps.clone === "function") _clone = deps.clone;
  if (typeof deps.EXT_BIND_KEY === "string") _EXT_BIND_KEY = deps.EXT_BIND_KEY;
  if (typeof deps.getEntryName === "function") _getEntryName = deps.getEntryName;
}



/** ========================= 프리셋 선택 렌더 ========================= */
// 프리셋 셀렉트 옵션 채우고 activePresetId 반영 + 프리셋 이름 input 동기화
export function renderPresetSelect(root, settings) {
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
export function renderDefaultSelect(root, settings) {
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

// "그 프리셋에 첫 곡 들어올 때만" defaultBgmKey 자동 지정 (이미 있으면 절대 안 건드림)
export function maybeSetDefaultOnFirstAdd(preset, newFileKey) {
  const cur = String(preset.defaultBgmKey ?? "").trim();
  if (cur) return; // 1) 이미 default가 있으면 절대 건드리지 않음
  const bgmCount = (preset.bgms ?? []).filter(b => String(b?.fileKey ?? "").trim()).length;
  // 2) "첫 곡"일 때만 default 자동 지정
  if (bgmCount <= 1) {
    preset.defaultBgmKey = String(newFileKey ?? "").trim();
  }
}



/** ========================= 프리셋 이벤트 초기화 ========================= */
/**
 * 프리셋 관련 이벤트 바인딩
 * @param {HTMLElement} root - 모달 루트 요소
 * @param {Object} settings - 설정 객체
 * @param {Function} ensureSettings - 설정 보장 함수
 */
export function initPresetEvents(root, settings, ensureSettings) {
  // ===== preset select =====
  root.querySelector("#abgm_preset_select")?.addEventListener("change", (e) => {
    settings.activePresetId = e.target.value;
    root.__abgmSelected?.clear?.();
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
  // ===== default select =====
  root.querySelector("#abgm_default_select")?.addEventListener("change", (e) => {
    const preset = _getActivePreset(settings);
    preset.defaultBgmKey = e.target.value;
    _saveSettingsDebounced();
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
      console.error("[MyaPl] Import failed:", err);
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
  // ===== Preset Binding UI (bind preset to character cards) =====
  initPresetBindingOverlay(root, settings, ensureSettings);
}



/** ========================= Preset Binding 오버레이 ========================= */
function initPresetBindingOverlay(root, settings, ensureSettings) {
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
        statusEl.textContent = `✔ 현재 프리셋에 연결됨`;
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
}