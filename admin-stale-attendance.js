/* Historical stale clock-out review for administrators */
const staleAttendanceState={items:null,loading:false,error:'',loadedAt:0};

function staleMonthOffset(base,offset){
  const parts=String(base).split('-').map(Number);
  const date=new Date(Date.UTC(parts[0],parts[1]-1-offset,1));
  return date.getUTCFullYear()+'-'+String(date.getUTCMonth()+1).padStart(2,'0');
}

function staleAttendanceMonths(){
  const base=currentMonth();
  return [0,1,2].map((offset)=>staleMonthOffset(base,offset));
}

function staleAttendanceLabel(item){
  const segment=Number(item.sessionNo||1)>1?' · '+Number(item.sessionNo)+'구간':'';
  return String(item.workDate||'')+segment+' · '+fmtTime(item.clockIn)+' 출근 · 미퇴근';
}

function staleAttendanceCard(){
  if(staleAttendanceState.loading&&staleAttendanceState.items===null){
    return '<section class="admin-side-card stale-attendance-card"><div class="admin-side-heading"><div><span>과거 미퇴근</span><h3>확인 중이에요</h3></div></div><div class="admin-muted-empty">최근 3개월의 미퇴근 기록을 확인하고 있습니다.</div></section>';
  }
  if(staleAttendanceState.error){
    return '<section class="admin-side-card stale-attendance-card"><div class="admin-side-heading"><div><span>과거 미퇴근</span><h3>확인이 필요해요</h3></div></div><button class="admin-stale-retry" data-stale-retry>다시 확인</button></section>';
  }
  const items=Array.isArray(staleAttendanceState.items)?staleAttendanceState.items:[];
  if(!items.length) return '';
  return '<section class="admin-side-card stale-attendance-card is-danger"><div class="admin-side-heading"><div><span>과거 미퇴근</span><h3>'+items.length+'건 확인 필요</h3></div><span class="admin-attention-count">'+items.length+'</span></div><p class="stale-attendance-copy">최근 3개월 중 출근 후 퇴근이 기록되지 않은 항목입니다.</p><button class="action-button secondary-action stale-attendance-open" data-stale-center><span>미퇴근 기록 확인</span></button></section>';
}

const baseAdminAttentionMarkupForStale=adminAttentionMarkup;
adminAttentionMarkup=function(snapshot){
  return staleAttendanceCard()+baseAdminAttentionMarkupForStale(snapshot);
};

async function loadStaleAttendance(force=false){
  if(session?.role!=='admin'||!session?.token||staleAttendanceState.loading) return;
  if(!force&&Array.isArray(staleAttendanceState.items)&&Date.now()-staleAttendanceState.loadedAt<300000) return;
  staleAttendanceState.loading=true;
  staleAttendanceState.error='';
  try{
    const months=staleAttendanceMonths();
    const payloads=await Promise.all(months.map((target)=>api.bootstrap(session.token,target)));
    const employeeMap=new Map();
    const scheduleMap=new Map();
    const attendanceMap=new Map();
    payloads.forEach((payload)=>{
      (payload?.employees||[]).forEach((row)=>employeeMap.set(row.id,row));
      (payload?.schedules||[]).forEach((row)=>scheduleMap.set(row.employeeId+'|'+row.workDate,row));
      (payload?.attendance||[]).forEach((row)=>attendanceMap.set(row.id,row));
    });
    const cutoff=kstDate();
    staleAttendanceState.items=[...attendanceMap.values()]
      .filter((row)=>row.workDate<cutoff&&row.clockIn&&!row.clockOut)
      .map((row)=>{
        const employee=employeeMap.get(row.employeeId)||{};
        const schedule=row.sessionType==='base'?scheduleMap.get(row.employeeId+'|'+row.workDate):null;
        return {
          ...row,
          employeeName:employee.name||'직원',
          employeePosition:employee.position||'스태프',
          scheduledStart:schedule?.scheduledStart||null,
          scheduledEnd:schedule?.scheduledEnd||null,
        };
      })
      .sort((a,b)=>String(b.workDate).localeCompare(String(a.workDate))||Number(b.sessionNo||1)-Number(a.sessionNo||1));
    staleAttendanceState.loadedAt=Date.now();
  }catch(error){
    staleAttendanceState.error=String(error?.message||'미퇴근 기록을 불러오지 못했습니다.');
    if(staleAttendanceState.items===null) staleAttendanceState.items=[];
  }finally{
    staleAttendanceState.loading=false;
  }
  if(typeof adminSection!=='undefined'&&adminSection==='today') renderAdmin();
}

function staleAttendanceCenterMarkup(){
  const items=Array.isArray(staleAttendanceState.items)?staleAttendanceState.items:[];
  const rows=items.length?items.map((item)=>{
    const schedule=item.scheduledEnd?'<em>예정 퇴근 '+esc(item.scheduledEnd)+'</em>':'';
    return '<button class="stale-attendance-row" data-stale-edit="'+esc(item.id)+'"><span class="avatar">'+esc(String(item.employeeName||'직원').slice(0,1))+'</span><span><b>'+esc(item.employeeName||'직원')+'</b><small>'+esc(staleAttendanceLabel(item))+'</small>'+schedule+'</span>'+icon('chevron','chevron')+'</button>';
  }).join(''):'<div class="admin-success-empty">최근 3개월에 과거 미퇴근 기록이 없습니다.</div>';
  return '<div class="sheet-heading"><div><span class="sheet-kicker">과거 미퇴근 관리</span><h2>'+(items.length?items.length+'건을 확인해 주세요':'미퇴근 기록이 없습니다')+'</h2><p>퇴근 누락을 실제 시간으로 정정하면 기존 감사 이력에 남습니다.</p></div></div><div class="stale-attendance-list">'+rows+'</div><div class="sheet-actions"><button class="action-button secondary-action" id="refreshStaleAttendance"><span>새로고침</span></button></div>';
}

function bindStaleAttendanceCenter(){
  document.querySelectorAll('[data-stale-edit]').forEach((button)=>{
    button.onclick=()=>openStaleAttendanceEdit(button.dataset.staleEdit);
  });
  document.querySelector('#refreshStaleAttendance')?.addEventListener('click',async()=>{
    await loadStaleAttendance(true);
    openStaleAttendanceCenter();
  });
}

function openStaleAttendanceCenter(){
  openSheet(staleAttendanceCenterMarkup(),{size:'compact stale-attendance-sheet'});
  bindStaleAttendanceCenter();
}

function staleAttendanceEditMarkup(item){
  const suggested=String(item.workDate)+'T'+String(item.scheduledEnd||'18:00');
  const planned=item.scheduledEnd?'<div class="sheet-notice">예정 근무 '+esc(item.scheduledStart||'')+'–'+esc(item.scheduledEnd)+'</div>':'';
  return '<div class="sheet-heading"><div><span class="sheet-kicker danger-kicker">미퇴근 정정</span><h2>'+esc(item.employeeName||'직원')+' · '+esc(String(item.workDate).slice(5))+'</h2><p>'+esc(fmtTime(item.clockIn))+' 출근 이후 누락된 퇴근 시간을 입력합니다.</p></div></div>'+planned+field({id:'staleClockOut',label:'실제 퇴근',type:'datetime-local',value:suggested})+field({id:'staleReason',label:'수정 사유',textarea:true,placeholder:'예: 퇴근 입력 누락으로 실제 퇴근시간 정정'})+'<button class="action-button primary-action" id="saveStaleAttendance"><span>퇴근 시간 저장</span></button>';
}

function openStaleAttendanceEdit(attendanceId){
  const item=(staleAttendanceState.items||[]).find((row)=>row.id===attendanceId);
  if(!item) return;
  openSheet(staleAttendanceEditMarkup(item),{size:'compact'});
  document.querySelector('#saveStaleAttendance')?.addEventListener('click',()=>saveStaleAttendance(item));
}

async function saveStaleAttendance(item){
  clearFieldErrors(document.querySelector('.glass-sheet'));
  const local=document.querySelector('#staleClockOut')?.value||'';
  const reason=document.querySelector('#staleReason')?.value.trim()||'';
  if(!local) return showFieldError('staleClockOut','실제 퇴근 시간을 입력해 주세요.');
  if(reason.length<2) return showFieldError('staleReason','수정 사유를 2자 이상 입력해 주세요.');
  const outValue=local+':00+09:00';
  const outMs=new Date(outValue).getTime();
  const inMs=new Date(item.clockIn).getTime();
  if(!Number.isFinite(outMs)||outMs<=inMs) return showFieldError('staleClockOut','퇴근 시간은 출근 시간보다 늦어야 합니다.');
  const button=document.querySelector('#saveStaleAttendance');
  setPending(button,true,'저장 중');
  try{
    await api.correctAttendance(session.token,{attendanceId:item.id,field:'clockOut',newValue:outValue,reason});
    await loadStaleAttendance(true);
    dismissLayer(document.querySelector('.sheet-backdrop'));
    renderAdmin();
    toastMsg('미퇴근 기록을 정정했습니다.');
    haptic(8);
  }catch(error){
    toastMsg(error.message);
  }finally{
    if(button?.isConnected) setPending(button,false);
  }
}

const baseBindAdminShellForStale=bindAdminShell;
bindAdminShell=function(){
  baseBindAdminShellForStale();
  if(adminSection!=='today') return;
  document.querySelector('[data-stale-center]')?.addEventListener('click',openStaleAttendanceCenter);
  document.querySelector('[data-stale-retry]')?.addEventListener('click',()=>loadStaleAttendance(true));
  if(staleAttendanceState.items===null&&!staleAttendanceState.loading) loadStaleAttendance();
};
