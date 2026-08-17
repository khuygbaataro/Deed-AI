import { config } from './config.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[config.logLevel] ?? LEVELS.info;

function emit(level, msg, meta) {
  if (LEVELS[level] < threshold) return;
  const line = { ts: new Date().toISOString(), level, msg };
  if (meta && Object.keys(meta).length) Object.assign(line, meta);
  const out = level === 'error' || level === 'warn' ? console.error : console.log;
  out(JSON.stringify(line));
}

export const log = {
  debug: (msg, meta) => emit('debug', msg, meta),
  info: (msg, meta) => emit('info', msg, meta),
  warn: (msg, meta) => emit('warn', msg, meta),
  error: (msg, meta) => emit('error', msg, meta),
};

/** Хэрэглэгчийн PSID-г логонд бүтнээр нь бичихгүй байх */
export const maskPsid = (psid) =>
  typeof psid === 'string' && psid.length > 6 ? `${psid.slice(0, 4)}…${psid.slice(-3)}` : 'psid';
