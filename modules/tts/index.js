/**
 * MyaoPlay TTS Hub (v2 skeleton)
 * - 목표: provider 늘어나도( Qwen / OpenAI / Gemini ) 코드가 엉키지 않게 “진입점 1개”로 고정
 * - 규칙: 기존 동작(현재 Qwen 단발 재생) 절대 바꾸지 말고, 여기서는 “추가 레이어”만 만든다
 *
 * ✅ 이 파일은 일부러 “좀 길게” 만든다
 *    - ARCHITECTURE: 1파일 최소 400-600줄 정도 권장, 20줄이나 200줄 이딴 모듈 난사 금지
 *    - 그래서 parser/player/mode 뼈대는 여기서 시작하고,
 *      나중에 커지면 그때만 tts_player.js / tts_parser.js로 ‘큰 덩어리’ 단위로 분리
 */

import { getSTContextSafe } from "../deps.js";
import { providers as ttsProviders } from "./providers/index.js";

/** ============================================================================
 * Public API
 * ========================================================================== */

/**
 * speakLastAssistant(settings)
 * - 이미 해둔 “마지막 AI 메시지 읽기”를 이 허브에서 표준화
 * - UI/엔진 어디서든 이 함수만 부르면 되게 만들기
 */
export async function speakLastAssistant(settings = {}) {
  const ctx = getSTContextSafe();
  const text = _extractLastAssistantText(ctx);
  if (!text) return null;
  return await speakText(text, settings);
}



/**
 * speakText(text, settings)
 * - text: 읽을 원문
 * - settings: { providerId, mode, qwen:{...}, openai:{...}, gemini:{...}, ... }
 *
 * 지금은 “All 단발 재생” 중심으로만 동작하도록 구현
 * (DialogueOnly/Segment는 TODO로 껍데기만 잡아둠)
 */
export async function speakText(text, settings = {}) {
  const s = _normalizeSettings(settings);
  // 1) 텍스트 전처리
  const parsed = _parseText(text, s);
  // 2) 모드별로 읽을 텍스트 리스트 만들기 (큐)
  const chunks = _buildChunksByMode(parsed, s);
  // 3) 600자 제한 대응(기본) - 너무 긴 텍스트는 잘라서 여러 번 호출
  const safeChunks = _splitChunksForLimit(chunks, s);
  // 4) provider에 보내서 audioUrl 리스트 만들기
  const urls = [];
  for (const chunk of safeChunks) {
    if (!chunk?.text) continue;
    const url = await _requestAudioUrl(chunk.text, s);
    if (url) urls.push(url);
  }
  // 5) 재생 (지금은 단순 큐 재생)
  await _playQueue(urls, s);
  return urls;
}

/**
 * stop()
 * - 지금은 단순 재생 중지
 * - 나중에 player가 커지면 여기서 player.stop()로 교체
 */
export function stop() {
  _stopPlayback();
}



/** ============================================================================
 * Settings normalize
 * ========================================================================== */

function _normalizeSettings(settings) {
  // providerId는 일단 qwen 기본
  const providerId = settings.providerId || settings.provider || "qwen";
  // mode: all / dialogueOnly / segment
  const mode = settings.mode || "all";
  // provider별 세부 설정은 settings.<providerId>에 넣는 형태로 가자
  // 예: settings.qwen = { apiKey, model, voice, languageType }
  //     settings.openai = { apiKey, model, voice, instructions }
  //     settings.gemini = { apiKey, voice, stylePrompt }
  return {
    providerId,
    mode,
    // 공통
    maxCharsPerRequest: settings.maxCharsPerRequest || 600,
    // “전처리 강도”
    removeMarkdown: settings.removeMarkdown !== false,
    removeEmoji: settings.removeEmoji !== false,
    // Qwen/OpenAI/Gemini 등 provider 섹션
    qwen: settings.qwen || settings.qwenSettings || {},
    openai: settings.openai || settings.openaiSettings || {},
    gemini: settings.gemini || settings.geminiSettings || {},
    // (옵션) 디버그
    debug: !!settings.debug,
  };
}

/** ============================================================================
 * Text parsing
 * - 여기서 하는 일: “원문 -> 깨끗한 텍스트 + 대사 배열 + (나중에) 세그먼트”
 * ========================================================================== */

function _parseText(rawText, s) {
  let text = String(rawText || "");
  // 1) 기본 클린업
  if (s.removeMarkdown) text = _stripMarkdown(text);
  if (s.removeEmoji) text = _stripEmoji(text);
  // 2) *지문* 제거(아직은 기존 규칙 존중: 별표 감싼 구간)
  //    나중에 “지문은 나레이터로 읽기”로 바꿀 때 여기에서 분리하면 됨
  text = text.replace(/\*[^*]+\*/g, " ");
  // 3) 공백 정리
  text = text.replace(/\s+/g, " ").trim();
  // 4) 대사만 추출(임시: "..." 따옴표 기반)
  const dialogues = _extractQuotedDialogues(text);
  return {
    raw: String(rawText || ""),
    cleaned: text,
    dialogues,
    // TODO: segment 모드용 구조(지문/대사 분리) 여기서 만들면 됨
    segments: null,
  };
}

function _buildChunksByMode(parsed, s) {
  // chunk 형태 통일: { text, meta? }
  if (s.mode === "dialogueOnly") {
    // 대사만 있는 경우만 큐
    return (parsed.dialogues || []).map((t) => ({ text: t, meta: { kind: "dialogue" } }));
  }
  if (s.mode === "segment") {
    // TODO: 지문/대사 분리해서 UI로 넘기는 구조
    // 지금은 임시로 all처럼 처리 (동작은 바꾸지 않기 위해)
    return [{ text: parsed.cleaned, meta: { kind: "all" } }];
  }
  // default: all
  return [{ text: parsed.cleaned, meta: { kind: "all" } }];
}

/** ============================================================================
 * Request split for length (600 char rule)
 * - 원칙: “600자 넘어가면 분할”
 * - 지금은 단순 기준으로만 자르고, 나중에 문장 단위로 쪼개는 고급 버전 추가 가능
 * ========================================================================== */

function _splitChunksForLimit(chunks, s) {
  const max = Math.max(50, Number(s.maxCharsPerRequest || 600));
  const out = [];
  for (const c of chunks) {
    const t = String(c?.text || "");
    if (!t) continue;
    if (t.length <= max) {
      out.push(c);
      continue;
    }
    // 너무 긴 경우: 그냥 max 단위로 잘라서 넣기
    for (let i = 0; i < t.length; i += max) {
      const slice = t.slice(i, i + max).trim();
      if (slice) out.push({ text: slice, meta: { ...c.meta, split: true } });
    }
  }
  return out;
}

/** ============================================================================
 * Provider dispatch
 * ========================================================================== */

async function _requestAudioUrl(text, s) {
  const providerId = s.providerId;
  const provider = ttsProviders?.[providerId];
  if (!provider?.getAudioUrl) {
    throw new Error(`[MyaPl][TTS] Unknown provider: ${providerId}`);
  }
  // providerSettings: 기존 코드 스타일 유지
  // - Qwen은 settings.qwen 사용
  // - OpenAI/Gemini도 같은 패턴으로 settings.openai / settings.gemini에 넣을 것
  let providerSettings = {};
  if (providerId === "qwen") providerSettings = s.qwen;
  else if (providerId === "openai") providerSettings = s.openai;
  else if (providerId === "gemini") providerSettings = s.gemini;
  else providerSettings = s[providerId] || {};
  if (s.debug) {
    console.log("[MyaPl][TTS] provider:", providerId, "textPreview:", String(text).slice(0, 80));
  }
  return await provider.getAudioUrl(text, providerSettings);
}



/** ============================================================================
 * Minimal player (queue)
 * - 지금은 Audio 태그로 단순 재생
 * - 나중에 Segment UI / stop / fade / interrupt 같은 요구 생기면 여기 확장
 * ========================================================================== */

let _audio = null;
let _queue = [];
let _playing = false;

async function _playQueue(urls, s) {
  if (!Array.isArray(urls) || urls.length === 0) return;
  _stopPlayback();
  _queue = [...urls];
  _playing = true;
  await _playNext(s);
}

async function _playNext(s) {
  if (_queue.length === 0) {
    _playing = false;
    return;
  }
  const url = _queue.shift();
  _audio = new Audio(url);
  _audio.onended = () => {
    _playNext(s);
  };
  _audio.onerror = (e) => {
    console.warn("[MyaPl][TTS] audio error:", e);
    _playNext(s);
  };
  try {
    await _audio.play();
  } catch (e) {
    console.warn("[MyaPl][TTS] play() failed:", e);
    _playNext(s);
  }
}

function _stopPlayback() {
  try {
    if (_audio) {
      _audio.pause();
      _audio.src = "";
    }
  } catch {}
  _audio = null;
  _queue = [];
  _playing = false;
}



/** ============================================================================
 * ST helper: last assistant message
 * ========================================================================== */

function _extractLastAssistantText(ctx) {
  try {
    const chat = ctx?.chat;
    if (!Array.isArray(chat) || chat.length === 0) return "";
    // 뒤에서부터 assistant 찾기
    for (let i = chat.length - 1; i >= 0; i--) {
      const m = chat[i];
      if (!m) continue;
      const role = m.role || m.author || m.name;
      if (role === "assistant") {
        const content = m.mes ?? m.content ?? m.text ?? "";
        return String(content || "").trim();
      }
    }
    return "";
  } catch {
    return "";
  }
}



/** ============================================================================
 * Text utils (keep in-file for now)
 * - 너무 잘게 파일 쪼개면 깡통 머리부터 쪼갤 거임
 * ========================================================================== */

function _stripMarkdown(text) {
  let t = String(text || "");
  // 코드블록 제거(대충)
  t = t.replace(/```[\s\S]*?```/g, " ");
  // 인라인 코드
  t = t.replace(/`([^`]+)`/g, "$1");
  // 굵게/기울임
  t = t.replace(/\*\*([^*]+)\*\*/g, "$1");
  t = t.replace(/\*([^*]+)\*/g, "$1");
  t = t.replace(/__([^_]+)__/g, "$1");
  t = t.replace(/_([^_]+)_/g, "$1");
  // 링크 [text](url) -> text
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1");
  // 헤더/리스트 마커 간단 제거
  t = t.replace(/^\s{0,3}#{1,6}\s+/gm, "");
  t = t.replace(/^\s*[-*+]\s+/gm, "");
  return t;
}

function _stripEmoji(text) {
  // “완벽한 이모지 제거”는 지옥이라, 일단 범용 범위로만
  return String(text || "").replace(/[\u{1F000}-\u{1FAFF}]/gu, "");
}

function _extractQuotedDialogues(text) {
  const out = [];
  const t = String(text || "");
  const regex = /"([^"]+)"/g;
  let m;
  while ((m = regex.exec(t)) !== null) {
    const s = String(m[1] || "").trim();
    if (s) out.push(s);
  }
  return out;
}

