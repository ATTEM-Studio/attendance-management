import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('inspect staff load and schedule APIs', async () => {
  await import('../build.mjs');
  for (const file of ['dist/api.js','dist/staff.js','dist/core.js']) {
    const source = await readFile(file,'utf8');
    const lines = source.split('\n');
    const hits=[];
    lines.forEach((line,index)=>{
      if (/load\(|schedule|attendance|renderStaff|state\s*=|month/i.test(line)) {
        hits.push(lines.slice(Math.max(0,index-2),Math.min(lines.length,index+6)).join('\n'));
      }
    });
    console.log('\n### '+file+'\n'+hits.slice(0,120).join('\n---\n'));
  }
});
