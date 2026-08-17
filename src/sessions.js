import { config } from './config.js';
import { kvDelete, kvDriver, kvGet, kvSet, pruneMemory, storeStats } from './store.js';

/**
 * Хэрэглэгч бүрийн ярианы төлөвийг хадгална.
 * Хадгалалтын хөтөч нь store.js — Redis тохируулсан бол Redis, эс бөгөөс санах ой.
 *
 * ⚠️ Serverless (Vercel) дээр Redis ЗААВАЛ хэрэгтэй. Санах ойн хөтөч ашиглавал
 * дуудлага бүрт төлөв алдагдаж, бот өмнөх мессежийг санахгүй болно.
 */

const key = (psid) => `sess:${psid}`;
const ttlSeconds = () => config.session.ttlMinutes * 60;

function fresh() {
  return { messages: [], handedOver: false, greeted: false };
}

/**
 * @param {string} psid
 * @returns {Promise<{messages: Array, handedOver: boolean, greeted: boolean}>}
 */
export async function getSession(psid) {
  const stored = await kvGet(key(psid));
  if (!stored || !Array.isArray(stored.messages)) return fresh();
  return {
    messages: stored.messages,
    handedOver: Boolean(stored.handedOver),
    greeted: Boolean(stored.greeted),
  };
}

/** Сессийг хадгална (хэт урт түүхийг тайрсны дараа) */
export async function saveSession(psid, session) {
  const trimmed = { ...session, messages: trimMessages(session.messages) };
  await kvSet(key(psid), trimmed, ttlSeconds());
  return trimmed;
}

export async function resetSession(psid) {
  await kvDelete(key(psid));
}

export async function setHandedOver(psid, value) {
  const session = await getSession(psid);
  session.handedOver = value;
  await saveSession(psid, session);
}

/**
 * Мессеж нь tool_result блок агуулсан эсэх.
 * Ийм мессежээр түүх эхэлж болохгүй — өмнөх tool_use блокгүй бол API 400 өгнө.
 */
function hasToolResult(message) {
  return (
    Array.isArray(message?.content) &&
    message.content.some((block) => block?.type === 'tool_result')
  );
}

/**
 * Түүхийг сүүлийн N ээлжид багтаан тайрна.
 * Таслах цэг нь заавал жинхэнэ хэрэглэгчийн мессеж байх ёстой —
 * assistant мессеж эсвэл tool_result дээр таславал Claude API алдаа өгнө.
 * @param {Array} messages
 * @returns {Array}
 */
export function trimMessages(messages) {
  const limit = config.session.maxTurns * 2;
  if (!Array.isArray(messages) || messages.length <= limit) return messages ?? [];

  let cut = messages.length - limit;
  while (cut < messages.length && (messages[cut].role !== 'user' || hasToolResult(messages[cut]))) {
    cut += 1;
  }

  // Тохирох таслах цэг олдоогүй бол түүхийг бүхэлд нь үлдээнэ (дараагийн ээлжид дахин оролдоно)
  if (cut >= messages.length) return messages;
  return messages.slice(cut);
}

export function stats() {
  return storeStats();
}

/** Санах ойн хөтөч ашиглаж байгаа үед хугацаа дууссан түлхүүрүүдийг цэвэрлэнэ */
export function startSessionCleanup(intervalMs = 5 * 60_000) {
  if (kvDriver !== 'memory') return null;
  const timer = setInterval(pruneMemory, intervalMs);
  timer.unref?.();
  return timer;
}
