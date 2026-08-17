/**
 * Байнга ажилладаг серверийн эхлэл цэг (локал, VPS, Railway, Render).
 * Vercel дээр энэ файл ашиглагдахгүй — api/webhook.js ажиллана.
 */
import { createApp } from './app.js';
import { config, missingConfig } from './config.js';
import { log } from './logger.js';
import { startSessionCleanup } from './sessions.js';
import { kvDriver } from './store.js';

const missing = missingConfig();
if (missing.length) {
  log.warn('Дутуу тохиргоо байна — .env файлаа шалгана уу', { missing });
}

startSessionCleanup();

createApp().listen(config.port, () => {
  log.info('Сервер аслаа', {
    port: config.port,
    model: config.claude.model,
    store: kvDriver,
  });
});
