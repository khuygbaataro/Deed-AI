/**
 * OpenAI нийлүүлэгч.
 *
 * ХОЁР API-г дэмжинэ:
 *   responses (өгөгдмөл) — /v1/responses. Шинэ загварууд хэрэгсэлтэй
 *                          ажиллахдаа ЗААВАЛ үүнийг шаарддаг.
 *   chat                 — /v1/chat/completions. Хуучин загвар болон
 *                          OpenAI-тай нийцтэй бусад үйлчилгээнд.
 *
 * Тохиргоо (Vercel → Environment Variables):
 *   AI_PROVIDER=openai
 *   OPENAI_API_KEY=...          ← ЗӨВХӨН ӨӨРӨӨ оруулна, чат руу хэзээ ч бүү бич
 *   BOT_MODEL=<загварын нэр>
 *   OPENAI_API_STYLE=responses  (заавал биш: responses | chat)
 *   OPENAI_BASE_URL=...         (заавал биш)
 *
 * Промпт кэш: OpenAI 1024-өөс дээш токентой промптыг АВТОМАТААР кэшилдэг тул
 * Anthropic-ийн cache_control шиг гараар тэмдэглэх шаардлагагүй.
 *
 * store: false — элсэгчид ихэвчлэн 17-18 настай. Ярианы агуулгыг OpenAI-ийн
 * сервер дээр хадгалуулах шаардлагагүй.
 */
import { config } from '../config.js';
import { log, maskPsid } from '../logger.js';
import { buildSystemPrompt } from '../prompt.js';
import { TOOLS, executeTool } from '../tools.js';
import { recordEvent } from '../events.js';
import { recordUsage } from '../usage.js';
import { sendText } from '../messenger.js';
import { DUPLICATE_TOOL, FALLBACK_TEXT } from './shared.js';

export const name = 'openai';

/** reasoning.effort-д зөвшөөрөгдөх утгууд — бусдыг илгээвэл 400 болно */
const REASONING_EFFORTS = ['minimal', 'low', 'medium', 'high'];

/** Anthropic хэлбэрийн хэрэгслийг /v1/responses хэлбэрт хөрвүүлнэ (тэгш бүтэц) */
export function toResponsesTools(tools = TOOLS) {
  return tools.map((t) => ({
    type: 'function',
    name: t.name,
    description: t.description,
    parameters: t.input_schema,
    // strict нь бүх талбарыг required, additionalProperties: false байхыг
    // шаарддаг. Бидний схем түүнд нийцээгүй тул тодорхой унтраана.
    strict: false,
  }));
}

/** Anthropic хэлбэрийн хэрэгслийг /v1/chat/completions хэлбэрт хөрвүүлнэ */
export function toChatTools(tools = TOOLS) {
  return tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));
}

/** Одоогийн тохиргооны API хэлбэр */
export const apiStyle = () => (config.openai.apiStyle === 'chat' ? 'chat' : 'responses');

/**
 * Нэг хүсэлт илгээнэ.
 *
 * Шинэ загварууд max_tokens-ийг хүлээж авахаа больж max_completion_tokens
 * шаарддаг. Аль нь болохыг таамаглахгүй — татгалзвал нөгөөгөөр дахин оролдоно.
 */
export async function post(path, body, { retryLegacyTokens = true } = {}) {
  const baseUrl = (config.openai.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
  const res = await fetch(baseUrl + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + config.openai.apiKey,
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

  if (
    retryLegacyTokens &&
    'max_completion_tokens' in body &&
    /max_completion_tokens|Unrecognized request argument/i.test(message)
  ) {
    const { max_completion_tokens: limit, ...rest } = body;
    return post(path, { ...rest, max_tokens: limit }, { retryLegacyTokens: false });
  }

  const err = new Error(message);
  err.status = res.status;
  throw err;
}

/**
 * Хүсэлтийн биеийг бэлдэнэ. /ai-check ч яг үүнийг ашиглана — шалгалт нь
 * бодит дуудлагатай ижил бүтэцтэй байж гэмээнэ утгатай.
 */
export function buildRequest({ model, system, messages, maxTokens, withTools = true }) {
  const effort = config.claude.effort;

  if (apiStyle() === 'chat') {
    return {
      path: '/chat/completions',
      body: {
        model,
        max_completion_tokens: maxTokens,
        messages: [{ role: 'system', content: system }, ...messages],
        ...(withTools ? { tools: toChatTools() } : {}),
      },
    };
  }

  return {
    path: '/responses',
    body: {
      model,
      instructions: system,
      input: messages,
      ...(withTools ? { tools: toResponsesTools() } : {}),
      max_output_tokens: maxTokens,
      ...(REASONING_EFFORTS.includes(effort) ? { reasoning: { effort } } : {}),
      store: false,
    },
  };
}

/** Хэрэглэгчийн мессежийг идэвхтэй API-ийн хэлбэрт оруулна */
export function userMessage(text) {
  return apiStyle() === 'chat'
    ? { role: 'user', content: text }
    : { role: 'user', content: [{ type: 'input_text', text }] };
}

/** /v1/responses хариунаас текстийг гаргана */
export function responsesText(data) {
  const parts = [];
  for (const item of data?.output ?? []) {
    if (item.type !== 'message') continue;
    for (const c of item.content ?? []) {
      if (c.type === 'output_text' && c.text) parts.push(c.text);
    }
  }
  return parts.join('\n').trim();
}

/** usage-ийг бидний бүртгэлийн хэлбэрт хөрвүүлнэ */
export function mapUsage(usage = {}, style = apiStyle()) {
  if (style === 'chat') {
    const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
    return {
      input_tokens: Math.max(0, (usage.prompt_tokens ?? 0) - cached),
      output_tokens: usage.completion_tokens ?? 0,
      cache_read_input_tokens: cached,
      cache_creation_input_tokens: 0,
    };
  }
  const cached = usage.input_tokens_details?.cached_tokens ?? 0;
  return {
    input_tokens: Math.max(0, (usage.input_tokens ?? 0) - cached),
    output_tokens: usage.output_tokens ?? 0,
    cache_read_input_tokens: cached,
    cache_creation_input_tokens: 0,
  };
}

/** Хэрэгслийг дуудна — аргументыг задлахад алдаа гарвал хоосон объект */
async function runTool(toolName, rawArguments, ctx) {
  let input = {};
  try {
    input = JSON.parse(rawArguments || '{}');
  } catch {
    input = {};
  }
  return executeTool({ name: toolName, input }, ctx);
}

export async function generateReply({ history, userText, psid, userName = null, offline = false }) {
  const system = await buildSystemPrompt();
  const style = apiStyle();
  const model = config.claude.model;

  // ⚠️ Хоёр API-ийн ярианы түүх ӨӨР бүтэцтэй. Тиймээс sessions.js нь
  // хэлбэр солигдоход хуучин түүхийг цэвэрлэдэг.
  const messages = [...history, userMessage(userText)];

  let handedOver = false;

  // ⚠️ Загвар нэг ээлжид ХОЁУЛАНГ нь гаргаж чадна: хэрэглэгчид хэлэх текст
  // БОЛОН хэрэгслийн дуудлага. Урьд нь тэр текстийг хаядаг байсан тул
  // "ЭЕШ өгөөгүй бол болох уу?" гэсэн асуултын хариу алга болж, зөвхөн
  // карт үлддэг байв. Одоо тэр текстийг ШУУД илгээнэ.
  const interim = [];

  // Нэг ээлжид гүйцэтгэсэн хэрэгслүүд — давхардлыг таслана
  const called = new Set();

  // Загвар хэрэгслээ дуудахаа больдоггүй бол хэрэгслийг УНТРААНА.
  // Ингэснээр эцсийн ээлжид заавал текст буцаана — "техникийн саатал"
  // гэсэн нөөц мессеж хэрэглэгчид хүрэхээс сэргийлнэ.
  let forceText = false;

  for (let loop = 0; loop <= config.claude.maxToolLoops; loop += 1) {
    const isLastRound = loop === config.claude.maxToolLoops;
    const { path, body } = buildRequest({
      model,
      system,
      messages,
      maxTokens: config.claude.maxTokens,
      withTools: !forceText && !isLastRound,
    });

    let data;
    try {
      data = await post(path, body);
    } catch (err) {
      log.error('OpenAI API алдаа', {
        psid: maskPsid(psid),
        style,
        status: err?.status,
        error: err?.message,
      });
      await recordEvent('ai_error', {
        psid,
        question: userText,
        detail: ((err?.status ?? '') + ' ' + (err?.message ?? '')).trim(),
      });
      return { text: interim.length ? '' : FALLBACK_TEXT, handedOver, interim, messages: history };
    }

    await recordUsage(model, mapUsage(data?.usage, style));

    // ── /v1/chat/completions ─────────────────────────────────────────
    if (style === 'chat') {
      const message = data?.choices?.[0]?.message;
      if (!message) {
        log.error('OpenAI хариу хоосон', { psid: maskPsid(psid) });
        await recordEvent('ai_error', { psid, question: userText, detail: 'хоосон хариу' });
        return { text: FALLBACK_TEXT, handedOver, messages: history };
      }

      messages.push(message);
      const toolCalls = message.tool_calls ?? [];
      if (toolCalls.length === 0) {
        const final = (message.content ?? '').trim();
        return { text: final || (interim.length ? '' : FALLBACK_TEXT), handedOver, interim, messages };
      }

      // Хэрэгсэл дуудахын хажуугаар бичсэн текстийг хаяхгүй
      const chatText = (message.content ?? '').trim();
      if (chatText) {
        interim.push(chatText);
        if (!offline) await sendText(psid, chatText);
      }

      let executed = 0;
      for (const call of toolCalls) {
        const sig = (call.function?.name ?? '') + ':' + (call.function?.arguments ?? '');
        if (called.has(sig)) {
          log.warn('Давхардсан хэрэгслийн дуудлага', {
            psid: maskPsid(psid),
            tool: call.function?.name,
          });
          messages.push({ role: 'tool', tool_call_id: call.id, content: DUPLICATE_TOOL });
          continue;
        }
        called.add(sig);
        executed += 1;

        const result = await runTool(call.function?.name, call.function?.arguments, {
          psid,
          userName,
          offline,
        });
        if (result.handedOver) handedOver = true;
        messages.push({ role: 'tool', tool_call_id: call.id, content: result.content });
      }

      // Бүх дуудлага давхардсан бол загвар гацсан байна — хэрэгслийг унтраая
      if (executed === 0) forceText = true;
      continue;
    }

    // ── /v1/responses ────────────────────────────────────────────────
    const output = data?.output ?? [];
    log.debug('OpenAI хариу', {
      psid: maskPsid(psid),
      status: data?.status,
      items: output.map((o) => o.type).join(','),
      in: data?.usage?.input_tokens,
      out: data?.usage?.output_tokens,
      cached: data?.usage?.input_tokens_details?.cached_tokens,
    });

    if (output.length === 0) {
      log.error('OpenAI хариу хоосон', { psid: maskPsid(psid) });
      await recordEvent('ai_error', { psid, question: userText, detail: 'хоосон хариу' });
      return { text: FALLBACK_TEXT, handedOver, messages: history };
    }

    // Загварын гаралтыг ХЭВЭЭР нь түүхэд нэмнэ — reasoning item-үүдийг
    // хасвал дараагийн ээлжид загвар өмнөх бодлоо алдана.
    messages.push(...output);

    const calls = output.filter((o) => o.type === 'function_call');
    if (calls.length === 0) {
      const final = responsesText(data);
      return { text: final || (interim.length ? '' : FALLBACK_TEXT), handedOver, interim, messages };
    }

    // Хэрэгсэл дуудахын хажуугаар бичсэн текст — хэрэглэгчийн асуултын
    // хариу ихэвчлэн ЭНД байдаг. Картаас ӨМНӨ илгээнэ.
    const said = responsesText(data);
    if (said) {
      interim.push(said);
      if (!offline) await sendText(psid, said);
    }

    let executed = 0;
    for (const call of calls) {
      const sig = (call.name ?? '') + ':' + (call.arguments ?? '');
      if (called.has(sig)) {
        log.warn('Давхардсан хэрэгслийн дуудлага', { psid: maskPsid(psid), tool: call.name });
        messages.push({
          type: 'function_call_output',
          call_id: call.call_id,
          output: DUPLICATE_TOOL,
        });
        continue;
      }
      called.add(sig);
      executed += 1;

      const result = await runTool(call.name, call.arguments, { psid, userName, offline });
      if (result.handedOver) handedOver = true;
      messages.push({
        type: 'function_call_output',
        call_id: call.call_id,
        output: result.content,
      });
    }

    // Бүх дуудлага давхардсан бол загвар гацсан байна — хэрэгслийг унтраая
    if (executed === 0) forceText = true;
  }

  log.warn('Хэрэгслийн давталтын хязгаарт хүрлээ', { psid: maskPsid(psid) });
  await recordEvent('tool_error', {
    psid,
    question: userText,
    detail:
      'Хэрэгслийн давталтын хязгаарт хүрлээ (' + config.claude.maxToolLoops + '). ' +
      'Дуудсан хэрэгслүүд: ' + [...called].map((s) => s.split(':')[0]).join(', '),
  });
  return { text: interim.length ? '' : FALLBACK_TEXT, handedOver, interim, messages: history };
}
