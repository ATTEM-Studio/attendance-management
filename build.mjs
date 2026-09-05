import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const BASE = 'https://attendance-management-mp0va9jtl-choi18.vercel.app';
const OUT = new URL('./dist/', import.meta.url);
const PRODUCT_NAME = '근태관리';
const PRODUCT_DESCRIPTION = '직원 근무 일정과 출퇴근을 관리하는 근태관리 시스템';
const LEGACY_REPLACEMENTS = [
  ['\uafc8\uce74\ud398 \u00b7 \uadfc\ud0dc\uae30\ub85d\ubd80', PRODUCT_NAME],
  ['\uafc8\uce74\ud398 \ud558\ub2e8\uc9c0\uc810', PRODUCT_NAME],
  ['\uafc8\uce74\ud398 \ud558\ub2e8\uc810', PRODUCT_NAME],
  ['\uafc8\uce74\ud398', PRODUCT_NAME],
  ['\ud558\ub2e8\uc9c0\uc810', '매장'],
  ['\ud558\ub2e8\uc810', '매장'],
  ['근태기록부', PRODUCT_NAME],
];
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

function neutralizeLegacyBranding(content) {
  return LEGACY_REPLACEMENTS.reduce((result, [legacy, replacement]) => result.replaceAll(legacy, replacement), content);
}

function neutralizeRuntimeStoreNameReferences(content) {
  return content
    .replaceAll("esc(state?.storeName || '근태관리')", 'esc(displayStoreName())')
    .replaceAll('esc(state.storeName)', 'esc(displayStoreName())')
    .replaceAll("state?.storeName || '근태관리'", 'displayStoreName()');
}

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
  let content = neutralizeLegacyBranding(await fetchText(file));
  if (file.endsWith('.js')) content = neutralizeRuntimeStoreNameReferences(content);
  if (file === 'manifest.webmanifest') {
    const manifest = JSON.parse(content);
    manifest.name = PRODUCT_NAME;
    manifest.short_name = PRODUCT_NAME;
    manifest.description = PRODUCT_DESCRIPTION;
    content = `${JSON.stringify(manifest, null, 2)}\n`;
  }
  await writeOut(file, content);
}

let index = neutralizeLegacyBranding(await fetchText());
index = index
  .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${PRODUCT_DESCRIPTION}">`)
  .replace(/<meta name="apple-mobile-web-app-title" content="[^"]*">/, `<meta name="apple-mobile-web-app-title" content="${PRODUCT_NAME}">`)
  .replace(/<title>[^<]*<\/title>/, `<title>${PRODUCT_NAME}</title>`);
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
const storeNameHelper = `function displayStoreName(value = state?.storeName) {\n  const name = String(value || '').trim();\n  const legacyMarkers = ['\\uafc8\\uce74\\ud398','\\ud558\\ub2e8\\uc9c0\\uc810','\\ud558\\ub2e8\\uc810'];\n  return !name || legacyMarkers.some((marker) => name.includes(marker)) ? '${PRODUCT_NAME}' : name;\n}\n`;
if (!core.includes('function displayStoreName(')) {
  core = core.replace('function topbar(', `${storeNameHelper}\nfunction topbar(`);
}
await writeOut('core.js', core);

let adminRedesign = neutralizeLegacyBranding(await readFile(new URL('./admin-redesign.js', import.meta.url), 'utf8'));
adminRedesign = neutralizeRuntimeStoreNameReferences(adminRedesign);
await writeOut('admin-redesign.js', adminRedesign);
await writeOut('styles-admin-redesign.css', await readFile(new URL('./styles-admin-redesign.css', import.meta.url), 'utf8'));

const shell = [
  '/',
  ...BASE_FILES.map((file) => `/${file}`),
  '/styles-admin-redesign.css',
  '/admin-redesign.js',
];
const sw = `const CACHE='attendance-management-v28-generic';const SHELL=${JSON.stringify(shell)};self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())));self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==CACHE).map(x=>caches.delete(x)))).then(()=>self.clients.claim())));self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;const u=new URL(e.request.url);if(u.origin!==location.origin)return;e.respondWith(fetch(e.request).then(r=>{const x=r.clone();caches.open(CACHE).then(c=>c.put(e.request,x));return r}).catch(()=>caches.match(e.request)))})\n`;
await writeOut('sw.js', sw);

console.log('Built generic Attendance Management v28 into dist/');
