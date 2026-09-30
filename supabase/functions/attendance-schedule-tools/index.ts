import { createClient } from '@supabase/supabase-js';
import { buildMissingChecklistRows, validateExtraScheduleInput } from './schedule-tools.mjs';

const H = {
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, apikey, content-type',
  'Access-Control-Allow-Methods':'GET, POST, OPTIONS',
  'Content-Type':'application/json; charset=utf-8',
};

const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth:{persistSession:false,autoRefreshToken:false} },
);

const out = (body:unknown,status=200) => new Response(JSON.stringify(body),{status,headers:H});
const today = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul'}).format(new Date());
const monthOf = (date:string) => String(date || '').slice(0,7);
const monthRange = (month:string) => {
  const safe = /^\d{4}-\d{2}$/.test(month) ? month : monthOf(today());
  const [y,m] = safe.split('-').map(Number);
  const next = m === 12 ? `${y+1}-01-01` : `${y}-${String(m+1).padStart(2,'0')}-01`;
  return { start:`${safe}-01`, next };
};
const hex = (buffer:ArrayBuffer) => [...new Uint8Array(buffer)].map((x)=>x.toString(16).padStart(2,'0')).join('');
const sha = (value:string) => crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)).then(hex);

async function requireSession(req:Request) {
  const header=req.headers.get('authorization') || '';
  if (!header.startsWith('Bearer ')) return null;
  const raw=header.slice(7).trim();
  if (!raw) return null;
  const tokenHash=await sha(raw);
  const {data,error}=await db.from('app_sessions')
    .select('token_hash,role,employee_id,expires_at')
    .eq('token_hash',tokenHash)
    .gt('expires_at',new Date().toISOString())
    .maybeSingle();
  if (error || !data) return null;
  await db.from('app_sessions').update({last_used_at:new Date().toISOString()}).eq('token_hash',tokenHash);
  return data;
}

function mapExtra(row:any) {
  return {
    id:row.id, employeeId:row.employee_id, workDate:row.work_date,
    scheduledStart:String(row.scheduled_start || '').slice(0,5),
    scheduledEnd:String(row.scheduled_end || '').slice(0,5),
    shiftType:row.shift_type, segmentType:'extra',
  };
}

async function listExtraSchedules(session:any, month:string) {
  const {start,next}=monthRange(month);
  let query=db.from('extra_schedules').select('*').gte('work_date',start).lt('work_date',next).order('work_date').order('scheduled_start');
  if (session.role !== 'admin') query=query.eq('employee_id',session.employee_id);
  const {data,error}=await query;
  if (error) throw error;
  return (data || []).map(mapExtra);
}

async function scheduleRowsForSync(session:any, body:any) {
  const requestedMonth=String(body.month || monthOf(body.workDate || today()));
  const {start,next}=monthRange(requestedMonth);
  const lower = start < today() ? today() : start;
  const employeeId = session.role === 'admin' ? String(body.employeeId || '') : String(session.employee_id || '');

  let baseQuery=db.from('schedules').select('employee_id,work_date,shift_type').gte('work_date',lower).lt('work_date',next);
  let extraQuery=db.from('extra_schedules').select('employee_id,work_date,shift_type').gte('work_date',lower).lt('work_date',next);
  if (employeeId) {
    baseQuery=baseQuery.eq('employee_id',employeeId);
    extraQuery=extraQuery.eq('employee_id',employeeId);
  }
  if (session.role !== 'admin') {
    baseQuery=baseQuery.eq('work_date',today());
    extraQuery=extraQuery.eq('work_date',today());
  }

  const [{data:base,error:baseError},{data:extra,error:extraError}]=await Promise.all([baseQuery,extraQuery]);
  if (baseError) throw baseError;
  if (extraError) throw extraError;
  return [...(base || []),...(extra || [])];
}

async function syncChecklists(session:any, body:any={}) {
  const schedules=await scheduleRowsForSync(session,body);
  if (!schedules.length) return {created:0};

  const employeeIds=[...new Set(schedules.map((row:any)=>row.employee_id))];
  const dates=schedules.map((row:any)=>row.work_date).sort();
  const minDate=dates[0];
  const maxDate=dates[dates.length-1];

  const [{data:templates,error:templateError},{data:existing,error:existingError}]=await Promise.all([
    db.from('checklist_templates')
      .select('id,shift_type,weekdays,active,checklist_template_items(id,title,description,required,sort_order)')
      .eq('active',true),
    db.from('task_assignments')
      .select('employee_id,work_date,title,source_type,shift_type')
      .in('employee_id',employeeIds)
      .gte('work_date',minDate)
      .lte('work_date',maxDate)
      .eq('source_type','checklist'),
  ]);
  if (templateError) throw templateError;
  if (existingError) throw existingError;

  const normalizedTemplates=(templates || []).map((template:any)=>({
    id:template.id,
    shiftType:template.shift_type,
    weekdays:template.weekdays || [],
    active:template.active,
    items:(template.checklist_template_items || []).map((item:any)=>({
      id:item.id,title:item.title,description:item.description || '',
      required:item.required !== false,sortOrder:Number(item.sort_order || 0),
    })),
  }));

  const rows=buildMissingChecklistRows({today:today(),schedules,templates:normalizedTemplates,existing:existing || []});
  if (!rows.length) return {created:0};

  const {error:insertError}=await db.from('task_assignments').insert(rows);
  if (insertError) throw insertError;
  return {created:rows.length};
}

async function overlapExists(payload:any, ignoreId='') {
  const {data:base,error:baseError}=await db.from('schedules')
    .select('scheduled_start,scheduled_end')
    .eq('employee_id',payload.employeeId)
    .eq('work_date',payload.workDate);
  if (baseError) throw baseError;

  let extraQuery=db.from('extra_schedules').select('id,scheduled_start,scheduled_end')
    .eq('employee_id',payload.employeeId)
    .eq('work_date',payload.workDate);
  if (ignoreId) extraQuery=extraQuery.neq('id',ignoreId);
  const {data:extras,error:extraError}=await extraQuery;
  if (extraError) throw extraError;

  const start=payload.scheduledStart;
  const end=payload.scheduledEnd;
  return [...(base || []),...(extras || [])].some((row:any)=>{
    const rowStart=String(row.scheduled_start || '').slice(0,5);
    const rowEnd=String(row.scheduled_end || '').slice(0,5);
    return start < rowEnd && end > rowStart;
  });
}

Deno.serve(async (req:Request)=>{
  if (req.method==='OPTIONS') return new Response('ok',{headers:H});
  const session=await requireSession(req);
  if (!session) return out({error:'로그인이 필요합니다.'},403);

  try {
    if (req.method==='GET') {
      const month=new URL(req.url).searchParams.get('month') || monthOf(today());
      return out({ok:true,extraSchedules:await listExtraSchedules(session,month)});
    }
    if (req.method!=='POST') return out({error:'지원하지 않는 요청입니다.'},405);

    const body=await req.json().catch(()=>({}));
    const action=String(body.action || '');

    if (action==='sync_checklists') {
      return out({ok:true,...await syncChecklists(session,body)});
    }

    if (session.role!=='admin') return out({error:'관리자 권한이 필요합니다.'},403);

    if (action==='save_extra') {
      const checked=validateExtraScheduleInput(body);
      if (!checked.ok) return out({error:checked.error},400);
      const payload=checked.value;
      const id=String(body.id || '').trim();

      const {data:employee,error:employeeError}=await db.from('employees').select('id').eq('id',payload.employeeId).maybeSingle();
      if (employeeError) throw employeeError;
      if (!employee) return out({error:'직원을 찾을 수 없습니다.'},404);
      if (await overlapExists(payload,id)) return out({error:'같은 시간대에 이미 배정된 근무가 있습니다.'},409);

      const row={
        employee_id:payload.employeeId,work_date:payload.workDate,
        scheduled_start:payload.scheduledStart,scheduled_end:payload.scheduledEnd,
        shift_type:payload.shiftType,updated_at:new Date().toISOString(),
      };
      let result;
      if (id) result=await db.from('extra_schedules').update(row).eq('id',id).select('*').single();
      else result=await db.from('extra_schedules').insert(row).select('*').single();
      if (result.error) throw result.error;

      await syncChecklists(session,{month:monthOf(payload.workDate),employeeId:payload.employeeId});
      return out({ok:true,extraSchedule:mapExtra(result.data)});
    }

    if (action==='delete_extra') {
      const id=String(body.id || '').trim();
      if (!id) return out({error:'삭제할 추가 근무를 확인해 주세요.'},400);
      const {error}=await db.from('extra_schedules').delete().eq('id',id);
      if (error) throw error;
      return out({ok:true});
    }

    return out({error:'지원하지 않는 작업입니다.'},400);
  } catch (error) {
    console.error(error);
    return out({error:'근무 정보를 처리하지 못했습니다.'},500);
  }
});
