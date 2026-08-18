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
  seatDeposit: 500_000,
  currency: 'MNT',
};

// ─── Хөнгөлөлт, тэтгэлгийн бодлого ───────────────────────────────────────
/**
 * Эх сурвалж: 2026-2027 оны элсэлтийн "Тэтгэлэг, хөнгөлөлтийн бодлого" зурагт хуудас.
 *
 * depositDeductible — суудлын хураамж сургалтын төлбөрөөс хасагдах эсэх:
 *   false → хураамж нь төлбөрөөс ТУСДАА (100% хөнгөлөлтөд хасах төлбөр байхгүй)
 *   true  → хураамж нь ХӨНГӨЛСӨН дүнгээс хасагдана
 */
export const INCENTIVES = {
  /** 1. Орон нутгийн элсэгчдэд */
  rural_full: {
    id: 'rural_full',
    rate: 1.0,
    label: '100% хөнгөлөлт',
    reason: 'Орон нутгаас элсэж, ЭЕШ-ийн босго онооны шаардлагыг хангасан',
    note: 'Бакалаврын бүх хөтөлбөрт хамаарна. 2026-2027 оны хичээлийн жилийн төлбөр.',
    depositDeductible: false,
  },
  /** Улаанбаатарын элсэгчид, ЭЕШ-ийн босго хангасан */
  urban_half: {
    id: 'urban_half',
    rate: 0.5,
    label: '50% хөнгөлөлт',
    reason: 'Улаанбаатараас элсэж, ЭЕШ-ийн босго онооны шаардлагыг хангасан',
    note: '2026-2027 оны хичээлийн жилийн төлбөр.',
    depositDeductible: true,
  },
  /** 3. "30+" хөтөлбөр */
  thirty_plus: {
    id: 'thirty_plus',
    rate: 0.5,
    label: '50% хөнгөлөлт',
    reason: '"30+" хөтөлбөр — 30-аас дээш настай, мэргэжлээрээ 2-оос дээш жил ажилласан',
    note: 'ЭЕШ-ийн оноогүй байж болно. Эчнээ болон зайн сургалтаар бакалаврын зэрэг олгоно.',
    depositDeductible: true,
  },
  /** 4. Хоёр дахь мэргэжлийн хөтөлбөр */
  second_degree: {
    id: 'second_degree',
    rate: 0.5,
    label: '50% хөнгөлөлт',
    reason: 'Хоёр дахь мэргэжлийн хөтөлбөр — бакалаврын зэрэгтэй иргэн',
    note: 'Оройн, эчнээ болон зайн хэлбэрээр элсүүлнэ. ЭЕШ шаардахгүй — өмнөх бакалаврын боловсрол хангалттай.',
    depositDeductible: true,
  },
  /** 5. Магистрын хөтөлбөр (орон нутгийн) */
  master_rural: {
    id: 'master_rural',
    rate: 0.4,
    label: '40% хөнгөлөлт',
    reason: 'Орон нутгаас магистрын хөтөлбөрт элсэгч',
    note: '2026-2027 оны хичээлийн жилийн төлбөр.',
    depositDeductible: true,
  },
  /** 2. Бэлтгэл ангийн хөтөлбөр */
  prep_class: {
    id: 'prep_class',
    rate: 0.2,
    label: '20% хөнгөлөлт',
    reason: 'Бэлтгэл ангийн хөтөлбөр — ЭЕШ-ийн босго онооны шаардлага хангаагүй',
    note: 'Эчнээ сургалтад сурах явцад ЭЕШ-д бэлтгэх сургалтад хамруулна.',
    depositDeductible: true,
  },
  /** Аль ч хөнгөлөлтөд хамрагдаагүй */
  none: {
    id: 'none',
    rate: 0,
    label: 'Хөнгөлөлтгүй',
    reason: 'Дээрх хөнгөлөлтийн аль нэгэнд хамрагдах нөхцөл бүрдээгүй',
    note: 'Элсэлтийн албанаас нэмэлт боломжийг лавлана уу.',
    depositDeductible: true,
  },
};

/**
 * Элсэгчийн нөхцөл байдлаас хамаарч хамрагдах БҮХ хөнгөлөлтийг олоод,
 * хамгийн өндөр хувьтайг нь буцаана.
 *
 * @param {{
 *   level?: 'bachelor'|'master',
 *   isRural?: boolean,      // орон нутгаас элсэж байгаа эсэх
 *   meetsEesh?: boolean,    // ЭЕШ-ийн босго хангасан эсэх
 *   hasEesh?: boolean,      // ЭЕШ өгсөн эсэх
 *   age?: number,
 *   workYears?: number,     // мэргэжлээрээ ажилласан жил
 *   hasBachelor?: boolean,  // бакалаврын зэрэгтэй эсэх
 * }} profile
 * @returns {{best: object, eligible: object[]}}
 */
export function determineIncentive(profile = {}) {
  const {
    level = 'bachelor',
    isRural = false,
    meetsEesh = false,
    hasEesh = true,
    age = null,
    workYears = null,
    hasBachelor = false,
  } = profile;

  const eligible = [];

  if (level === 'master') {
    if (isRural) eligible.push(INCENTIVES.master_rural);
  } else {
    if (meetsEesh) {
      eligible.push(isRural ? INCENTIVES.rural_full : INCENTIVES.urban_half);
    }
    if (!meetsEesh) eligible.push(INCENTIVES.prep_class);
  }

  if (hasBachelor) eligible.push(INCENTIVES.second_degree);
  if (!hasEesh && Number(age) >= 30 && Number(workYears) >= 2) {
    eligible.push(INCENTIVES.thirty_plus);
  }

  const best = eligible.reduce((a, b) => (!a || b.rate > a.rate ? b : a), null);
  return { best: best ?? INCENTIVES.none, eligible };
}

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

/**
 * БҮХ хөтөлбөрт нэмэлтээр тавигдах шаардлага.
 * Хөтөлбөрийн 2 багана дээр нэмээд Монгол хэлний ЭЕШ 490+ байх ёстой —
 * нэг ёсондоо 3 хичээл бүгд босгыг давсан байж байж албан ёсоор
 * элсэх, улмаар 100% хөнгөлөлтөд хамрагдах боломжтой.
 */
export const UNIVERSAL_EXAM_GROUP = { subjects: ['Монгол хэл'], minScore: 490 };

/** Хөтөлбөрийн бүх шаардлага (тухайн хөтөлбөрийнх + бүх нийтийн) */
export function examGroupsFor(program) {
  return [...program.examGroups, UNIVERSAL_EXAM_GROUP];
}

// ─── Төлбөр хүлээн авах данс ────────────────────────────────────────────
/**
 * Суудлын хураамжийг банкны шилжүүлгээр хүлээн авах мэдээлэл.
 * Гүйлгээний утгад ЭЛСЭГЧИЙН БҮТЭН НЭРИЙГ бичнэ — үүгээр төлбөрийг
 * тухайн хүүхэдтэй тулгана.
 *
 * БӨГЛӨХ: гурван талбарыг бөглөх хүртэл бот дансны мэдээлэл өгөхгүй.
 */
export const BANK_ACCOUNT = {
  bankName: 'Худалдаа Хөгжлийн банк',
  accountNumber: '499034349',
  // ⚠️ БАТАЛГААЖУУЛАХ: сургуулиас "IBAN 300004000" гэж ирсэн. Монголын IBAN нь
  // ихэвчлэн банкны код + дансны дугаараас бүрддэг тул бүтэн хэлбэр нь
  // 300004000499034349 байх магадлалтай. Эхний гүйлгээгээр шалгана уу.
  iban: '300004000499034349',
  // ⚠️ БАТАЛГААЖУУЛАХ: хүлээн авагчийн нэрийг сургуулиас тодруулаагүй.
  accountName: 'Соёл Эрдэм Дээд Сургууль',
};

export const isBankConfigured = () =>
  Boolean(BANK_ACCOUNT.bankName && BANK_ACCOUNT.accountNumber && BANK_ACCOUNT.accountName);

// ─── Хөтөлбөрийн танилцуулга зураг ──────────────────────────────────────
/**
 * Хөтөлбөр бүрийн танилцуулга зураг.
 *
 * Зургийг public/programs/ хавтсанд хийхэд Vercel автоматаар нийтэлнэ.
 * Жишээ: public/programs/software.jpg -> /programs/software.jpg
 *
 * Утга нь null бол бот тухайн хөтөлбөрт зураг илгээхгүй, зөвхөн текстээр
 * танилцуулна. Зураг нэмэхэд энд замыг нь бичихэд л хангалттай.
 *
 * Санамж: Messenger-т 1200x628 эсвэл 1080x1080 хэмжээ тохиромжтой,
 * файлын хэмжээ 8MB-аас бага, JPG эсвэл PNG байна.
 */
export const PROGRAM_IMAGES = {
  'software-2plus2': null, // '/programs/software-2plus2.jpg'
  software: null,
  tourism: null,
  economics: null,
  translation: null,
  'area-studies': null,
};

/**
 * Хөтөлбөрийн зургийн бүтэн хаягийг гаргана.
 * Messenger гадны системээс татдаг тул заавал абсолют https хаяг байх ёстой.
 * @param {string} programId
 * @returns {string|null}
 */
export function programImageUrl(programId) {
  const path = PROGRAM_IMAGES[programId];
  if (!path) return null;
  if (path.startsWith("http://") || path.startsWith("https://")) return path;

  const base =
    process.env.PUBLIC_BASE_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : null) ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null);

  if (!base) return null;
  const root = base.endsWith("/") ? base.slice(0, -1) : base;
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${root}${suffix}`;
}

// ─── Хөтөлбөрүүд ─────────────────────────────────────────────────────────
/**
 * examGroups: тушаалын хүснэгтийн ЭЕШ багана бүр нэг бүлэг.
 * inDemand: Засгийн газрын 115-р тогтоолын ЭРЭЛТТЭЙ мэргэжлийн жагсаалтад багтсан.
 */
export const PROGRAMS = [
  // Эрэлтийн дарааллаар — хамгийн эрэлттэйгээс эхэлнэ
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
    id: 'economics',
    name: 'Эдийн засаг',
    code: '031101',
    inDemand: false,
    examGroups: [
      { subjects: ['Математик'], minScore: 490 },
      { subjects: ['Нийгэм судлал', 'Англи хэл'], minScore: 490 },
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
 * @param {{forceIncentive?: 'full'|'half'|'standard'}} [options]
 *        forceIncentive — тооцоог давж, тодорхой урамшуулал оногдуулах
 *        (жишээ нь элсэлтийн комиссын шийдвэрээр 50% олгох үед)
 * @returns {{
 *   ok: boolean, error?: string,
 *   program?: object, qualified?: boolean,
 *   groupResults?: Array<{subjects: string[], minScore: number, met: boolean, best: object|null}>,
 *   incentive?: object, baseAnnual?: number, discountAmount?: number,
 *   annualAfterDiscount?: number, seatDeposit?: number, summary?: string
 * }}
 */
export function evaluateApplicant(programIdOrName, scores, options = {}) {
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

  // Оноо байхгүй байж болно — "30+" болон хоёр дахь мэргэжлийн хөтөлбөрт
  // ЭЕШ шаардахгүй. Ийм үед босго хангаагүй гэж үзээд тооцоог үргэлжлүүлнэ.

  // Бүлэг тус бүрийг шалгах: бүлэг доторх аль нэг хичээл босго давахад хангагдана
  const groupResults = examGroupsFor(program).map((group) => {
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

  const { best: incentive, eligible } = options.forceIncentive
    ? { best: INCENTIVES[options.forceIncentive] ?? INCENTIVES.none, eligible: [] }
    : determineIncentive({
        ...options,
        meetsEesh: qualified,
        // Оноо огт өгөөгүй бол ЭЕШ өгөөгүй гэж үзнэ ("30+" хөтөлбөрт чухал)
        hasEesh: normalized.length > 0,
      });

  const discountAmount = Math.round(TUITION.baseAnnual * incentive.rate);
  const annualAfterDiscount = TUITION.baseAnnual - discountAmount;
  const seatDeposit = TUITION.seatDeposit;

  // Хураамж хөнгөлсөн дүнгээс хасагдах уу, эсвэл тусдаа төлөгдөх үү
  const remainingBalance = incentive.depositDeductible
    ? Math.max(0, annualAfterDiscount - seatDeposit)
    : annualAfterDiscount;

  // Элсэгчийн нийт төлөх дүн (хураамж оруулаад)
  const totalPayable = incentive.depositDeductible
    ? annualAfterDiscount
    : annualAfterDiscount + seatDeposit;

  const depositNote = incentive.depositDeductible
    ? `${formatMnt(seatDeposit)} хураамж нь хөнгөлсөн дүнгээс хасагдана.`
    : `${formatMnt(seatDeposit)} хураамж нь сургалтын төлбөрөөс тусдаа.`;

  const summary =
    `${program.name}: ${incentive.label} (${incentive.reason}). ` +
    `Жилийн төлбөр ${formatMnt(TUITION.baseAnnual)} → ${formatMnt(annualAfterDiscount)}. ` +
    depositNote;

  return {
    ok: true,
    program,
    qualified,
    groupResults,
    incentive,
    eligibleIncentives: eligible,
    baseAnnual: TUITION.baseAnnual,
    discountAmount,
    annualAfterDiscount,
    seatDeposit,
    depositDeductible: incentive.depositDeductible,
    remainingBalance,
    totalPayable,
    depositNote,
    summary,
  };
}

/** Ботод харуулах хөтөлбөрийн жагсаалт (промптод оруулна) */
export function programListText() {
  return PROGRAMS.map((p) => {
    const groups = examGroupsFor(p)
      .map((g) => `${g.subjects.join(' / ')} — ${g.minScore}+`)
      .join('; ');
    return `- ${p.name} (код ${p.code})${p.inDemand ? ' [ЭРЭЛТТЭЙ мэргэжил]' : ''}: ЭЕШ ${groups}`;
  }).join('\n');
}
