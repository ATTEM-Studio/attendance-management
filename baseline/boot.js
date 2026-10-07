function openSheet(content, { size = '' } = {}) {
  document.querySelector('.sheet-backdrop')?.remove();
  const wrap = document.createElement('div');
  wrap.className = 'sheet-backdrop';
  wrap.innerHTML = `<section class="glass-sheet glass-surface ${size}" role="dialog" aria-modal="true"><div class="sheet-handle"></div>${content}</section>`;
  document.body.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add('is-open'));
  bindClose(wrap);
  wrap.onclick = (e) => { if (e.target === wrap) dismissLayer(wrap); };
  return wrap;
}
function openPanel(content) {
  document.querySelector('#panelRoot')?.remove();
  const wrap = document.createElement('div');
  wrap.className = 'panel-backdrop'; wrap.id = 'panelRoot';
  wrap.innerHTML = `<section class="panel-root glass-surface" role="dialog" aria-modal="true">${content}</section>`;
  document.body.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add('is-open'));
  bindClose(wrap);
  return wrap;
}
function dismissLayer(layer) {
  if (!layer) return;
  layer.classList.add('is-closing');
  setTimeout(() => layer.remove(), 190);
}
async function closePanel() {
  const panel = document.querySelector('#panelRoot');
  dismissLayer(panel);
  if (session?.role === 'admin' && month !== currentMonth()) {
    try { await load(currentMonth()); renderAdmin(); } catch (e) { toastMsg(e.message); }
  }
}
function bindClose(scope) {
  scope.querySelectorAll('[data-close]').forEach((button) => {
    button.onclick = () => scope.id === 'panelRoot' ? closePanel() : dismissLayer(scope);
  });
}

async function boot() {
  if (!session) return loginView();
  loading();
  try { await load(currentMonth()); session.role === 'admin' ? renderAdmin() : renderStaff(); }
  catch (e) { saveSession(null); loginView(); toastMsg(e.message); }
}
window.addEventListener('error', (e) => {
  console.error(e.error || e.message);
  if (!root.innerHTML.trim()) root.innerHTML = '<div class="error-box"><h2>화면을 불러오지 못했습니다.</h2><p>브라우저를 새로고침해 주세요.</p></div>';
});
window.addEventListener('unhandledrejection', (e) => console.error(e.reason));
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(console.error);

const APP_HISTORY_ROOT = 'attendance-management-root-v20';
const APP_HISTORY_GUARD = 'attendance-management-guard-v20';
let backNavigationReady = false;
let backExitPromptAt = 0;
let backExitAllowed = false;

function pushBackGuard() {
  history.pushState({ attendanceManagement:APP_HISTORY_GUARD }, '', location.href);
}
function resetBackNavigationState() {
  backExitPromptAt = 0;
  backExitAllowed = false;
}
function installMobileBackNavigation() {
  if (backNavigationReady) return;
  backNavigationReady = true;
  if (history.state?.attendanceManagement !== APP_HISTORY_GUARD) {
    history.replaceState({ attendanceManagement:APP_HISTORY_ROOT }, '', location.href);
    pushBackGuard();
  }
  window.addEventListener('popstate', handleMobileBack);
}
function closeInternalViewForBack() {
  const sheet = document.querySelector('.sheet-backdrop:not(.is-closing)');
  if (sheet) {
    dismissLayer(sheet);
    return true;
  }
  const panel = document.querySelector('#panelRoot:not(.is-closing)');
  if (panel) {
    closePanel();
    return true;
  }
  if (session?.role === 'staff' && currentTab === 'records') {
    currentTab = 'today';
    if (month !== currentMonth()) {
      load(currentMonth()).then(renderToday).catch((e) => toastMsg(e.message));
    } else {
      renderToday();
    }
    return true;
  }
  return false;
}
function openExitConfirmSheet() {
  openSheet(`<div class="sheet-heading"><div><span class="sheet-kicker danger-kicker">앱 종료</span><h2>앱을 종료하시겠습니까?</h2><p>종료하면 현재 로그인 상태는 유지되고 앱 화면만 닫힙니다.</p></div></div><div class="sheet-actions"><button class="action-button secondary-action" data-close><span>계속 사용</span></button><button class="action-button destructive-action" id="confirmAppExit"><span>종료</span></button></div>`, { size:'compact' });
  document.querySelector('#confirmAppExit').onclick = confirmAppExit;
}
function confirmAppExit() {
  backExitAllowed = true;
  document.querySelectorAll('.sheet-backdrop,#panelRoot').forEach((layer) => layer.remove());
  history.back();
}
function releaseBackGuardAndExit() {
  backExitAllowed = false;
  backNavigationReady = false;
  window.removeEventListener('popstate', handleMobileBack);
  setTimeout(() => {
    try { window.close(); } catch {}
    history.back();
    setTimeout(() => {
      if (document.visibilityState === 'visible') toastMsg('기기 뒤로가기를 한 번 누르면 종료됩니다.');
    }, 450);
  }, 0);
}
function handleMobileBack() {
  if (backExitAllowed) {
    releaseBackGuardAndExit();
    return;
  }
  if (closeInternalViewForBack()) {
    resetBackNavigationState();
    pushBackGuard();
    return;
  }
  const now = Date.now();
  if (backExitPromptAt && now - backExitPromptAt <= 2000) {
    backExitPromptAt = 0;
    openExitConfirmSheet();
    pushBackGuard();
    return;
  }
  backExitPromptAt = now;
  toastMsg('뒤로가기를 한 번 더 누르면 종료 확인창이 열립니다.');
  pushBackGuard();
}
window.addEventListener('pageshow', () => {
  if (!backNavigationReady) installMobileBackNavigation();
});
installMobileBackNavigation();

boot();
