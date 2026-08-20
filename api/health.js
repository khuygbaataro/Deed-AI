/**
 * Vercel serverless функц — эрүүл мэндийн шалгалт.
 * Маршрут: /api/health  (vercel.json-оор /health ч ажиллана)
 *
 * Байршуулалт зөв болсон эсэх, мэдлэгийн сан ачаалагдаж байгаа эсэхийг шалгахад
 * хэрэглэнэ. Нууц утга буцаадаггүй.
 */
import { config, missingConfig } from '../src/config.js';
import { loadKnowledge } from '../src/knowledge.js';
import { stats as storeStats } from '../src/sessions.js';
import { kvPing } from '../src/store.js';
import { countLeads, listLeads } from '../src/leads.js';
import { eventCounts } from '../src/events.js';

export async function GET() {
  const kb = await loadKnowledge();
  const ping = await kvPing();

  // Тоо баримт — хувийн мэдээлэл БИШ, зөвхөн тоо
  let stats = null;
  try {
    const [total, leads, events] = await Promise.all([
      countLeads(),
      listLeads(1000),
      eventCounts(),
    ]);
    const byStage = {};
    for (const l of leads) byStage[l.stage] = (byStage[l.stage] ?? 0) + 1;
    stats = {
      conversations: total,
      withContact: leads.filter((l) => l.name && l.phone).length,
      byStage,
      problems: events,
    };
  } catch (err) {
    stats = { error: err.message };
  }

  return Response.json({
    status: 'ok',
    model: config.claude.model,
    effort: config.claude.effort,
    store: { ...storeStats(), ping },
    data: stats,
    knowledge: { files: kb.files, bytes: kb.bytes },
    // Дутуу тохиргоо — зөвхөн нэрс, утга харуулахгүй
    missingConfig: missingConfig(),
  });
}
