/**
 * ЭЛСЭЛТИЙН ДҮРЭМ, ҮНЭ, ТООЦОО — нэг эх сурвалж.
 *
 * ⚠️ ЧУХАЛ: Хөнгөлөлт, эрх, үнийн тооцоог AI хийхгүй. Энэ файл дахь код л
 * тооцоолно. AI зөвхөн оюутнаас мэдээлэл цуглуулж, кодын гаргасан үр дүнг
 * дамжуулна. Ингэснээр бот хэн нэгэнд буруу тэтгэлэг амлах эрсдэлгүй.
 *
 * Үнэ, оноо өөрчлөгдвөл ЗӨВХӨН энэ файлыг засна.
 * Эх сурвалж: Захирлын 2024.04.16-ны 01/13 тоот тушаалын хавсралт 1.
 */

// ─── Төлбөр ──────────────────────────────────────────────────────────────
export const TUITION = {
  /** Жилийн үндсэн сургалтын төлбөр (₮) */
  baseAnnual: 5_500_000,
  /** Суудал баталгаажуулах хураамж — хөнгөлөлтөөс үл хамааран бүгд төлнө (₮) */
  seatDeposit: 300_000,
  currency: 'MNT',
};

// ─── Урамшуулал ──────────────────────────────────────────────────────────
export const INCENTIVES = {
  /** ЭЕШ-ийн босго оноог хангасан */
  qualified: {
    rate: 1.0,
    label: '100% тэтгэлэг',
    reason: 'ЭЕШ-ийн босго оноог хангасан',
  },
  /** Босго хүрээгүй ч элсэх сонирхолтой */
  standard: {
    rate: 0.2,
    label: '20% хөнгөлөлт',
    reason: 'ЭЕШ-ийн босго хүрээгүй ч элсэх боломжтой',
  },
};

/**
 * ЭЕШ-ийн бүлгүүдийг хэрхэн шалгах вэ?
 *   'all' — бүх бүлгийн шаардлагыг хангасан байх ёстой
 *   'any' — аль нэг бүлгийг хангасан бол хангалттай
 * Бүлэг доторх хичээлүүдээс АЛЬ НЭГ нь босго оноог давахад тухайн бүлэг хангагдана.
 *
 * ⚠️ ТОДРУУЛАХ: Тушаалын хүснэгтэд ЭЕШ хоёр баганаар өгөгдсөн. Хоёуланг нь
 * хангах ёстой юу, эсвэл аль нэгээр нь элсэх боломжтой юу гэдгийг элсэлтийн
 * комиссоос баталгаажуулна уу. Одоогоор 'all' гэж үзсэн.
 */
export const EXAM_RULE_MODE = 'all';

// ─── Хөтөлбөрүүд ─────────────────────────────────────────────────────────
/**
 * examGroups: тушаалын хүснэгтийн ЭЕШ багана бүр нэг бүлэг.
 * inDemand: Засгийн газрын 115-р тогтоолын ЭРЭЛТТЭЙ мэргэжлийн жагсаалтад багтсан.
 */
export const PROGRAMS = [
  {
    id: 'software',
    name: 'Программ хангамж',
    code: '061302',
    inDemand: true,
    examGroups: [
      { subjects: ['Математик', 'Физик'], minScore: 490 },
      { subjects: ['Нийгэм судлал', 'Англи хэл'], minScore: 450 },
    ],
  },
  {
    id: 'software-2plus2',
    name: 'Программ хангамж 2+2',
    code: '061302',
    inDemand: true,
    examGroups: [
      { subjects: ['Математик', 'Физик'], minScore: 490 },
      { subjects: ['Нийгэм судлал', 'Англи хэл'], minScore: 450 },
    ],
  },
  {
    id: 'tourism',
    name: 'Аялал жуулчлал',
    code: '101501',
    inDemand: true,
    examGroups: [
      { subjects: ['Газар зүй', 'Математик', 'Англи хэл'], minScore: 490 },
      { subjects: ['Ур чадварын шалгалт'], minScore: 490 },
    ],
  },
  {
    id: 'translation',
    name: 'Гадаад хэлний орчуулга',
    code: '023101',
    inDemand: false,
    examGroups: [
      { subjects: ['Англи хэл', 'Орос хэл', 'Математик'], minScore: 490 },
      { subjects: ['Нийгэм судлал', 'Монгол хэл', 'Түүх'], minScore: 490 },
    ],
  },
  {
    id: 'area-studies',
    name: 'Олон улс, орон судлал',
    code: '022203',
    inDemand: false,
    examGroups: [
      { subjects: ['Англи хэл', 'Орос хэл'], minScore: 490 },
      { subjects: ['Нийгэм судлал', 'Түүх'], minScore: 490 },
    ],
  },
  {
    id: 'economics',
    name: 'Эдийн засаг',
    code: '031101',
    inDemand: false,
    examGroups: [
      { subjects: ['Математик'], minScore: 490 },
      { subjects: ['Нийгэм судлал', 'Англи хэл'], minScore: 490 },
    ],
  },
];

/** Хөтөлбөрийг id эсвэл нэрээр нь олох */
export function findProgram(idOrName) {
  if (!idOrName) return null;
  const needle = String(idOrName).trim().toLowerCase();
  return (
    PROGRAMS.find((p) => p.id === needle) ||
    PROGRAMS.find((p) => p.name.toLowerCase() === needle) ||
    PROGRAMS.find((p) => p.name.toLowerCase().includes(needle)) ||
    null
  );
}

/** ₮ форматлах: 5500000 -> "5,500,000₮" */
export function formatMnt(amount) {
  return `${Math.round(amount).toLocaleString('en-US')}₮`;
}

/**
 * Элсэгчийн ЭЕШ оноог хөтөлбөрийн шаардлагатай тулгаж, урамшууллыг тооцно.
 *
 * @param {string} programIdOrName
 * @param {Array<{subject: string, score: number}>} scores
 * @returns {{
 *   ok: boolean, error?: string,
 *   program?: object, qualified?: boolean,
 *   groupResults?: Array<{subjects: string[], minScore: number, met: boolean, best: object|null}>,
 *   incentive?: object, baseAnnual?: number, discountAmount?: number,
 *   annualAfterDiscount?: number, seatDeposit?: number, summary?: string
 * }}
 */
export function evaluateApplicant(programIdOrName, scores) {
  const program = findProgram(programIdOrName);
  if (!program) {
    return { ok: false, error: `"${programIdOrName}" гэсэн хөтөлбөр олдсонгүй.` };
  }

  const normalized = (Array.isArray(scores) ? scores : [])
    .map((s) => ({
      subject: String(s?.subject ?? '').trim(),
      score: Number(s?.score),
    }))
    .filter((s) => s.subject && Number.isFinite(s.score));

  if (!normalized.length) {
    return { ok: false, error: 'ЭЕШ-ийн оноо өгөгдөөгүй байна.' };
  }

  // Бүлэг тус бүрийг шалгах: бүлэг доторх аль нэг хичээл босго давахад хангагдана
  const groupResults = program.examGroups.map((group) => {
    const matching = normalized.filter((s) =>
      group.subjects.some(
        (subject) =>
          subject.toLowerCase() === s.subject.toLowerCase() ||
          s.subject.toLowerCase().includes(subject.toLowerCase()),
      ),
    );
    const best = matching.reduce((a, b) => (!a || b.score > a.score ? b : a), null);
    return {
      subjects: group.subjects,
      minScore: group.minScore,
      met: Boolean(best && best.score >= group.minScore),
      best,
    };
  });

  const qualified =
    EXAM_RULE_MODE === 'any'
      ? groupResults.some((g) => g.met)
      : groupResults.every((g) => g.met);

  const incentive = qualified ? INCENTIVES.qualified : INCENTIVES.standard;
  const discountAmount = Math.round(TUITION.baseAnnual * incentive.rate);
  const annualAfterDiscount = TUITION.baseAnnual - discountAmount;

  const summary =
    `${program.name}: ${incentive.label} (${incentive.reason}). ` +
    `Жилийн төлбөр ${formatMnt(TUITION.baseAnnual)} → ` +
    `${formatMnt(annualAfterDiscount)}. ` +
    `Суудал баталгаажуулах хураамж ${formatMnt(TUITION.seatDeposit)}.`;

  return {
    ok: true,
    program,
    qualified,
    groupResults,
    incentive,
    baseAnnual: TUITION.baseAnnual,
    discountAmount,
    annualAfterDiscount,
    seatDeposit: TUITION.seatDeposit,
    summary,
  };
}

/** Ботод харуулах хөтөлбөрийн жагсаалт (промптод оруулна) */
export function programListText() {
  return PROGRAMS.map((p) => {
    const groups = p.examGroups
      .map((g) => `${g.subjects.join(' / ')} — ${g.minScore}+`)
      .join('; ');
    return `- ${p.name} (код ${p.code})${p.inDemand ? ' [ЭРЭЛТТЭЙ мэргэжил]' : ''}: ЭЕШ ${groups}`;
  }).join('\n');
}
