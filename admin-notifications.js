/* Admin Web Push notifications */
const ADMIN_NOTIFY_BASE = 'https://ndczsguqlwyiuqvsmvcb.supabase.co/functions/v1/attendance-notify';
const ADMIN_PUSH_TYPES = new Set(['missing_clock_in','missing_clock_out','stale_open','required_checklist']);
const ADMIN_ALERT_DESTINATION_KEY = 'attendance-admin-alert-destination';

let adminServerAlerts = [];
let adminNotificationSubscription = null;
let adminNotificationBusy = false;

if (typeof api !== 'undefined' && typeof externalRequest === 'function') {
  api.notificationConfig = (token) => externalRequest(`${ADMIN_NOTIFY_BASE}/config`, { token });
  api.notificationAlerts = (token) => externalRequest(`${ADMIN_NOTIFY_BASE}/alerts`, { token });
  api.notificationSubscribe = (token, body) => externalRequest(`${ADMIN_NOTIFY_BASE}/subscribe`, { method:'POST', token, body });
  api.notificationUnsubscribe = (token, body) => externalRequest(`${ADMIN_NOTIFY_BASE}/unsubscribe`, { method:'POST', token, body });
}

function adminNotificationSupport() {
  const supported = typeof window !== 'undefined' && typeof navigator !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const isIOS = typeof navigator !== 'undefined' && (/iPad|iPhone|iPod/.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
  const installed = typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches === true || navigator.standalone === true);
  return { supported, installed, isIOS, permission:supported ? Notification.permission : 'unsupported' };
}

function vapidKeyBytes(value) {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}

function notificationAttentionKey(item) {
  if (!item?.type || !item?.employeeId || !item?.workDate) return '';
  return `${item.type}:${item.employeeId}:${item.workDate}`;
}

function mergeAdminAttention(localAttention = [], serverAlerts = []) {
  const normalizedServer = serverAlerts.map((row) => ({
    alertId:row.id,
    employeeId:row.employeeId,
    type:row.type,
    workDate:row.workDate,
    tone:row.severity === 'danger' ? 'danger' : 'warning',
    title:row.title,
    detail:row.body,
    server:true,
  }));
  const serverKeys = new Set(normalizedServer.filter((row) => ADMIN_PUSH_TYPES.has(row.type)).map(notificationAttentionKey));
  const local = localAttention.filter((row) => {
    const key = notificationAttentionKey(row);
    return !key || !ADMIN_PUSH_TYPES.has(row.type) || !serverKeys.has(key);
  });
  return [...normalizedServer, ...local];
}

async function refreshAdminServerAlerts() {
  if (session?.role !== 'admin' || !api?.notificationAlerts) {
    adminServerAlerts = [];
    return adminServerAlerts;
  }
  try {
    const result = await api.notificationAlerts(session.token);
    adminServerAlerts = Array.isArray(result?.alerts) ? result.alerts : [];
  } catch (error) {
    console.warn('notification alerts unavailable', error);
  }
  return adminServerAlerts;
}

function adminNotificationCardMarkup() {
  const support = adminNotificationSupport();
  if (!support.supported) {
    return `<section class="admin-side-card admin-notification-card" data-admin-notification-card><div><span>관리자 알림</span><h3>이 기기에서는 Push 알림을 사용할 수 없어요</h3><p>앱 안의 확인 필요 항목은 계속 사용할 수 있습니다.</p></div></section>`;
  }
  if (support.isIOS && !support.installed) {
    return `<section class="admin-side-card admin-notification-card" data-admin-notification-card><div><span>관리자 알림</span><h3>홈 화면에 추가하면 알림을 받을 수 있어요</h3><p>Safari 공유 메뉴 → 홈 화면에 추가 → 설치된 근태관리 앱에서 알림을 켜 주세요.</p></div></section>`;
  }
  if (support.permission === 'denied') {
    return `<section class="admin-side-card admin-notification-card" data-admin-notification-card><div><span>관리자 알림</span><h3>알림 권한이 꺼져 있어요</h3><p>브라우저 또는 기기 설정에서 근태관리 알림을 허용해 주세요.</p></div></section>`;
  }
  if (adminNotificationSubscription) {
    return `<section class="admin-side-card admin-notification-card is-enabled" data-admin-notification-card><div><span>관리자 알림</span><h3>알림 사용 중</h3><p>출근·퇴근 누락 등 확인이 필요한 근태를 알려드려요.</p></div><button class="admin-notification-secondary" id="disableAdminNotifications" ${adminNotificationBusy ? 'disabled' : ''}>끄기</button></section>`;
  }
  return `<section class="admin-side-card admin-notification-card" data-admin-notification-card><div><span>관리자 알림</span><h3>출근·퇴근 누락 알림을 받아보세요</h3><p>앱을 열어두지 않아도 확인이 필요한 근태를 알려드립니다.</p></div><button class="action-button primary-action admin-notification-enable" id="enableAdminNotifications" ${adminNotificationBusy ? 'disabled' : ''}><span>${adminNotificationBusy ? '설정 중' : '알림 켜기'}</span></button></section>`;
}

function replaceAdminNotificationCard() {
  const current = document.querySelector('[data-admin-notification-card]');
  if (!current) return;
  current.outerHTML = adminNotificationCardMarkup();
  bindAdminNotificationCard();
}

function bindAdminNotificationCard() {
  document.querySelector('#enableAdminNotifications')?.addEventListener('click', enableAdminNotifications);
  document.querySelector('#disableAdminNotifications')?.addEventListener('click', disableAdminNotifications);
}

async function enableAdminNotifications() {
  if (adminNotificationBusy || session?.role !== 'admin') return;
  const support = adminNotificationSupport();
  if (!support.supported) return toastMsg('이 기기에서는 Push 알림을 사용할 수 없습니다.');
  if (support.isIOS && !support.installed) return toastMsg('홈 화면에 추가한 근태관리 앱에서 알림을 켜 주세요.');
  if (Notification.permission === 'denied') return replaceAdminNotificationCard();

  adminNotificationBusy = true;
  replaceAdminNotificationCard();
  try {
    const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (permission !== 'granted') return;
    const registration = await navigator.serviceWorker.ready;
    const config = await api.notificationConfig(session.token);
    if (!config?.vapidPublicKey) throw new Error('알림 설정을 불러오지 못했습니다.');
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey:vapidKeyBytes(config.vapidPublicKey) });
    }
    const json = subscription.toJSON();
    await api.notificationSubscribe(session.token, {
      endpoint:subscription.endpoint,
      keys:{ p256dh:json.keys?.p256dh || '', auth:json.keys?.auth || '' },
      userAgent:navigator.userAgent || '',
    });
    adminNotificationSubscription = subscription;
    toastMsg('관리자 알림을 켰어요.');
  } catch (error) {
    toastMsg(error?.message || '관리자 알림을 켜지 못했습니다.');
  } finally {
    adminNotificationBusy = false;
    replaceAdminNotificationCard();
  }
}

async function disableAdminNotifications() {
  if (adminNotificationBusy || session?.role !== 'admin') return;
  adminNotificationBusy = true;
  replaceAdminNotificationCard();
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await api.notificationUnsubscribe(session.token, { endpoint:subscription.endpoint });
      await subscription.unsubscribe();
    }
    adminNotificationSubscription = null;
    toastMsg('이 기기의 관리자 알림을 껐어요.');
  } catch (error) {
    toastMsg(error?.message || '알림을 끄지 못했습니다.');
  } finally {
    adminNotificationBusy = false;
    replaceAdminNotificationCard();
  }
}

async function initAdminNotifications() {
  if (session?.role !== 'admin') return;
  const support = adminNotificationSupport();
  if (support.supported) {
    try {
      const registration = await navigator.serviceWorker.ready;
      adminNotificationSubscription = await registration.pushManager.getSubscription();
    } catch {
      adminNotificationSubscription = null;
    }
  }
  replaceAdminNotificationCard();
  await refreshAdminServerAlerts();
}
