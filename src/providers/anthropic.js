/**
 * Anthropic (Claude) нийлүүлэгч.
 *
 * Хэрэгслийн давталтыг (tool_use -> tool_result) гараар удирдана — ингэснээр
 * handover зэрэг гаж нөлөөтэй үйлдлийг PSID-тэй нь холбож хянах боломжтой.
 */
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { log, maskPsid } from '../logger.js';
import { buildSystemPrompt } from '../prompt.js';
import { TOOLS, executeTool } from '../tools.js';
import { recordEvent } from '../events.js';
import { recordUsage } from '../usage.js';
import { sendText } from '../messenger.js';
import { FALLBACK_TEXT, REFUSAL_TEXT, isClaude5 } from './shared.js';

export const name = 'anthropic';

let client = null;

function getClient() {
  if (!client) {
    client = new Anthropic(config.claude.apiKey ? { apiKey: config.claude.apiKey } : {});
  }
  return client;
}

/**
 * Хэрэгслийн жагсаалтыг загварт тохируулна.
 * strict: true нь Claude 5 гэр бүлийн боломж — өмнөх загварт илгээвэл
 * хүсэлт бүхэлдээ 400 алдаа болно.
 */
function toolsFor(model) {
  if (isClaude5(model)) return TOOLS;
  return TOOLS.map(({ strict, ...rest }) => rest);
}

function collectText(content) {
  return content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

export async function generateReply({ history, userText, psid, userName = null, offline = false }) {
  const system = await buildSystemPrompt();
  const messages = [...history, { role: 'user', content: userText }];
  const model = config.claude.model;

  let handedOver = false;

  // Хэрэгсэл дуудахын хажуугаар бичсэн текстийг хаяхгүй — хэрэглэгчийн
  // асуултын хариу ихэвчлэн тэнд байдаг.
  const interim = [];

  for (let loop = 0; loop <= config.claude.maxToolLoops; loop += 1) {
    let response;
    try {
      response = await getClient().messages.create({
        model,
        max_tokens: config.claude.maxTokens,
        // Систем промпт тогтмол тул кэшлэнэ — давтагдсан хүсэлтүүд ~90% хямд болно
        // ttl: '1h' — өгөгдмөл 5 минут нь сийрэг урсгалд байнга алдагддаг.
        system: [
          { type: 'text', text: system, cache_control: { type: 'ephemeral', ttl: '1h' } },
        ],
        ...(isClaude5(model)
          ? { thinking: { type: 'adaptive' }, output_config: { effort: config.claude.effort } }
          : {}),
        tools: toolsFor(model),
        messages,
      });
    } catch (err) {
      log.error('Claude API алдаа', {
        psid: maskPsid(psid),
        status: err?.status,
        error: err?.message,
      });
      await recordEvent('ai_error', {
        psid,
        question: userText,
        detail: `${err?.status ?? ''} ${err?.message ?? ''}`.trim(),
      });
      return { text: interim.length ? '' : FALLBACK_TEXT, handedOver, interim, messages: history };
    }

    await recordUsage(model, response.usage);

    log.debug('Claude хариу', {
      psid: maskPsid(psid),
      stop: response.stop_reason,
      in: response.usage?.input_tokens,
      out: response.usage?.output_tokens,
      cacheRead: response.usage?.cache_read_input_tokens,
    });

    if (response.stop_reason === 'refusal') {
      log.warn('Claude татгалзлаа', {
        psid: maskPsid(psid),
        category: response.stop_details?.category,
      });
      return { text: REFUSAL_TEXT, handedOver, interim, messages: history };
    }

    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason !== 'tool_use') {
      const final = collectText(response.content);
      return { text: final || (interim.length ? '' : FALLBACK_TEXT), handedOver, interim, messages };
    }

    const said = collectText(response.content);
    if (said) {
      interim.push(said);
      if (!offline) await sendText(psid, said);
    }

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
  return { text: interim.length ? '' : FALLBACK_TEXT, handedOver, interim, messages: history };
}
