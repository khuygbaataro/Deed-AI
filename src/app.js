import express from 'express';
import { config } from './config.js';
import { log } from './logger.js';
import { captureRawBody, verifySignature } from './signature.js';
import { processWebhookBody, verifyWebhook } from './handler.js';
import { reloadKnowledge } from './knowledge.js';
import { stats } from './sessions.js';

/**
 * Express апп-ыг үүсгэнэ.
 * Локал хөгжүүлэлт, VPS, Railway/Render зэрэг байнга ажилладаг серверт хэрэглэнэ.
 * Vercel дээр энэ файл ашиглагдахгүй — api/webhook.js ажиллана.
 */
export function createApp() {
  const app = express();
  app.use(express.json({ verify: captureRawBody, limit: '1mb' }));

  app.get('/', (_req, res) =>
    res.send('Deed AI — Соёл Эрдэм ДС Messenger бот ажиллаж байна.'),
  );

  app.get('/health', (_req, res) =>
    res.json({ status: 'ok', uptime: process.uptime(), store: stats() }),
  );

  // Facebook-ийн webhook баталгаажуулалт
  app.get('/webhook', (req, res) => {
    const challenge = verifyWebhook(req.query);
    if (challenge === null) return res.sendStatus(403);
    return res.status(200).send(challenge);
  });

  // Facebook-ийн үйл явдал
  app.post('/webhook', (req, res) => {
    if (!verifySignature(req)) {
      log.warn('Гарын үсэг буруу — хүсэлтийг цуцаллаа');
      return res.sendStatus(403);
    }
    if (req.body?.object !== 'page') return res.sendStatus(404);

    // Facebook 20 секундэд хариу хүлээдэг — эхлээд 200 буцааж, дараа нь боловсруулна.
    // Байнга ажилладаг сервер дээр процесс амьд үлдэх тул энэ аюулгүй.
    res.status(200).send('EVENT_RECEIVED');
    processWebhookBody(req.body).catch((err) =>
      log.error('Webhook боловсруулахад алдаа', { error: err.message }),
    );
  });

  // Мэдлэгийн санг дахин ачаалах (ADMIN_TOKEN тохируулсан үед идэвхжинэ)
  app.post('/admin/reload', async (req, res) => {
    const adminToken = process.env.ADMIN_TOKEN;
    if (!adminToken) return res.sendStatus(404);
    if (req.get('x-admin-token') !== adminToken) return res.sendStatus(403);
    const kb = await reloadKnowledge();
    res.json({ ok: true, files: kb.files, bytes: kb.bytes });
  });

  app.use((err, _req, res, _next) => {
    log.error('Серверийн алдаа', { error: err.message });
    if (!res.headersSent) res.sendStatus(500);
  });

  return app;
}

export { config };
