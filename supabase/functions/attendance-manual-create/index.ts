import { createClient } from '@supabase/supabase-js';
import { computeManualAttendanceMetrics, validateManualAttendanceInput } from './manual-attendance.mjs';

const H = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
};

const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth:{ persistSession:false, autoRefreshToken:false } },
);

const out = (body:unknown, status=200) => new Response(JSON.stringify(body), { status, headers:H });
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Seoul' }).format(new Date());
const hex = (buffer:ArrayBuffer) => [...new Uint8Array(buffer)].map((x) => x.toString(16).padStart(2,'0')).join('');
const sha = (value:string) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)).then(hex);

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
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();
  if (error || !data || data.role !== 'admin') return null;
  await db.from('app_sessions').update({ last_used_at:new Date().toISOString() }).eq('token_hash', tokenHash);
  return data;
}

async function rollbackCreatedAttendance(attendanceId:string) {
  await db.from('audit_logs').delete().eq('attendance_id', attendanceId);
  await db.from('attendance').delete().eq('id', attendanceId);
}

Deno.serve(async (req:Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers:H });
  if (req.method !== 'POST') return out({ error:'POST 요청만 지원합니다.' }, 405);

  try {
    const session = await requireAdmin(req);
    if (!session) return out({ error:'관리자 권한이 필요합니다.' }, 403);

    const body = await req.json().catch(() => ({}));
    const checked = validateManualAttendanceInput({ ...body, today:today() });
    if (!checked.ok) return out({ error:checked.error }, 400);
    const { employeeId, workDate, clockIn, clockOut, reason } = checked.value;

    const { data:employee, error:employeeError } = await db.from('employees').select('id').eq('id', employeeId).maybeSingle();
    if (employeeError) throw employeeError;
    if (!employee) return out({ error:'직원을 찾을 수 없습니다.' }, 404);

    const { data:existing, error:existingError } = await db
      .from('attendance')
      .select('id')
      .eq('employee_id', employeeId)
      .eq('work_date', workDate)
      .limit(1);
    if (existingError) throw existingError;
    if ((existing || []).length) return out({ error:'이미 근태 기록이 있는 날짜입니다. 기존 기록을 수정해 주세요.' }, 409);

    const { data:schedule, error:scheduleError } = await db
      .from('schedules')
      .select('scheduled_start,scheduled_end')
      .eq('employee_id', employeeId)
      .eq('work_date', workDate)
      .maybeSingle();
    if (scheduleError) throw scheduleError;

    const metrics = computeManualAttendanceMetrics({
      workDate,
      clockIn,
      clockOut,
      scheduledStart:schedule?.scheduled_start ? String(schedule.scheduled_start).slice(0,5) : '',
      scheduledEnd:schedule?.scheduled_end ? String(schedule.scheduled_end).slice(0,5) : '',
    });

    const { data:attendance, error:insertError } = await db
      .from('attendance')
      .insert({
        employee_id:employeeId,
        work_date:workDate,
        clock_in:clockIn,
        clock_out:clockOut,
        break_minutes:0,
        work_minutes:metrics.workMinutes,
        late_minutes:metrics.lateMinutes,
        early_leave_minutes:metrics.earlyLeaveMinutes,
        overtime_minutes:metrics.overtimeMinutes,
        session_no:1,
        session_type:'base',
      })
      .select('id,employee_id,work_date,clock_in,clock_out,work_minutes,late_minutes,early_leave_minutes,overtime_minutes,session_no,session_type')
      .single();
    if (insertError) throw insertError;

    const { error:auditError } = await db.from('audit_logs').insert([
      { employee_id:employeeId, attendance_id:attendance.id, field:'clock_in', previous_value:null, new_value:clockIn, changed_by:'점장', reason },
      { employee_id:employeeId, attendance_id:attendance.id, field:'clock_out', previous_value:null, new_value:clockOut, changed_by:'점장', reason },
    ]);
    if (auditError) {
      await rollbackCreatedAttendance(attendance.id);
      throw auditError;
    }

    const { error:eventError } = await db.from('attendance_events').insert([
      { employee_id:employeeId, attendance_id:attendance.id, work_date:workDate, event_type:'admin_clock_in', actor_type:'admin' },
      { employee_id:employeeId, attendance_id:attendance.id, work_date:workDate, event_type:'admin_clock_out', actor_type:'admin' },
    ]);
    if (eventError) {
      await rollbackCreatedAttendance(attendance.id);
      throw eventError;
    }

    return out({ ok:true, attendance });
  } catch (error) {
    console.error(error);
    return out({ error:'근태 기록을 추가하지 못했습니다.' }, 500);
  }
});
