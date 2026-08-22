/**
 * Facebook сэтгэгдэлд хариулах — сэтгэгдлээс Messenger рүү чиглүүлэх.
 *
 * Яагаад хэрэгтэй вэ: зарлал дээр олон хүн сэтгэгдэл бичдэг ч чат руу
 * ордоггүй. Facebook-ийн "private reply" боломжоор тэдэн рүү ШУУД Messenger
 * мессеж илгээж болно — тэр мессеж чатыг нээж, ботын урсгал эхэлнэ.
 *
 * Хоёр зүйл зэрэг хийнэ:
 *   1. Хувийн мессеж (private reply) — Messenger чат нээгдэнэ
 *   2. Нийтийн хариу (сэтгэгдэлд хариулах) — бусад хүмүүс ч хардаг
 *
 * ⚠️ Facebook-ийн хязгаарлалт:
 *   - Сэтгэгдэл бүрд ЗӨВХӨН НЭГ УДАА private reply илгээж болно
 *   - Сэтгэгдэл бичигдсэнээс хойш 7 хоногийн дотор
 *   - pages_messaging + pages_manage_engagement эрх шаардана
 *   - Page өөрөө бичсэн сэтгэгдэлд хариулахгүй (давталт үүснэ)
 */
import { config } from './config.js';
import { log } from './logger.js';
import { kvClaim, kvGet, kvSet } from './store.js';

const CLAIM_TTL_SECONDS = 7 * 24 * 60 * 60; // Facebook-ийн 7 хоногийн цонхтой ижил

/** Сэтгэгдэлд ирэх хувийн мессеж — чатыг нээнэ */
export const PRIVATE_REPLY = `Сайн байна уу 👋

Сэтгэгдэл бичсэнд баярлалаа! Би Соёл Эрдэм Дээд Сургуулийн элсэлтийн Эрдэм
чатбот байна. Мэргэжил сонгож, элсэлтээ баталгаажуулахад тань туслах болно.

Манай бакалаврын хөтөлбөрийн мэргэжлүүдтэй танилцах уу?`;

/** Сэтгэгдэлд бичих нийтийн хариу — бусад хүмүүс ч хардаг */
export const PUBLIC_REPLY =
  'Сайн байна уу! Танд хувийн мессежээр дэлгэрэнгүй мэдээлэл илгээлээ 💌 ' +
  'Messenger-ээ шалгаарай.';

const PAGE_ID_KEY = 'fb:page_id';
const PAGE_ID_TTL = 30 * 24 * 60 * 60; // 30 хоног

/**
 * Хуудасны ID-г олно.
 *
 * Гараар тохируулаагүй бол Facebook-ээс өөрөө асууж, кэшилнэ. Энэ ID нь
 * ЗААВАЛ хэрэгтэй: ботын өөрийн бичсэн нийтийн хариунд дахин хариулбал
 * төгсгөлгүй давталт үүснэ.
 *
 * @returns {Promise<string|null>}
 */
export async function getPageId() {
  if (config.fb.pageId) return config.fb.pageId;

  const cached = await kvGet(PAGE_ID_KEY);
  if (typeof cached === 'string' && cached) return cached;

  if (!config.fb.pageAccessToken) return null;

  try {
    const res = await fetch(
      graphUrl('me?fields=id') +
        '&access_token=' + encodeURIComponent(config.fb.pageAccessToken),
    );
    const data = await res.json();
    if (!res.ok || !data?.id) {
      log.warn('Хуудасны ID олдсонгүй', { error: data?.error?.message });
      return null;
    }
    await kvSet(PAGE_ID_KEY, String(data.id), PAGE_ID_TTL);
    log.info('Хуудасны ID илэрлээ', { pageId: data.id });
    return String(data.id);
  } catch (err) {
    log.warn('Хуудасны ID авахад алдаа', { error: err.message });
    return null;
  }
}

function graphUrl(path) {
  return `https://graph.facebook.com/${config.fb.graphVersion}/${path}`;
}

async function graphPost(path, body) {
  if (!config.fb.pageAccessToken) {
    log.warn('FB_PAGE_ACCESS_TOKEN алга — сэтгэгдэлд хариулахыг алгаслаа', { path });
    return null;
  }

  const res = await fetch(graphUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, access_token: config.fb.pageAccessToken }),
  });

  const text = await res.text();
  if (!res.ok) {
    log.error('Сэтгэгдлийн Graph API алдаа', {
      path,
      status: res.status,
      body: text.slice(0, 400),
    });
    return null; // Сэтгэгдэлд хариулж чадаагүй нь ярианы урсгалыг зогсоох ёсгүй
  }
  return text ? JSON.parse(text) : null;
}

/**
 * Сэтгэгдэл бичсэн хүн рүү Messenger-ээр хувийн мессеж илгээнэ.
 * @param {string} commentId
 * @param {string} [message]
 */
export function sendPrivateReply(commentId, message = PRIVATE_REPLY) {
  return graphPost(`${commentId}/private_replies`, { message });
}

/**
 * Сэтгэгдэлд нийтээр харагдах хариу бичнэ.
 * @param {string} commentId
 * @param {string} [message]
 */
export function replyToComment(commentId, message = PUBLIC_REPLY) {
  return graphPost(`${commentId}/comments`, { message });
}

/**
 * Нэг сэтгэгдлийг боловсруулна.
 *
 * @param {object} value webhook-ийн changes[].value
 * @returns {Promise<{handled: boolean, reason?: string}>}
 */
export async function handleComment(value) {
  if (!config.fb.commentAutoReply) return { handled: false, reason: 'унтраалттай' };

  // Зөвхөн ШИНЭ сэтгэгдэл. Засварласан, устгасныг тоохгүй.
  if (value?.item !== 'comment' || value?.verb !== 'add') {
    return { handled: false, reason: 'сэтгэгдэл биш' };
  }

  const commentId = value.comment_id;
  if (!commentId) return { handled: false, reason: 'id алга' };

  // Page өөрөө бичсэн сэтгэгдэлд хариулбал өөртэйгөө ярьж, төгсгөлгүй
  // давталт үүснэ. Хуудасны ID мэдэхгүй бол ЭРСДЭЛ хийхгүй — зогсоно.
  const pageId = await getPageId();
  if (!pageId) {
    log.warn('Хуудасны ID тодорхойгүй тул сэтгэгдэлд хариулсангүй');
    return { handled: false, reason: 'хуудасны ID тодорхойгүй' };
  }

  const fromId = String(value.from?.id ?? '');
  if (fromId === pageId) {
    return { handled: false, reason: 'өөрийн сэтгэгдэл' };
  }

  // Facebook сэтгэгдэл бүрд НЭГ л private reply зөвшөөрдөг. Мөн webhook
  // давхардаж ирдэг тул нэг удаа л боловсруулна.
  const fresh = await kvClaim(`comment:${commentId}`, CLAIM_TTL_SECONDS);
  if (!fresh) return { handled: false, reason: 'аль хэдийн хариулсан' };

  const priv = await sendPrivateReply(commentId);

  // Нийтийн хариуг зөвхөн хувийн мессеж амжилттай очсон үед бичнэ —
  // эс бөгөөс "мессеж илгээлээ" гэж худал хэлнэ.
  if (priv && config.fb.commentPublicReply) {
    await replyToComment(commentId);
  }

  log.info('Сэтгэгдэлд хариуллаа', {
    commentId,
    privateOk: Boolean(priv),
    publicReply: Boolean(priv && config.fb.commentPublicReply),
  });

  return { handled: Boolean(priv) };
}
