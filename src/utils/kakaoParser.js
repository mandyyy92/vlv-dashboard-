// src/utils/kakaoParser.js
// 카카오톡 대화 파서 — 업체 소통 요약 메뉴용
// 지원 포맷: PC(한글/영문), Android(한글/영문), iOS(한글/영문), 붙여넣기

/* ------------------------------------------------------------------
 * 해시 (중복 업로드 방지용)
 * ------------------------------------------------------------------ */
function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/* ------------------------------------------------------------------
 * 노이즈 / 첨부 판별
 * ------------------------------------------------------------------ */
const ATTACHMENT_PATTERNS = [
  /^사진$/, /^사진 \d+장$/, /^동영상$/, /^이모티콘$/, /^음성메시지$/,
  /^파일: /, /^보이스톡 /, /^페이스톡 /,
  /^Photo$/i, /^Photo \d+$/i, /^Video$/i, /^Emoticon$/i, /^Voice Note$/i, /^File: /i,
];

const SYSTEM_PATTERNS = [
  /님이 들어왔습니다\.?$/, /님이 나갔습니다\.?$/, /님을 초대했습니다\.?$/,
  /님이 나갔습니다$/, /^삭제된 메시지입니다\.?$/,
  /^채팅방 관리자가/, /^샵검색: /,
  /joined the chat/i, /left the chat/i, /invited/i,
  /^This message was deleted\.?$/i,
];

function classify(body) {
  const t = body.trim();
  if (!t) return 'empty';
  if (ATTACHMENT_PATTERNS.some((r) => r.test(t))) return 'attachment';
  if (SYSTEM_PATTERNS.some((r) => r.test(t))) return 'system';
  return 'text';
}

/* ------------------------------------------------------------------
 * 시간 파싱
 * ------------------------------------------------------------------ */
// "오전 10:05" | "오후 3:07" | "10:05 AM" | "15:07"
function parseTime(raw) {
  if (!raw) return null;
  const s = raw.trim();

  let m = s.match(/^(오전|오후)\s*(\d{1,2}):(\d{2})$/);
  if (m) {
    let h = parseInt(m[2], 10);
    if (m[1] === '오후' && h !== 12) h += 12;
    if (m[1] === '오전' && h === 12) h = 0;
    return { h, min: parseInt(m[3], 10) };
  }

  m = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (m) {
    let h = parseInt(m[1], 10);
    const ap = m[3].toUpperCase();
    if (ap === 'PM' && h !== 12) h += 12;
    if (ap === 'AM' && h === 12) h = 0;
    return { h, min: parseInt(m[2], 10) };
  }

  m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m) return { h: parseInt(m[1], 10), min: parseInt(m[2], 10) };

  return null;
}

const EN_MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

// 날짜 구분선: "--------------- 2026년 9월 14일 월요일 ---------------"
//              "--------------- Monday, September 14, 2026 ---------------"
function parseDateDivider(line) {
  const s = line.replace(/-/g, ' ').trim();

  let m = s.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/);
  if (m) return { y: +m[1], mo: +m[2], d: +m[3] };

  m = s.match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (m && EN_MONTHS[m[1].toLowerCase()]) {
    return { y: +m[3], mo: EN_MONTHS[m[1].toLowerCase()], d: +m[2] };
  }

  m = s.match(/(\d{4})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})/);
  if (m) return { y: +m[1], mo: +m[2], d: +m[3] };

  return null;
}

// KST 기준 Date 생성 (브라우저 로케일에 관계없이 고정)
function toKstDate({ y, mo, d, h, min }) {
  // KST = UTC+9
  return new Date(Date.UTC(y, mo - 1, d, h - 9, min, 0));
}

/* ------------------------------------------------------------------
 * 라인 패턴
 * ------------------------------------------------------------------ */
// A. PC 내보내기: [발신자] [오전 10:05] 메시지  /  [Name] [10:05 AM] message
const RE_PC = /^\[([^\]]+)\]\s*\[([^\]]+)\]\s*(.*)$/;

// B. 모바일(한글): 2026년 9월 14일 오전 10:05, 박하늘 : 메시지
const RE_MOBILE_KO = /^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일\s+(오전|오후\s*\d{1,2}:\d{2}|\d{1,2}:\d{2}\s*(?:AM|PM)?)\s*,\s*([^:]+?)\s*:\s*(.*)$/;

// B'. iOS: 2026. 9. 14. 오전 10:05, 박하늘 : 메시지
const RE_MOBILE_DOT = /^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?\s+((?:오전|오후)\s*\d{1,2}:\d{2}|\d{1,2}:\d{2}\s*(?:AM|PM)?)\s*,\s*([^:]+?)\s*:\s*(.*)$/;

// B''. 영문 모바일: September 14, 2026 at 10:05 AM, Name : message
const RE_MOBILE_EN = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\s+at\s+(\d{1,2}:\d{2}\s*(?:AM|PM))\s*,\s*([^:]+?)\s*:\s*(.*)$/i;

// 한글 모바일은 시간 토큰이 "오전 10:05" 처럼 공백을 포함 → 별도 처리
const RE_MOBILE_KO2 = /^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일\s+((?:오전|오후)\s*\d{1,2}:\d{2})\s*,\s*([^:]+?)\s*:\s*(.*)$/;

/* ------------------------------------------------------------------
 * 메인 파서
 * ------------------------------------------------------------------ */
/**
 * @param {string} text        카톡 대화 원문
 * @param {object} opts
 * @param {number} opts.vendorId
 * @param {Date}   [opts.fallbackDate]  날짜 정보가 전혀 없을 때 기준일(붙여넣기용)
 * @returns {{messages:Array, periodFrom:Date|null, periodTo:Date|null, format:string, stats:object}}
 */
export function parseKakaoChat(text, { vendorId, fallbackDate = new Date() } = {}) {
  if (vendorId === undefined || vendorId === null) {
    throw new Error('parseKakaoChat: vendorId는 필수입니다.');
  }
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');

  const messages = [];
  const stats = { total: 0, text: 0, attachment: 0, system: 0, skipped: 0, saved: 0 };
  let pendingBlank = 0;
  let currentDate = null;
  let format = 'unknown';
  let last = null;

  const pushMsg = (dateParts, sender, body) => {
    const kind = classify(body);
    stats.total++;

    if (kind === 'system') {
      stats.system++;
      last = null;
      return;
    }

    const sentAt = toKstDate(dateParts);
    if (isNaN(sentAt.getTime())) {
      stats.skipped++;
      last = null;
      return;
    }

    const msg = {
      vendor_id: vendorId,
      sent_at: sentAt.toISOString(),
      sender: sender.trim(),
      body_raw: body.trim(),
      lang: null,
      has_attachment: kind === 'attachment',
    };

    messages.push(msg);
    last = msg;
    pendingBlank = 0;
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/​/g, '');
    const trimmed = line.trim();

    if (!trimmed) {
      if (last) pendingBlank++;
      continue;
    }

    // 헤더 스킵
    if (/^(저장한 날짜|Date Saved)\s*:/.test(trimmed)) continue;
    if (/님과 카카오톡 대화$/.test(trimmed)) continue;
    if (/KakaoTalk Chats with/i.test(trimmed)) continue;

    // 날짜 구분선
    if (/^-{3,}.*-{3,}$/.test(trimmed)) {
      const d = parseDateDivider(trimmed);
      if (d) {
        currentDate = d;
        last = null;
      }
      continue;
    }

    // A. PC 포맷
    let m = trimmed.match(RE_PC);
    if (m && currentDate) {
      const t = parseTime(m[2]);
      if (t) {
        if (format === 'unknown') format = 'pc';
        pushMsg({ ...currentDate, h: t.h, min: t.min }, m[1], m[3]);
        continue;
      }
    }

    // B. 모바일 한글
    m = trimmed.match(RE_MOBILE_KO2);
    if (m) {
      const t = parseTime(m[4]);
      if (t) {
        if (format === 'unknown') format = 'mobile_ko';
        currentDate = { y: +m[1], mo: +m[2], d: +m[3] };
        pushMsg({ ...currentDate, h: t.h, min: t.min }, m[5], m[6]);
        continue;
      }
    }

    // B'. iOS 점 표기
    m = trimmed.match(RE_MOBILE_DOT);
    if (m) {
      const t = parseTime(m[4]);
      if (t) {
        if (format === 'unknown') format = 'ios';
        currentDate = { y: +m[1], mo: +m[2], d: +m[3] };
        pushMsg({ ...currentDate, h: t.h, min: t.min }, m[5], m[6]);
        continue;
      }
    }

    // B''. 영문 모바일
    m = trimmed.match(RE_MOBILE_EN);
    if (m && EN_MONTHS[m[1].toLowerCase()]) {
      const t = parseTime(m[4]);
      if (t) {
        if (format === 'unknown') format = 'mobile_en';
        currentDate = { y: +m[3], mo: EN_MONTHS[m[1].toLowerCase()], d: +m[2] };
        pushMsg({ ...currentDate, h: t.h, min: t.min }, m[5], m[6]);
        continue;
      }
    }

    // 어느 패턴도 아님 → 직전 메시지의 줄바꿈 연장
    if (last) {
      last.body_raw += '\n'.repeat(pendingBlank + 1) + trimmed;
      pendingBlank = 0;
    } else {
      stats.skipped++;
    }
  }

  // 날짜 정보가 전혀 없는 붙여넣기 → fallbackDate 기준으로 재시도
  if (messages.length === 0) {
    const fb = {
      y: fallbackDate.getFullYear(),
      mo: fallbackDate.getMonth() + 1,
      d: fallbackDate.getDate(),
    };
    for (const rawLine of lines) {
      const trimmed = rawLine.trim();
      if (!trimmed) continue;
      const m = trimmed.match(RE_PC);
      if (m) {
        const t = parseTime(m[2]);
        if (t) {
          format = 'paste';
          pushMsg({ ...fb, h: t.h, min: t.min }, m[1], m[3]);
        }
      }
    }
  }

  // 중복 해시 제거 (같은 파일 내 중복)
  const filled = messages.filter((m) => {
    if (m.body_raw.trim()) return true;
    stats.skipped++;
    return false;
  });

  const sorted = filled.sort(
    (a, b) => a.sent_at.localeCompare(b.sent_at) || a.sender.localeCompare(b.sender)
  );

  const seqCount = new Map();
  for (const m of sorted) {
    const key = `${vendorId}|${m.sent_at}|${m.sender}|${m.body_raw}`;
    const seq = seqCount.get(key) ?? 0;
    seqCount.set(key, seq + 1);
    m.msg_hash = cyrb53(`${key}|${seq}`);
  }

  stats.text = sorted.filter((m) => !m.has_attachment).length;
  stats.attachment = sorted.filter((m) => m.has_attachment).length;
  stats.saved = sorted.length;

  return {
    messages: sorted,
    periodFrom: sorted.length ? new Date(sorted[0].sent_at) : null,
    periodTo: sorted.length ? new Date(sorted[sorted.length - 1].sent_at) : null,
    format,
    stats,
  };
}

/* ------------------------------------------------------------------
 * 요약용 텍스트 변환 (Edge Function에 보낼 형태)
 * ------------------------------------------------------------------ */
export function messagesToPrompt(messages, { includeAttachments = false } = {}) {
  return messages
    .filter((m) => includeAttachments || !m.has_attachment)
    .map((m) => {
      const d = new Date(m.sent_at);
      const kst = new Date(d.getTime() + 9 * 3600 * 1000);
      const stamp = kst.toISOString().slice(0, 16).replace('T', ' ');
      return `[${stamp}] ${m.sender}: ${m.body_raw}`;
    })
    .join('\n');
}

/* ------------------------------------------------------------------
 * 스타일넘버 추출 (오더 연계용)
 * ------------------------------------------------------------------ */
export function extractStyleNos(text) {
  const found = new Set();
  const patterns = [
    /\b(VL[A-Z0-9-]{3,})\b/gi,
    /\b(\d{2}[A-Z]{2}[A-Z0-9-]{2,})\b/g, // 26FW-xxx 형태
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(text)) !== null) found.add(m[1].toUpperCase());
  }
  return [...found];
}