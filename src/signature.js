import crypto from 'node:crypto';
import { config } from './config.js';

/**
 * express.json({ verify }) -д зориулсан callback.
 * Түүхий body-г хадгалж авна (гарын үсэг шалгахад заавал хэрэгтэй).
 */
export function captureRawBody(req, _res, buf) {
  req.rawBody = buf;
}

/**
 * Түүхий body болон X-Hub-Signature-256 толгойг шууд шалгана.
 * Express болон Vercel хоёулаа үүнийг ашиглана.
 * @param {Buffer|string|null|undefined} rawBody
 * @param {string|null|undefined} header жишээ: "sha256=ab12..."
 * @returns {boolean}
 */
export function verifyRawSignature(rawBody, header) {
  if (config.fb.skipSignatureCheck) return true;
  if (!header || !header.startsWith('sha256=')) return false;
  if (!config.fb.appSecret || rawBody === null || rawBody === undefined) return false;

  const expected = crypto.createHmac('sha256', config.fb.appSecret).update(rawBody).digest('hex');
  const received = header.slice('sha256='.length);

  // Урт нь зөрвөл timingSafeEqual алдаа өгнө — эхлээд шалгана
  if (received.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(received, 'utf8'), Buffer.from(expected, 'utf8'));
}

/**
 * Express хүсэлтийн гарын үсгийг шалгана.
 * @param {import('express').Request} req
 * @returns {boolean}
 */
export function verifySignature(req) {
  return verifyRawSignature(req.rawBody, req.get('x-hub-signature-256'));
}
