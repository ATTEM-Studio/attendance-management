import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const BASE = 'https://attendance-management-mp0va9jtl-choi18.vercel.app';
const OUT = new URL('./dist/', import.meta.url);
const BASE_FILES = [
  'styles-base-a.css',
  'styles-base-b.css',
  'styles-panels-a.css',
  'styles-panels-b.css',
  'styles-checklist.css',
  'domain.js',
  'api.js',
  'core.js',
  'staff.js',
  'admin-home.js',
  'admin-schedule.js',
  'admin-task.js',
  'admin-checklist.js',
  'admin-correction.js',
  'boot.js',
  'manifest.webmanifest',
  'icons/icon.svg',
];

async function fetchText(route = '') {
  const url = route ? `${BASE}/${route}` : `${BASE}/`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
  return response.text();
}

async function writeOut(file, content) {
  const target = path.join(OUT.pathname, file);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

for (const file of BASE_FILES) {
  await writeOut(file, await fetchText(file));
}

let index = await fetchText();
if (!index.includes('/styles-admin-redesign.css')) {
  index = index.replace('</head>', '<link rel="stylesheet" href="/styles-admin-redesign.css"></head>');
}
if (!index.includes('/admin-redesign.js')) {
  index = index.replace('<script src="/boot.js"></script>', '<script src="/admin-redesign.js"></script><script src="/boot.js"></script>');
}
await writeOut('index.html', index);

let core = await readFile(path.join(OUT.pathname, 'core.js'), 'utf8');
const adminResetLine = "  if (typeof adminHomeTab !== 'undefined') adminHomeTab = 'overview';";
const sectionResetLine = "  if (typeof adminSection !== 'undefined') adminSection = 'today';";
if (core.includes(adminResetLine) && !core.includes(sectionResetLine)) {
  core = core.replace(adminResetLine, `${adminResetLine}\n${sectionResetLine}`);
}
await writeOut('core.js', core);

await writeOut('admin-redesign.js', await readFile(new URL('./admin-redesign.js', import.meta.url), 'utf8'));
await writeOut('styles-admin-redesign.css', await readFile(new URL('./styles-admin-redesign.css', import.meta.url), 'utf8'));

const shell = [
  '/',
  ...BASE_FILES.map((file) => `/${file}`),
  '/styles-admin-redesign.css',
  '/admin-redesign.js',
];
const sw = `const CACHE='attendance-management-v28';const SHELL=${JSON.stringify(shell)};self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())));self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==CACHE).map(x=>caches.delete(x)))).then(()=>self.clients.claim())));self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;const u=new URL(e.request.url);if(u.origin!==location.origin)return;e.respondWith(fetch(e.request).then(r=>{const x=r.clone();caches.open(CACHE).then(c=>c.put(e.request,x));return r}).catch(()=>caches.match(e.request)))})\n`;
await writeOut('sw.js', sw);

console.log('Built Attendance Management v28 into dist/');
