import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';
import { buildActiveAlerts } from './notification-core.mjs';

const H = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
};

const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth:{ persistSession:false, autoRefreshToken:false } },
);

const out = (body:unknown, status=200) => new Response(JSON.stringify(body), { status, headers:H });
const kstToday = () => new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Seoul' }).format(new Date());
const hex = (buffer:ArrayBuffer) => [...new Uint8Array(buffer)].map((x) => x.toString(16).padStart(2,'0')).join('');
const sha = (value:string) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)).then(hex);
const nowIso = () => new Date().toISOString();
const secretCache = new Map<string,string>();

async function serverSecret(vaultName:string, envName:string) {
  const env = Deno.env.get(envName) || '';
  if (env) return env;
  if (secretCache.has(vaultName)) return secretCache.get(vaultName) || '';
  const { data, error } = await db.rpc('get_attendance_notification_secret', { p_name:vaultName });
  if (error) throw error;
  const value = String(data || '');
  secretCache.set(vaultName, value);
  return value;
}

async function requireAdmin(req:Request) {
  const header = req.headers.get('authorization') || '';
  if (!header.startsWith('Bearer ')) return null;
  const raw = header.slice(7).trim();
  if (!raw) return null;
  const tokenHash = await sha(raw);
  const { data, error } = await db
    .from('app_sessions')
    .select('token_hash,role,expires_at')
    .eq('token_hash', tokenHash)
    .gt('expires_at', nowIso())
    .maybeSingle();
  if (error || !data || data.role !== 'admin') return null;
  await db.from('app_sessions').update({ last_used_at:nowIso() }).eq('token_hash', tokenHash);
  return data;
}

async function requireCron(req:Request) {
  const expected = await serverSecret('attendance_notify_cron_secret', 'ATTENDANCE_NOTIFY_CRON_SECRET');
  const actual = req.headers.get('x-cron-secret') || '';
  return Boolean(expected) && actual === expected;
}

function routeOf(req:Request) {
  const pathname = new URL(req.url).pathname.replace(/\/+$/, '');
  const marker = '/attendance-notify';
  const index = pathname.lastIndexOf(marker);
  if (index < 0) return '/';
  const suffix = pathname.slice(index + marker.length);
  return suffix || '/';
}

function mapAlertRow(row:any) {
  return {
    id:row.id,
    alertKey:row.alert_key,
    type:row.type,
    employeeId:row.employee_id,
    workDate:row.work_date,
    attendanceId:row.attendance_id,
    severity:row.severity,
    title:row.title,
    body:row.body,
    firstDetectedAt:row.first_detected_at,
    lastDetectedAt:row.last_detected_at,
  };
}

async function handleConfig(req:Request) {
  if (!(await requireAdmin(req))) return out({ error:'관리자 권한이 필요합니다.' }, 403);
  return out({ vapidPublicKey:await serverSecret('attendance_notify_vapid_public_key', 'VAPID_PUBLIC_KEY') });
}

async function handleSubscribe(req:Request) {
  if (!(await requireAdmin(req))) return out({ error:'관리자 권한이 필요합니다.' }, 403);
  const body = await req.json().catch(() => ({}));
  const endpoint = String(body?.endpoint || '').trim();
  const p256dh = String(body?.keys?.p256dh || '').trim();
  const auth = String(body?.keys?.auth || '').trim();
  const userAgent = String(body?.userAgent || '').slice(0, 500);
  if (!endpoint || !p256dh || !auth) return out({ error:'Push 구독 정보를 확인해 주세요.' }, 400);

  const stamp = nowIso();
  const { error } = await db.from('notification_subscriptions').upsert({
    endpoint,
    p256dh,
    auth,
    user_agent:userAgent,
    enabled:true,
    failure_count:0,
    updated_at:stamp,
  }, { onConflict:'endpoint' });
  if (error) throw error;
  return out({ ok:true });
}

async function handleUnsubscribe(req:Request) {
  if (!(await requireAdmin(req))) return out({ error:'관리자 권한이 필요합니다.' }, 403);
  const body = await req.json().catch(() => ({}));
  const endpoint = String(body?.endpoint || '').trim();
  if (!endpoint) return out({ error:'Push 구독 정보를 확인해 주세요.' }, 400);
  const { error } = await db.from('notification_subscriptions').update({ enabled:false, updated_at:nowIso() }).eq('endpoint', endpoint);
  if (error) throw error;
  return out({ ok:true });
}

async function handleAlerts(req:Request) {
  if (!(await requireAdmin(req))) return out({ error:'관리자 권한이 필요합니다.' }, 403);
  const { data, error } = await db
    .from('notification_alerts')
    .select('id,alert_key,type,employee_id,work_date,attendance_id,severity,title,body,first_detected_at,last_detected_at')
    .eq('status', 'open')
    .order('first_detected_at', { ascending:false });
  if (error) throw error;
  return out({ alerts:(data || []).map(mapAlertRow) });
}

async function loadDetectorInput(today:string) {
  const [employeesRes, schedulesRes, attendanceRes, tasksRes, openAlertsRes] = await Promise.all([
    db.from('employees').select('id,name,active').eq('active', true),
    db.from('schedules').select('employee_id,work_date,scheduled_start,scheduled_end').eq('work_date', today),
    db.from('attendance').select('id,employee_id,work_date,clock_in,clock_out').or(`work_date.eq.${today},clock_out.is.null`),
    db.from('task_assignments').select('id,employee_id,work_date,source_type,required,status').eq('work_date', today).eq('source_type', 'checklist'),
    db.from('notification_alerts').select('id,alert_key,push_sent_at,status').eq('status', 'open'),
  ]);
  for (const result of [employeesRes, schedulesRes, attendanceRes, tasksRes, openAlertsRes]) {
    if (result.error) throw result.error;
  }
  return {
    employees:(employeesRes.data || []).map((row:any) => ({ id:row.id, name:row.name, active:row.active })),
    schedules:(schedulesRes.data || []).map((row:any) => ({ employeeId:row.employee_id, workDate:row.work_date, scheduledStart:String(row.scheduled_start).slice(0,5), scheduledEnd:String(row.scheduled_end).slice(0,5) })),
    attendance:(attendanceRes.data || []).map((row:any) => ({ id:row.id, employeeId:row.employee_id, workDate:row.work_date, clockIn:row.clock_in, clockOut:row.clock_out })),
    tasks:(tasksRes.data || []).map((row:any) => ({ id:row.id, employeeId:row.employee_id, workDate:row.work_date, sourceType:row.source_type, required:row.required, status:row.status })),
    openAlerts:openAlertsRes.data || [],
  };
}

async function sendAlertPush(alert:any, subscriptions:any[]) {
  const [publicKey, privateKey] = await Promise.all([
    serverSecret('attendance_notify_vapid_public_key', 'VAPID_PUBLIC_KEY'),
    serverSecret('attendance_notify_vapid_private_key', 'VAPID_PRIVATE_KEY'),
  ]);
  if (!publicKey || !privateKey) return { delivered:0, attempted:0 };

  webpush.setVapidDetails('https://attendance-management-choi18.vercel.app', publicKey, privateKey);
  const payload = JSON.stringify({
    title:alert.title,
    body:alert.body,
    type:alert.type,
    alertId:alert.id,
    employeeId:alert.employee_id,
    workDate:alert.work_date,
  });

  let delivered = 0;
  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification({ endpoint:subscription.endpoint, keys:{ p256dh:subscription.p256dh, auth:subscription.auth } }, payload);
      delivered += 1;
      await db.from('notification_subscriptions').update({ failure_count:0, last_success_at:nowIso(), updated_at:nowIso() }).eq('id', subscription.id);
    } catch (error:any) {
      const status = Number(error?.statusCode || error?.status || 0);
      if (status === 404 || status === 410) {
        await db.from('notification_subscriptions').update({ enabled:false, updated_at:nowIso() }).eq('id', subscription.id);
      } else {
        await db.from('notification_subscriptions').update({ failure_count:Number(subscription.failure_count || 0) + 1, updated_at:nowIso() }).eq('id', subscription.id);
      }
      console.error('push failed', subscription.id, status || error?.message || error);
    }
  }
  return { delivered, attempted:subscriptions.length };
}

async function handleScan(req:Request) {
  if (!(await requireCron(req))) return out({ error:'허용되지 않은 스캔 요청입니다.' }, 403);
  const body = await req.json().catch(() => ({}));
  const dryRun = body?.dryRun === true;
  const today = kstToday();
  const input = await loadDetectorInput(today);
  const detected = buildActiveAlerts({
    now:new Date().toISOString(),
    schedules:input.schedules,
    attendance:input.attendance,
    tasks:input.tasks,
    employees:input.employees,
  });

  if (dryRun) return out({ ok:true, dryRun:true, detected, created:0, resolved:0, pushed:0 });

  const stamp = nowIso();
  const previousOpenKeys = new Set(input.openAlerts.map((row:any) => row.alert_key));
  const created = detected.filter((row:any) => !previousOpenKeys.has(row.alertKey)).length;
  let resolved = 0;

  if (detected.length) {
    const payload = detected.map((row:any) => ({
      alert_key:row.alertKey,
      type:row.type,
      employee_id:row.employeeId,
      work_date:row.workDate,
      attendance_id:row.attendanceId,
      severity:row.severity,
      title:row.title,
      body:row.body,
      status:'open',
      last_detected_at:stamp,
      resolved_at:null,
    }));
    const { error } = await db.from('notification_alerts').upsert(payload, { onConflict:'alert_key' });
    if (error) throw error;
  }

  const detectedKeys = new Set(detected.map((row:any) => row.alertKey));
  const resolveIds = input.openAlerts.filter((row:any) => !detectedKeys.has(row.alert_key)).map((row:any) => row.id);
  if (resolveIds.length) {
    const { error } = await db.from('notification_alerts').update({ status:'resolved', resolved_at:stamp, last_detected_at:stamp }).in('id', resolveIds);
    if (error) throw error;
    resolved = resolveIds.length;
  }

  const [{ data:pendingPush, error:pushAlertError }, { data:subscriptions, error:subscriptionsError }] = await Promise.all([
    db.from('notification_alerts').select('id,alert_key,type,employee_id,work_date,attendance_id,severity,title,body,push_sent_at').eq('status', 'open').is('push_sent_at', null),
    db.from('notification_subscriptions').select('id,endpoint,p256dh,auth,failure_count').eq('enabled', true),
  ]);
  if (pushAlertError) throw pushAlertError;
  if (subscriptionsError) throw subscriptionsError;

  let pushed = 0;
  for (const alert of pendingPush || []) {
    const result = await sendAlertPush(alert, subscriptions || []);
    pushed += result.delivered;
    if (result.attempted > 0) {
      const { error } = await db.from('notification_alerts').update({ push_sent_at:nowIso() }).eq('id', alert.id);
      if (error) throw error;
    }
  }

  return out({ ok:true, dryRun:false, detected:detected.length, created, resolved, pushed });
}

Deno.serve(async (req:Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers:H });
  const route = routeOf(req);
  try {
    if (route === '/config' && req.method === 'GET') return await handleConfig(req);
    if (route === '/subscribe' && req.method === 'POST') return await handleSubscribe(req);
    if (route === '/unsubscribe' && req.method === 'POST') return await handleUnsubscribe(req);
    if (route === '/alerts' && req.method === 'GET') return await handleAlerts(req);
    if (route === '/scan' && req.method === 'POST') return await handleScan(req);
    return out({ error:'지원하지 않는 경로입니다.' }, 404);
  } catch (error) {
    console.error(error);
    return out({ error:'알림 처리 중 오류가 발생했습니다.' }, 500);
  }
});
