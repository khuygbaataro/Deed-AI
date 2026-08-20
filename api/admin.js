/**
 * Хяналтын самбар — чатботоор дамжсан элсэгчдийн жагсаалт.
 * Маршрут: /api/admin  (vercel.json-оор /admin)
 *
 * Хамгаалалт: HTTP Basic auth. Хэрэглэгчийн нэр дурын, нууц үг = ADMIN_TOKEN.
 * ADMIN_TOKEN тохируулаагүй бол өгөгдөл харагдахгүй — оронд нь тохируулах заавар гарна.
 */
import { countLeads, listLeads, STAGES } from '../src/leads.js';
import { IS_FIRST_YEAR_FREE, TUITION, formatMnt } from '../src/admissions.js';
import { kvDriver } from '../src/store.js';
import { EVENT_TYPES, listEvents } from '../src/events.js';

const adminToken = () => {
  const v = process.env.ADMIN_TOKEN;
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
};

/** HTML-д тавихаас өмнө утгыг цэвэрлэнэ (XSS-ээс хамгаална) */
function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}


/** ADMIN_TOKEN тохируулаагүй үед юу хийхийг тайлбарлана */
function setupPage() {
  return new Response(
    `<!doctype html><html lang="mn"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Тохируулга шаардлагатай</title>
<style>
:root{color-scheme:light dark}
body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;max-width:34rem;margin:4rem auto;padding:0 1.25rem;line-height:1.65}
h1{font-size:1.25rem}code{background:#8882;padding:.15em .4em;border-radius:4px}
ol{padding-left:1.2rem}li{margin:.5rem 0}
.note{background:#8881;border-left:3px solid #8884;padding:.75rem 1rem;border-radius:0 6px 6px 0;font-size:.9rem;margin-top:1.5rem}
</style></head><body>
<h1>🔒 Хяналтын самбар хаалттай байна</h1>
<p>Элсэгчдийн жагсаалт хувийн мэдээлэл агуулдаг тул нууц үг тохируулах хүртэл
энэ хуудас нээгдэхгүй.</p>
<ol>
  <li>Vercel → төслийн <b>Settings → Environment Variables</b> руу орно.</li>
  <li><code>ADMIN_TOKEN</code> нэртэй хувьсагч нэмж, өөрийн сонгосон
      <b>хүчтэй нууц үгийг</b> утга болгон бичнэ. Environment: Production.</li>
  <li>Хадгалаад дахин deploy хийнэ: <code>vercel deploy --prod --yes</code></li>
  <li>Энэ хуудсыг дахин нээхэд хөтөч нэр/нууц үг асууна.
      Нэрийг дурын үг бичээд, нууц үгэнд <code>ADMIN_TOKEN</code>-оо оруулна.</li>
</ol>
<div class="note">Нууц үгээ бусадтай бүү хуваалц. Энэ хуудас элсэгчдийн нэр,
утас, ЭЕШ-ийн оноог харуулна.</div>
</body></html>`,
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
  );
}

/** Зөвхөн холбоо барих мэдээлэлтэй болсон (бодитоор бүртгэгдсэн) элсэгчид */
const REGISTERED_STAGES = ['contact_saved', 'invoice_created', 'paid'];
const isRegistered = (lead) => REGISTERED_STAGES.includes(lead.stage);

function unauthorized() {
  return new Response('Нэвтрэх шаардлагатай', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Deed AI admin", charset="UTF-8"',
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}

/** Basic auth-ийн нууц үгийг шалгана */
function checkAuth(request, expected) {
  const header = request.headers.get('authorization');
  if (!header || !header.toLowerCase().startsWith('basic ')) return false;
  try {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const password = decoded.slice(decoded.indexOf(':') + 1);
    return password === expected;
  } catch {
    return false;
  }
}

function csvCell(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(leads) {
  const header = [
    'Огноо', 'Шат', 'Нэр', 'Нас', 'Утас', 'И-мэйл', 'Мэргэжил', 'Урсгал', 'Нэхэмжлэх', 'Төлсөн',
  ];
  const rows = leads.map((l) => [
    l.updatedAt, STAGES[l.stage] ?? l.stage, l.name, l.age ?? '', l.phone,
    l.email ?? '', l.programName, l.trackName ?? '',
    l.invoice?.senderInvoiceNo ?? '',
    l.invoice?.paidAt ? 'тийм' : '',
  ]);
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n');
}

/**
 * Анхаарах үйл явдлууд — бот юуг мэдэхгүй байна, хаана алдав.
 * Мэдлэгийн санг юугаар баяжуулахыг эндээс шууд харна.
 */
function renderEvents(events) {
  if (!events.length) {
    return '<div class="events"><h2>Анхаарах зүйлс</h2>' +
      '<div class="empty">Одоогоор алдаа, дутуу мэдээлэл бүртгэгдээгүй.</div></div>';
  }

  const counts = {};
  for (const e of events) counts[e.type] = (counts[e.type] ?? 0) + 1;

  const chips = Object.entries(counts)
    .map(([k, n]) => `<span class="chip c-${esc(k)}">${esc(EVENT_TYPES[k] ?? k)}: ${n}</span>`)
    .join('');

  const rows = events
    .map(
      (e) => `<tr>
        <td class="dim">${esc(new Date(e.ts).toLocaleString('mn-MN'))}</td>
        <td><span class="chip c-${esc(e.type)}">${esc(EVENT_TYPES[e.type] ?? e.type)}</span></td>
        <td>${esc(e.question ?? '')}</td>
        <td class="dim">${esc(e.detail ?? '')}</td>
      </tr>`,
    )
    .join('');

  return `<div class="events">
    <h2>Анхаарах зүйлс</h2>
    <div class="chips">${chips}</div>
    <div class="wrap">
      <table><thead><tr>
        <th>Огноо</th><th>Төрөл</th><th>Асуулт</th><th>Дэлгэрэнгүй</th>
      </tr></thead><tbody>${rows}</tbody></table>
    </div>
    <p class="hint">"Мэдээлэл дутуу" гэсэн мөрүүд нь ботын мэдэхгүй асуултууд —
    эдгээрийг knowledge/ хавтсанд нэмбэл бот дараагаас хариулж чадна.</p>
  </div>`;
}

function renderPage(leads, total, filter, registeredCount, events = []) {
  const stageCounts = {};
  for (const l of leads) stageCounts[l.stage] = (stageCounts[l.stage] ?? 0) + 1;

  const warning =
    kvDriver === 'memory'
      ? `<div class="warn">⚠️ Redis холбогдоогүй байна. Бүртгэл зөвхөн санах ойд хадгалагдаж,
         сервер дахин эхлэхэд устана. Vercel → Storage → Upstash for Redis холбоно уу.</div>`
      : '';

  const cards = Object.entries(STAGES)
    .map(
      ([k, label]) =>
        `<div class="card"><div class="n">${stageCounts[k] ?? 0}</div><div class="l">${esc(label)}</div></div>`,
    )
    .join('');

  const rows = leads
    .map((l) => {
      const paid = l.invoice?.paidAt
        ? '<span class="ok">төлсөн</span>'
        : l.invoice
          ? '<span class="pending">хүлээгдэж буй</span>'
          : '';
      return `<tr>
        <td class="dim">${esc(new Date(l.updatedAt).toLocaleString('mn-MN'))}</td>
        <td><span class="stage s-${esc(l.stage)}">${esc(STAGES[l.stage] ?? l.stage)}</span></td>
        <td>${esc(l.name ?? '')}</td>
        <td class="num">${esc(l.age ?? '')}</td>
        <td>${esc(l.phone ?? '')}</td>
        <td class="dim">${esc(l.email ?? '')}</td>
        <td>${esc(l.programName ?? '')}</td>
        <td class="dim">${esc(l.trackName ?? '')}</td>
        <td>${paid}</td>
      </tr>`;
    })
    .join('');

  return `<!doctype html>
<html lang="mn"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Элсэгчид — Deed AI</title>
<style>
:root{color-scheme:light dark;--b:#8883;--muted:#8889}
*{box-sizing:border-box}
body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;margin:0;padding:1.5rem;line-height:1.5}
h1{font-size:1.3rem;margin:0 0 .25rem}
.sub{color:var(--muted);font-size:.85rem;margin-bottom:1.25rem}
.warn{background:#f59e0b22;border:1px solid #f59e0b66;padding:.75rem 1rem;border-radius:8px;margin-bottom:1.25rem;font-size:.9rem}
.cards{display:flex;gap:.75rem;flex-wrap:wrap;margin-bottom:1.5rem}
.card{border:1px solid var(--b);border-radius:10px;padding:.6rem 1rem;min-width:7rem}
.card .n{font-size:1.5rem;font-weight:600}
.card .l{font-size:.75rem;color:var(--muted)}
.wrap{overflow-x:auto;border:1px solid var(--b);border-radius:10px}
table{border-collapse:collapse;width:100%;font-size:.875rem;min-width:48rem}
.num{font-variant-numeric:tabular-nums}
th,td{padding:.55rem .7rem;text-align:left;border-bottom:1px solid var(--b);vertical-align:top}
th{font-weight:600;font-size:.75rem;text-transform:uppercase;color:var(--muted);white-space:nowrap}
tr:last-child td{border-bottom:none}
.dim{color:var(--muted);font-size:.8rem}
.stage{font-size:.75rem;padding:.15rem .5rem;border-radius:99px;background:#8882;white-space:nowrap}
.s-paid{background:#22c55e33}.s-invoice_created{background:#3b82f633}
.s-escalated{background:#f59e0b33}.s-eesh_checked{background:#a855f733}
.ok{color:#16a34a;font-weight:600}.pending{color:#ca8a04}
.empty{padding:3rem 1rem;text-align:center;color:var(--muted)}
.tabs{display:flex;gap:.5rem;margin-bottom:1.25rem}
.tab{font-size:.85rem;text-decoration:none;color:inherit;border:1px solid var(--b);padding:.35rem .8rem;border-radius:99px}
.tab.on{background:#8882;font-weight:600}
.events{margin-top:2.5rem}
.events h2{font-size:1.05rem;margin:0 0 .6rem}
.chips{display:flex;gap:.4rem;flex-wrap:wrap;margin-bottom:.75rem}
.chip{font-size:.75rem;padding:.15rem .55rem;border-radius:99px;background:#8882;white-space:nowrap}
.c-missing_info{background:#f59e0b33}.c-ai_error{background:#ef444433}
.c-send_error{background:#ef444433}.c-tool_error{background:#ef444433}
.c-rate_limited{background:#8b5cf633}
.hint{font-size:.8rem;color:var(--muted);margin-top:.6rem}
a.btn{display:inline-block;margin-top:1rem;font-size:.85rem;text-decoration:none;border:1px solid var(--b);padding:.4rem .8rem;border-radius:8px;color:inherit}
</style></head><body>
<h1>Элсэгчдийн бүртгэл</h1>
<div class="sub">Нийт ${total} яриа · <b>${registeredCount} нь нэр, утсаа өгсөн</b> ·
  ${IS_FIRST_YEAR_FREE ? "эхний жил үнэгүй" : "эхний жил " + formatMnt(TUITION.baseAnnual)} · хураамж ${formatMnt(TUITION.seatDeposit)}</div>
<div class="tabs">
  <a class="tab ${filter === 'registered' ? '' : 'on'}" href="/api/admin">Бүгд (${total})</a>
  <a class="tab ${filter === 'registered' ? 'on' : ''}" href="/api/admin?filter=registered">✅ Бүртгэгдсэн (${registeredCount})</a>
</div>
${warning}
<div class="cards">${cards}</div>
<div class="wrap">
${
  leads.length
    ? `<table><thead><tr>
        <th>Огноо</th><th>Шат</th><th>Нэр</th><th>Нас</th><th>Утас</th>
        <th>И-мэйл</th><th>Мэргэжил</th><th>Урсгал</th><th>Төлбөр</th>
      </tr></thead><tbody>${rows}</tbody></table>`
    : `<div class="empty">${filter === 'registered' ? 'Нэр, утсаа өгсөн элсэгч хараахан алга.' : 'Одоогоор яриа алга. Messenger-ээр хэн нэгэн бичихэд энд харагдана.'}</div>`
}
</div>
${renderEvents(events)}
<a class="btn" href="/api/admin?format=csv${filter === 'registered' ? '&filter=registered' : ''}">⬇ CSV татах</a>
</body></html>`;
}

export async function GET(request) {
  const token = adminToken();
  if (!token) return setupPage();
  if (!checkAuth(request, token)) return unauthorized();

  const url = new URL(request.url);
  const limit = Math.min(1000, Number(url.searchParams.get('limit')) || 200);
  const all = await listLeads(limit);
  const total = await countLeads();
  const filter = url.searchParams.get('filter');
  const leads = filter === 'registered' ? all.filter(isRegistered) : all;
  const events = await listEvents(150);

  if (url.searchParams.get('format') === 'csv') {
    return new Response(`﻿${toCsv(leads)}`, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="elsegchid-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }

  return new Response(renderPage(leads, total, filter, all.filter(isRegistered).length, events), {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
