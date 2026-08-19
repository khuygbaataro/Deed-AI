/**
 * ЭЛСЭЛТИЙН ДҮРЭМ, ҮНЭ — нэг эх сурвалж.
 *
 * Үнэ өөрчлөгдвөл ЗӨВХӨН энэ файлыг засна. Дүн эндээс промпт, tool-ийн
 * тайлбар, QPay нэхэмжлэх рүү автоматаар урсдаг.
 *
 * 2026-2027 оны элсэлтийн бодлого:
 *   - ЭХНИЙ ЖИЛИЙН сургалтын төлбөр БҮХ хөтөлбөрт үнэгүй
 *   - 2 дахь жилээс хойшхи төлбөр сургуулиас БАТАЛГААЖААГҮЙ (laterYearsAnnual)
 *   - ЭЕШ өгсөн эсэх шаардахгүй, оноо асуухгүй
 *   - Орон нутаг / Улаанбаатар ялгаагүй
 *   - Элсэгч зөвхөн суудал баталгаажуулах хураамж төлнө
 *
 * Өмнөх бодлого (жилийн 5,500,000₮, ЭЕШ-ийн босго, орон нутгийн 100%
 * хөнгөлөлт) хүчингүй болсон тул хөнгөлөлт тооцох код бүхэлдээ хасагдсан —
 * 0₮-өөс хасах зүйл байхгүй.
 */

// ─── Төлбөр ──────────────────────────────────────────────────────────────
export const TUITION = {
  /** ЭХНИЙ ЖИЛИЙН сургалтын төлбөр. 2026-2027 элсэлтэд бүх хөтөлбөрт үнэгүй. */
  baseAnnual: 0,
  /** Үнэгүй нь хэдэн жилд хамаарах вэ */
  freeYears: 1,
  /**
   * 2 дахь жилээс хойшхи жилийн төлбөр.
   * null = сургуулиас баталгаажаагүй. Бот энэ тохиолдолд дүн ХЭЛЭХГҮЙ,
   * "баталгаатай мэдээлэл алга" гээд элсэлтийн ажилтан руу чиглүүлнэ.
   * Дүн тодорхой болмогц энд бичнэ — өөр хаана ч засах шаардлагагүй.
   */
  laterYearsAnnual: null,
  /** Суудал баталгаажуулах хураамж — элсэгч бүр төлнө */
  seatDeposit: 250_000,
  currency: 'MNT',
};

/** Эхний жилийн төлбөр үнэгүй эсэх */
export const IS_FIRST_YEAR_FREE = TUITION.baseAnnual === 0;


// ─── Эхний жил үнэгүй байх нөхцөл ────────────────────────────────────────
/**
 * Эхний жилийн төлбөрөөс чөлөөлөгдөхийн хариуд элсэгч зуны амралтаараа
 * сургууль дээрээ 1 сар ажиллаж, бодит ажлын туршлага хуримтлуулна.
 * Тохиролцооны үндсэн дээр зохион байгуулагдана.
 */
export const FIRST_YEAR_CONDITION =
  'Эхний жилийн төлбөрөөс чөлөөлөгдөхийн хариуд зуны амралтаараа 1 сарын ' +
  'хугацаанд сургууль дээрээ ажиллаж, бодит ажлын туршлага хуримтлуулна. ' +
  'Хугацаа, нөхцөлийг тохиролцооны үндсэн дээр зохион байгуулна.';

// ─── Суралцах урсгалууд ──────────────────────────────────────────────────
/**
 * Элсэгч гурван өөр урсгалаар орж ирж болно. Бот зөв мэдээлэл өгөхийн тулд
 * эхлээд аль урсгалынх болохыг тодруулах ёстой.
 *
 * Ялгах гол асуулт (нэг нэгээр нь):
 *   1. Өмнө нь бакалаврын зэрэг эзэмшсэн үү?  тийм -> second_degree
 *   2. Үгүй бол: 30-аас дээш настай юу?        тийм -> thirty_plus
 *   3. Аль нь ч биш                            -> standard
 */
export const TRACKS = {
  standard: {
    id: 'standard',
    name: 'Бакалавр — үндсэн хөтөлбөр',
    who: 'ЭЕШ өгөөгүй эсвэл босго оноо хангаагүй ч дээд боловсрол эзэмших хүсэлтэй',
    duration: '4 жил',
    format: 'Танхим + онлайн хосолсон сургалт',
  },
  thirty_plus: {
    id: 'thirty_plus',
    name: '"+30" хөтөлбөр',
    who: '30-аас дээш настай, бакалаврын боловсрол эзэмшихийг хүсэгч',
    duration: '4 жил (танхим + онлайн), эсвэл эчнээ хэлбэрээр 2.5 жил',
    format: 'Танхим + онлайн анги нь үндсэн хөтөлбөртэй ЯГ АДИЛХАН. Эчнээ сонголт бас бий.',
  },
  second_degree: {
    id: 'second_degree',
    name: 'Хоёр дахь мэргэжил — эчнээ',
    who: 'Өмнө нь бакалаврын зэрэг эзэмшсэн, дахин мэргэжил эзэмшихийг хүсэгч',
    duration: '2.5 жил',
    format: 'Эчнээ сургалт',
  },
};

/** Урсгалыг id-гаар нь олох */
export function findTrack(id) {
  return TRACKS[id] ?? null;
}

// ─── Төлбөр хүлээн авах данс ────────────────────────────────────────────
/**
 * Суудлын хураамжийг банкны шилжүүлгээр хүлээн авах мэдээлэл.
 * Гүйлгээний утгад ЭЛСЭГЧИЙН БҮТЭН НЭРИЙГ бичнэ.
 */
export const BANK_ACCOUNT = {
  bankName: 'Худалдаа Хөгжлийн банк',
  accountNumber: '499034349',
  iban: '300004000499034349',
  accountName: 'Соёл Эрдэм Дээд Сургууль',
};

export const isBankConfigured = () =>
  Boolean(BANK_ACCOUNT.bankName && BANK_ACCOUNT.accountNumber && BANK_ACCOUNT.accountName);

// ─── Хөтөлбөрийн танилцуулга зураг ──────────────────────────────────────
export const PROGRAM_IMAGES = {
  'software-2plus2': '/programs/software-2plus2.png',
  software: '/programs/software.png',
  tourism: '/programs/tourism.png',
  economics: '/programs/economics.png',
  translation: '/programs/translation.png',
  'area-studies': '/programs/area-studies.png',
};

/** Бүх мэргэжлийг нэг дор харуулах карт (ярианы эхэнд илгээнэ) */
export const OVERVIEW_IMAGE = '/programs/all-programs.png';

/** Хөтөлбөрийн зургийн бүтэн https хаяг */
export function programImageUrl(programId) {
  return resolveImageUrl(PROGRAM_IMAGES[programId]);
}

/** Харьцангуй замыг Messenger уншиж чадах бүтэн https хаяг болгоно */
function resolveImageUrl(path) {
  if (!path) return null;
  if (path.startsWith('http://') || path.startsWith('https://')) return path;

  const base =
    process.env.PUBLIC_BASE_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : null) ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null);

  if (!base) return null;
  const root = base.endsWith('/') ? base.slice(0, -1) : base;
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${root}${suffix}`;
}

/** Бүх мэргэжлийн жагсаалтын картын бүтэн хаяг */
export function overviewImageUrl() {
  return resolveImageUrl(OVERVIEW_IMAGE);
}

// ─── Хөтөлбөрүүд ─────────────────────────────────────────────────────────
/**
 * inDemand: Засгийн газрын 115-р тогтоолын ЭРЭЛТТЭЙ мэргэжлийн жагсаалтад багтсан.
 * pitch: элсэгчид юу болох вэ гэдгийг нэг өгүүлбэрээр — олон хөтөлбөр
 *        харьцуулж санал болгоход ашиглана.
 *
 * examGroups нь ӨМНӨХ бодлогын лавлагаа. Одоогийн элсэлтэд ЭЕШ шаардахгүй тул
 * хаана ч уншигдахгүй — бодлого буцаж өөрчлөгдвөл эх өгөгдөл нь хэвээр байна.
 */
export const PROGRAMS = [
  {
    id: 'software-2plus2',
    name: 'Программ хангамж 2+2',
    code: '061302',
    inDemand: true,
    pitch: 'Хоёр жил энд, хоёр жил гадаадад — давхар диплом, Японд ажиллах зам.',
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
    pitch: 'Программист мэргэжил — эрэлттэй мэргэжлийн жагсаалтад багтдаг.',
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
    pitch: 'Аялал жуулчлалын салбарт менежер, зохион байгуулагчаар ажиллана.',
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
    pitch: 'Банк, санхүү, компанийн эдийн засгийн чиглэлээр мэргэшинэ.',
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
    pitch: 'Орчуулагч, хэлний мэргэжилтэн — олон улсын байгууллагад ажиллах зам.',
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
    pitch: 'Гадаад харилцаа, орон судлал — дипломат, олон улсын чиглэл.',
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

/** ₮ форматлах: 250000 -> "250,000₮" */
export function formatMnt(amount) {
  return `${Math.round(amount).toLocaleString('en-US')}₮`;
}

/**
 * Ботод харуулах хөтөлбөрийн жагсаалт (промптод оруулна).
 * ЭЕШ-ийн босго ОРУУЛАХГҮЙ — одоогийн элсэлтэд шаардахгүй тул промптод
 * гаргавал бот оноо асуух руу хазайна.
 */
export function programListText() {
  return PROGRAMS.map((p, i) => {
    const demand = p.inDemand ? ' [ЭРЭЛТТЭЙ мэргэжил]' : '';
    return `${i + 1}. ${p.name} (код ${p.code})${demand} — ${p.pitch}`;
  }).join('\n');
}
