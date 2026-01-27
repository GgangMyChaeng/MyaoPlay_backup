import { abgmNormTag, abgmNormTags, tagCat, sortTags, tagPretty, bpmMatchesTempo, getTempoRange, bpmToSearchTempo } from "./tags.js";
import { getModalHost } from "./ui_modal.js";
import { escapeHtml } from "./utils.js";
import { addToMySources, addUrlToPreset } from "./storage.js";

// 프리뷰 재생
let _testAudio = null;

let _loadHtml = async () => "";
let _ensureSettings = () => ({});
let _saveSettingsDebounced = () => {};
let _openModal = async () => {};
let _closeModal = () => {};

// (FreeSources가 프리뷰/재생에 NP 엔진 쓰면 여기도 주입)
let _ensurePlayFile = async () => {};
let _stopRuntime = () => {};

let _syncFreeSourcesFromJson = async () => {};
let _syncBundledFreeSourcesIntoSettings = async () => {};

// 이미 로드했는지 플래그
let __abgmFreeSourcesLoaded = false;



/** ========================= 의존성 주입(외부 함수 꽂기) ========================= */
// index.js(또는 상위)에서 넘겨준 함수들(loadHtml / ensureSettings / saveSettingsDebounced / openModal 등)을
// 이 파일 내부에서 쓰게 바인딩하는 애
export function abgmBindFreeSourcesDeps(deps = {}) {
  if (typeof deps.loadHtml === "function") _loadHtml = deps.loadHtml;
  if (typeof deps.ensureSettings === "function") _ensureSettings = deps.ensureSettings;
  if (typeof deps.saveSettingsDebounced === "function") _saveSettingsDebounced = deps.saveSettingsDebounced;
  if (typeof deps.openModal === "function") _openModal = deps.openModal;
  if (typeof deps.closeModal === "function") _closeModal = deps.closeModal;
  if (typeof deps.ensurePlayFile === "function") _ensurePlayFile = deps.ensurePlayFile;
  if (typeof deps.stopRuntime === "function") _stopRuntime = deps.stopRuntime;
  if (typeof deps.syncFreeSourcesFromJson === "function") _syncFreeSourcesFromJson = deps.syncFreeSourcesFromJson;
  if (typeof deps.syncBundledFreeSourcesIntoSettings === "function") _syncBundledFreeSourcesIntoSettings = deps.syncBundledFreeSourcesIntoSettings;
}



/** ========================= 프리뷰 재생(미리듣기) ========================= */
// src(URL/파일키)로 프리소스 “프리뷰 오디오”를 재생하는 애 (오디오 버스에 freesrc로 연결)
function playAsset(src, vol01 = 0.6) {
  try {
    if (!_testAudio) {
      _testAudio = new Audio();
      window.__ABGM_AUDIO_BUS__ ??= { engine: null, freesrc: null, preview: null };

      window.__ABGM_AUDIO_BUS__.freesrc = _testAudio;
      _testAudio.addEventListener("play", () => window.abgmStopOtherAudio?.("freesrc"));
    }
    _testAudio.pause();
    _testAudio.src = String(src || "");
    _testAudio.volume = Math.max(0, Math.min(1, Number(vol01 ?? 0.6)));
    _testAudio.currentTime = 0;
    window.abgmStopOtherAudio?.("freesrc");
    _testAudio.play().catch(() => {});
  } catch (e) {}
}

// 프리뷰 볼륨을 탭별(Free/My)로 읽어오는 애 (0~100)
function fsGetPreviewVol100(settings) {
  const tab = String(settings?.fsUi?.tab || "free");
  const v = (tab === "my") ? settings?.fsUi?.previewVolMy : settings?.fsUi?.previewVolFree;
  const n = Math.max(0, Math.min(100, Number(v ?? 60)));
  return Number.isFinite(n) ? n : 60;
}

// 프리뷰 볼륨을 탭별(Free/My)로 저장하는 애 (0~100)
function fsSetPreviewVol100(settings, v100) {
  const tab = String(settings?.fsUi?.tab || "free");
  const n = Math.max(0, Math.min(100, Number(v100 ?? 60)));
  if (tab === "my") settings.fsUi.previewVolMy = n;
  else settings.fsUi.previewVolFree = n;
}

// 프리뷰 볼륨 잠금 상태를 탭별(Free/My)로 읽는 애
function fsGetPreviewLock(settings) {
  const tab = String(settings?.fsUi?.tab || "free");
  return tab === "my" ? !!settings?.fsUi?.previewVolLockMy : !!settings?.fsUi?.previewVolLockFree;
}

// 프리뷰 볼륨 잠금 상태를 탭별(Free/My)로 저장하는 애
function fsSetPreviewLock(settings, locked) {
  const tab = String(settings?.fsUi?.tab || "free");
  if (tab === "my") settings.fsUi.previewVolLockMy = !!locked;
  else settings.fsUi.previewVolLockFree = !!locked;
}

// 프리뷰 볼륨 UI(슬라이더 값/잠금 아이콘/disabled)를 현재 settings에 맞춰 갱신하는 애
function renderFsPreviewVol(root, settings) {
  const range = root.querySelector("#abgm_fs_prevvol");
  const valEl = root.querySelector("#abgm_fs_prevvol_val");
  const lockBtn = root.querySelector("#abgm_fs_prevvol_lock");
  const lockIcon = lockBtn?.querySelector?.("i");
  if (!range) return;
  const v100 = fsGetPreviewVol100(settings);
  const locked = fsGetPreviewLock(settings);
  range.value = String(v100);
  range.disabled = !!locked;
  if (valEl) valEl.textContent = `${v100}%`;
  if (lockIcon) lockIcon.className = `fa-solid ${locked ? "fa-lock" : "fa-lock-open"}`;
  if (lockBtn) lockBtn.classList.toggle("abgm-locked", !!locked);
}



/** ========================= 필터/검색 매칭 로직 ========================= */
// 선택된 태그들이 item.tags 안에 “전부(AND)” 들어있는지 판정하는 애
function matchTagsAND(itemTags = [], selectedSet) {
  if (!selectedSet || selectedSet.size === 0) return true;
  const normTags = (itemTags || []).flatMap(abgmNormTags).filter(Boolean);
  const set = new Set(normTags);
  for (const t of selectedSet) {
    const norm = abgmNormTag(t);
    // tempo:allegro 같은 템포 태그면 BPM 범위 매칭
    if (norm.startsWith("tempo:")) {
      const tempoName = norm.split(":")[1];
      const hasBpmMatch = normTags.some(tag => {
        if (tag.startsWith("bpm:")) {
          const bpm = Number(tag.split(":")[1]);
          return bpmMatchesTempo(bpm, tempoName);
        }
        return false;
      });
      if (!hasBpmMatch && !set.has(norm)) return false;
    } else {
      if (!set.has(norm)) return false;
    }
  }
  return true;
}

// 검색어 q가 제목/태그/src에 걸리는지 판정하는 애
function matchSearch(item, q) {
  const s = String(q || "").trim().toLowerCase();
  if (!s) return true;
  const title = String(item?.title ?? item?.name ?? "").toLowerCase();
  const normTags = (item?.tags ?? []).flatMap(abgmNormTags);
  const tags = normTags.join(" ");
  const src = String(item?.src ?? item?.fileKey ?? "").toLowerCase();
  // 기본 매칭
  if (title.includes(s) || tags.includes(s) || src.includes(s)) return true;
  // 템포 용어로 검색 시 BPM 범위 매칭
  const range = getTempoRange(s);
  if (range) {
    const hasBpmMatch = normTags.some(tag => {
      if (tag.startsWith("bpm:")) {
        const bpm = Number(tag.split(":")[1]);
        return bpm >= range.min && bpm <= range.max;
      }
      return false;
    });
    if (hasBpmMatch) return true;
  }
  return false;
}

// 현재 탭(Free/My)에 맞는 리스트(settings.freeSources vs settings.mySources) 골라오는 애
function getFsActiveList(settings) {
  const tab = String(settings?.fsUi?.tab || "free");
  const arr = tab === "my" ? (settings.mySources ?? []) : (settings.freeSources ?? []);
  return Array.isArray(arr) ? arr : [];
}

// 현재 탭 + 현재 카테고리(fsUi.cat)에 해당하는 태그들을 전부 모아서 정렬해주는 애
function collectAllTagsForTabAndCat(settings) {
  const list = getFsActiveList(settings);
  const cat = String(settings?.fsUi?.cat || "all");
  const bag = new Set();
  for (const it of list) {
    for (const raw of (it?.tags ?? [])) {
      const t = abgmNormTag(raw);
      if (!t) continue;
      const c = tagCat(t);
      // bpm 카테고리면 → tempo 용어로 변환해서 저장
      if (c === "bpm") {
        if (cat === "tempo") {  // bpm 대신 tempo로
          const bpm = Number(t.split(":")[1]);
          const tempoName = bpmToSearchTempo(bpm);
          if (tempoName) {
            bag.add(`tempo:${tempoName}`);
          }
        }
        continue;
      }
      // > All = "분류 안 된 것만" (콜론 없는 태그들 = etc)
      if (cat === "all") {
        if (c !== "etc") continue;
      } else {
        if (c !== cat) continue;
      }
      bag.add(t);
    }
  }
  return sortTags(Array.from(bag));
}

// include/exclude Set 만들기
function fsGetTagSets(settings) {
  const incArr = settings?.fsUi?.tagInclude ?? settings?.fsUi?.selectedTags ?? [];
  const excArr = settings?.fsUi?.tagExclude ?? [];
  const inc = new Set(incArr.map(abgmNormTag).filter(Boolean));
  const exc = new Set(excArr.map(abgmNormTag).filter(Boolean));
  // 겹치면 include 우선
  for (const t of inc) exc.delete(t);
  return { inc, exc };
}

// include/exclude 저장 + 레거시 동기화
function fsSaveTagSets(settings, inc, exc) {
  settings.fsUi.tagInclude = Array.from(inc);
  settings.fsUi.tagExclude = Array.from(exc);
  // 레거시 동기화
  settings.fsUi.selectedTags = Array.from(inc);
}

// 제외 태그 포함이면 탈락
function matchTagsNOT(itemTags = [], excludedSet) {
  if (!excludedSet || excludedSet.size === 0) return true;
  // > itemTags는 배열이니까 flatMap으로 각각 정규화해야 함
  const set = new Set((itemTags || []).flatMap(abgmNormTags).filter(Boolean));
  for (const t of excludedSet) {
    if (set.has(t)) return false;
  }
  return true;
}




/** ========================= 렌더링(UI 그리기) ========================= */
// 태그 피커(드롭다운) 내용을 현재 cat + selectedTags 기준으로 렌더링하는 애
function renderFsTagPicker(root, settings) {
  const box = root.querySelector("#abgm_fs_tag_picker");
  if (!box) return;
  // 1) computed 기준으로 진짜 열림/닫힘 판단
  const open = getComputedStyle(box).display !== "none";
  if (!open) return;
  const wrap   = root.querySelector(".abgm-fs-wrap") || root;
  const catbar = root.querySelector("#abgm_fs_catbar");
  if (!catbar) return;
  const top = catbar.offsetTop + catbar.offsetHeight + 8;
  box.style.top = `${top}px`;
  const wrapH = wrap.clientHeight || 0;
  const maxH = Math.max(120, wrapH - top - 12);
  box.style.maxHeight = `${Math.min(240, maxH)}px`;
  const all = collectAllTagsForTabAndCat(settings);
  const { inc, exc } = fsGetTagSets(settings);
  box.innerHTML = "";
  if (!all.length) {
    const p = document.createElement("div");
    p.style.opacity = ".75";
    p.style.fontSize = "12px";
    p.style.padding = "6px 2px";
    p.textContent = "태그 없음";
    box.appendChild(p);
    return;
  }
  for (const t of all) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "menu_button abgm-fs-tagpick";
    btn.dataset.tag = t;
    const label = tagPretty(t);
    btn.textContent = inc.has(t) ? `✅ ${label}` : (exc.has(t) ? `🚫 ${label}` : label);
    btn.title = t; // 2) hover하면 원본(genre:xxx) 보이게
    box.appendChild(btn);
  }
}

// 스크롤/리사이즈 시 태그 피커(top/maxHeight) 재계산해서 레이아웃 맞추는 애
function fsRelayoutTagPicker(root) {
  const box = root.querySelector("#abgm_fs_tag_picker");
  if (!box || box.style.display === "none") return;
  const wrap   = root.querySelector(".abgm-fs-wrap") || root;
  const catbar = root.querySelector("#abgm_fs_catbar");
  if (!catbar) return;
  const top = catbar.offsetTop + catbar.offsetHeight + 8;
  box.style.top = `${top}px`;
  const wrapH = wrap.clientHeight || 0;
  const maxH = Math.max(120, wrapH - top - 12);
  box.style.maxHeight = `${Math.min(240, maxH)}px`;
}

// 리스트(아이템들) 렌더링: 태그 include(AND) + exclude(NOT) + 검색 필터 → A→Z 정렬
function renderFsList(root, settings) {
  const listEl = root.querySelector("#abgm_fs_list");
  if (!listEl) return;
  const { inc, exc } = fsGetTagSets(settings);
  const q = String(settings.fsUi?.search ?? "");
  const sortOrder = String(settings.fsUi?.sortOrder ?? "date-newest");
  const listRaw = getFsActiveList(settings);
  const filtered = listRaw
    .filter((it) =>
      matchTagsAND(it?.tags ?? [], inc) &&
      matchTagsNOT(it?.tags ?? [], exc) &&
      matchSearch(it, q)
    )
    .sort((a, b) => {
      // 정렬 로직
      if (sortOrder === "name-asc" || sortOrder === "name-desc") {
        const an = String(a?.title ?? a?.name ?? "").trim();
        const bn = String(b?.title ?? b?.name ?? "").trim();
        const cmp = an.localeCompare(bn, undefined, { numeric: true, sensitivity: "base" });
        return sortOrder === "name-desc" ? -cmp : cmp;
      }
      // date 정렬: addedDate 없으면 맨 뒤로 (오래된 취급)
      const aDate = a?.addedDate || "";
      const bDate = b?.addedDate || "";
      // 둘 다 없으면 이름순
      if (!aDate && !bDate) {
        const an = String(a?.title ?? a?.name ?? "").trim();
        const bn = String(b?.title ?? b?.name ?? "").trim();
        return an.localeCompare(bn, undefined, { numeric: true, sensitivity: "base" });
      }
      // 하나만 없으면 없는 쪽이 뒤로
      if (!aDate) return 1;
      if (!bDate) return -1;
      // 둘 다 있으면 날짜 비교
      const cmp = aDate.localeCompare(bDate);
      return sortOrder === "date-newest" ? -cmp : cmp;
    });
  listEl.innerHTML = "";
  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.style.opacity = ".75";
    empty.style.fontSize = "12px";
    empty.style.padding = "10px";
    empty.textContent = "결과 없음";
    listEl.appendChild(empty);
    return;
  }
  for (const it of filtered) {
    const id = String(it?.id ?? "");
    const title = String(it?.title ?? it?.name ?? "(no title)");
    const dur = abgmFmtDur(it?.durationSec ?? 0);
    const tags = Array.isArray(it?.tags) ? it.tags.map(abgmNormTag).filter(Boolean) : [];
    const src = String(it?.src ?? it?.fileKey ?? "");
    const row = document.createElement("div");
    row.className = "abgm-fs-item";
    row.dataset.id = id;
    row.innerHTML = `
  <div class="abgm-fs-main" data-id="${escapeHtml(id)}" data-title="${escapeHtml(title)}" data-tags='${escapeHtml(JSON.stringify(tags))}'>
    <div class="abgm-fs-name">${escapeHtml(title)}</div>
    <div class="abgm-fs-time">${escapeHtml(dur)}</div>
  </div>
  <div class="abgm-fs-side">
    <div class="abgm-fs-actions">
      <button type="button" class="menu_button abgm-fs-play" title="Play" data-src="${escapeHtml(src)}">▶</button>
      <button type="button" class="menu_button abgm-fs-addmenu-btn" title="More options" data-id="${escapeHtml(id)}" data-title="${escapeHtml(title)}" data-src="${escapeHtml(src)}">⋯</button>
    </div>
  </div>
`;
    listEl.appendChild(row);
  }
}

// 탭 활성화/검색창 값/카테고리 활성화 표시 + (태그피커/리스트/프리뷰볼륨) 싹 갱신하는 애
function renderFsAll(root, settings) {
  // 2) tab active UI
  root.querySelectorAll(".abgm-fs-tab")?.forEach?.((b) => {
    const t = String(b.dataset.tab || "");
    const on = t === String(settings.fsUi?.tab || "free");
    b.classList.toggle("is-active", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  });
  // 3) search ui
  const search = root.querySelector("#abgm_fs_search");
  if (search) search.value = String(settings.fsUi?.search ?? "");
  // 3-1) sort ui
  const sortSel = root.querySelector("#abgm_fs_sort");
  if (sortSel) sortSel.value = String(settings.fsUi?.sortOrder ?? "date-newest");
  // 4) cat active UI
  const cur = String(settings?.fsUi?.cat || "all");
  root.querySelectorAll(".abgm-fs-cat")?.forEach?.((b) => {
    b.classList.toggle("is-active", String(b.dataset.cat || "all") === cur);
  });
  renderFsTagPicker(root, settings);
  renderFsList(root, settings);
  renderFsPreviewVol(root, settings);
}



/** ========================= 모달 열기/닫기 & 이벤트 연결 ========================= */
// 프리소스 모달 overlay 제거 + ESC 리스너 해제하는 애
export function closeFreeSourcesModal() {
  const overlay = document.getElementById(FS_OVERLAY_ID);
  if (overlay) overlay.remove();
  window.removeEventListener("keydown", abgmFsOnEsc);
}

// ESC 누르면 모달 닫게 하는 애
function abgmFsOnEsc(e) {
  if (e.key === "Escape") closeFreeSourcesModal();
}

// freesources.html 로드해서 overlay 만들고, 바깥클릭/ESC 연결하고 init까지 호출하는 애
export async function openFreeSourcesModal() {
  await _syncFreeSourcesFromJson({ force: true, save: true });
  if (document.getElementById(FS_OVERLAY_ID)) return;
  let html = "";
  try {
    html = await _loadHtml("templates/freesources.html");
  } catch (e) {
    console.error("[MyaPl] freesources.html load failed", e);
    return;
  }
  const overlay = document.createElement("div");
  overlay.id = FS_OVERLAY_ID;
  overlay.className = "autobgm-overlay"; // > 기존 overlay css 재활용
  overlay.innerHTML = html;
  // 1) 바깥 클릭 닫기(원하면)
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeFreeSourcesModal();
  });
  const host = getModalHost();
  const cs = getComputedStyle(host);
  if (cs.position === "static") host.style.position = "relative";
  // 2) overlay 스타일
  const setO = (k, v) => overlay.style.setProperty(k, v, "important");
  setO("position", "absolute");
  setO("inset", "0");
  setO("display", "block");
  setO("overflow", "auto");
  setO("-webkit-overflow-scrolling", "touch");
  setO("background", "rgba(0,0,0,.55)");
  setO("z-index", "2147483647");
  setO("padding", "0");
  host.appendChild(overlay);
  window.addEventListener("keydown", abgmFsOnEsc);
  await initFreeSourcesModal(overlay);
  // console.log("[MyaPl] freesources modal opened");
}



/** ========================= 바텀시트 (Add to...) ========================= */
function openAddToBottomSheet(root, settings, item) {
  closeAddToBottomSheet();
  
  // 풀 아이템 정보 가져오기
  const fullItem = getFsActiveList(settings).find(it => it.id === item.id) || item;
  const itemTags = fullItem?.tags || [];
  const itemLicense = fullItem?.license || "";
  const itemLyrics = fullItem?.lyrics || "";
  const itemImage = fullItem?.image || fullItem?.imageUrl || "";
  
  const overlay = document.createElement("div");
  overlay.id = "abgm_addto_overlay";
  overlay.className = "abgm-addto-overlay";
  
  const sheet = document.createElement("div");
  sheet.className = "abgm-addto-sheet";
  
  // ===== 헤더 (타이틀 + 탭) =====
  const header = document.createElement("div");
  header.className = "abgm-addto-header";
  header.innerHTML = `
    <div class="abgm-addto-handle" aria-hidden="true"></div>
    <div class="abgm-addto-title">${escapeHtml(item.title)}</div>
    <div class="abgm-addto-tabs" style="display:flex; gap:4px; margin-top:8px;">
      <button type="button" class="menu_button abgm-addto-tab is-active" data-tab="copy" style="flex:1; padding:6px 0; font-size:13px;">복사</button>
      <button type="button" class="menu_button abgm-addto-tab" data-tab="info" style="flex:1; padding:6px 0; font-size:13px;">정보</button>
    </div>
  `;
  sheet.appendChild(header);
  
  // ===== 패널 컨테이너 =====
  const panelContainer = document.createElement("div");
  panelContainer.className = "abgm-addto-panels";
  panelContainer.style.cssText = "overflow-y:auto; max-height:50vh;";
  
  // ----- 복사 탭 패널 -----
  const copyPanel = document.createElement("div");
  copyPanel.className = "abgm-addto-panel";
  copyPanel.dataset.panel = "copy";
  copyPanel.style.display = "block";
  
  // 클립보드에 복사
  const clipBtn = document.createElement("button");
  clipBtn.type = "button";
  clipBtn.className = "abgm-addto-item";
  clipBtn.dataset.action = "clipboard";
  clipBtn.innerHTML = `<i class="fa-solid fa-clipboard"></i><span>클립보드에 복사</span>`;
  copyPanel.appendChild(clipBtn);
  
  // 마이소스에 복사
  const myBtn = document.createElement("button");
  myBtn.type = "button";
  myBtn.className = "abgm-addto-item";
  myBtn.dataset.action = "mysources";
  myBtn.innerHTML = `<i class="fa-solid fa-bookmark"></i><span>마이소스에 복사</span>`;
  copyPanel.appendChild(myBtn);
  
  // 프리셋 목록
  const presetIds = Object.keys(settings.presets || {}).sort((a, b) => {
    const na = settings.presets[a]?.name || a;
    const nb = settings.presets[b]?.name || b;
    return na.localeCompare(nb, undefined, { sensitivity: "base" });
  });
  if (presetIds.length > 0) {
    const divider = document.createElement("div");
    divider.className = "abgm-addto-divider";
    divider.textContent = "프리셋";
    copyPanel.appendChild(divider);
  }
  for (const pid of presetIds) {
    const p = settings.presets[pid];
    const pBtn = document.createElement("button");
    pBtn.type = "button";
    pBtn.className = "abgm-addto-item";
    pBtn.dataset.action = "preset";
    pBtn.dataset.presetId = pid;
    pBtn.innerHTML = `<i class="fa-solid fa-music"></i><span>${escapeHtml(p.name || pid)}</span>`;
    copyPanel.appendChild(pBtn);
  }
  panelContainer.appendChild(copyPanel);
  
  // ----- 정보 탭 패널 -----
  const infoPanel = document.createElement("div");
  infoPanel.className = "abgm-addto-panel";
  infoPanel.dataset.panel = "info";
  infoPanel.style.display = "none";
  infoPanel.style.padding = "12px";
  
  // 태그 섹션
  const tagSection = document.createElement("div");
  tagSection.className = "abgm-addto-tags-section";
  tagSection.style.marginBottom = "12px";
  if (itemTags.length === 0) {
    const empty = document.createElement("div");
    empty.className = "abgm-tags-empty";
    empty.style.cssText = "opacity:.5; font-size:12px;";
    empty.textContent = "(태그 없음)";
    tagSection.appendChild(empty);
  } else {
    const chips = document.createElement("div");
    chips.className = "abgm-tags-chips";
    chips.style.cssText = "display:flex; flex-wrap:wrap; gap:6px;";
    for (const t of itemTags) {
      const chip = document.createElement("span");
      chip.className = "abgm-tag-chip";
      chip.textContent = `#${tagPretty(t)}`;
      chip.title = t;
      chips.appendChild(chip);
    }
    tagSection.appendChild(chips);
  }
  infoPanel.appendChild(tagSection);
  
  // 가사 섹션
  if (itemLyrics) {
    const lyricsSection = document.createElement("div");
    lyricsSection.style.cssText = "margin-bottom:12px;";
    const lyricsLabel = document.createElement("div");
    lyricsLabel.style.cssText = "font-size:12px; opacity:.7; margin-bottom:6px;";
    lyricsLabel.textContent = "🎤 가사";
    lyricsSection.appendChild(lyricsLabel);
    const lyricsContent = document.createElement("div");
    lyricsContent.style.cssText = "white-space:pre-wrap; font-size:12px; line-height:1.5; max-height:150px; overflow-y:auto; padding:8px; background:rgba(0,0,0,.2); border-radius:8px;";
    lyricsContent.textContent = itemLyrics;
    lyricsSection.appendChild(lyricsContent);
    infoPanel.appendChild(lyricsSection);
  }
  
  // 이미지 + 라이센스 가로 배치
  if (itemImage || itemLicense) {
    const bottomRow = document.createElement("div");
    bottomRow.style.cssText = "display:flex; gap:12px; align-items:flex-start;";
    
    // 이미지 (좌측)
    if (itemImage) {
      const imgWrap = document.createElement("div");
      imgWrap.style.cssText = "flex-shrink:0; width:80px; height:80px; border-radius:8px; overflow:hidden; background:rgba(0,0,0,.2);";
      const img = document.createElement("img");
      img.src = itemImage;
      img.style.cssText = "width:100%; height:100%; object-fit:cover;";
      img.onerror = () => { imgWrap.style.display = "none"; };
      imgWrap.appendChild(img);
      bottomRow.appendChild(imgWrap);
    }
    
    // 라이센스 (우측)
    if (itemLicense) {
      const licenseWrap = document.createElement("div");
      licenseWrap.style.cssText = "flex:1; min-width:0;";
      const licenseLabel = document.createElement("div");
      licenseLabel.style.cssText = "font-size:12px; opacity:.7; margin-bottom:4px;";
      licenseLabel.textContent = "📜 라이센스";
      licenseWrap.appendChild(licenseLabel);
      const licenseContent = document.createElement("div");
      licenseContent.style.cssText = "white-space:pre-wrap; font-size:11px; line-height:1.4; max-height:80px; overflow-y:auto; opacity:.8;";
      licenseContent.textContent = itemLicense;
      licenseWrap.appendChild(licenseContent);
      bottomRow.appendChild(licenseWrap);
    }
    
    infoPanel.appendChild(bottomRow);
  }
  
  // 정보 없을 때
  if (!itemLyrics && !itemImage && !itemLicense && itemTags.length === 0) {
    const noInfo = document.createElement("div");
    noInfo.style.cssText = "text-align:center; opacity:.5; padding:20px; font-size:13px;";
    noInfo.textContent = "추가 정보 없음";
    infoPanel.appendChild(noInfo);
  }
  
  panelContainer.appendChild(infoPanel);
  sheet.appendChild(panelContainer);
  overlay.appendChild(sheet);
  
  // ===== 탭 전환 이벤트 =====
  const tabs = header.querySelectorAll(".abgm-addto-tab");
  const panels = panelContainer.querySelectorAll(".abgm-addto-panel");
  tabs.forEach(tab => {
    tab.addEventListener("click", (e) => {
      e.stopPropagation();
      const tabId = tab.dataset.tab;
      tabs.forEach(t => t.classList.toggle("is-active", t.dataset.tab === tabId));
      panels.forEach(p => p.style.display = p.dataset.panel === tabId ? "block" : "none");
    });
  });
  
  // ===== 오버레이 삽입 =====
  const modalOverlay = document.getElementById("abgm_modal_overlay");
  const host = modalOverlay || document.body;
  const setO = (k, v) => overlay.style.setProperty(k, v, "important");
  setO("z-index", "2147483648");
  if (modalOverlay) {
    const cs = getComputedStyle(modalOverlay);
    if (cs.position === "static") modalOverlay.style.position = "relative";
    setO("position", "absolute");
    setO("inset", "0");
  } else {
    setO("position", "fixed");
    setO("inset", "0");
  }
  host.appendChild(overlay);
  
  requestAnimationFrame(() => {
    overlay.classList.add("is-open");
  });

  // ===== 헤더 풀다운 닫기 =====
  (() => {
    const headerEl = header;
    const sheetEl = sheet;
    const overlayEl = overlay;
    let dragging = false;
    let startY = 0;
    let dy = 0;
    const getY = (e) => (e.touches?.[0]?.clientY ?? e.clientY ?? 0);
    const cleanupDoc = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onEnd);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onEnd);
    };
    const onStart = (e) => {
      if (e.type === "mousedown" && e.button !== 0) return;
      dragging = true;
      startY = getY(e);
      dy = 0;
      sheetEl.style.transition = "none";
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onEnd);
      document.addEventListener("touchmove", onMove, { passive: false });
      document.addEventListener("touchend", onEnd);
      document.addEventListener("touchcancel", onEnd);
    };
    const onMove = (e) => {
      if (!dragging) return;
      if (e.cancelable) e.preventDefault();
      const y = getY(e);
      dy = Math.max(0, y - startY);
      sheetEl.style.transform = `translateY(${dy}px)`;
      const alpha = Math.max(0, Math.min(0.5, 0.5 * (1 - dy / 260)));
      overlayEl.style.background = `rgba(0,0,0,${alpha})`;
    };
    const onEnd = () => {
      if (!dragging) return;
      dragging = false;
      cleanupDoc();
      const rect = sheetEl.getBoundingClientRect();
      const closePx = Math.min(160, Math.max(90, rect.height * 0.22));
      if (dy > closePx) {
        closeAddToBottomSheet({ dragging: true });
        return;
      }
      sheetEl.style.transition = "";
      sheetEl.style.transform = "";
      overlayEl.style.background = "";
    };
    headerEl.style.touchAction = "none";
    headerEl.addEventListener("touchstart", onStart, { passive: false });
    headerEl.addEventListener("mousedown", onStart);
  })();

  // ===== 클릭 이벤트 =====
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) {
      closeAddToBottomSheet();
      return;
    }
    const itemBtn = e.target.closest(".abgm-addto-item");
    if (itemBtn) {
      const action = itemBtn.dataset.action;
      if (action === "clipboard") {
        const src = item.src || "";
        navigator.clipboard.writeText(src).then(() => {
          if (typeof toastr !== "undefined") toastr.success("클립보드에 복사됨");
        }).catch(() => {
          if (typeof toastr !== "undefined") toastr.error("복사 실패");
        });
        closeAddToBottomSheet();
        return;
      }
      if (action === "mysources") {
        addToMySources(settings, fullItem);
        _saveSettingsDebounced();
        if (typeof toastr !== "undefined") toastr.success("마이소스에 추가됨");
      } else if (action === "preset") {
        const presetId = itemBtn.dataset.presetId;
        addUrlToPreset(settings, presetId, fullItem);
        _saveSettingsDebounced();
        const pName = settings.presets[presetId]?.name || presetId;
        if (typeof toastr !== "undefined") toastr.success(`"${pName}" 프리셋에 추가됨`);
      }
      closeAddToBottomSheet();
    }
  });
  
  // ESC 닫기
  const onEsc = (e) => {
    if (e.key === "Escape") {
      closeAddToBottomSheet();
      window.removeEventListener("keydown", onEsc);
    }
  };
  window.addEventListener("keydown", onEsc);
}

function closeAddToBottomSheet(opts = {}) {
  const overlay = document.getElementById("abgm_addto_overlay");
  if (!overlay) return;
  // 드래그로 닫을 때: 현재 위치에서 아래로 더 내려가며 닫히게
  if (opts?.dragging) {
    try {
      const sheet = overlay.querySelector(".abgm-addto-sheet");
      const h = sheet?.getBoundingClientRect?.().height || 0;
      if (sheet && h) {
        sheet.style.transition = "transform 0.22s cubic-bezier(0.4, 0, 0.2, 1)";
        sheet.style.transform = `translateY(${h}px)`;
      }
      overlay.style.transition = "background 0.22s ease";
      overlay.style.background = "rgba(0,0,0,0)";
    } catch {}
  }
  overlay.classList.remove("is-open");
  setTimeout(() => overlay.remove(), opts?.dragging ? 240 : 200);
}



// 모달 내부 이벤트 전부 연결하는 애
// - 탭 전환(Free/My) 시 검색/태그/카테고리 초기화 + 렌더
// - 카테고리 클릭 시 태그피커 토글(같은 카테고리 재클릭이면 닫기)
// - 검색 input 시 리스트만 갱신
// - Clear 버튼으로 필터 초기화
// - 프리뷰 볼륨 슬라이더/락 버튼
// - 이벤트 위임: 태그 선택 토글, 아이템 클릭 시 show-tags 토글, play/copy, 태그 버튼 클릭 시 필터에 추가, 등
async function initFreeSourcesModal(overlay) {
  const settings = _ensureSettings();
  await _syncBundledFreeSourcesIntoSettings(settings, { force: true, save: true });
  const root = overlay;
  root.addEventListener("scroll", () => fsRelayoutTagPicker(root), true);
  window.addEventListener("resize", () => fsRelayoutTagPicker(root));
  // 1) close btn
  root.querySelector(".abgm-fs-close")?.addEventListener("click", closeFreeSourcesModal);
  // 2) tab switch
  root.querySelectorAll(".abgm-fs-tab")?.forEach?.((btn) => {
    btn.addEventListener("click", () => {
      settings.fsUi.tab = String(btn.dataset.tab || "free");
      settings.fsUi.search = "";
      settings.fsUi.selectedTags = [];
      settings.fsUi.tagInclude = [];
      settings.fsUi.tagExclude = [];
      settings.fsUi.cat = "all";
      // 3) picker 닫기
      const picker = root.querySelector("#abgm_fs_tag_picker");
      if (picker) picker.style.display = "none";
      _saveSettingsDebounced();
      renderFsAll(root, settings);
    });
  });
  // 4) category click => dropdown toggle
  root.querySelectorAll(".abgm-fs-cat")?.forEach?.((btn) => {
    btn.addEventListener("click", () => {
      const nextCat = String(btn.dataset.cat || "all");
      const picker = root.querySelector("#abgm_fs_tag_picker");
      if (!picker) return;
      const sameCat = String(settings.fsUi.cat || "all") === nextCat;
      const isOpen = picker.style.display !== "none";
      settings.fsUi.cat = nextCat;
      // 5) 같은 카테고리 다시 누르면 닫기 / 아니면 열기
      picker.style.display = (sameCat && isOpen) ? "none" : "block";
      _saveSettingsDebounced();
      renderFsAll(root, settings);
    });
  });
  // 6) search
  const search = root.querySelector("#abgm_fs_search");
  search?.addEventListener("input", (e) => {
    settings.fsUi.search = e.target.value || "";
    _saveSettingsDebounced();
    renderFsList(root, settings);
  });
  // 7) 프리뷰 볼륨
  const prevRange = root.querySelector("#abgm_fs_prevvol");
  prevRange?.addEventListener("input", (e) => {
    if (fsGetPreviewLock(settings)) return;
    fsSetPreviewVol100(settings, e.target.value);
    _saveSettingsDebounced();
    renderFsPreviewVol(root, settings);
    try {
    const v = fsGetPreviewVol100(settings) / 100;
    if (_testAudio && _testAudio.src) _testAudio.volume = Math.max(0, Math.min(1, v));
    } catch {}
  });
  // 8) clear
  root.querySelector("#abgm_fs_clear")?.addEventListener("click", () => {
    settings.fsUi.search = "";
    settings.fsUi.tagInclude = [];
    settings.fsUi.tagExclude = [];
    settings.fsUi.selectedTags = []; // > 레거시 동기화용
    settings.fsUi.cat = "all";
    const picker = root.querySelector("#abgm_fs_tag_picker");
    if (picker) picker.style.display = "none";
    _saveSettingsDebounced();
    renderFsAll(root, settings);
  });
  // ===== event delegation =====
  root.addEventListener("click", (e) => {
    // 0) ▼ 버튼 클릭 → 바텀시트 열기
    const addMenuBtn = e.target.closest(".abgm-fs-addmenu-btn");
    if (addMenuBtn) {
      e.stopPropagation();
      const itemId = addMenuBtn.dataset.id;
      const itemTitle = addMenuBtn.dataset.title || "Untitled";
      const itemSrc = addMenuBtn.dataset.src || "";
      // 리스트에서 전체 아이템 찾아서 tags 가져오기
      const list = getFsActiveList(settings);
      const fullItem = list.find(it => it.id === itemId);
      const itemTags = fullItem?.tags || [];
      openAddToBottomSheet(root, settings, { id: itemId, title: itemTitle, src: itemSrc, tags: itemTags });
      return;
    }
    // 1) tag pick toggle (in dropdown)
    const pick = e.target.closest(".abgm-fs-tagpick");
    if (pick && pick.dataset.tag) {
      const t = abgmNormTag(pick.dataset.tag);
      const { inc, exc } = fsGetTagSets(settings);
      // 2) 0:none -> 1:include -> 2:exclude -> 0:none
      if (inc.has(t)) {
        inc.delete(t);
        exc.add(t);
      } else if (exc.has(t)) {
        exc.delete(t);
      } else {
        inc.add(t);
        exc.delete(t);
      }
      fsSaveTagSets(settings, inc, exc);
      _saveSettingsDebounced();
      renderFsList(root, settings);
      renderFsTagPicker(root, settings);
      return;
    }
    // 3) Preview Vol
    const prevLockBtn = e.target.closest("#abgm_fs_prevvol_lock");
    if (prevLockBtn) {
      fsSetPreviewLock(settings, !fsGetPreviewLock(settings));
      _saveSettingsDebounced();
      renderFsPreviewVol(root, settings);
      return;
    }
    // 4) play
    const playBtn = e.target.closest(".abgm-fs-play");
    if (playBtn) {
      const src = String(playBtn.dataset.src || "").trim();
      if (!src) return;
      const v = fsGetPreviewVol100(settings) / 100;
      try { playAsset(src, v); } catch {}
      return;
    }
    // 5) copy
    const copyBtn = e.target.closest(".abgm-fs-copy");
    if (copyBtn) {
      const src = String(copyBtn.dataset.src || "").trim();
      if (!src) return;
      navigator.clipboard?.writeText?.(src).catch(() => {});
      return;
    }
    // 6) tag button inside item tagpanel => 필터에 추가(원하면)
    const tagBtn = e.target.closest(".abgm-fs-tag");
    if (tagBtn && tagBtn.dataset.tag) {
      const t = abgmNormTag(tagBtn.dataset.tag);
      const { inc, exc } = fsGetTagSets(settings);
      inc.add(t);
      exc.delete(t);
      fsSaveTagSets(settings, inc, exc);
      _saveSettingsDebounced();
      renderFsList(root, settings);
      renderFsTagPicker(root, settings);
      return;
    }
  });
  // 7) 밖 클릭하면 picker 닫기 + addmenu 닫기
  root.addEventListener("mousedown", (e) => {
    const picker = root.querySelector("#abgm_fs_tag_picker");
    if (picker) {
      const inPicker = e.target.closest("#abgm_fs_tag_picker");
      const inCat = e.target.closest(".abgm-fs-catbar");
      if (!inPicker && !inCat) picker.style.display = "none";
    }
  }, true);
  renderFsAll(root, settings);
} // initFreeSourcesModal 닫기



/** ========================= Settings 탭 내장용 초기화 ========================= */
// Settings 모달의 "소스" 탭 패널에서 호출됨
// 기존 initFreeSourcesModal과 거의 동일하지만, 닫기 버튼/오버레이 관련 로직 제외
export function initFreeSourcesInPanel(root, settings) {
  if (!root) return;
  // fsUi 초기화
  settings.fsUi ??= {};
  settings.fsUi.tab ??= "free";
  settings.fsUi.search ??= "";
  settings.fsUi.cat ??= "all";
  settings.fsUi.tagInclude ??= [];
  settings.fsUi.tagExclude ??= [];
  settings.fsUi.selectedTags ??= [];
  settings.fsUi.previewVolFree ??= 60;
  settings.fsUi.previewVolMy ??= 60;
  settings.fsUi.sortOrder ??= "date-newest"; // 정렬 기본값
  // 1) Free/My 탭 전환
  root.querySelectorAll(".abgm-fs-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab || "free";
      settings.fsUi.tab = tab;
      root.querySelectorAll(".abgm-fs-tab").forEach((b) => {
        const active = b.dataset.tab === tab;
        b.classList.toggle("is-active", active);
        b.setAttribute("aria-selected", active ? "true" : "false");
      });
      _saveSettingsDebounced();
      renderFsAll(root, settings);
    });
  });
  // 프리소스 JSON 생성 버튼
  root.querySelector("#abgm_fs_emit_json")?.addEventListener("click", (e)=>{
    e.preventDefault();
    e.stopPropagation();
    emitFreeSourceJsonSnippet();
  });
  // 2) 카테고리 버튼
  root.querySelectorAll(".abgm-fs-cat").forEach((btn) => {
    btn.addEventListener("click", () => {
      const cat = btn.dataset.cat || "all";
      const picker = root.querySelector("#abgm_fs_tag_picker");
      const wasOpen = picker && getComputedStyle(picker).display !== "none";
      const wasSameCat = settings.fsUi.cat === cat;
      settings.fsUi.cat = cat;
      root.querySelectorAll(".abgm-fs-cat").forEach((b) => {
        b.classList.toggle("is-active", b.dataset.cat === cat);
      });
      if (picker) {
        picker.style.display = (wasOpen && wasSameCat) ? "none" : "block";
      }
      _saveSettingsDebounced();
      renderFsTagPicker(root, settings);
    });
  });
  // 3) 검색
  const searchInput = root.querySelector("#abgm_fs_search");
  if (searchInput) {
    searchInput.value = settings.fsUi.search || "";
    searchInput.addEventListener("input", () => {
      settings.fsUi.search = searchInput.value;
      _saveSettingsDebounced();
      renderFsList(root, settings);
    });
  }
  // 3-1) 정렬 드롭다운
  const sortSelect = root.querySelector("#abgm_fs_sort");
  if (sortSelect) {
    sortSelect.value = settings.fsUi.sortOrder || "date-newest";
    sortSelect.addEventListener("change", () => {
      settings.fsUi.sortOrder = sortSelect.value;
      _saveSettingsDebounced();
      renderFsList(root, settings);
    });
  }
  // 4) 프리뷰 볼륨
  const prevVol = root.querySelector("#abgm_fs_prevvol");
  if (prevVol) {
    prevVol.addEventListener("input", () => {
      const v = Number(prevVol.value) || 60;
      fsSetPreviewVol100(settings, v);
      const valEl = root.querySelector("#abgm_fs_prevvol_val");
      if (valEl) valEl.textContent = `${v}%`;
      _saveSettingsDebounced();
      try {
        const vol01 = v / 100;
        if (_testAudio && _testAudio.src) _testAudio.volume = Math.max(0, Math.min(1, vol01));
      } catch {}
    });
  }
  // 5) clear 버튼
  root.querySelector("#abgm_fs_clear")?.addEventListener("click", () => {
    settings.fsUi.search = "";
    settings.fsUi.tagInclude = [];
    settings.fsUi.tagExclude = [];
    settings.fsUi.selectedTags = [];
    settings.fsUi.cat = "all";
    const picker = root.querySelector("#abgm_fs_tag_picker");
    if (picker) picker.style.display = "none";
    if (searchInput) searchInput.value = "";
    _saveSettingsDebounced();
    renderFsAll(root, settings);
  });
  // 6) 이벤트 델리게이션 (play, copy, tag pick 등)
  root.addEventListener("click", (e) => {
    // 0) ▼ 버튼 클릭 → 바텀시트 열기
    const addMenuBtn = e.target.closest(".abgm-fs-addmenu-btn");
    if (addMenuBtn) {
      e.stopPropagation();
      const itemId = addMenuBtn.dataset.id;
      const itemTitle = addMenuBtn.dataset.title || "Untitled";
      const itemSrc = addMenuBtn.dataset.src || "";
      const list = getFsActiveList(settings);
      const fullItem = list.find(it => it.id === itemId);
      const itemTags = fullItem?.tags || [];
      openAddToBottomSheet(root, settings, { id: itemId, title: itemTitle, src: itemSrc, tags: itemTags });
      return;
    }
    // tag pick toggle
    const pick = e.target.closest(".abgm-fs-tagpick");
    if (pick && pick.dataset.tag) {
      const t = abgmNormTag(pick.dataset.tag);
      const { inc, exc } = fsGetTagSets(settings);
      if (inc.has(t)) {
        inc.delete(t);
        exc.add(t);
      } else if (exc.has(t)) {
        exc.delete(t);
      } else {
        inc.add(t);
        exc.delete(t);
      }
      fsSaveTagSets(settings, inc, exc);
      _saveSettingsDebounced();
      renderFsList(root, settings);
      renderFsTagPicker(root, settings);
      return;
    }
    // > preview vol lock
    const prevLockBtn = e.target.closest("#abgm_fs_prevvol_lock");
    if (prevLockBtn) {
      fsSetPreviewLock(settings, !fsGetPreviewLock(settings));
      _saveSettingsDebounced();
      renderFsPreviewVol(root, settings);
      return;
    }
    // > play
    const playBtn = e.target.closest(".abgm-fs-play");
    if (playBtn) {
      const src = String(playBtn.dataset.src || "").trim();
      if (src) {
        const v = fsGetPreviewVol100(settings) / 100;
        try { playAsset(src, v); } catch {}
      }
      return;
    }
    // copy
    const copyBtn = e.target.closest(".abgm-fs-copy");
    if (copyBtn) {
      const src = String(copyBtn.dataset.src || "").trim();
      if (src) navigator.clipboard?.writeText?.(src).catch(() => {});
      return;
    }
    // > tag button in item
    const tagBtn = e.target.closest(".abgm-fs-tag");
    if (tagBtn && tagBtn.dataset.tag) {
      const t = abgmNormTag(tagBtn.dataset.tag);
      const { inc, exc } = fsGetTagSets(settings);
      inc.add(t);
      exc.delete(t);
      fsSaveTagSets(settings, inc, exc);
      _saveSettingsDebounced();
      renderFsList(root, settings);
      renderFsTagPicker(root, settings);
      return;
    }
  });
  // 7) picker 바깥 클릭시 닫기
  root.addEventListener("mousedown", (e) => {
    const picker = root.querySelector("#abgm_fs_tag_picker");
    if (!picker) return;
    const inPicker = e.target.closest("#abgm_fs_tag_picker");
    const inCat = e.target.closest(".abgm-fs-catbar");
    if (!inPicker && !inCat) picker.style.display = "none";
  }, true);
  // > 초기 렌더
  renderFsAll(root, settings);
}



/** ========================= 프리소스 데이터(번들 JSON) 동기화 ========================= */
// 앱 시작 시 1회: 번들 freesources.json을 settings.freeSources로 채워넣는 애
export async function bootFreeSourcesSync() {
  const settings = _ensureSettings();
  await syncBundledFreeSourcesIntoSettings(settings, { force: false, save: true });
}

// 필요 시 강제 새로고침 포함해서 번들→settings 동기화 돌리는 애
export async function syncFreeSourcesFromJson(opts = {}) {
  const settings = _ensureSettings();
  await syncBundledFreeSourcesIntoSettings(settings, opts);
}

// (내부) 번들→settings 동기화 호출 래퍼 (현재는 그냥 syncBundled... 호출)
async function mergeBundledFreeSourcesIntoSettings(settings) {
  await syncBundledFreeSourcesIntoSettings(settings, { force: false, save: true });
}

// ../data/freesources.json fetch해서 sources 배열로 반환하는 애
async function loadBundledFreeSources() {
  const url = new URL("../data/freesources.json", import.meta.url);
  url.searchParams.set("v", String(Date.now())); // > 개발 중 캐시 방지
  const res = await fetch(url);
  if (!res.ok) {
    console.warn("[MyaPl] freesources.json load failed:", res.status);
    return [];
  }
  const json = await res.json();
  // > 구조 유지: { sources: [...] }
  return Array.isArray(json?.sources) ? json.sources : [];
}

// 문자열 해시(FNV-1a 느낌) 만들어서 id 생성에 쓰는 애 (프리소스 ID 생성용)
function simpleHash(s) {
  const str = String(s || "");
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

// 프리소스 raw 한 건을 {id, src, title, durationSec, tags}로 정규화하는 애
function normalizeFreeSourceItem(raw) {
  const MYAOPLAY_FREE_LICENSE = `Music © MyaoPlay
These tracks are free to use and share for non-commercial purposes only, as long as proper credit is given.
Credit: "Music by MyaoPlay"`;
  const src = String(raw?.src ?? raw?.url ?? raw?.fileKey ?? "").trim();
  if (!src) return null;
  const title = String(raw?.title ?? raw?.name ?? "").trim() || nameFromSource(src);
  const durationSec = Number(raw?.durationSec ?? raw?.duration ?? 0) || 0;
  const tagsRaw = raw?.tags;
  const tags = Array.isArray(tagsRaw)
    ? tagsRaw.map(t => String(t || "").trim()).filter(Boolean)
    : String(tagsRaw || "")
        .split(/[,\n]+/)
        .map(t => t.trim())
        .filter(Boolean);
  const id = String(raw?.id || "").trim() || `fs_${simpleHash(src)}`;
  const license = String(raw?.license ?? MYAOPLAY_FREE_LICENSE);
  const lyrics = raw?.lyrics != null ? String(raw.lyrics) : "";
  const addedDate = raw?.addedDate != null ? String(raw.addedDate) : "";
  return { id, src, title, durationSec, tags, license, lyrics, addedDate };
}

// 번들 JSON을 “진실”로 보고 settings.freeSources를 src 기준 유니크로 덮어쓰는 애 (중복 src면 마지막 승)
export async function syncBundledFreeSourcesIntoSettings(settings, { force = false, save = true } = {}) {
  if (__abgmFreeSourcesLoaded && !force) return;
  const bundledRaw = await loadBundledFreeSources();
  const map = new Map(); // 1) key: src
  for (const r of bundledRaw) {
    const it = normalizeFreeSourceItem(r);
    if (!it) continue;
    map.set(it.src, it); // 2) 마지막이 승리
  }
  settings.freeSources = Array.from(map.values());
  __abgmFreeSourcesLoaded = true;
  if (save) {
    try { _saveSettingsDebounced?.(); } catch {}
  }
  // console.log("[MyaPl] freeSources synced:", settings.freeSources.length);
}

// 제작자 툴
function dropboxToRawMaybe(url){
  try{
    const u = new URL(url);
    if (u.hostname.includes("dropbox.com")){
      // dl=0/1 대신 raw=1로 강제
      u.searchParams.delete("dl");
      u.searchParams.set("raw","1");
      return u.toString();
    }
  }catch(_){}
  return url;
}

function guessIdTitleFromUrl(url){
  const input = String(url || "").trim();
  if (!input) return { id: "", title: "" };
  // 1) 파일명(확장자 제외) 뽑기
  let base = "";
  try {
    const u = new URL(input);
    base = (u.pathname.split("/").pop() || "");
  } catch (_) {
    base = input.split("?")[0].split("#")[0].split("/").pop() || "";
  }
  try { base = decodeURIComponent(base); } catch (_) {}
  // 2) 확장자 제거 (오디오 확장자 위주)
  base = base.replace(/\.(mp3|wav|ogg|m4a|flac|aac)$/i, "");
  base = base.trim();
  // 3) id / title 생성
  // - id: 파일명 기반, 공백은 '-'로
  // - title: '-' '_'를 공백으로
  const id = base.replace(/\s+/g, "-").trim();
  const title = base.replace(/[\-_]+/g, " ").replace(/\s+/g, " ").trim();
  return {
    id: id || base,
    title: title || id || base,
  };
}

function probeAudioDurationSec(url, timeoutMs = 12000){
  return new Promise((resolve)=>{
    let done = false;
    const a = document.createElement("audio");
    a.preload = "metadata";
    a.src = url;
    const finish = (v)=>{
      if (done) return;
      done = true;
      try{
        a.removeAttribute("src");
        a.load();
      }catch(_){}
      resolve(v);
    };
    const t = setTimeout(()=>finish(null), timeoutMs);
    a.addEventListener("loadedmetadata", ()=>{
      clearTimeout(t);
      const d = a.duration;
      if (Number.isFinite(d) && d > 0) finish(Math.round(d));
      else finish(null);
    });
    a.addEventListener("error", ()=>{
      clearTimeout(t);
      finish(null);
    });
  });
}



/** ========================= 프리소스 JSON 생성 모달 ========================= */
function openJsonGeneratorModal() {
  // 기존 모달 있으면 제거
  const existing = document.querySelector("#abgm_json_gen_overlay");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = "abgm_json_gen_overlay";
  overlay.className = "abgm-json-gen-overlay";
  overlay.innerHTML = `
    <div class="abgm-json-gen-modal">
      <div class="abgm-json-gen-header">
        <h3>📝 프리소스 JSON 생성</h3>
        <button type="button" class="menu_button abgm-json-gen-close" title="닫기">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
      
      <div class="abgm-json-gen-body">
        <!-- URL 입력 -->
        <div class="abgm-json-gen-field">
          <label>🔗 URL (Dropbox 등)</label>
          <div class="abgm-json-gen-url-row">
            <input type="text" id="abgm_jgen_url" placeholder="https://dropbox.com/..." />
            <button type="button" class="menu_button" id="abgm_jgen_fetch" title="URL 분석">
              <i class="fa-solid fa-magnifying-glass"></i>
            </button>
          </div>
          <small class="abgm-json-gen-hint">Dropbox URL은 자동으로 raw=1 변환됨</small>
        </div>
        
        <!-- ID / Title -->
        <div class="abgm-json-gen-row">
          <div class="abgm-json-gen-field" style="flex:1;">
            <label>🆔 ID</label>
            <input type="text" id="abgm_jgen_id" placeholder="파일명 기반 자동생성" />
          </div>
          <div class="abgm-json-gen-field" style="flex:2;">
            <label>📌 Title</label>
            <input type="text" id="abgm_jgen_title" placeholder="제목" />
          </div>
        </div>
        
        <!-- Duration / Date -->
        <div class="abgm-json-gen-row">
          <div class="abgm-json-gen-field">
            <label>⏱️ Duration (초)</label>
            <div class="abgm-json-gen-dur-row">
              <input type="number" id="abgm_jgen_dur" min="0" value="0" />
              <span id="abgm_jgen_dur_fmt" class="abgm-json-gen-durfmt">0:00</span>
            </div>
          </div>
          <div class="abgm-json-gen-field">
            <label>📅 추가 날짜</label>
            <input type="date" id="abgm_jgen_date" />
          </div>
        </div>
        
        <!-- Tags -->
        <div class="abgm-json-gen-field">
          <label>🏷️ Tags (쉼표 또는 줄바꿈으로 구분)</label>
          <textarea id="abgm_jgen_tags" rows="2" placeholder="Sample, no lyric, ambient, dark"></textarea>
        </div>
        
        <!-- Lyrics -->
        <div class="abgm-json-gen-field">
          <label>🎤 가사 (줄바꿈 → \\n 자동 변환)</label>
          <textarea id="abgm_jgen_lyrics" rows="4" placeholder="가사를 줄바꿈해서 입력하면&#10;자동으로 \\n 처리됩니다"></textarea>
        </div>
        
        <!-- 결과 미리보기 -->
        <div class="abgm-json-gen-field">
          <label>📋 결과 JSON 스니펫</label>
          <textarea id="abgm_jgen_result" rows="10" readonly></textarea>
        </div>
      </div>
      
      <div class="abgm-json-gen-footer">
        <button type="button" class="menu_button" id="abgm_jgen_copy">
          <i class="fa-solid fa-copy"></i> 복사
        </button>
        <button type="button" class="menu_button" id="abgm_jgen_close2">닫기</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // 요소 참조
  const urlInput = overlay.querySelector("#abgm_jgen_url");
  const fetchBtn = overlay.querySelector("#abgm_jgen_fetch");
  const idInput = overlay.querySelector("#abgm_jgen_id");
  const titleInput = overlay.querySelector("#abgm_jgen_title");
  const durInput = overlay.querySelector("#abgm_jgen_dur");
  const durFmt = overlay.querySelector("#abgm_jgen_dur_fmt");
  const dateInput = overlay.querySelector("#abgm_jgen_date");
  const tagsInput = overlay.querySelector("#abgm_jgen_tags");
  const lyricsInput = overlay.querySelector("#abgm_jgen_lyrics");
  const resultArea = overlay.querySelector("#abgm_jgen_result");
  const copyBtn = overlay.querySelector("#abgm_jgen_copy");
  const closeBtn = overlay.querySelector(".abgm-json-gen-close");
  const closeBtn2 = overlay.querySelector("#abgm_jgen_close2");

  // 오늘 날짜 기본값
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  dateInput.value = `${yyyy}-${mm}-${dd}`;

  // duration 포맷 업데이트
  function updateDurFmt() {
    const sec = Number(durInput.value) || 0;
    const m = Math.floor(sec / 60);
    const s = String(sec % 60).padStart(2, "0");
    durFmt.textContent = `${m}:${s}`;
  }

  // JSON 스니펫 생성
  function generateSnippet() {
    const src = dropboxToRawMaybe(String(urlInput.value || "").trim());
    const id = String(idInput.value || "").trim() || `fs_${simpleHash(src)}`;
    const title = String(titleInput.value || "").trim() || "New Source";
    const durationSec = Number(durInput.value) || 0;
    const addedDate = String(dateInput.value || "").trim();
    
    // 태그 파싱
    const tagsRaw = String(tagsInput.value || "");
    const tags = tagsRaw
      .split(/[,\n]+/g)
      .map(s => s.trim())
      .filter(Boolean);
    
    // 가사: 줄바꿈 → \n
    const lyricsRaw = String(lyricsInput.value || "");
    const lyrics = lyricsRaw.trim();
    
    // JSON 조립
    const tagsInline = `[${tags.map(t => JSON.stringify(t)).join(", ")}]`;
    
    const lines = [
      "{",
      `  "id": ${JSON.stringify(id)},`,
      `  "title": ${JSON.stringify(title)},`,
      `  "src": ${JSON.stringify(src)},`,
      `  "durationSec": ${durationSec},`,
      `  "addedDate": ${JSON.stringify(addedDate)},`,
      `  "tags": ${tagsInline}`
    ];
    
    // 가사가 있으면 추가 (줄바꿈은 JSON.stringify가 알아서 \n으로 변환)
    if (lyrics) {
      // 마지막 줄에 쉼표 추가
      lines[lines.length - 1] += ",";
      lines.push(`  "lyrics": ${JSON.stringify(lyrics)}`);
    }
    
    lines.push("},");
    
    resultArea.value = lines.join("\n");
  }

  // URL 분석 (id/title 추측 + duration 측정)
  async function analyzeUrl() {
    const url = String(urlInput.value || "").trim();
    if (!url) return;
    
    const src = dropboxToRawMaybe(url);
    const guess = guessIdTitleFromUrl(src);
    
    if (!idInput.value.trim()) idInput.value = guess.id;
    if (!titleInput.value.trim()) titleInput.value = guess.title;
    
    // duration 측정 시도
    fetchBtn.disabled = true;
    fetchBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    
    const dur = await probeAudioDurationSec(src);
    if (Number.isFinite(dur) && dur > 0) {
      durInput.value = dur;
      updateDurFmt();
    }
    
    fetchBtn.disabled = false;
    fetchBtn.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i>';
    
    generateSnippet();
  }

  // 이벤트 바인딩
  fetchBtn.addEventListener("click", analyzeUrl);
  
  // URL 엔터키로도 분석
  urlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      analyzeUrl();
    }
  });

  // 입력 변경시 스니펫 재생성
  [idInput, titleInput, durInput, dateInput, tagsInput, lyricsInput].forEach(el => {
    el.addEventListener("input", generateSnippet);
  });
  
  durInput.addEventListener("input", () => {
    updateDurFmt();
    generateSnippet();
  });

  // 복사 버튼
  copyBtn.addEventListener("click", async () => {
    const text = resultArea.value;
    if (!text.trim()) return;
    
    try {
      await navigator.clipboard.writeText(text);
      copyBtn.innerHTML = '<i class="fa-solid fa-check"></i> 복사됨!';
      setTimeout(() => {
        copyBtn.innerHTML = '<i class="fa-solid fa-copy"></i> 복사';
      }, 1500);
    } catch (e) {
      // 클립보드 실패시 선택
      resultArea.select();
      alert("Ctrl+C로 복사해줘!");
    }
  });

  // 닫기
  function closeModal() {
    overlay.remove();
  }
  
  closeBtn.addEventListener("click", closeModal);
  closeBtn2.addEventListener("click", closeModal);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal();
  });
  
  // ESC 키
  const escHandler = (e) => {
    if (e.key === "Escape") {
      closeModal();
      document.removeEventListener("keydown", escHandler);
    }
  };
  document.addEventListener("keydown", escHandler);
  
  // 초기 스니펫 생성
  generateSnippet();
}

// 기존 함수를 모달 버전으로 대체
async function emitFreeSourceJsonSnippet() {
  openJsonGeneratorModal();
}



/** ========================= 표시용 유틸(포맷/태그) ========================= */
const FS_OVERLAY_ID = "abgm_fs_overlay";

// duration seconds → "m:ss" 문자열로 바꿔주는 애
function abgmFmtDur(sec) {
  const n = Math.max(0, Number(sec || 0));
  const m = Math.floor(n / 60);
  const s = Math.floor(n % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// bpm 숫자 → tempo:andante 같은 템포 태그로 바꿔주는 애
function bpmToTempoTag(bpm){
  const n = Number(bpm);
  if (!Number.isFinite(n)) return "";
  if (n < 60)  return "tempo:larghissimo";
  if (n < 66)  return "tempo:largo";
  if (n < 76)  return "tempo:adagio";
  if (n < 108) return "tempo:andante";
  if (n < 120) return "tempo:moderato";
  if (n < 156) return "tempo:allegro";
  if (n < 176) return "tempo:vivace";
  if (n < 200) return "tempo:presto";
  return "tempo:prestissimo";
}
