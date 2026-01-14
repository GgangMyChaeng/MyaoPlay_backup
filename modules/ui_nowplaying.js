import { ensureSettings } from "./settings.js";
import { saveSettingsDebounced } from "./deps.js";
import { openFloatingMenu } from "./ui_floating.js";
import { escapeHtml } from "./utils.js";



let _abgmNowPlayingBound = false;

// NP seek 상태
let _abgmNpIsSeeking = false;
let _abgmNpSeekRaf = 0;

const NP = {
  // state getters
  getBgmAudio: () => null,
  getEngineCurrentFileKey: () => "",
  getEngineCurrentPresetId: () => "",

  // engine/actions
  engineTick: () => {},
  togglePlayPause: () => {},

  // modal host sizing (나중에 ui_modal.js로 갈 애들)
  getModalHost: () => document.body,
  fitModalToHost: () => {},

  // UI hooks
  updateMenuNPAnimation: () => {},
  updateModalNowPlayingSimple: () => {},

  // helpers (index.js에 이미 있는 함수들 그대로 연결)
  getActivePreset: () => ({}),
  getEntryName: (b) => String(b?.name ?? b?.fileKey ?? ""),
  getSortedBgms: (preset, sortKey) => (preset?.bgms ?? []),
  getSortedKeys: () => [],
  getBgmSort: () => "manual",
  abgmCycleBgmSort: () => "manual",
  abgmSortNice: (k) => String(k ?? "manual"),
  ensurePlayFile: () => {},

  getDebugMode: () => false,
  getDebugLine: () => "",

  getSTContextSafe: () => null,
  getChatKeyFromContext: () => "",
  ensureEngineFields: () => {},

  // nav actions (index.js 쪽 로직 호출)
  npPrevAction: () => {},
  npNextAction: () => {},

  // image helper
  idbGetImage: async () => null,
};

const NP_GLASS_OVERLAY_ID = "ABGM_NP_GLASS_OVERLAY";

// NP Glass: control icons (image = direct link)
const ABGM_NP_CTRL_ICON = {
  prev:         "https://i.postimg.cc/1XTpkT5K/Previous.png",
  next:         "https://i.postimg.cc/4ND6wrSP/Next.png",
  useDefaultOn: "https://i.postimg.cc/PrkPPTpg/Default_On.png",
  useDefaultOff:"https://i.postimg.cc/VLy3x3qC/Stop.png",
  kwHold:       "https://i.postimg.cc/jdQkGCqp/Loop_List.png",
  kwOnce:       "https://i.postimg.cc/SR9HXrhj/Play.png",
};

// NP Glass: play mode icons (image = direct link)
const ABGM_NP_MODE_ICON = {
  manual:   "https://i.postimg.cc/SR9HXrhj/Play.png",
  loop_one: "https://i.postimg.cc/L4PW3NcK/Loop_One.png",
  loop_list:"https://i.postimg.cc/jdQkGCqp/Loop_List.png",
  random:   "https://i.postimg.cc/L8xQ87PM/Random.png",
  keyword:  "https://i.postimg.cc/8CsKJHdc/Keyword.png",
};



/** ========================= Deps 주입(외부에서 연결) ========================= */
// NP(의존성 묶음)에 필요한 함수들을 밖에서 꽂아주는 애
export function abgmBindNowPlayingDeps(partial = {}) {
  Object.assign(NP, partial || {});
}



/** ========================= 공용 유틸(문자/DOM) ========================= */
// 초 → "m:ss" / "h:mm:ss" 로 바꿔주는 포맷터
function abgmFmtTime(sec) {
  const n = Math.max(0, Number(sec || 0));
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const s = Math.floor(n % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// NP Glass overlay DOM을 id로 찾아오는 헬퍼
function abgmGetNpOverlay() {
  return document.getElementById(NP_GLASS_OVERLAY_ID);
}

// id로 엘리먼트 찾아서 textContent 세팅(없으면 조용히 패스)
function _abgmSetText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = String(text ?? "");
}



/** ========================= 메인 NowPlaying UI 갱신(사이드메뉴/모달/유리창 동시) ========================= */
// 현재 재생곡/프리셋/모드/버튼 아이콘/툴팁 등 “지금 상태” 전부 갱신하는 핵심
export function updateNowPlayingUI() {
  try {
    const fk = String(NP.getEngineCurrentFileKey() || "");
    const settings = ensureSettings?.() || {};
    const pid = String(NP.getEngineCurrentPresetId() || settings?.activePresetId || "");
    const preset =
      (pid && settings?.presets?.[pid]) ||
      settings?.presets?.[settings?.activePresetId] ||
      Object.values(settings?.presets || {})[0] ||
      {};
    const bgm = (preset.bgms ?? []).find((b) => String(b?.fileKey ?? "") === fk) || null;
    // NP Art 뷰가 열려있으면 갱신
    const npArt = document.getElementById("abgm_np_art");
    if (npArt) {
      const curView = npArt.dataset.view || "image";
      const prevFk = npArt.dataset.prevFk || "";
      
      // 곡이 바뀌면 image로 리셋, 아니면 현재 view 유지
      if (prevFk !== fk) {
        npArt.dataset.view = "image";
        renderNpArtView(bgm, "image");
      } else {
        // 같은 곡이어도 항상 렌더링 (image 포함)
        renderNpArtView(bgm, curView);
      }
      npArt.dataset.prevFk = fk;
    }
    const title = bgm ? NP.getEntryName(bgm) : (fk || "(none)");
    const presetName = preset?.name || "Preset";
    const modeLabel = settings?.keywordMode ? "Keyword" : (settings?.playMode || "manual");
    const meta = `${modeLabel} · ${presetName}`;
    const debugLine = (NP.getDebugMode?.() && NP.getDebugLine?.()) ? String(NP.getDebugLine()) : "";
    // ===== modal license area =====
    const licWrap = document.getElementById("abgm_np_license_wrap");
    const licText = document.getElementById("abgm_np_license_text");
    if (licWrap && licText) {
      const lic = bgm ? String(bgm.license ?? "").trim() : "";
      if (lic) { licWrap.style.display = ""; licText.textContent = lic; }
      else { licWrap.style.display = "none"; licText.textContent = ""; }
    }
    // 1) drawer(확장메뉴)
    _abgmSetText("autobgm_now_title", title);
    _abgmSetText("autobgm_now_meta", meta);
    updateNowPlayingGlassUI(title, presetName, modeLabel);
    updateNowPlayingGlassNavUI(settings, preset);
    try { updateNowPlayingGlassPlaylistUI(settings); } catch {}
    const dbg = document.getElementById("autobgm_now_debug");
    if (dbg) {
      dbg.style.display = debugLine ? "" : "none";
      dbg.textContent = debugLine;
    }
    // 2) 모달(simple)
    NP.updateModalNowPlayingSimple(title);
    // 3) 버튼들 처리
    const btnDef = document.getElementById("autobgm_now_btn_default");
    const btnPlay = document.getElementById("autobgm_now_btn_play");
    const btnMode = document.getElementById("autobgm_now_btn_mode");
    if (btnDef) {
      const leftWrap = btnDef.closest(".np-left");
      if (leftWrap) leftWrap.classList.toggle("is-hidden", !settings?.keywordMode);
      btnDef.textContent = settings?.useDefault ? "⭐" : "☆";
      btnDef.title = settings?.useDefault ? "Use Default: ON" : "Use Default: OFF";
    }
    if (btnPlay) {
    const stopped = !settings.enabled || !fk;
    const icon = stopped ? "⏹️" : (NP.getBgmAudio()?.paused ? "▶️" : "⏸️");
    btnPlay.textContent = icon;
    btnPlay.title =
      icon === "▶️" ? "Play" :
      icon === "⏸️" ? "Pause" :
      "Start";
        }
    // ===== NP Glass 아이콘 동기화 NP 아이콘 =====
    const glassIcon = document.querySelector("#abgm_np_play img");
    if (glassIcon) {
      if (!settings.enabled || !fk) {
        glassIcon.src = "https://i.postimg.cc/VLy3x3qC/Stop.png";
      } else if (NP.getBgmAudio()?.paused) {
        glassIcon.src = "https://i.postimg.cc/SR9HXrhj/Play.png";
      } else {
        glassIcon.src = "https://i.postimg.cc/v8xJSQVQ/Pause.png";
      }
    }
    if (btnMode) {
      const modeIcon =
        settings?.keywordMode ? "💬" :
        (settings?.playMode === "loop_one" ? "🔂" :
         settings?.playMode === "loop_list" ? "🔁" :
         settings?.playMode === "random" ? "🔀" : "▶️");
      btnMode.textContent = modeIcon;
      btnMode.title =
        settings?.keywordMode ? "Mode: Keyword" :
        `Mode: ${settings?.playMode || "manual"}`;
    }
    setNowControlsLocked(!settings.enabled);
    NP.updateMenuNPAnimation();
  } catch (e) {
    console.error("[MyaPl] updateNowPlayingUI failed:", e);
  }
} // updateNowPlayingUI 닫기

// 확장 OFF일 때 NowPlaying 버튼들 클릭 막고(포인터/opacity/aria) 잠그는 애
function setNowControlsLocked(locked) {
  const root = document.getElementById("autobgm-root");
  if (!root) return;
  const btnPlay = root.querySelector("#autobgm_now_btn_play");
  const btnDef  = root.querySelector("#autobgm_now_btn_default");
  const btnMode = root.querySelector("#autobgm_now_btn_mode");
  const lockBtn = (el, on) => {
    if (!el) return;
    el.classList.toggle("abgm-disabled", !!on);
    el.style.pointerEvents = on ? "none" : "";
    el.style.opacity = on ? "0.35" : "";
    el.setAttribute("aria-disabled", on ? "true" : "false");
    el.title = on ? "Disabled (Extension Off)" : "";
  };
  lockBtn(btnPlay, locked);
  lockBtn(btnDef, locked);
  lockBtn(btnMode, locked);
}



/** ========================= 오디오 이벤트 바인딩(1회) ========================= */
// audio play/pause/ended/error + timeupdate 등 이벤트 묶어서 UI 갱신 트리거
export function bindNowPlayingEventsOnce() {
  if (_abgmNowPlayingBound) return;
  _abgmNowPlayingBound = true;
  try {
   NP.getBgmAudio().addEventListener("play", updateNowPlayingUI);
   NP.getBgmAudio().addEventListener("pause", updateNowPlayingUI);
   NP.getBgmAudio().addEventListener("ended", updateNowPlayingUI);
   NP.getBgmAudio().addEventListener("error", updateNowPlayingUI);
    // > seek UI는 updateNowPlayingUI에 묶으면 너무 무거워서 분리
    const kickSeek = () => scheduleNpSeekUpdate();
   NP.getBgmAudio().addEventListener("timeupdate", kickSeek);
   NP.getBgmAudio().addEventListener("loadedmetadata", kickSeek);
   NP.getBgmAudio().addEventListener("durationchange", kickSeek);
   NP.getBgmAudio().addEventListener("seeking", kickSeek);
   NP.getBgmAudio().addEventListener("seeked", kickSeek);
  } catch {}
}

// seek UI 갱신을 RAF로 묶어서(중복 호출 방지) 가볍게 업데이트
function scheduleNpSeekUpdate() {
  if (_abgmNpSeekRaf) return;
  _abgmNpSeekRaf = requestAnimationFrame(() => {
    _abgmNpSeekRaf = 0;
    updateNowPlayingGlassSeekUI();
  });
}



/** ========================= NP Glass(유리창) 열고/닫고/페이지 전환 ========================= */
// NP 유리창(overlay+modal) 생성/붙이기 + 버튼 이벤트 연결 + 초기 렌더/피팅
export function openNowPlayingGlass() {
  if (document.getElementById(NP_GLASS_OVERLAY_ID)) return;
  const overlay = document.createElement("div");
  overlay.id = NP_GLASS_OVERLAY_ID;
  overlay.className = "autobgm-overlay"; // > 기존 overlay CSS 재활용
  overlay.dataset.abgmPage = "np";
overlay.innerHTML = `
    <div class="autobgm-modal abgm-np-glass">
      <div class="abgm-np-glass-inner">
        <!-- ===== Page: NP (Home) ===== -->
        <div data-abgm-page="np">
          <!-- 상단 그룹: art -->
          <div class="abgm-np-top-group">
            <div class="abgm-np-art" id="abgm_np_art" data-view="image" style="cursor:pointer;"></div>
          </div>
          <!-- 하단 그룹: title + preset + seek + ctrl + bottom -->
          <div class="abgm-np-bottom-group">
            <div class="abgm-np-title" id="abgm_np_title">(none)</div>
            <div class="abgm-np-sub" id="abgm_np_preset">Preset</div>
            <div class="abgm-np-seek-wrap">
              <input id="abgm_np_seek" class="abgm-np-seek" type="range" min="0" max="0" value="0" />
              <div class="abgm-np-time">
                <span id="abgm_np_time_cur">0:00</span>
                <span id="abgm_np_time_dur">0:00</span>
              </div>
            </div>
            <div class="abgm-np-ctrl">
              <button class="abgm-np-btn" type="button" id="abgm_np_prev" title="Prev" disabled>
                <img id="abgm_np_prev_icon" src="${ABGM_NP_CTRL_ICON.prev}" class="abgm-np-icon" alt="prev"/>
              </button>
              <button class="abgm-np-btn abgm-np-btn-main" type="button" id="abgm_np_play" title="Play/Pause">
                <img src="https://i.postimg.cc/SR9HXrhj/Play.png" class="abgm-np-icon" alt="play"/>
              </button>
              <button class="abgm-np-btn" type="button" id="abgm_np_next" title="Next" disabled>
                <img id="abgm_np_next_icon" src="${ABGM_NP_CTRL_ICON.next}" class="abgm-np-icon" alt="next"/>
              </button>
            </div>
            <div class="abgm-np-bottom">
              <button class="abgm-np-pill" type="button" id="abgm_np_list" title="Playlist">
                <i class="fa-solid fa-list"></i>
              </button>
              <button class="abgm-np-pill" type="button" id="abgm_np_mode" title="Mode">
                <img id="abgm_np_mode_icon" src="${ABGM_NP_MODE_ICON.manual}" class="abgm-np-icon abgm-np-icon-sm" alt="mode" />
                <span id="abgm_np_mode_text" class="abgm-np-sr">Manual</span>
              </button>
              <button class="abgm-np-pill abgm-np-back" type="button" id="abgm_np_back" title="Back">
                <i class="fa-solid fa-arrow-left"></i>
              </button>
            </div>
          </div>
        </div>
        <!-- ===== Page: Playlist ===== -->
        <div data-abgm-page="pl" style="display:none; height:100%;">
          <div class="abgm-pl-card">
            <div class="abgm-pl-header">
              <button type="button" class="menu_button abgm-pl-topbtn" id="abgm_pl_to_np" title="Back to NP">←</button>
              <div class="abgm-pl-title">Playlist</div>
              <button type="button" class="menu_button abgm-pl-topbtn" id="abgm_pl_sort" title="Sort">⋯</button>
            </div>
            <div class="abgm-pl-presetbar">
              <select id="abgm_pl_preset" class="abgm-pl-select"></select>
            </div>
            <div id="abgm_pl_list" class="abgm-pl-list"></div>
            <div class="abgm-pl-footer">
              <button type="button" class="menu_button abgm-pl-home" id="abgm_pl_home" title="Back to Floating Menu">
                <i class="fa-solid fa-arrow-left"></i>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
  // > 바깥 클릭 닫기
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeNowPlayingGlass();
  });
    const host = NP.getModalHost();
    // [FIX] body가 아닐 때만 relative 강제
    if (host !== document.body && getComputedStyle(host).position === "static") 
      host.style.position = "relative";
    // 1) overlay 스타일 - 중앙정렬용 flex (CSS와 일치)
    const setO = (k, v) => overlay.style.setProperty(k, v, "important");
    setO("position", "absolute");
    setO("inset", "0");
    setO("display", "flex");
    setO("align-items", "center");
    setO("justify-content", "center");
    setO("overflow", "hidden");
    setO("background", "rgba(0,0,0,.55)");
    setO("z-index", "2147483647");
    setO("padding", "12px");
    host.appendChild(overlay);
    // 2) 플리 UI는 페이지 전환 전에 미리 한번 렌더해두기(프리셋 옵션/리스트 초기화)
    try { abgmRenderPlaylistPage(overlay); } catch {}
    // ===== NP(Home) events =====
    const playBtn = overlay.querySelector("#abgm_np_play");
  // ===== NP Art 클릭: image -> lyrics -> license -> image 순환 =====
  const npArt = overlay.querySelector("#abgm_np_art");
  npArt?.addEventListener("click", (e) => {
    e.stopPropagation?.();
    cycleNpArtView();
  });
    playBtn?.addEventListener("click", () => {
      NP.togglePlayPause();
    });
    overlay.querySelector("#abgm_np_prev")?.addEventListener("click", (e) => {
    e.stopPropagation?.();
    try { NP.npPrevAction?.(); } catch {}
  });
  overlay.querySelector("#abgm_np_next")?.addEventListener("click", (e) => {
    e.stopPropagation?.();
    try { NP.npNextAction?.(); } catch {}
  });
  // 1) NP seek
  const seek = overlay.querySelector("#abgm_np_seek");
  if (seek) {
    const preview = () => {
      const a = NP.getBgmAudio();
      const curEl = document.getElementById("abgm_np_time_cur");
      const durEl = document.getElementById("abgm_np_time_dur");
      const v = Number(seek.value || 0) / 1000;
      const dur = Number(a?.duration);
      if (curEl) curEl.textContent = abgmFmtTime(v);
      if (durEl) durEl.textContent = Number.isFinite(dur) && dur > 0 ? abgmFmtTime(dur) : "0:00";
    };
    seek.addEventListener("input", () => {
      _abgmNpIsSeeking = true;
      preview();
    });
    seek.addEventListener("change", () => {
      const a = NP.getBgmAudio();
      const v = Number(seek.value || 0) / 1000;
      if (Number.isFinite(v)) {
        try { a.currentTime = Math.max(0, v); } catch {}
      }
      _abgmNpIsSeeking = false;
      scheduleNpSeekUpdate();
    });
    const endSeek = () => {
      _abgmNpIsSeeking = false;
      scheduleNpSeekUpdate();
    };
    seek.addEventListener("pointerup", endSeek);
    seek.addEventListener("pointercancel", endSeek);
  }
  // 2) Mode cycle
  const modeBtn = overlay.querySelector("#abgm_np_mode");
  modeBtn?.addEventListener("click", () => {
    const s = ensureSettings();
    if (!s.enabled) return;
    const next = (() => {
      if (s.keywordMode) return "manual";
      const cur = s.playMode || "manual";
      if (cur === "manual") return "loop_one";
      if (cur === "loop_one") return "loop_list";
      if (cur === "loop_list") return "random";
      if (cur === "random") return "keyword";
      return "manual";
    })();
    if (next === "keyword") {
      s.keywordMode = true;
    } else {
      s.keywordMode = false;
      s.playMode = next;
    }
    saveSettingsDebounced();
    try { NP.engineTick(); } catch {}
    updateNowPlayingUI();
  });
  // 3) 뒤로가기(플로팅 메뉴 홈)
  overlay.querySelector("#abgm_np_back")?.addEventListener("click", () => {
    closeNowPlayingGlass();
    openFloatingMenu();
  });
  // ===== Playlist page events =====
  overlay.querySelector("#abgm_np_list")?.addEventListener("click", (e) => {
    e?.stopPropagation?.();
    abgmNpShowPage("pl");
  });
  overlay.querySelector("#abgm_pl_to_np")?.addEventListener("click", (e) => {
    e?.stopPropagation?.();
    abgmNpShowPage("np");
  });
  overlay.querySelector("#abgm_pl_home")?.addEventListener("click", (e) => {
    e?.stopPropagation?.();
    closeNowPlayingGlass();
    openFloatingMenu();
  });
  // 1) (NP Glass는 CSS aspect-ratio로 자체 사이징 (fitModalToHost 호출 X))
  window.addEventListener("keydown", onNpGlassEsc);
  // 2) 초기 업데이트
  bindNowPlayingEventsOnce();
  updateNowPlayingUI();
} // openNowPlayingGlass 닫기

// NP 유리창 제거 + ESC 리스너 해제
export function closeNowPlayingGlass() {
  const overlay = document.getElementById(NP_GLASS_OVERLAY_ID);
  if (overlay) overlay.remove();
  window.removeEventListener("keydown", onNpGlassEsc);
}

// ESC 누르면 유리창 닫기
function onNpGlassEsc(e) {
  if (e.key === "Escape") closeNowPlayingGlass();
}

// NP Art 영역 뷰 순환 (image -> lyrics -> license -> image)
function cycleNpArtView() {
  const art = document.getElementById("abgm_np_art");
  if (!art) return;
  const settings = ensureSettings?.() || {};
  const fk = String(NP.getEngineCurrentFileKey() || "");
  const pid = String(NP.getEngineCurrentPresetId() || settings?.activePresetId || "");
  const preset = settings?.presets?.[pid] || Object.values(settings?.presets || {})[0] || {};
  const bgm = (preset.bgms ?? []).find((b) => String(b?.fileKey ?? "") === fk) || null;
  const hasLicense = !!String(bgm?.license ?? "").trim();
  const hasLyrics = !!String(bgm?.lyrics ?? "").trim();
  const hasImage = !!(bgm?.imageAssetKey || String(bgm?.imageUrl ?? "").trim());
  
  if (!hasLicense && !hasLyrics && !hasImage) return;
  if (!hasLicense && !hasLyrics) return;
  
  const cur = art.dataset.view || "image";
  let next = "image";
  
  if (hasLicense && hasLyrics) {
    if (cur === "image") next = "lyrics";
    else if (cur === "lyrics") next = "license";
    else next = "image";
  } else if (hasLyrics) {
    next = (cur === "image") ? "lyrics" : "image";
  } else if (hasLicense) {
    next = (cur === "image") ? "license" : "image";
  }
  art.dataset.view = next;
  renderNpArtView(bgm, next);
}

// NP Art 영역 렌더링 (image/lyrics/license)
async function renderNpArtView(bgm, view) {
  const art = document.getElementById("abgm_np_art");
  if (!art) return;
  
  // view에 따라 클래스 토글 (image=동그라미, lyrics/license=사각형)
  art.classList.toggle("is-text-view", view === "lyrics" || view === "license");
  
  if (view === "image") {
    const hasAssetKey = !!bgm?.imageAssetKey;
    const hasUrl = !!String(bgm?.imageUrl ?? "").trim();
    
    const key = String(bgm?.imageAssetKey || bgm?.id || "").trim();

    if (key) {
      art.innerHTML = `<div style="opacity:.5; font-size:11px;">Loading...</div>`;
      art.style.cssText = "cursor:pointer; display:flex; align-items:center; justify-content:center;";
      try {
        const blob = await NP.idbGetImage(key);
        if (blob) {
          const url = URL.createObjectURL(blob);
          art.innerHTML = `<img src="${url}" style="width:100%; height:100%; object-fit:cover; border-radius:inherit;" />`;
        } else if (hasUrl) {
          const imgUrl = escapeHtml(String(bgm.imageUrl).trim());
          art.innerHTML = `<img src="${imgUrl}" style="width:100%; height:100%; object-fit:cover; border-radius:inherit;" onerror="this.style.display='none'" />`;
        } else {
          art.innerHTML = "";
        }
      } catch (e) {
        console.warn("[MyaPl] NP image load failed:", e);
        art.innerHTML = "";
      }
    } else if (hasUrl) {
      const imgUrl = escapeHtml(String(bgm.imageUrl).trim());
      art.innerHTML = `<img src="${imgUrl}" style="width:100%; height:100%; object-fit:cover; border-radius:inherit;" onerror="this.style.display='none'" />`;
      art.style.cssText = "cursor:pointer; display:flex; align-items:center; justify-content:center;";
    } else {
      art.innerHTML = "";
      art.style.cssText = "cursor:pointer;";
    }
  } else if (view === "lyrics") {
    const lyrics = String(bgm?.lyrics ?? "").trim();
    art.style.cssText = "cursor:pointer;";
    art.innerHTML = `
      <div class="abgm-np-art-text">
        <div class="abgm-np-art-label">🎵 Lyrics</div>
        <div class="abgm-np-art-content">${escapeHtml(lyrics)}</div>
      </div>
    `;
  } else if (view === "license") {
    const license = String(bgm?.license ?? "").trim();
    art.style.cssText = "cursor:pointer;";
    art.innerHTML = `
      <div class="abgm-np-art-text">
        <div class="abgm-np-art-label">📄 License</div>
        <div class="abgm-np-art-content">${escapeHtml(license)}</div>
      </div>
    `;
  }
}

// 유리창 내부 페이지 전환(np <-> pl) + pl이면 플리 렌더 호출
function abgmNpShowPage(page /* 'np' | 'pl' */) {
  const overlay = abgmGetNpOverlay();
  if (!overlay) return;
  const np = overlay.querySelector('[data-abgm-page="np"]');
  const pl = overlay.querySelector('[data-abgm-page="pl"]');
  overlay.dataset.abgmPage = page;
  if (np) np.style.display = (page === "np") ? "" : "none";
  if (pl) pl.style.display = (page === "pl") ? "" : "none";
  if (page === "pl") {
    try { abgmRenderPlaylistPage(overlay); } catch {}
  }
}



/** ========================= NP Glass UI 조각 갱신(타이틀/모드/네비/시크/플리 하이라이트) ========================= */
// 유리창 상단 타이틀/프리셋명/모드 텍스트+아이콘 갱신 (+ seek 업데이트 예약)
function updateNowPlayingGlassUI(title, presetName, modeLabel) {
  const t = document.getElementById("abgm_np_title");
  const p = document.getElementById("abgm_np_preset");
  const m = document.getElementById("abgm_np_mode_text"); // (숨김) 상태값 보관용
  const icon = document.getElementById("abgm_np_mode_icon");
  const btn = document.getElementById("abgm_np_mode");
  if (t) t.textContent = String(title ?? "(none)");
  if (p) p.textContent = String(presetName ?? "Preset");
  const keyRaw = String(modeLabel ?? "manual");
  const key = keyRaw.toLowerCase() === "keyword" ? "keyword" : keyRaw;
  const nice =
    key === "keyword" ? "Keyword" :
    key === "loop_one" ? "Loop One" :
    key === "loop_list" ? "Loop List" :
    key === "random" ? "Random" : "Manual";
  if (m) m.textContent = nice;
  if (icon) icon.src = ABGM_NP_MODE_ICON[key] || ABGM_NP_MODE_ICON.manual;
  if (btn) btn.title = `Mode: ${nice}`;
  scheduleNpSeekUpdate();
}

// 유리창 seek bar + 현재/총 시간 표시 갱신(드래그 중엔 값 덮어쓰기 방지)
function updateNowPlayingGlassSeekUI() {
  const overlay = document.getElementById(NP_GLASS_OVERLAY_ID);
  if (!overlay) return;
  const seek = overlay.querySelector("#abgm_np_seek");
  const curEl = overlay.querySelector("#abgm_np_time_cur");
  const durEl = overlay.querySelector("#abgm_np_time_dur");
  if (!seek) return;
  const settings = ensureSettings?.() || {};
  const enabled = !!settings.enabled;
  const a = NP.getBgmAudio();
  const fk = String(NP.getEngineCurrentFileKey() || "");
  const dur = Number(a?.duration);
  const cur = Number(a?.currentTime);
  const ready = enabled && !!fk && Number.isFinite(dur) && dur > 0;
  seek.disabled = !ready;
  // range: ms 단위(더 부드럽게)
  const max = ready ? Math.max(1, Math.floor(dur * 1000)) : 0;
  if (String(seek.max) !== String(max)) seek.max = String(max);
  if (seek.min !== "0") seek.min = "0";
  // 드래그 중이면 값 덮어쓰기 금지
  if (!_abgmNpIsSeeking && ready) {
    const v = Math.min(max, Math.max(0, Math.floor((Number.isFinite(cur) ? cur : 0) * 1000)));
    seek.value = String(v);
  } else if (!ready) {
    seek.value = "0";
  }
  if (curEl) curEl.textContent = ready ? abgmFmtTime(Number.isFinite(cur) ? cur : 0) : "0:00";
  if (durEl) durEl.textContent = ready ? abgmFmtTime(dur) : "0:00";
}

// 유리창 prev/next 버튼 상태/아이콘 처리
// - keywordMode면 “prev/next” 대신 “Use Default / Keyword Once(또는 Hold)” 버튼처럼 동작
// - 일반 모드면 현재 리스트 인덱스/랜덤/루프에 맞춰 disabled 계산
function updateNowPlayingGlassNavUI(settings, preset) {
  const prevBtn = document.getElementById('abgm_np_prev');
  const nextBtn = document.getElementById('abgm_np_next');
  if (!prevBtn || !nextBtn) return;
  const prevIcon = document.getElementById('abgm_np_prev_icon');
  const nextIcon = document.getElementById('abgm_np_next_icon');
  // > Keyword mode: replace with (Use Default / Logic) buttons
  if (settings?.keywordMode) {
    if (prevIcon) prevIcon.src = settings.useDefault ? ABGM_NP_CTRL_ICON.useDefaultOn : ABGM_NP_CTRL_ICON.useDefaultOff;
    if (nextIcon) nextIcon.src = settings.keywordOnce ? ABGM_NP_CTRL_ICON.kwOnce : ABGM_NP_CTRL_ICON.kwHold;
    prevBtn.disabled = !settings.enabled;
    nextBtn.disabled = !settings.enabled;
    prevBtn.title = settings.useDefault ? 'Use Default: ON' : 'Use Default: OFF';
    nextBtn.title = settings.keywordOnce ? 'Keyword Logic: Once' : 'Keyword Logic: Hold';
    return;
  }
  if (prevIcon) prevIcon.src = ABGM_NP_CTRL_ICON.prev;
  if (nextIcon) nextIcon.src = ABGM_NP_CTRL_ICON.next;
  if (!settings?.enabled) {
    prevBtn.disabled = true;
    nextBtn.disabled = true;
    return;
  }
  const ctx = NP.getSTContextSafe();
  const chatKey = NP.getChatKeyFromContext(ctx);
  settings.chatStates ??= {};
  settings.chatStates[chatKey] ??= { currentKey: '', listIndex: 0, lastSig: '', defaultPlayedSig: '', prevKey: '' };
  NP.ensureEngineFields(settings);
  const st = settings.chatStates[chatKey];
  const sort = NP.getBgmSort(settings);
  const keys = NP.getSortedKeys(preset, sort);
  if (!keys.length) {
    prevBtn.disabled = true;
    nextBtn.disabled = true;
    return;
  }
  const mode = settings.playMode || 'manual';
  const cur = String(NP.getEngineCurrentFileKey() || st.currentKey || '');
  let idx = cur ? keys.indexOf(cur) : -1;
  if (idx < 0) idx = Math.max(0, Math.min(Number(st.listIndex || 0), keys.length - 1));
  let canPrev = false;
  let canNext = false;
  if (mode === 'loop_list') {
    canPrev = keys.length > 1;
    canNext = keys.length > 1;
  } else if (mode === 'random') {
    canNext = keys.length > 1;
    canPrev = !!st.prevKey;
  } else {
    if (!cur) {
      canPrev = keys.length > 0;
      canNext = keys.length > 0;
    } else {
      // [FIX] Manual/Loop One도 버튼으로는 순환 이동 허용 (끝->처음, 처음->끝)
      canPrev = keys.length > 1;
      canNext = keys.length > 1;
    }
  }
  prevBtn.disabled = !canPrev;
  nextBtn.disabled = !canNext;
  prevBtn.title = prevBtn.disabled ? 'Prev' : 'Prev';
  nextBtn.title = nextBtn.disabled ? 'Next' : 'Next';
}

// 유리창 플리 페이지에서 현재곡 하이라이트/재생중이면 ⏸ 아이콘 반영
function updateNowPlayingGlassPlaylistUI(settings) {
  const overlay = abgmGetNpOverlay();
  if (!overlay) return;
  if (String(overlay.dataset.abgmPage || "np") !== "pl") return;
  const a = NP.getBgmAudio();
  const fk = String(NP.getEngineCurrentFileKey() || "");
  const isPlaying = !!settings?.enabled && !!fk && !a?.paused;
  overlay.querySelectorAll(".abgm-pl-item")?.forEach?.((row) => {
    const key = String(row.dataset.filekey || "");
    const isCur = key && fk && key === fk;
    row.classList.toggle("is-current", isCur);
    const btn = row.querySelector(".abgm-pl-play");
    if (btn) btn.textContent = (isCur && isPlaying) ? "⏸" : "▶";
  });
}



/** ========================= Playlist Sort Menu (popover/bottom-sheet) ========================= */
// @@
const ABGM_PL_SORT_KEYS = [
  "name_asc",
  "name_desc",
  "added_asc",
  "added_desc",
  "priority_desc",
  "priority_asc",
];

function abgmPlCloseSortMenu(overlay) {
  const old = overlay?.querySelector("#abgm_pl_sortwrap");
  if (old) old.remove();
}

function abgmPlOpenSortMenu(overlay, settings) {
  const card = overlay?.querySelector(".abgm-pl-card");
  if (!card) return;
  // 이미 열려있으면 닫기(토글)
  const already = overlay?.querySelector("#abgm_pl_sortwrap");
  if (already) return abgmPlCloseSortMenu(overlay);
  settings.ui ??= {};
  const cur = String(NP.getBgmSort(settings) || "added_asc");
  const wrap = document.createElement("div");
  wrap.id = "abgm_pl_sortwrap";
  wrap.className = "abgm-pl-sortwrap";
  wrap.innerHTML = `
    <div class="abgm-pl-sortback"></div>
    <div class="abgm-pl-sortmenu" role="menu" aria-label="Sort">
      ${ABGM_PL_SORT_KEYS.map((k) => {
        const on = (k === cur);
        const label = NP.abgmSortNice(k);
        return `
          <button type="button"
            class="menu_button abgm-pl-sortopt ${on ? "is-active" : ""}"
            data-sort="${k}">
            ${on ? "✅ " : ""}${escapeHtml(label)}
          </button>
        `;
      }).join("")}
    </div>
  `;
  // 바깥(반투명 영역) 누르면 닫기
  wrap.querySelector(".abgm-pl-sortback")?.addEventListener("click", () => {
    abgmPlCloseSortMenu(overlay);
  });
  // 옵션 클릭
  wrap.querySelector(".abgm-pl-sortmenu")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-sort]");
    if (!btn) return;
    const next = String(btn.dataset.sort || "added_asc");
    settings.ui ??= {};
    settings.ui.playlistSort = next;
    saveSettingsDebounced();
    abgmPlCloseSortMenu(overlay);
    try { abgmRenderPlaylistPage(overlay); } catch {}
    try { updateNowPlayingUI(); } catch {}
  });
  card.appendChild(wrap);
}



/** ========================= Playlist 페이지 렌더/재생 액션 ========================= */
// 유리창 플리 페이지:
// - 프리셋 select 채우기
// - 정렬 버튼(sort cycle) 처리
// - 곡 리스트 DOM 생성(각 row에 Play 버튼)
function abgmRenderPlaylistPage(overlay, pidOverride) {
  const settings = ensureSettings();
  abgmPlCloseSortMenu(overlay);
  // > 플리 렌더는 "UI 선택/override"가 최우선 (엔진 pid는 최후 fallback)
  const sel = overlay?.querySelector("#abgm_pl_preset");
  const pid = String(
    pidOverride ||
    sel?.value ||
    settings?.activePresetId ||
    NP.getEngineCurrentPresetId?.() ||
    ""
  );
  let preset =
    (pid && settings?.presets?.[pid]) ||
    settings?.presets?.[settings?.activePresetId] ||
    Object.values(settings?.presets || {})[0] ||
    null;
  // > activePresetId가 실제로 없는 값이면 UI/렌더 일치시키기
  if (!settings?.presets?.[settings?.activePresetId] && preset?.id) {
    settings.activePresetId = String(preset.id);
  }
  // --- preset select ---
  if (sel && !sel.__abgmBound) {
    sel.__abgmBound = true;
    sel.addEventListener("change", (e) => {
      const pid = String(e?.target?.value || "");
      const settings = ensureSettings();
      // 1) 새 pid를 settings에 먼저 확정
      settings.activePresetId = pid;
      // 2) 저장
      try { saveSettingsDebounced?.(); } catch {}
      // 3) 렌더는 "명시적으로 pid" 넘겨서 (렌더쪽이 헷갈릴 여지 제거)
      try { abgmRenderPlaylistPage(overlay, pid); }
      catch (err) { console.error("[MyaPl] render playlist failed", err); }
      // 4) NP 상단도 동기화
      try { updateNowPlayingUI(); } catch {}
    });
  }
  if (sel) {
    sel.innerHTML = "";
    const presetsSorted = Object.values(settings.presets || {}).sort((a, b) =>
      String(a?.name ?? a?.id ?? "").localeCompare(
        String(b?.name ?? b?.id ?? ""),
        undefined,
        { numeric: true, sensitivity: "base" }
      )
    );
    for (const p of presetsSorted) {
      const opt = document.createElement("option");
      opt.value = String(p.id);
      opt.textContent = String(p.name || p.id);
      if (String(p.id) === String(settings.activePresetId)) opt.selected = true;
      sel.appendChild(opt);
    }
  }
  // --- sort button ---
  const sortBtn = overlay.querySelector("#abgm_pl_sort");
  if (sortBtn && !sortBtn.__abgmBound) {
    sortBtn.__abgmBound = true;
    sortBtn.addEventListener("click", (e) => {
      e?.stopPropagation?.();
      abgmPlOpenSortMenu(overlay, settings);
    });
  }
  if (sortBtn) sortBtn.title = `Sort: ${NP.abgmSortNice(NP.getBgmSort(settings))}`;
  // --- list render ---
  const list = overlay.querySelector("#abgm_pl_list");
  if (!list) return;

  if (!list.__abgmBound) {
    list.__abgmBound = true;
    list.addEventListener("click", (e) => {
      const play = e.target.closest(".abgm-pl-play");
      if (!play) return;
      const fk = String(play.dataset.filekey || "").trim();
      // > 지금 플리에서 선택된 프리셋 id
      const pid = String(
        overlay?.querySelector("#abgm_pl_preset")?.value ||
        ensureSettings()?.activePresetId ||
        ""
      );
      abgmPlayFromPlaylist(fk, pid);
    });
  }
  const bgms = NP.getSortedBgms(preset || {}, NP.getBgmSort(settings))
    .filter(b => String(b?.fileKey ?? "").trim());
  list.innerHTML = "";
  if (!bgms.length) {
    const empty = document.createElement("div");
    empty.className = "abgm-pl-empty";
    empty.textContent = "곡 없음";
    list.appendChild(empty);
    return;
  }
  const curKey = String(NP.getEngineCurrentFileKey() || "");
  const a = NP.getBgmAudio();
  const isPlaying = !!settings.enabled && !!curKey && !a?.paused;
  for (const b of bgms) {
    const fk = String(b.fileKey || "");
    const name = NP.getEntryName(b);
    const dur = Number(b.durationSec ?? 0);
    const durText = (Number.isFinite(dur) && dur > 0) ? abgmFmtTime(dur) : "";
    const row = document.createElement("div");
    row.className = "abgm-pl-item";
    row.dataset.filekey = fk;
    const isCur = (fk === curKey);
    if (isCur) row.classList.add("is-current");
    const icon = (isCur && isPlaying) ? "⏸" : "▶";
    row.innerHTML = `
      <div class="abgm-pl-left">
        <div class="abgm-pl-row1">
          <div class="abgm-pl-name" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
          <div class="abgm-pl-dur">${escapeHtml(durText ? `(${durText})` : "")}</div>
        </div>
      </div>
      <button type="button" class="menu_button abgm-pl-play" data-filekey="${escapeHtml(fk)}" title="Play">
        ${icon}
      </button>
    `;
    list.appendChild(row);
  }
} // abgmRenderPlaylistPage 닫기

// 플리에서 곡 찍으면: keywordMode 끄고 manual로 박고, chatStates/currentKey/listIndex 맞추고 재생
function abgmPlayFromPlaylist(fileKey) {
  const fk = String(fileKey || "").trim();
  if (!fk) return;
  const settings = ensureSettings();
  if (!settings.enabled) return;
  
  // 0) 현재 재생 중인 곡이면 → 일시정지/재생 토글
  const curKey = String(NP.getEngineCurrentFileKey() || "");
  const audio = NP.getBgmAudio();
  if (fk === curKey && audio) {
    if (!audio.paused) {
      try { audio.pause(); } catch {}
    } else {
      try { audio.play(); } catch {}
    }
    try { updateNowPlayingUI(); } catch {}
    return;
  }
  
  // 1) 키워드 모드만 끄고, playMode는 유저가 설정한 그대로 유지
  settings.keywordMode = false;
  // 2) 엔진틱이 참고하는 currentKey를 갱신해서 튕김 방지
  try { NP.ensureEngineFields?.(settings); } catch {}
  const ctx = NP.getSTContextSafe?.();
  const chatKey = NP.getChatKeyFromContext?.(ctx) || "global";
  settings.chatStates ??= {};
  settings.chatStates[chatKey] ??= {
    currentKey: "",
    listIndex: 0,
    lastSig: "",
    defaultPlayedSig: "",
    prevKey: "",
  };
  const preset = NP.getActivePreset(settings);
  // 3) listIndex도 같이 맞춰두면 다음/이전(리스트 기반)에서 덜 꼬임
  try {
    const sort = NP.getBgmSort(settings);
    const keys = NP.getSortedKeys(preset || {}, sort) || [];
    const idx = keys.indexOf(fk);
    const st = settings.chatStates[chatKey];
    if (st.currentKey && st.currentKey !== fk) st.prevKey = st.currentKey;
    st.currentKey = fk;
    if (idx >= 0) st.listIndex = idx;
  } catch {}
  const b = (preset?.bgms ?? []).find(x => String(x?.fileKey ?? "").trim() === fk) || null;
  const gv = Number(settings.globalVolume ?? 0.7);
  const bv = Number(b?.volume ?? 1);
  const vol01 = Math.max(0, Math.min(1, gv * bv));
  
  // 4) playMode에 따라 loop 결정
  const mode = settings.playMode || "manual";
  const shouldLoop = (mode === "loop_one");
  
  try { saveSettingsDebounced?.(); } catch {}
  NP.ensurePlayFile(fk, vol01, shouldLoop, preset?.id || "");
  try { updateNowPlayingUI(); } catch {}
}
