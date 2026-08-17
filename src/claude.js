import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';
import { log, maskPsid } from './logger.js';
import { buildSystemPrompt } from './prompt.js';
import { TOOLS, executeTool } from './tools.js';

let client = null;

/**
 * Claude client-ийг эхний дуудлагад үүсгэнэ.
 * API түлхүүргүй үед сервер асахдаа унахгүй байх зорилготой.
 */
function getClient() {
  if (!client) {
    client = new Anthropic(config.claude.apiKey ? { apiKey: config.claude.apiKey } : {});
  }
  return client;
}

const FALLBACK_TEXT =
  'Уучлаарай, техникийн саатал гарлаа. Түр хүлээгээд дахин бичнэ үү, ' +
  'эсвэл сургуулийн утсаар шууд холбогдоорой.';

const REFUSAL_TEXT =
  'Уучлаарай, энэ асуултад хариулах боломжгүй байна. ' +
  'Сургуулийн элсэлт, хөтөлбөр, төлбөрийн талаар асуувал баяртайгаар хариулна.';

/** Хариултаас текст блокуудыг цуглуулна */
function collectText(content) {
  return content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

/**
 * Хэрэглэгчийн мессежид Claude-ээр хариулт үүсгэнэ.
 * Хэрэгслийн давталтыг (tool_use -> tool_result) энд гараар удирдана —
 * ингэснээр handover зэрэг гаж нөлөөтэй үйлдлийг PSID-тэй нь холбож хянах боломжтой.
 *
 * @param {object} params
 * @param {Array} params.history Өмнөх ярианы messages массив (өөрчлөгдөнө)
 * @param {string} params.userText Хэрэглэгчийн шинэ мессеж
 * @param {string} params.psid
 * @param {string|null} [params.userName]
 * @param {boolean} [params.offline] true бол Facebook руу юу ч илгээхгүй (локал тест)
 * @returns {Promise<{text: string, handedOver: boolean, messages: Array}>}
 */
export async function generateReply({ history, userText, psid, userName = null, offline = false }) {
  const system = await buildSystemPrompt();
  const messages = [...history, { role: 'user', content: userText }];

  let handedOver = false;

  for (let loop = 0; loop <= config.claude.maxToolLoops; loop += 1) {
    let response;
    try {
      response = await getClient().messages.create({
        model: config.claude.model,
        max_tokens: config.claude.maxTokens,
        // Систем промпт тогтмол тул кэшлэнэ — давтагдсан хүсэлтүүд ~90% хямд болно
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        thinking: { type: 'adaptive' },
        output_config: { effort: config.claude.effort },
        tools: TOOLS,
        messages,
      });
    } catch (err) {
      log.error('Claude API алдаа', {
        psid: maskPsid(psid),
        status: err?.status,
        error: err?.message,
      });
      return { text: FALLBACK_TEXT, handedOver, messages: history };
    }

    log.debug('Claude хариу', {
      psid: maskPsid(psid),
      stop: response.stop_reason,
      in: response.usage?.input_tokens,
      out: response.usage?.output_tokens,
      cacheRead: response.usage?.cache_read_input_tokens,
      cacheWrite: response.usage?.cache_creation_input_tokens,
    });

    // Аюулгүй байдлын шүүлтүүр татгалзсан тохиолдол
    if (response.stop_reason === 'refusal') {
      log.warn('Claude татгалзлаа', {
        psid: maskPsid(psid),
        category: response.stop_details?.category,
      });
      return { text: REFUSAL_TEXT, handedOver, messages: history };
    }

    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason !== 'tool_use') {
      const text = collectText(response.content);
      return {
        text: text || FALLBACK_TEXT,
        handedOver,
        messages,
      };
    }

    // Хэрэгслүүдийг гүйцэтгээд үр дүнг нэг user мессежээр буцаана
    const toolUses = response.content.filter((block) => block.type === 'tool_use');
    const results = [];

    for (const call of toolUses) {
      const result = await executeTool({ name: call.name, input: call.input }, {
        psid,
        userName,
        offline,
      });
      if (result.handedOver) handedOver = true;
      results.push({
        type: 'tool_result',
        tool_use_id: call.id,
        content: result.content,
        ...(result.isError ? { is_error: true } : {}),
      });
    }

    messages.push({ role: 'user', content: results });
  }

  log.warn('Хэрэгслийн давталтын хязгаарт хүрлээ', { psid: maskPsid(psid) });
  return { text: FALLBACK_TEXT, handedOver, messages: history };
}
