/** ========================= 태그 자동 분류/정규화 (입력 → 표준 태그) ========================= */
// (내부 데이터) 표기 통일/자동 분류용 사전들
// - TAG_ALIASES: 단어 단위 별칭
// - PHRASE_ALIASES: 여러 단어 문구를 “확정 태그들”로 매핑
// - GENRE_WORDS / MOOD_WORDS / INST_WORDS / LYRIC_WORDS: 1토큰 분류 사전
const TAG_ALIASES = new Map([
  ["hip-hop", "hiphop"],
  ["hip hop", "hiphop"],
  ["r&b", "rnb"],
  ["rnb", "rnb"],
  ["lofi", "lo-fi"], // 취향
]);

// “문구(여러 단어)”를 통째로 확정 매핑
const PHRASE_ALIASES = new Map([
  ["alternative r&b", ["mood:alternative", "genre:rnb"]],
  ["acoustic pop", ["inst:acoustic", "genre:pop"]],
  ["neo soul", ["genre:neo_soul"]],
  ["bossa nova", ["genre:bossa_nova"]],
  ["lo-fi hip hop", ["mood:lofi", "genre:hiphop"]],
  ["glitch hop", ["genre:glitch_hop"]],
  ["jazz hop", ["genre:jazz_hop"]],
  ["industrial techno", ["genre:industrial", "genre:techno"]],
  ["electronic/edm", ["genre:electronic", "genre:edm"]],
  ["darksynth", ["genre:darksynth", "mood:dark", "inst:synth"]],
  ["french glitch", ["genre:french", "genre:glitch"]],
  ["808 bassline", ["inst:808_bass"]],
  ["industrial horror", ["mood:industrial", "mood:horror"]],
  ["mechanical groove", ["mood:mechanical", "mood:groove"]],
  ["night vibes", ["mood:night_vibes"]],
  ["tension", ["mood:tense"]],
  ["high-energy j-rock", ["mood:high-energy", "genre:j-rock"]],
]);

const GENRE_WORDS = new Set([
  "blues","jazz","rock","pop","country","classical","folk","funk","soul","reggae","metal","ambient",
  "electronic","edm","hiphop","rap","rnb","drill","idm","techno","glitch","j-rock"
]);

const MOOD_WORDS = new Set([
  "calm","dark","sad","happy","tense","chill","cozy","epic","mysterious",
  "alternative","chaotic","cinematic","cold","cyberpunk","tension","night","tight","lofi",
  "east asian influence","exploration","high-energy","hopeless","horizon","military",
  "underscore","mundane","soft"
]);

const INST_WORDS = new Set([
  "piano","guitar","strings","synth","bass","drums","orchestra",
  "acoustic","808","turntable","scratch","808_bass"
]);

const LYRIC_WORDS = new Set([
  "lyric","lyrics","no lyric","instrumental","vocal","male","female"
]);

// (내부) raw 태그를 소문자/공백정리 + 별칭 적용 + 숫자만 있으면 bpm:xxx로 변환
function abgmCanonRawTag(raw) {
  let s = String(raw || "").trim().toLowerCase();
  if (!s) return "";
  // 1) 공백 정리
  s = s.replace(/\s+/g, " ");
  // 2) 숫자만 있으면 bpm
  if (/^\d{2,3}$/.test(s)) {
    const bpm = Number(s);
    if (bpm >= 40 && bpm <= 260) return `bpm:${bpm}`;
  }
  // 3) 통째 문구 별칭 먼저
  if (PHRASE_ALIASES.has(s)) return s;
  // 4) 단어 별칭 적용 (토큰 단위)
  s = s.split(" ").map(t => TAG_ALIASES.get(t) || t).join(" ");
  return s;
}

// raw 태그를 “표준 태그 배열”로 정규화
// - "문구" 매핑(예: "lo-fi hip hop" → mood/genre 여러 개)
// - "/" 들어오면 쪼개서 재귀 정규화
// - 여러 단어면 “마지막 단어가 장르” 휴리스틱으로 cat:tag 여러 개 생성
export function abgmNormTags(raw) {
  const s0 = abgmCanonRawTag(raw);
  if (!s0) return [];
  // 1) bpm:xxx 같은 건 그대로 단일 반환
  if (s0.startsWith("bpm:")) return [s0];
  // 2) 이미 cat:tag 형태면 그대로
  if (s0.includes(":") && !PHRASE_ALIASES.has(s0)) return [s0];
  // 3) 문구 확정 매핑
  if (PHRASE_ALIASES.has(s0)) return PHRASE_ALIASES.get(s0).slice();
  // 4) "/" 같은 구분자 들어오면 나눠서 재귀 처리
  if (s0.includes("/")) {
    return s0.split("/").flatMap(part => abgmNormTags(part));
  }
  // 5) 여러 단어면 “마지막 단어=장르” 휴리스틱
  const toks = s0.split(" ").filter(Boolean);
  if (toks.length >= 2) {
    const lastRaw = toks[toks.length - 1];
    const last = TAG_ALIASES.get(lastRaw) || lastRaw;
    // 6) 마지막이 장르면: genre:last + 앞 단어들은 mood/inst로 분류 시도
    if (GENRE_WORDS.has(last)) {
      const out = [`genre:${last}`];
      for (const w0 of toks.slice(0, -1)) {
        const w = TAG_ALIASES.get(w0) || w0;
        if (INST_WORDS.has(w)) out.push(`inst:${w}`);
        else if (MOOD_WORDS.has(w)) out.push(`mood:${w}`);
        else out.push(w); // 7) 모르면 etc(콜론 없는 태그)
      }
      return out;
    }
  }
  // 8) 한 단어면 단어사전으로 분류
  if (GENRE_WORDS.has(s0)) return [`genre:${s0}`];
  if (MOOD_WORDS.has(s0))  return [`mood:${s0}`];
  if (INST_WORDS.has(s0))  return [`inst:${s0}`];
  if (LYRIC_WORDS.has(s0)) return [`lyric:${s0}`];
  // 9) 모르면 그대로 (etc)
  return [s0];
}

// 기존 코드 호환용: 단일 태그만 필요한 곳에서 abgmNormTags(raw)[0]만 반환
export function abgmNormTag(raw) {
  return abgmNormTags(raw)[0] || "";
}



/** ========================= 태그 표시용 헬퍼 (표준 태그 → UI 라벨) ========================= */
const TAG_PRETTY_MAP = new Map([
  ["rnb", "R&B"],
  ["hiphop", "hip-hop"],
  ["lofi", "lo-fi"],
  ["idm", "IDM"],
  ["edm", "EDM"],
]);

const TAG_CAT_ORDER = ["genre","mood","inst","lyric","bpm","tempo","etc"];

// "cat:value"에서 value만 뽑아줌 (콜론 없으면 그대로)
export function tagVal(t){
  const s = abgmNormTag(t);
  const i = s.indexOf(":");
  return i > 0 ? s.slice(i + 1) : s;
}

// 태그의 cat만 뽑아줌 ("genre:rock" → "genre"), 없으면 "etc"
export function tagCat(t) {
  const s = String(t || "").trim().toLowerCase();
  const i = s.indexOf(":");
  if (i <= 0) return "etc";
  return s.slice(0, i);
}

// UI에 뿌릴 이쁜 라벨 생성
// - underscore → 공백(neo_soul → neo soul)
// - 일부 표기 보정(R&B, EDM, IDL 등)
// - bpm은 "120 BPM"처럼 출력
export function tagPretty(t){
  const s = abgmNormTag(t);
  const cat = tagCat(s);
  let v = tagVal(s).replace(/[_]+/g, " ").trim(); // neo_soul -> neo soul
  if (TAG_PRETTY_MAP.has(v)) v = TAG_PRETTY_MAP.get(v);
  if (cat === "bpm") return `${v} BPM`;
  return v;
}



/** ========================= 태그 정렬 ========================= */
// 카테고리 우선순위(genre→mood→inst→lyric→bpm→tempo→etc)로 정렬
// + bpm은 숫자 기준 정렬
export function sortTags(arr){
  return [...arr].sort((a,b)=>{
    const A = tagSortKey(a), B = tagSortKey(b);
    if (A[0] !== B[0]) return A[0]-B[0];
    if (A[1] !== B[1]) return A[1]-B[1];
    return String(A[2]).localeCompare(String(B[2]), undefined, {numeric:true, sensitivity:"base"});
  });
}

// (내부) sortTags용 정렬 키 생성기
function tagSortKey(t){
  const s = abgmNormTag(t);
  const cat = tagCat(s);
  const ci = TAG_CAT_ORDER.indexOf(cat);
  const catRank = ci === -1 ? 999 : ci;
  // > bpm은 숫자 정렬
  if (cat === "bpm") {
    const n = Number(s.split(":")[1] ?? 0);
    return [catRank, n, s];
  }
  return [catRank, 0, s];
}

