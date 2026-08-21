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
import { format as formatDate, shift, today } from '../src/dates.js';

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
const REGISTERED_STAGES = ['mode_selected', 'contact_saved', 'visit_booked', 'invoice_created', 'receipt_sent', 'paid'];

/** Бүртгэлийн зам — самбарт ойлгомжтой нэрээр */
const MODE_LABELS = { in_person: 'Биеэр', online: 'Онлайн' };

/** Уулзалтыг бодит огноотой нь харуулна */
const visitText = (lead) => {
  if (!lead.visit) return '';
  return (lead.visit.label ?? lead.visit.day) + ' ' + lead.visit.time;
};
const isRegistered = (lead) => REGISTERED_STAGES.includes(lead.stage);

/**
 * Уулзалтын цагийг эрэмбэлэхэд ашиглах тоо.
 * "14:00" → 840. Танихгүй бол хамгийн ард тавина.
 */
function timeRank(time) {
  const m = String(time ?? '').match(/(\d{1,2})[:.](\d{2})/);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  const h = String(time ?? '').match(/(\d{1,2})/);
  return h ? Number(h[1]) * 60 : 9999;
}

/**
 * Уулзалт товлосон элсэгчдийг ӨДРӨӨР нь бүлэглэнэ.
 *
 * Сургалтын албаны ажилтан "өнөөдөр хэн ирэх вэ?" гэдгийг хамгийн түрүүнд
 * харах ёстой. Тиймээс өнөөдөр, маргааш дээгүүр, өнгөрсөн нь доогуур.
 */
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
    else if (date < now) { label = label; kind = 'past'; }
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

/** Өнөөдөр, маргааш, цаашид хэдэн хүн ирэхийг тоолно */
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

/** Утасны дугаарыг дарахад залгадаг холбоос болгоно */
function phoneLink(phone) {
  if (!phone) return '<span class="dim">утас алга</span>';
  const digits = String(phone).replace(/[^\d+]/g, '');
  return '<a class="tel" href="tel:' + esc(digits) + '">' + esc(phone) + '</a>';
}

/** Нэг элсэгчийн мөр — хуваарийн жагсаалтад */
function slotRow(l) {
  const mode = MODE_LABELS[l.registrationMode] ?? '';
  return [
    '<li class="slot">',
    '<span class="t">' + esc(l.visit?.time ?? '—') + '</span>',
    '<span class="who">',
    '<b>' + esc(l.name ?? '(нэр алга)') + '</b>',
    '<span class="meta">' + phoneLink(l.phone) +
      (l.programName ? ' · ' + esc(l.programName) : '') +
      (l.age ? ' · ' + esc(l.age) + ' нас' : '') + '</span>',
    '</span>',
    '<span class="pay">' + formatMnt(TUITION.seatDeposit) + ' бэлнээр</span>',
    mode ? '<span class="mode">' + esc(mode) + '</span>' : '',
    '</li>',
  ].join('');
}

/**
 * Уулзалтын хуваарь — сургалтын албанд шууд өгөх харагдац.
 * Хэвлэхэд зориулж print CSS бэлдсэн.
 */
function renderSchedule(leads, showHeading = true) {
  const groups = groupVisits(leads);
  const heading = showHeading ? '<h2>📅 Уулзалтын хуваарь</h2>' : '';
  if (!groups.length) {
    return '<div class="sched">' + heading +
      '<div class="empty">Товлосон уулзалт хараахан алга.</div></div>';
  }

  const sections = groups
    .map((g) => {
      const body = '<ol class="slots">' + g.list.map(slotRow).join('') + '</ol>';
      const head = '<h3>' + esc(g.label) + ' <span class="cnt">' + g.list.length + ' хүн</span></h3>';
      if (g.kind === 'past') {
        return '<details class="day past"><summary>' + esc(g.label) +
          ' · ' + g.list.length + ' хүн (өнгөрсөн)</summary>' + body + '</details>';
      }
      return '<section class="day ' + g.kind + '">' + head + body + '</section>';
    })
    .join('');

  return '<div class="sched">' + heading + sections + '</div>';
}

/**
 * Онлайнаар бүртгүүлсэн — уулзалт байхгүй ч санхүү шалгах ёстой хүмүүс.
 */
function renderOnline(leads) {
  const list = leads.filter((l) => l.registrationMode === 'online' && l.name && l.phone);
  if (!list.length) return '';
  const rows = list
    .map((l) => [
      '<li class="slot">',
      '<span class="who">',
      '<b>' + esc(l.name) + '</b>',
      '<span class="meta">' + phoneLink(l.phone) +
        (l.email ? ' · ' + esc(l.email) : '') +
        (l.programName ? ' · ' + esc(l.programName) : '') + '</span>',
      '</span>',
      '<span class="pay">Гүйлгээний утга: <b>' + esc([l.name, l.phone].join(' ')) + '</b></span>',
    ].join(''))
    .join('');
  return '<div class="sched"><h2>💻 Онлайн бүртгэл — шилжүүлэг шалгах</h2>' +
    '<section class="day online"><ol class="slots">' + rows + '</ol></section></div>';
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
    'Огноо', 'Шат', 'Нэр', 'Нас', 'Утас', 'И-мэйл', 'Мэргэжил', 'Урсгал', 'Зам', 'Уулзалт', 'Төлсөн',
  ];
  const rows = leads.map((l) => [
    l.updatedAt, STAGES[l.stage] ?? l.stage, l.name, l.age ?? '', l.phone,
    l.email ?? '', l.programName, l.trackName ?? '',
    MODE_LABELS[l.registrationMode] ?? '',
    visitText(l),
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

function renderPage(leads, total, filter, registeredCount, events = [], visitCount = 0) {
  const isVisits = filter === 'visits';
  const isRegisteredView = filter === 'registered';
  // Хуваарь нь бүртгэгдсэн болон хуваарийн харагдацад хоёуланд нь гарна —
  // ажилтан "өнөөдөр хэн ирэх вэ?" гэдгийг хамгийн түрүүнд харах ёстой.
  const schedule = isVisits || isRegisteredView ? renderSchedule(leads, !isVisits) : '';
  const vc = visitCounts(leads);
  const online = isVisits || isRegisteredView ? renderOnline(leads) : '';
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
        <td>${esc(MODE_LABELS[l.registrationMode] ?? '')}</td>
        <td><b>${esc(visitText(l))}</b></td>
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
a.btn,button.btn{display:inline-block;margin:1rem .5rem 0 0;font-size:.85rem;text-decoration:none;border:1px solid var(--b);padding:.4rem .8rem;border-radius:8px;color:inherit;background:none;font-family:inherit;cursor:pointer}

/* ── Уулзалтын хуваарь ── */
.sched{margin:0 0 2rem}
.sched h2{font-size:1.05rem;margin:0 0 .75rem}
.day{border:1px solid var(--b);border-radius:12px;padding:.85rem 1rem;margin-bottom:.85rem}
.day h3{font-size:.9rem;margin:0 0 .6rem;display:flex;align-items:center;gap:.5rem;flex-wrap:wrap}
.day .cnt{font-size:.75rem;font-weight:400;color:var(--muted);border:1px solid var(--b);border-radius:99px;padding:.05rem .5rem}
.day.today{border-color:#22c55e88;background:#22c55e0f}
.day.today h3{color:#16a34a}
.day.tomorrow{border-color:#3b82f688;background:#3b82f60f}
.day.unknown{border-color:#f59e0b88;background:#f59e0b0f}
.day.online{border-color:#a855f788;background:#a855f70f}
.day.past{opacity:.6;padding:.6rem 1rem}
.day.past summary{cursor:pointer;font-size:.85rem;color:var(--muted)}
.slots{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:.4rem}
.slot{display:flex;align-items:baseline;gap:.75rem;flex-wrap:wrap;padding:.45rem .6rem;border-radius:8px;background:#8881}
.slot .t{font-size:1.05rem;font-weight:700;font-variant-numeric:tabular-nums;min-width:3.5rem}
.slot .who{display:flex;flex-direction:column;flex:1;min-width:12rem}
.slot .who b{font-size:.95rem}
.slot .meta{font-size:.8rem;color:var(--muted)}
.slot .pay{font-size:.78rem;color:var(--muted);white-space:nowrap}
.slot .mode{font-size:.7rem;padding:.1rem .45rem;border-radius:99px;background:#8883;white-space:nowrap}
a.tel{color:inherit;font-weight:600;text-decoration:none;border-bottom:1px dotted var(--muted)}

@media print{
  body{padding:0;font-size:11pt}
  .tabs,.cards,.events,.warn,a.btn,button.btn,.wrap,.sub{display:none!important}
  .day{break-inside:avoid;border-color:#999;background:none!important}
  .day.past{display:none}
  .slot{background:none;border-bottom:1px solid #ddd;border-radius:0}
  a.tel{border:none}
}
</style></head><body>
<h1>${isVisits ? 'Уулзалтын хуваарь' : 'Элсэгчдийн бүртгэл'}</h1>
<div class="sub">${isVisits
  ? `Өнөөдөр <b>${vc.today} хүн</b> ирнэ · маргааш ${vc.tomorrow} · дараагийн өдрүүдэд ${vc.later} · хураамж ${formatMnt(TUITION.seatDeposit)} бэлнээр`
  : `Нийт ${total} яриа · <b>${registeredCount} нь нэр, утсаа өгсөн</b> · ${IS_FIRST_YEAR_FREE ? "эхний жил үнэгүй" : "эхний жил " + formatMnt(TUITION.baseAnnual)} · хураамж ${formatMnt(TUITION.seatDeposit)}`}</div>
<div class="tabs">
  <a class="tab ${filter ? '' : 'on'}" href="/api/admin">Бүгд (${total})</a>
  <a class="tab ${filter === 'registered' ? 'on' : ''}" href="/api/admin?filter=registered">✅ Бүртгэгдсэн (${registeredCount})</a>
  <a class="tab ${filter === 'visits' ? 'on' : ''}" href="/api/admin?filter=visits">📅 Хуваарь (${visitCount})</a>
</div>
${warning}
${schedule}
${online}
${isVisits ? '' : `<div class="cards">${cards}</div>`}
${isVisits ? '' : `<div class="wrap">
${
  leads.length
    ? `<table><thead><tr>
        <th>Огноо</th><th>Шат</th><th>Нэр</th><th>Нас</th><th>Утас</th>
        <th>И-мэйл</th><th>Мэргэжил</th><th>Урсгал</th><th>Зам</th><th>Уулзалт</th><th>Төлбөр</th>
      </tr></thead><tbody>${rows}</tbody></table>`
    : `<div class="empty">${filter === 'registered' ? 'Нэр, утсаа өгсөн элсэгч хараахан алга.' : 'Одоогоор яриа алга. Messenger-ээр хэн нэгэн бичихэд энд харагдана.'}</div>`
}
</div>`}
${renderEvents(events)}
<button class="btn" onclick="window.print()">🖨 Хуваарь хэвлэх</button>
<a class="btn" href="/api/admin?format=csv${filter ? '&filter=' + filter : ''}">⬇ CSV татах</a>
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
  const hasVisit = (l) => Boolean(l.visit);
  let leads = all;
  if (filter === 'registered') leads = all.filter(isRegistered);
  else if (filter === 'visits') leads = all.filter((l) => hasVisit(l) || l.registrationMode === 'online');
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

  return new Response(
    renderPage(
      leads,
      total,
      filter,
      all.filter(isRegistered).length,
      events,
      all.filter((l) => l.visit).length,
    ),
    {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    },
  );
}
