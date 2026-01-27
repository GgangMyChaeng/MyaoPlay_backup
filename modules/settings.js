// > 설정 스키마/기본값/마이그레이션 전담

import { extension_settings, saveSettingsDebounced } from "./deps.js";
import { idbPut } from "./storage.js";
import { clone } from "./utils.js";



/** ========================= 저장소 키 & 공용 헬퍼 ========================= */
// extension_settings에서 MyaoPlay(Autobgm) 설정을 꺼낼 때 쓰는 키
export const SETTINGS_KEY = "autobgm";

// settings.assets가 항상 "배열 + 안전한 필드들" 형태가 되게 보정
function ensureAssetList(settings) {
  settings.assets ??= {};
  return settings.assets;
}

// 프리셋/트랙/파일키 등에 붙일 간단 uid 생성기
function uid() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}



/** ========================= 엔진 기본 필드 보정 ========================= */
// 엔진이 기대하는 런타임 필드들(playMode/volume/상태 저장용 객체 등)을 기본값으로 채움
export function ensureEngineFields(settings) {
  settings.playMode ??= "manual";
  settings.chatStates ??= {};     // 1) { [chatKey]: { currentKey, listIndex } }
  settings.presetBindings ??= {}; // 2) (나중에 캐릭-프리셋 매칭용)
  // 3) 구버전 보정
  for (const k of Object.keys(settings.chatStates)) {
    const st = settings.chatStates[k] || (settings.chatStates[k] = {});
    st.currentKey ??= "";
    st.listIndex ??= 0;
    st.lastSig ??= "";
    st.defaultPlayedSig ??= "";
    st.prevKey ??= "";
  }
}



/** ====================== 프리셋 Import/Export ====================== */
// 프리셋을 파일로 내보내기 좋게 { filename, json } 형태로 패키징
export function exportPresetFile(preset) {
  const clean = {
    id: preset.id,
    name: preset.name,
    defaultBgmKey: preset.defaultBgmKey ?? "",
    bgms: (preset.bgms ?? []).map((b) => ({
      id: b.id,
      fileKey: b.fileKey ?? "",
      name: b.name ?? "",
      keywords: b.keywords ?? "",
      priority: Number(b.priority ?? 0),
      volume: Number(b.volume ?? 1),
      type: (String(b.type ?? "BGM").toUpperCase() === "SFX") ? "SFX" : "BGM",
      volLocked: !!b.volLocked,
      license: b.license ?? "",
      lyrics: b.lyrics ?? "",
      imageUrl: b.imageUrl ?? "",
      imageAssetKey: b.imageAssetKey ?? "",
    })),
  };
  return {
    type: "autobgm_preset",
    version: 4,
    exportedAt: new Date().toISOString(),
    preset: clean,
  };
}

// 임포트된 프리셋의 id/fileKey들을 전부 새로 발급해서 "기존 거랑 충돌" 방지
export function rekeyPreset(preset) {
  const p = clone(preset);
  p.id = uid();
  p.name = (p.name && String(p.name).trim()) ? p.name : "Imported Preset";
  p.defaultBgmKey ??= "";
  p.bgms = (p.bgms ?? []).map((b) => ({
    id: uid(),
    fileKey: b.fileKey ?? "",
    name: b.name ?? "", // 1) 엔트리 이름 복원
    keywords: b.keywords ?? "",
    priority: Number(b.priority ?? 0),
    volume: Number(b.volume ?? 1),
    type: (String(b.type ?? "BGM").toUpperCase() === "SFX") ? "SFX" : "BGM",
    volLocked: !!b.volLocked,
    license: b.license ?? "",
    lyrics: b.lyrics ?? "",
    imageUrl: b.imageUrl ?? "",
    imageAssetKey: "",
  }));
  if (p.defaultBgmKey === undefined && p.bgms.length && p.bgms[0].fileKey) {
    p.defaultBgmKey = p.bgms[0].fileKey;
  }
  // 2) defaultBgmKey가 bgms에 실제로 존재하는지 보정
  if (p.defaultBgmKey && !p.bgms.some(b => b.fileKey === p.defaultBgmKey)) {
    p.defaultBgmKey = p.bgms[0]?.fileKey ?? "";
  }
  return p;
}

// JSON에서 프리셋 데이터 추출 (v3 형식 or 구형 전체 설정)
export function pickPresetFromImportData(data) {
  if (data?.type === "autobgm_preset" && data?.preset) return data.preset;
  // > (구형 전체 설정 파일) 들어오면 activePreset 하나만 뽑아서 import
  if (data?.presets && typeof data.presets === "object") {
    const pid =
      data.activePresetId && data.presets[data.activePresetId]
        ? data.activePresetId
        : Object.keys(data.presets)[0];
    return data.presets?.[pid] ?? null;
  }
  return null;
}



/** ========================= 설정 부팅(ensure) & 마이그레이션 ========================= */
// extension_settings에서 설정을 꺼내고, 없으면 기본 프리셋까지 만들어 “완성된 settings”를 보장
export function ensureSettings() {
  extension_settings[SETTINGS_KEY] ??= {
    enabled: true,
    keywordMode: true,
    debugMode: false,
    globalVolume: 0.7,
    globalVolLocked: false,
    keywordOnce: false,
    useDefault: true,
    activePresetId: "default",
    presets: {
      default: {
        id: "default",
        name: "Default",
        defaultBgmKey: "",
        bgms: [],
      },
    },
    assets: {},
    chatStates: {},
    ui: { presetSort: "added_asc", playlistSort: "added_asc" },
    settingsActiveTab: 'main',
    floating: {
      enabled: false,
      x: null,
      y: null,
    },
    keywordSubMode: "matching",
    recommendMode: {
  provider: "spotify",
  cooldownSec: 60,
  stopOnEnter: true,
  spotify: {
    accessToken: null,
    refreshToken: null,
    expiresAt: null,
  }
},
activeRecPromptPresetId: "default",
recPromptPresets: {
  default: {
    id: "default",
    name: "Default",
    content: `# Music Recommendation Prompt (Auxiliary)

## Purpose
This instruction applies ONLY to optional background music recommendation.
It must NOT affect roleplay, narration, dialogue, tone, style, or decision-making.

When and only when you judge that a background music change would meaningfully
enhance the current scene’s mood or atmosphere,
you MAY output a music search query using the token format below.

If no music change is appropriate, do NOT output anything related to music.

IMPORTANT:
- Treat music recommendation as a side-channel signal only.
- Do NOT alter or interfere with the main response in any way.
- Do NOT mention music, recommendation, or this instruction in the narrative.

## Token Format (STRICT)
[MP_REC_QUERY: your search query here]

## Rules
- Output the token as a STANDALONE LINE.
- Output at most ONE token per message.
- The search query must be 2–6 words describing mood/genre/style.
- Do NOT include artist names, song titles, or years.
- Do NOT include quotes inside the query.

## Output Structure
1) [Other system or metadata tags if already required elsewhere]
   (Single Line Break)
2) [MP_REC_QUERY: query]  ← only if recommending music
   (Single Line Break)
3) Narrative / roleplay content

## Examples

### Example A (with recommendation)
[MP_REC_QUERY: tense orchestral suspense]

The shadow crept closer.

### Example B (no recommendation)
She smiled softly and continued reading.

## Query Style Tips
- Focus on MOOD: tense, calm, romantic, eerie, energetic, melancholic
- Add GENRE hints: ambient, jazz, classical, electronic, lo-fi, orchestral
- Add TEXTURE if useful: piano, strings, synth, acoustic, no vocals
- Keep it simple and searchable
`
  }
},
    kwPromptPresets: {
      default: {
        id: "default",
        name: "Default",
        content: `# Mya Prompt for AI

## Goal
- If an appropriate keyword exists, output EXACTLY ONE token in the format {{🎤🐱:keyword}}
- The token must appear ONLY as a standalone line, NOT inside the narrative text.

## Output Format (STRICT)
Your entire message must follow this structure:

1) other tags (Exists ONLY if needed)
(Single Line Break)
2) {{🎤🐱:keyword}}  (ONLY if you decided to output a keyword; must be a single standalone line)
(Single Line Break)
3) Narrative content (all story text goes here)

### Rules
- NEVER place {{🎤🐱:keyword}} inside the narrative content.
- NEVER output the token more than once.
- If you output the token, it must be exactly one standalone line (no extra text on that line).
- If nothing fits, or if the same fitting keyword appeared 1–2 times recently, do NOT output the token at all.
- If you do NOT output the token, then omit section (2) entirely and write:
  (optional other tags line if needed)
  (Single Line Break)
  Narrative content
- The keyword must be chosen ONLY from "Available Keywords".
- Do not invent keywords. Do not modify keywords. Use them as-is (case/spacing preserved if possible).

## Token Format
- Format: {{🎤🐱:keyword}}

## Available Keywords
{{mya_k}}

## Quick Examples
Example A (with keyword):
[any other tags if needed]
(Single Line Break)
{{🎤🐱:night}}
(Single Line Break)
(Narrative Content starts here... no 'mya' token inside)
Example B (without keyword):
[any other tags if needed]
(Single Line Break)
(Narrative Content starts here... no 'mya' token anywhere)`
      }
    },
    activeKwPromptPresetId: "default",
    // Time Mode 기본 설정
    timeMode: {
      enabled: false,
      source: "token",       // "token" | "realtime"
      scheme: "day4",        // "day4" | "ampm2"
      day4: [
        { id: "morning", keywords: "아침, Morning, dawn",   start: "05:00", end: "10:59" },
        { id: "day",     keywords: "낮, Daytime, noon",     start: "11:00", end: "16:59" },
        { id: "evening", keywords: "저녁, Evening, sunset", start: "17:00", end: "20:59" },
        { id: "night",   keywords: "밤, Night, midnight",   start: "21:00", end: "04:59" }
      ],
      ampm2: [
        { id: "am", keywords: "오전, AM, morning", start: "00:00", end: "11:59" },
        { id: "pm", keywords: "오후, PM, afternoon", start: "12:00", end: "23:59" }
      ]
    },
    // SFX Mode 기본 설정
    sfxMode: {
      overlay: true,        // true: BGM 위에 겹쳐 재생, false: BGM 일시정지 후 재생
      skipInOtherModes: true, // 키워드 모드 아닐 때 SFX 타입 곡 건너뛰기
    },
    // TTS Mode 기본 설정
    ttsMode: {
      enabled: false,
      autoPlay: true,
      provider: "qwen", // 'qwen', 'elevenlabs' 등
      providers: {
        qwen: {
          apiKey: "",
          model: "qwen3-tts-flash",
          voice: "Cherry",
        },
        elevenlabs: {
          apiKey: "",
          voiceId: "21m00Tcm4TlvDq8ikWAM", // 예시: Rachel
        }
      }
    },
  };
  const s = extension_settings[SETTINGS_KEY];
  s.globalVolLocked ??= false;
  s.keywordOnce ??= false;
  ensureEngineFields(s);
  s.ui ??= { presetSort: "added_asc", playlistSort: "added_asc" };
  // 구버전 마이그레이션: ui.bgmSort 하나만 있던 시절 값 → 둘 다로 복제
  if (s.ui.bgmSort && (!s.ui.presetSort || !s.ui.playlistSort)) {
    s.ui.presetSort ??= s.ui.bgmSort;
    s.ui.playlistSort ??= s.ui.bgmSort;
  }
  s.ui.presetSort ??= "added_asc";
  s.ui.playlistSort ??= "added_asc";
  s.floating ??= { enabled: false, x: null, y: null };
  s.floating.enabled ??= false;
  // > ensureSettings 프리소스
  s.freeSources ??= [];
  s.mySources ??= [];
  // > FreeSources UI state
  s.fsUi ??= { tab: "free", selectedTags: [], tagInclude: [], tagExclude: [], search: "" };
  // 구버전 마이그레이션: selectedTags -> tagInclude
  if (!Array.isArray(s.fsUi.tagInclude) || !s.fsUi.tagInclude.length) {
    s.fsUi.tagInclude = Array.isArray(s.fsUi.selectedTags) ? [...s.fsUi.selectedTags] : [];
  }
  if (!Array.isArray(s.fsUi.tagExclude)) s.fsUi.tagExclude = [];
  // 레거시 호환: selectedTags는 "include"랑 동기화해서 남겨둠
  if (!Array.isArray(s.fsUi.selectedTags)) s.fsUi.selectedTags = [...s.fsUi.tagInclude];
  s.fsUi.cat ??= "all";
  s.fsUi.previewVolFree ??= 60; // 0~100
  s.fsUi.previewVolMy ??= 60;   // 0~100
  s.fsUi.previewVolLockFree ??= false;
  s.fsUi.previewVolLockMy ??= false;
  // > 안전장치
  if (!s.presets || Object.keys(s.presets).length === 0) {
    s.presets = {
      default: { id: "default", name: "Default", defaultBgmKey: "", bgms: [] },
    };
  s.activePresetId = "default";
  }
  if (!s.presets[s.activePresetId]) s.activePresetId = Object.keys(s.presets)[0];
  ensureAssetList(s);
  s.chatStates ??= {};
  s.debugMode ??= false;
  // > 키워드 서브모드 보정
  if (!["matching", "token", "hybrid", "recommend"].includes(s.keywordSubMode)) {
    s.keywordSubMode = "matching";
  }
  // > 추천 모드 보정
  s.recommendMode ??= {};
  s.recommendMode.provider ??= "spotify";
  s.recommendMode.cooldownSec ??= 60;
  s.recommendMode.stopOnEnter ??= true;
  s.recommendMode.spotify ??= {};
  // ===== 프롬프트 프리셋(kw/rec) 번들 갱신 정책 =====
  // - Default는 업데이트 때 자동 갱신
  // - 유저 프리셋은 절대 삭제/초기화 안 함
  // - 유저가 Default를 수정해놨으면 백업을 만들어주고 덮어씀
  const PROMPT_PRESET_BUNDLE_REV = 1; // 기본 프롬프트 바꿀 때마다 숫자 올려야 함
  const DEFAULT_REC_PROMPT_CONTENT = `# Music Recommendation Prompt (Auxiliary)

## Purpose
This instruction applies ONLY to optional background music recommendation.
It must NOT affect roleplay, narration, dialogue, tone, style, or decision-making.

When and only when you judge that a background music change would meaningfully
enhance the current scene’s mood or atmosphere,
you MAY output a music search query using the token format below.

If no music change is appropriate, do NOT output anything related to music.

IMPORTANT:
- Treat music recommendation as a side-channel signal only.
- Do NOT alter or interfere with the main response in any way.
- Do NOT mention music, recommendation, or this instruction in the narrative.

## Token Format (STRICT)
[MP_REC_QUERY: your search query here]

## Rules
- Output the token as a STANDALONE LINE.
- Output at most ONE token per message.
- The search query must be 2–6 words describing mood/genre/style.
- Do NOT include artist names, song titles, or years.
- Do NOT include quotes inside the query.

## Output Structure
1) [Other system or metadata tags if already required elsewhere]
   (Single Line Break)
2) [MP_REC_QUERY: query]  ← only if recommending music
   (Single Line Break)
3) Narrative / roleplay content

## Examples

### Example A (with recommendation)
[MP_REC_QUERY: tense orchestral suspense]

The shadow crept closer.

### Example B (no recommendation)
She smiled softly and continued reading.

## Query Style Tips
- Focus on MOOD: tense, calm, romantic, eerie, energetic, melancholic
- Add GENRE hints: ambient, jazz, classical, electronic, lo-fi, orchestral
- Add TEXTURE if useful: piano, strings, synth, acoustic, no vocals
- Keep it simple and searchable
`;

  const DEFAULT_KW_PROMPT_CONTENT = `# Mya Prompt for AI

## Goal
- If an appropriate keyword exists, output EXACTLY ONE token in the format {{🎤🐱:keyword}}
- The token must appear ONLY as a standalone line, NOT inside the narrative text.

## Output Format (STRICT)
Your entire message must follow this structure:
1) other tags (Exists ONLY if needed)
(Single Line Break)
2) {{🎤🐱:keyword}}  (ONLY if you decided to output a keyword; must be a single standalone line)
(Single Line Break)
3) Narrative content (all story text goes here)

### Rules
- NEVER place {{🎤🐱:keyword}} inside the narrative content.
- NEVER output the token more than once.
- If you output the token, it must be exactly one standalone line (no extra text on that line).
- If nothing fits, or if the same fitting keyword appeared 1–2 times recently, do NOT output the token at all.
- If you do NOT output the token, then omit section (2) entirely and write:
  (optional other tags line if needed)
  (Single Line Break)
  Narrative content
- The keyword must be chosen ONLY from "Available Keywords".
- Do not invent keywords. Do not modify keywords. Use them as-is (case/spacing preserved if possible).

## Token Format
- Format: {{🎤🐱:keyword}}

## Available Keywords
{{mya_k}}

## Quick Examples
Example A (with keyword):
[any other tags if needed]
(Single Line Break)
{{🎤🐱:night}}
(Single Line Break)
(Narrative Content starts here... no 'mya' token inside)
Example B (without keyword):
[any other tags if needed]
(Single Line Break)
(Narrative Content starts here... no 'mya' token anywhere)`;
  function _backupPreset(presets, label, content) {
    const id = `backup_${uid()}`;
    presets[id] = { id, name: label, content };
    return id;
  }
  s.promptPresetBundleRev ??= 0;
  const needRefreshDefaultPrompts = s.promptPresetBundleRev < PROMPT_PRESET_BUNDLE_REV;
  // ===== 추천 프롬프트 프리셋 보정 + Default 갱신 =====
  s.recPromptPresets ??= {};
  if (!s.recPromptPresets.default) {
    s.recPromptPresets.default = { id: "default", name: "Default", content: DEFAULT_REC_PROMPT_CONTENT };
  } else if (needRefreshDefaultPrompts) {
    const cur = String(s.recPromptPresets.default.content ?? "");
    if (cur && cur !== DEFAULT_REC_PROMPT_CONTENT) {
      _backupPreset(s.recPromptPresets, `Default (backup)`, cur);
    }
    s.recPromptPresets.default.content = DEFAULT_REC_PROMPT_CONTENT;
  }
  s.activeRecPromptPresetId ??= (s.recPromptPresets.default ? "default" : (Object.keys(s.recPromptPresets)[0] || "default"));
  if (!s.recPromptPresets[s.activeRecPromptPresetId]) {
    s.activeRecPromptPresetId = s.recPromptPresets.default ? "default" : (Object.keys(s.recPromptPresets)[0] || "default");
  }
  // ===== 키워드 프롬프트 프리셋 보정 + Default 갱신 =====
  s.kwPromptPresets ??= {};
  if (!s.kwPromptPresets.default) {
    s.kwPromptPresets.default = { id: "default", name: "Default", content: DEFAULT_KW_PROMPT_CONTENT };
  } else if (needRefreshDefaultPrompts) {
    const cur = String(s.kwPromptPresets.default.content ?? "");
    if (cur && cur !== DEFAULT_KW_PROMPT_CONTENT) {
      _backupPreset(s.kwPromptPresets, `Default (backup)`, cur);
    }
    s.kwPromptPresets.default.content = DEFAULT_KW_PROMPT_CONTENT;
  }
  s.activeKwPromptPresetId ??= (s.kwPromptPresets.default ? "default" : (Object.keys(s.kwPromptPresets)[0] || "default"));
  if (!s.kwPromptPresets[s.activeKwPromptPresetId]) {
    s.activeKwPromptPresetId = s.kwPromptPresets.default ? "default" : (Object.keys(s.kwPromptPresets)[0] || "default");
  }
  // 마지막에 리비전 기록 (다음 부팅부터 “갱신 필요 없음” 상태)
  s.promptPresetBundleRev = PROMPT_PRESET_BUNDLE_REV;
  // > Time Mode 보정
  s.timeMode ??= {};
  s.timeMode.enabled ??= false;
  s.timeMode.source ??= "token";
  s.timeMode.scheme ??= "day4";
  // day4 기본값
  if (!Array.isArray(s.timeMode.day4) || s.timeMode.day4.length !== 4) {
    s.timeMode.day4 = [
      { id: "morning", keywords: "아침, Morning, dawn",   start: "05:00", end: "10:59" },
      { id: "day",     keywords: "낮, Daytime, noon",     start: "11:00", end: "16:59" },
      { id: "evening", keywords: "저녁, Evening, sunset", start: "17:00", end: "20:59" },
      { id: "night",   keywords: "밤, Night, midnight",   start: "21:00", end: "04:59" }
    ];
  }
  // ampm2 기본값
  if (!Array.isArray(s.timeMode.ampm2) || s.timeMode.ampm2.length !== 2) {
    s.timeMode.ampm2 = [
      { id: "am", keywords: "오전, AM, morning", start: "00:00", end: "11:59" },
      { id: "pm", keywords: "오후, PM, afternoon", start: "12:00", end: "23:59" }
    ];
  }
  // SFX Mode 보정
  s.sfxMode ??= {};
  s.sfxMode.overlay ??= true;
  s.sfxMode.skipInOtherModes ??= true;
  // TTS Mode 보정
  s.ttsMode ??= {};
  s.ttsMode.enabled ??= false;
  s.ttsMode.autoPlay ??= true;
  s.ttsMode.provider ??= "qwen";
  s.ttsMode.providers ??= {};
  s.ttsMode.providers.qwen ??= { model: "qwen3-tts-flash", apiKey: "", voice: "Cherry" };
  // 구버전 마이그레이션: 최상위 qwen 설정을 providers.qwen으로 이동
  if (s.ttsMode.qwen) {
    s.ttsMode.providers.qwen = { ...s.ttsMode.providers.qwen, ...s.ttsMode.qwen };
    delete s.ttsMode.qwen;
  }
  // > 프리셋/곡 스키마 보정 + 구버전 변환
  Object.values(s.presets).forEach((p) => {
    p.defaultBgmKey ??= "";
    p.bgms ??= [];
    // > 구버전: preset.defaultBgmId가 있으면 -> defaultBgmKey로 변환
    if (p.defaultBgmId && !p.defaultBgmKey) {
      const hit = p.bgms.find((b) => b.id === p.defaultBgmId);
      if (hit?.fileKey) p.defaultBgmKey = hit.fileKey;
      else if (hit?.name) p.defaultBgmKey = `${hit.name}.mp3`;
      delete p.defaultBgmId;
    }
    // > bgm들 스키마 보정
    p.bgms.forEach((b) => {
      b.id ??= uid();
      if (!b.fileKey) {
        if (b.name) b.fileKey = `${b.name}.mp3`;
        else b.fileKey = "";
      }
      b.keywords ??= "";
      b.priority ??= 0;
      b.volume ??= 1.0;
      b.volLocked ??= false;
      b.license ??= "";
      b.lyrics ??= "";
      b.imageUrl ??= "";
      b.imageAssetKey ??= "";
      b.type ??= "BGM";  // "BGM" | "SFX"
    });
  });
  // > 구버전: settings.defaultBgmId 같은 전역 값 남아있으면 제거 (있어도 안 쓰게)
  if (s.defaultBgmId) delete s.defaultBgmId;
  return s;
} // ensureSettings 닫기

let _legacyMigrated = false;

// (구형) dataUrl로 박혀있던 오디오를 IDB로 옮기고 url을 idb:... 형태로 마이그레이션
export async function migrateLegacyDataUrlsToIDB(settings) {
  if (_legacyMigrated) return;
  _legacyMigrated = true;
  let changed = false;
  const assets = ensureAssetList(settings);
  for (const p of Object.values(settings.presets)) {
    for (const b of p.bgms) {
      if (b.dataUrl && b.fileKey) {
        try {
          const blob = await (await fetch(b.dataUrl)).blob();
          await idbPut(b.fileKey, blob);
          assets[b.fileKey] = { fileKey: b.fileKey, label: b.fileKey.replace(/\.mp3$/i, "") };
          delete b.dataUrl;
          changed = true;
        } catch (e) {
          console.warn("[MyaPl] legacy dataUrl migrate failed:", b.fileKey, e);
        }
      }
    }
  }
  if (changed) {
    try { saveSettingsDebounced?.(); } catch {}
  }
}



/** ========================= 매크로 헬퍼 함수 ========================= */
// 현재 활성 프리셋의 모든 키워드를 중복 제거하여 반환
export function getAllKeywordsFromActivePreset(settings) {
  const preset = settings?.presets?.[settings?.activePresetId];
  if (!preset?.bgms?.length) return [];
  const seen = new Set();
  const keywords = [];
  for (const bgm of preset.bgms) {
    const kwStr = String(bgm.keywords ?? "");
    const kws = kwStr.split(/[,\n]+/).map(k => k.trim()).filter(Boolean);
    for (const kw of kws) {
      const lower = kw.toLowerCase();
      if (!seen.has(lower)) {
        seen.add(lower);
        keywords.push(kw);
      }
    }
  }
  return keywords;
}

// {{mya_p}} 매크로용: 현재 프롬프트 프리셋의 내용 반환 (토큰/하이브리드 모드가 아니면 빈 문자열)
export function getActivePromptContent(settings) {
  const subMode = settings?.keywordSubMode || "matching";
  // matching 모드면 프롬프트 출력 안 함
  if (subMode === "matching") return "";
  
  const promptPreset = settings?.kwPromptPresets?.[settings?.activeKwPromptPresetId];
  if (!promptPreset?.content) return "";
  
  // {{mya_k}}를 키워드 목록으로 치환
  const keywords = getAllKeywordsFromActivePreset(settings);
  const kwString = keywords.join(", ");
  
  return promptPreset.content.replace(/\{\{mya_k\}\}/gi, kwString);
}
