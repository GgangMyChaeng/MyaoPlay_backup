import { saveSettingsDebounced } from "./deps.js";



/** ========= IndexedDB Assets =========
 * key: fileKey (예: "neutral_01.mp3")
 * value: Blob(File)
 */
const DB_NAME = "autobgm_db";
const DB_VER = 1;
const STORE_ASSETS = "assets";

/** ========================= IndexedDB: 오디오 파일(Blob) 저장 ========================= */
// IndexedDB 열기 + (최초 1회) objectStore("assets") 없으면 생성
export function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_ASSETS)) db.createObjectStore(STORE_ASSETS);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// key(fileKey)로 Blob 저장(업서트)
export async function idbPut(key, blob) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_ASSETS, "readwrite");
    tx.objectStore(STORE_ASSETS).put(blob, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// key(fileKey)로 Blob 가져오기 (없으면 null)
export async function idbGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_ASSETS, "readonly");
    const req = tx.objectStore(STORE_ASSETS).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

// key(fileKey) 삭제
export async function idbDel(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_ASSETS, "readwrite");
    tx.objectStore(STORE_ASSETS).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}



/** ========================= 이미지 전용 헬퍼 ========================= */
// 이미지 키 생성 (keyOrId: "img_xxx" 또는 "xxx" 둘 다 허용)
export function makeImageKey(keyOrId) {
  const k = String(keyOrId ?? "").trim();
  if (!k) return "";
  return k.startsWith("img_") ? k : `img_${k}`;
}

// 이미지 Blob 저장
export async function idbPutImage(keyOrId, blob) {
  const key = makeImageKey(keyOrId);
  if (!key) return;
  return idbPut(key, blob);
}

// 이미지 Blob 가져오기
export async function idbGetImage(keyOrId) {
  const key = makeImageKey(keyOrId);
  if (!key) return null;
  return idbGet(key);
}

// 이미지 삭제
export async function idbDelImage(keyOrId) {
  const key = makeImageKey(keyOrId);
  if (!key) return;
  return idbDel(key);
}



/** ========================= Settings.assets 보정 (settings.js 안에 비슷한 애 있으니 나중에 하나로 통일 필요) ========================= */
// settings.assets가 없으면 만들고 그 객체를 리턴 (fileKey -> {fileKey,label})
export function ensureAssetList(settings) {
  settings.assets ??= {};
  return settings.assets;
}



/** ========================= IDB Integrity Check ========================= */
// Check if all fileKeys and imageAssetKeys in settings actually exist in IDB
// Returns: { missing: string[], total: number, ok: number }
export async function checkIdbIntegrity(settings) {
  const result = { missing: [], total: 0, ok: 0 };
  const checkedKeys = new Set();
  
  for (const preset of Object.values(settings?.presets ?? {})) {
    for (const bgm of (preset?.bgms ?? [])) {
      const fk = String(bgm?.fileKey ?? "").trim();
      if (fk && !fk.startsWith("http://") && !fk.startsWith("https://") && !checkedKeys.has(fk)) {
        checkedKeys.add(fk);
        result.total++;
        const blob = await idbGet(fk);
        if (blob) {
          result.ok++;
        } else {
          result.missing.push(fk);
        }
      }
      
      const imgKey = String(bgm?.imageAssetKey ?? "").trim();
      if (imgKey && !checkedKeys.has(imgKey)) {
        checkedKeys.add(imgKey);
        result.total++;
        const blob = await idbGet(imgKey);
        if (blob) {
          result.ok++;
        } else {
          result.missing.push(imgKey);
        }
      }
    }
  }
  
  return result;
}

export async function listIdbKeys() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_ASSETS, "readonly");
    const req = tx.objectStore(STORE_ASSETS).getAllKeys();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}



/** ========================= ZIP 임포트 ========================= */
// (내부) JSZip 라이브러리(window.JSZip) 없으면 vendor/jszip.min.js 동적 로딩
async function ensureJSZipLoaded() {
  if (window.JSZip) return window.JSZip;
  const s = document.createElement("script");
  // > modules/ 아래에서 실행되므로 상위 폴더로 한번 올라가야 함
  s.src = new URL("../vendor/jszip.min.js", import.meta.url).toString();
  document.head.appendChild(s);
  await new Promise((resolve, reject) => {
    s.onload = resolve;
    s.onerror = reject;
  });
  return window.JSZip;
}

// ZIP에서 mp3만 골라서:
// 1) IDB에 put, 2) settings.assets에 등록(label은 파일명에서 .mp3 제거), 3) saveSettingsDebounced() 호출
// 그리고 import된 fileKey 배열 리턴
export async function importZip(file, settings) {
  const JSZip = await ensureJSZipLoaded();
  const zip = await JSZip.loadAsync(file);
  const assets = ensureAssetList(settings);
  const importedKeys = [];
  const entries = Object.values(zip.files).filter(
    (f) => !f.dir && f.name.toLowerCase().endsWith(".mp3")
  );
  for (const entry of entries) {
    const blob = await entry.async("blob");
    const fileKey = entry.name.split("/").pop(); // > 폴더 제거
    await idbPut(fileKey, blob);
    assets[fileKey] = { fileKey, label: fileKey.replace(/\.mp3$/i, "") };
    importedKeys.push(fileKey);
  }
  saveSettingsDebounced();
  return importedKeys;
}



/** ========================= 오디오 메타데이터 ========================= */
// Blob을 <audio>에 물려서 duration(초)만 뽑아오기 (실패/비정상이면 0)
export async function abgmGetDurationSecFromBlob(blob) {
  return new Promise((resolve) => {
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    const url = URL.createObjectURL(blob);
    audio.onloadedmetadata = () => {
      const sec = audio.duration;
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(sec) ? sec : 0);
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(0);
    };
    audio.src = url;
  });
}



/** ========================= 프리소스 → 마이소스/프리셋 복사 ========================= */
// 마이소스에 새 항목 추가 (중복 허용)
export function addToMySources(settings, item) {
  settings.mySources ??= [];
  const newItem = {
    id: `my_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,6)}`,
    src: item.src || "",
    title: item.title || item.name || "Untitled",
    durationSec: item.durationSec || 0,
    tags: Array.isArray(item.tags) ? [...item.tags] : [],
    license: item.license || "",
  };
  settings.mySources.push(newItem);
  return newItem;
}

// 프리셋의 bgms 배열에 새 BGM 항목 추가 (URL 기반)
export function addUrlToPreset(settings, presetId, item) {
  const preset = settings?.presets?.[presetId];
  if (!preset) return null;
  preset.bgms ??= [];
  const newBgm = {
    id: `${Date.now().toString(36)}_${Math.random().toString(36).slice(2,6)}`,
    fileKey: item.src || "",   // URL을 fileKey로 사용
    name: item.title || item.name || "Untitled",
    keywords: "",
    priority: 0,
    volume: 1.0,
    volLocked: false,
    license: item.license || "",
    lyrics: "",
    imageUrl: "",
    imageAssetKey: "",
  };
  preset.bgms.push(newBgm);
  return newBgm;
}
