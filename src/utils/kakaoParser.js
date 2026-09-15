// src/utils/kakaoParser.js
// 카카오톡 대화 파서 — 업체 소통 요약 메뉴용

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

const ATTACHMENT_PATTERNS = [
  /^사진$/, /^사진 \d+장$/, /^동영상$/, /^이모티콘$/, /^음성메시지$/,
  /^파일: /, /^보이스톡 /, /^페이스톡 /,
  /^Photo$/i, /^Photo \d+$/i, /^Video$/i, /^Emoticon$/i, /^Voice Note$/i, /^File: /i,
];

const SYSTEM_PATTERNS = [
  /님이 들어왔습니다\.?$/, /님이 나갔습니다\.?$/, /님을 초대했습니다\.?$/,
  /^삭제된 메시지입니다\.?$/, /^채팅방 관리자가/, /^샵검색: /,
  /joined the chat/i, /left the chat/i, /^This message was deleted\.?$/i,
];

function classify(body) {
  const t = body.trim();
  if (!t) return 'empty';
  if (ATTACHMENT_PATTERNS.some((r) => r.test(t))) return 'attachment';
  if (SYSTEM_PATTERNS.some((r) => r.test(t))) return 'system';
  return 'text';
}

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
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9,
  oct: 10, nov: 11, dec: 12,
};

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

// KST 고정 (UTC+9)
function toKstDate({ y, mo, d, h, min }) {
  return new Date(Date.UTC(y, mo - 1, d, h - 9, min, 0));
}

const RE_PC = /^\[([^\]]+)\]\s*\[([^\]]+)\]\s*(.*)$/;
const RE_MOBILE_KO2 = /^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일\s+((?:오전|오후)\s*\d{1,2}:\d{2})\s*,\s*([^:]+?)\s*:\s*(.*)$/;
const RE_MOBILE_DOT = /^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?\s+((?:오전|오후)\s*\d{1,2}:\d{2}|\d{1,2}:\d{2}\s*(?:AM|PM)?)\s*,\s*([^:]+?)\s*:\s*(.*)$/;
const RE_MOBILE_EN = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\s+at\s+(\d{1,2}:\d{2}\s*(?:AM|PM))\s*,\s*([^:]+?)\s*:\s*(.*)$/i;

export function parseKakaoChat(text, { vendorId, fallbackDate = new Date() } = {}) {
  if (vendorId === undefined || vendorId === null) {
    throw new Error('parseKakaoChat: vendorId는 필수입니다.');
  }

  const lines = String(text).replace(/\r\n/g, '\n').split('\n');

  const messages = [];
  const stats = { total: 0, text: 0, attachment: 0, system: 0, skipped: 0, saved: 0 };
  let currentDate = null;
  let format = 'unknown';
  let last = null;

  const pushMsg = (dateParts, sender, body) => {
    const kind = classify(body);
    stats.total++;

    if (kind === 'system' || kind === 'empty') {
      stats[kind === 'system' ? 'system' : 'skipped']++;
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
      has_attachment: kind === 'attachment',
      lang: null,
    };

    messages.push(msg);
    last = msg;
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\u200b/g, '');
    const trimmed = line.trim();

    if (!trimmed) { last = null; continue; }

    if (/^(저장한 날짜|Date Saved)\s*:/.test(trimmed)) continue;
    if (/님과 카카오톡 대화$/.test(trimmed)) continue;
    if (/KakaoTalk Chats with/i.test(trimmed)) continue;

    if (/^-{3,}.*-{3,}$/.test(trimmed)) {
      const d = parseDateDivider(trimmed);
      if (d) { currentDate = d; last = null; }
      continue;
    }

    let m = trimmed.match(RE_PC);
    if (m && currentDate) {
      const t = parseTime(m[2]);
      if (t) {
        if (format === 'unknown') format = 'pc';
        pushMsg({ ...currentDate, h: t.h, min: t.min }, m[1], m[3]);
        continue;
      }
    }

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

    if (last) {
      last.body_raw += '\n' + trimmed;
    } else {
      stats.skipped++;
    }
  }

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

  const sorted = messages.sort(
    (a, b) => a.sent_at.localeCompare(b.sent_at) || a.sender.localeCompare(b.sender)
  );

  // (발신시각·발신자·본문)이 완전히 같은 메시지에는 일련번호를 붙여 해시를 분리한다.
  // 같은 export 파일을 다시 올리면 동일한 해시가 나오므로 중복 방지는 그대로 동작한다.
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

export function extractStyleNos(text) {
  const found = new Set();
  const patterns = [
    /\b(VL[A-Z0-9-]{3,})\b/gi,
    /\b(\d{2}[A-Z]{2}[A-Z0-9-]{2,})\b/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(text)) !== null) found.add(m[1].toUpperCase());
  }
  return [...found];
}