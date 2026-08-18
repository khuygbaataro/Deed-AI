/**
 * Vercel serverless функц — эрүүл мэндийн шалгалт.
 * Маршрут: /api/health  (vercel.json-оор /health ч ажиллана)
 *
 * Байршуулалт зөв болсон эсэх, мэдлэгийн сан ачаалагдаж байгаа эсэхийг шалгахад
 * хэрэглэнэ. Нууц утга буцаадаггүй.
 */
import { config, missingConfig } from '../src/config.js';
import { loadKnowledge } from '../src/knowledge.js';
import { stats } from '../src/sessions.js';
import { kvPing } from '../src/store.js';

export async function GET() {
  const kb = await loadKnowledge();
  const ping = await kvPing();

  return Response.json({
    status: 'ok',
    model: config.claude.model,
    effort: config.claude.effort,
    store: { ...stats(), ping },
    knowledge: { files: kb.files, bytes: kb.bytes },
    // Дутуу тохиргоо — зөвхөн нэрс, утга харуулахгүй
    missingConfig: missingConfig(),
  });
}
