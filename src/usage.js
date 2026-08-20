/**
 * Токен зарцуулалт, зардлын хяналт.
 *
 * "Өдөрт хэдэн доллар зарцуулж байна, яагаад?" гэдгийг таамаглахгүй,
 * бодит тоогоор харах зорилготой. Өдөр тутмын нийлбэрийг Redis-д хадгална.
 *
 * Кэш ажиллаж байгаа эсэх нь ХАМГИЙН чухал үзүүлэлт — кэш алдвал ижил
 * хүсэлт 10 дахин үнэтэй болно.
 */
import { kvGet, kvSet } from './store.js';
import { log } from './logger.js';

/**
 * Загвар бүрийн үнэ (1 сая токен тутамд, ам.доллар).
 * Загвар солиход энд нэмнэ.
 */
const PRICING = {
  'claude-sonnet-5': { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  'claude-opus-5': { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  'claude-haiku-4-5-20251001': { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
};

const DEFAULT_PRICING = PRICING['claude-sonnet-5'];
const TTL_SECONDS = 60 * 24 * 60 * 60; // 60 хоног

const dayKey = () => `usage:${new Date().toISOString().slice(0, 10)}`;

/**
 * Нэг API дуудлагын зардлыг тооцоолно.
 * @param {string} model
 * @param {{input_tokens?: number, output_tokens?: number,
 *          cache_creation_input_tokens?: number, cache_read_input_tokens?: number}} usage
 */
export function estimateCost(model, usage = {}) {
  const price = PRICING[model] ?? DEFAULT_PRICING;
  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;

  return (
    (input * price.input +
      output * price.output +
      cacheWrite * price.cacheWrite +
      cacheRead * price.cacheRead) /
    1_000_000
  );
}

/**
 * Дуудлагын зарцуулалтыг өдрийн нийлбэрт нэмнэ.
 * @param {string} model
 * @param {object} usage Claude-ийн буцаасан usage объект
 */
export async function recordUsage(model, usage = {}) {
  const cost = estimateCost(model, usage);
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const freshInput = usage.input_tokens ?? 0;

  // Кэш ажилласан эсэх — хамгийн чухал үзүүлэлт
  const cacheHit = cacheRead > 0;

  log.info('Токен зарцуулалт', {
    model,
    in: freshInput,
    out: usage.output_tokens ?? 0,
    cacheRead,
    cacheWrite,
    cacheHit,
    usd: Number(cost.toFixed(5)),
  });

  try {
    const key = dayKey();
    const current = (await kvGet(key)) ?? {
      calls: 0,
      cacheHits: 0,
      cacheMisses: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      usd: 0,
    };

    current.calls += 1;
    if (cacheHit) current.cacheHits += 1;
    else current.cacheMisses += 1;
    current.inputTokens += freshInput;
    current.outputTokens += usage.output_tokens ?? 0;
    current.cacheReadTokens += cacheRead;
    current.cacheWriteTokens += cacheWrite;
    current.usd = Number((current.usd + cost).toFixed(4));

    await kvSet(key, current, TTL_SECONDS);
  } catch (err) {
    log.warn('Зарцуулалт бүртгэж чадсангүй', { error: err.message });
  }
}

/**
 * Өнөөдрийн зарцуулалтыг авах.
 * @returns {Promise<object|null>}
 */
export async function todayUsage() {
  const data = await kvGet(dayKey());
  if (!data) return null;

  const hitRate = data.calls ? Math.round((data.cacheHits / data.calls) * 100) : 0;
  return {
    ...data,
    cacheHitRate: `${hitRate}%`,
    usdPerCall: data.calls ? Number((data.usd / data.calls).toFixed(5)) : 0,
  };
}
