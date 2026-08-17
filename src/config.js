import 'dotenv/config';

const bool = (v, dflt = false) =>
  v === undefined ? dflt : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());

const num = (v, dflt) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
};

export const config = {
  // --- Сервер ---
  port: num(process.env.PORT, 3000),
  nodeEnv: process.env.NODE_ENV || 'development',
  logLevel: process.env.LOG_LEVEL || 'info',

  // --- Facebook ---
  fb: {
    verifyToken: process.env.FB_VERIFY_TOKEN,
    pageAccessToken: process.env.FB_PAGE_ACCESS_TOKEN,
    appSecret: process.env.FB_APP_SECRET,
    graphVersion: process.env.FB_GRAPH_VERSION || 'v21.0',
    // Facebook Page Inbox-ийн албан ёсны app ID (хүн рүү шилжүүлэхэд хэрэглэнэ)
    inboxAppId: process.env.FB_INBOX_APP_ID || '263902037430900',
    // Гарын үсгийн шалгалтыг алгасах (ЗӨВХӨН локал тест дээр)
    skipSignatureCheck: bool(process.env.FB_SKIP_SIGNATURE_CHECK, false),
  },

  // --- Claude ---
  claude: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.CLAUDE_MODEL || 'claude-opus-5',
    // low | medium | high | xhigh | max — чатбот учир хурдыг эрхэмлэж low
    effort: process.env.CLAUDE_EFFORT || 'low',
    maxTokens: num(process.env.CLAUDE_MAX_TOKENS, 1500),
    maxToolLoops: num(process.env.CLAUDE_MAX_TOOL_LOOPS, 4),
  },

  // --- Яриа/сесс ---
  session: {
    ttlMinutes: num(process.env.SESSION_TTL_MINUTES, 60),
    maxTurns: num(process.env.SESSION_MAX_TURNS, 12),
    maxSessions: num(process.env.SESSION_MAX_COUNT, 5000),
  },

  // --- Бусад ---
  dataDir: process.env.DATA_DIR || 'data',
  knowledgeDir: process.env.KNOWLEDGE_DIR || 'knowledge',
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
