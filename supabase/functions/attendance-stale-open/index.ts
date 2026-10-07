import { createClient } from '@supabase/supabase-js';

const H={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
  'Content-Type':'application/json; charset=utf-8',
};
const db=createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  {auth:{persistSession:false,autoRefreshToken:false}},
);
const out=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:H});
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul'}).format(new Date());
const hex=(buffer:ArrayBuffer)=>[...new Uint8Array(buffer)].map((x)=>x.toString(16).padStart(2,'0')).join('');
const sha=(value:string)=>crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)).then(hex);

async function requireAdmin(req:Request){
  const header=req.headers.get('authorization')||'';
  if(!header.startsWith('Bearer ')) return null;
  const raw=header.slice(7).trim();
  if(!raw) return null;
  const tokenHash=await sha(raw);
  const {data,error}=await db.from('app_sessions')
    .select('token_hash,role,expires_at')
    .eq('token_hash',tokenHash)
    .eq('role','admin')
    .gt('expires_at',new Date().toISOString())
    .maybeSingle();
  if(error||!data) return null;
  await db.from('app_sessions').update({last_used_at:new Date().toISOString()}).eq('token_hash',tokenHash);
  return data;
}

async function listStaleOpen(){
  const cutoff=today();
  const {data:rows,error}=await db.from('attendance')
    .select('id,employee_id,work_date,session_no,session_type,clock_in,clock_out,work_minutes,created_at')
    .lt('work_date',cutoff)
    .not('clock_in','is',null)
    .is('clock_out',null)
    .order('work_date',{ascending:false})
    .order('clock_in',{ascending:false})
    .limit(200);
  if(error) throw error;
  const items=rows||[];
  const employeeIds=[...new Set(items.map((row:any)=>String(row.employee_id)).filter(Boolean))];
  const minDate=items.reduce((min:string,row:any)=>!min||String(row.work_date)<min?String(row.work_date):min,'');
  const employeesResult=employeeIds.length
    ? await db.from('employees').select('id,name,position,active').in('id',employeeIds)
    : {data:[],error:null};
  if(employeesResult.error) throw employeesResult.error;
  const schedulesResult=employeeIds.length&&minDate
    ? await db.from('schedules').select('employee_id,work_date,scheduled_start,scheduled_end').in('employee_id',employeeIds).gte('work_date',minDate).lt('work_date',cutoff)
    : {data:[],error:null};
  if(schedulesResult.error) throw schedulesResult.error;
  const employeeMap=new Map((employeesResult.data||[]).map((row:any)=>[String(row.id),row]));
  const scheduleMap=new Map((schedulesResult.data||[]).map((row:any)=>[String(row.employee_id)+'|'+String(row.work_date),row]));
  return items.map((row:any)=>{
    const employee:any=employeeMap.get(String(row.employee_id))||{};
    const schedule:any=row.session_type==='base'?scheduleMap.get(String(row.employee_id)+'|'+String(row.work_date)):null;
    return {
      id:row.id,
      employeeId:row.employee_id,
      employeeName:employee.name||'직원',
      employeePosition:employee.position||'스태프',
      employeeActive:employee.active!==false,
      workDate:row.work_date,
      sessionNo:Number(row.session_no||1),
      sessionType:row.session_type||'base',
      clockIn:row.clock_in,
      clockOut:row.clock_out,
      scheduledStart:schedule?String(schedule.scheduled_start).slice(0,5):null,
      scheduledEnd:schedule?String(schedule.scheduled_end).slice(0,5):null,
    };
  });
}

async function resolveStaleOpen(body:any){
  const attendanceId=String(body?.attendanceId||'').trim();
  const clockOut=String(body?.clockOut||'').trim();
  const reason=String(body?.reason||'').trim();
  if(!attendanceId||!clockOut||reason.length<2) return out({error:'퇴근 시간과 수정 사유를 확인해 주세요.'},400);

  const {data:row,error}=await db.from('attendance')
    .select('id,employee_id,work_date,clock_in,clock_out')
    .eq('id',attendanceId)
    .maybeSingle();
  if(error) throw error;
  if(!row) return out({error:'근태 기록을 찾을 수 없습니다.'},404);
  if(row.clock_out) return out({error:'이미 퇴근 처리가 완료된 기록입니다.'},409);
  if(String(row.work_date)>=today()) return out({error:'오늘 근무는 기존 출퇴근 기능에서 처리해 주세요.'},409);

  const inMs=new Date(row.clock_in).getTime();
  const outMs=new Date(clockOut).getTime();
  if(!Number.isFinite(outMs)||outMs<=inMs) return out({error:'퇴근 시간은 출근 시간보다 늦어야 합니다.'},400);
  if(outMs-inMs>36*60*60*1000) return out({error:'근무 시간이 36시간을 초과합니다. 시간을 다시 확인해 주세요.'},400);

  const {error:rpcError}=await db.rpc('correct_attendance_value',{
    p_attendance_id:attendanceId,
    p_field:'clock_out',
    p_new_value:clockOut,
    p_changed_by:'점장',
    p_reason:reason,
  });
  if(rpcError) throw rpcError;

  const {error:eventError}=await db.from('attendance_events').insert({
    employee_id:row.employee_id,
    attendance_id:attendanceId,
    work_date:row.work_date,
    event_type:'admin_corrected',
    actor_type:'admin',
    previous_value:null,
    new_value:clockOut,
  });
  if(eventError) throw eventError;
  return out({ok:true});
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:H});
  if(req.method!=='POST') return out({error:'지원하지 않는 요청입니다.'},405);
  if(!await requireAdmin(req)) return out({error:'관리자 로그인이 필요합니다.'},403);
  try{
    const body=await req.json().catch(()=>({}));
    const action=String(body?.action||'');
    if(action==='list') return out({ok:true,items:await listStaleOpen()});
    if(action==='resolve') return await resolveStaleOpen(body);
    return out({error:'지원하지 않는 작업입니다.'},400);
  }catch(error){
    console.error('attendance-stale-open',error);
    return out({error:String((error as Error)?.message||'미퇴근 기록 처리 중 오류가 발생했습니다.')},500);
  }
});
