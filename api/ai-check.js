/**
 * Vercel serverless функц — AI холболтын шалгалт.
 * Маршрут: /api/ai-check  (vercel.json-оор /ai-check ч ажиллана)
 *
 * Загвар сольсны дараа "хүсэлтийн бүтэц энэ загварт зохих эсэх"-ийг
 * ТААМАГЛАХГҮЙ, нэг бодит дуудлагаар шалгана. Хэрэглэгч рүү юу ч илгээхгүй.
 *
 * Хамгаалалт: HTTP Basic auth, нууц үг = ADMIN_TOKEN (админтай ижил).
 * Токен тохируулаагүй бол шалгалт ажиллахгүй — ил задгай токен зарцуулахгүй.
 */
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../src/config.js';
import { buildSystemPrompt } from '../src/prompt.js';
import { TOOLS } from '../src/tools.js';
import { estimateCost } from '../src/usage.js';

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

const isClaude5 = (model) => /^claude-(opus|sonnet|haiku|fable)-5/.test(model);
const toolsFor = (model) =>
  isClaude5(model) ? TOOLS : TOOLS.map(({ strict, ...rest }) => rest);

export async function GET(request) {
  const token = adminToken();
  if (!token) {
    return Response.json({ ok: false, error: 'ADMIN_TOKEN тохируулаагүй байна.' }, { status: 503 });
  }
  if (!checkAuth(request, token)) return unauthorized();

  const model = config.claude.model;
  const started = Date.now();

  try {
    const client = new Anthropic(
      config.claude.apiKey ? { apiKey: config.claude.apiKey } : {},
    );
    const system = await buildSystemPrompt();

    // Бодит чат шиг бүтэцтэй, гэхдээ хамгийн богино дуудлага
    const response = await client.messages.create({
      model,
      max_tokens: 300,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral', ttl: '1h' } }],
      ...(isClaude5(model)
        ? { thinking: { type: 'adaptive' }, output_config: { effort: config.claude.effort } }
        : {}),
      tools: toolsFor(model),
      messages: [{ role: 'user', content: 'Сайн байна уу, ямар мэргэжлүүд байдаг вэ?' }],
    });

    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join(' ')
      .trim();
    const toolCalls = response.content.filter((b) => b.type === 'tool_use').map((b) => b.name);

    return Response.json({
      ok: true,
      model,
      strictTools: isClaude5(model),
      adaptiveThinking: isClaude5(model),
      latencyMs: Date.now() - started,
      stopReason: response.stop_reason,
      toolCalls,
      reply: text.slice(0, 300),
      usage: {
        input: response.usage?.input_tokens ?? 0,
        output: response.usage?.output_tokens ?? 0,
        cacheRead: response.usage?.cache_read_input_tokens ?? 0,
        cacheWrite: response.usage?.cache_creation_input_tokens ?? 0,
      },
      usd: Number(estimateCost(model, response.usage ?? {}).toFixed(5)),
    });
  } catch (err) {
    return Response.json(
      {
        ok: false,
        model,
        latencyMs: Date.now() - started,
        status: err?.status ?? null,
        error: err?.message ?? String(err),
      },
      { status: 500 },
    );
  }
}
