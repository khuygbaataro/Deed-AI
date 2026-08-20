/**
 * AI нийлүүлэгчийн сонголт.
 *
 * AI_PROVIDER хувьсагчаар Anthropic (Claude) эсвэл OpenAI руу шилжинэ.
 * Бусад код (handler, scripts) энэ файлаас л generateReply-г дуудна —
 * нийлүүлэгч солиход тэдгээрийг өөрчлөх шаардлагагүй.
 *
 * ⚠️ Хоёр нийлүүлэгчийн ярианы түүхийн бүтэц ӨӨР. Нийлүүлэгч солигдвол
 * хуучин түүх хүчингүй болно — sessions.js үүнийг мэдэж, түүхийг цэвэрлэнэ.
 */
import { config } from './config.js';
import * as anthropic from './providers/anthropic.js';
import * as openai from './providers/openai.js';

const PROVIDERS = { anthropic, openai };

export const providerName = PROVIDERS[config.provider] ? config.provider : 'anthropic';

const active = PROVIDERS[providerName];

/**
 * @param {object} params
 * @param {Array} params.history Өмнөх ярианы messages массив
 * @param {string} params.userText Хэрэглэгчийн шинэ мессеж
 * @param {string} params.psid
 * @param {string|null} [params.userName]
 * @param {boolean} [params.offline] true бол Facebook руу юу ч илгээхгүй (локал тест)
 * @returns {Promise<{text: string, handedOver: boolean, messages: Array}>}
 */
export function generateReply(params) {
  return active.generateReply(params);
}
