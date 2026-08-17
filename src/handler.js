import { config } from './config.js';
import { log, maskPsid } from './logger.js';
import { generateReply } from './claude.js';
import { GREETING, PAYLOAD_PROMPTS, QUICK_REPLIES } from './prompt.js';
import { getUserProfile, sendSenderAction, sendText } from './messenger.js';
import { getSession, resetSession, saveSession, setHandedOver } from './sessions.js';
import { kvClaim } from './store.js';

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

  // "Эхлэх" / "Дахин эхлэх" товч
  if (payload === 'GET_STARTED' || payload === 'RESTART') {
    await resetSession(psid);
    await saveSession(psid, { messages: [], handedOver: false, greeted: true });
    await sendSenderAction(psid, 'mark_seen');
    await sendText(psid, GREETING, QUICK_REPLIES);
    return;
  }

  let userText = event.message?.text?.trim();
  if (payload && PAYLOAD_PROMPTS[payload]) userText = PAYLOAD_PROMPTS[payload];

  // Текст биш контент (зураг, файл, наалт)
  if (!userText) {
    if (event.message?.attachments?.length) {
      await sendSenderAction(psid, 'mark_seen');
      await sendText(
        psid,
        'Одоогоор би зөвхөн бичсэн текстийг ойлгодог. Асуултаа бичээд илгээнэ үү. 🙂',
        QUICK_REPLIES,
      );
    }
    return;
  }

  const session = await getSession(psid);

  // Ажилтан яриаг хариуцаж байгаа үед бот дуугарахгүй
  if (session.handedOver) {
    log.debug('Яриа ажилтны хяналтад байна — алгаслаа', { psid: maskPsid(psid) });
    return;
  }

  await sendSenderAction(psid, 'mark_seen');
  await sendSenderAction(psid, 'typing_on');

  try {
    const isFirstContact = !session.greeted && session.messages.length === 0;
    if (isFirstContact) {
      session.greeted = true;
      await sendText(psid, GREETING);
    }

    const profile = isFirstContact ? await getUserProfile(psid) : null;

    const result = await generateReply({
      history: session.messages,
      userText,
      psid,
      userName: profile?.first_name ?? null,
    });

    // Ярианы түүхийг хэрэгслийн блокуудтай нь бүтнээр хадгална
    session.messages = result.messages;
    if (result.handedOver) session.handedOver = true;
    await saveSession(psid, session);

    await sendSenderAction(psid, 'typing_off');
    await sendText(psid, result.text, result.handedOver ? undefined : QUICK_REPLIES);
  } catch (err) {
    log.error('Хариу үүсгэхэд алдаа', { psid: maskPsid(psid), error: err.message });
    await sendSenderAction(psid, 'typing_off');
    await sendText(
      psid,
      'Уучлаарай, алдаа гарлаа. Дахин оролдоно уу эсвэл сургуулийн утсаар холбогдоорой.',
    );
  }
}
