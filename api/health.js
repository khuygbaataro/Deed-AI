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
import { eventCounts, lastAiError } from '../src/events.js';
import { todayUsage } from '../src/usage.js';

export async function GET() {
  const kb = await loadKnowledge();
  const ping = await kvPing();

  // Тоо баримт — хувийн мэдээлэл БИШ, зөвхөн тоо
  const usage = await todayUsage().catch(() => null);
  const aiError = await lastAiError().catch(() => null);
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
    // Ямар хувилбар байршсаныг шалгахад — засвар хүрсэн эсэхийг мэднэ
    commit: (process.env.VERCEL_GIT_COMMIT_SHA ?? 'local').slice(0, 7),
    provider: config.provider,
    model: config.claude.model,
    effort: config.claude.effort,
    store: { ...storeStats(), ping },
    data: stats,
    usageToday: usage,
    // Сүүлийн AI алдаа — загвар/түлхүүр буруу эсэхийг шууд харуулна
    lastAiError: aiError,
    knowledge: { files: kb.files, bytes: kb.bytes },
    // Дутуу тохиргоо — зөвхөн нэрс, утга харуулахгүй
    missingConfig: missingConfig(),
  });
}
