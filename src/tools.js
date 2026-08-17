import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { log, maskPsid } from './logger.js';
import { notifyAdmins, passThreadControl } from './messenger.js';
import { setHandedOver } from './sessions.js';

/**
 * Claude-д зарлах хэрэгслүүд.
 * strict: true — оролтын бүтэц баталгаатай зөв ирнэ.
 */
export const TOOLS = [
  {
    name: 'escalate_to_human',
    description:
      'Яриаг сургуулийн ажилтан руу шилжүүлнэ. Хэрэглэгч хүнтэй ярихыг хүсэх, ' +
      'эсвэл асуулт нь хувийн бүртгэл, төлбөрийн маргаан, гомдол, онцгой нөхцөл гэх мэт ' +
      'мэдлэгийн сангаас хариулах боломжгүй байвал энэ хэрэгслийг дуудна. ' +
      'Зөвхөн үнэхээр шаардлагатай үед ашигла — энгийн асуултад бүү дууд.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          enum: ['user_requested', 'complaint', 'personal_record', 'payment_issue', 'unknown_topic'],
          description: 'Шилжүүлж буй шалтгаан',
        },
        summary: {
          type: 'string',
          description: 'Ажилтанд зориулсан 1-2 өгүүлбэрийн товч тайлбар (монголоор)',
        },
      },
      required: ['reason', 'summary'],
      additionalProperties: false,
    },
  },
  {
    name: 'save_contact_request',
    description:
      'Хэрэглэгч эргэж холбогдохыг хүсэж, нэр/утсаа өгсөн үед холбоо барих хүсэлтийг бүртгэнэ. ' +
      'Зөвхөн хэрэглэгч өөрөө мэдээллээ өгсөн эсвэл өгөхийг зөвшөөрсөн тохиолдолд дуудна. ' +
      'Хувийн мэдээллийг урьдчилж шаардаж болохгүй.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        full_name: { type: 'string', description: 'Хэрэглэгчийн нэр' },
        phone: { type: 'string', description: 'Утасны дугаар' },
        interest: {
          type: 'string',
          description: 'Сонирхож буй хөтөлбөр эсвэл сэдэв. Тодорхойгүй бол "тодорхойгүй".',
        },
        note: { type: 'string', description: 'Нэмэлт тэмдэглэл. Байхгүй бол хоосон мөр.' },
      },
      required: ['full_name', 'phone', 'interest', 'note'],
      additionalProperties: false,
    },
  },
];

async function appendJsonl(filename, record) {
  const dir = path.resolve(process.cwd(), config.dataDir);
  await mkdir(dir, { recursive: true });
  await appendFile(path.join(dir, filename), `${JSON.stringify(record)}\n`, 'utf8');
}

const REASON_LABELS = {
  user_requested: 'Хэрэглэгч хүсэлт гаргасан',
  complaint: 'Гомдол',
  personal_record: 'Хувийн бүртгэлийн асуудал',
  payment_issue: 'Төлбөрийн асуудал',
  unknown_topic: 'Ботын мэдэхгүй сэдэв',
};

/**
 * Хэрэгслийн дуудлагыг гүйцэтгэнэ.
 * @param {{name: string, input: any}} call
 * @param {{psid: string, userName?: string|null, offline?: boolean}} ctx
 * @returns {Promise<{content: string, isError?: boolean, handedOver?: boolean}>}
 */
export async function executeTool(call, ctx) {
  const { name, input } = call;

  try {
    if (name === 'escalate_to_human') {
      const record = {
        ts: new Date().toISOString(),
        psid: ctx.psid,
        userName: ctx.userName ?? null,
        reason: input.reason,
        summary: input.summary,
      };
      await appendJsonl('escalations.jsonl', record);
      log.info('Хүн рүү шилжүүлэх хүсэлт', { psid: maskPsid(ctx.psid), reason: input.reason });

      let handedOver = false;
      if (!ctx.offline) {
        handedOver = await passThreadControl(ctx.psid, input.summary);
        setHandedOver(ctx.psid, handedOver);
        await notifyAdmins(
          `🔔 Шинэ хүсэлт: ${REASON_LABELS[input.reason] ?? input.reason}\n\n${input.summary}\n\n` +
            (handedOver
              ? 'Яриа Page Inbox руу шилжсэн.'
              : 'Анхаар: автоматаар шилжүүлж чадсангүй, Inbox-оос гараар хариулна уу.'),
        );
      }

      return {
        handedOver,
        content: handedOver
          ? 'Амжилттай шилжүүллээ. Хэрэглэгчид ажилтан удахгүй хариулна гэдгийг товч мэдэгд.'
          : 'Хүсэлт бүртгэгдлээ, гэхдээ автоматаар шилжүүлж чадсангүй. ' +
            'Хэрэглэгчид ажилтан Messenger-ээр эргэн холбогдоно гэдгийг хэлж, ' +
            'сургуулийн утсаар шууд холбогдох боломжтойг сануул.',
      };
    }

    if (name === 'save_contact_request') {
      const record = {
        ts: new Date().toISOString(),
        psid: ctx.psid,
        full_name: input.full_name,
        phone: input.phone,
        interest: input.interest,
        note: input.note,
      };
      await appendJsonl('leads.jsonl', record);
      log.info('Холбоо барих хүсэлт бүртгэгдлээ', { psid: maskPsid(ctx.psid) });

      if (!ctx.offline) {
        await notifyAdmins(
          `📇 Холбоо барих хүсэлт\nНэр: ${input.full_name}\nУтас: ${input.phone}\n` +
            `Сонирхол: ${input.interest}\nТэмдэглэл: ${input.note || '-'}`,
        );
      }

      return {
        content:
          'Хүсэлт амжилттай бүртгэгдлээ. Хэрэглэгчид ажлын өдрүүдэд эргэн холбогдоно гэдгийг товч хэл.',
      };
    }

    return { content: `Тодорхойгүй хэрэгсэл: ${name}`, isError: true };
  } catch (err) {
    log.error('Хэрэгсэл гүйцэтгэхэд алдаа гарлаа', { name, error: err.message });
    return {
      content:
        'Техникийн алдаа гарлаа. Хэрэглэгчээс уучлалт гуйж, сургуулийн утсаар шууд холбогдохыг санал болго.',
      isError: true,
    };
  }
}
