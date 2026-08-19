/**
 * Элсэгчийн бүртгэл (lead).
 *
 * Хэрэглэгч бүрт нэг бичлэг үүсгэж, яриа урагшлах тусам баяжуулна.
 * Ярианы түүхээс ЯЛГААТАЙ: сесс нь 1 цагийн дараа устдаг, харин элсэгчийн
 * бүртгэл 180 хоног хадгалагдана.
 *
 * ⚠️ Хувийн мэдээлэл (нэр, утас, ЭЕШ-ийн оноо) агуулна. Redis-гүй үед санах
 * ойд хадгалагдах бөгөөд процесс дахин эхлэхэд устана.
 */
import { kvGet, kvIndexAdd, kvIndexCount, kvIndexList, kvSet } from './store.js';
import { log, maskPsid } from './logger.js';

const LEAD_TTL_SECONDS = 180 * 24 * 60 * 60; // 180 хоног
const INDEX_KEY = 'leads:index';

const key = (psid) => `lead:${psid}`;

/** Яриа ямар шатанд явж байгаа */
export const STAGES = {
  new: 'Шинэ',
  program_selected: 'Мэргэжил сонгосон',
  eesh_checked: 'ЭЕШ шалгасан', // хуучин бодлогын үлдэгдэл — шинэ яриа энд орохгүй
  contact_saved: 'Холбоо барих мэдээлэл өгсөн',
  invoice_created: 'Нэхэмжлэх үүссэн',
  paid: 'Төлбөр төлсөн',
  escalated: 'Ажилтан руу шилжсэн',
};

/** Шатны дараалал — зөвхөн урагш ахина, ухрахгүй */
const STAGE_ORDER = [
  'new',
  'program_selected',
  'eesh_checked',
  'contact_saved',
  'invoice_created',
  'paid',
];

/** Шилжүүлсний дараа ч үргэлжилж болох шатууд — тайлан зөв гарахын тулд */
const OVERRIDES_ESCALATED = ['invoice_created', 'paid'];

function mergeStage(current, next) {
  if (!next) return current;
  if (next === 'escalated') return next; // шилжүүлэлт бусад шатнаас дээгүүр
  // Ажилтан руу шилжсэн ч төлбөр хийвэл тэр нь илүү чухал мэдээлэл
  if (current === 'escalated') {
    return OVERRIDES_ESCALATED.includes(next) ? next : current;
  }
  const a = STAGE_ORDER.indexOf(current);
  const b = STAGE_ORDER.indexOf(next);
  return b > a ? next : current;
}

/**
 * @param {string} psid
 * @returns {Promise<object>}
 */
export async function getLead(psid) {
  const stored = await kvGet(key(psid));
  if (stored) return stored;
  return {
    psid,
    stage: 'new',
    programId: null,
    programName: null,
    name: null,
    age: null,
    phone: null,
    email: null,
    eesh: [],
    qualified: null,
    incentiveLabel: null,
    annualAfterDiscount: null,
    invoice: null,
    notes: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Бүртгэлийг нэмж бичнэ (patch хэлбэрээр нэгтгэнэ).
 * @param {string} psid
 * @param {object} patch
 */
export async function saveLead(psid, patch = {}) {
  const current = await getLead(psid);
  const next = {
    ...current,
    ...patch,
    psid,
    stage: mergeStage(current.stage, patch.stage),
    createdAt: current.createdAt,
    updatedAt: new Date().toISOString(),
  };

  await kvSet(key(psid), next, LEAD_TTL_SECONDS);
  await kvIndexAdd(INDEX_KEY, psid, Date.now());

  log.info('Элсэгчийн бүртгэл шинэчлэгдлээ', {
    psid: maskPsid(psid),
    stage: next.stage,
    program: next.programName ?? null,
  });
  return next;
}

/** Хяналтын самбарт зориулж бүртгэлүүдийг жагсаана (сүүлийнхээс нь эхлэн) */
export async function listLeads(limit = 200) {
  const psids = await kvIndexList(INDEX_KEY, limit);
  const leads = await Promise.all(psids.map((psid) => kvGet(key(psid))));
  return leads.filter(Boolean);
}

export async function countLeads() {
  return kvIndexCount(INDEX_KEY);
}
