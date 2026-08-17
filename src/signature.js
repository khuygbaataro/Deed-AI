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
 * Facebook-оос ирсэн webhook-ийн X-Hub-Signature-256 толгойг шалгана.
 * @param {import('express').Request} req
 * @returns {boolean}
 */
export function verifySignature(req) {
  if (config.fb.skipSignatureCheck) return true;

  const header = req.get('x-hub-signature-256');
  if (!header || !header.startsWith('sha256=')) return false;
  if (!config.fb.appSecret || !req.rawBody) return false;

  const expected = crypto
    .createHmac('sha256', config.fb.appSecret)
    .update(req.rawBody)
    .digest('hex');

  const received = header.slice('sha256='.length);

  // Урт нь зөрвөл timingSafeEqual алдаа өгнө — эхлээд шалгана
  if (received.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(received, 'utf8'), Buffer.from(expected, 'utf8'));
}
