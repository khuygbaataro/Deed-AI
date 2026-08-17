/**
 * Vercel serverless функц — Facebook Messenger webhook.
 *
 * Маршрут: /api/webhook  (vercel.json дахь rewrite-аар /webhook ч ажиллана)
 *
 * Express хувилбараас ялгаатай нь энд хариу буцаасны дараа функц хөлддөг тул
 * үлдсэн ажлыг waitUntil() -д хүлээлгэж өгнө. Ингэснээр Facebook 200-г шууд
 * хүлээж авч, Claude-ийн хариу арын дэвсгэрт гүйцэтгэгдэнэ.
 */
import { waitUntil } from '@vercel/functions';
import { processWebhookBody, verifyWebhook } from '../src/handler.js';
import { verifyRawSignature } from '../src/signature.js';
import { log } from '../src/logger.js';
import { kvDriver } from '../src/store.js';

if (kvDriver === 'memory') {
  log.warn(
    'Redis тохируулаагүй байна. Serverless орчинд ярианы түүх хадгалагдахгүй — ' +
      'KV_REST_API_URL / KV_REST_API_TOKEN тохируулна уу.',
  );
}

/** Facebook-ийн webhook баталгаажуулалт */
export function GET(request) {
  const params = new URL(request.url).searchParams;
  const challenge = verifyWebhook({
    'hub.mode': params.get('hub.mode'),
    'hub.verify_token': params.get('hub.verify_token'),
    'hub.challenge': params.get('hub.challenge'),
  });

  if (challenge === null) return new Response('Forbidden', { status: 403 });
  return new Response(challenge, {
    status: 200,
    headers: { 'Content-Type': 'text/plain' },
  });
}

/** Facebook-ийн үйл явдал */
export async function POST(request) {
  const raw = await request.text();

  if (!verifyRawSignature(raw, request.headers.get('x-hub-signature-256'))) {
    log.warn('Гарын үсэг буруу — хүсэлтийг цуцаллаа');
    return new Response('Forbidden', { status: 403 });
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response('Bad Request', { status: 400 });
  }

  if (body?.object !== 'page') return new Response('Not Found', { status: 404 });

  // Хариу буцаасны дараа ч ажил үргэлжлэхийг Vercel-д мэдэгдэнэ
  waitUntil(
    processWebhookBody(body).catch((err) =>
      log.error('Webhook боловсруулахад алдаа', { error: err.message }),
    ),
  );

  return new Response('EVENT_RECEIVED', { status: 200 });
}
