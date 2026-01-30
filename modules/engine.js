// > 오디오 런타임(재생/정지/틱/선곡/키워드 판정)

import { ensureSettings } from "./settings.js";
import { saveSettingsDebounced, getBoundPresetIdFromContext } from "./deps.js";
import { idbGet } from "./storage.js";
import { providers as ttsProviders } from "./tts/providers/index.js";

// console.log("[MyaPl] engine loaded");

// ===== 외부 의존성 (index.js에서 주입받음) =====
let _updateNowPlayingUI = () => {};
let _getSTContextSafe = () => null;
let _getChatKeyFromContext = () => "";
let _ensureEngineFields = () => {};
let _findBgmByKey = () => null;
let _getSortedKeys = () => [];
let _getBgmSort = () => "added_asc";
let _makeAsstSig = () => "";
let _getLastAssistantText = () => "";
let _setDebugLine = () => {};



/** ========================= 의존성 주입 (index.js에서 연결) ========================= */
// index.js가 넘겨준 함수들을 엔진 내부에서 쓸 수 있게 바인딩
export function abgmBindEngineDeps(deps = {}) {
  if (typeof deps.updateNowPlayingUI === "function") _updateNowPlayingUI = deps.updateNowPlayingUI;
  if (typeof deps.getSTContextSafe === "function") _getSTContextSafe = deps.getSTContextSafe;
  if (typeof deps.getChatKeyFromContext === "function") _getChatKeyFromContext = deps.getChatKeyFromContext;
  if (typeof deps.ensureEngineFields === "function") _ensureEngineFields = deps.ensureEngineFields;
  if (typeof deps.findBgmByKey === "function") _findBgmByKey = deps.findBgmByKey;
  if (typeof deps.getSortedKeys === "function") _getSortedKeys = deps.getSortedKeys;
  if (typeof deps.getBgmSort === "function") _getBgmSort = deps.getBgmSort;
  if (typeof deps.makeAsstSig === "function") _makeAsstSig = deps.makeAsstSig;
  if (typeof deps.getLastAssistantText === "function") _getLastAssistantText = deps.getLastAssistantText;
  if (typeof deps.setDebugLine === "function") _setDebugLine = deps.setDebugLine;
}

/** ========================= 엔진 상태 접근 (외부에서 읽기/쓰기) ========================= */
// ===== 오디오 객체 =====
const _bgmAudio = new Audio();
let _bgmUrl = "";
let _engineTimer = null;
let _engineLastChatKey = "";
let _engineCurrentFileKey = "";
let _engineCurrentPresetId = "";
let _engineLastPresetId = "";
let _engineLastKeywordMode = false;
// 로비 pause/resume용
let _enginePausedByLobby = false;
let _engineLobbyStreak = 0;
// 재생 로딩 중 플래그 (비동기 갭 방지)
let _isPlayPending = false;
let _isSfxPending = false;

// ===== SFX 전용 오디오 =====
const _sfxAudio = new Audio();
let _sfxUrl = "";
let _sfxCurrentFileKey = "";
// 참고: SFX 런타임 상태(_lastSfxSig, _bgmPausedBySfx, _sfxOverlayWasOff)는 state.js에서 관리

let _lastTtsSig = ""; // TTS 중복 재생 방지용

// ===== 외부 접근용 getter =====
// 메인 BGM Audio 객체를 외부(UI)에서 접근할 수 있게 반환
export function getBgmAudio() { return _bgmAudio; }
// 현재 엔진이 “재생 중/선택된” 파일키(또는 URL) 반환
export function getEngineCurrentFileKey() { return _engineCurrentFileKey; }
// 현재 엔진이 붙잡고 있는 프리셋 id 반환
export function getEngineCurrentPresetId() { return _engineCurrentPresetId; }
// 엔진의 “현재 파일키”를 강제로 세팅(외부 네비게이션 버튼 등에서 사용)
export function setEngineCurrentFileKey(key) { _engineCurrentFileKey = String(key || ""); }

// ===== ABGM audio exclusivity bus =====
window.__ABGM_AUDIO_BUS__ ??= { engine: null, freesrc: null, preview: null, sfx: null };
window.__ABGM_AUDIO_BUS__.engine = _bgmAudio;
window.__ABGM_AUDIO_BUS__.sfx = _sfxAudio;

// 메인 오디오 재생 시작하면 프리소스 끄기
try {
  _bgmAudio.addEventListener("play", () => window.abgmStopOtherAudio?.("engine"));
} catch {}

// SFX 끝나면 BGM 복귀 (Overlay OFF 모드용)
// state.js의 getter/setter를 나중에 import해서 사용할 예정
// 지금은 window 전역으로 임시 연결
try {
  _sfxAudio.addEventListener("ended", () => {
    _sfxCurrentFileKey = "";
    // state.js에서 상태 가져오기 (import 순환 방지용 임시 방법)
    const getBgmPausedBySfx = window.__abgmStateGetters?.getBgmPausedBySfx || (() => false);
    const setBgmPausedBySfx = window.__abgmStateSetters?.setBgmPausedBySfx || (() => {});
    const getSfxOverlayWasOff = window.__abgmStateGetters?.getSfxOverlayWasOff || (() => false);
    const setSfxOverlayWasOff = window.__abgmStateSetters?.setSfxOverlayWasOff || (() => {});
    
    // Overlay OFF였고, SFX 때문에 BGM을 pause 했던 경우에만 복귀
    if (getSfxOverlayWasOff() && getBgmPausedBySfx() && _bgmAudio && !!_bgmAudio.src) {
      setBgmPausedBySfx(false);
      setSfxOverlayWasOff(false);
      try { _bgmAudio.play(); } catch {}
    } else {
      setBgmPausedBySfx(false);
      setSfxOverlayWasOff(false);
    }
    try { _updateNowPlayingUI(); } catch {}
  });
} catch {}



/** ========================= 내부 유틸 (엔진 전용) ========================= */
// 0~1 범위로 볼륨 값을 안전하게 클램프
function clamp01(x) {
  x = Number(x);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

// 문자열이 http/https URL인지 대충 판정
function isProbablyUrl(s) {
  const v = String(s ?? "").trim();
  return /^https?:\/\//i.test(v);
}

// "키워드 입력" 문자열을 쉼표/줄바꿈 기준으로 쪼개서 배열로 만듦
function parseKeywords(s) {
  return String(s ?? "")
    .split(/[,\n]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

// 타입 판정 헬퍼
function _getEntryType(b) {
  return (String(b?.type ?? "BGM").toUpperCase() === "SFX") ? "SFX" : "BGM";
}

// 이번 어시스턴트 텍스트에서 “트리거된 키워드들”을 모아서(중복 제거) 반환(디버그용)
function collectTriggeredKeywords(preset, text) {
  const t = String(text ?? "").toLowerCase();
  if (!t) return [];
  const out = [];
  const seen = new Set(); // 1) 대소문자 무시 중복 제거용
  for (const b of (preset?.bgms ?? [])) {
    const kws = parseKeywords(b?.keywords);
    for (const kwRaw of kws) {
      const kw = String(kwRaw ?? "").trim();
      if (!kw) continue;
      const k = kw.toLowerCase();
      if (seen.has(k)) continue;
      if (t.includes(k)) {
        seen.add(k);
        out.push(kw); // 2) 원래 표기 유지
      }
    }
  }
  return out;
}

// {{🎤🐱:keyword}} 토큰 파싱 - 텍스트에서 토큰 형식의 키워드를 추출
const MYA_TOKEN_REGEX = /\{\{🎤🐱:([^}]+)\}\}/gi;

function extractTokenKeyword(text) {
  const t = String(text ?? "");
  const matches = [...t.matchAll(MYA_TOKEN_REGEX)];
  if (!matches.length) return null;
  // 첫 번째 토큰만 사용 (여러 개 있어도 하나만 인식)
  return matches[0][1].trim().toLowerCase();
}

// 토큰 기반 선곡: 토큰에서 추출한 키워드로 BGM 매칭
function pickByToken(preset, text, preferKey = "", avoidKey = "", typeWanted = "BGM") {
  const tokenKw = extractTokenKeyword(text);
  if (!tokenKw) return null;
  let bestPri = -Infinity;
  let candidates = [];
  for (const b of preset.bgms ?? []) {
    if (_getEntryType(b) !== typeWanted) continue;
    const fk = String(b.fileKey ?? "");
    if (!fk) continue;
    if (avoidKey && fk === avoidKey) continue;
    const kws = parseKeywords(b.keywords);
    if (!kws.length) continue;
    // 토큰 키워드가 BGM의 키워드 목록에 있는지 확인
    const hit = kws.some((kw) => kw.toLowerCase() === tokenKw);
    if (!hit) continue;
    const pri = Number(b.priority ?? 0);
    if (pri > bestPri) {
      bestPri = pri;
      candidates = [b];
    } else if (pri === bestPri) {
      candidates.push(b);
    }
  }
  if (!candidates.length) return null;
  if (candidates.length === 1) return candidates[0];
  if (preferKey) {
    const keep = candidates.find((x) => String(x.fileKey ?? "") === String(preferKey));
    if (keep) return keep;
  }
  return candidates[Math.floor(Math.random() * candidates.length)];
}

// 하이브리드 선곡: 토큰 우선 -> 매칭 폴백
function pickByHybrid(preset, text, preferKey = "", avoidKey = "", typeWanted = "BGM") {
  // 1) 토큰 먼저 시도
  const tokenHit = pickByToken(preset, text, preferKey, avoidKey, typeWanted);
  if (tokenHit) return { bgm: tokenHit, source: 'token' };
  // 2) 토큰 없으면 기존 매칭
  const matchHit = pickByKeyword(preset, text, preferKey, avoidKey, typeWanted);
  if (matchHit) return { bgm: matchHit, source: 'matching' };
  return null;
}

// 디버그용: 토큰에서 추출된 키워드 표시
function getTokenDebugInfo(text) {
  const tokenKw = extractTokenKeyword(text);
  return tokenKw ? `token:${tokenKw}` : 'token:(none)';
}

// 서브모드에 따른 통합 선곡 함수
// 반환: { bgm, source } 또는 null
function pickBySubMode(subMode, preset, text, preferKey = "", avoidKey = "", typeWanted = "BGM") {
  if (subMode === "token") {
    const hit = pickByToken(preset, text, preferKey, avoidKey, typeWanted);
    return hit ? { bgm: hit, source: "token" } : null;
  }
  if (subMode === "hybrid") {
    return pickByHybrid(preset, text, preferKey, avoidKey, typeWanted);
  }
  // 기본: matching
  const hit = pickByKeyword(preset, text, preferKey, avoidKey, typeWanted);
  return hit ? { bgm: hit, source: "matching" } : null;
}



/** ========================= Time Mode 유틸 ========================= */
function extractTimeFromText(text) {
  const t = String(text ?? "");
  const patterns = [
    { regex: /(\d{1,2}):(\d{2})(?:~|$|\s|[^\d])/g, parse: (m) => ({ hour: parseInt(m[1], 10), minute: parseInt(m[2], 10) }) },
    { regex: /(오전|오후)?\s*(\d{1,2})시\s*(\d{1,2})분/g, parse: (m) => {
      let h = parseInt(m[2], 10);
      const min = parseInt(m[3], 10);
      if (m[1] === '오후' && h < 12) h += 12;
      if (m[1] === '오전' && h === 12) h = 0;
      return { hour: h, minute: min };
    }},
    { regex: /(오전|오후)?\s*(\d{1,2})시(?!\s*\d)/g, parse: (m) => {
      let h = parseInt(m[2], 10);
      if (m[1] === '오후' && h < 12) h += 12;
      if (m[1] === '오전' && h === 12) h = 0;
      return { hour: h, minute: 0 };
    }},
    { regex: /(\d{1,2})\s*(am|pm|AM|PM)/g, parse: (m) => {
      let h = parseInt(m[1], 10);
      const isPM = m[2].toLowerCase() === 'pm';
      if (isPM && h < 12) h += 12;
      if (!isPM && h === 12) h = 0;
      return { hour: h, minute: 0 };
    }},
    { regex: /(am|pm|AM|PM)\s*(\d{1,2})/g, parse: (m) => {
      let h = parseInt(m[2], 10);
      const isPM = m[1].toLowerCase() === 'pm';
      if (isPM && h < 12) h += 12;
      if (!isPM && h === 12) h = 0;
      return { hour: h, minute: 0 };
    }},
  ];
  for (const { regex, parse } of patterns) {
    regex.lastIndex = 0;
    const match = regex.exec(t);
    if (match) {
      const result = parse(match);
      if (result.hour >= 0 && result.hour <= 23 && result.minute >= 0 && result.minute <= 59) {
        return result;
      }
    }
  }
  return null;
}

function getCurrentRealTime() {
  const now = new Date();
  return { hour: now.getHours(), minute: now.getMinutes() };
}

function timeStrToMinutes(str) {
  const [h, m] = String(str ?? "00:00").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function isTimeInSlot(time, slot) {
  if (!time || !slot) return false;
  const current = time.hour * 60 + time.minute;
  const start = timeStrToMinutes(slot.start);
  const end = timeStrToMinutes(slot.end);
  if (start <= end) {
    return current >= start && current <= end;
  } else {
    return current >= start || current <= end;
  }
}

function getActiveTimeSlots(timeMode) {
  if (!timeMode) return [];
  const scheme = timeMode.scheme || 'day4';
  return timeMode[scheme] || [];
}

function getTimeKeywords(time, timeMode) {
  if (!time || !timeMode?.enabled) return [];
  const slots = getActiveTimeSlots(timeMode);
  for (const slot of slots) {
    if (isTimeInSlot(time, slot)) {
      return parseKeywords(slot.keywords);
    }
  }
  return [];
}

function applyTimeMode(settings, text) {
  const tm = settings?.timeMode;
  if (!tm?.enabled) return [];
  let time = null;
  if (tm.source === 'realtime') {
    time = getCurrentRealTime();
  } else {
    time = extractTimeFromText(text);
  }
  return getTimeKeywords(time, tm);
}



/** ========================= 선곡 헬퍼 (키워드/랜덤) ========================= */
// 키워드 매칭 + priority 기준으로 후보를 뽑고(동점이면 랜덤), preferKey면 우선 유지
function pickByKeyword(preset, text, preferKey = "", avoidKey = "", typeWanted = "BGM") {
  const t = String(text ?? "").toLowerCase();
  if (!t) return null;
  let bestPri = -Infinity;
  let candidates = [];
  for (const b of preset.bgms ?? []) {
    if (_getEntryType(b) !== typeWanted) continue;
    const fk = String(b.fileKey ?? "");
    if (!fk) continue;
    if (avoidKey && fk === avoidKey) continue;
    const kws = parseKeywords(b.keywords);
    if (!kws.length) continue;
    const hit = kws.some((kw) => t.includes(kw.toLowerCase()));
    if (!hit) continue;
    const pri = Number(b.priority ?? 0);
    if (pri > bestPri) {
      bestPri = pri;
      candidates = [b];
    } else if (pri === bestPri) {
      candidates.push(b);
    }
  }
  if (!candidates.length) return null;
  if (candidates.length === 1) return candidates[0];
  if (preferKey) {
    const keep = candidates.find((x) => String(x.fileKey ?? "") === String(preferKey));
    if (keep) return keep;
  }
  return candidates[Math.floor(Math.random() * candidates.length)];
}

// keys 목록에서 avoid만 피해서 랜덤 1개 뽑기(없으면 전체에서 뽑기)
export function pickRandomKey(keys, avoid = "") {
  const arr = (keys ?? []).filter(Boolean);
  if (!arr.length) return "";
  if (arr.length === 1) return arr[0];
  const pool = arr.filter((k) => k !== avoid);
  const pickFrom = pool.length ? pool : arr;
  return pickFrom[Math.floor(Math.random() * pickFrom.length)];
}



/** ========================= 재생 제어 (외부 액션) ========================= */
// 현재 재생을 정리(일시정지/시간0/url revoke/src 비움/현재키 비움) + NP UI 갱신
export function stopRuntime() {
  try { _bgmAudio.pause(); } catch {}
  _bgmAudio.currentTime = 0;
  if (_bgmUrl) URL.revokeObjectURL(_bgmUrl);
  _bgmUrl = "";
  _bgmAudio.src = "";
  _engineCurrentFileKey = "";
  _engineCurrentPresetId = "";
  _updateNowPlayingUI();
  try { delete _bgmAudio.dataset.currentFileKey; } catch {}
}

// 재생↔일시정지 토글(아무 것도 없으면 engineTick으로 “뭐라도” 재생 시도)
export async function togglePlayPause() {
  const s = ensureSettings();
  if (!s.enabled) return;
  if (_engineCurrentFileKey && !_bgmAudio.paused) {
    try { _bgmAudio.pause(); } catch {}
    _updateNowPlayingUI();
    return;
  }
  if (_engineCurrentFileKey && _bgmAudio.paused) {
    try { await _bgmAudio.play(); } catch {}
    _updateNowPlayingUI();
    return;
  }
  try { engineTick(); } catch {}
  _updateNowPlayingUI();
}

// fileKey 또는 URL을 실제로 오디오에 연결해서 재생(IDB blob이면 objectURL로 재생)
export async function ensurePlayFile(fileKey, vol01, loop, presetId = "", autoplay = true) {
  window.abgmStopOtherAudio?.("engine");
  const fk = String(fileKey ?? "").trim();
  if (!fk) return false;
  _isPlayPending = true; // 재생 시도 시작 (engineTick에서 wasPlaying으로 간주하게 함)
  if (isProbablyUrl(fk)) {
    if (_bgmUrl) URL.revokeObjectURL(_bgmUrl);
    _bgmUrl = "";
    _bgmAudio.loop = !!loop;
    _bgmAudio.src = fk;
    _bgmAudio.dataset.currentFileKey = fk;
    _bgmAudio.volume = clamp01(vol01);
    if (autoplay) {
      try { await _bgmAudio.play(); } catch {}
    }
    _engineCurrentFileKey = fk;
    if (presetId) _engineCurrentPresetId = String(presetId);
    _updateNowPlayingUI();
    _isPlayPending = false;
    return true;
  }
  const blob = await idbGet(fk);
  if (!blob) {
    console.warn("[MyaPl] IDB asset missing:", fk, "- File not found in IDB. May have been lost due to extension update or cache clear.");
    _isPlayPending = false;
    return false;
  }
  if (_bgmUrl) URL.revokeObjectURL(_bgmUrl);
  _bgmUrl = URL.createObjectURL(blob);
  _bgmAudio.loop = !!loop;
  _bgmAudio.src = _bgmUrl;
  _bgmAudio.dataset.currentFileKey = fk;
  _bgmAudio.volume = clamp01(vol01);
  if (autoplay) {
    try { await _bgmAudio.play(); } catch {}
  }
  _engineCurrentFileKey = fk;
  if (presetId) _engineCurrentPresetId = String(presetId);
  _updateNowPlayingUI();
  _isPlayPending = false;
  return true;
}

export async function ensurePlaySfxFile(fileKey, vol01) {
  // SFX는 engine(BGM) 위에 얹을 수도 있으니 "sfx"로만 bus 주장
  window.abgmStopOtherAudio?.("sfx");
  const fk = String(fileKey ?? "").trim();
  if (!fk) return false;
  _isSfxPending = true;
  // 이전 SFX 정리
  try { _sfxAudio.pause(); } catch {}
  _sfxAudio.currentTime = 0;
  if (_sfxUrl) URL.revokeObjectURL(_sfxUrl);
  _sfxUrl = "";
  _sfxAudio.loop = false;
  _sfxAudio.volume = clamp01(vol01);
  // URL이면 바로 재생
  if (isProbablyUrl(fk)) {
    _sfxAudio.src = fk;
    _sfxCurrentFileKey = fk;
    _sfxAudio.dataset.currentFileKey = fk;
    try { await _sfxAudio.play(); } catch {}
    try { _updateNowPlayingUI(); } catch {}
    _isSfxPending = false;
    return true;
  }
  // IDB blob이면 objectURL로
  const blob = await idbGet(fk);
  if (!blob) {
    console.warn("[MyaPl][SFX] IDB asset missing:", fk, "- File not found in IDB.");
    _isSfxPending = false;
    return false;
  }
  _sfxUrl = URL.createObjectURL(blob);
  _sfxAudio.src = _sfxUrl;
  _sfxCurrentFileKey = fk;
  _sfxAudio.dataset.currentFileKey = fk;
  try { await _sfxAudio.play(); } catch {}
  try { _updateNowPlayingUI(); } catch {}
  _isSfxPending = false;
  return true;
}

function maybeTriggerSfxFromKeywordMode({ settings, preset, textWithTime, subMode, sig, getVol }) {
  // console.log("[SFX DEBUG] maybeTriggerSfxFromKeywordMode called"); 시끄러워서 셋은 끔
  // console.log("[SFX DEBUG] sfxMode:", settings?.sfxMode);
  // console.log("[SFX DEBUG] overlay:", settings?.sfxMode?.overlay);
  // state.js getter/setter 가져오기
  const getLastSfxSig = window.__abgmStateGetters?.getLastSfxSig || (() => "");
  const setLastSfxSig = window.__abgmStateSetters?.setLastSfxSig || (() => {});
  const setBgmPausedBySfx = window.__abgmStateSetters?.setBgmPausedBySfx || (() => {});
  const setSfxOverlayWasOff = window.__abgmStateSetters?.setSfxOverlayWasOff || (() => {});
  // SFX 후보 선곡 (SFX만)
  const result = pickBySubMode(subMode, preset, textWithTime, "", "", "SFX");
  const hit = result?.bgm || null;
  const hitKey = hit?.fileKey ? String(hit.fileKey) : "";
  if (!hitKey) return false;
  // 1회 트리거 방지: sig + hitKey
  const sfxSig = `${String(sig || "")}::${hitKey}`;
  if (sfxSig && getLastSfxSig() === sfxSig) return false;
  setLastSfxSig(sfxSig);
  const overlay = !!settings?.sfxMode?.overlay;
  console.log("[SFX DEBUG] overlay final:", overlay);
  setSfxOverlayWasOff(!overlay);
  // Overlay OFF면 BGM 잠깐 pause (끝나면 _sfxAudio 'ended' 리스너가 복귀)
  let bgmWasPausedHere = false;
  if (!overlay && _bgmAudio) {
    const bgmWasPlaying = !_bgmAudio.paused && !_bgmAudio.ended && !!_bgmAudio.src;
    console.log("[SFX DEBUG] bgmWasPlaying:", bgmWasPlaying);
    console.log("[SFX DEBUG] _bgmAudio.paused:", _bgmAudio.paused);
    console.log("[SFX DEBUG] _bgmAudio.src:", _bgmAudio.src);
    setBgmPausedBySfx(bgmWasPlaying);
    if (bgmWasPlaying) {
      console.log("[SFX DEBUG] >>> PAUSING BGM");
      try { _bgmAudio.pause(); } catch {}
      bgmWasPausedHere = true;
    }
  }
  // SFX 재생
  ensurePlaySfxFile(hitKey, getVol(hitKey)).then((ok) => {
    if (!ok && bgmWasPausedHere) {
      // SFX 로드 실패 시 BGM 즉시 복구
      setBgmPausedBySfx(false);
      setSfxOverlayWasOff(false);
      try { _bgmAudio.play(); } catch {}
    }
  });
  return true;
}



/** ========================= 메인 엔진 루프 ========================= */
// 설정/컨텍스트/채팅 상태를 보고: 키워드모드 or 일반모드에 맞춰 “지금 뭐 틀지” 결정
export function engineTick() {
  // SFX가 재생 중이고 Overlay OFF로 BGM을 pause 해둔 상태면 BGM 로직 스킵
   const getBgmPausedBySfx = window.__abgmStateGetters?.getBgmPausedBySfx || (() => false);
   if (getBgmPausedBySfx() && (_isSfxPending || (_sfxAudio && !_sfxAudio.paused))) {
    // SFX 재생 중 - BGM 건드리지 않고 SFX만 계속 재생되게 둠
    return;
   }
  const settings = ensureSettings();
  _ensureEngineFields(settings);
  if (!settings.enabled) {
    stopRuntime();
    return;
  }
  const ctx = _getSTContextSafe();
  const chatKey = _getChatKeyFromContext(ctx);
  const prevChatKey = _engineLastChatKey; // 로비 복귀 판단용
  // 1-1) 로비/컨텍스트 불안정 구간(global::...) 처리
  const isGlobal = String(chatKey || "").startsWith("global::");
  if (isGlobal) {
    // 1-2) 키워드 모드에서만 로비면 "pause" 처리
    if (settings.keywordMode) {
      _engineLobbyStreak = Math.min((_engineLobbyStreak || 0) + 1, 9);
      // 2) global이 2틱 이상 유지될 때만 진짜 로비로 보고 pause (깜빡임 방지)
      if (_engineLobbyStreak >= 2 && !_bgmAudio.paused && !_bgmAudio.ended) {
        try { _bgmAudio.pause(); } catch {}
        _enginePausedByLobby = true;
        try { _updateNowPlayingUI(); } catch {}
      }
    }
    if (window.__abgmDebugMode) {
      _setDebugLine(
        `lobby: ${chatKey}` +
        (settings.keywordMode ? ` | paused:${_enginePausedByLobby} | streak:${_engineLobbyStreak}` : "")
      );
    }
    return;
  }
  // 3) 로비 탈출
  _engineLobbyStreak = 0;
  // 4) 같은 채팅방으로 복귀했을 때만 자동 재개 (다른 방이면 아래 로직이 알아서 선곡)
  if (_enginePausedByLobby) {
    if (settings.keywordMode && prevChatKey && prevChatKey === chatKey) {
      if (_engineCurrentFileKey && _bgmAudio.paused && !_bgmAudio.ended) {
        try {
          const p = _bgmAudio.play();
          if (p && typeof p.catch === "function") p.catch(() => {});
        } catch {}
      }
    }
    _enginePausedByLobby = false;
    try { _updateNowPlayingUI(); } catch {}
  }
  // ===== 디버그 라인: 항상 업데이트 (키워드 모드 여부 무관) =====
  const lastAsst = _getLastAssistantText(ctx);
  const asstText = String(lastAsst ?? "");

  // [TTS] 자동 재생 로직
  if (asstText && settings.ttsMode?.enabled && settings.ttsMode?.autoPlay) {
    const currentSig = _makeAsstSig(asstText);
    // 이전과 다른 메시지라면 재생 시도
    if (currentSig !== _lastTtsSig) {
      _lastTtsSig = currentSig;
      // 비동기로 실행 (엔진 틱 지연 방지)
      (async () => {
        try {
          const pid = settings.ttsMode.provider;
          const provider = ttsProviders[pid];
          const pSettings = settings.ttsMode.providers?.[pid];
          if (provider && pSettings) {
            const url = await provider.getAudioUrl(asstText, pSettings);
            const audio = new Audio(url);
            audio.volume = 0.8; // 임시 볼륨 (나중에 설정으로 뺄 수 있음)
            await audio.play();
          }
        } catch (e) {
          console.error("[MyaPl] Auto TTS Error:", e);
        }
      })();
    }
  }

  if (window.__abgmDebugMode) {
    const len = asstText.length;
    const preview = asstText.slice(0, 40).replace(/\s+/g, " ");
    _setDebugLine(`asstLen:${len} "${preview}..."`);
    }
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
  if (!preset) return;
  const mode = settings.playMode ?? "manual";
  // === 키워드 모드 진입 감지: Bind 체크 ===
  const isKeywordModeEntered = settings.keywordMode && !_engineLastKeywordMode;
  if (isKeywordModeEntered) {
    const boundId = getBoundPresetIdFromContext(ctx);
    if (boundId && settings.activePresetId !== boundId) {
      console.log(`[MyaPl] 키워드 모드 진입: Bind 프리셋 적용 (${boundId})`);
      stopRuntime();
      settings.activePresetId = boundId;
      _engineCurrentPresetId = boundId;
      preset = settings.presets?.[boundId] || preset;
      st.currentKey = "";
      _engineCurrentFileKey = "";
      try { saveSettingsDebounced(); } catch {}
      try { _updateNowPlayingUI(); } catch {}
    }
  }
  _engineLastKeywordMode = !!settings.keywordMode;
  const sort = _getBgmSort(settings);
  let keys = _getSortedKeys(preset, sort);
  // 키워드 모드 아닐 때는 SFX를 BGM 재생 후보에서 제외 (옵션)
  if (!settings.keywordMode && settings?.sfxMode?.skipInOtherModes) {
    keys = keys.filter((k) => _getEntryType(_findBgmByKey(preset, k)) !== "SFX");
  }
  // 채팅 바뀌면 Bind 체크 + 프리셋 유지 판단
  const boundPresetId = getBoundPresetIdFromContext(ctx);
  const isChatChanged = _engineLastChatKey && _engineLastChatKey !== chatKey;
  // 초기 진입(LastKey 없음)이어도 Bind가 있고 현재 프리셋과 다르면 진입해야 함 (강제 동기화)
  const isBindMismatch = !_engineLastChatKey && boundPresetId && settings.activePresetId !== boundPresetId;

  if (isChatChanged || isBindMismatch) {
  if (settings.keywordMode) {
    stopRuntime(); // 키워드 모드는 무조건 정리
    // Bind 프리셋이 있으면 적용
    if (boundPresetId && settings.activePresetId !== boundPresetId) {
      console.log(`[MyaPl] 채팅방 전환(키워드): Bind 프리셋 적용 (${boundPresetId})`);
      settings.activePresetId = boundPresetId;
      _engineCurrentPresetId = boundPresetId;
      preset = settings.presets?.[boundPresetId] || preset;
      // 이전 곡 상태 초기화 (다른 프리셋 곡이 재생되는 거 방지)
      st.currentKey = "";
      _engineCurrentFileKey = "";
      try { saveSettingsDebounced(); } catch {}
      try { _updateNowPlayingUI(); } catch {}
    }
  } else {
      // === 일반 모드(Manual/Loop/Random) ===
      const currentFileKey = String(_engineCurrentFileKey || "").trim();
      // 재생 중이었거나, 재생 로딩 중이면 true
      const wasPlaying = (currentFileKey && !_bgmAudio.paused && !_bgmAudio.ended) || _isPlayPending;

      // 타겟 프리셋 결정 (Bind 있으면 무조건 그 프리셋, 없으면 현재 유저가 선택한 activePreset 유지)
      // "Bind 없는 방"은 "기본 프리셋"으로 돌아가는 게 아니라 "현재 듣던 프리셋"을 유지하는 것이 일반적
      // 일반 모드에서는 Bind 무시 - 현재 프리셋 유지
      const targetPresetId = settings.activePresetId;
      const targetPreset = settings.presets?.[targetPresetId];

      if (!targetPreset) {
        // 프리셋 자체가 없으면 정리
        stopRuntime();
        _engineCurrentPresetId = "";
        return;
      }

      // 현재 재생 중인 곡이 타겟 프리셋에 존재하는지 확인
      const inTargetPreset = currentFileKey && (targetPreset.bgms ?? []).some(
        b => String(b.fileKey ?? "") === currentFileKey // trim 처리된 키끼리 비교 권장되나 여기선 그대로
      );

      // === Case 1: 곡 유지 가능 (타겟 프리셋에 현재 곡이 있음) ===
      if (inTargetPreset && settings.activePresetId === targetPresetId) {
        // 프리셋도 같고 곡도 같음 -> 아무것도 안 함 (상태 동기화만)
        st.currentKey = currentFileKey;
      } 
      else if (inTargetPreset && settings.activePresetId !== targetPresetId) {
        // 프리셋은 다르지만(예: Bind됨) 곡이 거기에도 있음 -> 끊지 않고 프리셋 ID만 교체
        console.log(`[MyaPl] 채팅방 전환: 곡 유지하며 프리셋 변경 (${currentFileKey})`);
        settings.activePresetId = targetPresetId;
        _engineCurrentPresetId = targetPresetId;
        st.currentKey = currentFileKey;
        preset = settings.presets?.[targetPresetId] || preset; // preset 변수 갱신
        try { saveSettingsDebounced(); } catch {}
        try { _updateNowPlayingUI(); } catch {}
      }
      // === Case 2: 곡 유지 불가 (타겟 프리셋에 곡이 없거나, 강제 전환 필요) ===
      else {
        console.log(`[MyaPl] 채팅방 전환: 프리셋 변경 및 재생 갱신`);
        
        // 1. 일단 멈춤 (이전 곡 정리)
        stopRuntime();

        // 2. 프리셋 변경 적용
        settings.activePresetId = targetPresetId;
        _engineCurrentPresetId = targetPresetId;
        
        // 3. 채팅방 상태 초기화 (이전 방의 잔재 제거)
        st.currentKey = "";
        st.listIndex = 0;

        // 4. "재생 중이었을 때만" 새 프리셋의 곡 재생
        if (wasPlaying) {
          const keys = _getSortedKeys(targetPreset, _getBgmSort(settings));
          if (keys.length > 0) {
            let startKey = "";
            if (mode === "random") {
              startKey = pickRandomKey(keys);
            } else {
              // Manual/Loop: Default or First
              startKey = String(targetPreset.defaultBgmKey ?? "").trim() || keys[0];
            }
            
            if (startKey) {
              // 중요: st.currentKey를 즉시 설정해야 하단 Loop 로직이 꼬이지 않음
              st.currentKey = startKey;
              if (mode === "loop_list") {
                st.listIndex = Math.max(0, keys.indexOf(startKey));
              }
              // 재생 시작
              ensurePlayFile(startKey, getVol(startKey), mode === "loop_one", targetPresetId);
            }
          }
        }
        // wasPlaying이 false면(조용했으면) 그냥 프리셋만 바뀐 채로 조용히 있음.
        
        try { saveSettingsDebounced(); } catch {}
        try { _updateNowPlayingUI(); } catch {}
        
        // 중요: 전환 로직을 수행했으면 이번 틱의 나머지(Loop/Manual 유지보수 로직)는 건너뜀
        return;
      }
    }
  }
  _engineLastChatKey = chatKey;
  _engineCurrentPresetId = preset.id;
  // 채팅 전환이 없었지만, UI 등에서 프리셋이 수동으로 변경된 경우에만 정리
  if (!(isChatChanged || isBindMismatch) && _engineLastPresetId && _engineLastPresetId !== String(preset.id)) {
    console.log(`[MyaPl] 수동 프리셋 변경 감지: ${String(_engineLastPresetId)} -> ${String(preset.id)}`);
    stopRuntime();
    st.currentKey = "";
    st.listIndex = 0;
    st.lastSig = "";
    st.defaultPlayedSig = "";
    st.prevKey = "";
    _engineCurrentFileKey = ""; // 현재 재생 키도 초기화
  }
  _engineLastPresetId = String(preset.id);
  const as = String(lastAsst ?? "");
  const useDefault = !!settings.useDefault;
  const defKey = String(preset.defaultBgmKey ?? "");
  const getVol = (fk) => {
    const b = _findBgmByKey(preset, fk);
    return clamp01((settings.globalVolume ?? 0.7) * (b?.volume ?? 1));
  };
  // ====== Keyword Mode ON ======
  if (settings.keywordMode) {
    const asstText = String(lastAsst ?? "");
    const sig = _makeAsstSig(asstText);
    const subMode = settings.keywordSubMode || "matching";
    // Time Mode: 시간 키워드를 텍스트에 추가 (매칭 검색용)
    const timeKws = applyTimeMode(settings, asstText);
    const textWithTime = timeKws.length ? asstText + " " + timeKws.join(" ") : asstText;
    const sfxTriggered = maybeTriggerSfxFromKeywordMode({ settings, preset, textWithTime, subMode, sig, getVol });
    const sfxOverlayOff = sfxTriggered && !settings?.sfxMode?.overlay;
    const setBgmPausedBySfx = window.__abgmStateSetters?.setBgmPausedBySfx || (() => {});

    if (!settings.keywordOnce) {
      // 무한 유지 로직
      const prefer = st.currentKey || _engineCurrentFileKey || "";
      const result = pickBySubMode(subMode, preset, textWithTime, prefer);
      const hit = result?.bgm || null;
      const hitSource = result?.source || "";
      const hitKey = hit?.fileKey ? String(hit.fileKey) : "";
      // 디버그 라인 업데이트 (키워드 매칭 후)
      if (window.__abgmDebugMode) {
        const len = asstText.length;
        const preview = asstText.slice(0, 40).replace(/\s+/g, " ");
        const hitName = hit ? (hit.name || hit.fileKey || "(unknown)") : "(none)";
        const kwsArr = collectTriggeredKeywords(preset, textWithTime);
        const kws = kwsArr.length ? kwsArr.join(", ") : "(none)";
        const tokenInfo = getTokenDebugInfo(asstText);
        _setDebugLine(`[${subMode}] time:${timeKws.length ? timeKws.join(",") : "off"} | ${tokenInfo} | kw:${kws} | hit:${hitName}${hitSource ? "("+hitSource+")" : ""}`);
      }
      const desired = hitKey ? hitKey : (useDefault && defKey ? defKey : "");
      if (desired) {
        st.currentKey = desired;
        if (_engineCurrentFileKey !== desired) {
          _engineCurrentFileKey = desired;
          if (sfxOverlayOff) setBgmPausedBySfx(true); // SFX 끝나면 재생하게 예약
          ensurePlayFile(desired, getVol(desired), true, preset.id, !sfxOverlayOff);
          try { _updateNowPlayingUI(); } catch {}
        } else {
          _bgmAudio.loop = true;
          _bgmAudio.volume = getVol(desired);
        }
        return;
      }
      // token 모드에서는 토큰 매칭 없으면 기존 곡 유지 안 함
      if (st.currentKey && subMode !== "token") {
        if (_engineCurrentFileKey !== st.currentKey) {
          _engineCurrentFileKey = st.currentKey;
          if (sfxOverlayOff) setBgmPausedBySfx(true);
          ensurePlayFile(st.currentKey, getVol(st.currentKey), true, preset.id, !sfxOverlayOff);
          try { _updateNowPlayingUI(); } catch {}
        } else {
          _bgmAudio.loop = true;
          _bgmAudio.volume = getVol(st.currentKey);
        }
      }
      return;
    }
    // 1회 재생 로직
    if (st.lastSig === sig) {
      if (_engineCurrentFileKey) {
        _bgmAudio.loop = false;
        _bgmAudio.volume = getVol(_engineCurrentFileKey);
      }
      return;
    }
    st.lastSig = sig;
    let avoidKey = "";
    const curKey = String(_engineCurrentFileKey || "");
    if (curKey) {
      const cur = _findBgmByKey(preset, curKey);
      const curKws = parseKeywords(cur?.keywords);
      const tLower = textWithTime.toLowerCase();
      if (curKws.some((kw) => tLower.includes(String(kw).toLowerCase()))) {
        avoidKey = curKey;
      }
    }
    const result = pickBySubMode(subMode, preset, textWithTime, "", avoidKey);
    const hit = result?.bgm || null;
    const hitSource = result?.source || "";
    const hitKey = hit?.fileKey ? String(hit.fileKey) : "";
    if (window.__abgmDebugMode) {
      const len = asstText.length;
      const preview = asstText.slice(0, 40).replace(/\s+/g, " ");
      const hitName = hit ? (hit.name || hit.fileKey || "(unknown)") : "(none)";
      const kwsArr = collectTriggeredKeywords(preset, textWithTime);
      const kws = kwsArr.length ? kwsArr.join(", ") : "(none)";
      const tokenInfo = getTokenDebugInfo(asstText);
      _setDebugLine(`[${subMode}] time:${timeKws.length ? timeKws.join(",") : "off"} | ${tokenInfo} | kw:${kws} | hit:${hitName}${hitSource ? "("+hitSource+")" : ""}`);
    }
    const isPlayingNow = !!_engineCurrentFileKey && !_bgmAudio.paused && !_bgmAudio.ended;
    // 재생 중이어도 "볼륨은 항상" 최신으로
    if (isPlayingNow && _engineCurrentFileKey) {
      _bgmAudio.loop = false;
      _bgmAudio.volume = getVol(_engineCurrentFileKey);
      return;
    }
    // 같은 곡이면 재시작은 안 하되 볼륨은 갱신
    if (hitKey && hitKey === _engineCurrentFileKey) {
      _bgmAudio.loop = false;
      _bgmAudio.volume = getVol(hitKey);
      return;
    }
    if (hitKey) {
      st.currentKey = "";
      st.defaultPlayedSig = "";
      _engineCurrentFileKey = hitKey;
      if (sfxOverlayOff) setBgmPausedBySfx(true);
      ensurePlayFile(hitKey, getVol(hitKey), false, preset.id, !sfxOverlayOff);
      try { _updateNowPlayingUI(); } catch {}
      return;
    }
    if (useDefault && defKey) {
      if (st.defaultPlayedSig !== sig) {
        st.defaultPlayedSig = sig;
        st.currentKey = "";
        _engineCurrentFileKey = defKey;
        if (sfxOverlayOff) setBgmPausedBySfx(true);
        ensurePlayFile(defKey, getVol(defKey), false, preset.id, !sfxOverlayOff);
        try { _updateNowPlayingUI(); } catch {}
      }
    }
    return;
  }
  // ====== Keyword Mode OFF ======
  // 키워드 모드가 아닌데 SFX가 재생 중이면 1번 꺼버림
  if (!settings?.keywordMode && _sfxAudio && !_sfxAudio.paused) {
    try { _sfxAudio.pause(); } catch {}
    try { _sfxAudio.currentTime = 0; } catch {}
    // BGM pause를 SFX가 걸어둔 상태였다면 해제 플래그도 초기화
    const setBgmPausedBySfx = window.__abgmStateSetters?.setBgmPausedBySfx || (() => {});
    const setSfxOverlayWasOff = window.__abgmStateSetters?.setSfxOverlayWasOff || (() => {});
    setBgmPausedBySfx(false);
    setSfxOverlayWasOff(false);
  }
  if (mode === "manual") {
    if (st.currentKey) {
      if (_engineCurrentFileKey !== st.currentKey) {
        ensurePlayFile(st.currentKey, getVol(st.currentKey), false, preset.id);
      } else {
        _bgmAudio.loop = false;
        _bgmAudio.volume = getVol(st.currentKey);
      }
    }
    return;
  }
  if (mode === "loop_one") {
    // ===== 엿같은 Loop One 개선: 프리셋 일치 체크 강화 =====
    const currentFileKey = String(_engineCurrentFileKey || "").trim();
    const stateFileKey = String(st.currentKey || "").trim();
    // 1) 현재 재생 중 + 현재 프리셋에 있음 → 최우선
    const currentInPreset = currentFileKey && keys.includes(currentFileKey);
    // 2) chatState 저장값 + 현재 프리셋에 있음
    const stateInPreset = stateFileKey && keys.includes(stateFileKey);
    let fk = "";
    if (currentInPreset) {
      // ✅ 현재 재생곡이 이 프리셋 곡이면 우선
      fk = currentFileKey;
    } else if (stateInPreset) {
      // ✅ chatState에 저장된 곡이 이 프리셋 곡이면 사용
      fk = stateFileKey;
    } else {
      // ❌ 둘 다 아니면 → 기본곡 or 첫 곡
      fk = defKey || keys[0] || "";
    }
    if (!fk) return;
    // 3) 현재 재생 중인 곡과 다르면 → 새로 재생
    if (currentFileKey !== fk) {
      // 조용했으면(pause 또는 아무것도 안 틀음) 재생 안 함, 상태만 세팅
      const wasActuallyPlaying = !_bgmAudio.paused && !_bgmAudio.ended && !!currentFileKey;
      if (!wasActuallyPlaying) {
        st.currentKey = fk;
        return;
      }
      ensurePlayFile(fk, getVol(fk), true, preset.id);
      st.currentKey = fk;
    } else {
      // 같은 곡이면 → 루프/볼륨만 확인
      _bgmAudio.loop = true;
      _bgmAudio.volume = getVol(fk);
    }
    return;
  }
  if (mode === "loop_list" || mode === "random") {
    if (_engineCurrentFileKey) {
      const fk = _engineCurrentFileKey;
      _bgmAudio.loop = false;
      _bgmAudio.volume = getVol(fk);
      st.currentKey = fk;
      return;
    }
    if (mode === "loop_list") {
      const idx = Math.max(0, Math.min(st.listIndex ?? 0, keys.length - 1));
      const fk = keys[idx] || "";
      if (fk) {
        // 조용했으면 재생 안 함, 상태만 세팅
        const wasActuallyPlaying = !_bgmAudio.paused && !_bgmAudio.ended && !!_engineCurrentFileKey;
        if (!wasActuallyPlaying) {
          st.currentKey = fk;
          st.listIndex = idx;
          return;
        }
        ensurePlayFile(fk, getVol(fk), false, preset.id);
        st.currentKey = fk;
        st.listIndex = idx;
      }
      return;
    }
    if (mode === "random") {
      const fk = pickRandomKey(keys, st.currentKey || "");
      if (fk) {
        // 조용했으면 재생 안 함, 상태만 세팅
        const wasActuallyPlaying = !_bgmAudio.paused && !_bgmAudio.ended && !!_engineCurrentFileKey;
        if (!wasActuallyPlaying) {
          st.currentKey = fk;
          return;
        }
        ensurePlayFile(fk, getVol(fk), false, preset.id);
        st.currentKey = fk;
      }
      return;
    }
  }
} // engineTick 닫기

// 900ms 주기로 engineTick 돌리는 타이머 시작 + 즉시 1회 tick
export function startEngine() {
  if (_engineTimer) clearInterval(_engineTimer);
  _engineTimer = setInterval(engineTick, 900);
  engineTick();
}



/** ========================= 오디오 이벤트 ========================= */
// 곡 끝났을 때(ended) 다음 곡으로 넘길지(루프리스트/랜덤 등) 처리하는 리스너(익명 함수)
_bgmAudio.addEventListener("ended", () => {
  const settings = ensureSettings();
  _ensureEngineFields(settings);
  if (!settings.enabled) return;
  const ctx = _getSTContextSafe();
  const chatKey = _getChatKeyFromContext(ctx);
  settings.chatStates[chatKey] ??= { currentKey: "", listIndex: 0, lastSig: "", defaultPlayedSig: "", prevKey: "" };
  const st = settings.chatStates[chatKey];
  // 키워드 모드 Once면 끝
  if (settings.keywordMode && settings.keywordOnce) {
    _engineCurrentFileKey = "";
    try { _updateNowPlayingUI(); } catch {}
    return;
  }
  // 키워드 모드 Hold면 engineTick이 알아서 처리
  if (settings.keywordMode && !settings.keywordOnce) return;
  // 프리셋 가져오기
  let preset = settings.presets?.[settings.activePresetId];
  if (!preset) preset = Object.values(settings.presets ?? {})[0];
  if (!preset) return;
  const sort = _getBgmSort(settings);
  let keys = _getSortedKeys(preset, sort); // ← _getNavKeys 제거
  // SFX 타입 필터링 (옵션 켜져있으면)
  if (settings?.sfxMode?.skipInOtherModes) {
    keys = keys.filter((k) => {
      const b = _findBgmByKey(preset, k);
      return _getEntryType(b) !== "SFX";
    });
  }
  if (!keys.length) return;
  const getVol = (fk) => {
    const b = _findBgmByKey(preset, fk);
    return clamp01((settings.globalVolume ?? 0.7) * (b?.volume ?? 1));
  };
  const mode = settings.playMode ?? "manual";
    // === Loop One 모드 ===
  if (mode === "loop_one") {
    // loop=true인데 어떤 이유로 ended가 불렸으면 → 다시 재생
    const fk = String(st.currentKey || _engineCurrentFileKey || keys[0] || "");
    if (fk) {
      ensurePlayFile(fk, getVol(fk), true, preset.id); // ← loop=true로 재설정
      st.currentKey = fk;
      try { saveSettingsDebounced?.(); } catch {}
    }
    return;
  }
  // === Loop List 모드 ===
  if (mode === "loop_list") {
    st.prevKey = String(st.currentKey || _engineCurrentFileKey || "");
    let idx = Number(st.listIndex ?? 0);
    idx = (idx + 1) % keys.length;
    st.listIndex = idx;
    const fk = keys[idx];
    st.currentKey = fk;
    ensurePlayFile(fk, getVol(fk), false, preset.id); // loop=false (끝나면 다시 이 ended로 옴)
    try { saveSettingsDebounced?.(); } catch {}
    return;
  }
  // === Random 모드 ===
  if (mode === "random") {
    st.prevKey = String(st.currentKey || _engineCurrentFileKey || "");
    const cur = String(st.currentKey ?? "");
    const pool = keys.filter((k) => k !== cur);
    const pickFrom = pool.length ? pool : keys;
    const next = pickFrom[Math.floor(Math.random() * pickFrom.length)];
    st.currentKey = next;
    ensurePlayFile(next, getVol(next), false, preset.id); // loop=false
    try { saveSettingsDebounced?.(); } catch {}
    return;
  }
  // === Manual 모드 ===
  // 곡 끝나면 그냥 멈춤 (아무것도 안 함)
});
