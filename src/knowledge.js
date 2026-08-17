import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { log } from './logger.js';

let cache = null;

/**
 * knowledge/ хавтсыг олох.
 * Serverless орчинд (Vercel) ажлын хавтас өөр байж болзошгүй тул
 * хэд хэдэн байрлалыг дараалан шалгана.
 */
async function resolveKnowledgeDir() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(process.cwd(), config.knowledgeDir),
    path.resolve(here, '..', config.knowledgeDir),
    path.resolve(here, '..', '..', config.knowledgeDir),
  ];

  for (const dir of candidates) {
    try {
      const info = await stat(dir);
      if (info.isDirectory()) return dir;
    } catch {
      // дараагийнхыг шалгана
    }
  }
  return candidates[0];
}

/**
 * knowledge/ хавтас доторх бүх .md файлыг нэрийн дарааллаар нэгтгэж уншина.
 * Үр дүнг санах ойд хадгална (reloadKnowledge() -ээр шинэчилнэ).
 * @returns {Promise<{text: string, files: string[], bytes: number}>}
 */
export async function loadKnowledge() {
  if (cache) return cache;

  const dir = await resolveKnowledgeDir();
  let entries = [];
  try {
    entries = (await readdir(dir)).filter((f) => f.toLowerCase().endsWith('.md')).sort();
  } catch (err) {
    log.error('knowledge хавтсыг уншиж чадсангүй', { dir, error: err.message });
    cache = { text: '', files: [], bytes: 0 };
    return cache;
  }

  const parts = [];
  for (const file of entries) {
    const full = path.join(dir, file);
    const info = await stat(full);
    if (!info.isFile()) continue;
    const body = (await readFile(full, 'utf8')).trim();
    if (!body) continue;
    parts.push(`<баримт файл="${file}">\n${body}\n</баримт>`);
  }

  const text = parts.join('\n\n');
  cache = { text, files: entries, bytes: Buffer.byteLength(text, 'utf8') };
  log.info('Мэдлэгийн сан ачаалагдлаа', { files: entries.length, bytes: cache.bytes });
  return cache;
}

/** Мэдлэгийн санг дахин уншуулах (файл засварласны дараа) */
export function reloadKnowledge() {
  cache = null;
  return loadKnowledge();
}
