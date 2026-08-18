/**
 * Facebook хуудасны Messenger тохиргоог нэг удаа хийнэ:
 *   - Хуудсыг апп-д захируулах (subscribed_apps)
 *   - "Эхлэх" товч, мэндчилгээ, үндсэн цэс, ice breakers
 *
 * Ажиллуулах:  npm run setup:messenger
 * Шаардлага:   .env дотор FB_PAGE_ACCESS_TOKEN
 */
import { config } from '../src/config.js';
import { SCHOOL_NAME } from '../src/prompt.js';

if (!config.fb.pageAccessToken) {
  console.error('FB_PAGE_ACCESS_TOKEN тохируулаагүй байна. .env файлаа шалгана уу.');
  process.exit(1);
}

const base = `https://graph.facebook.com/${config.fb.graphVersion}`;
const token = encodeURIComponent(config.fb.pageAccessToken);

async function post(path, body) {
  const res = await fetch(`${base}/${path}?access_token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} → ${res.status}: ${text}`);
  return text;
}

const steps = [
  {
    name: 'Хуудсыг апп-д захируулах',
    run: () =>
      post('me/subscribed_apps', {
        subscribed_fields: [
          'messages',
          'messaging_postbacks',
          'messaging_optins',
          'message_deliveries',
          'message_reads',
          'messaging_handovers',
        ],
      }),
  },
  {
    name: 'Messenger профайл (мэндчилгээ, Эхлэх товч)',
    run: () =>
      post('me/messenger_profile', {
        get_started: { payload: 'GET_STARTED' },
        greeting: [
          {
            locale: 'default',
            text:
              `Сайн байна уу! Энэ бол ${SCHOOL_NAME}-ийн хиймэл оюун ухаант туслах. ` +
              'Элсэлт, хөтөлбөр, төлбөрийн талаар асуугаарай.',
          },
        ],
        // Товчлуур, цэс ашиглахгүй — хэрэглэгч чөлөөтэй бичнэ.
        // Хуучин тохиргоог арилгахын тулд хоосон жагсаалт илгээнэ.
        ice_breakers: [],
      }),
  },
];

for (const step of steps) {
  try {
    const out = await step.run();
    console.log(`✅ ${step.name}: ${out}`);
  } catch (err) {
    console.error(`❌ ${step.name}\n   ${err.message}`);
  }
}

console.log('\nДууслаа. Мессенжерээ нээж "Эхлэх" товчийг дарж шалгана уу.');
