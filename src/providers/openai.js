/**
 * OpenAI нийлүүлэгч (Chat Completions API).
 *
 * ⚠️ ЭНЭ МОДУЛИЙГ БОДИТ ТҮЛХҮҮРЭЭР ТУРШИЖ ҮЗЭЭГҮЙ. Загварын нэр, талбарын
 *    нэр зөрж болзошгүй тул эхний удаад /ai-check хуудсаар шалгана уу —
 *    алдаа гарвал яг ямар алдаа болохыг тэндээс харна.
 *
 * Тохиргоо (Vercel → Environment Variables):
 *   AI_PROVIDER=openai
 *   OPENAI_API_KEY=...          ← ЗӨВХӨН ӨӨРӨӨ оруулна, чат руу хэзээ ч бүү бич
 *   BOT_MODEL=<загварын нэр>
 *   OPENAI_BASE_URL=...         (заавал биш, өгөгдмөл https://api.openai.com/v1)
 *
 * Промпт кэш: OpenAI 1024-өөс дээш токентой промптыг АВТОМАТААР кэшилдэг тул
 * Anthropic-ийн cache_control шиг гараар тэмдэглэх шаардлагагүй.
 */
import { config } from '../config.js';
import { log, maskPsid } from '../logger.js';
import { buildSystemPrompt } from '../prompt.js';
import { TOOLS, executeTool } from '../tools.js';
import { recordEvent } from '../events.js';
import { recordUsage } from '../usage.js';
import { FALLBACK_TEXT } from './shared.js';

export const name = 'openai';

/** Anthropic хэлбэрийн хэрэгслийг OpenAI хэлбэрт хөрвүүлнэ */
export function toOpenAiTools(tools = TOOLS) {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

/**
 * Нэг хүсэлт илгээнэ.
 *
 * Шинэ загварууд max_tokens-ийг хүлээж авахаа больж max_completion_tokens
 * шаарддаг. Аль нь болохыг таамаглахгүй — эхлээд шинэ нэрээр илгээж, тэр нь
 * буруу гэсэн алдаа ирвэл хуучин нэрээр дахин оролдоно.
 */
export async function callOpenAi(body, { retryLegacyTokens = true } = {}) {
  const baseUrl = (config.openai.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.openai.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }

  if (res.ok) return data;

  const message = data?.error?.message ?? text.slice(0, 400);

  // max_completion_tokens дэмжигдэхгүй загвар бол хуучин талбараар дахин оролдоно
  if (
    retryLegacyTokens &&
    'max_completion_tokens' in body &&
    /max_completion_tokens|Unrecognized request argument/i.test(message)
  ) {
    const { max_completion_tokens: limit, ...rest } = body;
    return callOpenAi({ ...rest, max_tokens: limit }, { retryLegacyTokens: false });
  }

  const err = new Error(message);
  err.status = res.status;
  throw err;
}

/** OpenAI-ийн usage-ийг бидний бүртгэлийн хэлбэрт хөрвүүлнэ */
function mapUsage(usage = {}) {
  const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
  return {
    input_tokens: Math.max(0, (usage.prompt_tokens ?? 0) - cached),
    output_tokens: usage.completion_tokens ?? 0,
    cache_read_input_tokens: cached,
    cache_creation_input_tokens: 0,
  };
}

export async function generateReply({ history, userText, psid, userName = null, offline = false }) {
  const system = await buildSystemPrompt();
  const messages = [...history, { role: 'user', content: userText }];
  const model = config.claude.model;

  let handedOver = false;

  for (let loop = 0; loop <= config.claude.maxToolLoops; loop += 1) {
    let data;
    try {
      data = await callOpenAi({
        model,
        max_completion_tokens: config.claude.maxTokens,
        messages: [{ role: 'system', content: system }, ...messages],
        tools: toOpenAiTools(),
      });
    } catch (err) {
      log.error('OpenAI API алдаа', {
        psid: maskPsid(psid),
        status: err?.status,
        error: err?.message,
      });
      await recordEvent('ai_error', {
        psid,
        question: userText,
        detail: `${err?.status ?? ''} ${err?.message ?? ''}`.trim(),
      });
      return { text: FALLBACK_TEXT, handedOver, messages: history };
    }

    await recordUsage(model, mapUsage(data?.usage));

    const choice = data?.choices?.[0];
    const message = choice?.message;
    if (!message) {
      log.error('OpenAI хариу хоосон', { psid: maskPsid(psid) });
      await recordEvent('ai_error', { psid, question: userText, detail: 'хоосон хариу' });
      return { text: FALLBACK_TEXT, handedOver, messages: history };
    }

    log.debug('OpenAI хариу', {
      psid: maskPsid(psid),
      stop: choice.finish_reason,
      in: data.usage?.prompt_tokens,
      out: data.usage?.completion_tokens,
      cached: data.usage?.prompt_tokens_details?.cached_tokens,
    });

    messages.push(message);

    const toolCalls = message.tool_calls ?? [];
    if (toolCalls.length === 0) {
      const text = (message.content ?? '').trim();
      return { text: text || FALLBACK_TEXT, handedOver, messages };
    }

    for (const call of toolCalls) {
      let input = {};
      try {
        input = JSON.parse(call.function?.arguments || '{}');
      } catch {
        input = {};
      }

      const result = await executeTool({ name: call.function?.name, input }, {
        psid,
        userName,
        offline,
      });
      if (result.handedOver) handedOver = true;

      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: result.content,
      });
    }
  }

  log.warn('Хэрэгслийн давталтын хязгаарт хүрлээ', { psid: maskPsid(psid) });
  return { text: FALLBACK_TEXT, handedOver, messages: history };
}
