const STATUS_KEYS=['add','update','remove','protected','needs_review','unchanged'];

const text=(value)=>String(value??'').trim();
const timeOk=(value)=>/^([01]\d|2[0-3]):[0-5]\d$/.test(text(value));
const dateOk=(value)=>/^\d{4}-\d{2}-\d{2}$/.test(text(value));
const monthOk=(value)=>/^\d{4}-\d{2}$/.test(text(value));
const keyOf=(employeeId,workDate)=>`${employeeId}|${workDate}`;

function normalizeSegment(row,segmentType='base'){
  return {
    ...(row.id?{id:row.id}:{}),
    employeeId:text(row.employeeId??row.employee_id),
    employeeLabel:text(row.employeeLabel??row.employee_label),
    workDate:text(row.workDate??row.work_date),
    scheduledStart:text(row.scheduledStart??row.scheduled_start).slice(0,5),
    scheduledEnd:text(row.scheduledEnd??row.scheduled_end).slice(0,5),
    shiftType:text((row.shiftType??row.shift_type) || 'other')||'other',
    segmentType,
  };
}

function groupExisting(input){
  const groups=new Map();
  const add=(row,type)=>{
    const normalized=normalizeSegment(row,type);
    if(!normalized.employeeId||!normalized.workDate)return;
    const key=keyOf(normalized.employeeId,normalized.workDate);
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(normalized);
  };
  for(const row of input.baseSchedules||[])add(row,'base');
  for(const row of input.extraSchedules||[])add(row,'extra');
  for(const rows of groups.values())rows.sort((a,b)=>a.scheduledStart.localeCompare(b.scheduledStart));
  return groups;
}

function groupDesired(input){
  const groups=new Map();
  const review=[];
  for(const raw of input.shifts||[]){
    const row=normalizeSegment(raw,'base');
    if(!row.employeeId){review.push({...row,status:'needs_review',detail:'직원 연결이 필요합니다.'});continue;}
    if(!dateOk(row.workDate)||!row.workDate.startsWith(`${input.targetMonth}-`)||row.workDate<input.effectiveDate)continue;
    const key=keyOf(row.employeeId,row.workDate);
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(row);
  }
  for(const rows of groups.values()){
    rows.sort((a,b)=>a.scheduledStart.localeCompare(b.scheduledStart)||a.scheduledEnd.localeCompare(b.scheduledEnd));
    rows.forEach((row,index)=>{row.segmentType=index===0?'base':'extra';});
  }
  return {groups,review};
}

function sameSegments(before,after){
  if(before.length!==after.length)return false;
  return before.every((row,index)=>{
    const next=after[index];
    return row.scheduledStart===next.scheduledStart&&row.scheduledEnd===next.scheduledEnd&&(row.shiftType||'other')===(next.shiftType||'other');
  });
}

function hasAttendance(attendance,key){
  return (attendance||[]).some((raw)=>{
    const employeeId=text(raw.employeeId??raw.employee_id);
    const workDate=text(raw.workDate??raw.work_date);
    if(keyOf(employeeId,workDate)!==key)return false;
    return Boolean(raw.clockIn??raw.clock_in??raw.clockOut??raw.clock_out);
  });
}

export function validateImportPayload(input={}){
  const targetMonth=text(input.targetMonth);
  const effectiveDate=text(input.effectiveDate);
  const today=text(input.today||effectiveDate);
  if(!monthOk(targetMonth))return {ok:false,error:'대상 월 형식이 올바르지 않습니다.'};
  if(!dateOk(effectiveDate))return {ok:false,error:'적용 시작일 형식이 올바르지 않습니다.'};
  if(dateOk(today)&&effectiveDate<today)return {ok:false,error:'과거 날짜부터 자동 변경할 수 없습니다.'};
  if(!Array.isArray(input.shifts))return {ok:false,error:'근무표 데이터가 필요합니다.'};

  const byKey=new Map();
  for(const raw of input.shifts){
    const row=normalizeSegment(raw);
    if(!row.employeeId)continue;
    if(!dateOk(row.workDate))return {ok:false,error:'근무 날짜를 확인해 주세요.'};
    if(!row.workDate.startsWith(`${targetMonth}-`))return {ok:false,error:'대상 월 밖의 근무가 포함되어 있습니다.'};
    if(!timeOk(row.scheduledStart)||!timeOk(row.scheduledEnd)||row.scheduledStart>=row.scheduledEnd)return {ok:false,error:'근무 시간을 확인해 주세요.'};
    if(row.workDate<effectiveDate)continue;
    const key=keyOf(row.employeeId,row.workDate);
    if(!byKey.has(key))byKey.set(key,[]);
    byKey.get(key).push(row);
  }
  for(const rows of byKey.values()){
    rows.sort((a,b)=>a.scheduledStart.localeCompare(b.scheduledStart));
    for(let i=1;i<rows.length;i+=1){
      if(rows[i].scheduledStart<rows[i-1].scheduledEnd)return {ok:false,error:'같은 직원의 근무 시간이 서로 겹칩니다.'};
    }
  }
  return {ok:true};
}

export function buildScheduleImportDiff(input={}){
  const effectiveDate=text(input.effectiveDate);
  const targetMonth=text(input.targetMonth);
  const existing=groupExisting(input);
  const desired=groupDesired({...input,targetMonth,effectiveDate});
  const keys=new Set(desired.groups.keys());
  if(input.authoritative===true){
    for(const key of existing.keys()){
      const [,workDate]=key.split('|');
      if(workDate.startsWith(`${targetMonth}-`)&&workDate>=effectiveDate)keys.add(key);
    }
  }

  const diff=[];
  for(const row of desired.review){
    if(row.workDate&&row.workDate<effectiveDate)continue;
    diff.push(row);
  }
  for(const key of [...keys].sort()){
    const before=(existing.get(key)||[]).map((row,index)=>({...row,segmentType:index===0?'base':'extra'}));
    const after=(desired.groups.get(key)||[]).map((row,index)=>({...row,segmentType:index===0?'base':'extra'}));
    if(!after.length&&input.authoritative!==true)continue;
    const [employeeId,workDate]=key.split('|');
    let status='unchanged';
    if(!before.length&&after.length)status='add';
    else if(before.length&&!after.length)status='remove';
    else if(!sameSegments(before,after))status='update';
    if(status!=='unchanged'&&hasAttendance(input.attendance,key))status='protected';
    diff.push({
      employeeId,workDate,
      employeeLabel:after[0]?.employeeLabel||before[0]?.employeeLabel||'',
      status,before,after,
      ...(status==='protected'?{detail:'실제 출퇴근 기록 있음 · 자동 변경 제외'}:{}),
    });
  }
  return diff.sort((a,b)=>String(a.workDate||'').localeCompare(String(b.workDate||''))||String(a.employeeId||a.employeeLabel||'').localeCompare(String(b.employeeId||b.employeeLabel||'')));
}

export function summarizeImportDiff(diff=[]){
  const summary={add:0,update:0,remove:0,protected:0,needs_review:0,unchanged:0};
  for(const row of diff){if(STATUS_KEYS.includes(row?.status))summary[row.status]+=1;}
  return summary;
}
