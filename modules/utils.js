/** ========================= ID / 이름 처리 ========================= */
// 간단 uid 만들어주는 애 (시간+랜덤 섞어서 문자열로 뱉음)
export function uid() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// 경로/파일명에서 확장자만 떼고 베이스 이름만 뽑는 애
export function basenameNoExt(s = "") {
  const v = String(s || "").trim();
  if (!v) return "";
  const base = v.split("/").pop() || v;
  return base.replace(/\.[^/.]+$/, "");
}



/** ========================= 텍스트 / HTML 안전처리 ========================= */
// UI에 꽂을 때 XSS/깨짐 방지용으로 &,<,>,",’ 같은 거 HTML 엔티티로 이스케이프
export function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}



/** ========================= URL 관련 유틸 ========================= */
// 문자열이 “http(s)://”로 시작하면 URL로 간주하는 애
export function isProbablyUrl(s) {
  const v = String(s ?? "").trim();
  return /^https?:\/\//i.test(v);
}

// dropbox 공유링크를 raw=1 형태로 바꿔서 “직링 재생” 가능하게 만드는 애
export function dropboxToRaw(u) {
  try {
    const url = new URL(String(u || "").trim());
    if (!/dropbox\.com$/i.test(url.hostname)) return String(u || "").trim();
    url.searchParams.delete("dl");
    url.searchParams.set("raw", "1");
    return url.toString();
  } catch {
    return String(u || "").trim();
  }
}



/** ========================= 숫자 / 데이터 유틸 ========================= */
// 볼륨 같은 값 0~1 범위로 강제 클램프하는 애 (NaN/무한대면 0)
export function clamp01(x) {
  x = Number(x);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

// JSON 기반 딥카피(단, 함수/Date/Map/Set 등은 깨질 수 있음)
export function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}



/** ========================= 파싱 ========================= */
// "a, b\nc" 같은 키워드 문자열을 배열로 파싱(쉼표/줄바꿈 기준 + trim + 빈값 제거)
export function parseKeywords(s) {
  return String(s ?? "")
    .split(/[,\n]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}



/** ========================= SillyTavern 컨텍스트 / 채팅 헬퍼 ========================= */
// ST 컨텍스트에서 chatId/characterId 뽑아서 "chatId::characterId" 키 만드는 애
export function getChatKeyFromContext(ctx) {
  const chatId = ctx?.chatId ?? ctx?.chat_id ?? ctx?.chat?.id ?? "global";
  const char = ctx?.characterId ?? ctx?.character_id ?? ctx?.character?.id ?? ctx?.name2 ?? "";
  return `${chatId}::${char}`;
}

// ST 채팅에서 “마지막 AI 메시지 텍스트”를 최대한 안전하게 찾아오는 애
// (ctx.chat/messages → ST.getContext() → window.chat → DOM(#chat 등) 순으로 탐색)
export function getLastAssistantText(ctx) {
  try {
    let chat = (ctx && (ctx.chat || ctx.messages)) || null;
    if (!Array.isArray(chat) || chat.length === 0) {
      try {
        const st = window.SillyTavern || window?.parent?.SillyTavern;
        const gc = st && typeof st.getContext === "function" ? st.getContext() : null;
        chat = (gc && (gc.chat || gc.messages)) || chat;
      } catch {}
    }
    if (!Array.isArray(chat) || chat.length === 0) {
      if (Array.isArray(window.chat)) chat = window.chat;
    }
    if (Array.isArray(chat) && chat.length) {
      for (let i = chat.length - 1; i >= 0; i--) {
        const m = chat[i] || {};
        if (m.is_user === true) continue;
        const role = String(m.role || m.sender || "").toLowerCase();
        if (role === "user") continue;
        const text = (m.content ?? m.mes ?? m.message ?? m.text ?? "");
        if (typeof text === "string" && text.trim()) return text;
      }
    }
    const root =
      document.querySelector("#chat") ||
      document.querySelector("#chat_content") ||
      document.querySelector("main") ||
      document.body;
    if (root) {
      const nodes = Array.from(root.querySelectorAll(".mes, .message, .chat_message"));
      for (let i = nodes.length - 1; i >= 0; i--) {
        const el = nodes[i];
        if (!el) continue;
        const cls = el.classList;
        if (cls && (cls.contains("is_user") || cls.contains("user") || cls.contains("from_user"))) continue;
        const textEl =
          el.querySelector(".mes_text, .message_text, .text, .content, .mes_content") || el;
        const txt = (textEl.innerText || textEl.textContent || "").trim();
        if (txt) return txt;
      }
    }
  } catch {}
  return "";
}

// 텍스트 변화 감지용 지문 시그니처 “가짜 해시” 만들기 (길이 + 앞 40자 + 뒤 20자)
export function makeAsstSig(text) {
  const t = String(text ?? "");
  const head = t.slice(0, 40).replace(/\s+/g, " ");
  const tail = t.slice(-20).replace(/\s+/g, " ");
  return `${t.length}:${head}:${tail}`;
}
