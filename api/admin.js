/**
 * Элсэлтийн ажилтны хяналтын самбар.
 * Маршрут: /api/admin  (vercel.json-оор /admin)
 *
 * Дөрвөн хэсэг:
 *   dashboard — тоо, график, өнөөдрийн ажил
 *   leads     — элсэгч бүр, тэмдэглэл хөтлөх, ажлын явц тэмдэглэх
 *   visits    — уулзалтын хуваарь (хэвлэхэд бэлэн)
 *   errors    — ботын алдаа, дутуу мэдээлэл
 *
 * Хамгаалалт: HTTP Basic auth. Хэрэглэгчийн нэр дурын, нууц үг = ADMIN_TOKEN.
 * POST-оор тэмдэглэл хадгална — мөн адил нууц үг шаардана.
 */
import {
  CALL_STATUSES,
  STAGES,
  addStaffNote,
  countLeads,
  listLeads,
} from '../src/leads.js';
import { IS_FIRST_YEAR_FREE, TUITION, formatMnt } from '../src/admissions.js';
import { kvDriver } from '../src/store.js';
import { EVENT_TYPES, listEvents } from '../src/events.js';
import { format as formatDate, shift, today } from '../src/dates.js';
import { barChart, columnChart, donutChart, funnelChart } from '../src/charts.js';

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

// ─── Тогтмолууд ────────────────────────────────────────────────────────

/** Бодитоор бүртгэгдсэн гэж тооцох шатууд */
const REGISTERED_STAGES = [
  'mode_selected',
  'contact_saved',
  'visit_booked',
  'invoice_created',
  'receipt_sent',
  'paid',
];
const isRegistered = (lead) => REGISTERED_STAGES.includes(lead.stage);

const MODE_LABELS = { in_person: 'Биеэр', online: 'Онлайн' };

/** Ажлын явцын өнгө — график, шошгонд ижил өнгө хэрэглэнэ */
const STATUS_COLORS = {
  new: '#94a3b8',
  to_call: '#f59e0b',
  called: '#3b82f6',
  no_answer: '#a855f7',
  enrolled: '#22c55e',
  declined: '#ef4444',
};

/** Юүлүүрийн алхмууд — ботын урсгалын дараалал */
const FUNNEL_STEPS = [
  { key: 'all', label: 'Яриа эхэлсэн' },
  { key: 'program_selected', label: 'Мэргэжил сонгосон' },
  { key: 'mode_selected', label: 'Бүртгэлийн зам сонгосон' },
  { key: 'visit_booked', label: 'Уулзалт товлосон' },
  { key: 'contact_saved', label: 'Нэр, утсаа өгсөн' },
];

const visitText = (lead) => {
  if (!lead.visit) return '';
  return (lead.visit.label ?? lead.visit.day) + ' ' + lead.visit.time;
};

const callStatusOf = (lead) => (CALL_STATUSES[lead.callStatus] ? lead.callStatus : 'new');

// ─── Нэвтрэлт ──────────────────────────────────────────────────────────

function unauthorized() {
  return new Response('Нэвтрэх шаардлагатай', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Deed AI admin", charset="UTF-8"',
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}

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
  <li>Хадгалаад дахин deploy хийнэ.</li>
  <li>Энэ хуудсыг дахин нээхэд хөтөч нэр/нууц үг асууна.
      Нэрийг дурын үг бичээд, нууц үгэнд <code>ADMIN_TOKEN</code>-оо оруулна.</li>
</ol>
<div class="note">Нууц үгээ бусадтай бүү хуваалц. Энэ хуудас элсэгчдийн нэр,
утас, хувийн мэдээллийг харуулна.</div>
</body></html>`,
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
  );
}

// ─── CSV ───────────────────────────────────────────────────────────────

function csvCell(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(leads) {
  const header = [
    'Огноо', 'Ажлын явц', 'Шат', 'Нэр', 'Нас', 'Утас', 'И-мэйл',
    'Мэргэжил', 'Зам', 'Уулзалт', 'Тэмдэглэл',
  ];
  const rows = leads.map((l) => [
    l.updatedAt,
    CALL_STATUSES[callStatusOf(l)],
    STAGES[l.stage] ?? l.stage,
    l.name, l.age ?? '', l.phone, l.email ?? '',
    l.programName, MODE_LABELS[l.registrationMode] ?? '',
    visitText(l),
    (l.notes ?? []).map((n) => n.text).join(' | '),
  ]);
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n');
}

// ─── Хуваарь ───────────────────────────────────────────────────────────

/** "14:00" → 840. Танихгүй бол хамгийн ард. */
function timeRank(time) {
  const m = String(time ?? '').match(/(\d{1,2})[:.](\d{2})/);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  const h = String(time ?? '').match(/(\d{1,2})/);
  return h ? Number(h[1]) * 60 : 9999;
}

/** Уулзалт товлосон элсэгчдийг ӨДРӨӨР нь бүлэглэнэ */
function groupVisits(leads) {
  const now = today();
  const tomorrow = shift(now, 1);
  const groups = new Map();

  for (const l of leads) {
    if (!l.visit) continue;
    const key = l.visit.date ?? 'unknown';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(l);
  }

  for (const list of groups.values()) {
    list.sort((x, y) => timeRank(x.visit.time) - timeRank(y.visit.time));
  }

  const out = [];
  for (const [date, list] of groups) {
    if (date === 'unknown') {
      out.push({ date, label: 'Огноо тодорхойгүй', kind: 'unknown', list });
      continue;
    }
    let label = formatDate(date);
    let kind = 'future';
    if (date === now) { label = 'ӨНӨӨДӨР · ' + label; kind = 'today'; }
    else if (date === tomorrow) { label = 'Маргааш · ' + label; kind = 'tomorrow'; }
    else if (date < now) kind = 'past';
    out.push({ date, label, kind, list });
  }

  const order = { today: 0, tomorrow: 1, future: 2, unknown: 3, past: 4 };
  out.sort((x, y) => {
    if (order[x.kind] !== order[y.kind]) return order[x.kind] - order[y.kind];
    if (x.kind === 'past') return y.date.localeCompare(x.date);
    return x.date.localeCompare(y.date);
  });
  return out;
}

function visitCounts(leads) {
  const now = today();
  const tomorrow = shift(now, 1);
  const c = { today: 0, tomorrow: 0, later: 0 };
  for (const l of leads) {
    const d = l.visit?.date;
    if (!d) continue;
    if (d === now) c.today += 1;
    else if (d === tomorrow) c.tomorrow += 1;
    else if (d > now) c.later += 1;
  }
  return c;
}

function phoneLink(phone) {
  if (!phone) return '<span class="dim">утас алга</span>';
  const digits = String(phone).replace(/[^\d+]/g, '');
  return `<a class="tel" href="tel:${esc(digits)}">${esc(phone)}</a>`;
}

function statusPill(lead) {
  const s = callStatusOf(lead);
  return `<span class="pill" style="--c:${STATUS_COLORS[s]}">${esc(CALL_STATUSES[s])}</span>`;
}

function slotRow(l) {
  const mode = MODE_LABELS[l.registrationMode] ?? '';
  return [
    '<li class="slot">',
    `<span class="t">${esc(l.visit?.time ?? '—')}</span>`,
    '<span class="who">',
    `<b>${esc(l.name ?? '(нэр алга)')}</b>`,
    `<span class="meta">${phoneLink(l.phone)}`,
    l.programName ? ' · ' + esc(l.programName) : '',
    '</span></span>',
    statusPill(l),
    `<span class="pay">${formatMnt(TUITION.seatDeposit)} бэлнээр</span>`,
    mode ? `<span class="mode">${esc(mode)}</span>` : '',
    '</li>',
  ].join('');
}

function renderSchedule(leads, showHeading = true) {
  const groups = groupVisits(leads);
  const heading = showHeading ? '<h2>📅 Уулзалтын хуваарь</h2>' : '';
  if (!groups.length) {
    return `<div class="sched">${heading}<div class="empty">Товлосон уулзалт хараахан алга.</div></div>`;
  }

  const sections = groups
    .map((g) => {
      const body = '<ol class="slots">' + g.list.map(slotRow).join('') + '</ol>';
      if (g.kind === 'past') {
        return `<details class="day past"><summary>${esc(g.label)} · ${g.list.length} хүн (өнгөрсөн)</summary>${body}</details>`;
      }
      return `<section class="day ${g.kind}"><h3>${esc(g.label)} <span class="cnt">${g.list.length} хүн</span></h3>${body}</section>`;
    })
    .join('');

  return `<div class="sched">${heading}${sections}</div>`;
}

function renderOnline(leads) {
  const list = leads.filter((l) => l.registrationMode === 'online' && l.name && l.phone);
  if (!list.length) return '';
  const rows = list
    .map((l) =>
      [
        '<li class="slot">',
        '<span class="who">',
        `<b>${esc(l.name)}</b>`,
        `<span class="meta">${phoneLink(l.phone)}`,
        l.email ? ' · ' + esc(l.email) : '',
        l.programName ? ' · ' + esc(l.programName) : '',
        '</span></span>',
        statusPill(l),
        `<span class="pay">Гүйлгээний утга: <b>${esc([l.name, l.phone].join(' '))}</b></span>`,
        '</li>',
      ].join(''),
    )
    .join('');
  return (
    '<div class="sched"><h2>💻 Онлайн бүртгэл — шилжүүлэг шалгах</h2>' +
    `<section class="day online"><ol class="slots">${rows}</ol></section></div>`
  );
}

// ─── Хяналтын самбар ───────────────────────────────────────────────────

/** Сүүлийн N хоногийн шинэ яриа */
function dailyCounts(leads, days = 14) {
  const start = shift(today(), -(days - 1));
  const buckets = new Map();
  for (let i = 0; i < days; i += 1) buckets.set(shift(start, i), 0);

  for (const l of leads) {
    const d = String(l.createdAt ?? '').slice(0, 10);
    if (buckets.has(d)) buckets.set(d, buckets.get(d) + 1);
  }
  return [...buckets].map(([date, value]) => ({ date, value }));
}

function renderDashboard(leads, total, events) {
  const stageCount = (key) => leads.filter((l) => l.stage === key).length;

  // Юүлүүр: шат нь урагш ахидаг тул "энэ шатнаас цааш явсан" гэж тооцно
  const order = ['new', 'program_selected', 'eesh_checked', 'mode_selected', 'visit_booked', 'contact_saved'];
  const reached = (key) => {
    const idx = order.indexOf(key);
    return leads.filter((l) => order.indexOf(l.stage) >= idx).length;
  };

  const funnel = FUNNEL_STEPS.map((s) => ({
    label: s.label,
    value: s.key === 'all' ? leads.length : reached(s.key),
  }));

  const programs = {};
  for (const l of leads) {
    if (!l.programName) continue;
    programs[l.programName] = (programs[l.programName] ?? 0) + 1;
  }
  const programRows = Object.entries(programs)
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);

  const statusCounts = {};
  for (const l of leads) {
    const s = callStatusOf(l);
    statusCounts[s] = (statusCounts[s] ?? 0) + 1;
  }
  const statusSlices = Object.keys(CALL_STATUSES).map((k) => ({
    label: CALL_STATUSES[k],
    value: statusCounts[k] ?? 0,
    color: STATUS_COLORS[k],
  }));

  const vc = visitCounts(leads);
  const registered = leads.filter(isRegistered).length;
  const withContact = leads.filter((l) => l.name && l.phone).length;
  const toCall = leads.filter((l) => callStatusOf(l) === 'to_call').length;
  const enrolled = leads.filter((l) => callStatusOf(l) === 'enrolled').length;
  const conv = total ? Math.round((withContact / total) * 100) : 0;

  const kpi = [
    { n: total, l: 'Нийт яриа', tone: '' },
    { n: withContact, l: 'Нэр, утсаа өгсөн', tone: 'good', sub: conv + '%' },
    { n: vc.today, l: 'Өнөөдөр ирнэ', tone: vc.today ? 'hot' : '' },
    { n: toCall, l: 'Залгах ёстой', tone: toCall ? 'warn' : '' },
    { n: enrolled, l: 'Элссэн', tone: 'good' },
    { n: events.length, l: 'Анхаарах зүйл', tone: events.length ? 'warn' : '' },
  ];

  return `
<div class="kpis">
  ${kpi
    .map(
      (k) =>
        `<div class="kpi ${k.tone}"><div class="n">${k.n}${k.sub ? `<small>${esc(k.sub)}</small>` : ''}</div>` +
        `<div class="l">${esc(k.l)}</div></div>`,
    )
    .join('')}
</div>

<div class="grid">
  <div class="panel wide">
    <h2>Элсэлтийн юүлүүр</h2>
    <p class="hint">Ярианы аль алхамд хүн хамгийн их алдаж байгааг харуул.</p>
    ${funnelChart(funnel)}
  </div>

  <div class="panel">
    <h2>Ажлын явц</h2>
    <p class="hint">Ажилтан хэнтэй холбогдсоныг тэмдэглэсэн байдал.</p>
    ${donutChart(statusSlices)}
  </div>

  <div class="panel wide">
    <h2>Сүүлийн 14 хоног</h2>
    <p class="hint">Өдөр бүр хэдэн шинэ хүн боттой ярьсан бэ.</p>
    ${columnChart(dailyCounts(leads))}
  </div>

  <div class="panel">
    <h2>Эрэлттэй мэргэжил</h2>
    <p class="hint">Хэдэн хүн сонгосон бэ.</p>
    ${barChart(programRows, { emptyText: 'Мэргэжил сонгосон хүн алга' })}
  </div>
</div>

<div class="panel">
  <h2>Өнөөдөр, маргаашийн ажил</h2>
  <p class="hint">Өнөөдөр ${vc.today} · маргааш ${vc.tomorrow} · цаашид ${vc.later} хүн ирнэ.
     Бүртгэгдсэн ${registered}.</p>
  ${renderSchedule(leads.filter((l) => l.visit), false)}
</div>`;
}

// ─── Элсэгчдийн жагсаалт ───────────────────────────────────────────────

function leadCard(l) {
  const s = callStatusOf(l);
  const notes = (l.notes ?? [])
    .map(
      (n) =>
        `<li><time>${esc(new Date(n.ts).toLocaleString('mn-MN'))}</time><span>${esc(n.text)}</span></li>`,
    )
    .join('');

  const options = Object.entries(CALL_STATUSES)
    .map(([k, label]) => `<option value="${k}"${k === s ? ' selected' : ''}>${esc(label)}</option>`)
    .join('');

  const search = [l.name, l.phone, l.email, l.programName, CALL_STATUSES[s]]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return `<article class="lead" data-status="${s}" data-search="${esc(search)}">
  <header>
    <div class="id">
      <b>${esc(l.name ?? '(нэр өгөөгүй)')}</b>
      <span class="meta">${phoneLink(l.phone)}${l.email ? ' · ' + esc(l.email) : ''}</span>
    </div>
    <div class="tags">
      ${statusPill(l)}
      <span class="stage s-${esc(l.stage)}">${esc(STAGES[l.stage] ?? l.stage)}</span>
      ${l.registrationMode ? `<span class="mode">${esc(MODE_LABELS[l.registrationMode])}</span>` : ''}
    </div>
  </header>

  <div class="facts">
    ${l.programName ? `<span>🎓 ${esc(l.programName)}</span>` : ''}
    ${l.visit ? `<span>📅 ${esc(visitText(l))}</span>` : ''}
    ${l.age ? `<span>👤 ${esc(l.age)} нас</span>` : ''}
    <span class="dim">Сүүлд: ${esc(new Date(l.updatedAt).toLocaleString('mn-MN'))}</span>
  </div>

  ${notes ? `<ul class="notes">${notes}</ul>` : ''}

  <form class="note-form" data-psid="${esc(l.psid)}">
    <select name="callStatus" aria-label="Ажлын явц">${options}</select>
    <input name="text" placeholder="Тэмдэглэл — юу ярьсан, юу тохирсон…" autocomplete="off">
    <button type="submit">Хадгалах</button>
    <span class="saved" hidden>✓</span>
  </form>
</article>`;
}

function renderLeads(leads) {
  if (!leads.length) {
    return '<div class="empty">Одоогоор бүртгэл алга. Messenger-ээр хэн нэгэн бичихэд энд харагдана.</div>';
  }

  const filters = Object.entries(CALL_STATUSES)
    .map(
      ([k, label]) =>
        `<button class="fchip" data-filter="${k}" style="--c:${STATUS_COLORS[k]}">${esc(label)}</button>`,
    )
    .join('');

  return `
<div class="toolbar">
  <input id="q" type="search" placeholder="Нэр, утас, мэргэжлээр хайх…" autocomplete="off">
  <div class="fchips">
    <button class="fchip on" data-filter="">Бүгд</button>
    ${filters}
  </div>
</div>
<div class="leads">${leads.map(leadCard).join('')}</div>
<div class="empty" id="noresult" hidden>Тохирох бүртгэл олдсонгүй.</div>`;
}

// ─── Алдааны хэсэг ─────────────────────────────────────────────────────

function renderEvents(events) {
  if (!events.length) {
    return '<div class="empty">Одоогоор алдаа, дутуу мэдээлэл бүртгэгдээгүй. 👍</div>';
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

  return `
<div class="chips">${chips}</div>
<div class="wrap">
  <table><thead><tr>
    <th>Огноо</th><th>Төрөл</th><th>Асуулт</th><th>Дэлгэрэнгүй</th>
  </tr></thead><tbody>${rows}</tbody></table>
</div>
<p class="hint">«Мэдээлэл дутуу» гэсэн мөрүүд нь ботын мэдэхгүй асуултууд —
эдгээрийг <code>knowledge/</code> хавтсанд нэмбэл бот дараагаас хариулж чадна.</p>`;
}

// ─── Хуудас ────────────────────────────────────────────────────────────

const STYLES = `
:root{color-scheme:light dark;--b:#8883;--muted:#8889;--bg:#8881}
*{box-sizing:border-box}
body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;margin:0;padding:1.25rem;line-height:1.5;max-width:78rem;margin-inline:auto}
h1{font-size:1.35rem;margin:0 0 .2rem}
h2{font-size:1rem;margin:0 0 .3rem}
h3{font-size:.9rem;margin:0 0 .6rem;display:flex;align-items:center;gap:.5rem;flex-wrap:wrap}
.sub{color:var(--muted);font-size:.85rem;margin-bottom:1rem}
.hint{font-size:.78rem;color:var(--muted);margin:0 0 .8rem}
.dim{color:var(--muted);font-size:.8rem}
.empty{padding:2.5rem 1rem;text-align:center;color:var(--muted)}
code{background:var(--bg);padding:.1em .35em;border-radius:4px;font-size:.85em}

.warn{background:#f59e0b22;border:1px solid #f59e0b66;padding:.7rem 1rem;border-radius:8px;margin-bottom:1rem;font-size:.88rem}

.tabs{display:flex;gap:.4rem;margin-bottom:1.25rem;flex-wrap:wrap}
.tab{font-size:.85rem;text-decoration:none;color:inherit;border:1px solid var(--b);padding:.35rem .85rem;border-radius:99px}
.tab.on{background:#8882;font-weight:600}

.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(8.5rem,1fr));gap:.7rem;margin-bottom:1.25rem}
.kpi{border:1px solid var(--b);border-radius:12px;padding:.7rem .9rem}
.kpi .n{font-size:1.7rem;font-weight:650;line-height:1.1;font-variant-numeric:tabular-nums}
.kpi .n small{font-size:.75rem;font-weight:500;color:var(--muted);margin-left:.35rem}
.kpi .l{font-size:.75rem;color:var(--muted);margin-top:.15rem}
.kpi.good{border-color:#22c55e66;background:#22c55e0d}
.kpi.warn{border-color:#f59e0b66;background:#f59e0b0d}
.kpi.hot{border-color:#3b82f666;background:#3b82f60d}

.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(19rem,1fr));gap:.9rem;margin-bottom:1rem}
.panel{border:1px solid var(--b);border-radius:12px;padding:.9rem 1rem;margin-bottom:.9rem}
.grid .panel{margin:0}
.panel.wide{grid-column:span 2}
@media(max-width:44rem){.panel.wide{grid-column:span 1}}

/* Юүлүүр */
.funnel{display:flex;flex-direction:column;gap:.35rem}
.fn-row{display:grid;grid-template-columns:9.5rem 1fr 4.5rem 3rem;gap:.5rem;align-items:center;font-size:.82rem}
.fn-label{color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fn-track{background:var(--bg);border-radius:5px;height:1.4rem;overflow:hidden}
.fn-fill{display:block;height:100%;background:linear-gradient(90deg,#3b82f6,#22c55e);border-radius:5px}
.fn-val{font-weight:600;font-variant-numeric:tabular-nums;text-align:right}
.fn-pct{color:var(--muted);font-weight:400;margin-left:.3rem;font-size:.75rem}
.fn-drop{color:#ef4444;font-size:.75rem;text-align:right}
@media(max-width:34rem){.fn-row{grid-template-columns:7rem 1fr 3.5rem;gap:.35rem}.fn-drop{display:none}}

/* Баганан */
.bars{display:flex;flex-direction:column;gap:.35rem}
.bar-row{display:grid;grid-template-columns:9rem 1fr 2.2rem;gap:.5rem;align-items:center;font-size:.82rem}
.bar-label{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--muted)}
.bar-track{background:var(--bg);border-radius:5px;height:1.1rem;overflow:hidden}
.bar-fill{display:block;height:100%;background:#3b82f6;border-radius:5px}
.bar-val{font-weight:600;text-align:right;font-variant-numeric:tabular-nums}

/* Өдрийн багана */
.cols{position:relative;padding-bottom:1.1rem}
.cols svg{width:100%;height:var(--h);display:block}
.cols .col{fill:#3b82f6;opacity:.65}
.cols .col.today{fill:#22c55e;opacity:1}
.col-labels{position:relative;height:1rem;font-size:.65rem;color:var(--muted)}
.col-labels span{position:absolute;transform:translateX(-50%);white-space:nowrap}
.col-max{font-size:.7rem;color:var(--muted);text-align:right}

/* Тойрог */
.donut{display:flex;align-items:center;gap:1rem;flex-wrap:wrap}
.donut svg{width:7.5rem;height:7.5rem;flex:none;transform:rotate(-90deg)}
.donut .ring{transition:none}
.d-num{font-size:.5rem;font-weight:700;text-anchor:middle;fill:currentColor;transform:rotate(90deg);transform-origin:21px 21px}
.legend{list-style:none;margin:0;padding:0;font-size:.8rem;display:flex;flex-direction:column;gap:.25rem}
.legend .dot{display:inline-block;width:.6rem;height:.6rem;border-radius:2px;margin-right:.4rem}
.c-empty{padding:1.5rem;text-align:center;color:var(--muted);font-size:.85rem}

/* Хуваарь */
.sched{margin:0 0 1rem}
.sched h2{margin-bottom:.7rem}
.day{border:1px solid var(--b);border-radius:12px;padding:.8rem 1rem;margin-bottom:.7rem}
.day .cnt{font-size:.72rem;font-weight:400;color:var(--muted);border:1px solid var(--b);border-radius:99px;padding:.05rem .5rem}
.day.today{border-color:#22c55e88;background:#22c55e0f}
.day.today h3{color:#16a34a}
.day.tomorrow{border-color:#3b82f688;background:#3b82f60f}
.day.unknown{border-color:#f59e0b88;background:#f59e0b0f}
.day.online{border-color:#a855f788;background:#a855f70f}
.day.past{opacity:.6;padding:.55rem 1rem}
.day.past summary{cursor:pointer;font-size:.85rem;color:var(--muted)}
.slots{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:.4rem}
.slot{display:flex;align-items:baseline;gap:.7rem;flex-wrap:wrap;padding:.45rem .6rem;border-radius:8px;background:var(--bg)}
.slot .t{font-size:1.05rem;font-weight:700;font-variant-numeric:tabular-nums;min-width:3.4rem}
.slot .who{display:flex;flex-direction:column;flex:1;min-width:11rem}
.slot .meta{font-size:.78rem;color:var(--muted)}
.slot .pay{font-size:.75rem;color:var(--muted);white-space:nowrap}
.slot .mode{font-size:.7rem;padding:.1rem .45rem;border-radius:99px;background:#8883;white-space:nowrap}
a.tel{color:inherit;font-weight:600;text-decoration:none;border-bottom:1px dotted var(--muted)}

/* Шошго */
.pill{font-size:.7rem;padding:.1rem .5rem;border-radius:99px;white-space:nowrap;
  color:var(--c);border:1px solid color-mix(in srgb,var(--c) 45%,transparent);
  background:color-mix(in srgb,var(--c) 12%,transparent)}
.stage{font-size:.7rem;padding:.1rem .5rem;border-radius:99px;background:#8882;white-space:nowrap}
.mode{font-size:.7rem;padding:.1rem .5rem;border-radius:99px;background:#8883}

/* Элсэгчийн карт */
.toolbar{display:flex;gap:.6rem;flex-wrap:wrap;align-items:center;margin-bottom:.9rem}
#q{flex:1;min-width:12rem;font:inherit;font-size:.88rem;padding:.45rem .7rem;border:1px solid var(--b);border-radius:8px;background:none;color:inherit}
.fchips{display:flex;gap:.35rem;flex-wrap:wrap}
.fchip{font:inherit;font-size:.78rem;padding:.25rem .7rem;border-radius:99px;border:1px solid var(--b);background:none;color:inherit;cursor:pointer}
.fchip.on{background:#8882;font-weight:600}
.fchip[data-filter]:not([data-filter=""]).on{border-color:var(--c);color:var(--c)}

.leads{display:flex;flex-direction:column;gap:.7rem}
.lead{border:1px solid var(--b);border-radius:12px;padding:.8rem 1rem}
.lead header{display:flex;justify-content:space-between;gap:.7rem;flex-wrap:wrap;align-items:flex-start}
.lead .id b{font-size:.98rem}
.lead .id .meta{display:block;font-size:.8rem;color:var(--muted)}
.lead .tags{display:flex;gap:.35rem;flex-wrap:wrap}
.lead .facts{display:flex;gap:.8rem;flex-wrap:wrap;font-size:.8rem;margin-top:.5rem;color:var(--muted)}
.notes{list-style:none;margin:.6rem 0 0;padding:.5rem .7rem;background:var(--bg);border-radius:8px;
  display:flex;flex-direction:column;gap:.35rem;font-size:.82rem}
.notes time{display:block;font-size:.68rem;color:var(--muted)}
.note-form{display:flex;gap:.4rem;margin-top:.6rem;flex-wrap:wrap;align-items:center}
.note-form select,.note-form input{font:inherit;font-size:.83rem;padding:.35rem .55rem;border:1px solid var(--b);border-radius:7px;background:none;color:inherit}
.note-form input{flex:1;min-width:11rem}
.note-form button{font:inherit;font-size:.83rem;padding:.35rem .8rem;border:1px solid var(--b);border-radius:7px;background:none;color:inherit;cursor:pointer}
.note-form button:hover{background:#8882}
.saved{color:#16a34a;font-weight:700}

.wrap{overflow-x:auto;border:1px solid var(--b);border-radius:10px}
table{border-collapse:collapse;width:100%;font-size:.85rem;min-width:42rem}
th,td{padding:.5rem .7rem;text-align:left;border-bottom:1px solid var(--b);vertical-align:top}
th{font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--muted);white-space:nowrap}
tr:last-child td{border-bottom:none}
.chips{display:flex;gap:.4rem;flex-wrap:wrap;margin-bottom:.7rem}
.chip{font-size:.75rem;padding:.15rem .55rem;border-radius:99px;background:#8882;white-space:nowrap}
.c-missing_info{background:#f59e0b33}.c-ai_error,.c-send_error,.c-tool_error{background:#ef444433}
.c-rate_limited{background:#8b5cf633}

a.btn,button.btn{display:inline-block;margin:.9rem .4rem 0 0;font-size:.85rem;text-decoration:none;border:1px solid var(--b);padding:.4rem .8rem;border-radius:8px;color:inherit;background:none;font-family:inherit;cursor:pointer}

@media print{
  body{padding:0;font-size:11pt;max-width:none}
  .tabs,.kpis,.grid,.toolbar,.warn,a.btn,button.btn,.note-form,.sub{display:none!important}
  .panel{border:none;padding:0}
  .day{break-inside:avoid;border-color:#999;background:none!important}
  .day.past{display:none}
  .slot{background:none;border-bottom:1px solid #ddd;border-radius:0}
  a.tel{border:none}
}`;

const SCRIPT = `
// Тэмдэглэл хадгалах — хуудас дахин ачаалахгүй
document.addEventListener('submit', async (e) => {
  const form = e.target.closest('.note-form');
  if (!form) return;
  e.preventDefault();

  const btn = form.querySelector('button');
  const mark = form.querySelector('.saved');
  btn.disabled = true;

  try {
    // location.origin ашиглана: хаягт нэвтрэлтийн мэдээлэл байвал
    // харьцангуй зам fetch-д ажиллахгүй болдог.
    const res = await fetch(location.origin + location.pathname, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        psid: form.dataset.psid,
        callStatus: form.callStatus.value,
        text: form.text.value,
      }),
    });
    if (!res.ok) throw new Error(await res.text());

    const data = await res.json();
    form.text.value = '';
    mark.hidden = false;
    setTimeout(() => { mark.hidden = true; }, 1600);

    // Тэмдэглэлийг шууд харуулна
    if (data.note) {
      const card = form.closest('.lead');
      let list = card.querySelector('.notes');
      if (!list) {
        list = document.createElement('ul');
        list.className = 'notes';
        card.insertBefore(list, form);
      }
      const li = document.createElement('li');
      const t = document.createElement('time');
      t.textContent = new Date(data.note.ts).toLocaleString('mn-MN');
      const s = document.createElement('span');
      s.textContent = data.note.text;
      li.append(t, s);
      list.prepend(li);
    }
    if (data.callStatus) {
      const card = form.closest('.lead');
      card.dataset.status = data.callStatus;
      const pill = card.querySelector('.pill');
      if (pill) {
        pill.textContent = data.callStatusLabel;
        pill.style.setProperty('--c', data.callStatusColor);
      }
    }
  } catch (err) {
    alert('Хадгалж чадсангүй: ' + err.message);
  } finally {
    btn.disabled = false;
  }
});

// Хайлт, шүүлтүүр
const q = document.getElementById('q');
let activeFilter = '';

function applyFilter() {
  const term = (q?.value ?? '').trim().toLowerCase();
  let shown = 0;
  for (const card of document.querySelectorAll('.lead')) {
    const okStatus = !activeFilter || card.dataset.status === activeFilter;
    const okTerm = !term || (card.dataset.search ?? '').includes(term);
    const show = okStatus && okTerm;
    card.hidden = !show;
    if (show) shown += 1;
  }
  const none = document.getElementById('noresult');
  if (none) none.hidden = shown > 0;
}

q?.addEventListener('input', applyFilter);
for (const chip of document.querySelectorAll('.fchip')) {
  chip.addEventListener('click', () => {
    for (const c of document.querySelectorAll('.fchip')) c.classList.remove('on');
    chip.classList.add('on');
    activeFilter = chip.dataset.filter;
    applyFilter();
  });
}`;

function renderPage({ view, leads, all, total, events }) {
  const registered = all.filter(isRegistered).length;
  const visitTotal = all.filter((l) => l.visit).length;
  const vc = visitCounts(all);

  const warning =
    kvDriver === 'memory'
      ? `<div class="warn">⚠️ Redis холбогдоогүй байна. Бүртгэл зөвхөн санах ойд хадгалагдаж,
         сервер дахин эхлэхэд устана. Vercel → Storage → Upstash for Redis холбоно уу.</div>`
      : '';

  const tabs = [
    ['dashboard', '📊 Хяналт', ''],
    ['leads', '👥 Элсэгчид', String(registered)],
    ['visits', '📅 Хуваарь', String(visitTotal)],
    ['errors', '⚠️ Алдаа', String(events.length)],
  ]
    .map(
      ([key, label, count]) =>
        `<a class="tab ${view === key ? 'on' : ''}" href="/api/admin?view=${key}">` +
        `${esc(label)}${count ? ' (' + count + ')' : ''}</a>`,
    )
    .join('');

  let body = '';
  let title = 'Элсэлтийн хяналт';
  let sub = '';

  if (view === 'leads') {
    title = 'Элсэгчид';
    sub = `${registered} хүн бүртгэгдсэн · нэр дээр дарж утсаар нь залгана · тэмдэглэлээ хадгална`;
    body = renderLeads(leads);
  } else if (view === 'visits') {
    title = 'Уулзалтын хуваарь';
    sub = `Өнөөдөр <b>${vc.today} хүн</b> ирнэ · маргааш ${vc.tomorrow} · цаашид ${vc.later} · хураамж ${formatMnt(TUITION.seatDeposit)} бэлнээр`;
    body = renderSchedule(leads.filter((l) => l.visit), false) + renderOnline(leads);
  } else if (view === 'errors') {
    title = 'Ботын алдаа, дутуу мэдээлэл';
    sub = 'Бот юуг мэдэхгүй байна, хаана алдав — мэдлэгийн санг эндээс баяжуулна';
    body = `<div class="panel">${renderEvents(events)}</div>`;
  } else {
    title = 'Элсэлтийн хяналт';
    sub = `${IS_FIRST_YEAR_FREE ? 'Эхний жил үнэгүй' : 'Эхний жил ' + formatMnt(TUITION.baseAnnual)} · суудлын хураамж ${formatMnt(TUITION.seatDeposit)}`;
    body = renderDashboard(all, total, events);
  }

  const csvLink =
    view === 'leads' || view === 'visits'
      ? `<a class="btn" href="/api/admin?view=${view}&format=csv">⬇ CSV татах</a>`
      : '';
  const printBtn =
    view === 'visits' ? '<button class="btn" onclick="window.print()">🖨 Хуваарь хэвлэх</button>' : '';

  return `<!doctype html>
<html lang="mn"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)} — Соёл Эрдэм</title>
<style>${STYLES}</style></head><body>
<h1>${esc(title)}</h1>
<div class="sub">${sub}</div>
<div class="tabs">${tabs}</div>
${warning}
${body}
${printBtn}${csvLink}
<script>${SCRIPT}</script>
</body></html>`;
}

// ─── Хүсэлт боловсруулах ───────────────────────────────────────────────

export async function GET(request) {
  const token = adminToken();
  if (!token) return setupPage();
  if (!checkAuth(request, token)) return unauthorized();

  const url = new URL(request.url);
  const limit = Math.min(1000, Number(url.searchParams.get('limit')) || 300);
  const all = await listLeads(limit);
  const total = await countLeads();
  const events = await listEvents(150);

  const view = ['dashboard', 'leads', 'visits', 'errors'].includes(url.searchParams.get('view'))
    ? url.searchParams.get('view')
    : 'dashboard';

  let leads = all;
  if (view === 'leads') leads = all.filter(isRegistered);
  else if (view === 'visits') leads = all.filter((l) => l.visit || l.registrationMode === 'online');

  if (url.searchParams.get('format') === 'csv') {
    return new Response(`﻿${toCsv(leads)}`, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="elsegchid-${today()}.csv"`,
      },
    });
  }

  return new Response(renderPage({ view, leads, all, total, events }), {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

/** Ажилтны тэмдэглэл, ажлын явцыг хадгална */
export async function POST(request) {
  const token = adminToken();
  if (!token) return new Response('Тохируулаагүй', { status: 503 });
  if (!checkAuth(request, token)) return unauthorized();

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response('Буруу хүсэлт', { status: 400 });
  }

  const psid = typeof body?.psid === 'string' ? body.psid.trim() : '';
  if (!psid) return new Response('psid дутуу байна', { status: 400 });

  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  const callStatus = CALL_STATUSES[body?.callStatus] ? body.callStatus : null;
  if (!text && !callStatus) return new Response('Хадгалах зүйл алга', { status: 400 });

  const lead = await addStaffNote(psid, { text, callStatus });
  const status = callStatusOf(lead);

  return Response.json({
    ok: true,
    note: text ? lead.notes?.[0] ?? null : null,
    callStatus: status,
    callStatusLabel: CALL_STATUSES[status],
    callStatusColor: STATUS_COLORS[status],
  });
}
