import { config } from './config.js';
import { log, maskPsid } from './logger.js';
import { generateReply } from './ai.js';
import { GREETING, PAYLOAD_PROMPTS } from './prompt.js';
import { getUserProfile, sendSenderAction, sendText } from './messenger.js';
import { getSession, resetSession, saveSession, setHandedOver } from './sessions.js';
import { getLead, saveLead } from './leads.js';
import { notifyAdmins } from './messenger.js';
import { kvAppend, kvClaim, kvDelete, kvDrainList } from './store.js';
import { checkRateLimit, rateLimitMessage } from './ratelimit.js';
import { recordEvent } from './events.js';

/** Дараалсан мессежийг хүлээж авах завсар (мс) */
const COALESCE_MS = 2500;
/** Нэг дуудлагад хамгийн ихдээ хэдэн ээлж боловсруулах вэ (зардлын хязгаар) */
const MAX_ROUNDS = 3;

const bufKey = (psid) => `buf:${psid}`;
const turnKey = (psid) => `turn:${psid}`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Webhook баталгаажуулалт (Facebook GET хүсэлт).
 * @param {Record<string, any>} query
 * @returns {string|null} амжилттай бол challenge, эс бөгөөс null
 */
export function verifyWebhook(query) {
  const mode = query['hub.mode'];
  const token = query['hub.verify_token'];
  const challenge = query['hub.challenge'];

  if (mode === 'subscribe' && token && token === config.fb.verifyToken) {
    log.info('Webhook баталгаажлаа');
    return String(challenge ?? '');
  }
  log.warn('Webhook баталгаажуулалт амжилтгүй', { mode });
  return null;
}

/**
 * Webhook-ийн бүх үйл явдлыг боловсруулна.
 * Express болон Vercel хоёулаа үүнийг дуудна.
 * @param {any} body
 */
export async function processWebhookBody(body) {
  const jobs = [];

  for (const entry of body?.entry ?? []) {
    // standby = яриаг өөр апп (Page Inbox) хариуцаж байна -> бот дуугарахгүй
    if (entry.standby?.length) continue;

    for (const event of entry.messaging ?? []) {
      jobs.push(
        handleEvent(event).catch((err) =>
          log.error('Үйл явдал боловсруулахад алдаа', { error: err.message, stack: err.stack }),
        ),
      );
    }

    // Ажилтан яриаг ботод буцааж өгсөн үед
    for (const handover of entry.messaging_handovers ?? []) {
      const psid = handover.sender?.id;
      if (!psid) continue;
      if (handover.take_thread_control || handover.pass_thread_control) {
        jobs.push(
          setHandedOver(psid, false).then(() =>
            log.info('Яриа ботод буцаж ирлээ', { psid: maskPsid(psid) }),
          ),
        );
      }
    }
  }

  await Promise.allSettled(jobs);
}

/**
 * Нэг messaging үйл явдлыг боловсруулна.
 * @param {any} event
 */
export async function handleEvent(event) {
  const psid = event.sender?.id;
  if (!psid) return;

  // Хуудсаас илгээсэн мессежийн цуурай, хүргэлт/уншсан мэдэгдлийг үл тоомсорлоно
  if (event.message?.is_echo || event.delivery || event.read) return;

  // Facebook нэг мессежийг дахин илгээж болзошгүй — нэг л удаа боловсруулна
  const mid = event.message?.mid;
  if (mid && !(await kvClaim(`mid:${mid}`, 600))) {
    log.debug('Давхардсан мессеж алгаслаа', { psid: maskPsid(psid) });
    return;
  }

  const payload = event.postback?.payload ?? event.message?.quick_reply?.payload ?? null;

  // "Эхлэх" / "Дахин эхлэх" товч — нэгтгэлийг тойрч шууд ажиллана
  if (payload === 'GET_STARTED' || payload === 'RESTART') {
    await resetSession(psid);
    await kvDelete(bufKey(psid));
    await saveSession(psid, { messages: [], handedOver: false, greeted: true });
    await sendSenderAction(psid, 'mark_seen');
    await sendGreeting(psid);
    return;
  }

  let userText = event.message?.text?.trim();
  if (payload && PAYLOAD_PROMPTS[payload]) userText = PAYLOAD_PROMPTS[payload];

  // Наалт, like — зөвшөөрлийн хариу гэж үзэж, яриаг ҮРГЭЛЖЛҮҮЛНЭ.
  // Зураг гэж андуурвал "Зургийг хүлээн авлаа" гээд яриа тасардаг.
  if (!userText) {
    const sticker = stickerText(event.message);
    if (sticker) userText = sticker;
  }

  // Текст биш контент (зураг, файл)
  if (!userText) {
    const attachments = event.message?.attachments ?? [];
    if (attachments.length) {
      await sendSenderAction(psid, 'mark_seen');
      await handleAttachment(psid, attachments);
    }
    return;
  }

  // ─── Тохиргооны туслах команд ──────────────────────────────────────
  // Админ өөрийн PSID-гээ мэдэхийн тулд Page рүү "psid" гэж бичнэ.
  // Зөвхөн бичсэн хүнд өөрийнх нь дугаарыг харуулна — бусдын мэдээлэл
  // задрахгүй. FB_ADMIN_PSIDS тохируулахад хэрэгтэй.
  const cmd = userText.trim().toLowerCase();

  // Туршилтын команд — яриаг эхнээс нь дахин эхлүүлнэ.
  // Ботыг шинэ элсэгчийн нүдээр шалгахад хэрэгтэй.
  if (cmd === 'дахин эхлэх' || cmd === '/reset' || cmd === 'reset') {
    await resetSession(psid);
    await kvDelete(bufKey(psid));
    await saveSession(psid, { messages: [], handedOver: false, greeted: true });
    await sendSenderAction(psid, 'mark_seen');
    await sendGreeting(psid);
    log.info('Яриа дахин эхэллээ', { psid: maskPsid(psid) });
    return;
  }

  if (cmd === 'psid' || cmd === '/psid') {
    await sendSenderAction(psid, 'mark_seen');
    await sendText(
      psid,
      'Таны PSID:' + String.fromCharCode(10) + psid + String.fromCharCode(10, 10) +
        'Үүнийг Vercel дээр FB_ADMIN_PSIDS хувьсагчид тавибал шинэ элсэгч ' +
        'суудал захиалах бүрт танд энэ чат руу мэдэгдэл ирнэ.',
    );
    log.info('PSID хүсэлт', { psid: maskPsid(psid) });
    return;
  }

  // ─── Спам хамгаалалт: хурдны хязгаар ───────────────────────────────
  const rate = await checkRateLimit(psid);
  if (!rate.allowed) {
    if (rate.warn) await recordEvent('rate_limited', { psid, detail: rate.scope });
    if (rate.warn) {
      await sendSenderAction(psid, 'mark_seen');
      await sendText(psid, rateLimitMessage(rate.scope));
    }
    return; // Claude руу огт хандахгүй
  }

  const session = await getSession(psid);

  // Ажилтан яриаг хариуцаж байгаа үед бот дуугарахгүй
  if (session.handedOver) {
    log.debug('Яриа ажилтны хяналтад байна — алгаслаа', { psid: maskPsid(psid) });
    return;
  }

  // ─── Спам хамгаалалт: дараалсан мессежийг нэгтгэх ──────────────────
  // Мессежийг эхлээд буферт хийнэ. Дараа нь зөвхөн НЭГ дуудлага "эзэн"
  // болж, богино завсрын дараа буферийг бүтнээр нь авч ганц удаа хариулна.
  // Ингэснээр 10 мессеж = 10 биш, 1 Claude дуудлага болно.
  await kvAppend(bufKey(psid), userText);

  // Түгжээг ээлж БҮРТ авч, суллана. Ингэснээр боловсруулж байх зуур ирсэн
  // мессеж дараагийн ээлжид, эсвэл өөр дуудлагаар баригдана — өмнө нь
  // сүүлийн drain-ийн дараа ирсэн мессеж хэнд ч очихгүй унтардаг байв.
  let greeted = false;
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    if (!(await kvClaim(turnKey(psid), 45))) {
      log.debug('Энэ хэрэглэгчийг өөр дуудлага боловсруулж байна', { psid: maskPsid(psid) });
      return;
    }

    try {
      if (!greeted) {
        await sendSenderAction(psid, 'mark_seen');
        await sleep(COALESCE_MS); // дараалсан мессежүүдийг хүлээж авна
        greeted = true;
      }

      const parts = await kvDrainList(bufKey(psid));
      if (!parts.length) return;

      if (parts.length > 1) {
        log.info('Дараалсан мессежийг нэгтгэлээ', { psid: maskPsid(psid), count: parts.length });
      }

      await respondToTurn(psid, parts.join(String.fromCharCode(10)));
    } finally {
      await kvDelete(turnKey(psid));
    }
  }

  // Хязгаарт хүрсэн ч буферт үлдсэн бол мэдэгдэнэ — чимээгүй алдагдахаас сэргийлж
  const leftover = await kvDrainList(bufKey(psid));
  if (leftover.length) {
    log.warn('Мессеж боловсруулагдалгүй үлдлээ', { psid: maskPsid(psid), count: leftover.length });
    await recordEvent('dropped', { psid, question: leftover.join(' | ').slice(0, 200) });
    await sendText(
      psid,
      'Уучлаарай, хэт олон мессеж хурдан ирсэн тул зарим нь алдагдлаа. ' +
        'Асуултаа дахин бичээд илгээгээрэй.',
    );
  }
}

/**
 * Мессеж нь НААЛТ (sticker) эсвэл LIKE мөн эсэх.
 *
 * Facebook "like" товчийг зураг хэлбэрээр илгээдэг. Тиймээс бот түүнийг
 * төлбөрийн баримт гэж андуурч "Зургийг хүлээн авлаа" гэж хариулаад,
 * яриа тасардаг байв. Хүн зүгээр л "за" гэж зөвшөөрч байгаа хэрэг.
 *
 * Facebook-ийн эрхий хурууны sticker_id-ууд (жижиг, дунд, том хэмжээ).
 */
const THUMBS_UP_IDS = new Set([
  '369239263222822',
  '369239343222814',
  '369239383222810',
]);

export function stickerText(message) {
  const stickerId =
    message?.sticker_id ??
    message?.attachments?.find((a) => a.payload?.sticker_id)?.payload?.sticker_id;
  if (stickerId === undefined || stickerId === null) return null;

  // Эрхий хуруу = зөвшөөрөл. Бусад наалт = эерэг хариу.
  return THUMBS_UP_IDS.has(String(stickerId)) ? '👍' : '🙂';
}
/**
 * Зураг, файл ирэхэд юу хийх вэ.
 *
 * Цаг товлосон буюу бүртгүүлсэн хүнээс ирсэн зураг бол төлбөрийн баримт байх
 * магадлал өндөр. Тэр тохиолдолд хүлээн авсныг баталгаажуулж, санхүү хянана гэдгийг
 * хэлээд админд мэдэгдэнэ. AI дуудахгүй — тодорхой, тогтмол хариу өгнө.
 */
async function handleAttachment(psid, attachments) {
  const hasImage = attachments.some((a) => a.type === 'image');
  const lead = await getLead(psid);
  const awaitingPayment = ['visit_booked', 'contact_saved', 'invoice_created', 'receipt_sent']
    .includes(lead.stage);

  if (hasImage && awaitingPayment) {
    await saveLead(psid, { stage: 'receipt_sent' });
    await sendText(
      psid,
      'Баримтыг хүлээн авлаа ✅' + String.fromCharCode(10, 10) +
        'Таны бүртгэлийг онлайнаар авлаа. Санхүүгийн алба төлбөрийг хянаад, ' +
        'баталгаажмагц тантай утсаар холбогдоно.',
    );
    await notifyAdmins(
      [
        '🧾 ТӨЛБӨРИЙН БАРИМТ ИРЛЭЭ',
        `Нэр: ${lead.name ?? '-'}`,
        `Утас: ${lead.phone ?? '-'}`,
        `Мэргэжил: ${lead.programName ?? '-'}`,
        'Messenger чатнаас баримтыг шалгана уу.',
      ].join(String.fromCharCode(10)),
    );
    log.info('Төлбөрийн баримт хүлээн авлаа', { psid: maskPsid(psid) });
    return;
  }

  await sendText(
    psid,
    'Зургийг хүлээн авлаа. Асуулт байвал бичээд илгээгээрэй — би текстээр ' +
      'хариулж тусална.',
  );
}

/**
 * Эхний мессеж нь ЗӨВХӨН мэндчилгээ мөн эсэх.
 *
 * Хүн шууд асуулт бичсэн байхад бэлэн мэндчилгээгээ дээр нь давхарлавал
 * гурван мессежийн хана босч, хүн уйдаад гардаг. Тийм үед мэндчилгээг
 * тусад нь илгээхгүй — бот өөрөө нэг мессежд танилцаад, асуултад нь
 * хариулаад, цааш чиглүүлнэ.
 *
 * Эргэлзвэл АСУУЛТ гэж үзнэ — хүний асуултыг хариулахгүй орхих нь
 * илүү том алдаа.
 */
const GREETING_ONLY = new Set([
  'сайн байна уу', 'сайн байцгаана уу', 'сайн уу', 'сайнуу', 'сайн',
  'байна уу', 'за', 'за за', 'ok', 'окей', 'тийм',
  'sain bainuu', 'sain bnuu', 'sain bn uu', 'sainuu', 'sn bnu', 'sainbainauu',
  'hi', 'hello', 'hey', 'start', 'эхлэх', 'эхэлье',
]);

export function isGreetingOnly(text) {
  if (typeof text !== 'string') return false;
  const clean = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (clean === '') return true;
  return GREETING_ONLY.has(clean);
}
/**
 * Мэндчилгээ илгээнэ.
 *
 * Мэргэжлийн жагсаалтын картыг ЭНД илгээхгүй — түүнийг show_program_list
 * хэрэгсэл хариуцна. Хоёр газраас илгээвэл карт давхарлан очих эрсдэлтэй,
 * мөн хэрэглэгч мэргэжлээ шууд нэрлэсэн үед жагсаалт нь илүүц болно.
 */
async function sendGreeting(psid) {
  await sendText(psid, GREETING);
}

/**
 * Нэг ээлжид хариулна.
 * @param {string} psid
 * @param {string} userText нэгтгэсэн текст
 */
async function respondToTurn(psid, userText) {
  await sendSenderAction(psid, 'typing_on');

  try {
    const session = await getSession(psid);
    const isFirstContact = !session.greeted && session.messages.length === 0;

    if (isFirstContact && isGreetingOnly(userText)) {
      // Зөвхөн мэндэлсэн бол албан ёсны мэндчилгээ л хангалттай.
      // Мэндчилгээ өөрөө "танилцах уу?" гэж асуусан тул AI-г дуудахгүй —
      // хоёр мессеж дараалан очих нь хүнийг үргээдэг, мөн токен ч хэмнэнэ.
      session.greeted = true;
      await sendGreeting(psid);
      await saveSession(psid, session);
      await sendSenderAction(psid, 'typing_off');
      return;
    }

    if (isFirstContact) {
      // Хүн шууд асуулт бичсэн: бэлэн мэндчилгээг ДЭЭР НЬ давхарлахгүй.
      // Бот нэг мессежд танилцаад, асуултад нь хариулна (FLOW 1-р алхам).
      session.greeted = true;
    }

    const profile = isFirstContact ? await getUserProfile(psid) : null;

    const result = await generateReply({
      history: session.messages,
      userText,
      psid,
      userName: profile?.first_name ?? null,
    });

    session.messages = result.messages;
    if (result.handedOver) session.handedOver = true;
    await saveSession(psid, session);

    await sendSenderAction(psid, 'typing_off');
    // Ажилтан руу шилжүүлсэн бол мессежийг хэрэгсэл аль хэдийн илгээсэн.
    // Дахин илгээвэл Facebook татгалзана — thread control өөр апп-д шилжсэн.
    // Текст хоосон байж болно: хэрэгсэл дуудахын өмнөх мессежийг аль
    // хэдийн илгээсэн бол дээр нь хоосон юм давхарлахгүй.
    if (!result.handedOver && result.text) {
      await sendText(psid, result.text);
    }
  } catch (err) {
    log.error('Хариу үүсгэхэд алдаа', { psid: maskPsid(psid), error: err.message });
    await recordEvent('send_error', { psid, question: userText, detail: err.message });
    await sendSenderAction(psid, 'typing_off');
    await sendText(
      psid,
      'Уучлаарай, алдаа гарлаа. Дахин оролдоно уу эсвэл 7011-8584 руу залгаарай.',
    );
  }
}
