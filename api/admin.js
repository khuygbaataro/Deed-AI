/**
 * Хяналтын самбар — чатботоор дамжсан элсэгчдийн жагсаалт.
 * Маршрут: /api/admin  (vercel.json-оор /admin)
 *
 * Хамгаалалт: HTTP Basic auth. Хэрэглэгчийн нэр дурын, нууц үг = ADMIN_TOKEN.
 * ADMIN_TOKEN тохируулаагүй бол хуудас огт нээгдэхгүй (404).
 */
import { countLeads, listLeads, STAGES } from '../src/leads.js';
import { TUITION, formatMnt } from '../src/admissions.js';
import { kvDriver } from '../src/store.js';

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
    'Огноо', 'Шат', 'Нэр', 'Утас', 'Мэргэжил', 'ЭЕШ',
    'Босго', 'Урамшуулал', 'Төлөх дүн', 'Нэхэмжлэх', 'Төлсөн',
  ];
  const rows = leads.map((l) => [
    l.updatedAt, STAGES[l.stage] ?? l.stage, l.name, l.phone, l.programName,
    (l.eesh ?? []).map((e) => `${e.subject} ${e.score}`).join(' / '),
    l.qualified === null ? '' : l.qualified ? 'хангасан' : 'хүрээгүй',
    l.incentiveLabel,
    l.annualAfterDiscount === null ? '' : l.annualAfterDiscount,
    l.invoice?.senderInvoiceNo ?? '',
    l.invoice?.paidAt ? 'тийм' : '',
  ]);
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n');
}

function renderPage(leads, total) {
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
      const eesh = (l.eesh ?? []).map((e) => `${esc(e.subject)} <b>${esc(e.score)}</b>`).join('<br>');
      const paid = l.invoice?.paidAt
        ? '<span class="ok">төлсөн</span>'
        : l.invoice
          ? '<span class="pending">хүлээгдэж буй</span>'
          : '';
      return `<tr>
        <td class="dim">${esc(new Date(l.updatedAt).toLocaleString('mn-MN'))}</td>
        <td><span class="stage s-${esc(l.stage)}">${esc(STAGES[l.stage] ?? l.stage)}</span></td>
        <td>${esc(l.name ?? '')}</td>
        <td>${esc(l.phone ?? '')}</td>
        <td>${esc(l.programName ?? '')}</td>
        <td class="dim">${eesh}</td>
        <td>${l.qualified === null || l.qualified === undefined ? '' : l.qualified ? '✅' : '❌'}</td>
        <td>${esc(l.incentiveLabel ?? '')}</td>
        <td>${l.annualAfterDiscount === null || l.annualAfterDiscount === undefined ? '' : esc(formatMnt(l.annualAfterDiscount))}</td>
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
table{border-collapse:collapse;width:100%;font-size:.875rem;min-width:60rem}
th,td{padding:.55rem .7rem;text-align:left;border-bottom:1px solid var(--b);vertical-align:top}
th{font-weight:600;font-size:.75rem;text-transform:uppercase;color:var(--muted);white-space:nowrap}
tr:last-child td{border-bottom:none}
.dim{color:var(--muted);font-size:.8rem}
.stage{font-size:.75rem;padding:.15rem .5rem;border-radius:99px;background:#8882;white-space:nowrap}
.s-paid{background:#22c55e33}.s-invoice_created{background:#3b82f633}
.s-escalated{background:#f59e0b33}.s-eesh_checked{background:#a855f733}
.ok{color:#16a34a;font-weight:600}.pending{color:#ca8a04}
.empty{padding:3rem 1rem;text-align:center;color:var(--muted)}
a.btn{display:inline-block;margin-top:1rem;font-size:.85rem;text-decoration:none;border:1px solid var(--b);padding:.4rem .8rem;border-radius:8px;color:inherit}
</style></head><body>
<h1>Элсэгчдийн бүртгэл</h1>
<div class="sub">Нийт ${total} бүртгэл · сүүлийн ${leads.length}-г харуулж байна ·
  үндсэн төлбөр ${formatMnt(TUITION.baseAnnual)} · хураамж ${formatMnt(TUITION.seatDeposit)}</div>
${warning}
<div class="cards">${cards}</div>
<div class="wrap">
${
  leads.length
    ? `<table><thead><tr>
        <th>Огноо</th><th>Шат</th><th>Нэр</th><th>Утас</th><th>Мэргэжил</th>
        <th>ЭЕШ</th><th>Босго</th><th>Урамшуулал</th><th>Төлөх дүн</th><th>Төлбөр</th>
      </tr></thead><tbody>${rows}</tbody></table>`
    : '<div class="empty">Одоогоор бүртгэл алга. Messenger-ээр яриа эхлэхэд энд харагдана.</div>'
}
</div>
<a class="btn" href="/api/admin?format=csv">⬇ CSV татах</a>
</body></html>`;
}

export async function GET(request) {
  const token = adminToken();
  if (!token) return new Response('Not Found', { status: 404 });
  if (!checkAuth(request, token)) return unauthorized();

  const url = new URL(request.url);
  const limit = Math.min(1000, Number(url.searchParams.get('limit')) || 200);
  const leads = await listLeads(limit);
  const total = await countLeads();

  if (url.searchParams.get('format') === 'csv') {
    return new Response(`﻿${toCsv(leads)}`, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="elsegchid-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }

  return new Response(renderPage(leads, total), {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
