/**
 * Спам хамгаалалт.
 *
 * Асуудал: нэг хэрэглэгч 100 мессеж хурдан бичвэл бот 100 удаа Claude руу
 * хандаж, токен, мөнгө үрнэ. Хоёр давхар хамгаалалт хийнэ:
 *
 *   1. НЭГТГЭХ (handler.js) — дараалсан мессежүүдийг нэг ээлж болгож нийлүүлнэ.
 *   2. ХЯЗГААРЛАХ (энэ файл) — хэт олон бичвэл түр зогсооно.
 *
 * Хязгаарт хүрсэн хэрэглэгчид НЭГ л удаа мэдэгдэл очно, дараа нь чимээгүй
 * болно — эс бөгөөс сануулга өөрөө спам болно.
 */
import { kvClaim, kvIncr } from './store.js';
import { log, maskPsid } from './logger.js';

export const LIMITS = {
  /** Нэг минутад хэдэн мессеж зөвшөөрөх вэ */
  perMinute: 12,
  /** Нэг цагт хэдэн мессеж */
  perHour: 80,
  /** Нэг өдөрт хэдэн мессеж */
  perDay: 200,
  /** Хязгаар хэтэрсэн үед хэдэн секунд чимээгүй байх вэ */
  cooldownSeconds: 180,
};

/**
 * Хэрэглэгчийн хурдыг шалгана.
 * @param {string} psid
 * @returns {Promise<{allowed: boolean, warn: boolean, scope?: string}>}
 *   allowed — боловсруулж болох эсэх
 *   warn    — хэрэглэгчид сануулга илгээх эсэх (зөвхөн эхний удаа true)
 */
export async function checkRateLimit(psid) {
  const [minute, hour, day] = await Promise.all([
    kvIncr(`rate:m:${psid}`, 60),
    kvIncr(`rate:h:${psid}`, 3600),
    kvIncr(`rate:d:${psid}`, 86400),
  ]);

  let scope = null;
  if (day > LIMITS.perDay) scope = 'day';
  else if (hour > LIMITS.perHour) scope = 'hour';
  else if (minute > LIMITS.perMinute) scope = 'minute';

  if (!scope) return { allowed: true, warn: false };

  // Сануулгыг cooldown бүрт нэг л удаа илгээнэ
  const warn = await kvClaim(`rate:warned:${psid}`, LIMITS.cooldownSeconds);

  log.warn('Хурдны хязгаар хэтэрлээ', {
    psid: maskPsid(psid),
    scope,
    minute,
    hour,
    day,
    warned: warn,
  });

  return { allowed: false, warn, scope };
}

/** Хязгаарт хүрсэн хэрэглэгчид илгээх мессеж */
export function rateLimitMessage(scope) {
  if (scope === 'day') {
    return (
      'Өнөөдөр хэт олон мессеж илгээлээ. Маргааш дахин бичих боломжтой.\n' +
      'Яаралтай бол сургуулийн утас 7011-8584 руу залгаарай.'
    );
  }
  return (
    'Түр хүлээнэ үү — хэт олон мессеж хурдан ирлээ 🙂\n' +
    'Хэдэн минутын дараа дахин бичээрэй, эсвэл 7011-8584 руу залгаарай.'
  );
}
