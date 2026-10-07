const SESSION_KEY = 'attendance-management-session-v4';
const root = document.querySelector('#app');
const toast = document.querySelector('#toast');
let session = readSession();
let state = null;
let month = currentMonth();
let currentTab = 'today';
let busy = false;
let liveTimer = null;
let scheduleSelected = new Set();
let scheduleMonth = month;
let scheduleEmployeeId = '';
let scheduleStart = '09:00';
let scheduleEnd = '18:00';
let taskEmployeeId = '';
let taskDate = kstDate();
let taskEditingId = null;
let scheduleShiftType = 'other';
let checklistEditingId = null;

function readSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
}
function saveSession(value) {
  session = value;
  if (value) localStorage.setItem(SESSION_KEY, JSON.stringify(value));
  else localStorage.removeItem(SESSION_KEY);
}
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}
function icon(name, cls = '') {
  const paths = {
    clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>',
    calendar: '<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M8 3v4M16 3v4M4 9h16"/>',
    people: '<path d="M16 20v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2"/><circle cx="9.5" cy="7" r="4"/><path d="M17 11a3 3 0 0 0 0-6M21 20v-2a4 4 0 0 0-3-3.87"/>',
    task: '<path d="M9 11l2 2 4-5"/><path d="M19 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h9"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/>',
    chart: '<path d="M4 19V9M10 19V5M16 19v-8M22 19V3"/>',
    chevron: '<path d="m9 18 6-6-6-6"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    home: '<path d="m4 11 8-7 8 7v9H4Z"/><path d="M9 20v-6h6v6"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    back: '<path d="m15 18-6-6 6-6"/>',
    forward: '<path d="m9 18 6-6-6-6"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/>',
    logout: '<path d="M10 17l5-5-5-5M15 12H3"/><path d="M14 3h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
  };
  return `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.chevron}</svg>`;
}
function toastMsg(message) {
  toast.textContent = message;
  toast.classList.add('on');
  clearTimeout(toastMsg.t);
  toastMsg.t = setTimeout(() => toast.classList.remove('on'), 1800);
}
function haptic(pattern = 8) { try { navigator.vibrate?.(pattern); } catch {} }
function fmtTime(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ko-KR', { timeZone:'Asia/Seoul', hour:'2-digit', minute:'2-digit', hour12:false }).format(new Date(value));
}
function longDate(date) {
  return new Intl.DateTimeFormat('ko-KR', { timeZone:'Asia/Seoul', month:'long', day:'numeric', weekday:'short' }).format(new Date(`${date}T00:00:00+09:00`));
}
function monthTitle(value) {
  const [y, m] = value.split('-');
  return `${y}년 ${Number(m)}월`;
}
function employeeById(id) { return state?.employees?.find((e) => e.id === id); }
function scheduleFor(id, date) { return state?.schedules?.find((s) => s.employeeId === id && s.workDate === date); }
function attendanceSessionsFor(id, date) {
  return (state?.attendance || [])
    .filter((a) => a.employeeId === id && a.workDate === date)
    .sort((a, b) => Number(a.sessionNo || 1) - Number(b.sessionNo || 1));
}
function openAttendanceSessionFor(id, date) {
  return attendanceSessionsFor(id, date).find((a) => a.clockIn && !a.clockOut) || null;
}
function latestAttendanceSessionFor(id, date) {
  const sessions = attendanceSessionsFor(id, date);
  return sessions.length ? sessions[sessions.length - 1] : null;
}
function sessionLabel(attendance) {
  const n = Number(attendance?.sessionNo || 1);
  return attendance?.sessionType === 'extra' ? `추가 근무 ${Math.max(1, n - 1)}` : '기본 근무';
}
function dailyAttendanceSummary(id, date) {
  const sessions = attendanceSessionsFor(id, date);
  const open = sessions.find((a) => a.clockIn && !a.clockOut) || null;
  const completed = sessions.filter((a) => a.clockIn && a.clockOut);
  return {
    sessions,
    open,
    completed,
    totalWorkMinutes: sessions.reduce((n, a) => n + Number(a.workMinutes || 0), 0),
    hasCompleted: completed.length > 0,
    hasExtra: sessions.some((a) => a.sessionType === 'extra'),
  };
}
function attendanceFor(id, date) { return latestAttendanceSessionFor(id, date); }

function activeEmployees() { return (state?.employees || []).filter((e) => e.active); }
async function load(targetMonth = month) { state = await api.bootstrap(session.token, targetMonth); month = targetMonth; }
function loading(label = '근무 정보를') {
  clearInterval(liveTimer);
  root.innerHTML = `<main class="startup-shell native-canvas"><div class="startup-orb"></div><div class="startup-brand">근태관리</div><h1>${label}<br>불러오고 있어요.</h1><p>잠시만 기다려 주세요.</p></main>`;
}
function liveMinutes(clockIn) {
  if (!clockIn) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(clockIn).getTime()) / 60000));
}
function field({ id, label, type = 'text', value = '', placeholder = '', inputmode = '', maxlength = '', autocomplete = '', options = null, textarea = false, hint = '', extra = '' }) {
  const attrs = [
    `id="${esc(id)}"`, `class="field-control ${textarea ? 'field-textarea' : ''}"`,
    type ? `type="${esc(type)}"` : '', value !== '' ? `value="${esc(value)}"` : '', placeholder ? `placeholder="${esc(placeholder)}"` : '',
    inputmode ? `inputmode="${esc(inputmode)}"` : '', maxlength ? `maxlength="${esc(maxlength)}"` : '', autocomplete ? `autocomplete="${esc(autocomplete)}"` : '', extra,
  ].filter(Boolean).join(' ');
  let control;
  if (options) control = `<select ${attrs}>${options.map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(value) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
  else if (textarea) control = `<textarea ${attrs}>${esc(value)}</textarea>`;
  else control = `<input ${attrs}>`;
  return `<div class="field" data-field="${esc(id)}"><label for="${esc(id)}">${esc(label)}</label><div class="field-shell">${control}</div>${hint ? `<div class="field-help">${esc(hint)}</div>` : ''}<div class="field-error" id="${esc(id)}Error" aria-live="polite"></div></div>`;
}
function clearFieldErrors(scope = document) {
  scope.querySelectorAll('.field.is-error').forEach((el) => el.classList.remove('is-error'));
  scope.querySelectorAll('.field-error').forEach((el) => { el.textContent = ''; });
}
function showFieldError(id, message) {
  const control = document.getElementById(id);
  const wrap = control?.closest('.field');
  const error = document.getElementById(`${id}Error`);
  wrap?.classList.add('is-error');
  if (error) error.textContent = message;
  control?.focus({ preventScroll:false });
  control?.scrollIntoView?.({ block:'center', behavior:'smooth' });
  return false;
}
function setPending(button, pending, label = '저장 중') {
  if (!button) return;
  if (pending) {
    button.dataset.originalLabel = button.textContent;
    button.disabled = true;
    button.classList.add('is-pending');
    button.innerHTML = `<span class="spinner"></span><span>${esc(label)}</span>`;
  } else {
    button.disabled = false;
    button.classList.remove('is-pending');
    button.textContent = button.dataset.originalLabel || button.textContent;
  }
}

function loginView() {
  clearInterval(liveTimer);
  root.innerHTML = `<main class="auth-screen native-canvas">
    <section class="auth-hero">
      <div class="app-mark">${icon('clock')}</div>
      <div class="overline">근태관리</div>
      <h1>오늘의 근무를<br>간단하게 기록해요.</h1>
      <p>직원 이름과 개인 PIN으로 시작하세요.<br>이 기기에서는 로그인 상태가 유지됩니다.</p>
    </section>
    <section class="auth-form surface-card">
      ${field({ id:'loginName', label:'이름', autocomplete:'name', placeholder:'직원 이름' })}
      ${field({ id:'loginPin', label:'개인 PIN', type:'password', inputmode:'numeric', maxlength:'4', placeholder:'4자리', hint:'직원에게 발급된 4자리 PIN을 입력해 주세요.' })}
      <button class="action-button primary-action" id="loginBtn"><span>근무 화면 열기</span></button>
    </section>
    <button class="text-action admin-entry" id="adminEntry">관리자 화면으로 이동</button>
  </main>`;
  document.querySelector('#loginBtn').onclick = employeeLogin;
  document.querySelector('#loginPin').addEventListener('keydown', (e) => { if (e.key === 'Enter') employeeLogin(); });
  document.querySelector('#adminEntry').onclick = adminLogin;
}
async function employeeLogin() {
  if (busy) return;
  clearFieldErrors();
  const name = document.querySelector('#loginName').value.trim();
  const pin = document.querySelector('#loginPin').value;
  if (!name) return showFieldError('loginName', '이름을 입력해 주세요.');
  if (!/^\d{4}$/.test(pin)) return showFieldError('loginPin', 'PIN 4자리를 확인해 주세요.');
  busy = true;
  const button = document.querySelector('#loginBtn');
  setPending(button, true, '확인 중');
  try {
    const result = await api.employeeLogin(name, pin);
    saveSession({ role:'staff', employeeId:result.employee.id, token:result.token });
    loading();
    await load(currentMonth());
    renderStaff();
  } catch (e) {
    showFieldError('loginPin', e.message);
  } finally { busy = false; setPending(button, false); }
}
async function adminLogin() {
  openSheet(`<div class="sheet-heading"><div><span class="sheet-kicker">관리자</span><h2>관리자 로그인</h2><p>관리자 PIN을 입력하세요.</p></div></div>
    ${field({ id:'adminPin', label:'관리자 PIN', type:'password', inputmode:'numeric', maxlength:'4', placeholder:'4자리' })}
    <button class="action-button primary-action" id="adminLoginBtn"><span>관리자 화면 열기</span></button>`, { size:'compact' });
  document.querySelector('#adminLoginBtn').onclick = async () => {
    clearFieldErrors(document.querySelector('.glass-sheet'));
    const pin = document.querySelector('#adminPin').value;
    if (!/^\d{4}$/.test(pin)) return showFieldError('adminPin', '4자리 관리자 PIN을 입력해 주세요.');
    const button = document.querySelector('#adminLoginBtn');
    setPending(button, true, '확인 중');
    try {
      const result = await api.adminLogin(pin);
      saveSession({ role:'admin', token:result.token });
      dismissLayer(document.querySelector('.sheet-backdrop'));
      loading('관리자 화면을');
      await load(currentMonth());
      renderAdmin();
    } catch (e) { showFieldError('adminPin', e.message); }
    finally { setPending(button, false); }
  };
}
async function logout() {
  const token = session?.token;
  document.querySelectorAll('.sheet-backdrop,#panelRoot').forEach((layer) => layer.remove());
  currentTab = 'today'; resetBackNavigationState();
  if (typeof adminHomeTab !== 'undefined') adminHomeTab = 'overview';
  if (typeof adminSection !== 'undefined') adminSection = 'today';
  saveSession(null); state = null; clearInterval(liveTimer); loginView();
  if (token) api.logout(token).catch(() => {});
}
function openLogoutSheet() {
  openSheet(`<div class="sheet-heading"><div><span class="sheet-kicker">계정</span><h2>로그아웃할까요?</h2><p>이 기기의 저장된 로그인만 해제됩니다.</p></div></div><div class="sheet-actions"><button class="action-button secondary-action" data-close><span>취소</span></button><button class="action-button destructive-action" id="confirmLogout"><span>로그아웃</span></button></div>`, { size:'compact' });
  document.querySelector('#confirmLogout').onclick = logout;
}
function displayStoreName(value = state?.storeName) {
  const name = String(value || '').trim();
  const legacyMarkers = ['\uafc8\uce74\ud398','\ud558\ub2e8\uc9c0\uc810','\ud558\ub2e8\uc810'];
  return !name || legacyMarkers.some((marker) => name.includes(marker)) ? '근태관리' : name;
}

function topbar({ title = '근태관리', subtitle = displayStoreName() } = {}) {
  return `<header class="native-nav"><div class="native-nav-title"><span>${esc(subtitle)}</span><b>${esc(title)}</b></div><button class="icon-button" id="logoutBtn" aria-label="계정 메뉴">${icon('more')}</button></header>`;
}
function bottomTabs(on) {
  return `<nav class="ios-tabbar glass-surface" aria-label="직원 메뉴"><button class="tab-item ${on === 'today' ? 'is-active' : ''}" id="tabToday">${icon('home')}<span>오늘</span></button><button class="tab-item ${on === 'records' ? 'is-active' : ''}" id="tabRecords">${icon('calendar')}<span>근무기록</span></button></nav>`;
}
function bindTabs() {
  document.querySelector('#logoutBtn')?.addEventListener('click', openLogoutSheet);
  document.querySelector('#tabToday')?.addEventListener('click', async () => {
    currentTab = 'today';
    if (month !== currentMonth()) await load(currentMonth());
    renderToday();
  });
  document.querySelector('#tabRecords')?.addEventListener('click', () => { currentTab = 'records'; renderRecords(); });
}
function renderStaff() { currentTab === 'records' ? renderRecords() : renderToday(); }

