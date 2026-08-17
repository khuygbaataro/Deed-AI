# Deed AI — Соёл Эрдэм ДС-ийн Messenger чатбот

Соёл Эрдэм Дээд Сургуулийн Facebook хуудасны Messenger-т ажиллах, Claude
(Anthropic) дээр суурилсан монгол хэлний туслах бот.

Элсэгчид, оюутнуудын түгээмэл асуултад **сургуулийн бодит мэдээлэлд тулгуурлан**
хариулж, шаардлагатай үед яриаг сургуулийн ажилтан руу шилжүүлнэ.

---

## Онцлог

| | |
|---|---|
| 🇲🇳 | Монгол хэлээр (кирилл) харилцана |
| 📚 | `knowledge/` хавтас доторх файлууд л ботын мэдлэгийн эх сурвалж — зохиомол мэдээлэл өгөхгүй |
| 🙋 | `escalate_to_human` — яриаг Page Inbox руу шилжүүлж, ажилтанд мэдэгдэнэ |
| 📇 | `save_contact_request` — эргэн холбогдох хүсэлтийг `data/leads.jsonl`-д бүртгэнэ |
| ⚡ | Prompt caching — давтагдсан асуултын өртөг ~90% хямд |
| 🔒 | Webhook гарын үсгийн (`X-Hub-Signature-256`) шалгалт |
| 💬 | Quick replies, үндсэн цэс, "бичиж байна" индикатор |
| 🧠 | Хэрэглэгч бүрийн ярианы түүхийг санана (өгөгдмөл 60 мин) |

---

## 1. Суулгах

```bash
npm install
```

Дараа нь `.env.example`-г хуулж `.env` болгоод утгуудыг бөглөнө:

```bash
copy .env.example .env
```

Хамгийн багадаа **`ANTHROPIC_API_KEY`** байхад локал тест ажиллана.

---

## 2. Мэдлэгийн санг бөглөх (ХАМГИЙН ЧУХАЛ АЛХАМ)

`knowledge/` хавтас доторх `.md` файлууд бол ботын тархи. Одоогоор нийтэд
нээлттэй эх сурвалжаас олдсон ерөнхий мэдээлэл л орсон, бусад нь
`<!-- БӨГЛӨХ -->` тэмдэглэгээтэй хоосон байна.

| Файл | Агуулга |
|---|---|
| `00-general.md` | Сургуулийн ерөнхий танилцуулга, дэд бүтэц |
| `01-programs.md` | Хөтөлбөр, мэргэжлүүд |
| `02-admission.md` | Элсэлтийн журам, шаардлага, хугацаа |
| `03-tuition.md` | Сургалтын төлбөр, тэтгэлэг |
| `04-contact.md` | Хаяг, утас, ажлын цаг |
| `05-faq.md` | Түгээмэл асуулт-хариулт |

> ⚠️ **Төлбөр, элсэлтийн огноо, оноо** зэрэг мэдээллийг заавал сургуулийн албан
> ёсны эх сурвалжаас баталгаажуулж бөглөнө үү. Хоосон орхивол бот "мэдээлэл
> алга, утсаар лавлана уу" гэж шударгаар хариулна — буруу мэдээлэл өгөхөөс дээр.

Дэлгэрэнгүй заавар: `knowledge/HOW-TO-EDIT.txt`

---

## 3. Локал тест (Facebook хэрэггүй)

```bash
npm run chat
```

Терминалаас шууд боттой ярьж, мэдлэгийн сангаа шалгана. `reset` — түүх цэвэрлэх,
`exit` — гарах.

---

## 4. Facebook Messenger-т холбох

### 4.1 Апп үүсгэх

1. [developers.facebook.com](https://developers.facebook.com) → **My Apps** → **Create App**
2. Төрөл: **Business** → **Messenger** бүтээгдэхүүнийг нэмнэ
3. **Messenger → Settings → Access Tokens** → сургуулийн хуудсаа холбож
   **Generate token** → `.env`-ийн `FB_PAGE_ACCESS_TOKEN`-д хуулна
4. **App Settings → Basic → App Secret → Show** → `FB_APP_SECRET`-д хуулна

### 4.2 Серверийг интернэтэд гаргах

Хөгжүүлэлтийн үед [ngrok](https://ngrok.com):

```bash
npm start
```

Өөр терминалд:

```bash
ngrok http 3000
```

`https://xxxx.ngrok-free.app` гэсэн хаягийг хуулж авна.

### 4.3 Webhook бүртгэх

**Messenger → Settings → Webhooks → Add Callback URL**

- Callback URL: `https://xxxx.ngrok-free.app/webhook`
- Verify Token: `.env` доторх `FB_VERIFY_TOKEN`-той **яг адилхан** утга

**Verify and Save** дарна. Дараа нь хуудсаа сонгоод дараах талбаруудыг
захиална: `messages`, `messaging_postbacks`, `messaging_optins`,
`messaging_handovers`.

### 4.4 Цэс, товчлолуудыг тохируулах

```bash
npm run setup:messenger
```

Энэ нь "Эхлэх" товч, мэндчилгээ, үндсэн цэс, ice breakers-ийг нэг мөсөн үүсгэнэ.

### 4.5 Шалгах

Facebook хуудсандаа Messenger-ээр мессеж бичээд хариу ирэх эсэхийг харна.

> **Тэмдэглэл:** Апп нь **Development** горимд байхад зөвхөн аппын админ/тестер
> хэрэглэгчид ботыг ашиглаж чадна. Олон нийтэд нээхийн тулд `pages_messaging`
> зөвшөөрлийг App Review-д оруулж, аппаа **Live** болгоно.

---

## 5. Production-д байршуулах

Webhook-ийг тогтмол хаягтай, интернэтээс хандах боломжтой газар байршуулна
(ngrok зөвхөн хөгжүүлэлтэд).

### Сонголт A: Vercel (serverless)

Төсөл нь Vercel дээр шууд ажиллахаар бэлдсэн: `api/webhook.js` функц,
`vercel.json` тохиргоо.

**1. Redis-ээ эхлээд холбоно (ЗААВАЛ).** Serverless функцийн санах ой дуудлага
бүрт цэвэрлэгддэг тул үүнгүйгээр бот өмнөх мессежийг санахгүй, давхардсан
мессежийг шүүхгүй.

Vercel Dashboard → төсөл → **Storage** → **Upstash for Redis** → Connect.
`KV_REST_API_URL`, `KV_REST_API_TOKEN` хувьсагчид автоматаар нэмэгдэнэ.

**2. Орчны хувьсагчид.** Settings → Environment Variables:

```
ANTHROPIC_API_KEY, FB_VERIFY_TOKEN, FB_PAGE_ACCESS_TOKEN, FB_APP_SECRET
```

**3. Deploy.**

```bash
npx vercel --prod
```

(эсвэл GitHub repo-г Vercel-д холбоход push бүрт автоматаар deploy хийнэ)

**4. Шалгах.** `https://<төсөл>.vercel.app/health` руу орж `store: {"driver":"redis"}`
байгаа эсэх, `knowledge.files` тоо зөв эсэхийг хараарай.

**5. Webhook хаяг:** `https://<төсөл>.vercel.app/webhook`

> **Яагаад `waitUntil`?** Serverless функц хариу буцаасны дараа хөлддөг. Facebook
> 20 секундэд 200 хүлээдэг тул шууд 200 буцаагаад, Claude-ийн ажлыг
> `waitUntil()`-д хүлээлгэн өгснөөр функц дуустал амьд үлдэнэ.
> `vercel.json` дотор `maxDuration: 60` тавьсан.

### Сонголт B: Байнга ажиллах сервер (Railway, Render, Fly.io, VPS)

Redis шаардлагагүй — санах ойд хадгална.

1. Repo-г холбоно
2. Start command: `npm start`
3. Орчны хувьсагчид (`ANTHROPIC_API_KEY`, `FB_*`) — **`.env` файлыг хэзээ ч git-д оруулж болохгүй**
4. `NODE_ENV=production`, `LOG_LEVEL=info`
5. Webhook хаяг: `https://<домэйн>/webhook`

### Аль нь дээр вэ?

| | Vercel | Байнгын сервер |
|---|---|---|
| Үнэ | Хэрэглээгээр, идэвхгүй үед 0 | Тогтмол сарын төлбөр |
| Redis | Заавал хэрэгтэй | Шаардлагагүй |
| Эхний хариу | Хүйтэн эхлэлт ~1-2 сек удаан | Тогтмол хурдан |
| Тохируулах хялбар байдал | Дунд (Redis нэмэх) | Хялбар |

Мессенжерийн ачаалал жигд бус (өдөрт хэдэн зуун мессеж) тул **Vercel + Upstash**
хослол эдийн засгийн хувьд тохиромжтой.

### Хүн рүү шилжүүлэх (Handover Protocol)

`escalate_to_human` ажиллахын тулд:

**Messenger → Settings → Handover Protocol** дээр таны аппыг **Primary Receiver**,
**Page Inbox**-ыг **Secondary Receiver** болгоно. Тохируулаагүй бол бот
хүсэлтийг `data/escalations.jsonl`-д бүртгээд, хэрэглэгчид утсаар холбогдохыг
санал болгоно (алдаа гаргахгүй).

---

## Төслийн бүтэц

```
src/
  handler.js     ★ Үйл явдлын гол логик (Express, Vercel хоёулаа дуудна)
  claude.js      Claude API дуудлага + хэрэгслийн давталт
  prompt.js      Ботын зан чанар, дүрэм, quick replies
  knowledge.js   knowledge/*.md ачаалах, кэшлэх
  tools.js       escalate_to_human, save_contact_request
  messenger.js   Send API — текст, typing, quick replies, handover
  sessions.js    Ярианы түүх (store.js дээр суурилсан, TTL-тэй)
  store.js       KV хадгалалт — Redis (Upstash) эсвэл санах ой
  signature.js   X-Hub-Signature-256 шалгалт
  config.js      Орчны хувьсагчид
  logger.js      JSON лог
  app.js         Express апп
  server.js      Байнгын серверийн эхлэл цэг (npm start)
api/
  webhook.js     Vercel serverless функц (/webhook)
  health.js      Vercel эрүүл мэндийн шалгалт (/health)
scripts/
  chat.js             Локал терминал тест
  setup-messenger.js  Цэс, товч, мэндчилгээ тохируулах
knowledge/            ★ Ботын мэдлэгийн сан — ЭНЭ ХАВТСЫГ БӨГЛӨНӨ
vercel.json           Vercel маршрут, maxDuration, includeFiles
data/                 Ажиллах үед үүсдэг (git-д ордоггүй)
```

**Хоёр эхлэл цэг, нэг логик.** `src/handler.js` бүх ажлыг хийнэ.
`src/server.js` (Express) болон `api/webhook.js` (Vercel) зөвхөн HTTP давхаргыг
хариуцна — тиймээс аль ч платформ дээр яг ижил ажиллана.

---

## Түгээмэл асуудал

| Шинж тэмдэг | Шалтгаан / шийдэл |
|---|---|
| Webhook verify амжилтгүй | `.env`-ийн `FB_VERIFY_TOKEN` болон Facebook дээр бичсэн утга адил эсэхийг шалга. ngrok URL-ийн төгсгөлд `/webhook` байх ёстой |
| `403` буцаж, лог дээр "Гарын үсэг буруу" | `FB_APP_SECRET` буруу эсвэл дутуу |
| Бот дуугарахгүй | Хуудас апп-д захирагдсан эсэх (`npm run setup:messenger`), Development горимд тестер эсэхээ шалга |
| Хариу удаан | `BOT_EFFORT=low` эсэхийг шалга. Мэдлэгийн сан хэт том бол багасга |
| Хариулт хэт урт | `prompt.js` доторх "Хариултын хэлбэр" дүрмийг чангатга |
| Бот мэдээлэл зохиож байна | `knowledge/`-д тухайн сэдвээр тодорхой баримт нэм. Дүрэм нь баримтад байхгүй зүйлийг хориглодог |
| Мэдлэгийн сан шинэчлэгдэхгүй | Серверийг дахин асаа (Vercel дээр redeploy), эсвэл `ADMIN_TOKEN` тохируулж `POST /admin/reload` дуудна |
| **Vercel:** бот өмнөх мессежийг санахгүй | Redis холбоогүй байна. `/health` дээр `store.driver` `"memory"` гэж байвал Upstash-аа холбоно уу |
| **Vercel:** нэг мессежид 2 удаа хариулж байна | Мөн л Redis дутуу — давхардал шүүлт Redis дээр ажилладаг |
| **Vercel:** `knowledge.files: []` | `vercel.json`-ы `includeFiles` алга эсвэл `knowledge/` хавтас git-д ороогүй байна |

---

## Аюулгүй байдал, хувийн мэдээлэл

- `.env` файлыг git-д **хэзээ ч** оруулахгүй (`.gitignore`-т орсон).
- `data/` дотор хэрэглэгчийн нэр, утас хадгалагдана — энэ хавтсыг мөн git-д оруулахгүй.
- Бот хувийн мэдээлэл өөрөө шаардахгүй; зөвхөн хэрэглэгч сайн дураар өгсөн үед бүртгэнэ.
- Хэрэглэгчийн мессеж Anthropic-ийн API руу дамждаг. Оюутны мэдээлэл боловсруулах
  бол сургуулийн хувийн мэдээлэл хамгаалах журамтайгаа нийцүүлнэ үү.

---

## Ашигласан эх сурвалж

Мэдлэгийн санд урьдчилан оруулсан ерөнхий мэдээллийг дараах нийтэд нээлттэй
эх сурвалжаас авсан. Албан ёсны мэдээлэлтэй тулгаж баталгаажуулна уу:

- [Soyol-Erdem College — uniRank](https://www.unirank.org/mn/uni/soyol-erdem-college/)
- [Soyol-Erdem Institute — UniPage](https://www.unipage.net/en/26412/soyol_erdem_institute)
- [Соёл-Эрдэм дээд сургууль — vymaps](https://vymaps.com/MN/649094858571126/)
- [Соёл эрдэм дээд сургууль — Mapcarta](https://mapcarta.com/W209014023)
