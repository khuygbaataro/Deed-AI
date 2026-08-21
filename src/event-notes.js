/**
 * Ботын мэдэхгүй асуултад бичсэн ХАРИУЛТУУД.
 *
 * Ажиллагаа: бот мэдэхгүй асуулт бүрийг events.js-д бүртгэнэ → ажилтан энэ
 * модулиар зөв хариултыг нь бичнэ → бүгдийг нэг дор Markdown болгон гаргаж
 * knowledge/ хавтсанд нэмнэ.
 *
 * Ингэснээр "бот юуг мэдэхгүй байна?" гэсэн жагсаалт нь шууд
 * "мэдлэгийн санд нэмэх ажлын жагсаалт" болно.
 *
 * Хариултууд нь үйл явдлаас ТУСДАА хадгалагдана: үйл явдал 30 хоногийн
 * дараа устдаг ч хариулт үлдэх ёстой.
 */
import { kvGet, kvSet } from './store.js';
import { log } from './logger.js';

const KEY = 'event:answers';
const TTL_SECONDS = 365 * 24 * 60 * 60; // 1 жил
const MAX_ANSWERS = 500;

/** Хариултын явц */
export const ANSWER_STATUSES = {
  open: 'Хариулаагүй',
  answered: 'Хариулт бичсэн',
  added: 'Мэдлэгийн санд нэмсэн',
  ignored: 'Хамаарахгүй',
};

/**
 * Асуултыг бүлэглэхэд ашиглах түлхүүр.
 *
 * Ижил асуултыг өөр өөрөөр бичдэг ("төлбөр хэд вэ", "Төлбөр хэд вэ?") тул
 * жижиг үсэг, илүү зай, төгсгөлийн цэг таслалыг арилгаж жиших.
 */
export function questionKey(question) {
  return String(question ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[?!.,;:"'`«»]+$/g, '')
    .trim()
    .slice(0, 200);
}

/** Бүх хариултыг авах (түлхүүр → бичлэг) */
export async function listAnswers() {
  const stored = await kvGet(KEY);
  return stored && typeof stored === 'object' ? stored : {};
}

/**
 * Нэг асуултын хариултыг хадгална.
 * @param {string} key questionKey()-ээс гарсан түлхүүр
 * @param {{question?: string, answer?: string, status?: string}} input
 */
export async function saveAnswer(key, { question, answer, status } = {}) {
  if (!key) return null;

  const all = await listAnswers();
  const current = all[key] ?? { question: question ?? key, answer: '', status: 'open' };

  const next = {
    ...current,
    question: question ?? current.question,
    updatedAt: new Date().toISOString(),
  };

  if (typeof answer === 'string') {
    next.answer = answer.trim().slice(0, 2000);
    // Хариулт бичсэн бол явцыг автоматаар ахиулна — ажилтан
    // хоёр талбар дүүргэх шаардлагагүй.
    if (next.answer && current.status === 'open') next.status = 'answered';
    if (!next.answer && next.status === 'answered') next.status = 'open';
  }
  if (status && ANSWER_STATUSES[status]) next.status = status;

  all[key] = next;

  // Хэт олон болвол хамгийн хуучин, хариулаагүйг нь хасна
  const keys = Object.keys(all);
  if (keys.length > MAX_ANSWERS) {
    const drop = keys
      .filter((k) => all[k].status === 'open' && !all[k].answer)
      .sort((a, b) => String(all[a].updatedAt).localeCompare(String(all[b].updatedAt)))
      .slice(0, keys.length - MAX_ANSWERS);
    for (const k of drop) delete all[k];
  }

  try {
    await kvSet(KEY, all, TTL_SECONDS);
  } catch (err) {
    log.warn('Хариулт хадгалж чадсангүй', { error: err.message });
    return null;
  }

  return next;
}

/**
 * Хариултуудыг мэдлэгийн санд шууд наах Markdown болгоно.
 *
 * Зөвхөн хариулт бичигдсэн зүйлсийг гаргана — хоосон гарчиг нэмэх нь
 * ботыг андуурна.
 *
 * @param {Record<string, object>} answers
 * @param {Record<string, number>} counts асуулт тус бүр хэдэн удаа ирсэн
 */
export function toMarkdown(answers, counts = {}) {
  const rows = Object.entries(answers)
    .filter(([, a]) => a.answer && a.status !== 'ignored')
    .sort((a, b) => (counts[b[0]] ?? 0) - (counts[a[0]] ?? 0));

  if (!rows.length) {
    return '# Шинэ хариултууд\n\n(Хариулт хараахан бичигдээгүй байна.)\n';
  }

  const NL = String.fromCharCode(10);
  const out = [
    '# Ботын мэдэхгүй байсан асуултуудын хариулт',
    '',
    '> Энэ файлыг `knowledge/` хавтсанд хадгалахад бот дараагаас эдгээрт',
    '> хариулж чадна. Агуулгыг нь сургуулиас баталгаажуулсны ДАРАА нэмнэ үү.',
    '',
    '_Гаргасан: ' + new Date().toISOString().slice(0, 10) + '_',
    '',
    '---',
    '',
  ];

  for (const [key, a] of rows) {
    const n = counts[key] ?? 0;
    out.push('## ' + (a.question || key));
    out.push('');
    if (n > 1) out.push('_' + n + ' хүн асуусан._');
    else if (n === 1) out.push('_1 хүн асуусан._');
    if (n) out.push('');
    out.push(a.answer);
    out.push('');
  }

  return out.join(NL);
}
