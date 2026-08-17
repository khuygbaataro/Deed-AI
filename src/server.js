import express from 'express';
import { config, missingConfig } from './config.js';
import { log, maskPsid } from './logger.js';
import { captureRawBody, verifySignature } from './signature.js';
import { generateReply } from './claude.js';
import { GREETING, PAYLOAD_PROMPTS, QUICK_REPLIES } from './prompt.js';
import { reloadKnowledge } from './knowledge.js';
import {
  getUserProfile,
  sendSenderAction,
  sendText,
} from './messenger.js';
import {
  getSession,
  resetSession,
  setHandedOver,
  startSessionCleanup,
  stats,
  trimSession,
} from './sessions.js';

const app = express();
app.use(express.json({ verify: captureRawBody, limit: '1mb' }));

// --- Давхардсан webhook мессежийг шүүх (Facebook дахин илгээх магадлалтай) ---
const seenMessages = new Map();
const SEEN_TTL_MS = 10 * 60_000;

function isDuplicate(mid) {
  if (!mid) return false;
  const now = Date.now();
  for (const [key, ts] of seenMessages) {
    if (now - ts > SEEN_TTL_MS) seenMessages.delete(key);
    else break;
  }
  if (seenMessages.has(mid)) return true;
  seenMessages.set(mid, now);
  return false;
}

// --- Эрүүл мэндийн шалгалт ---
app.get('/', (_req, res) => res.send('Deed AI — Соёл Эрдэм ДС Messenger бот ажиллаж байна.'));
app.get('/health', (_req, res) =>
  res.json({ status: 'ok', uptime: process.uptime(), ...stats() }),
);

// --- Webhook баталгаажуулалт (Facebook нэг удаа дуудна) ---
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === config.fb.verifyToken) {
    log.info('Webhook баталгаажлаа');
    return res.status(200).send(challenge);
  }
  log.warn('Webhook баталгаажуулалт амжилтгүй', { mode });
  return res.sendStatus(403);
});

// --- Webhook үйл явдал ---
app.post('/webhook', (req, res) => {
  if (!verifySignature(req)) {
    log.warn('Гарын үсэг буруу — хүсэлтийг цуцаллаа');
    return res.sendStatus(403);
  }

  const body = req.body;
  if (body?.object !== 'page') return res.sendStatus(404);

  // Facebook 20 секундэд хариу хүлээдэг — эхлээд 200 буцааж, дараа нь боловсруулна
  res.status(200).send('EVENT_RECEIVED');

  for (const entry of body.entry ?? []) {
    // standby = яриаг өөр апп (Page Inbox) хариуцаж байна -> бот дуугарахгүй
    if (entry.standby?.length) continue;

    for (const event of entry.messaging ?? []) {
      handleEvent(event).catch((err) =>
        log.error('Үйл явдал боловсруулахад алдаа', { error: err.message, stack: err.stack }),
      );
    }

    // Хүн яриаг ботод буцааж өгсөн үед
    for (const handover of entry.messaging_handovers ?? []) {
      if (handover.take_thread_control || handover.pass_thread_control) {
        const psid = handover.sender?.id;
        if (psid) {
          setHandedOver(psid, false);
          log.info('Яриа ботод буцаж ирлээ', { psid: maskPsid(psid) });
        }
      }
    }
  }
});

// --- Мэдлэгийн санг дахин ачаалах (нэмэлт, ADMIN_TOKEN тавьсан үед идэвхжинэ) ---
app.post('/admin/reload', async (req, res) => {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken) return res.sendStatus(404);
  if (req.get('x-admin-token') !== adminToken) return res.sendStatus(403);
  const kb = await reloadKnowledge();
  res.json({ ok: true, files: kb.files, bytes: kb.bytes });
});

/**
 * Нэг messaging үйл явдлыг боловсруулна.
 * @param {any} event
 */
async function handleEvent(event) {
  const psid = event.sender?.id;
  if (!psid) return;

  // Хуудсаас илгээсэн мессежийн цуурай — үл тоомсорлоно
  if (event.message?.is_echo) return;
  if (event.delivery || event.read) return;
  if (isDuplicate(event.message?.mid)) {
    log.debug('Давхардсан мессеж алгаслаа', { psid: maskPsid(psid) });
    return;
  }

  const payload = event.postback?.payload ?? event.message?.quick_reply?.payload ?? null;

  // "Эхлэх" товч
  if (payload === 'GET_STARTED' || payload === 'RESTART') {
    resetSession(psid);
    getSession(psid).greeted = true;
    await sendSenderAction(psid, 'mark_seen');
    await sendText(psid, GREETING, QUICK_REPLIES);
    return;
  }

  let userText = event.message?.text?.trim();

  if (payload && PAYLOAD_PROMPTS[payload]) {
    userText = PAYLOAD_PROMPTS[payload];
  }

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

  const session = getSession(psid);

  // Ажилтан яриаг хариуцаж байгаа үед бот дуугарахгүй
  if (session.handedOver) {
    log.debug('Яриа ажилтны хяналтад байна — алгаслаа', { psid: maskPsid(psid) });
    return;
  }

  await sendSenderAction(psid, 'mark_seen');
  await sendSenderAction(psid, 'typing_on');

  try {
    // Анх удаа бичиж байгаа бол товч мэндчилнэ
    if (!session.greeted && !session.messages.length) {
      session.greeted = true;
      await sendText(psid, GREETING);
    }

    const profile = session.messages.length ? null : await getUserProfile(psid);

    const result = await generateReply({
      history: session.messages,
      userText,
      psid,
      userName: profile?.first_name ?? null,
    });

    // Ярианы түүхийг шинэчилнэ (хэрэгслийн блокуудыг оруулан бүтнээр нь)
    session.messages = result.messages;
    trimSession(psid);

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

// --- Алдааны төв хамгаалалт ---
app.use((err, _req, res, _next) => {
  log.error('Серверийн алдаа', { error: err.message });
  if (!res.headersSent) res.sendStatus(500);
});

const missing = missingConfig();
if (missing.length) {
  log.warn('Дутуу тохиргоо байна — .env файлаа шалгана уу', { missing });
}

startSessionCleanup();

app.listen(config.port, () => {
  log.info('Сервер аслаа', { port: config.port, model: config.claude.model });
});
