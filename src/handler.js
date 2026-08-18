import { config } from './config.js';
import { log, maskPsid } from './logger.js';
import { generateReply } from './claude.js';
import { GREETING, PAYLOAD_PROMPTS } from './prompt.js';
import { getUserProfile, sendImage, sendSenderAction, sendText } from './messenger.js';
import { getSession, resetSession, saveSession, setHandedOver } from './sessions.js';
import { kvAppend, kvClaim, kvDelete, kvDrainList } from './store.js';
import { checkRateLimit, rateLimitMessage } from './ratelimit.js';
import { overviewImageUrl } from './admissions.js';

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

  // Текст биш контент (зураг, файл, наалт)
  if (!userText) {
    if (event.message?.attachments?.length) {
      await sendSenderAction(psid, 'mark_seen');
      await sendText(psid, 'Одоогоор би зөвхөн бичсэн текстийг ойлгодог. Асуултаа бичээд илгээнэ үү.');
    }
    return;
  }

  // ─── Спам хамгаалалт: хурдны хязгаар ───────────────────────────────
  const rate = await checkRateLimit(psid);
  if (!rate.allowed) {
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

  if (!(await kvClaim(turnKey(psid), 45))) {
    log.debug('Энэ хэрэглэгчийг өөр дуудлага боловсруулж байна', { psid: maskPsid(psid) });
    return;
  }

  try {
    await sendSenderAction(psid, 'mark_seen');
    await sleep(COALESCE_MS); // дараалсан мессежүүдийг хүлээж авна

    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      const parts = await kvDrainList(bufKey(psid));
      if (!parts.length) break;

      if (parts.length > 1) {
        log.info('Дараалсан мессежийг нэгтгэлээ', {
          psid: maskPsid(psid),
          count: parts.length,
        });
      }

      await respondToTurn(psid, parts.join('\n'));
    }
  } finally {
    await kvDelete(turnKey(psid));
  }
}

/**
 * Мэндчилгээ илгээнэ — текст, дараа нь бүх мэргэжлийн карт.
 * Карт дээр "дугаараа бичээрэй" гэж заасан тул хэрэглэгч 1-6 гэж хариулна.
 */
async function sendGreeting(psid) {
  await sendText(psid, GREETING);
  const overview = overviewImageUrl();
  if (overview) await sendImage(psid, overview);
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

    if (isFirstContact) {
      session.greeted = true;
      await sendGreeting(psid);
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
    await sendText(psid, result.text);
  } catch (err) {
    log.error('Хариу үүсгэхэд алдаа', { psid: maskPsid(psid), error: err.message });
    await sendSenderAction(psid, 'typing_off');
    await sendText(
      psid,
      'Уучлаарай, алдаа гарлаа. Дахин оролдоно уу эсвэл 7011-8584 руу залгаарай.',
    );
  }
}
