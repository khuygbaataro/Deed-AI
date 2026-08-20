import { config } from './config.js';
import { HUMAN_PHONE } from './prompt.js';
import { log, maskPsid } from './logger.js';
import { notifyAdmins, passThreadControl, sendImage, sendText } from './messenger.js';
import { setHandedOver } from './sessions.js';
import { getLead, saveLead } from './leads.js';
import {
  FIRST_YEAR_CONDITION,
  PROGRAMS,
  TUITION,
  findProgram,
  formatMnt,
  VISIT,
  findTrack,
  overviewImageUrl,
  programImageUrl,
} from './admissions.js';

import { recordEvent } from './events.js';

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
    name: 'book_school_visit',
    description:
      'Элсэгчийг сургууль дээр ирж бүртгүүлэх ЦАГИЙГ ТОВЛОНО. Энэ бол элсэлтийн ' +
      'эцсийн алхам — онлайн төлбөр биш, биечлэн ирж бүртгүүлнэ. ' +
      'Хэрэглэгч ирэх өдөр, цагаа хэлсний дараа дуудна. Өмнө нь нэр, утас ' +
      'бүртгэгдсэн байх ёстой.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        day: {
          type: 'string',
          description: 'Ирэх өдөр — хэрэглэгчийн хэлснээр (жишээ: "Мягмар гараг", "8-р сарын 25")',
        },
        time: {
          type: 'string',
          description: 'Ирэх цаг (жишээ: "15:00", "өглөө 10 цаг")',
        },
      },
      required: ['day', 'time'],
      additionalProperties: false,
    },
  },
  {
    name: 'report_missing_info',
    description:
      'Хэрэглэгчийн асуултад мэдлэгийн сангаас хариулах мэдээлэл БАЙХГҮЙ үед дуудна. ' +
      'Асуултыг бүртгэж, сургууль ямар мэдээлэл дутуу байгааг хожим харах боломжтой болгоно. ' +
      'Дуудсаны дараа хэрэглэгчид шударгаар "баталгаатай мэдээлэл алга" гэж хэлээд ' +
      'утсыг нь үлдээхийг санал болго. Мэдэхгүй асуулт бүрт дуудна — энэ нь ' +
      'мэдлэгийн санг сайжруулах гол эх сурвалж.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'Хэрэглэгчийн асуусан асуултыг товчоор (монголоор)',
        },
      },
      required: ['question'],
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
    // ─── Сургууль дээр ирэх цаг товлох ─────────────────────────────────
    if (name === 'book_school_visit') {
      const lead = await getLead(ctx.psid);
      if (!lead.name || !lead.phone) {
        return {
          content: 'Нэр, утас бүртгэгдээгүй байна. Эхлээд save_contact_info-оор бүртгэ.',
          isError: true,
        };
      }

      await saveLead(ctx.psid, {
        stage: 'visit_booked',
        visit: { day: input.day, time: input.time, bookedAt: new Date().toISOString() },
      });

      if (!ctx.offline) {
        await notifyAdmins(
          [
            '📅 УУЛЗАЛТЫН ЦАГ ТОВЛОЛОО',
            'Нэр: ' + (lead.name ?? '-'),
            'Нас: ' + (lead.age ?? '-'),
            'Утас: ' + (lead.phone ?? '-'),
            'Мэргэжил: ' + (lead.programName ?? '-'),
            'Урсгал: ' + (lead.trackName ?? '-'),
            'ИРЭХ: ' + input.day + ' ' + input.time,
            'Хураамж: ' + formatMnt(TUITION.seatDeposit) + ' (бэлнээр)',
          ].join(String.fromCharCode(10)),
        );
      }

      log.info('Уулзалтын цаг товлолоо', { psid: maskPsid(ctx.psid) });

      return {
        content: [
          'Цаг товлогдлоо: ' + input.day + ' ' + input.time + '.',
          'Хаяг: ' + VISIT.place + '.',
          'Хэрэглэгчид дараахыг ТОВЧ хэл: цаг баталгаажсан, хаяг, ирэхдээ',
          formatMnt(TUITION.seatDeposit) + ' бэлнээр авчрах, бичиг баримтаа авчрах.',
          'Элсэлтийн албанд мэдэгдсэн гэдгийг нэм.',
        ].join(' '),
      };
    }

    // ─── Мэдээлэл дутуу гэж бүртгэх ────────────────────────────────────
    if (name === 'report_missing_info') {
      await recordEvent('missing_info', { psid: ctx.psid, question: input.question });
      log.info('Мэдээлэл дутуу', { psid: maskPsid(ctx.psid) });
      return {
        content:
          'Бүртгэгдлээ. Одоо хэрэглэгчид шударгаар "энэ талаар надад баталгаатай ' +
          'мэдээлэл алга" гэж хэлээд, элсэлтийн ажилтан тодорхой хариулж чадна ' +
          'гэдгийг нэм. Нэр, утсаа үлдээвэл эргэж холбогдоно гэж санал болго. ' +
          'Таамаг, ойролцоо хариулт ХЭЗЭЭ Ч бүү хэл.',
      };
    }

    // ─── Ажилтан руу шилжүүлэх ─────────────────────────────────────────
    if (name === 'escalate_to_human') {
      await saveLead(ctx.psid, { stage: 'escalated' });
      log.info('Хүн рүү шилжүүлэх хүсэлт', { psid: maskPsid(ctx.psid), reason: input.reason });

      let handedOver = false;
      if (!ctx.offline) {
        // ⚠️ ДАРААЛАЛ ЧУХАЛ. Thread control-ыг Page Inbox руу шилжүүлмэгц энэ
        // апп мессеж илгээх эрхгүй болно ("(#10) another app is controlling
        // this thread now"). Тиймээс хэрэглэгчид хэлэх үгийг ЭХЛЭЭД илгээж,
        // ДАРАА НЬ шилжүүлнэ.
        await sendText(
          ctx.psid,
          [
            'Сургуулийн ажилтантай холбож өглөө.',
            '',
            'Тэд энэ чатаар удахгүй хариулна. Яаралтай бол ' + HUMAN_PHONE + ' руу залгаарай.',
          ].join(String.fromCharCode(10)),
        );

        handedOver = await passThreadControl(ctx.psid, input.summary);
        await setHandedOver(ctx.psid, handedOver);
        await notifyAdmins(
          [
            '🔔 ' + (REASON_LABELS[input.reason] ?? input.reason),
            input.summary,
            handedOver ? 'Яриа Page Inbox руу шилжсэн.' : 'Анхаар: гараар хариулна уу.',
          ].join(String.fromCharCode(10)),
        );
      }

      return {
        handedOver,
        content: handedOver
          ? 'Шилжүүллээ. Хэрэглэгчид мэдэгдэх мессеж АЛЬ ХЭДИЙН илгээгдсэн — ' +
            'дахин юу ч бичих ШААРДЛАГАГҮЙ. Маш богино хариу буцаа.'
          : 'Хүсэлт бүртгэгдлээ. Ажилтан Messenger-ээр эргэн холбогдоно гэж хэлээд, ' +
            'сургуулийн утсаар шууд холбогдох боломжтойг сануул.',
      };
    }

    return { content: `Тодорхойгүй хэрэгсэл: ${name}`, isError: true };
  } catch (err) {
    log.error('Хэрэгсэл гүйцэтгэхэд алдаа гарлаа', { name, error: err.message });
    await recordEvent('tool_error', { psid: ctx.psid, detail: `${name}: ${err.message}` });
    return {
      content:
        'Техникийн алдаа гарлаа. Хэрэглэгчээс уучлалт гуйж, сургуулийн утсаар холбогдохыг санал болго.',
      isError: true,
    };
  }
}

export { config };
