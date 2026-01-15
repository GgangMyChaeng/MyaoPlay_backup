import { ensureSettings } from "./settings.js";
import { saveSettingsDebounced } from "./deps.js";

console.log("[MyaPl] ui_floating loaded");

// index.js에 있던 다른 기능(모달/NP/디버그 토글) 콜백만 연결해줌
let openModal = () => {};
let openNowPlayingGlass = () => {};
let toggleDebugMode = () => {};
let updateMenuNPAnimation = () => {};



/** ========================= 외부 기능 연결(콜백 바인딩) ========================= */
// 플로팅 메뉴 DOM을 바깥에서 필요할 때 가져가는 애
export function abgmGetFloatingMenuEl() {
  return _floatingMenu;
}

// index.js 쪽 함수들(openModal/NP/Debug/애니메이션)을 이 모듈에 “꽂아주는” 애
export function abgmBindFloatingActions(actions = {}) {
  if (typeof actions.openModal === "function") openModal = actions.openModal;
  if (typeof actions.openNowPlayingGlass === "function") openNowPlayingGlass = actions.openNowPlayingGlass;
  if (typeof actions.toggleDebugMode === "function") toggleDebugMode = actions.toggleDebugMode;
  if (typeof actions.updateMenuNPAnimation === "function") {
    updateMenuNPAnimation = actions.updateMenuNPAnimation;
  }
}



/** ========================= 플로팅 버튼 생성/제거 ========================= */
let _floatingBtn = null;
let _floatingMenu = null;
let _floatingMenuOpen = false;
let _floatingDragging = false;
let _floatingDragOffset = { x: 0, y: 0 };
let _debugToast = null;  // 디버그 토스트 엘리먼트

// 플로팅 버튼 DOM 만들고(이미지 포함) 저장된 위치로 배치하는 애
function createFloatingButton() {
  if (_floatingBtn) return _floatingBtn;
  const settings = ensureSettings();
  const btn = document.createElement("div");
  btn.id = "abgm_floating_btn";
  btn.className = "abgm-floating-btn";
btn.innerHTML = `
  <div class="abgm-floating-icon">
    <img src="https://i.postimg.cc/P5Dxmj6T/Floating.png" style="width:100%; height:100%; border-radius:50%; object-fit:cover;" 
         alt="AutoBGM">
  </div>
`;
  // > 초기 위치
  const x = settings.floating.x ?? window.innerWidth - 40;
  const y = settings.floating.y ?? window.innerHeight - 100;
  btn.style.left = `${x}px`;
  btn.style.top = `${y}px`;
  // > 드래그 시작
  btn.addEventListener("mousedown", onDragStart);
  btn.addEventListener("touchstart", onDragStart, { passive: false });
  document.body.appendChild(btn);
  _floatingBtn = btn;
  return btn;
}

// 플로팅 버튼 DOM 제거 + 참조 비우는 애
function removeFloatingButton() {
  if (_floatingBtn) {
    _floatingBtn.remove();
    _floatingBtn = null;
  }
}



/** ========================= 드래그 & 스냅 동작 ========================= */
// (onDragEnd 내부 규칙)
// - 상단 중앙 드롭 ⇒ floating 비활성화 + 버튼/메뉴 제거 + 토글 UI를 Off로 바꿔줌
// - 하단 중앙 드롭 ⇒ 벽 스냅 후 메뉴 열기 + 위치 저장
// - 그 외 ⇒ 벽 스냅만 + 위치 저장

// 드래그 시작: 오프셋 계산하고 move/end 리스너 거는 애 (플로팅 버튼 작동 로직)
function onDragStart(e) {
  e.preventDefault();
  _floatingDragging = true;
  const rect = _floatingBtn.getBoundingClientRect();
  const clientX = e.type.startsWith("touch") ? e.touches[0].clientX : e.clientX;
  const clientY = e.type.startsWith("touch") ? e.touches[0].clientY : e.clientY;
  _floatingDragOffset.x = clientX - rect.left;
  _floatingDragOffset.y = clientY - rect.top;
  _floatingBtn.classList.add("dragging");
  document.addEventListener("mousemove", onDragMove);
  document.addEventListener("touchmove", onDragMove, { passive: false });
  document.addEventListener("mouseup", onDragEnd);
  document.addEventListener("touchend", onDragEnd);
}

// 드래그 중: 커서/터치 좌표 따라 버튼 위치(left/top) 갱신하는 애
function onDragMove(e) {
  if (!_floatingDragging) return;
  e.preventDefault();
  const clientX = e.type.startsWith("touch") ? e.touches[0].clientX : e.clientX;
  const clientY = e.type.startsWith("touch") ? e.touches[0].clientY : e.clientY;
  let x = clientX - _floatingDragOffset.x;
  let y = clientY - _floatingDragOffset.y;
  // > 화면 밖 방지
  const w = _floatingBtn.offsetWidth;
  const h = _floatingBtn.offsetHeight;
  x = Math.max(-w / 2, Math.min(window.innerWidth - w / 2, x));
  y = Math.max(0, Math.min(window.innerHeight - h, y));
  _floatingBtn.style.left = `${x}px`;
  _floatingBtn.style.top = `${y}px`;
}

// 드래그 끝: 특정 “구역 드롭” 기능 + 위치 저장하는 애
function onDragEnd(e) {
  if (!_floatingDragging) return;
  _floatingDragging = false;
  _floatingBtn.classList.remove("dragging");
  document.removeEventListener("mousemove", onDragMove);
  document.removeEventListener("touchmove", onDragMove);
  document.removeEventListener("mouseup", onDragEnd);
  document.removeEventListener("touchend", onDragEnd);
  const rect = _floatingBtn.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  // 1) viewport 기준으로
  const vv = window.visualViewport;
  const screenW = vv?.width || window.innerWidth;
  const screenH = vv?.height || window.innerHeight;
  // > PC/모바일에 따라 하단 오픈 판정 완화
  const isPc = screenW >= 900;                 // > 대충 PC 판정
  const bottomFrac = isPc ? 0.55 : 0.65;       // > PC는 덜 끌어도 열리게 (0.70~0.75 취향)
  const topFrac = 0.20;
  // 2) 상단 중앙 영역
  const topCenterLeft  = 0 + screenW * 0.25;
  const topCenterRight = 0 + screenW * 0.75;
  const topThreshold   = 0 + screenH * topFrac;
  // 3) 하단 중앙 영역 (가로도 중앙 대칭으로 맞춰줌)
  const bottomCenterLeft  = 0 + screenW * 0.1;
  const bottomCenterRight = 0 + screenW * 0.9;
  const bottomThreshold   = 0 + screenH * bottomFrac;
  // 4) 상단 중앙에 놓으면 → 비활성화
  if (centerY < topThreshold && centerX > topCenterLeft && centerX < topCenterRight) {
    const s = ensureSettings();
    s.floating.enabled = false;
    saveSettingsDebounced();
    removeFloatingButton();
    removeFloatingMenu();
    const toggle = document.querySelector("#autobgm_floating_toggle");
    if (toggle) {
      const stateEl = toggle.querySelector(".autobgm-menu-state");
      if (stateEl) stateEl.textContent = "Off";
    }
    return;
  }
  // 5) 하단 중앙에 놓으면 → 메뉴 열기
  if (centerY > bottomThreshold && centerX > bottomCenterLeft && centerX < bottomCenterRight) {
    snapToEdge();
    openFloatingMenu();
    const s = ensureSettings();
    const rect2 = _floatingBtn.getBoundingClientRect();
    s.floating.x = rect2.left;
    s.floating.y = rect2.top;
    saveSettingsDebounced();
    return;
  }
  // 6) 그 외: 벽에 스냅만
  snapToEdge();
  const s = ensureSettings();
  const rect3 = _floatingBtn.getBoundingClientRect();
  s.floating.x = rect3.left;
  s.floating.y = rect3.top;
  saveSettingsDebounced();
}

// 드래그 끝났을 때 좌/우 벽 가까운 쪽으로 “반쯤 걸치게” 스냅시키는 애
function snapToEdge() {
  const rect = _floatingBtn.getBoundingClientRect();
  const w = rect.width;
  const centerX = rect.left + w / 2;
  let targetX = rect.left;
  // 1) 좌/우 중 가까운 쪽으로
  if (centerX < window.innerWidth / 2) {
    // > 좌측 벽에 반쯤 걸치게
    targetX = -w / 2;
  } else {
    // > 우측 벽에 반쯤 걸치게
    targetX = window.innerWidth - w / 2;
  }
  _floatingBtn.style.transition = "left 0.2s ease-out";
  _floatingBtn.style.left = `${targetX}px`;
  setTimeout(() => {
    _floatingBtn.style.transition = "";
  }, 200);
}



/** ========================= 플로팅 메뉴 생성/열기/닫기/제거 ========================= */
// (메뉴 버튼 액션)
// - nowplaying: NP 글래스 열고 메뉴 닫음
// - debug: 디버그 토글 콜백 호출
// - help: 현재는 로그만(“나중에 구현” 주석)
// - settings: 모달 열고 메뉴 닫음

// 메뉴 DOM 만들고(버튼 4개: NP/Debug/Help/Settings) 클릭 액션 연결하는 애 (플로팅 메뉴 생성)
function createFloatingMenu() {
  if (_floatingMenu) return _floatingMenu;
  const menu = document.createElement("div");
  menu.id = "abgm_floating_menu";
  menu.className = "abgm-floating-menu";
  menu.innerHTML = `
    <div class="abgm-floating-menu-bg"></div>
    <div class="abgm-floating-menu-buttons">
      <button type="button" class="abgm-menu-btn abgm-menu-np" data-action="nowplaying" title="Now Playing">
        <img src="https://i.postimg.cc/3R8x5D3T/Now_Playing.png" class="abgm-menu-icon abgm-menu-icon-np" alt="NP">
      </button>
      <button type="button" class="abgm-menu-btn abgm-menu-debug" data-action="debug" title="Debug">
        <img src="https://i.postimg.cc/sDNDNb5c/Debug_off.png" class="abgm-menu-icon abgm-menu-icon-debug" alt="Debug">
      </button>
      <button type="button" class="abgm-menu-btn abgm-menu-help" data-action="help" title="Help">
        <img src="https://i.postimg.cc/NGPfSMVZ/Help.png" class="abgm-menu-icon" alt="Help">
      </button>
      <button type="button" class="abgm-menu-btn abgm-menu-settings" data-action="settings" title="Settings">
        <img src="https://i.postimg.cc/j5cRQ1sC/Settings.png" class="abgm-menu-icon" alt="Settings">
      </button>
    </div>
  `;
// 1) 버튼 클릭 이벤트
  menu.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) {
      // 2) 버튼이 아닌 메뉴 바깥(배경) 클릭 시 닫기
      if (e.target === menu) {
        closeFloatingMenu();
      }
      return;
    }
    const action = btn.dataset.action;
    if (action === "nowplaying") {
      openNowPlayingGlass();
      closeFloatingMenu(); // 3) NP 뜨면 플로팅 메뉴는 닫기
    } else if (action === "debug") {
      toggleDebugMode();
    } else if (action === "help") {
      // 4) Help 섹션 열기 (나중에 구현)
      console.log("[MyaPl] Help clicked");
    } else if (action === "settings") {
      openModal();
      closeFloatingMenu();
    }
  });
  document.body.appendChild(menu);
  _floatingMenu = menu;
  return menu;
}

// 메뉴 열기: 중앙(50vw/50vh)에 고정 배치하고, debug 아이콘/NP 애니 갱신 + 바깥클릭 감지 켬
function openFloatingMenu() {
  if (_floatingMenuOpen) return;
  const menu = createFloatingMenu();
  // 1) viewport 기준으로 고정 (폭 줄 때 상단으로 튀는 거 방지)
  menu.style.left = "50vw";
  menu.style.top = "50vh";
  menu.classList.add("is-open");
  _floatingMenuOpen = true;
  updateMenuDebugIcon();
  updateMenuNPAnimation();
  // 2) 메뉴 바깥 클릭 감지
  setTimeout(() => {
    document.addEventListener("click", onMenuOutsideClick, true);
  }, 100);
}

// 메뉴 닫기: is-open 끄고 바깥클릭 감지 해제
function closeFloatingMenu() {
  if (!_floatingMenu) return;
  _floatingMenu.classList.remove("is-open");
  _floatingMenuOpen = false;
  document.removeEventListener("click", onMenuOutsideClick, true);
}

// 메뉴 밖 클릭하면 닫는 애(버튼 자체 클릭은 제외)
function onMenuOutsideClick(e) {
  if (!_floatingMenu || !_floatingMenuOpen) return;
  // > 메뉴 영역 밖 클릭이면 닫기
  if (!_floatingMenu.contains(e.target) && e.target !== _floatingBtn) {
    closeFloatingMenu();
  }
}

// 메뉴 DOM 제거 + 상태 플래그 정리
function removeFloatingMenu() {
  if (_floatingMenu) {
    _floatingMenu.remove();
    _floatingMenu = null;
    _floatingMenuOpen = false;
  }
}



/** ========================= 디버그 아이콘/토스트 ========================= */
// 메뉴의 Debug 아이콘 이미지를 settings.debugMode에 맞춰 on/off로 바꾸는 애
export function updateMenuDebugIcon() {
  if (!_floatingMenu) return;
  const s = ensureSettings();
  const on = !!s.debugMode;
  const icon = _floatingMenu.querySelector(".abgm-menu-icon-debug");
  if (icon) {
    icon.src = on ? "https://i.postimg.cc/N0hGgTJ7/Debug_on.png" : "https://i.postimg.cc/sDNDNb5c/Debug_off.png";
  }
}

// 화면에 디버그 토스트 DOM을 만들거나(없으면) 재사용하는 애
function createDebugToast() {
  if (_debugToast) return _debugToast;
  const toast = document.createElement("div");
  toast.id = "abgm_debug_toast";
  toast.className = "abgm-debug-toast";
  toast.innerHTML = `
    <div class="abgm-debug-toast-line" id="abgm_debug_line"></div>
  `;
  document.body.appendChild(toast);
  _debugToast = toast;
  return toast;
}

// 토스트 텍스트만 업데이트하는 애
function updateDebugToast(text) {
  if (!_debugToast) return;
  const line = _debugToast.querySelector("#abgm_debug_line");
  if (line) line.textContent = String(text || "");
}

// 토스트 표시/숨김 토글하는 애
function toggleDebugToast(show) {
  const toast = createDebugToast();
  toast.classList.toggle("is-visible", !!show);
}

// 토스트 텍스트 세팅(필요시 생성 포함)
function setDebugToastText(text) {
  createDebugToast();
  updateDebugToast(text);
}



/** ========================= 레이아웃/리사이즈 대응 ========================= */
// 창 크기 바뀌면 “왼쪽에 붙어있었는지/오른쪽이었는지” 보고 다시 반쯤 걸치게 재배치 + 좌표 저장
function updateFloatingButtonPosition() {
  if (!_floatingBtn) return;
  const rect = _floatingBtn.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;
  const centerX = rect.left + w / 2;
  // > 어느 쪽 벽에 붙어있었는지 판별
  const isLeft = centerX < window.innerWidth / 2;
  let targetX = isLeft ? (-w / 2) : (window.innerWidth - w / 2);
  let targetY = Math.max(0, Math.min(window.innerHeight - h, rect.top));
  _floatingBtn.style.left = `${targetX}px`;
  _floatingBtn.style.top = `${targetY}px`;
  const s = ensureSettings();
  s.floating.x = targetX;
  s.floating.y = targetY;
  saveSettingsDebounced();
}



/** ========================= export ========================= */
// > 마지막에 필요한 것만 export로 열어주기
export {
  createFloatingButton,
  removeFloatingButton,
  removeFloatingMenu,
  openFloatingMenu,
  closeFloatingMenu,
  updateFloatingButtonPosition,
  toggleDebugToast,
  setDebugToastText,
};
