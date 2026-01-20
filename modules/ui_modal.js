// > 설정 모달(열기/닫기/fit/탭 전환/공통 modal 유틸)

import { escapeHtml } from "./utils.js";
import { openFloatingMenu } from "./ui_floating.js";
import { idbPutImage, idbGetImage, idbDelImage, makeImageKey } from "./storage.js";



let _loadHtml = async () => "";
let _initModal = () => {};
let _bindNowPlayingEventsOnce = () => {};
let _updateNowPlayingUI = () => {};
let _abgmViewportHandler = null;
let _abgmResizeObserver = null;

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
  // [FIX] 모바일/타 확장 충돌 방지: transform 걸린 컨테이너 피해서 무조건 body에 부착
  return document.body;
}

// host 기준으로 “PC는 최대폭 제한 + 가운데, 모바일은 꽉 차게” 사이즈를 계산/적용하는 애
export function fitModalToHost(overlay, host) {
  const modal = overlay?.querySelector?.(".autobgm-modal");
  if (!modal) return;
  const vv = window.visualViewport;
  // [FIX] vv 값이 0이거나 이상할 때 대비해 폴백 강화
  const vw = (vv && vv.width > 0) ? vv.width : window.innerWidth;
  const vh = (vv && vv.height > 0) ? vv.height : window.innerHeight;
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
  // [ADD] Observer 해제
  if (_abgmResizeObserver) {
    _abgmResizeObserver.disconnect();
    _abgmResizeObserver = null;
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
  // [FIX] body일 때는 relative 강제하지 않음 (전체 레이아웃 흔들림 방지)
  if (host !== document.body) {
    if (getComputedStyle(host).position === "static") host.style.position = "relative";
  }
  // 3) overlay는 컨테이너 기준 absolute로
  const setO = (k, v) => overlay.style.setProperty(k, v, "important");
  setO("position", "absolute");
  setO("inset", "0");
  setO("display", "block");
  setO("overflow", "auto");
  setO("-webkit-overflow-scrolling", "touch");
  setO("background", "rgba(0,0,0,.55)");
  setO("z-index", "90");
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
  // [ADD] ResizeObserver 추가 (호스트 크기 변화 대응)
  if (window.ResizeObserver) {
    _abgmResizeObserver = new ResizeObserver(() => {
      // [FIX] 콜백 내 에러 방지
      try { _abgmViewportHandler?.(); } catch {}
    });
    _abgmResizeObserver.observe(host);
    // 호스트가 body가 아니면 body도 같이 감시 (안전빵)
    if (host !== document.body) _abgmResizeObserver.observe(document.body);
  }
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

// BGM 엔트리 상세정보 편집 (탭형 다이얼로그: Image, License, Lyrics)
export function abgmEntryDetailPrompt(containerOrDoc, bgm, {
  title = "Entry Detail",
  okText = "확인",
  cancelText = "취소",
  resetText = "초기화",
} = {}) {
  const doc = containerOrDoc?.ownerDocument || document;
  const container =
    containerOrDoc && containerOrDoc.nodeType === 1 ? containerOrDoc : doc.body;
  return new Promise(async (resolve) => {
    const wrap = doc.createElement("div");
    wrap.className = "abgm-confirm-wrap";
    if (container !== doc.body) wrap.classList.add("abgm-confirm-in-modal");
    const license = String(bgm?.license ?? "");
    const lyrics = String(bgm?.lyrics ?? "");
    const imageUrl = String(bgm?.imageUrl ?? "");
    const hasStoredImage = !!bgm?.imageAssetKey;
    
    // 상태 추적용
    let pendingImageBlob = null;
    let pendingImageUrl = imageUrl;
    let deleteImage = false;
    
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
            <div class="abgm-image-panel" style="display:flex; flex-direction:column; gap:10px;">
              <div class="abgm-image-preview" style="
                width:100%; aspect-ratio:1/1; max-height:200px;
                display:flex; align-items:center; justify-content:center;
                border-radius:8px; overflow:hidden; position:relative;
              ">
                <div class="abgm-image-placeholder" style="opacity:.5; font-size:12px; text-align:center;">
                  이미지 없음
                </div>
                <img class="abgm-image-img" style="
                  display:none; max-width:100%; max-height:100%; object-fit:contain;
                " />
              </div>
              <div style="display:flex; gap:6px; align-items:center;">
                <input type="text" class="abgm-image-url" placeholder="이미지 URL 붙여넣기..." 
                  value="${escapeHtml(imageUrl)}"
                  style="flex:1; padding:8px; border-radius:6px; font-size:12px;" />
                <button type="button" class="menu_button abgm-image-url-apply" title="URL 적용" 
                  style="padding:6px 10px; font-size:12px;">적용</button>
              </div>
              <div style="display:flex; gap:6px;">
                <button type="button" class="menu_button abgm-image-upload" style="flex:1; font-size:12px;">
                  📁 파일 업로드
                </button>
                <input type="file" class="abgm-image-file" accept="image/*" style="display:none;" />
                <button type="button" class="menu_button abgm-image-delete" style="padding:6px 10px; font-size:12px;" 
                  title="이미지 삭제">🗑️</button>
              </div>
              <div class="abgm-image-status" style="font-size:11px; opacity:.6; text-align:center; min-height:16px;"></div>
            </div>
          </div>
          <div class="abgm-entry-panel" data-panel="license" style="display:none;">
            <textarea class="abgm-entry-textarea" data-field="license" placeholder="예) CC BY 4.0 / 출처 링크 / 사용조건 요약...">${escapeHtml(license)}</textarea>
          </div>
          <div class="abgm-entry-panel" data-panel="lyrics" style="display:none;">
            <textarea class="abgm-entry-textarea" data-field="lyrics" placeholder="가사를 입력하세요...">${escapeHtml(lyrics)}</textarea>
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
    
    const previewImg = wrap.querySelector(".abgm-image-img");
    const placeholder = wrap.querySelector(".abgm-image-placeholder");
    const urlInput = wrap.querySelector(".abgm-image-url");
    const urlApplyBtn = wrap.querySelector(".abgm-image-url-apply");
    const uploadBtn = wrap.querySelector(".abgm-image-upload");
    const fileInput = wrap.querySelector(".abgm-image-file");
    const deleteBtn = wrap.querySelector(".abgm-image-delete");
    const statusEl = wrap.querySelector(".abgm-image-status");
    
    const updatePreview = (src) => {
      if (src) {
        previewImg.src = src;
        previewImg.style.display = "block";
        placeholder.style.display = "none";
      } else {
        previewImg.src = "";
        previewImg.style.display = "none";
        placeholder.style.display = "block";
      }
    };
    const setStatus = (msg) => { if (statusEl) statusEl.textContent = msg; };
    
    // 초기 미리보기 로드 (구버전/신버전 둘 다)
    try {
      const key = String(bgm?.imageAssetKey || bgm?.id || "").trim();
      if (key) {
        const blob = await idbGetImage(key);
        if (blob) {
          updatePreview(URL.createObjectURL(blob));
          setStatus("저장된 이미지 (업로드됨)");
        } else if (imageUrl) {
          updatePreview(imageUrl);
          setStatus("URL 이미지");
        }
      } else if (imageUrl) {
        updatePreview(imageUrl);
        setStatus("URL 이미지");
      }
    } catch (e) {
      console.warn("[MyaPl] Image load failed:", e);
      if (imageUrl) {
        updatePreview(imageUrl);
        setStatus("URL 이미지");
      }
    }
    // URL 적용
    urlApplyBtn?.addEventListener("click", () => {
      const url = String(urlInput?.value ?? "").trim();
      pendingImageUrl = url;
      pendingImageBlob = null;
      deleteImage = false;
      if (url) {
        updatePreview(url);
        setStatus("URL 적용됨 (저장 시 반영)");
      } else {
        updatePreview(null);
        setStatus("");
      }
    });
    
    // 파일 업로드
    uploadBtn?.addEventListener("click", () => fileInput?.click());
    fileInput?.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        setStatus("이미지 파일만 가능합니다");
        return;
      }
      pendingImageBlob = file;
      pendingImageUrl = "";
      deleteImage = false;
      updatePreview(URL.createObjectURL(file));
      setStatus("업로드됨: " + file.name + " (저장 시 반영)");
    });
    
    // 이미지 삭제
    deleteBtn?.addEventListener("click", () => {
      deleteImage = true;
      pendingImageBlob = null;
      pendingImageUrl = "";
      if (urlInput) urlInput.value = "";
      updatePreview(null);
      setStatus("이미지 삭제됨 (저장 시 반영)");
    });
    
    // 탭 전환
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
        imageUrl: pendingImageUrl,
        imageBlob: pendingImageBlob,
        deleteImage: deleteImage,
      });
    });
    wrap.querySelector(".abgm-confirm-reset")?.addEventListener("click", () => {
      if (licenseTA) licenseTA.value = "";
      if (lyricsTA) lyricsTA.value = "";
      deleteImage = true;
      pendingImageBlob = null;
      pendingImageUrl = "";
      if (urlInput) urlInput.value = "";
      updatePreview(null);
      setStatus("모두 초기화됨");
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
