import { createClient } from '@supabase/supabase-js';
import { buildScheduleImportDiff, summarizeImportDiff, validateImportPayload } from './import-core.mjs';
import { analyzeScheduleImage, validateImageRequest } from './vision-adapter.mjs';

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
const text=(value:unknown)=>String(value??'').trim();
const monthRange=(targetMonth:string)=>{
  if(!/^\d{4}-\d{2}$/.test(targetMonth)) throw new Error('대상 월을 확인해 주세요.');
  const [year,month]=targetMonth.split('-').map(Number);
  const next=month===12?`${year+1}-01-01`:`${year}-${String(month+1).padStart(2,'0')}-01`;
  return {start:`${targetMonth}-01`,next};
};
const hex=(buffer:ArrayBuffer)=>[...new Uint8Array(buffer)].map((x)=>x.toString(16).padStart(2,'0')).join('');
const sha=(value:string)=>crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)).then(hex);
const aliasKey=(value:string)=>value.normalize('NFKC').replace(/\s+/g,'').toLowerCase();

async function requireAdmin(req:Request){
  const header=req.headers.get('authorization')||'';
  if(!header.startsWith('Bearer ')) return null;
  const rawToken=header.slice(7).trim();
  if(!rawToken) return null;
  const tokenHash=await sha(rawToken);
  const {data:session,error}=await db.from('app_sessions')
    .select('token_hash,role,employee_id,expires_at')
    .eq('token_hash',tokenHash)
    .gt('expires_at',new Date().toISOString())
    .maybeSingle();
  if(error||!session) return null;
  if(session.role!=='admin') return null;
  await db.from('app_sessions').update({last_used_at:new Date().toISOString()}).eq('token_hash',tokenHash);
  return {session,rawToken};
}

function normalizeSource(body:any){
  const sourceType=text(body?.sourceType);
  if(!['xlsx','image'].includes(sourceType)) throw new Error('가져오기 파일 형식을 확인해 주세요.');
  const targetMonth=text(body?.targetMonth);
  const effectiveDate=text(body?.effectiveDate);
  const shifts=Array.isArray(body?.shifts)?body.shifts:[];
  const checked=validateImportPayload({targetMonth,effectiveDate,today:today(),shifts});
  if(!checked.ok) throw new Error(checked.error);
  return {
    sourceType,
    sourceName:text(body?.sourceName),
    sourceFingerprint:text(body?.sourceFingerprint),
    targetMonth,effectiveDate,
    authoritative:body?.authoritative===true,
    shifts,
  };
}

async function loadScheduleImportContext(targetMonth:string,effectiveDate:string,shifts:any[]){
  const {next}=monthRange(targetMonth);
  const [employeesResult,schedulesResult,extrasResult,attendanceResult]=await Promise.all([
    db.from('employees').select('id,name,active').eq('active',true),
    db.from('schedules').select('id,employee_id,work_date,scheduled_start,scheduled_end,shift_type,created_at')
      .gte('work_date',effectiveDate).lt('work_date',next),
    db.from('extra_schedules').select('id,employee_id,work_date,scheduled_start,scheduled_end,shift_type,created_at')
      .gte('work_date',effectiveDate).lt('work_date',next),
    db.from('attendance').select('id,employee_id,work_date,clock_in,clock_out')
      .gte('work_date',effectiveDate).lt('work_date',next),
  ]);
  if(employeesResult.error) throw employeesResult.error;
  if(schedulesResult.error) throw schedulesResult.error;
  if(extrasResult.error) throw extrasResult.error;
  if(attendanceResult.error) throw attendanceResult.error;

  const employees=employeesResult.data||[];
  const activeIds=new Set(employees.map((row:any)=>String(row.id)));
  const safeShifts=(shifts||[]).map((row:any)=>{
    const employeeId=text(row?.employeeId);
    return employeeId&&activeIds.has(employeeId)?row:{...row,employeeId:undefined};
  });
  return {
    employees,
    shifts:safeShifts,
    baseSchedules:schedulesResult.data||[],
    extraSchedules:extrasResult.data||[],
    attendance:attendanceResult.data||[],
  };
}

function decorateDiff(diff:any[],employees:any[]){
  const names=new Map((employees||[]).map((row:any)=>[String(row.id),String(row.name||'직원')]));
  return (diff||[]).map((row:any)=>({...row,employeeName:row.employeeId?names.get(String(row.employeeId))||row.employeeLabel||'직원':row.employeeLabel||'미확인 직원'}));
}

async function previewScheduleImport(source:any){
  const context=await loadScheduleImportContext(source.targetMonth,source.effectiveDate,source.shifts);
  const checked=validateImportPayload({...source,shifts:context.shifts,today:today()});
  if(!checked.ok) throw new Error(checked.error);
  const diff=decorateDiff(buildScheduleImportDiff({
    ...source,
    shifts:context.shifts,
    baseSchedules:context.baseSchedules,
    extraSchedules:context.extraSchedules,
    attendance:context.attendance,
  }),context.employees);
  const summary=summarizeImportDiff(diff);
  const {data:run,error}=await db.from('schedule_import_runs').insert({
    source_type:source.sourceType,
    source_name:source.sourceName,
    source_fingerprint:source.sourceFingerprint,
    target_month:source.targetMonth,
    effective_date:source.effectiveDate,
    parsed_count:source.shifts.length,
    add_count:summary.add,
    update_count:summary.update,
    remove_count:summary.remove,
    protected_count:summary.protected,
    review_count:summary.needs_review,
    status:'previewed',
  }).select('id').single();
  if(error) throw error;
  return {runId:run.id,diff,summary};
}

async function syncImportedChecklists(rawToken:string,targetMonth:string){
  const base=Deno.env.get('SUPABASE_URL');
  if(!base) return {ok:false,error:'Supabase URL missing'};
  try{
    const response=await fetch(`${base}/functions/v1/attendance-schedule-tools`,{
      method:'POST',
      headers:{'Authorization':`Bearer ${rawToken}`,'Content-Type':'application/json'},
      body:JSON.stringify({action:'sync_checklists',month:targetMonth}),
    });
    if(!response.ok) return {ok:false,error:`checklist sync ${response.status}`};
    return {ok:true};
  }catch(error){return {ok:false,error:String((error as Error)?.message||error)};}
}

async function applyScheduleImport(source:any,runId:string,rawToken:string){
  if(!runId) return out({error:'미리보기 이력을 찾을 수 없습니다.'},400);
  const {data:run,error:runError}=await db.from('schedule_import_runs')
    .select('id,status,target_month,effective_date,source_type,source_fingerprint')
    .eq('id',runId).maybeSingle();
  if(runError) throw runError;
  if(!run||run.status!=='previewed') return out({error:'적용 가능한 미리보기 이력이 아닙니다.'},409);
  if(run.target_month!==source.targetMonth||String(run.effective_date)!==source.effectiveDate||run.source_type!==source.sourceType) return out({error:'미리보기와 적용 조건이 달라졌습니다.'},409);

  // Re-load current state immediately before the atomic RPC. This catches preview→apply attendance races.
  const current=await loadScheduleImportContext(source.targetMonth,source.effectiveDate,source.shifts);
  const currentDiff=decorateDiff(buildScheduleImportDiff({
    ...source,
    shifts:current.shifts,
    baseSchedules:current.baseSchedules,
    extraSchedules:current.extraSchedules,
    attendance:current.attendance,
  }),current.employees);
  const currentSummary=summarizeImportDiff(currentDiff);
  if(currentSummary.needs_review>0) return out({error:'확인이 필요한 근무가 남아 있어 적용하지 않았습니다.',diff:currentDiff,summary:currentSummary},409);

  const checked=validateImportPayload({...source,shifts:current.shifts,today:today()});
  if(!checked.ok) return out({error:checked.error},400);

  const actionable=currentDiff.filter((row:any)=>['add','update','remove'].includes(row.status));
  try{
    const {data:rpcResult,error:rpcError}=await db.rpc('apply_schedule_import',{
      p_target_month:source.targetMonth,
      p_effective_date:source.effectiveDate,
      p_authoritative:source.authoritative,
      p_shifts:current.shifts,
    });
    if(rpcError) throw rpcError;

    const protectedGroups=Number(rpcResult?.protectedGroups||0);
    const summary={...currentSummary,protected:Math.max(currentSummary.protected,protectedGroups)};
    const {error:updateError}=await db.from('schedule_import_runs').update({
      status:'applied',
      add_count:summary.add,
      update_count:summary.update,
      remove_count:summary.remove,
      protected_count:summary.protected,
      review_count:summary.needs_review,
      applied_changes:actionable,
      applied_at:new Date().toISOString(),
    }).eq('id',runId);
    if(updateError) throw updateError;

    const checklist=await syncImportedChecklists(rawToken,source.targetMonth);
    return out({ok:true,runId,summary,appliedChanges:actionable,rpcResult,checklistWarning:checklist.ok?null:checklist.error});
  }catch(error){
    await db.from('schedule_import_runs').update({status:'failed'}).eq('id',runId);
    throw error;
  }
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:H});
  if(req.method!=='POST') return out({error:'지원하지 않는 요청입니다.'},405);

  const auth=await requireAdmin(req);
  if(!auth) return out({error:'관리자 로그인이 필요합니다.'},403);
  const {session,rawToken}=auth;
  if(session.role!=='admin') return out({error:'관리자 권한이 필요합니다.'},403);

  const body=await req.json().catch(()=>({}));
  const action=text(body?.action);

  try{
    if(action==='analyze_image'){
      const checked=validateImageRequest({imageDataUrl:body?.imageDataUrl,mimeType:body?.mimeType});
      if(!checked.ok) return out({error:checked.error},400);
      const apiKey=Deno.env.get('OPENAI_API_KEY')||'';
      if(!apiKey) return out({error:'이미지 분석 설정이 필요합니다.'},503);
      const model=Deno.env.get('OPENAI_SCHEDULE_VISION_MODEL')||'gpt-6-luna';
      const result=await analyzeScheduleImage({
        imageDataUrl:body.imageDataUrl,
        mimeType:body.mimeType,
        targetMonth:text(body.targetMonth),
        effectiveDate:text(body.effectiveDate),
        apiKey,
        model,
      });
      return out({ok:true,...result});
    }

    if(action==='preview'){
      const source=normalizeSource(body);
      return out({ok:true,...await previewScheduleImport(source)});
    }

    if(action==='apply'){
      const source=normalizeSource(body);
      const runId=text(body?.runId);
      return await applyScheduleImport(source,runId,rawToken);
    }

    if(action==='save_alias'){
      const label=text(body?.label);
      const employeeId=text(body?.employeeId);
      if(!label||!employeeId) return out({error:'직원 별칭과 직원을 확인해 주세요.'},400);
      const {data:employee,error:employeeError}=await db.from('employees').select('id,name,active').eq('id',employeeId).eq('active',true).maybeSingle();
      if(employeeError) throw employeeError;
      if(!employee) return out({error:'활성 직원을 찾을 수 없습니다.'},404);
      const {error}=await db.from('schedule_import_aliases').upsert({
        label_key:aliasKey(label),employee_id:employeeId,original_label:label,updated_at:new Date().toISOString(),
      },{onConflict:'label_key'});
      if(error) throw error;
      return out({ok:true,employee:{id:employee.id,name:employee.name}});
    }

    if(action==='aliases'){
      const {data,error}=await db.from('schedule_import_aliases').select('label_key,employee_id,original_label');
      if(error) throw error;
      return out({ok:true,aliases:data||[]});
    }

    return out({error:'지원하지 않는 작업입니다.'},400);
  }catch(error){
    console.error('attendance-schedule-import',error);
    return out({error:text((error as Error)?.message)||'근무표 가져오기를 처리하지 못했습니다.'},500);
  }
});
