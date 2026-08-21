/**
 * Хяналтын самбарын графикууд — цэвэр SVG.
 *
 * Гадны сан ашиглахгүй: Vercel дээр нэмэлт ачаалал үүсгэхгүй, интернэт
 * удаан үед ч зурагдана, мөн гадагш ямар ч хүсэлт явуулахгүй тул
 * элсэгчдийн өгөгдөл гуравдагч тал руу алдагдахгүй.
 *
 * Бүх функц HTML мөр буцаана.
 */

/** SVG-д тавихаас өмнө текстийг цэвэрлэнэ */
function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Хүснэгт хоосон үед харуулах мөр */
const empty = (msg) => `<div class="c-empty">${esc(msg)}</div>`;

/**
 * Хэвтээ баганан диаграм — жагсаалт харьцуулахад хамгийн уншигдахуйц.
 * @param {Array<{label: string, value: number, tone?: string}>} rows
 */
export function barChart(rows, { emptyText = 'Өгөгдөл алга' } = {}) {
  const items = rows.filter((r) => r.value > 0);
  if (!items.length) return empty(emptyText);

  const max = Math.max(...items.map((r) => r.value));

  return (
    '<div class="bars">' +
    items
      .map((r) => {
        const pct = Math.round((r.value / max) * 100);
        const tone = r.tone ? ' t-' + esc(r.tone) : '';
        return (
          '<div class="bar-row">' +
          `<span class="bar-label" title="${esc(r.label)}">${esc(r.label)}</span>` +
          `<span class="bar-track"><span class="bar-fill${tone}" style="width:${pct}%"></span></span>` +
          `<span class="bar-val">${r.value}</span>` +
          '</div>'
        );
      })
      .join('') +
    '</div>'
  );
}

/**
 * Юүлүүр — алхам бүрт хэдэн хүн үлдэж байгааг харуулна.
 * Хамгийн чухал график: хаана хүн алдаж байгааг шууд харуулна.
 * @param {Array<{label: string, value: number}>} steps
 */
export function funnelChart(steps) {
  if (!steps.length || steps[0].value === 0) return empty('Яриа хараахан алга');

  const top = steps[0].value;

  return (
    '<div class="funnel">' +
    steps
      .map((s, i) => {
        const pct = top ? Math.round((s.value / top) * 100) : 0;
        const prev = i > 0 ? steps[i - 1].value : null;
        const drop = prev && prev > 0 ? Math.round(((prev - s.value) / prev) * 100) : null;
        return (
          '<div class="fn-row">' +
          `<span class="fn-label">${esc(s.label)}</span>` +
          `<span class="fn-track"><span class="fn-fill" style="width:${Math.max(pct, 2)}%"></span></span>` +
          `<span class="fn-val">${s.value}<span class="fn-pct">${pct}%</span></span>` +
          (drop && drop > 0 ? `<span class="fn-drop">−${drop}%</span>` : '<span class="fn-drop"></span>') +
          '</div>'
        );
      })
      .join('') +
    '</div>'
  );
}

/**
 * Өдөр тутмын багана — сүүлийн N хоногийн урсгал.
 * @param {Array<{date: string, value: number}>} days
 */
export function columnChart(days, { height = 90 } = {}) {
  if (!days.length) return empty('Өгөгдөл алга');

  const max = Math.max(1, ...days.map((d) => d.value));
  const w = 100 / days.length;

  const bars = days
    .map((d, i) => {
      const h = (d.value / max) * 100;
      const x = i * w;
      const today = i === days.length - 1;
      return (
        `<rect x="${x + w * 0.15}" y="${100 - h}" width="${w * 0.7}" height="${Math.max(h, 0.8)}" ` +
        `rx="1" class="${today ? 'col today' : 'col'}"><title>${esc(d.date)}: ${d.value}</title></rect>`
      );
    })
    .join('');

  const labels = days
    .map((d, i) => {
      if (days.length > 10 && i % 3 !== 0 && i !== days.length - 1) return '';
      return `<span style="left:${(i + 0.5) * w}%">${esc(d.date.slice(5))}</span>`;
    })
    .join('');

  return (
    `<div class="cols" style="--h:${height}px">` +
    `<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${bars}</svg>` +
    `<div class="col-labels">${labels}</div>` +
    `<div class="col-max">хамгийн их ${max}</div>` +
    '</div>'
  );
}

/**
 * Тойрог диаграм — ажилтны ажлын явц зэрэг цөөн ангилалд.
 * @param {Array<{label: string, value: number, color: string}>} slices
 */
export function donutChart(slices) {
  const items = slices.filter((s) => s.value > 0);
  const total = items.reduce((sum, s) => sum + s.value, 0);
  if (!total) return empty('Өгөгдөл алга');

  const R = 15.9155; // тойргийн урт ≈ 100
  let offset = 25; // 12 цагийн байрлалаас эхлүүлнэ

  const rings = items
    .map((s) => {
      const pct = (s.value / total) * 100;
      const ring =
        `<circle class="ring" r="${R}" cx="21" cy="21" fill="none" ` +
        `stroke="${esc(s.color)}" stroke-width="6" ` +
        `stroke-dasharray="${pct.toFixed(2)} ${(100 - pct).toFixed(2)}" ` +
        `stroke-dashoffset="${offset.toFixed(2)}"><title>${esc(s.label)}: ${s.value}</title></circle>`;
      offset -= pct;
      return ring;
    })
    .join('');

  const legend = items
    .map(
      (s) =>
        '<li><span class="dot" style="background:' + esc(s.color) + '"></span>' +
        `${esc(s.label)} <b>${s.value}</b></li>`,
    )
    .join('');

  return (
    '<div class="donut">' +
    `<svg viewBox="0 0 42 42" role="img"><circle r="${R}" cx="21" cy="21" fill="none" ` +
    'stroke="currentColor" stroke-opacity=".12" stroke-width="6"></circle>' +
    rings +
    `<text x="21" y="21.5" class="d-num">${total}</text></svg>` +
    `<ul class="legend">${legend}</ul>` +
    '</div>'
  );
}
