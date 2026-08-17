/**
 * Түр зуурын хадгалалт (KV).
 *
 * Redis тохируулсан бол Upstash Redis REST API-г ашиглана — Vercel зэрэг
 * serverless орчинд функцийн санах ой дуудлага бүрт цэвэрлэгддэг тул ЗААВАЛ хэрэгтэй.
 * Тохируулаагүй бол процессын санах ойд хадгална (локал сервер, VPS-д хангалттай).
 *
 * Дэмжигдэх орчны хувьсагчид (аль нэг хосыг нь):
 *   KV_REST_API_URL       + KV_REST_API_TOKEN        (Vercel Marketplace → Upstash)
 *   UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN (Upstash шууд)
 */
import { log } from './logger.js';

// Орчны хувьсагчийн үл үзэгдэх зайг цэвэрлэнэ (config.js-тэй ижил шалтгаанаар)
const clean = (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

const url = clean(process.env.KV_REST_API_URL) || clean(process.env.UPSTASH_REDIS_REST_URL);
const token = clean(process.env.KV_REST_API_TOKEN) || clean(process.env.UPSTASH_REDIS_REST_TOKEN);

export const kvDriver = url && token ? 'redis' : 'memory';

/** @type {Map<string, {value: string, expiresAt: number}>} */
const memory = new Map();
/** @type {Map<string, string[]>} */
const memoryLists = new Map();

function memoryGet(key) {
  const entry = memory.get(key);
  if (!entry) return null;
  if (entry.expiresAt && entry.expiresAt < Date.now()) {
    memory.delete(key);
    return null;
  }
  return entry.value;
}

/** Upstash REST руу нэг Redis команд илгээнэ */
async function command(args) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Redis ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  return data.result;
}

/**
 * Утга унших.
 * @returns {Promise<any|null>} JSON задлагдсан утга, эсвэл null
 */
export async function kvGet(key) {
  try {
    const raw = kvDriver === 'redis' ? await command(['GET', key]) : memoryGet(key);
    if (raw === null || raw === undefined) return null;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (err) {
    log.warn('kvGet амжилтгүй', { key, error: err.message });
    return null;
  }
}

/**
 * Утга бичих.
 * @param {string} key
 * @param {any} value JSON болгож хадгална
 * @param {number} ttlSeconds
 */
export async function kvSet(key, value, ttlSeconds) {
  const raw = JSON.stringify(value);
  try {
    if (kvDriver === 'redis') {
      await command(['SET', key, raw, 'EX', String(Math.max(1, Math.round(ttlSeconds)))]);
    } else {
      memory.set(key, { value: raw, expiresAt: Date.now() + ttlSeconds * 1000 });
    }
  } catch (err) {
    log.warn('kvSet амжилтгүй', { key, error: err.message });
  }
}

export async function kvDelete(key) {
  try {
    if (kvDriver === 'redis') await command(['DEL', key]);
    else memory.delete(key);
  } catch (err) {
    log.warn('kvDelete амжилтгүй', { key, error: err.message });
  }
}

/**
 * Түлхүүр урьд нь БАЙГААГҮЙ бол л бичнэ (SET NX).
 * Давхардсан webhook мессежийг шүүхэд ашиглана.
 * @returns {Promise<boolean>} true = анх удаа харлаа (боловсруулж болно)
 */
export async function kvClaim(key, ttlSeconds) {
  try {
    if (kvDriver === 'redis') {
      const result = await command(['SET', key, '1', 'NX', 'EX', String(Math.round(ttlSeconds))]);
      return result === 'OK';
    }
    if (memoryGet(key) !== null) return false;
    memory.set(key, { value: '1', expiresAt: Date.now() + ttlSeconds * 1000 });
    return true;
  } catch (err) {
    // Хадгалалт унасан үед мессежийг гээхээс алдаа давхарласан нь дээр
    log.warn('kvClaim амжилтгүй — мессежийг боловсруулна', { key, error: err.message });
    return true;
  }
}

/**
 * Жагсаалтад бичлэг нэмнэ (escalation, lead гэх мэт бүртгэл).
 * @returns {Promise<boolean>} амжилттай эсэх
 */
export async function kvAppend(listKey, value) {
  try {
    if (kvDriver === 'redis') {
      await command(['RPUSH', listKey, JSON.stringify(value)]);
    } else {
      const list = memoryLists.get(listKey) ?? [];
      list.push(JSON.stringify(value));
      if (list.length > 1000) list.shift();
      memoryLists.set(listKey, list);
    }
    return true;
  } catch (err) {
    log.warn('kvAppend амжилтгүй', { listKey, error: err.message });
    return false;
  }
}

/** Санах ойн хөтчийн хугацаа дууссан түлхүүрүүдийг цэвэрлэнэ */
export function pruneMemory() {
  if (kvDriver !== 'memory') return;
  const now = Date.now();
  for (const [key, entry] of memory) {
    if (entry.expiresAt && entry.expiresAt < now) memory.delete(key);
  }
}

export function storeStats() {
  return kvDriver === 'memory' ? { driver: 'memory', keys: memory.size } : { driver: 'redis' };
}
