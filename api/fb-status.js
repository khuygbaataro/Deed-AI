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
import { getPageId } from '../src/comments.js';

const SUBSCRIBED_FIELDS = [
  'messages',
  'messaging_postbacks',
  'messaging_optins',
  'message_deliveries',
  'message_reads',
  'messaging_handovers',
  // Хуудсан дээрх сэтгэгдэл — сэтгэгдэлд автоматаар хариулахад ЗААВАЛ
  'feed',
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

  // Захиалгыг УНШИХАД pages_manage_metadata эрх хэрэгтэй. Тэр эрхгүй байсан ч
  // захиалга ӨӨРӨӨ хэвийн ажиллаж болно — уншилтын алдааг "дутуу" гэж
  // андуурч мэдээлэхгүй.
  const readFailed = Boolean(result.subscription?.error);
  if (result.resubscribe?.ok) {
    result.hint =
      'Захиалга амжилттай шинэчлэгдлээ. Messenger-ээс нэг мессеж бичээд шалгана уу.';
  } else if (readFailed) {
    result.hint =
      'Захиалгыг УНШИХ эрх (pages_manage_metadata) дутуу байна. Энэ нь захиалга ' +
      'ажиллахгүй гэсэн үг БИШ — зөвхөн жагсаалтыг харах боломжгүй. Мессеж ирж ' +
      'байгаа бол бүх зүйл хэвийн. Эргэлзвэл ?fix=1 нэмж дахин захиална уу.';
  } else {
    result.hint = result.healthy
      ? 'Захиалга хэвийн. Мессеж ирэхгүй бол Facebook апп-ын горимыг шалгана уу.'
      : 'Захиалга дутуу байна. Энэ хаягийн төгсгөлд ?fix=1 нэмж дахин нээнэ үү.';
  }

  // Сэтгэгдлийн автомат хариу — юу дутууг тодорхой хэлнэ
  const commentIssues = [];

  // Хуудасны ID: гараар тохируулсан эсвэл Facebook-ээс өөрөө олсон
  const pageId = await getPageId().catch(() => null);
  if (!pageId) commentIssues.push('Хуудасны ID тодорхойгүй — токеноо шалгана уу');

  // ⚠️ Захиалгыг УНШИЖ чадаагүй бол "захиалсан" гэж ХЭЛЖ БОЛОХГҮЙ.
  // Урьд нь missingFields хоосон байхад ногоон харуулж, худал итгэл өгдөг байв.
  const feedOk = result.subscription?.error
    ? null
    : !(result.missingFields ?? []).includes('feed');
  if (feedOk === false) commentIssues.push('webhook дээр feed талбар захиалаагүй');
  if (feedOk === null) {
    commentIssues.push(
      'feed захиалагдсан эсэхийг ШАЛГАЖ ЧАДСАНГҮЙ — pages_manage_metadata эрх дутуу',
    );
  }

  result.commentAutoReply = {
    enabled: config.fb.commentAutoReply,
    publicReply: config.fb.commentPublicReply,
    pageId: pageId ?? null,
    pageIdSource: config.fb.pageId ? 'FB_PAGE_ID' : pageId ? 'автоматаар олсон' : null,
    feedSubscribed: feedOk === null ? 'тодорхойгүй' : feedOk,
    issues: commentIssues,
    hint: commentIssues.length
      ? 'Дутуу зүйл байна — issues-г үзнэ үү. Засахгүйгээр асаавал ажиллахгүй.'
      : config.fb.commentAutoReply
        ? 'Тохиргоо бүрэн, асаалттай.'
        : 'Тохиргоо бүрэн. FB_COMMENT_AUTOREPLY=true болговол ажиллаж эхэлнэ.',
    steps: commentIssues.length
      ? [
          '1. developers.facebook.com → апп → Webhooks → Page → Subscribe: feed',
          '   (Энэ нь самбараас хийгддэг тул токенд нэмэлт эрх ХЭРЭГГҮЙ.)',
          '2. Эрх нэмэх бол: Graph API Explorer → pages_manage_metadata,',
          '   pages_manage_engagement, pages_read_engagement → шинэ Page токен үүсгэнэ.',
          '3. Vercel: FB_COMMENT_AUTOREPLY=true',
        ]
      : undefined,
  };

  return Response.json(result, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
