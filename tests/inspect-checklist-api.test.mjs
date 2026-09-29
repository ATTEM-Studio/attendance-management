import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('inspect checklist API wiring', async () => {
  await import('../build.mjs');
  const files = ['dist/admin-checklist.js','dist/api.js'];
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const lines = source.split('\n');
    const hits = lines.filter((line) => /checklist|template/i.test(line));
    console.log('\n### ' + file + '\n' + hits.slice(0, 160).join('\n'));
  }
});
