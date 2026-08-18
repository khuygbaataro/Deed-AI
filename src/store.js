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
const clean = (v) => {
  if (typeof v !== 'string') return null;
  // Зай, мөр таслалт, бүсэлсэн хашилтыг хасна ("https://..." гэж хуулсан тохиолдол)
  const trimmed = v.trim().replace(/^["']|["']$/g, '').trim();
  return trimmed === '' ? null : trimmed;
};

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


/**
 * Тоолуурыг нэмэгдүүлж, эхний удаад хугацаа тавина (Redis: INCR + EXPIRE).
 * Хурдны хязгаарлалтад ашиглана.
 * @returns {Promise<number>} шинэ утга
 */
export async function kvIncr(key, ttlSeconds) {
  try {
    if (kvDriver === 'redis') {
      const count = Number(await command(['INCR', key])) || 0;
      if (count === 1) await command(['EXPIRE', key, String(Math.round(ttlSeconds))]);
      return count;
    }
    const current = Number(memoryGet(key) ?? 0) + 1;
    const existing = memory.get(key);
    memory.set(key, {
      value: String(current),
      expiresAt: current === 1 || !existing ? Date.now() + ttlSeconds * 1000 : existing.expiresAt,
    });
    return current;
  } catch (err) {
    log.warn('kvIncr амжилтгүй', { key, error: err.message });
    return 0;
  }
}

/**
 * Жагсаалтыг бүтнээр нь уншаад цэвэрлэнэ (Redis: LRANGE + DEL).
 * Хэрэглэгчийн дараалсан мессежүүдийг нэг дор авахад ашиглана.
 * @returns {Promise<any[]>}
 */
export async function kvDrainList(listKey) {
  try {
    if (kvDriver === 'redis') {
      const items = await command(['LRANGE', listKey, '0', '-1']);
      await command(['DEL', listKey]);
      return (Array.isArray(items) ? items : []).map((raw) => {
        try {
          return JSON.parse(raw);
        } catch {
          return raw;
        }
      });
    }
    const list = memoryLists.get(listKey) ?? [];
    memoryLists.delete(listKey);
    return list.map((raw) => {
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    });
  } catch (err) {
    log.warn('kvDrainList амжилтгүй', { listKey, error: err.message });
    return [];
  }
}

/** @type {Map<string, Map<string, number>>} индекс: гишүүн -> оноо (timestamp) */
const memoryIndexes = new Map();

/**
 * Индекст гишүүн нэмэх/шинэчлэх (Redis: ZADD).
 * Хамгийн сүүлд өөрчлөгдсөнөөр эрэмбэлэхэд ашиглана.
 */
export async function kvIndexAdd(indexKey, member, score = Date.now()) {
  try {
    if (kvDriver === 'redis') {
      await command(['ZADD', indexKey, String(score), String(member)]);
    } else {
      const index = memoryIndexes.get(indexKey) ?? new Map();
      index.set(String(member), score);
      memoryIndexes.set(indexKey, index);
    }
    return true;
  } catch (err) {
    log.warn('kvIndexAdd амжилтгүй', { indexKey, error: err.message });
    return false;
  }
}

/**
 * Индексээс хамгийн сүүлийнхээс нь эхлэн жагсаана (Redis: ZRANGE REV).
 * @returns {Promise<string[]>}
 */
export async function kvIndexList(indexKey, limit = 200) {
  try {
    if (kvDriver === 'redis') {
      const result = await command([
        'ZRANGE',
        indexKey,
        '0',
        String(Math.max(0, limit - 1)),
        'REV',
      ]);
      return Array.isArray(result) ? result.map(String) : [];
    }
    const index = memoryIndexes.get(indexKey);
    if (!index) return [];
    return [...index.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([member]) => member);
  } catch (err) {
    log.warn('kvIndexList амжилтгүй', { indexKey, error: err.message });
    return [];
  }
}

/** Индексийн нийт гишүүний тоо (Redis: ZCARD) */
export async function kvIndexCount(indexKey) {
  try {
    if (kvDriver === 'redis') {
      const result = await command(['ZCARD', indexKey]);
      return Number(result) || 0;
    }
    return memoryIndexes.get(indexKey)?.size ?? 0;
  } catch {
    return 0;
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

/**
 * Redis үнэхээр хариулж байгаа эсэхийг шалгана.
 * driver === "redis" гэдэг нь зөвхөн хувьсагч байгааг л хэлнэ — токен буруу
 * байвал бүх үйлдэл чимээгүйхэн унаж, бот санах ойгүй мэт ажиллана.
 * @returns {Promise<{ok: boolean, latencyMs?: number, error?: string}>}
 */
export async function kvPing() {
  if (kvDriver !== "redis") return { ok: true, driver: "memory" };
  const started = Date.now();
  try {
    const result = await command(["PING"]);
    return { ok: String(result).toUpperCase() === "PONG", latencyMs: Date.now() - started };
  } catch (err) {
    return { ok: false, error: err.message.slice(0, 120) };
  }
}

export function storeStats() {
  return kvDriver === 'memory' ? { driver: 'memory', keys: memory.size } : { driver: 'redis' };
}
