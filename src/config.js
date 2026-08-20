import 'dotenv/config';

const bool = (v, dflt = false) =>
  v === undefined ? dflt : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());

const num = (v, dflt) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
};

/**
 * Орчны хувьсагчийн текст утгыг цэвэрлэнэ.
 * Хуулж буулгах, PowerShell-ийн pipe (\r), .env файлын мөр таслалт зэргээс
 * үүдэн үл үзэгдэх тэмдэгт наалдвал утга чимээгүйхэн таарахгүй болдог.
 */
const str = (v, dflt = undefined) => {
  if (typeof v !== 'string') return dflt;
  // Зай, мөр таслалт, мөн бүсэлсэн хашилтыг хасна — .env эсвэл вэб формоос
  // хуулахад хашилттай орж ирвэл утга чимээгүйхэн таарахгүй болдог
  const trimmed = v.trim().replace(/^["']|["']$/g, '').trim();
  return trimmed === '' ? dflt : trimmed;
};

export const config = {
  // --- Сервер ---
  port: num(process.env.PORT, 3000),
  nodeEnv: str(process.env.NODE_ENV, 'development'),
  logLevel: str(process.env.LOG_LEVEL, 'info'),

  // --- Facebook ---
  fb: {
    verifyToken: str(process.env.FB_VERIFY_TOKEN),
    pageAccessToken: str(process.env.FB_PAGE_ACCESS_TOKEN),
    appSecret: str(process.env.FB_APP_SECRET),
    graphVersion: str(process.env.FB_GRAPH_VERSION, 'v21.0'),
    // Facebook Page Inbox-ийн албан ёсны app ID (хүн рүү шилжүүлэхэд хэрэглэнэ)
    inboxAppId: str(process.env.FB_INBOX_APP_ID, '263902037430900'),
    // Гарын үсгийн шалгалтыг алгасах (ЗӨВХӨН локал тест дээр)
    skipSignatureCheck: bool(process.env.FB_SKIP_SIGNATURE_CHECK, false),
  },

  // --- Claude ---
  // Тэмдэглэл: хувьсагчийг BOT_ угтвартай нэрлэсэн. CLAUDE_* нэрс нь
  // Claude Code зэрэг хэрэгслийн орчны хувьсагчтай мөргөлдөж болзошгүй.
  claude: {
    apiKey: str(process.env.ANTHROPIC_API_KEY),
    model: str(process.env.BOT_MODEL, 'claude-haiku-4-5-20251001'),
    // low | medium | high | xhigh | max — чатбот учир хурдыг эрхэмлэж low
    effort: str(process.env.BOT_EFFORT, 'low'),
    maxTokens: num(process.env.BOT_MAX_TOKENS, 1500),
    maxToolLoops: num(process.env.BOT_MAX_TOOL_LOOPS, 4),
  },

  // --- Яриа/сесс ---
  session: {
    ttlMinutes: num(process.env.SESSION_TTL_MINUTES, 60),
    maxTurns: num(process.env.SESSION_MAX_TURNS, 12),
    maxSessions: num(process.env.SESSION_MAX_COUNT, 5000),
  },

  // --- Бусад ---
  dataDir: str(process.env.DATA_DIR, 'data'),
  knowledgeDir: str(process.env.KNOWLEDGE_DIR, 'knowledge'),
  // Хүн рүү шилжүүлэх хүсэлт ирэхэд мэдэгдэл авах админ PSID-үүд (таслалаар)
  adminPsids: (process.env.FB_ADMIN_PSIDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
};

/**
 * Ажиллуулахын өмнө заавал байх ёстой тохиргоог шалгана.
 * @param {{requireFacebook?: boolean}} opts
 * @returns {string[]} дутуу байгаа хувьсагчдын жагсаалт
 */
export function missingConfig({ requireFacebook = true } = {}) {
  const missing = [];
  if (!config.claude.apiKey) missing.push('ANTHROPIC_API_KEY');
  if (requireFacebook) {
    if (!config.fb.verifyToken) missing.push('FB_VERIFY_TOKEN');
    if (!config.fb.pageAccessToken) missing.push('FB_PAGE_ACCESS_TOKEN');
    if (!config.fb.appSecret && !config.fb.skipSignatureCheck) missing.push('FB_APP_SECRET');
  }
  return missing;
}
