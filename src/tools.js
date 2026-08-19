import { config } from './config.js';
import { log, maskPsid } from './logger.js';
import { notifyAdmins, passThreadControl, sendImage } from './messenger.js';
import { setHandedOver } from './sessions.js';
import { getLead, saveLead } from './leads.js';
import {
  BANK_ACCOUNT,
  FIRST_YEAR_CONDITION,
  PROGRAMS,
  TRACKS,
  TUITION,
  findProgram,
  formatMnt,
  findTrack,
  isBankConfigured,
  overviewImageUrl,
  programImageUrl,
} from './admissions.js';

import { createInvoice, isQpayConfigured } from './qpay.js';
import { kvSet } from './store.js';

const PROGRAM_NAMES = PROGRAMS.map((p) => p.name);

/**
 * Claude-д зарлах хэрэгслүүд.
 * strict: true — оролтын бүтэц баталгаатай зөв ирнэ.
 *
 * ⚠️ Дүн, төлбөрийг AI бодохгүй. Бүх тоо admissions.js-ээс гарна
 * доторх кодоор тооцоолж, бэлэн үр дүнг буцаана.
 */
export const TOOLS = [
  {
    name: 'show_program_list',
    description:
      'Бүх мэргэжлийг дугаарын хамт харуулсан КАРТ (зураг) илгээнэ. ' +
      'Хэрэглэгч мэргэжлээ сонгоогүй байж "ямар мэргэжил байдаг вэ?", ' +
      '"юу сурч болох вэ?" гэх мэтээр асуувал энэ хэрэгслийг дууд. ' +
      'Картан дээр 6 мэргэжил дугаарлагдсан байгаа тул чи мэргэжлүүдийг ' +
      'текстээр ДАХИН жагсаах ШААРДЛАГАГҮЙ — зөвхөн дугаараа сонгохыг хүс.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: 'set_program_interest',
    description:
      'Хэрэглэгч аль мэргэжлийг сонирхож байгаагаа хэлсэн үед дуудна. ' +
      'Бүртгэлд тэмдэглээд, танилцуулга картыг илгээнэ. ' +
      'Хэрэглэгч мэргэжлээ нэрлэсэн даруйд дуудна — нэмэлт зөвшөөрөл шаардахгүй.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        program: {
          type: 'string',
          enum: PROGRAM_NAMES,
          description: 'Хэрэглэгчийн сонирхож буй хөтөлбөрийн нэр',
        },
      },
      required: ['program'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_applicant_track',
    description:
      'Элсэгч аль урсгалд хамаарахыг тэмдэглэнэ. Гурван урсгал бий: ' +
      'standard (шинээр элсэгч, 4 жил, танхим+онлайн), ' +
      'thirty_plus (30-аас дээш настай), ' +
      'second_degree (өмнө нь бакалаврын зэрэгтэй, эчнээ 2.5 жил). ' +
      'Урсгал тодорхой болмогц дуудна — суралцах хугацаа, хэлбэр нь ' +
      'урсгал бүрт ӨӨР тул үүнийг мэдэхгүйгээр зөв мэдээлэл өгөх боломжгүй.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        track: {
          type: 'string',
          enum: ['standard', 'thirty_plus', 'second_degree'],
          description: 'Элсэгчийн хамаарах урсгал',
        },
      },
      required: ['track'],
      additionalProperties: false,
    },
  },
  {
    name: 'save_contact_info',
    description:
      'Хэрэглэгчийн нэр, утасны дугаарыг бүртгэнэ. Хоёр тохиолдолд хэрэглэнэ: ' +
      '(1) суудал баталгаажуулахын өмнө, (2) чиний мэдэхгүй асуултад ажилтан эргэж ' +
      'хариулахаар утсыг нь хадгалахад. Хэрэглэгч өөрөө өгсөн эсвэл зөвшөөрсөн үед л дуудна.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        full_name: { type: 'string', description: 'Овог нэр' },
        age: { type: 'number', description: 'Элсэгчийн нас. Хэлээгүй бол 0.' },
        phone: { type: 'string', description: 'Утасны дугаар' },
        email: { type: 'string', description: 'Gmail хаяг. Хэлээгүй бол хоосон мөр.' },
      },
      required: ['full_name', 'age', 'phone', 'email'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_seat_invoice',
    description:
      `Суудал баталгаажуулах ${formatMnt(TUITION.seatDeposit)} хураамжийн төлбөрийн ` +
      'мэдээллийг (банкны данс эсвэл QPay нэхэмжлэх) бэлтгэнэ. Зөвхөн хэрэглэгч суудлаа ' +
      'баталгаажуулахыг ТОДОРХОЙ зөвшөөрсний дараа дуудна. Өмнө нь нэр, утас бүртгэгдсэн байх ёстой.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        confirmed: {
          type: 'boolean',
          description: 'Хэрэглэгч суудлаа баталгаажуулахыг тодорхой зөвшөөрсөн эсэх',
        },
      },
      required: ['confirmed'],
      additionalProperties: false,
    },
  },
  {
    name: 'escalate_to_human',
    description:
      'Яриаг сургуулийн ажилтан руу шилжүүлнэ. Хэрэглэгч хүнтэй ярихыг хүсэх, ' +
      'эсвэл асуулт нь хувийн бүртгэл, төлбөрийн маргаан, гомдол зэрэг мэдлэгийн ' +
      'сангаас хариулах боломжгүй байвал дуудна. Энгийн асуултад бүү дууд.',
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
];

/** Суудал авсан элсэгчийн бүрэн мэдээллийг админд илгээх текст */
function seatNotice(lead, extra = '') {
  return [
    '🎟 СУУДАЛ ЗАХИАЛГА',
    `Нэр: ${lead.name ?? '-'}`,
    `Нас: ${lead.age ?? '-'}`,
    `Утас: ${lead.phone ?? '-'}`,
    `И-мэйл: ${lead.email ?? '-'}`,
    `Мэргэжил: ${lead.programName ?? '-'}`,
    `Урсгал: ${lead.trackName ?? '-'}`,
    `Хураамж: ${formatMnt(TUITION.seatDeposit)}`,
    extra,
  ].filter(Boolean).join(String.fromCharCode(10));
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
    // ─── Бүх мэргэжлийн карт ───────────────────────────────────────────
    if (name === 'show_program_list') {
      let sent = false;
      if (!ctx.offline) {
        const overview = overviewImageUrl();
        if (overview) sent = await sendImage(ctx.psid, overview);
      }
      return {
        content: sent
          ? 'Бүх мэргэжлийн карт илгээгдлээ. Картан дээр 6 мэргэжил дугаарын хамт ' +
            'бичээстэй байгаа тул ТЕКСТЭЭР ДАХИН БҮҮ ЖАГСАА. Зөвхөн нэг богино ' +
            'өгүүлбэрээр сонирхсон мэргэжлийнхээ дугаарыг бичихийг хүс.'
          : 'Карт илгээж чадсангүй. Мэргэжлүүдийг дугаарын хамт товч жагсаагаад ' +
            'сонголтыг нь асуу.',
      };
    }

    // ─── Мэргэжил сонгох ───────────────────────────────────────────────
    if (name === 'set_program_interest') {
      const program = findProgram(input.program);
      if (!program) {
        return { content: `"${input.program}" хөтөлбөр олдсонгүй.`, isError: true };
      }

      await saveLead(ctx.psid, {
        programId: program.id,
        programName: program.name,
        stage: 'program_selected',
      });

      // Танилцуулга зураг байвал текстийн өмнө илгээнэ
      let imageSent = false;
      if (!ctx.offline) {
        const image = programImageUrl(program.id);
        if (image) imageSent = await sendImage(ctx.psid, image);
      }

      return {
        content:
          `Бүртгэлээ: ${program.name} (код ${program.code}).` +
          (program.inDemand
            ? ' Энэ нь Засгийн газрын 115-р тогтоолын ЭРЭЛТТЭЙ мэргэжлийн жагсаалтад багтсан.'
            : '') +
          (imageSent
            ? ' ТАНИЛЦУУЛГА КАРТ ИЛГЭЭГДЛЭЭ. Картан дээр хөтөлбөрийн нэр, гарчиг,'
              + ' бүрэн тайлбар аль хэдийн бичээстэй байна. Тиймээс танилцуулгыг'
              + ' ТЕКСТЭЭР ДАХИН БҮҮ БИЧ — давхардал болно. Шууд дараагийн алхам руу'
              + ' ор: элсэлтээ баталгаажуулах эсэхийг НЭГ богино өгүүлбэрээр асуу.'
            : ' Хөтөлбөрийн талаар 2-3 өгүүлбэрээр товч танилцуулаад, элсэлтээ'
              + ' баталгаажуулах эсэхийг асуу.'),
      };
    }

    // ─── Суралцах урсгал ───────────────────────────────────────────────
    if (name === 'set_applicant_track') {
      const track = findTrack(input.track);
      if (!track) return { content: `Тодорхойгүй урсгал: ${input.track}`, isError: true };

      await saveLead(ctx.psid, { trackId: track.id, trackName: track.name });

      return {
        content: [
          `Урсгал тэмдэглэгдлээ: ${track.name}.`,
          `Суралцах хугацаа: ${track.duration}. Хэлбэр: ${track.format}`,
          `Эхний жилийн сургалтын төлбөр ҮНЭГҮЙ. ${FIRST_YEAR_CONDITION}`,
          'Эдгээрийг хэрэглэгчид ТОВЧ хэлээд, суудлаа баталгаажуулах эсэхийг асуу.',
          'Хугацаа, хэлбэрийг өөрөө бүү зохио — дээрх утгыг яг хэвээр нь хэрэглэ.',
        ].join(' '),
      };
    }

    // ─── Холбоо барих мэдээлэл ─────────────────────────────────────────
    if (name === 'save_contact_info') {
      await saveLead(ctx.psid, {
        name: input.full_name,
        age: Number(input.age) || null,
        phone: input.phone,
        email: input.email || null,
        stage: 'contact_saved',
      });

      if (!ctx.offline) {
        const lead = await getLead(ctx.psid);
        await notifyAdmins(
          `📇 Шинэ элсэгч\nНэр: ${input.full_name}\nНас: ${input.age || '-'}\n` +
            `Утас: ${input.phone}\nGmail: ${input.email || '-'}\n` +
            `Мэргэжил: ${lead.programName ?? '-'}`,
        );
      }

      return {
        content:
          'Нэр, нас, утас, gmail бүртгэгдлээ. Одоо суудал баталгаажуулах нэхэмжлэх үүсгэх эсэхийг асуу.',
      };
    }

    // ─── QPay нэхэмжлэх ────────────────────────────────────────────────
    if (name === 'create_seat_invoice') {
      if (!input.confirmed) {
        return {
          content: 'Хэрэглэгч хараахан зөвшөөрөөгүй байна. Эхлээд тодорхой зөвшөөрлийг ав.',
          isError: true,
        };
      }

      const lead = await getLead(ctx.psid);
      if (!lead.name || !lead.phone) {
        return {
          content:
            'Нэр, утас бүртгэгдээгүй байна. Эхлээд save_contact_info хэрэгслээр бүртгэ.',
          isError: true,
        };
      }

      const senderInvoiceNo = `SEDS-${Date.now()}-${String(ctx.psid).slice(-6)}`;
      const description = `Суудал баталгаажуулах хураамж — ${lead.programName ?? 'элсэлт'} (${lead.name})`;

      // Банкны шилжүүлэг — гүйлгээний утга нь элсэгчийн нэр
      const bankBlock = isBankConfigured()
        ? `Банк: ${BANK_ACCOUNT.bankName}
Данс: ${BANK_ACCOUNT.accountNumber}
` +
          (BANK_ACCOUNT.iban ? `IBAN: ${BANK_ACCOUNT.iban}
` : '') +
          `Хүлээн авагч: ${BANK_ACCOUNT.accountName}
Дүн: ${formatMnt(TUITION.seatDeposit)}
` +
          `Гүйлгээний утга: ${lead.name}`
        : null;

      if (!isQpayConfigured()) {
        await saveLead(ctx.psid, {
          stage: 'invoice_created',
          invoice: { senderInvoiceNo, amount: TUITION.seatDeposit, manual: true, createdAt: new Date().toISOString() },
        });
        if (!ctx.offline) {
          await notifyAdmins(seatNotice(lead, 'Төлбөр: банкны шилжүүлгээр хүлээгдэж байна'));
        }
        if (bankBlock) {
          return {
            content:
              `Төлбөрийн мэдээллийг хэрэглэгчид доорх байдлаар БҮТНЭЭР нь дамжуул:

` +
              `${bankBlock}

` +
              `Гүйлгээний утгад элсэгчийн нэрийг ЗААВАЛ бичих ёстойг онцлон хэл — ` +
              `үүгээр төлбөрийг тухайн хүүхэдтэй тулгана. Төлсний дараа баримтаа ` +
              `энэ чатад илгээхийг хүс.`,
          };
        }

        return {
          content:
            'Төлбөрийн суваг хараахан тохируулаагүй байна. Хэрэглэгчид элсэлтийн ' +
            'албанаас төлбөрийн мэдээлэл авахыг санал болгоод, ажилтан удахгүй ' +
            'холбогдоно гэж хэл. Хүсэлт бүртгэгдсэн.',
        };
      }

      const invoice = await createInvoice({
        senderInvoiceNo,
        receiverCode: lead.phone,
        amount: TUITION.seatDeposit,
        description,
      });

      if (!invoice.ok) {
        return {
          content:
            'Нэхэмжлэх үүсгэхэд алдаа гарлаа. Хэрэглэгчээс уучлалт гуйж, ажилтан ' +
            'холбогдоно гэж хэл. Дахин оролдох шаардлагагүй.',
          isError: true,
        };
      }

      await saveLead(ctx.psid, {
        stage: 'invoice_created',
        invoice: {
          senderInvoiceNo,
          invoiceId: invoice.invoiceId,
          amount: TUITION.seatDeposit,
          shortUrl: invoice.shortUrl,
          createdAt: new Date().toISOString(),
          paidAt: null,
        },
      });

      // Callback ирэхэд нэхэмжлэхийг хэрэглэгчтэй нь холбохын тулд
      await kvSet(
        `invoice:${senderInvoiceNo}`,
        { psid: ctx.psid, invoiceId: invoice.invoiceId },
        30 * 24 * 60 * 60,
      );

      const links = [invoice.shortUrl, ...(invoice.urls ?? []).slice(0, 3).map((u) => u.link)]
        .filter(Boolean)
        .join('\n');

      if (!ctx.offline) {
        await notifyAdmins(seatNotice(lead, `Нэхэмжлэх №${senderInvoiceNo}`));
      }

      return {
        content:
          `Нэхэмжлэх амжилттай үүслээ. Дүн: ${formatMnt(TUITION.seatDeposit)}. ` +
          `Хэрэглэгчид доорх холбоосыг бүтнээр нь дамжуул:\n${links}\n` +
          `Төлбөр төлсний дараа элсэлтийн алба холбогдоно гэж хэл.`,
      };
    }

    // ─── Ажилтан руу шилжүүлэх ─────────────────────────────────────────
    if (name === 'escalate_to_human') {
      await saveLead(ctx.psid, { stage: 'escalated' });
      log.info('Хүн рүү шилжүүлэх хүсэлт', { psid: maskPsid(ctx.psid), reason: input.reason });

      let handedOver = false;
      if (!ctx.offline) {
        handedOver = await passThreadControl(ctx.psid, input.summary);
        await setHandedOver(ctx.psid, handedOver);
        await notifyAdmins(
          `🔔 ${REASON_LABELS[input.reason] ?? input.reason}\n\n${input.summary}\n\n` +
            (handedOver ? 'Яриа Page Inbox руу шилжсэн.' : 'Анхаар: гараар хариулна уу.'),
        );
      }

      return {
        handedOver,
        content: handedOver
          ? 'Амжилттай шилжүүллээ. Ажилтан удахгүй хариулна гэдгийг товч мэдэгд.'
          : 'Хүсэлт бүртгэгдлээ. Ажилтан Messenger-ээр эргэн холбогдоно гэж хэлээд, ' +
            'сургуулийн утсаар шууд холбогдох боломжтойг сануул.',
      };
    }

    return { content: `Тодорхойгүй хэрэгсэл: ${name}`, isError: true };
  } catch (err) {
    log.error('Хэрэгсэл гүйцэтгэхэд алдаа гарлаа', { name, error: err.message });
    return {
      content:
        'Техникийн алдаа гарлаа. Хэрэглэгчээс уучлалт гуйж, сургуулийн утсаар холбогдохыг санал болго.',
      isError: true,
    };
  }
}

export { config };
