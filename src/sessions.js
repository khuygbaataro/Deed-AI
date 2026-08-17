import { config } from './config.js';
import { log } from './logger.js';

/**
 * Хэрэглэгч бүрийн ярианы түүхийг санах ойд хадгална.
 * Тэмдэглэл: процесс дахин эхлэхэд түүх арилна. Олон instance ажиллуулах,
 * эсвэл яриаг удаан хадгалах шаардлагатай бол энэ модулийг Redis/Postgres-ээр солино.
 * @type {Map<string, {messages: Array, updatedAt: number, handedOver: boolean, greeted: boolean}>}
 */
const store = new Map();

function fresh() {
  return { messages: [], updatedAt: Date.now(), handedOver: false, greeted: false };
}

/** @returns {{messages: Array, updatedAt: number, handedOver: boolean, greeted: boolean}} */
export function getSession(psid) {
  const ttlMs = config.session.ttlMinutes * 60_000;
  const existing = store.get(psid);

  if (existing && Date.now() - existing.updatedAt < ttlMs) return existing;

  const session = fresh();
  store.set(psid, session);
  return session;
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

/** Ярианы түүхэнд мессеж нэмээд, хэт уртсахаас сэргийлж тайрна */
export function appendMessages(psid, ...messages) {
  const session = getSession(psid);
  if (messages.length) session.messages.push(...messages);
  session.updatedAt = Date.now();
  return trimSession(psid);
}

/**
 * Түүхийг сүүлийн N ээлжид багтаан тайрна.
 * Таслах цэг нь заавал жинхэнэ хэрэглэгчийн мессеж байх ёстой —
 * assistant мессеж эсвэл tool_result дээр таславал Claude API алдаа өгнө.
 */
export function trimSession(psid) {
  const session = getSession(psid);
  const limit = config.session.maxTurns * 2;
  if (session.messages.length <= limit) return session;

  let cut = session.messages.length - limit;
  while (
    cut < session.messages.length &&
    (session.messages[cut].role !== 'user' || hasToolResult(session.messages[cut]))
  ) {
    cut += 1;
  }

  // Тохирох таслах цэг олдоогүй бол түүхийг бүхэлд нь хадгална (дараагийн ээлжид дахин оролдоно)
  if (cut >= session.messages.length) return session;

  session.messages = session.messages.slice(cut);
  return session;
}

export function resetSession(psid) {
  store.set(psid, fresh());
}

export function setHandedOver(psid, value) {
  getSession(psid).handedOver = value;
}

export function stats() {
  return { sessions: store.size };
}

/** Хугацаа нь дууссан болон илүүдэл сессүүдийг цэвэрлэнэ */
export function pruneSessions() {
  const ttlMs = config.session.ttlMinutes * 60_000;
  const now = Date.now();
  let removed = 0;

  for (const [psid, session] of store) {
    if (now - session.updatedAt >= ttlMs) {
      store.delete(psid);
      removed += 1;
    }
  }

  // Санах ой хамгаалалт: хэт олон сесс хуримтлагдвал хамгийн хуучныг нь хаяна
  if (store.size > config.session.maxSessions) {
    const sorted = [...store.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt);
    const excess = store.size - config.session.maxSessions;
    for (let i = 0; i < excess; i += 1) {
      store.delete(sorted[i][0]);
      removed += 1;
    }
  }

  if (removed) log.debug('Сесс цэвэрлэлээ', { removed, remaining: store.size });
}

/** Тодорхой давтамжтайгаар цэвэрлэгээ ажиллуулна */
export function startSessionCleanup(intervalMs = 5 * 60_000) {
  const timer = setInterval(pruneSessions, intervalMs);
  timer.unref?.();
  return timer;
}
