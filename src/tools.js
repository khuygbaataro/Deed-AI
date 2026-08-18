import { config } from './config.js';
import { log, maskPsid } from './logger.js';
import { notifyAdmins, passThreadControl, sendImage } from './messenger.js';
import { setHandedOver } from './sessions.js';
import { getLead, saveLead } from './leads.js';
import {
  BANK_ACCOUNT,
  PROGRAMS,
  TUITION,
  evaluateApplicant,
  findProgram,
  formatMnt,
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
 * ⚠️ Мөнгө, эрхийн тооцоог AI хийхгүй. check_eesh_and_price нь admissions.js
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
      'Бүртгэлд тэмдэглээд, тухайн хөтөлбөрийн ЭЕШ-ийн шаардлагыг буцаана. ' +
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
    name: 'check_eesh_and_price',
    description:
      'Элсэгчийн нөхцөл байдлыг үнэлж, хөнгөлөлт болон төлбөрийг ТООЦУУЛНА. ' +
      'ЭЕШ-ийн оноо болон орон нутгийн эсэхийг мэдсэн даруйд дуудна. ' +
      'ЧУХАЛ: чи өөрөө босго давсан эсэхийг шүүх, хөнгөлөлтийн хувь сонгох, үнэ бодохыг ' +
      'ОРОЛДОЖ БОЛОХГҮЙ — зөвхөн энэ хэрэгслийн буцаасан тоог давтаж хэл.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        program: { type: 'string', enum: PROGRAM_NAMES, description: 'Хөтөлбөрийн нэр' },
        scores: {
          type: 'array',
          description:
            'ЭЕШ-ийн хичээл болон оноо. Оноо аваагүй, эсвэл ЭЕШ өгөөгүй бол хоосон массив.',
          items: {
            type: 'object',
            properties: {
              subject: {
                type: 'string',
                description: 'Хичээлийн нэр, жишээ: Математик, Англи хэл, Нийгэм судлал',
              },
              score: { type: 'number', description: 'ЭЕШ-ийн оноо (0-800)' },
            },
            required: ['subject', 'score'],
            additionalProperties: false,
          },
        },
        is_rural: {
          type: 'boolean',
          description:
            'Орон нутгаас (Улаанбаатараас гадуур) элсэж байгаа эсэх. ' +
            '100% хөнгөлөлтөд ЗААВАЛ шаардлагатай тул үргэлж асууж тодруул.',
        },
        level: {
          type: 'string',
          enum: ['bachelor', 'master'],
          description: 'Бакалавр эсвэл магистрын хөтөлбөр. Тодорхойгүй бол bachelor.',
        },
        age: {
          type: 'number',
          description: 'Элсэгчийн нас. Мэдэхгүй эсвэл хамаагүй бол 0.',
        },
        work_years: {
          type: 'number',
          description: 'Мэргэжлээрээ ажилласан жил. Мэдэхгүй эсвэл хамаагүй бол 0.',
        },
        has_bachelor: {
          type: 'boolean',
          description: 'Аль хэдийн бакалаврын зэрэгтэй эсэх (хоёр дахь мэргэжил).',
        },
      },
      required: ['program', 'scores', 'is_rural', 'level', 'age', 'work_years', 'has_bachelor'],
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
        phone: { type: 'string', description: 'Утасны дугаар' },
      },
      required: ['full_name', 'phone'],
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

      const requirements = program.examGroups
        .map((g) => `${g.subjects.join(' эсвэл ')} — ${g.minScore}+ оноо`)
        .join('; ');

      return {
        content:
          `Бүртгэлээ: ${program.name} (код ${program.code}).` +
          (program.inDemand
            ? ' Энэ нь Засгийн газрын 115-р тогтоолын ЭРЭЛТТЭЙ мэргэжлийн жагсаалтад багтсан.'
            : '') +
          ` ЭЕШ-ийн шаардлага: ${requirements}.` +
          (imageSent
            ? ' ТАНИЛЦУУЛГА КАРТ ИЛГЭЭГДЛЭЭ. Картан дээр хөтөлбөрийн нэр, гарчиг,'
              + ' бүрэн тайлбар аль хэдийн бичээстэй байна. Тиймээс танилцуулгыг'
              + ' ТЕКСТЭЭР ДАХИН БҮҮ БИЧ — давхардал болно. Шууд дараагийн алхам руу'
              + ' ор: элсэлтээ баталгаажуулах эсэхийг НЭГ богино өгүүлбэрээр асуу.'
            : ' Хөтөлбөрийн талаар 2-3 өгүүлбэрээр товч танилцуулаад, элсэлтээ'
              + ' баталгаажуулах эсэхийг асуу.'),
      };
    }

    // ─── Хөнгөлөлт, үнэ тооцох (кодоор) ────────────────────────────────
    if (name === 'check_eesh_and_price') {
      const profile = {
        level: input.level === 'master' ? 'master' : 'bachelor',
        isRural: Boolean(input.is_rural),
        hasEesh: Array.isArray(input.scores) && input.scores.length > 0,
        age: Number(input.age) || 0,
        workYears: Number(input.work_years) || 0,
        hasBachelor: Boolean(input.has_bachelor),
      };

      const result = evaluateApplicant(input.program, input.scores, profile);
      if (!result.ok) return { content: result.error, isError: true };

      // Оноо дутуу бол хөнгөлөлт ЗАРЛАХГҮЙ — дутуу хичээлийг нь асууна.
      // Эс бөгөөс 100% эрхтэй элсэгчид 20% гэж буруу хэлэх эрсдэлтэй.
      if (result.incomplete) {
        const ask = result.missingSubjects.join(' эсвэл ');
        return {
          content: [
            'МЭДЭЭЛЭЛ ДУТУУ БАЙНА — хөнгөлөлтийг хараахан тооцоогүй.',
            `Дараах хичээлийн оноог хэрэглэгчээс асуу: ${ask}.`,
            'Хөнгөлөлтийн талаар ЮУ Ч БҮҮ ХЭЛ — зөвхөн дутуу оноог эелдгээр асуу.',
            'Хэрэв тухайн хичээлээр ЭЕШ өгөөгүй гэвэл оноог нь 0 гэж оруулаад',
            'энэ хэрэгслийг дахин дууд.',
          ].join(' '),
        };
      }
      await saveLead(ctx.psid, {
        programId: result.program.id,
        programName: result.program.name,
        eesh: input.scores,
        qualified: result.qualified,
        isRural: profile.isRural,
        incentiveId: result.incentive.id,
        incentiveLabel: result.incentive.label,
        annualAfterDiscount: result.annualAfterDiscount,
        stage: 'eesh_checked',
      });

      const breakdown = result.groupResults
        .map(
          (g) =>
            `${g.subjects.join('/')} (${g.minScore}+): ` +
            (g.best ? `${g.best.subject} ${g.best.score} — ${g.met ? 'хангасан' : 'хүрээгүй'}` : 'оноо өгөөгүй'),
        )
        .join(' | ');

      const otherOptions = (result.eligibleIncentives ?? [])
        .filter((i) => i.id !== result.incentive.id)
        .map((i) => `${i.label} (${i.reason})`)
        .join('; ');

      const depositLine = result.depositDeductible
        ? `- Суудлын хураамж ${formatMnt(result.seatDeposit)} нь ЭНЭ ХӨНГӨЛСӨН ДҮНГЭЭС хасагдана\n` +
          `- Хураамж төлсний дараах үлдэгдэл: ${formatMnt(result.remainingBalance)}\n`
        : `- Суудлын хураамж ${formatMnt(result.seatDeposit)} нь сургалтын төлбөрөөс ТУСДАА төлөгдөнө\n`;

      return {
        content:
          `ТООЦООЛСОН ҮР ДҮН (эдгээр тоог яг хэвээр нь хэрэглэ, өөрөө бүү тооцоол):\n` +
          `- Шалгалтын задаргаа: ${breakdown}\n` +
          `- Босго хангасан эсэх: ${result.qualified ? 'ТИЙМ' : 'ҮГҮЙ'}\n` +
          `- Орон нутгийн элсэгч: ${profile.isRural ? 'ТИЙМ' : 'ҮГҮЙ'}\n` +
          `- ОЛГОГДОХ ХӨНГӨЛӨЛТ: ${result.incentive.label} — ${result.incentive.reason}\n` +
          (result.incentive.note ? `- Тайлбар: ${result.incentive.note}\n` : '') +
          (otherOptions ? `- Бас хамрагдаж болох: ${otherOptions}\n` : '') +
          `- Жилийн үндсэн төлбөр: ${formatMnt(result.baseAnnual)}\n` +
          `- Хөнгөлөлт: ${formatMnt(result.discountAmount)}\n` +
          `- Хөнгөлсний дараах жилийн төлбөр: ${formatMnt(result.annualAfterDiscount)}\n` +
          depositLine +
          `- Элсэгчийн нийт төлөх дүн: ${formatMnt(result.totalPayable)}\n\n` +
          `Хэрэглэгчид урамшуулал, үндсэн үнэ, хөнгөлсөн үнийг товч хэлээд, ` +
          `суудлын хураамж хасагдах эсэхийг тодорхой хэл. Дараа нь суудлаа ` +
          `баталгаажуулах эсэхийг асуу. Энэ бол урьдчилсан тооцоо гэдгийг нэг өгүүлбэрээр дурд.`,
      };
    }

    // ─── Холбоо барих мэдээлэл ─────────────────────────────────────────
    if (name === 'save_contact_info') {
      await saveLead(ctx.psid, {
        name: input.full_name,
        phone: input.phone,
        stage: 'contact_saved',
      });

      if (!ctx.offline) {
        const lead = await getLead(ctx.psid);
        await notifyAdmins(
          `📇 Шинэ элсэгч\nНэр: ${input.full_name}\nУтас: ${input.phone}\n` +
            `Мэргэжил: ${lead.programName ?? '-'}\nУрамшуулал: ${lead.incentiveLabel ?? '-'}`,
        );
      }

      return {
        content:
          'Нэр, утас бүртгэгдлээ. Одоо суудал баталгаажуулах нэхэмжлэх үүсгэх эсэхийг асуу.',
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
          await notifyAdmins(
            `💳 Төлбөрийн хүсэлт (QPay тохируулаагүй)\n${lead.name} / ${lead.phone}\n` +
              `${lead.programName ?? '-'} — ${formatMnt(TUITION.seatDeposit)}`,
          );
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
        await notifyAdmins(
          `💳 Нэхэмжлэх үүслээ\n${lead.name} / ${lead.phone}\n` +
            `${lead.programName ?? '-'} — ${formatMnt(TUITION.seatDeposit)}\n№ ${senderInvoiceNo}`,
        );
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
