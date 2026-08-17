/**
 * QPay төлбөрийн callback.
 * Маршрут: /api/qpay-callback?invoice=SEDS-...
 *
 * ⚠️ Аюулгүй байдал: энэ хаяг нийтэд нээлттэй тул callback ирсэн гэдгээр
 * төлбөрийг төлөгдсөн гэж ҮЗЭХГҮЙ. QPay-ийн API-аар эргэж шалгаж байж
 * бүртгэлийг өөрчилнө.
 */
import { kvGet } from '../src/store.js';
import { getLead, saveLead } from '../src/leads.js';
import { checkPayment } from '../src/qpay.js';
import { sendText } from '../src/messenger.js';
import { formatMnt } from '../src/admissions.js';
import { log, maskPsid } from '../src/logger.js';

async function handle(request) {
  const url = new URL(request.url);
  const senderInvoiceNo = url.searchParams.get('invoice');

  if (!senderInvoiceNo) {
    return Response.json({ ok: false, error: 'invoice параметр алга' }, { status: 400 });
  }

  const mapping = await kvGet(`invoice:${senderInvoiceNo}`);
  if (!mapping?.psid) {
    log.warn('QPay callback: нэхэмжлэх олдсонгүй', { senderInvoiceNo });
    return Response.json({ ok: false, error: 'not found' }, { status: 404 });
  }

  // Төлбөрийг QPay-ээс эргэж баталгаажуулна
  const verified = await checkPayment(mapping.invoiceId);
  if (!verified.ok) {
    log.error('QPay шалгалт амжилтгүй', { senderInvoiceNo, error: verified.error });
    return Response.json({ ok: false, error: 'verification failed' }, { status: 502 });
  }

  if (!verified.paid) {
    log.info('QPay callback ирсэн ч төлбөр баталгаажаагүй', { senderInvoiceNo });
    return Response.json({ ok: true, paid: false });
  }

  const lead = await getLead(mapping.psid);
  if (lead.invoice?.paidAt) {
    return Response.json({ ok: true, paid: true, duplicate: true });
  }

  await saveLead(mapping.psid, {
    stage: 'paid',
    invoice: { ...(lead.invoice ?? {}), paidAt: new Date().toISOString(), paidAmount: verified.paidAmount },
  });

  log.info('Төлбөр амжилттай', {
    psid: maskPsid(mapping.psid),
    amount: verified.paidAmount,
  });

  try {
    await sendText(
      mapping.psid,
      `Төлбөр амжилттай хүлээн авлаа ✅ (${formatMnt(verified.paidAmount)})\n\n` +
        'Таны суудал баталгаажлаа. Элсэлтийн алба удахгүй тантай холбогдож, ' +
        'бүрдүүлэх бичиг баримтын талаар мэдээлэл өгнө.',
    );
  } catch (err) {
    log.warn('Төлбөрийн баталгаажуулалтыг илгээж чадсангүй', { error: err.message });
  }

  return Response.json({ ok: true, paid: true });
}

export const GET = handle;
export const POST = handle;
