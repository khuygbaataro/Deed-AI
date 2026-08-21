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

/** Нийлүүлэгч тус бүрийн өгөгдмөл загвар */
function defaultModel() {
  const provider = (str(process.env.AI_PROVIDER, 'anthropic') || 'anthropic').toLowerCase();
  return provider === 'openai' ? null : 'claude-sonnet-5';
}

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

    // Page-ийн ID — өөрийн сэтгэгдэлд хариулахаас сэргийлэхэд хэрэгтэй.
    // Тохируулаагүй бол бот өөрийнхөө хариунд дахин хариулж давталт үүсгэнэ.
    pageId: str(process.env.FB_PAGE_ID),

    // Сэтгэгдэл бичсэн хүн рүү Messenger-ээр хувийн мессеж илгээх эсэх.
    // Facebook-ийн эрх бүрэн тохирсны ДАРАА асаана.
    commentAutoReply: bool(process.env.FB_COMMENT_AUTOREPLY, false),

    // Сэтгэгдэлд нийтээр харагдах хариу бичих эсэх
    commentPublicReply: bool(process.env.FB_COMMENT_PUBLIC_REPLY, true),
  },

  // --- AI нийлүүлэгч ---
  // anthropic (өгөгдмөл) | openai
  provider: (str(process.env.AI_PROVIDER, 'anthropic') || 'anthropic').toLowerCase(),

  // --- OpenAI (AI_PROVIDER=openai үед) ---
  openai: {
    apiKey: str(process.env.OPENAI_API_KEY),
    baseUrl: str(process.env.OPENAI_BASE_URL, 'https://api.openai.com/v1'),
    // responses (өгөгдмөл) | chat — хэрэгсэлтэй ажиллах шинэ загварууд
    // /v1/responses шаарддаг тул өгөгдмөлөөр түүнийг сонгоно.
    apiStyle: (str(process.env.OPENAI_API_STYLE, 'responses') || 'responses').toLowerCase(),
  },

  // --- Claude ---
  // Тэмдэглэл: хувьсагчийг BOT_ угтвартай нэрлэсэн. CLAUDE_* нэрс нь
  // Claude Code зэрэг хэрэгслийн орчны хувьсагчтай мөргөлдөж болзошгүй.
  claude: {
    apiKey: str(process.env.ANTHROPIC_API_KEY),
    // BOT_MODEL нь ИДЭВХТЭЙ нийлүүлэгчид хамаарна. Тохируулаагүй бол
    // Anthropic дээр Sonnet 5 хэрэглэнэ; OpenAI дээр заавал өөрөө зааж өгнө.
    model: str(process.env.BOT_MODEL, defaultModel()),
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
/**
 * Ярианы түүхийн бүтцийг тодорхойлогч түлхүүр.
 * Энэ утга өөрчлөгдвөл хуучин түүх таарахгүй тул sessions.js түүнийг цэвэрлэнэ.
 */
export function historyKey() {
  return config.provider === 'openai'
    ? 'openai:' + (config.openai.apiStyle === 'chat' ? 'chat' : 'responses')
    : 'anthropic';
}

export function missingConfig({ requireFacebook = true } = {}) {
  const missing = [];
  if (config.provider === 'openai') {
    if (!config.openai.apiKey) missing.push('OPENAI_API_KEY');
    // OpenAI дээр өгөгдмөл загвар байхгүй — заавал зааж өгнө
    if (!config.claude.model) missing.push('BOT_MODEL');
  } else if (!config.claude.apiKey) {
    missing.push('ANTHROPIC_API_KEY');
  }
  if (requireFacebook) {
    if (!config.fb.verifyToken) missing.push('FB_VERIFY_TOKEN');
    if (!config.fb.pageAccessToken) missing.push('FB_PAGE_ACCESS_TOKEN');
    if (!config.fb.appSecret && !config.fb.skipSignatureCheck) missing.push('FB_APP_SECRET');
  }
  return missing;
}
