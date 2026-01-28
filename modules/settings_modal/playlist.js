/**
 * settings_modal/playlist.js
 * BGM 목록 테이블 UI 및 이벤트 핸들링
 */

import { escapeHtml } from "../utils.js";
import { renderPresetSelect, renderDefaultSelect, maybeSetDefaultOnFirstAdd } from "./preset.js";
import { abgmEntryDetailPrompt } from "../ui_modal.js";

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
let _updateNowPlayingUI = () => {};
let _engineTick = () => {};
let _playAsset = async (_fileKey, _volume01) => {};
let _clone = (o) => JSON.parse(JSON.stringify(o ?? null));
let _dropboxToRaw = (u) => u;
let _isFileKeyReferenced = () => false;
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
let _importZip = async () => [];
let _basenameNoExt = (s = "") => (String(s).split("/").pop() || "").replace(/\.[^/.]+$/, "");
let _getEntryName = (bgm) => {
  const n = String(bgm?.name ?? "").trim();
  if (n) return n;
  const fk = String(bgm?.fileKey ?? "").trim();
  return fk || "(unknown)";
};
let _ensureBgmNames = (_preset) => {};
let _countImageKeyRefs = () => 0;
let _newImageAssetKey = () => "img_" + _uid();
let _applyLiveVolumeForKey = () => {};

/**
 * 의존성 주입 함수
 */
export function bindPlaylistPanelDeps(deps = {}) {
  if (typeof deps.getActivePreset === "function") _getActivePreset = deps.getActivePreset;
  if (typeof deps.getSortedBgms === "function") _getSortedBgms = deps.getSortedBgms;
  if (typeof deps.getBgmSort === "function") _getBgmSort = deps.getBgmSort;
  if (typeof deps.saveSettingsDebounced === "function") _saveSettingsDebounced = deps.saveSettingsDebounced;
  if (typeof deps.uid === "function") _uid = deps.uid;
  if (typeof deps.abgmConfirm === "function") _abgmConfirm = deps.abgmConfirm;
  if (typeof deps.updateNowPlayingUI === "function") _updateNowPlayingUI = deps.updateNowPlayingUI;
  if (typeof deps.engineTick === "function") _engineTick = deps.engineTick;
  if (typeof deps.playAsset === "function") _playAsset = deps.playAsset;
  if (typeof deps.clone === "function") _clone = deps.clone;
  if (typeof deps.dropboxToRaw === "function") _dropboxToRaw = deps.dropboxToRaw;
  if (typeof deps.isFileKeyReferenced === "function") _isFileKeyReferenced = deps.isFileKeyReferenced;
  if (typeof deps.abgmPickPreset === "function") _abgmPickPreset = deps.abgmPickPreset;
  if (typeof deps.abgmGetDurationSecFromBlob === "function") _abgmGetDurationSecFromBlob = deps.abgmGetDurationSecFromBlob;
  if (typeof deps.idbPut === "function") _idbPut = deps.idbPut;
  if (typeof deps.idbDel === "function") _idbDel = deps.idbDel;
  if (typeof deps.idbPutImage === "function") _idbPutImage = deps.idbPutImage;
  if (typeof deps.idbDelImage === "function") _idbDelImage = deps.idbDelImage;
  if (typeof deps.ensureAssetList === "function") _ensureAssetList = deps.ensureAssetList;
  if (typeof deps.importZip === "function") _importZip = deps.importZip;
  if (typeof deps.basenameNoExt === "function") _basenameNoExt = deps.basenameNoExt;
  if (typeof deps.getEntryName === "function") _getEntryName = deps.getEntryName;
  if (typeof deps.ensureBgmNames === "function") _ensureBgmNames = deps.ensureBgmNames;
  if (typeof deps.countImageKeyRefs === "function") _countImageKeyRefs = deps.countImageKeyRefs;
  if (typeof deps.newImageAssetKey === "function") _newImageAssetKey = deps.newImageAssetKey;
  if (typeof deps.applyLiveVolumeForKey === "function") _applyLiveVolumeForKey = deps.applyLiveVolumeForKey;
}

// 엔트리 라벨 (삭제 confirm 같은 데서 씀)
function abgmEntryLabel(bgm) {
  const n = String(bgm?.name ?? "").trim();
  if (n) return n;
  const fk = String(bgm?.fileKey ?? "").trim();
  return fk || "(unknown)";
}



/** ========================= BGM 테이블 렌더 (목록/행 UI) ========================= */
export function renderBgmTable(root, settings) {
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
          <div class="abgm-source-row" style="display:flex; gap:8px; align-items:center;">
          <div class="menu_button abgm-iconbtn abgm_change_source" title="Change Source" style="white-space:nowrap;">
            <i class="fa-solid fa-file-audio"></i>
            </div>
          <div class="menu_button abgm-iconbtn abgm_license_btn" title="License / Description" style="white-space:nowrap;">
            <i class="fa-solid fa-file-lines"></i>
          </div>
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
}



/** ========================= UI 락 / 전체 리렌더 ========================= */
export function setPlayButtonsLocked(root, locked) {
  root?.querySelectorAll?.(".abgm_test")?.forEach((btn) => {
    btn.classList.toggle("abgm-test-locked", !!locked);
    btn.setAttribute("aria-disabled", locked ? "true" : "false");
    btn.title = locked ? "Disabled in Keyword Mode" : "Play";
  });
}

export function rerenderAll(root, settings) {
  renderPresetSelect(root, settings);
  renderDefaultSelect(root, settings);
  renderBgmTable(root, settings);
  if (typeof root?.__abgmUpdateSelectionUI === "function") {
    root.__abgmUpdateSelectionUI();
  }
  setPlayButtonsLocked(root, !!settings.keywordMode);
}



/** ========================= 플레이리스트 이벤트 초기화 ========================= */
export function initPlaylistEvents(root, settings) {
  // ===== select all =====
  root.querySelector("#abgm_sel_all")?.addEventListener("change", (e) => {
    const preset = _getActivePreset(settings);
    const list = _getSortedBgms(preset, _getBgmSort(settings));
    const selected = root.__abgmSelected;
    if (e.target.checked) list.forEach((b) => selected.add(b.id));
    else selected.clear();
    rerenderAll(root, settings);
  });
  // ===== row checkbox =====
  root.querySelector("#abgm_bgm_tbody")?.addEventListener("change", (e) => {
    if (!e.target.classList?.contains("abgm_sel")) return;
    const tr = e.target.closest("tr");
    if (!tr) return;
    const id = tr.dataset.id;
    if (e.target.checked) root.__abgmSelected.add(id);
    else root.__abgmSelected.delete(id);
    root.__abgmUpdateSelectionUI?.();
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
      preset.defaultBgmKey = "";
    }
    selected.clear();
    for (const fk of removedKeys) {
      if (!fk) continue;
      if (_isFileKeyReferenced(settings, fk)) continue;
      try { await _idbDel(fk); delete settings.assets[fk]; } catch {}
    }
    _saveSettingsDebounced();
    rerenderAll(root, settings);
  });
  // ===== bulk reset volume =====
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
      bgm.volume = 1.0;
    }
    _saveSettingsDebounced();
    rerenderAll(root, settings);
    try { _engineTick(); } catch {}
  });
  // ===== Refresh BGM list =====
  root.querySelector("#abgm_refresh_list")?.addEventListener("click", () => {
    rerenderAll(root, settings);
  });
  // ===== Add empty entry row =====
  root.querySelector("#abgm_bgm_add_row")?.addEventListener("click", () => {
    const preset = _getActivePreset(settings);
    preset.bgms ??= [];
    preset.bgms.push({
      id: _uid(),
      fileKey: "",
      name: "",
      keywords: "",
      priority: 0,
      volume: 1.0,
      volLocked: false,
    });
    _saveSettingsDebounced();
    rerenderAll(root, settings);
  });
  // ===== Expand/Collapse all =====
  root.querySelector("#abgm_expand_all")?.addEventListener("click", () => {
    const preset = _getActivePreset(settings);
    const list = _getSortedBgms(preset, _getBgmSort(settings));
    list.forEach((b) => root.__abgmExpanded.add(b.id));
    rerenderAll(root, settings);
  });
  root.querySelector("#abgm_collapse_all")?.addEventListener("click", () => {
    root.__abgmExpanded.clear();
    rerenderAll(root, settings);
  });
  // ===== lock all volume sliders =====
  root.querySelector("#abgm_lock_all_vol")?.addEventListener("click", () => {
    const preset = _getActivePreset(settings);
    (preset.bgms ?? []).forEach((b) => { b.volLocked = true; });
    _saveSettingsDebounced();
    rerenderAll(root, settings);
  });
  // ===== MP3 add =====
  const mp3Input = root.querySelector("#abgm_bgm_file");
  root.querySelector("#abgm_bgm_add")?.addEventListener("click", () => mp3Input?.click());
  mp3Input?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const selectEl = root.querySelector("#abgm_preset_select");
    const uiSelectedId = selectEl?.value;
    if (uiSelectedId && uiSelectedId !== settings.activePresetId) {
      settings.activePresetId = uiSelectedId;
    }
    const preset = settings.presets[settings.activePresetId];
    if (!preset) return;
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
    maybeSetDefaultOnFirstAdd(preset, fileKey);
    e.target.value = "";
    _saveSettingsDebounced();
    rerenderAll(root, settings);
  });
  // ===== ZIP add =====
  const zipInput = root.querySelector("#abgm_zip_file");
  root.querySelector("#abgm_zip_add")?.addEventListener("click", () => zipInput?.click());
  zipInput?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const importedKeys = await _importZip(file, settings);
      const selectEl = root.querySelector("#abgm_preset_select");
      const selectedPresetId = selectEl?.value || settings.activePresetId;
      if (selectedPresetId !== settings.activePresetId) {
        settings.activePresetId = selectedPresetId;
      }
      const preset = settings.presets[settings.activePresetId];
      if (!preset) return;
      const assets = _ensureAssetList(settings);
      for (const key of importedKeys) {
        assets[key] = { fileKey: key, label: key.replace(/\.\w+$/i, "") };
        const exists = preset.bgms.some((b) => b.fileKey === key);
        if (!exists) {
          preset.bgms.push({
            id: _uid(),
            fileKey: key,
            name: _basenameNoExt(key),
            keywords: "",
            priority: 0,
            volume: 1.0,
            volLocked: false,
          });
        }
      }
      if (importedKeys.length > 0) {
        maybeSetDefaultOnFirstAdd(preset, importedKeys[0]);
      }
      _saveSettingsDebounced();
      rerenderAll(root, settings);
    } catch (err) {
      console.error("[MyaPl] ZIP import failed:", err);
    } finally {
      e.target.value = "";
    }
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
    if (e.target.classList.contains("abgm_name")) {
      bgm.name = String(e.target.value || "").trim();
      _updateNowPlayingUI();
      renderDefaultSelect(root, settings);
      _saveSettingsDebounced();
      return;
    }
    if (e.target.classList.contains("abgm_source")) {
      const oldKey = String(bgm.fileKey ?? "");
      let newKey = String(e.target.value || "").trim();
      newKey = _dropboxToRaw(newKey);
      e.target.value = newKey;
      bgm.fileKey = newKey;
      if (oldKey && preset.defaultBgmKey === oldKey) {
        preset.defaultBgmKey = newKey;
      }
      _saveSettingsDebounced();
      renderDefaultSelect(root, settings);
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

  // ===== tbody click =====
  root.querySelector("#abgm_bgm_tbody")?.addEventListener("click", async (e) => {
    const tr = e.target.closest("tr");
    if (!tr) return;
    // type toggle
    if (e.target.closest(".abgm_type_toggle")) {
      const id = tr.dataset.id;
      const preset = _getActivePreset(settings);
      const bgm = preset.bgms.find((x) => x.id === id);
      if (!bgm) return;
      bgm.type = (bgm.type === "SFX") ? "BGM" : "SFX";
      _saveSettingsDebounced();
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
    // toggle expand/collapse
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
        rerenderAll(root, settings);
      }
      return;
    }
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
      const prevKey = String(bgm.imageAssetKey ?? "").trim();
      const prevRefs = prevKey ? _countImageKeyRefs(settings, prevKey) : 0;
      if (result.deleteImage) {
        if (prevKey) {
          if (prevRefs <= 1) {
            try { await _idbDelImage(prevKey); } catch (e) { console.warn("[MyaPl] Image delete failed:", e); }
          }
        }
        bgm.imageAssetKey = "";
        bgm.imageUrl = "";
      } else if (result.imageBlob) {
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
    // change source
    if (e.target.closest(".abgm_change_source")) {
      const currentSource = String(bgm.fileKey ?? "");
      const overlay = document.createElement('div');
      overlay.className = 'myaoplay-source-modal-overlay';
      overlay.innerHTML = `
        <div class="myaoplay-source-modal">
          <div class="myaoplay-source-modal-title">Change Source</div>
          <div class="myaoplay-source-modal-current">
            <label>Current Source (URL or filename)</label>
            <input type="text" class="myaoplay-source-modal-input" 
                   value="${escapeHtml(currentSource)}" 
                   placeholder="Enter URL or select a file below">
          </div>
          <div class="myaoplay-source-modal-buttons">
            <button class="myaoplay-source-modal-btn secondary" data-action="file">Select File</button>
            <button class="myaoplay-source-modal-btn primary" data-action="apply">Apply</button>
            <button class="myaoplay-source-modal-btn secondary" data-action="cancel">Cancel</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      const input = overlay.querySelector('.myaoplay-source-modal-input');
      const fileBtn = overlay.querySelector('[data-action="file"]');
      const cancelBtn = overlay.querySelector('[data-action="cancel"]');
      const applyBtn = overlay.querySelector('[data-action="apply"]');
      fileBtn.addEventListener('click', async () => {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'audio/*,.mp3,.wav,.ogg,.flac,.m4a,.aac,.wma,.opus,.webm';
        fileInput.addEventListener('change', async (ev) => {
          const file = ev.target.files?.[0];
          if (!file) return;
          const validExts = ['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac', '.wma', '.opus', '.webm'];
          const fileName = file.name.toLowerCase();
          const hasValidExt = validExts.some(ext => fileName.endsWith(ext));
          if (!hasValidExt) {
            alert('지원하는 오디오 형식: mp3, wav, ogg, flac, m4a, aac, wma, opus, webm');
            return;
          }
          const oldKey = String(bgm.fileKey ?? "");
          const newKey = String(file.name ?? "").trim();
          if (!newKey) return;
          try {
            await _idbPut(newKey, file);
            const assets = _ensureAssetList(settings);
            assets[newKey] = { fileKey: newKey, label: newKey.replace(/\.mp3$/i, "") };
            bgm.fileKey = newKey;
            if (oldKey && preset.defaultBgmKey === oldKey) {
              preset.defaultBgmKey = newKey;
            }
            if (oldKey && oldKey !== newKey && !_isFileKeyReferenced(settings, oldKey)) {
              try { await _idbDel(oldKey); delete settings.assets[oldKey]; } catch {}
            }
            input.value = newKey;
            _saveSettingsDebounced();
            rerenderAll(root, settings);
            try { _engineTick(); } catch {}
          } catch (err) {
            console.error("[MyaPl] change source failed:", err);
          }
        });
        fileInput.click();
      });
      cancelBtn.addEventListener('click', () => { overlay.remove(); });
      overlay.addEventListener('click', (ev) => { if (ev.target === overlay) overlay.remove(); });
      applyBtn.addEventListener('click', () => {
        let newValue = String(input.value ?? "").trim();
        newValue = _dropboxToRaw(newValue);
        const oldKey = String(bgm.fileKey ?? "");
        if (newValue !== oldKey) {
          bgm.fileKey = newValue;
          if (oldKey && preset.defaultBgmKey === oldKey) {
            preset.defaultBgmKey = newValue;
          }
          _saveSettingsDebounced();
          rerenderAll(root, settings);
        }
        overlay.remove();
      });
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
        id: _uid(),
      });
      _saveSettingsDebounced();
      rerenderAll(root, settings);
      return;
    }
    // move
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
        id: _uid(),
      });
      const fileKey = bgm.fileKey;
      curPreset.bgms = (curPreset.bgms ?? []).filter((x) => x.id !== id);
      if (curPreset.defaultBgmKey === fileKey) {
        curPreset.defaultBgmKey = "";
      }
      root.__abgmSelected?.delete(id);
      _saveSettingsDebounced();
      rerenderAll(root, settings);
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
        preset.defaultBgmKey = "";
      }
      if (fileKey && !_isFileKeyReferenced(settings, fileKey)) {
        try {
          await _idbDel(fileKey);
          delete settings.assets[fileKey];
        } catch {}
      }
      _saveSettingsDebounced();
      rerenderAll(root, settings);
      return;
    }
    // test play
    if (e.target.closest(".abgm_test")) {
      if (settings?.keywordMode) return;
      const fk = String(bgm?.fileKey ?? "").trim();
      if (!fk) return;
      const gv = Number(settings?.globalVolume ?? 0.7);
      const pv = Number(bgm?.volume ?? 1);
      const vol01 = (Number.isFinite(gv) ? gv : 0.7) * (Number.isFinite(pv) ? pv : 1);
      try {
        await _playAsset(fk, vol01);
      } catch (err) {
        console.warn("[MyaPl] preview play failed:", err);
      }
      return;
    }
  });
}