/**
 * Локал тест: Facebook-гүйгээр ботыг терминалаас шалгах.
 *   npm run chat
 * Зөвхөн ANTHROPIC_API_KEY шаардлагатай.
 */
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { config, missingConfig } from '../src/config.js';
import { generateReply } from '../src/claude.js';
import { loadKnowledge } from '../src/knowledge.js';
import { GREETING } from '../src/prompt.js';

const missing = missingConfig({ requireFacebook: false });
if (missing.length) {
  console.error(`Дутуу тохиргоо: ${missing.join(', ')}\n.env файлаа шалгана уу.`);
  process.exit(1);
}

const kb = await loadKnowledge();
console.log('─'.repeat(60));
console.log(`Мэдлэгийн сан: ${kb.files.length} файл, ${(kb.bytes / 1024).toFixed(1)} KB`);
console.log(`Загвар: ${config.claude.model} (effort: ${config.claude.effort})`);
console.log('Гарахдаа "exit" эсвэл Ctrl+C дарна уу. Түүх цэвэрлэх: "reset"');
console.log('─'.repeat(60));
console.log(`\nБот: ${GREETING}\n`);

const rl = readline.createInterface({ input: stdin, output: stdout });
let history = [];

for (;;) {
  const input = (await rl.question('Та: ')).trim();
  if (!input) continue;
  if (['exit', 'quit', 'гарах'].includes(input.toLowerCase())) break;
  if (input.toLowerCase() === 'reset') {
    history = [];
    console.log('\n[түүх цэвэрлэгдлээ]\n');
    continue;
  }

  const started = Date.now();
  const result = await generateReply({
    history,
    userText: input,
    psid: 'local-test-user',
    offline: true,
  });
  history = result.messages;

  console.log(`\nБот: ${result.text}`);
  console.log(`  [${((Date.now() - started) / 1000).toFixed(1)}с]\n`);
}

rl.close();
