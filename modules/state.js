// > 프리셋/BGM 공용 조회 + 정렬 헬퍼 전담

import { isProbablyUrl } from "./utils.js";



/** ========================= 프리셋/엔트리 기본 조회 ========================= */
// 현재 활성화된 프리셋 가져오기
export function getActivePreset(settings) {
  return settings.presets[settings.activePresetId];
}



/** ========================= 표시 이름(라벨) 생성 ========================= */
// 파일키/URL에서 표시 이름 추출 ("song.mp3" → "song", URL → hostname)
export function nameFromSource(src) {
  const s = String(src || "").trim();
  if (!s) return "";
  // 1) URL이면 path 마지막 조각 or hostname
  if (isProbablyUrl(s)) {
    try {
      const u = new URL(s);
      const last = (u.pathname.split("/").pop() || "").trim();
      const cleanLast = last.replace(/\.[^/.]+$/, ""); // 확장자 제거
      return cleanLast || u.hostname || "URL";
    } catch {
      return "URL";
    }
  }
  // 2) 파일이면 기존대로
  const base = s.split("/").pop() || s;
  return base.replace(/\.[^/.]+$/, "");
}

// BGM 엔트리의 표시 이름 가져오기 (name 필드 or 파일명)
export function getEntryName(bgm) {
  const n = String(bgm?.name ?? "").trim();
  return n ? n : nameFromSource(bgm?.fileKey ?? "");
}

// 프리셋의 모든 BGM에 name 필드 자동 생성
export function ensureBgmNames(preset) {
  for (const b of preset?.bgms ?? []) {
    if (!String(b?.name ?? "").trim()) {
      b.name = nameFromSource(b.fileKey);
    }
  }
}



/** ========================= 정렬 모드 읽기 ========================= */
// 플레이리스트/재생(엔진/NP)에서 쓰는 정렬
export function getBgmSort(settings) {
  return settings?.ui?.playlistSort ?? settings?.ui?.bgmSort ?? "added_asc";
}

// Settings 모달(BGM List)에서 쓰는 정렬
export function getPresetSort(settings) {
  return settings?.ui?.presetSort ?? settings?.ui?.bgmSort ?? "added_asc";
}



/** ========================= BGM 목록 정렬/추출 ========================= */
// 프리셋의 BGM 목록을 정렬 방식대로 정렬해서 반환
export function getSortedBgms(preset, sort) {
  const arr = [...(preset?.bgms ?? [])];
  const mode = sort || "added_asc";
  // 1) 우선도 순
  if (mode === "priority_asc" || mode === "priority_desc") {
    const dir = (mode === "priority_desc") ? -1 : 1;
    arr.sort((a, b) => {
      const pa = Number(a?.priority ?? 0);
      const pb = Number(b?.priority ?? 0);
      if (pa !== pb) return (pa - pb) * dir;
      return getEntryName(a).localeCompare(
        getEntryName(b),
        undefined,
        { numeric: true, sensitivity: "base" }
      );
    });
    return arr;
  }
  // 2) 이름순
  if (mode === "name_asc" || mode === "name_desc") {
    arr.sort((a, b) =>
      getEntryName(a).localeCompare(
        getEntryName(b),
        undefined,
        { numeric: true, sensitivity: "base" }
      )
    );
    if (mode === "name_desc") arr.reverse();
    return arr;
  }
  // 3) 추가순
  if (mode === "added_desc") return arr.reverse();
  return arr; // added_asc
}

// 정렬된 BGM 목록에서 파일키만 추출
export function getSortedKeys(preset, sort) {
  return getSortedBgms(preset, sort)
    .map((b) => String(b.fileKey ?? ""))
    .filter(Boolean);
}

// 프리셋에서 특정 파일키의 BGM 찾기
export function findBgmByKey(preset, fileKey) {
  return (preset.bgms ?? []).find((b) => String(b.fileKey ?? "") === String(fileKey ?? ""));
}



/** ========================= 정렬 모드 순환 & 라벨 ========================= */
// 정렬 방식을 순환 (name_asc → name_desc → added_asc → ...)
export function abgmCycleBgmSort(settings) {
  settings.ui ??= {};
  const cur = String(getBgmSort(settings) || "added_asc");
  const i = ABGM_SORT_CYCLE.indexOf(cur);
  const next = ABGM_SORT_CYCLE[(i + 1) % ABGM_SORT_CYCLE.length] || "added_asc";
  // playlist sort만 변경 (Settings 모달 정렬은 건드리지 않음)
  settings.ui.playlistSort = next;
  return next;
}

// 정렬 방식을 사람이 읽기 좋은 이름으로 ("name_asc" → "Name A→Z")
export function abgmSortNice(mode) {
  const m = String(mode || "");
  if (m === "name_asc") return "Name A→Z";
  if (m === "name_desc") return "Name Z→A";
  if (m === "added_asc") return "Added ↑";
  if (m === "added_desc") return "Added ↓";
  if (m === "priority_desc") return "Priority ↓";
  if (m === "priority_asc") return "Priority ↑";
  return m || "Sort";
}

// 정렬 방식 순서 (상수) / NP Glass: Playlist View
const ABGM_SORT_CYCLE = [
  "name_asc",
  "name_desc",
  "added_asc",
  "added_desc",
  "priority_desc",
  "priority_asc",
];



/** ========================= 참조 체크(정리용) ========================= */
// 특정 파일키가 프리셋들에서 참조되는지 체크
export function isFileKeyReferenced(settings, fileKey) {
  for (const p of Object.values(settings.presets)) {
    if (p.defaultBgmKey === fileKey) return true;
    if (p.bgms?.some((b) => b.fileKey === fileKey)) return true;
  }
  return false;
}



/** ========================= SFX 런타임 상태 ========================= */
let _lastSfxSig = "";
let _bgmPausedBySfx = false;
let _sfxOverlayWasOff = false;

export function getLastSfxSig() { return _lastSfxSig; }
export function setLastSfxSig(v) { _lastSfxSig = String(v || ""); }

export function getBgmPausedBySfx() { return _bgmPausedBySfx; }
export function setBgmPausedBySfx(v) { _bgmPausedBySfx = !!v; }

export function getSfxOverlayWasOff() { return _sfxOverlayWasOff; }
export function setSfxOverlayWasOff(v) { _sfxOverlayWasOff = !!v; }

// engine.js에서 import 순환 없이 접근할 수 있도록 전역 등록
window.__abgmStateGetters ??= {};
window.__abgmStateSetters ??= {};
window.__abgmStateGetters.getBgmPausedBySfx = getBgmPausedBySfx;
window.__abgmStateGetters.getSfxOverlayWasOff = getSfxOverlayWasOff;
window.__abgmStateGetters.getLastSfxSig = getLastSfxSig;
window.__abgmStateSetters.setBgmPausedBySfx = setBgmPausedBySfx;
window.__abgmStateSetters.setSfxOverlayWasOff = setSfxOverlayWasOff;
window.__abgmStateSetters.setLastSfxSig = setLastSfxSig;
