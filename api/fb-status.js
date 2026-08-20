/**
 * Facebook холболтын оношлогоо.
 * Маршрут: /api/fb-status   (vercel.json-оор /fb-status)
 *
 * Хуудас апп-д захирагдсан эсэх, ямар талбар сонссоныг шалгана.
 * Мессеж ирэхгүй болсон үед хамгийн түрүүнд энд хардаг.
 *
 * ?fix=1 өгвөл захиалгыг дахин үүсгэнэ.
 *
 * Хамгаалалт: ADMIN_TOKEN (Basic auth, самбартай ижил).
 */
import { config } from '../src/config.js';

const SUBSCRIBED_FIELDS = [
  'messages',
  'messaging_postbacks',
  'messaging_optins',
  'message_deliveries',
  'message_reads',
  'messaging_handovers',
];

const adminToken = () => {
  const v = process.env.ADMIN_TOKEN;
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
};

function checkAuth(request, expected) {
  const header = request.headers.get('authorization');
  if (!header || !header.toLowerCase().startsWith('basic ')) return false;
  try {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    return decoded.slice(decoded.indexOf(':') + 1) === expected;
  } catch {
    return false;
  }
}

async function graph(path, init) {
  const url =
    `https://graph.facebook.com/${config.fb.graphVersion}/${path}` +
    `${path.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(config.fb.pageAccessToken ?? '')}`;
  const res = await fetch(url, init);
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 300) };
  }
  return { ok: res.ok, status: res.status, body };
}

export async function GET(request) {
  const token = adminToken();
  if (!token) return new Response('Not Found', { status: 404 });
  if (!checkAuth(request, token)) {
    return new Response('Нэвтрэх шаардлагатай', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="Deed AI", charset="UTF-8"' },
    });
  }

  if (!config.fb.pageAccessToken) {
    return Response.json({ ok: false, error: 'FB_PAGE_ACCESS_TOKEN тохируулаагүй' });
  }

  const result = { checkedAt: new Date().toISOString() };

  // 1. Токен ажиллаж байгаа эсэх, аль хуудсынх вэ
  const page = await graph('me?fields=id,name');
  result.page = page.ok
    ? { id: page.body.id, name: page.body.name }
    : { error: page.body?.error?.message ?? `HTTP ${page.status}` };

  // 2. Засах хүсэлт ирсэн бол дахин захиална
  const url = new URL(request.url);
  if (url.searchParams.get('fix') === '1') {
    const fix = await graph('me/subscribed_apps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscribed_fields: SUBSCRIBED_FIELDS }),
    });
    result.resubscribe = fix.ok
      ? { ok: true, response: fix.body }
      : { ok: false, error: fix.body?.error?.message ?? `HTTP ${fix.status}` };
  }

  // 3. Одоогийн захиалга
  const subs = await graph('me/subscribed_apps?fields=subscribed_fields,name,id');
  if (!subs.ok) {
    result.subscription = { error: subs.body?.error?.message ?? `HTTP ${subs.status}` };
  } else {
    const apps = subs.body?.data ?? [];
    result.subscription = {
      appCount: apps.length,
      apps: apps.map((a) => ({ name: a.name, id: a.id, fields: a.subscribed_fields })),
    };
    const fields = apps.flatMap((a) => a.subscribed_fields ?? []);
    result.missingFields = SUBSCRIBED_FIELDS.filter((f) => !fields.includes(f));
    result.healthy = apps.length > 0 && result.missingFields.length === 0;
  }

  result.hint = result.healthy
    ? 'Захиалга хэвийн. Мессеж ирэхгүй бол Facebook апп-ын горим (Live/Development) болон тестерийн эрхийг шалгана уу.'
    : 'Захиалга дутуу байна. Засахын тулд энэ хаягийн төгсгөлд ?fix=1 нэмж дахин нээнэ үү.';

  return Response.json(result, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
