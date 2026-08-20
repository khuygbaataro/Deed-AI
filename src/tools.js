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
  REGISTRATION,
  WORKING_WEEKDAYS,
  BANK_ACCOUNT,
  findTrack,
  overviewImageUrl,
  programImageUrl,
} from './admissions.js';

import { recordEvent } from './events.js';
import { format as formatDate, resolveDay, weekdayIndex } from './dates.js';

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
        age: {
          type: 'number',
          description: 'Элсэгчийн нас. АСУУХ ШААРДЛАГАГҮЙ — өөрөө хэлээгүй бол 0.',
        },
        phone: { type: 'string', description: 'Утасны дугаар' },
        email: {
          type: 'string',
          description:
            'Gmail хаяг. ЗӨВХӨН онлайн гэрээний үед шаардлагатай. ' +
            'Биеэр ирэх бол асуухгүй — хоосон мөр илгээ.',
        },
      },
      required: ['full_name', 'age', 'phone', 'email'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_registration_mode',
    description:
      'Элсэгч суудлаа ЯАЖ баталгаажуулахаа шийдсэн үед дуудна. ' +
      'in_person = сургууль дээр ирж бүртгүүлнэ (бэлнээр). ' +
      'online = онлайнаар гэрээ байгуулж, дансаар шилжүүлнэ. ' +
      'Хэрэглэгч өөрөө сонгосны ДАРАА дуудна — өмнө нь биш.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: ['in_person', 'online'],
          description: 'Элсэгчийн сонгосон зам',
        },
      },
      required: ['mode'],
      additionalProperties: false,
    },
  },
  {
    name: 'book_school_visit',
    description:
      'Элсэгчийг сургууль дээр ирж бүртгүүлэх ЦАГИЙГ ТОВЛОНО. Хэрэглэгч ирэх ' +
      'ӨДӨР, ЦАГ хоёуланг нь хэлсний дараа дуудна. Нэр, утсыг ДАРАА нь авна — ' +
      'энд шаардахгүй. Ажлын өдөр (Даваа-Баасан) л боломжтой.',
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
              + ' ТЕКСТЭЭР ДАХИН БҮҮ БИЧ — давхардал болно. Шууд 4-р алхам руу ор:'
              + ' "Та өмнө нь дээд боловсрол эзэмшсэн үү?" гэж НЭГ асуулт тавь.'
            : ' Хөтөлбөрийн талаар 2-3 өгүүлбэрээр товч танилцуулаад, 4-р алхам руу ор:'
              + ' "Та өмнө нь дээд боловсрол эзэмшсэн үү?" гэж асуу.'),
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
          'Эдгээрийг ТОВЧ хэлээд 5-р алхам руу ор: тэр нь ЯГ ЯМАР МЭРГЭЖИЛТЭН болж,',
          'хаана ажиллахыг тодорхой хэл. Дараа нь 6-р алхмын ХҮЧТЭЙ асуултыг тавь:',
          '"Та яг ийм хүн болно гэдгээ эргэлзээгүй шийдсэн байгаа юу?"',
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

      const lead = await getLead(ctx.psid);
      const online = lead.registrationMode === 'online';
      const complete = Boolean(lead.name && lead.phone && (online ? lead.email : lead.visit));

      // Бүртгэл бүрдсэн бол элсэлтийн ажилтанд БҮРЭН тайлан илгээнэ —
      // тэр хүн үүнийг хэвлээд шууд ашиглана.
      if (!ctx.offline && complete) {
        await notifyAdmins(
          [
            online ? '💻 ОНЛАЙН БҮРТГЭЛ БҮРДЛЭЭ' : '✅ ЭЛСЭГЧ БҮРЭН БҮРТГЭГДЛЭЭ',
            'Нэр: ' + (lead.name ?? '-'),
            'Утас: ' + (lead.phone ?? '-'),
            ...(lead.age ? ['Нас: ' + lead.age] : []),
            ...(lead.email ? ['И-мэйл: ' + lead.email] : []),
            'Мэргэжил: ' + (lead.programName ?? '-'),
            'Урсгал: ' + (lead.trackName ?? '-'),
            online
              ? 'ЗАМ: онлайн гэрээ + дансаар шилжүүлэг'
              : 'ИРЭХ: ' + (lead.visit?.label ?? '-') + ', ' + (lead.visit?.time ?? '-'),
            'Хураамж: ' + formatMnt(TUITION.seatDeposit) +
              (online ? ' (дансаар)' : ' (бэлнээр)'),
          ].join(String.fromCharCode(10)),
        );
      } else if (!ctx.offline) {
        await notifyAdmins(
          '📇 Шинэ холбоо барих мэдээлэл' + String.fromCharCode(10) +
            'Нэр: ' + input.full_name + String.fromCharCode(10) +
            'Утас: ' + input.phone + String.fromCharCode(10) +
            'Мэргэжил: ' + (lead.programName ?? '-'),
        );
      }

      if (complete) {
        return {
          content: online
            ? [
                'Бүх мэдээлэл бүртгэгдэж, элсэлтийн албанд БҮРЭН тайлан очлоо.',
                'Одоо яриаг дуусга: гэрээг gmail хаягаар нь илгээхийг хэл,',
                BANK_ACCOUNT.bankName + ' данс ' + BANK_ACCOUNT.accountNumber +
                  ' (' + BANK_ACCOUNT.accountName + ') руу ' +
                  formatMnt(TUITION.seatDeposit) + ' шилжүүлэхийг сануул.',
                'Төгсгөлд нь ирээдүйнхээ төлөө шийдвэр гаргасанд нь ДУЛААХАН',
                'баяр хүргэ — emoji хэрэглэ.',
              ].join(' ')
            : [
                'Бүх мэдээлэл бүртгэгдэж, элсэлтийн албанд БҮРЭН тайлан очлоо.',
                'Одоо яриаг дуусга: товлосон өдөр, цаг, хаяг (' + VISIT.place + '),',
                formatMnt(TUITION.seatDeposit) + ' бэлнээр авчрахыг давтаж хэл.',
                'Төгсгөлд нь ирээдүйнхээ төлөө шийдвэр гаргасанд нь ДУЛААХАН',
                'баяр хүргэ — emoji хэрэглэ.',
              ].join(' '),
        };
      }

      return {
        content: online
          ? 'Бүртгэлээ. Дутуу мэдээллийг НЭГ НЭГЭЭР нь асуу (нэр → утас → gmail).'
          : 'Бүртгэлээ. Уулзалтын цаг хараахан товлогдоогүй бол өдрийг нь эелдэгээр асуу.',
      };
    }
    // ─── Бүртгэлийн зам сонгох ─────────────────────────────────────────
    if (name === 'set_registration_mode') {
      const mode = REGISTRATION.modes[input.mode];
      if (!mode) return { content: 'Тодорхойгүй зам: ' + input.mode, isError: true };

      await saveLead(ctx.psid, { registrationMode: mode.id, stage: 'mode_selected' });

      if (mode.id === 'online') {
        return {
          content: [
            'Онлайн бүртгэлийн зам сонгогдлоо.',
            'Хэрэглэгчид дараахыг ТОВЧ хэл:',
            'суудал баталгаажуулах ' + formatMnt(TUITION.seatDeposit) + '-г дараах данс руу шилжүүлнэ —',
            BANK_ACCOUNT.bankName + ', данс ' + BANK_ACCOUNT.accountNumber + ',',
            'хүлээн авагч ' + BANK_ACCOUNT.accountName + '.',
            'Гэрээг gmail хаягаар нь илгээнэ.',
            'Дараа нь НЭГ асуулт: нэрийг нь асуу. Утас, gmail-ыг ТУС ТУСАД нь дараалуулж ав.',
          ].join(' '),
        };
      }

      return {
        content: [
          'Биеэр ирж бүртгүүлэх зам сонгогдлоо.',
          'Хураамж ' + formatMnt(TUITION.seatDeposit) + '-г ирэхдээ БЭЛНЭЭР авчирна гэдгийг эндээс эхлэн хэлж болно.',
          'Одоо цаг товлох алхам руу ор: эхлээд ӨДРИЙГ нь асуу ("Таны боломжтой өдөр хэзээ байна?"),',
          'өдөр тодорхой болсны ДАРАА л цаг санал болго. Хоёуланг нь нэг дор бүү асуу.',
        ].join(' '),
      };
    }
    // ─── Сургууль дээр ирэх цаг товлох ─────────────────────────────────
    if (name === 'book_school_visit') {
      // Цаг товлолт хувийн мэдээллээс ӨМНӨ явагдана — нэр, утас шаардахгүй.
      const lead = await getLead(ctx.psid);

      // "Маргааш" гэдгийг тэр чигээр нь хадгалвал ажилтан ямар өдөр болохыг
      // мэдэхгүй. Бодит огноо болгоно — танихгүй бол ТААМАГЛАХГҮЙ.
      const resolved = resolveDay(input.day);

      if (resolved && !WORKING_WEEKDAYS.includes(weekdayIndex(resolved.date))) {
        return {
          content: [
            resolved.label + ' нь амралтын өдөр — сургалтын алба ажиллахгүй.',
            'Хэрэглэгчид эелдэгээр хэлээд Даваа-Баасангийн аль өдөр таарахыг асуу.',
          ].join(' '),
          isError: true,
        };
      }

      const visit = {
        day: input.day,
        time: input.time,
        date: resolved?.date ?? null,
        weekday: resolved?.weekday ?? null,
        label: resolved ? resolved.label : input.day,
        bookedAt: new Date().toISOString(),
      };

      await saveLead(ctx.psid, { stage: 'visit_booked', visit });

      if (!ctx.offline) {
        await notifyAdmins(
          [
            '📅 УУЛЗАЛТЫН ЦАГ ТОВЛОЛОО',
            lead.name ? '' : '(хувийн мэдээлэл дараагийн алхамд ирнэ)',
            'Нэр: ' + (lead.name ?? '-'),
            'Нас: ' + (lead.age ?? '-'),
            'Утас: ' + (lead.phone ?? '-'),
            'Мэргэжил: ' + (lead.programName ?? '-'),
            'Урсгал: ' + (lead.trackName ?? '-'),
            'ИРЭХ: ' + visit.label + ', ' + visit.time,
            'Хэлсэн үг: "' + input.day + '"',
            'Хураамж: ' + formatMnt(TUITION.seatDeposit) + ' (бэлнээр)',
          ].filter(Boolean).join(String.fromCharCode(10)),
        );
      }

      log.info('Уулзалтын цаг товлолоо', { psid: maskPsid(ctx.psid) });

      return {
        content: [
          'Цаг товлогдлоо: ' + visit.label + ', ' + visit.time + '.',
          'Хэрэглэгчид НЭГ дулаахан өгүүлбэрээр цаг баталгаажсаныг хэл.',
          'Дараа нь ЗӨВХӨН НЭГ асуулт тавь: "Таныг хэн ирж уулзана гэж хэлэх вэ?"',
          'Утас, хаягийг одоо БҮҮ асуу, БҮҮ бич — нэрийг нь авсны дараа ээлжлэн явна.',
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
