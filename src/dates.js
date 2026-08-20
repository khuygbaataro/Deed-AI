/**
 * Огнооны туслах — Улаанбаатарын цагаар.
 *
 * Яагаад хэрэгтэй вэ: элсэгч "маргааш очъё" гэж хэлдэг. Түүнийг тэр чигээр
 * нь хадгалвал элсэлтийн ажилтан маргааш тайланг хараад ЯМАР ӨДӨР болохыг
 * мэдэхгүй. Тиймээс харьцангуй өдрийг бодит огноо болгож хадгална.
 *
 * Сервер UTC-ээр ажилладаг тул Улаанбаатарын цагийг гараар тооцно.
 */

const TZ_OFFSET_HOURS = 8; // Улаанбаатар UTC+8, зуны цаг хэрэглэдэггүй

export const WEEKDAYS = ['Ням', 'Даваа', 'Мягмар', 'Лхагва', 'Пүрэв', 'Баасан', 'Бямба'];

/** Улаанбаатарын одоогийн огноо, YYYY-MM-DD */
export function today(base = new Date()) {
  return new Date(base.getTime() + TZ_OFFSET_HOURS * 3600_000).toISOString().slice(0, 10);
}

/** Тухайн огнооны гарагийн дугаар (0 = Ням) */
export function weekdayIndex(isoDate) {
  return new Date(`${isoDate}T00:00:00Z`).getUTCDay();
}

/** Огноог N хоногоор шилжүүлнэ */
export function shift(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "2026-08-22 (Баасан)" */
export function format(isoDate) {
  return `${isoDate} (${WEEKDAYS[weekdayIndex(isoDate)]})`;
}

/** Системийн промптод оруулах мөр */
export function todayLine(base = new Date()) {
  return `Өнөөдөр: ${format(today(base))}`;
}

/**
 * Хэрэглэгчийн хэлсэн өдрийг бодит огноо болгоно.
 *
 * Ойлгодог хэлбэрүүд:
 *   өнөөдөр · маргааш · нөгөөдөр
 *   Даваа / Мягмар ... (хамгийн ойрын тэр гараг, өнөөдөр байж болно)
 *   "8-р сарын 25" · "8 сарын 25"
 *
 * @param {string} text
 * @param {Date} [base]
 * @returns {{date: string, weekday: string, label: string}|null}
 *          Танихгүй бол null — ТААМАГЛАХГҮЙ.
 */
export function resolveDay(text, base = new Date()) {
  if (typeof text !== 'string' || text.trim() === '') return null;

  const t = text.toLowerCase().trim();
  const from = today(base);
  let date = null;

  if (/өнөөдөр|onoodor/.test(t)) date = from;
  else if (/нөгөөдөр|nogoodor|nuguudur/.test(t)) date = shift(from, 2);
  else if (/маргааш|margaash/.test(t)) date = shift(from, 1);

  if (!date) {
    // "8-р сарын 25", "8 сарын 25"
    const m = t.match(/(\d{1,2})\s*-?\s*р?\s*сар[а-яё]*\s*(\d{1,2})/);
    if (m) {
      const month = Number(m[1]);
      const day = Number(m[2]);
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        const year = Number(from.slice(0, 4));
        const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        // Огноо аль хэдийн өнгөрсөн бол дараа жилийнх гэж үзнэ
        date = iso >= from ? iso : `${year + 1}${iso.slice(4)}`;
      }
    }
  }

  if (!date) {
    // Гарагийн нэр — хамгийн ойрын тэр гараг
    const index = WEEKDAYS.findIndex((w) => t.includes(w.toLowerCase()));
    if (index >= 0) {
      const diff = (index - weekdayIndex(from) + 7) % 7;
      date = shift(from, diff);
    }
  }

  if (!date) return null;

  const weekday = WEEKDAYS[weekdayIndex(date)];
  return { date, weekday, label: `${date} (${weekday})` };
}
