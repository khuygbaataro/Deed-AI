/**
 * QPay merchant API (v2) — суудал баталгаажуулах хураамжийн нэхэмжлэх үүсгэнэ.
 *
 * ⚠️ ЭНЭ МОДУЛИЙГ БОДИТ ДАНСААР ТУРШИЖ ҮЗЭЭГҮЙ. QPay-ийн merchant эрх, баримт
 * бичгийн дагуу талбарын нэр, эцсийн цэг зөрж болзошгүй. Эхний нэхэмжлэхийг
 * бага дүнгээр туршиж, лог дээрх хариуг шалгана уу.
 *
 * Шаардлагатай орчны хувьсагчид:
 *   QPAY_USERNAME, QPAY_PASSWORD, QPAY_INVOICE_CODE
 *   QPAY_BASE_URL      (өгөгдмөл https://merchant.qpay.mn)
 *   PUBLIC_BASE_URL    (callback хаяг үүсгэхэд, жишээ https://deed-ai.vercel.app)
 */
import { log } from './logger.js';

const clean = (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

export const qpayConfig = {
  baseUrl: clean(process.env.QPAY_BASE_URL) || 'https://merchant.qpay.mn',
  username: clean(process.env.QPAY_USERNAME),
  password: clean(process.env.QPAY_PASSWORD),
  invoiceCode: clean(process.env.QPAY_INVOICE_CODE),
  publicBaseUrl: clean(process.env.PUBLIC_BASE_URL),
};

export const isQpayConfigured = () =>
  Boolean(qpayConfig.username && qpayConfig.password && qpayConfig.invoiceCode);

// Токеныг дуудлага хооронд кэшлэнэ (serverless дээр нэг instance-ийн дотор)
let cachedToken = null;
let cachedTokenExpiresAt = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < cachedTokenExpiresAt - 60_000) return cachedToken;

  const basic = Buffer.from(`${qpayConfig.username}:${qpayConfig.password}`).toString('base64');
  const res = await fetch(`${qpayConfig.baseUrl}/v2/auth/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`QPay auth ${res.status}: ${text.slice(0, 200)}`);

  const data = JSON.parse(text);
  if (!data.access_token) throw new Error('QPay auth: access_token ирсэнгүй');

  cachedToken = data.access_token;
  // expires_in нь секундээр ирнэ; ирээгүй бол 30 минут гэж үзнэ
  cachedTokenExpiresAt = Date.now() + (Number(data.expires_in) || 1800) * 1000;
  return cachedToken;
}

/**
 * Нэхэмжлэх үүсгэнэ.
 * @param {{senderInvoiceNo: string, receiverCode: string, amount: number, description: string}} params
 * @returns {Promise<{ok: boolean, error?: string, invoiceId?: string, qrText?: string,
 *                    shortUrl?: string|null, urls?: Array<{name: string, link: string}>}>}
 */
export async function createInvoice({ senderInvoiceNo, receiverCode, amount, description }) {
  if (!isQpayConfigured()) {
    return { ok: false, error: 'QPay тохируулаагүй байна.' };
  }

  try {
    const token = await getAccessToken();

    const body = {
      invoice_code: qpayConfig.invoiceCode,
      sender_invoice_no: String(senderInvoiceNo),
      invoice_receiver_code: String(receiverCode || 'terminal'),
      invoice_description: String(description).slice(0, 255),
      amount: Math.round(amount),
    };

    if (qpayConfig.publicBaseUrl) {
      body.callback_url =
        `${qpayConfig.publicBaseUrl.replace(/\/$/, '')}` +
        `/api/qpay-callback?invoice=${encodeURIComponent(senderInvoiceNo)}`;
    }

    const res = await fetch(`${qpayConfig.baseUrl}/v2/invoice`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const text = await res.text();
    if (!res.ok) {
      log.error('QPay нэхэмжлэх амжилтгүй', { status: res.status, body: text.slice(0, 400) });
      return { ok: false, error: `QPay ${res.status}` };
    }

    const data = JSON.parse(text);
    return {
      ok: true,
      invoiceId: data.invoice_id,
      qrText: data.qr_text ?? null,
      shortUrl: data.qPay_shortUrl ?? data.qpay_shortUrl ?? null,
      urls: Array.isArray(data.urls)
        ? data.urls.map((u) => ({ name: u.name, link: u.link })).filter((u) => u.link)
        : [],
    };
  } catch (err) {
    log.error('QPay алдаа', { error: err.message });
    return { ok: false, error: err.message };
  }
}

/**
 * Төлбөр төлөгдсөн эсэхийг шалгана.
 * @param {string} invoiceId
 */
export async function checkPayment(invoiceId) {
  if (!isQpayConfigured()) return { ok: false, error: 'QPay тохируулаагүй байна.' };

  try {
    const token = await getAccessToken();
    const res = await fetch(`${qpayConfig.baseUrl}/v2/payment/check`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        object_type: 'INVOICE',
        object_id: invoiceId,
        offset: { page_number: 1, page_limit: 100 },
      }),
    });

    const text = await res.text();
    if (!res.ok) return { ok: false, error: `QPay ${res.status}: ${text.slice(0, 200)}` };

    const data = JSON.parse(text);
    const paidAmount = Number(data.paid_amount ?? 0);
    return { ok: true, paid: paidAmount > 0, paidAmount, raw: data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
