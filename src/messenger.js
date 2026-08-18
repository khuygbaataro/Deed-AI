import { config } from './config.js';
import { log, maskPsid } from './logger.js';

const MAX_TEXT = 1900; // Messenger-ийн хязгаар 2000, аюулгүйн зайтай

function graphUrl(path) {
  return `https://graph.facebook.com/${config.fb.graphVersion}/${path}?access_token=${encodeURIComponent(
    config.fb.pageAccessToken ?? '',
  )}`;
}

async function graphPost(path, body) {
  if (!config.fb.pageAccessToken) {
    log.warn('FB_PAGE_ACCESS_TOKEN алга — Facebook руу илгээхийг алгаслаа', { path });
    return null;
  }

  const res = await fetch(graphUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    log.error('Graph API алдаа', { path, status: res.status, body: text.slice(0, 500) });
    throw new Error(`Graph API ${res.status}: ${text.slice(0, 200)}`);
  }
  return text ? JSON.parse(text) : null;
}

/**
 * Урт текстийг Messenger-ийн хязгаарт багтаан хуваана.
 * Эхлээд догол мөрөөр, боломжгүй бол өгүүлбэрээр, эцэст нь хатуу тайрна.
 * @param {string} text
 * @returns {string[]}
 */
export function splitMessage(text, limit = MAX_TEXT) {
  const clean = String(text ?? '').trim();
  if (!clean) return [];
  if (clean.length <= limit) return [clean];

  const chunks = [];
  let rest = clean;

  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n\n', limit);
    if (cut < limit * 0.5) cut = rest.lastIndexOf('\n', limit);
    if (cut < limit * 0.5) cut = rest.lastIndexOf('. ', limit);
    if (cut > 0 && rest[cut] === '.') cut += 1;
    if (cut < limit * 0.5) cut = rest.lastIndexOf(' ', limit);
    if (cut < limit * 0.5) cut = limit;

    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }

  if (rest) chunks.push(rest);
  return chunks.filter(Boolean);
}

/** typing_on / typing_off / mark_seen */
export async function sendSenderAction(psid, action) {
  try {
    await graphPost('me/messages', {
      recipient: { id: psid },
      sender_action: action,
    });
  } catch (err) {
    log.warn('sender_action илгээж чадсангүй', { action, error: err.message });
  }
}

/**
 * Текст мессеж илгээх (шаардлагатай бол хэсэгчлэн).
 * @param {string} psid
 * @param {string} text
 * @param {Array<{title: string, payload: string}>} [quickReplies]
 */
export async function sendText(psid, text, quickReplies) {
  const parts = splitMessage(text);
  if (!parts.length) return;

  for (let i = 0; i < parts.length; i += 1) {
    const isLast = i === parts.length - 1;
    const message = { text: parts[i] };

    if (isLast && quickReplies?.length) {
      message.quick_replies = quickReplies.slice(0, 13).map((qr) => ({
        content_type: 'text',
        title: qr.title.slice(0, 20),
        payload: qr.payload,
      }));
    }

    await graphPost('me/messages', {
      recipient: { id: psid },
      messaging_type: 'RESPONSE',
      message,
    });
  }

  // info түвшинд бичнэ — production дээр хариу явсан эсэхийг харах гол шалгуур
  log.info('Мессеж илгээлээ', { psid: maskPsid(psid), parts: parts.length });
}

/**
 * Зураг илгээх (URL-ээр).
 * Facebook зургийг эхний удаад татаж кэшлэдэг тул дараагийн илгээлт шуурхай болно.
 * @param {string} psid
 * @param {string} url нийтэд нээлттэй https хаяг
 */
export async function sendImage(psid, url) {
  if (!url) return false;
  try {
    await graphPost('me/messages', {
      recipient: { id: psid },
      messaging_type: 'RESPONSE',
      message: {
        attachment: {
          type: 'image',
          payload: { url, is_reusable: true },
        },
      },
    });
    log.info('Зураг илгээлээ', { psid: maskPsid(psid) });
    return true;
  } catch (err) {
    // Зураг явахгүй байсан ч яриа үргэлжлэх ёстой
    log.warn('Зураг илгээж чадсангүй', { psid: maskPsid(psid), url, error: err.message });
    return false;
  }
}

/** Хэрэглэгчийн нэрийг авах (эрх байхгүй бол null буцаана) */
export async function getUserProfile(psid) {
  if (!config.fb.pageAccessToken) return null;
  try {
    const url = `https://graph.facebook.com/${config.fb.graphVersion}/${psid}?fields=first_name,last_name&access_token=${encodeURIComponent(
      config.fb.pageAccessToken,
    )}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Яриаг Page Inbox руу шилжүүлнэ (Handover Protocol).
 * Апп нь Primary Receiver байх ёстой; эрх байхгүй бол алдаа өгөхгүй, false буцаана.
 */
export async function passThreadControl(psid, metadata = '') {
  try {
    await graphPost('me/pass_thread_control', {
      recipient: { id: psid },
      target_app_id: config.fb.inboxAppId,
      metadata: String(metadata).slice(0, 1000),
    });
    log.info('Яриаг Page Inbox руу шилжүүллээ', { psid: maskPsid(psid) });
    return true;
  } catch (err) {
    log.warn('pass_thread_control амжилтгүй', { psid: maskPsid(psid), error: err.message });
    return false;
  }
}

/** Админ хэрэглэгчид мэдэгдэл илгээх (24 цагийн дүрэмд захирагдана) */
export async function notifyAdmins(text) {
  for (const psid of config.adminPsids) {
    try {
      await sendText(psid, text);
    } catch (err) {
      log.warn('Админд мэдэгдэл илгээж чадсангүй', { psid: maskPsid(psid), error: err.message });
    }
  }
}
