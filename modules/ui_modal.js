// > 설정 모달(열기/닫기/fit/탭 전환/공통 modal 유틸)

import { escapeHtml } from "./utils.js";
import { openFloatingMenu } from "./ui_floating.js";



let _loadHtml = async () => "";
let _initModal = () => {};
let _bindNowPlayingEventsOnce = () => {};
let _updateNowPlayingUI = () => {};
let _abgmViewportHandler = null;

const MODAL_OVERLAY_ID = "abgm_modal_overlay";



/** ========================= 의존성 주입 (Deps Binding) ========================= */
// (index.js에서 넘어오는) html 로더/모달 init/NP 이벤트 바인딩/NP UI 갱신 함수를 주입해두는 애
export function abgmBindModalDeps(deps = {}) {
  if (typeof deps.loadHtml === "function") _loadHtml = deps.loadHtml;
  if (typeof deps.initModal === "function") _initModal = deps.initModal;
  if (typeof deps.bindNowPlayingEventsOnce === "function") _bindNowPlayingEventsOnce = deps.bindNowPlayingEventsOnce;
  if (typeof deps.updateNowPlayingUI === "function") _updateNowPlayingUI = deps.updateNowPlayingUI;
}



/** ========================= 모달 사이징/호스트 잡기 ========================= */
// “무조건 화면 안” 버전으로 모달 스타일을 강제로 박아넣는 애(특히 좁은 폭/모바일 대응)
export function fitModalToViewport(overlay) {
  const modal = overlay?.querySelector?.(".autobgm-modal");
  if (!modal) return;
  const vv = window.visualViewport;
  const hRaw = Math.max(vv?.height || 0, window.innerHeight || 0, 600);
  const maxH = Math.max(240, Math.floor(hRaw - 24));
  const setI = (k, v) => modal.style.setProperty(k, v, "important");
  // 1) 좁은 폭에서도 무조건 화면 안
  setI("box-sizing", "border-box");
  setI("display", "block");
  setI("position", "relative");
  setI("width", "calc(100vw - 24px)");
  setI("max-width", "calc(100vw - 24px)");
  setI("min-width", "0");
  setI("margin", "12px");
  // 2) 높이 강제 (CSS !important도 뚫음)
  setI("min-height", "240px");
  setI("height", `${maxH}px`);
  setI("max-height", `${maxH}px`);
  setI("overflow", "auto");
  setI("visibility", "visible");
  setI("opacity", "1");
  setI("transform", "none");
  setI("border-radius", "14px");
}

// 모달 overlay를 어디 컨테이너에 붙일지 host를 찾아주는 애(#app/#sillytavern/main/body 순)
export function getModalHost() {
  return (
    document.querySelector("#app") ||
    document.querySelector("#sillytavern") ||
    document.querySelector("main") ||
    document.body
  );
}

// host 기준으로 “PC는 최대폭 제한 + 가운데, 모바일은 꽉 차게” 사이즈를 계산/적용하는 애
export function fitModalToHost(overlay, host) {
  const modal = overlay?.querySelector?.(".autobgm-modal");
  if (!modal) return;
  const vv = window.visualViewport;
  const vw = vv?.width || window.innerWidth;
  const vh = vv?.height || window.innerHeight;
  // 1) PC만 여백/최대폭 제한
  const isPc = vw >= 900;
  const pad = isPc ? 18 : 12;          // 2) PC는 살짝 더 여유
  const maxWDesktop = 860;              // <-- 여기 숫자 줄이면 더 콤팩트
  const wRaw = Math.max(280, Math.floor(vw - pad * 2));
  const w = isPc ? Math.min(maxWDesktop, wRaw) : wRaw;
  const h = Math.max(240, Math.floor(vh - pad * 2));
  const setI = (k, v) => modal.style.setProperty(k, v, "important");
  setI("box-sizing", "border-box");
  setI("display", "block");
  setI("position", "relative");
  setI("width", `${w}px`);
  setI("max-width", `${w}px`);
  setI("min-width", "0");
  setI("margin", `${pad}px auto`);
  setI("min-height", "240px");
  setI("height", `${h}px`);
  setI("max-height", `${h}px`);
  setI("overflow", "auto");
  setI("visibility", "visible");
  setI("opacity", "1");
  setI("transform", "none");
  setI("border-radius", "14px");
}



/** ========================= 모달 열기/닫기 ========================= */
// ESC 누르면 모달 닫게 하는 키 핸들러
function onEscClose(e) {
  if (e.key === "Escape") closeModal();
}

// overlay 제거 + body 클래스/리스너 정리 + NP UI 갱신까지 하는 “닫기”
export function closeModal() {
  const overlay = document.getElementById(MODAL_OVERLAY_ID);
  if (overlay) overlay.remove();
  document.body.classList.remove("autobgm-modal-open");
  window.removeEventListener("keydown", onEscClose);
  if (_abgmViewportHandler) {
    window.removeEventListener("resize", _abgmViewportHandler);
    window.visualViewport?.removeEventListener("resize", _abgmViewportHandler);
    window.visualViewport?.removeEventListener("scroll", _abgmViewportHandler);
    _abgmViewportHandler = null;
  }
  _updateNowPlayingUI();
}

// popup.html 로드해서 overlay 만들고 host에 붙인 뒤, fit/리스너/초기화까지 하는 “열기”
export async function openModal() {
  if (document.getElementById(MODAL_OVERLAY_ID)) return;
  let html = "";
  try {
    html = await _loadHtml("templates/popup.html");
  } catch (e) {
    console.error("[MyaPl] popup.html load failed", e);
    return;
  }
  const overlay = document.createElement("div");
  overlay.id = MODAL_OVERLAY_ID;
  overlay.className = "autobgm-overlay";
  overlay.innerHTML = html;
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal();
  });
  // 1) 모바일 WebView 강제 스타일 (CSS 씹는 경우 방지) — important 버전
  const host = getModalHost();
  // 2) host가 static이면 absolute overlay가 제대로 안 잡힘
  const cs = getComputedStyle(host);
  if (cs.position === "static") host.style.position = "relative";
  // 3) overlay는 컨테이너 기준 absolute로
  const setO = (k, v) => overlay.style.setProperty(k, v, "important");
  setO("position", "absolute");
  setO("inset", "0");
  setO("display", "block");
  setO("overflow", "auto");
  setO("-webkit-overflow-scrolling", "touch");
  setO("background", "rgba(0,0,0,.55)");
  setO("z-index", "2147483647");
  setO("padding", "0"); // 4) modal이 margin/pad 갖고 있으니 overlay는 0
  host.appendChild(overlay);
  // 5) 컨테이너 기준으로 사이징
  fitModalToHost(overlay, host);
  requestAnimationFrame(() => fitModalToHost(overlay, host));
  setTimeout(() => fitModalToHost(overlay, host), 120);
  // 6) 키보드/주소창 변화 대응 (visualViewport)
  _abgmViewportHandler = () => {
    // 7) 키보드 올라왔다 내려올 때 width/height가 바뀜
    fitModalToHost(overlay, host);
  };
  // 8) 키보드 내려갈 때 resize 이벤트가 안 오기도 해서, 포커스 빠질 때 강제 재계산
  const kickFit = () => {
    _abgmViewportHandler?.();
    setTimeout(() => _abgmViewportHandler?.(), 60);
    setTimeout(() => _abgmViewportHandler?.(), 240);
  };
  overlay.addEventListener("focusout", kickFit, true);
  overlay.addEventListener("touchend", kickFit, { passive: true });
  overlay.addEventListener("pointerup", kickFit, { passive: true });
  // 9) window resize도 유지
  window.addEventListener("resize", _abgmViewportHandler);
  // 10) visualViewport가 있으면 더 정확히
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", _abgmViewportHandler);
    window.visualViewport.addEventListener("scroll", _abgmViewportHandler); // > 중요: 키보드 올라오면 scroll도 같이 변함
  }
  document.body.classList.add("autobgm-modal-open");
  window.addEventListener("keydown", onEscClose);
  const closeBtn = overlay.querySelector("#abgm_modal_close");
  if (closeBtn) closeBtn.addEventListener("click", closeModal);
  // 뒤로가기 버튼 (플로팅 메뉴로)
  const backBtn = overlay.querySelector("#abgm_modal_back");
  if (backBtn) {
    backBtn.addEventListener("click", () => {
      closeModal();
      openFloatingMenu(); // 이걸로 다시 열기
    });
  }
  _initModal(overlay);
  _bindNowPlayingEventsOnce();
  _updateNowPlayingUI();
  console.log("[MyaPl] modal opened");
} // openModal 닫기



/** ========================= 미니 다이얼로그 (Confirm/Prompt/Preset Picker) ========================= */
// 프리셋 목록을 이름 기준으로 정렬해서 배열로 뽑는 애
function getPresetsSortedByName(settings) {
  const arr = Object.values(settings?.presets ?? {});
  arr.sort((a, b) => {
    const an = String(a?.name ?? a?.id ?? "").trim();
    const bn = String(b?.name ?? b?.id ?? "").trim();
    return an.localeCompare(bn, undefined, { numeric: true, sensitivity: "base" });
  });
  return arr;
}

// 삭제 확인 창 (확인/취소 팝업 띄우고 true/false로 resolve하는 애(바깥 클릭/ESC=취소))
export function abgmConfirm(containerOrDoc, message, {
  title = "Confirm",
  okText = "확인",
  cancelText = "취소",
} = {}) {
  const doc = containerOrDoc?.ownerDocument || document;
  // 1) overlay(=root) 같은 엘리먼트가 들어오면 거기에 붙임
  const container =
    containerOrDoc && containerOrDoc.nodeType === 1 ? containerOrDoc : doc.body;
  return new Promise((resolve) => {
    const wrap = doc.createElement("div");
    wrap.className = "abgm-confirm-wrap";
    // 2) overlay 안에 붙일 때는 absolute 센터링 모드
    if (container !== doc.body) wrap.classList.add("abgm-confirm-in-modal");
    wrap.innerHTML = `
      <div class="abgm-confirm-backdrop"></div>
      <div class="abgm-confirm" role="dialog" aria-modal="true">
        <div class="abgm-confirm-title">${escapeHtml(title)}</div>
        <div class="abgm-confirm-msg">${escapeHtml(message)}</div>
        <div class="abgm-confirm-actions">
          <button class="menu_button abgm-confirm-ok" type="button">${escapeHtml(okText)}</button>
          <button class="menu_button abgm-confirm-cancel" type="button">${escapeHtml(cancelText)}</button>
        </div>
      </div>
    `;
    const done = (v) => {
      doc.removeEventListener("keydown", onKey);
      wrap.remove();
      resolve(v);
    };
    wrap.querySelector(".abgm-confirm-backdrop")?.addEventListener("click", () => done(false));
    wrap.querySelector(".abgm-confirm-cancel")?.addEventListener("click", () => done(false));
    wrap.querySelector(".abgm-confirm-ok")?.addEventListener("click", () => done(true));
    const onKey = (e) => { if (e.key === "Escape") done(false); };
    doc.addEventListener("keydown", onKey);
    container.appendChild(wrap);
  });
}

// 라이센스 입력 쿠션창 (텍스트 입력(prompt) 팝업 띄우고 문자열(또는 취소=null)로 resolve하는 애 + 초기화 버튼 포함)
export function abgmPrompt(containerOrDoc, message, {
  title = "Edit",
  okText = "확인",
  cancelText = "취소",
  resetText = "초기화",
  initialValue = "",
  placeholder = "License / Description...",
} = {}) {
  const doc = containerOrDoc?.ownerDocument || document;
  const container =
    containerOrDoc && containerOrDoc.nodeType === 1 ? containerOrDoc : doc.body;
  return new Promise((resolve) => {
    const wrap = doc.createElement("div");
    wrap.className = "abgm-confirm-wrap";
    if (container !== doc.body) wrap.classList.add("abgm-confirm-in-modal");
    wrap.innerHTML = `
      <div class="abgm-confirm-backdrop"></div>
      <div class="abgm-confirm" role="dialog" aria-modal="true">
        <div class="abgm-confirm-title">${escapeHtml(title)}</div>
        <div class="abgm-confirm-msg">${escapeHtml(message)}</div>
        <textarea class="abgm-prompt-text" placeholder="${escapeHtml(placeholder)}"></textarea>
        <div class="abgm-confirm-row" style="margin-top:10px;">
  <div class="abgm-confirm-left">
    <button class="menu_button abgm-confirm-reset" type="button">초기화</button>
  </div>

  <div class="abgm-confirm-right">
    <button class="menu_button abgm-confirm-ok" type="button">확인</button>
    <button class="menu_button abgm-confirm-cancel" type="button">취소</button>
  </div>
</div>
    `;
    const ta = wrap.querySelector(".abgm-prompt-text");
    if (ta) ta.value = String(initialValue ?? "");
    const done = (v) => {
      doc.removeEventListener("keydown", onKey);
      wrap.remove();
      resolve(v);
    };
    const onKey = (e) => { if (e.key === "Escape") done(null); };
    doc.addEventListener("keydown", onKey);
    wrap.querySelector(".abgm-confirm-backdrop")?.addEventListener("click", () => done(null));
    wrap.querySelector(".abgm-confirm-cancel")?.addEventListener("click", () => done(null));
    wrap.querySelector(".abgm-confirm-ok")?.addEventListener("click", () => done(ta ? ta.value : ""));
    wrap.querySelector(".abgm-confirm-reset")?.addEventListener("click", () => {
      if (ta) ta.value = "";
      // > reset 후 즉시 저장시키고 싶으면 여기서 done("")로 바꿔도 됨
    });
    container.appendChild(wrap);
    // > 포커스
    setTimeout(() => { try { ta?.focus(); } catch {} }, 0);
  });
}

// BGM 엔트리 상세정보 편집 (탭형 다이얼로그: License/Description, Lyrics, Image)
export function abgmEntryDetailPrompt(containerOrDoc, bgm, {
  title = "Entry Detail",
  okText = "확인",
  cancelText = "취소",
  resetText = "초기화",
} = {}) {
  const doc = containerOrDoc?.ownerDocument || document;
  const container =
    containerOrDoc && containerOrDoc.nodeType === 1 ? containerOrDoc : doc.body;
  return new Promise((resolve) => {
    const wrap = doc.createElement("div");
    wrap.className = "abgm-confirm-wrap";
    if (container !== doc.body) wrap.classList.add("abgm-confirm-in-modal");
    const license = String(bgm?.license ?? "");
    const lyrics = String(bgm?.lyrics ?? "");
    wrap.innerHTML = `
      <div class="abgm-confirm-backdrop"></div>
      <div class="abgm-confirm abgm-entry-detail" role="dialog" aria-modal="true" style="min-width:320px; max-width:480px;">
        <div class="abgm-confirm-title">${escapeHtml(title)}</div>
        <div class="abgm-entry-tabs" style="display:flex; gap:4px; margin:10px 0 6px;">
          <button type="button" class="menu_button abgm-entry-tab is-active" data-tab="image">Image</button>
          <button type="button" class="menu_button abgm-entry-tab" data-tab="license">License</button>
          <button type="button" class="menu_button abgm-entry-tab" data-tab="lyrics">Lyrics</button>
        </div>
        <div class="abgm-entry-panels">
          <div class="abgm-entry-panel" data-panel="image" style="display:block;">
            <div style="padding:20px; text-align:center; opacity:.6; font-size:13px;">
              (이미지 기능 준비 중)
            </div>
          </div>
          <div class="abgm-entry-panel" data-panel="license" style="display:none;">
            <textarea class="abgm-entry-textarea" data-field="license" placeholder="예) CC BY 4.0 / 출처 링크 / 사용조건 요약...">${escapeHtml(license)}</textarea>
          </div>
          <div class="abgm-entry-panel" data-panel="lyrics" style="display:none;">
            <textarea class="abgm-entry-textarea" data-field="lyrics" style="
              width:100%; min-height:120px; resize:vertical;
              padding:10px;
              border-radius:10px;
              border:1px solid rgba(255,255,255,.14);
              background:rgba(0,0,0,.25);
              color:inherit;
              box-sizing:border-box;
            " placeholder="가사를 입력하세요...">${escapeHtml(lyrics)}</textarea>
          </div>
        </div>
        <div class="abgm-confirm-row" style="margin-top:10px;">
          <div class="abgm-confirm-left">
            <button class="menu_button abgm-confirm-reset" type="button">${escapeHtml(resetText)}</button>
          </div>
          <div class="abgm-confirm-right">
            <button class="menu_button abgm-confirm-ok" type="button">${escapeHtml(okText)}</button>
            <button class="menu_button abgm-confirm-cancel" type="button">${escapeHtml(cancelText)}</button>
          </div>
        </div>
      </div>
    `;
    // 탭 전환 로직
    const tabs = wrap.querySelectorAll(".abgm-entry-tab");
    const panels = wrap.querySelectorAll(".abgm-entry-panel");
    tabs.forEach(tab => {
      tab.addEventListener("click", () => {
        const tabId = tab.dataset.tab;
        tabs.forEach(t => t.classList.toggle("is-active", t.dataset.tab === tabId));
        panels.forEach(p => p.style.display = p.dataset.panel === tabId ? "block" : "none");
      });
    });
    
    const licenseTA = wrap.querySelector('[data-field="license"]');
    const lyricsTA = wrap.querySelector('[data-field="lyrics"]');
    const done = (result) => {
      doc.removeEventListener("keydown", onKey);
      wrap.remove();
      resolve(result);
    };
    const onKey = (e) => { if (e.key === "Escape") done(null); };
    doc.addEventListener("keydown", onKey);
    wrap.querySelector(".abgm-confirm-backdrop")?.addEventListener("click", () => done(null));
    wrap.querySelector(".abgm-confirm-cancel")?.addEventListener("click", () => done(null));
    wrap.querySelector(".abgm-confirm-ok")?.addEventListener("click", () => {
      done({
        license: licenseTA ? licenseTA.value : license,
        lyrics: lyricsTA ? lyricsTA.value : lyrics,
      });
    });
    wrap.querySelector(".abgm-confirm-reset")?.addEventListener("click", () => {
      if (licenseTA) licenseTA.value = "";
      if (lyricsTA) lyricsTA.value = "";
    });
    container.appendChild(wrap);
    setTimeout(() => { try { licenseTA?.focus(); } catch {} }, 0);
  });
}

// 항목 이동 (프리셋 선택(select) 팝업 띄우고 선택한 presetId(또는 취소=null)로 resolve하는 애)
export function abgmPickPreset(containerOrDoc, settings, {
  title = "Select Preset",
  message = "어느 프리셋으로 보낼까?",
  okText = "확인",
  cancelText = "취소",
  excludePresetId = "",
} = {}) {
  const doc = containerOrDoc?.ownerDocument || document;
  const container =
    containerOrDoc && containerOrDoc.nodeType === 1 ? containerOrDoc : doc.body;
  return new Promise((resolve) => {
    const wrap = doc.createElement("div");
    wrap.className = "abgm-confirm-wrap";
    if (container !== doc.body) wrap.classList.add("abgm-confirm-in-modal");
    const options = getPresetsSortedByName(settings)
      .filter((p) => String(p.id) !== String(excludePresetId))
      .map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name || p.id)}</option>`)
      .join("");
    wrap.innerHTML = `
      <div class="abgm-confirm-backdrop"></div>
      <div class="abgm-confirm" role="dialog" aria-modal="true">
        <div class="abgm-confirm-title">${escapeHtml(title)}</div>
        <div class="abgm-confirm-msg">${escapeHtml(message)}</div>
        <select class="abgm-pickpreset" style="
          width:100%;
          margin-top:10px;
          padding:10px;
          border-radius:10px;
          border:1px solid rgba(255,255,255,.14);
          background:rgba(0,0,0,.25);
          color:inherit;
          box-sizing:border-box;
        ">
          ${options}
        </select>
        <div class="abgm-confirm-actions" style="margin-top:10px;">
          <button class="menu_button abgm-confirm-ok" type="button">${escapeHtml(okText)}</button>
          <button class="menu_button abgm-confirm-cancel" type="button">${escapeHtml(cancelText)}</button>
        </div>
      </div>
    `;
    const sel = wrap.querySelector(".abgm-pickpreset");
    const done = (v) => {
      doc.removeEventListener("keydown", onKey);
      wrap.remove();
      resolve(v);
    };
    wrap.querySelector(".abgm-confirm-backdrop")?.addEventListener("click", () => done(null));
    wrap.querySelector(".abgm-confirm-cancel")?.addEventListener("click", () => done(null));
    wrap.querySelector(".abgm-confirm-ok")?.addEventListener("click", () => done(sel?.value || null));
    const onKey = (e) => { if (e.key === "Escape") done(null); };
    doc.addEventListener("keydown", onKey);
    container.appendChild(wrap);
    setTimeout(() => { try { sel?.focus(); } catch {} }, 0);
  });
}
