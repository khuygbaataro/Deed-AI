/**
 * Vercel serverless функц — AI холболтын шалгалт.
 * Маршрут: /api/ai-check  (vercel.json-оор /ai-check ч ажиллана)
 *
 * Загвар эсвэл нийлүүлэгч сольсны дараа "хүсэлтийн бүтэц энэ загварт зохих
 * эсэх"-ийг ТААМАГЛАХГҮЙ, нэг бодит дуудлагаар шалгана. Хэрэглэгч рүү юу ч
 * илгээхгүй, ямар ч хүний өгөгдөл хадгалахгүй.
 *
 * Хамгаалалт: HTTP Basic auth, нууц үг = ADMIN_TOKEN (админтай ижил).
 */
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../src/config.js';
import { buildSystemPrompt } from '../src/prompt.js';
import { TOOLS } from '../src/tools.js';
import { estimateCost, hasPricing } from '../src/usage.js';
import { isClaude5 } from '../src/providers/shared.js';
import {
  apiStyle,
  buildRequest,
  mapUsage,
  post,
  responsesText,
  userMessage,
} from '../src/providers/openai.js';

const TEST_QUESTION = 'Сайн байна уу, ямар мэргэжлүүд байдаг вэ?';

const adminToken = () => {
  const v = process.env.ADMIN_TOKEN;
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
};

function unauthorized() {
  return new Response('Нэвтрэх шаардлагатай', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Deed AI admin", charset="UTF-8"',
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}

function checkAuth(request, expected) {
  const header = request.headers.get('authorization');
  if (!header || !header.toLowerCase().startsWith('basic ')) return false;
  try {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    return decoded.slice(decoded.indexOf(':') + 1) === expected;
  } catch {
    return false;
  }
}

async function checkAnthropic(model, system) {
  const client = new Anthropic(config.claude.apiKey ? { apiKey: config.claude.apiKey } : {});
  const response = await client.messages.create({
    model,
    max_tokens: 300,
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral', ttl: '1h' } }],
    ...(isClaude5(model)
      ? { thinking: { type: 'adaptive' }, output_config: { effort: config.claude.effort } }
      : {}),
    tools: isClaude5(model) ? TOOLS : TOOLS.map(({ strict, ...rest }) => rest),
    messages: [{ role: 'user', content: TEST_QUESTION }],
  });

  return {
    stopReason: response.stop_reason,
    toolCalls: response.content.filter((b) => b.type === 'tool_use').map((b) => b.name),
    reply: response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join(' ')
      .trim(),
    usage: {
      input: response.usage?.input_tokens ?? 0,
      output: response.usage?.output_tokens ?? 0,
      cacheRead: response.usage?.cache_read_input_tokens ?? 0,
      cacheWrite: response.usage?.cache_creation_input_tokens ?? 0,
    },
    raw: response.usage ?? {},
    features: { strictTools: isClaude5(model), adaptiveThinking: isClaude5(model) },
  };
}

async function checkOpenAi(model, system) {
  const style = apiStyle();
  const { path, body } = buildRequest({
    model,
    system,
    messages: [userMessage(TEST_QUESTION)],
    maxTokens: 300,
  });
  const data = await post(path, body);
  const raw = mapUsage(data?.usage, style);

  if (style === 'chat') {
    const choice = data?.choices?.[0];
    const message = choice?.message ?? {};
    return {
      stopReason: choice?.finish_reason ?? null,
      toolCalls: (message.tool_calls ?? []).map((c) => c.function?.name),
      reply: (message.content ?? '').trim(),
      usage: toUsageView(raw),
      raw,
      features: { apiStyle: style, strictTools: false, adaptiveThinking: false },
    };
  }

  const output = data?.output ?? [];
  return {
    stopReason: data?.status ?? null,
    toolCalls: output.filter((o) => o.type === 'function_call').map((o) => o.name),
    reply: responsesText(data),
    usage: toUsageView(raw),
    raw,
    features: {
      apiStyle: style,
      reasoning: body.reasoning?.effort ?? null,
      outputItems: output.map((o) => o.type),
    },
  };
}

/** Бүртгэлийн хэлбэрээс харагдацын хэлбэрт */
function toUsageView(raw) {
  return {
    input: raw.input_tokens ?? 0,
    output: raw.output_tokens ?? 0,
    cacheRead: raw.cache_read_input_tokens ?? 0,
    cacheWrite: raw.cache_creation_input_tokens ?? 0,
  };
}
export async function GET(request) {
  const token = adminToken();
  if (!token) {
    return Response.json({ ok: false, error: 'ADMIN_TOKEN тохируулаагүй байна.' }, { status: 503 });
  }
  if (!checkAuth(request, token)) return unauthorized();

  const provider = config.provider;
  const model = config.claude.model;
  const started = Date.now();

  if (!model) {
    return Response.json(
      { ok: false, provider, error: 'BOT_MODEL тохируулаагүй байна.' },
      { status: 503 },
    );
  }
  if (provider === 'openai' && !config.openai.apiKey) {
    return Response.json(
      { ok: false, provider, model, error: 'OPENAI_API_KEY тохируулаагүй байна.' },
      { status: 503 },
    );
  }

  try {
    const system = await buildSystemPrompt();
    const r = provider === 'openai'
      ? await checkOpenAi(model, system)
      : await checkAnthropic(model, system);

    return Response.json({
      ok: true,
      provider,
      model,
      ...r.features,
      latencyMs: Date.now() - started,
      stopReason: r.stopReason,
      toolCalls: r.toolCalls,
      reply: r.reply.slice(0, 300),
      usage: r.usage,
      usd: hasPricing(model) ? Number(estimateCost(model, r.raw).toFixed(5)) : null,
      usdNote: hasPricing(model) ? undefined : 'энэ загварын үнэ бүртгэгдээгүй',
    });
  } catch (err) {
    return Response.json(
      {
        ok: false,
        provider,
        model,
        latencyMs: Date.now() - started,
        status: err?.status ?? null,
        error: err?.message ?? String(err),
      },
      { status: 500 },
    );
  }
}
