/**
 * Элсэгчдийн бүртгэлийг терминал дээр харах.
 *
 *   vercel env pull .env.local     (нэг удаа — Vercel-ийн тохиргоог татна)
 *   npm run leads                  (бүртгэлийг харах)
 *   npm run leads -- --csv         (CSV файл болгож хадгалах)
 *
 * Нууц үг үүсгэх шаардлагагүй — таны Vercel нэвтрэлтээр ажиллана.
 */
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

// Vercel-ээс татсан тохиргоог эхэлж уншина
for (const file of ['.env.local', '.env']) {
  const full = path.resolve(process.cwd(), file);
  if (existsSync(full)) dotenv.config({ path: full, override: false });
}

const { listLeads, countLeads, STAGES } = await import('../src/leads.js');
const { kvDriver, kvPing } = await import('../src/store.js');

if (kvDriver !== 'redis') {
  console.error([
    '',
    '❌ Redis-ийн тохиргоо олдсонгүй.',
    '',
    'Vercel дээрх хувьсагчид "Sensitive" горимтой тул vercel env pull',
    'утгыг нь буцааж уншуулдаггүй. Хоёр сонголт:',
    '',
    '  1) Хамгийн хялбар — вэб самбар:',
    '     ADMIN_TOKEN нэмээд https://deed-ai.vercel.app/admin руу орно.',
    '',
    '  2) Энэ скриптийг ажиллуулах бол .env.local файлд Upstash-ийн',
    '     URL болон token-оо гараар бичнэ.',
    '',
  ].join(String.fromCharCode(10)));
  process.exit(1);
}

const ping = await kvPing();
if (!ping.ok) {
  console.error('\n❌ Redis хариулахгүй байна:', ping.error ?? 'тодорхойгүй алдаа', '\n');
  process.exit(1);
}

const leads = await listLeads(1000);
const total = await countLeads();

if (!leads.length) {
  console.log('\nОдоогоор бүртгэл алга. Messenger-ээр хэн нэгэн яриа эхлэхэд энд харагдана.\n');
  process.exit(0);
}

const dt = (iso) => {
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

// ─── CSV ───────────────────────────────────────────────────────
if (process.argv.includes('--csv')) {
  const cell = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [
    ['Огноо', 'Шат', 'Нэр', 'Нас', 'Утас', 'И-мэйл', 'Мэргэжил', 'Урсгал', 'Төлсөн'],
    ...leads.map((l) => [
      l.updatedAt, STAGES[l.stage] ?? l.stage, l.name, l.age, l.phone,
      l.email, l.programName, l.trackName, l.invoice?.paidAt ? 'тийм' : '',
    ]),
  ];
  const file = `elsegchid-${new Date().toISOString().slice(0, 10)}.csv`;
  writeFileSync(file, `﻿${rows.map((r) => r.map(cell).join(',')).join('\n')}`, 'utf8');
  console.log(`\n✅ ${file} файлд ${leads.length} бүртгэл хадгаллаа. Excel-ээр нээж болно.\n`);
  process.exit(0);
}

// ─── Терминал дээрх хүснэгт ────────────────────────────────────
const registered = leads.filter((l) =>
  ['contact_saved', 'invoice_created', 'paid'].includes(l.stage),
);

console.log(`\n  Нийт ${total} яриа · ${registered.length} нь нэр, утсаа өгсөн\n`);

const cols = [
  ['Огноо', 11, (l) => dt(l.updatedAt)],
  ['Шат', 18, (l) => STAGES[l.stage] ?? l.stage],
  ['Нэр', 18, (l) => l.name ?? '—'],
  ['Нас', 4, (l) => (l.age ? String(l.age) : '—')],
  ['Утас', 10, (l) => l.phone ?? '—'],
  ['Мэргэжил', 24, (l) => l.programName ?? '—'],
  ['Урсгал', 26, (l) => l.trackName ?? '—'],
];

const pad = (s, n) => {
  const str = String(s);
  return str.length > n ? `${str.slice(0, n - 1)}…` : str.padEnd(n);
};

console.log('  ' + cols.map(([h, w]) => pad(h, w)).join(' '));
console.log('  ' + cols.map(([, w]) => '─'.repeat(w)).join(' '));
for (const l of leads) {
  console.log('  ' + cols.map(([, w, get]) => pad(get(l), w)).join(' '));
}

console.log(`\n  И-мэйл, төлбөрийн дэлгэрэнгүйг CSV-ээр:  npm run leads -- --csv\n`);
