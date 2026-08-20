/**
 * Анхаарах үйл явдлын байнгын бүртгэл.
 *
 * Vercel-ийн лог хэдхэн цагийн дараа арилдаг тул "бот хэр их алдаа гаргаж
 * байна", "юуг мэдэхгүй байна" гэдгийг хойшид харах боломжгүй байсан.
 * Энэ модуль тэдгээрийг Redis-д хадгалж, /admin самбарт харуулна.
 *
 * Зөвхөн АСУУДЛЫГ бүртгэнэ — хэвийн яриаг бүртгэхгүй (хувийн мэдээлэл
 * шаардлагагүй хуримтлахаас сэргийлж).
 */
import { kvGet, kvSet } from './store.js';
import { log, maskPsid } from './logger.js';

const KEY = 'events:recent';
const MAX_EVENTS = 200;
const TTL_SECONDS = 30 * 24 * 60 * 60; // 30 хоног

/** Үйл явдлын төрөл — самбарт ойлгомжтой нэрээр харагдана */
export const EVENT_TYPES = {
  missing_info: 'Мэдээлэл дутуу',
  ai_error: 'AI алдаа',
  tool_error: 'Хэрэгслийн алдаа',
  send_error: 'Мессеж илгээх алдаа',
  dropped: 'Мессеж боловсруулагдаагүй',
  rate_limited: 'Хурдны хязгаар',
};

/**
 * Үйл явдал бүртгэнэ.
 * @param {keyof EVENT_TYPES} type
 * @param {{psid?: string, question?: string, detail?: string}} data
 */
export async function recordEvent(type, data = {}) {
  const entry = {
    ts: new Date().toISOString(),
    type,
    psid: data.psid ? maskPsid(data.psid) : null,
    question: data.question ? String(data.question).slice(0, 300) : null,
    detail: data.detail ? String(data.detail).slice(0, 300) : null,
  };

  try {
    const list = (await kvGet(KEY)) ?? [];
    list.unshift(entry);
    await kvSet(KEY, list.slice(0, MAX_EVENTS), TTL_SECONDS);
  } catch (err) {
    log.warn('Үйл явдал бүртгэж чадсангүй', { type, error: err.message });
  }
}

/**
 * Сүүлийн AI алдааны техникийн тайлбар.
 * ЗӨВХӨН огноо, алдааны текст — хувийн мэдээлэл буцаахгүй тул
 * ил задгай /health хуудсанд харуулахад аюулгүй.
 * @returns {Promise<{ts: string, detail: string|null}|null>}
 */
export async function lastAiError() {
  const list = (await kvGet(KEY)) ?? [];
  const hit = list.find((ev) => ev.type === 'ai_error');
  return hit ? { ts: hit.ts, detail: hit.detail } : null;
}

/**
 * Сүүлийн үйл явдлуудыг авах.
 * @param {number} limit
 * @returns {Promise<Array>}
 */
export async function listEvents(limit = 60) {
  const list = (await kvGet(KEY)) ?? [];
  return list.slice(0, limit);
}

/** Төрөл тус бүрийн тоо */
export async function eventCounts() {
  const list = (await kvGet(KEY)) ?? [];
  const counts = {};
  for (const e of list) counts[e.type] = (counts[e.type] ?? 0) + 1;
  return { total: list.length, counts };
}
