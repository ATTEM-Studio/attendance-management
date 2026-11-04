/* Staff monthly time overview + safe administrator staff-page preview */
let adminStaffPreviewEmployeeId='';

function staffTimeMinutes(value='') {
  const [hour,minute]=String(value||'').slice(0,5).split(':').map(Number);
  return Number.isFinite(hour)&&Number.isFinite(minute)?hour*60+minute:0;
}

function staffAssignedMinutes(row) {
  if(!row?.scheduledStart||!row?.scheduledEnd) return 0;
  return Math.max(0,staffTimeMinutes(row.scheduledEnd)-staffTimeMinutes(row.scheduledStart));
}

function staffActualSessionMinutes(row) {
  if(!row?.clockIn) return 0;
  const completed=Math.max(0,Number(row.workMinutes||0));
  if(row.clockOut) return completed;
  return completed+(typeof liveMinutes==='function'?Math.max(0,Number(liveMinutes(row.clockIn)||0)):0);
}

function staffTimeMonthSummary(employeeId,today=(typeof kstDate==='function'?kstDate():'')) {
  const monthKey=String(today||'').slice(0,7);
  const baseSchedules=(state?.schedules||[]).filter((row)=>row.employeeId===employeeId&&String(row.workDate||'').startsWith(monthKey+'-')&&row.workDate<=today);
  const extraSchedules=(state?.extraSchedules||[]).filter((row)=>row.employeeId===employeeId&&String(row.workDate||'').startsWith(monthKey+'-')&&row.workDate<=today);
  const attendance=(state?.attendance||[]).filter((row)=>row.employeeId===employeeId&&String(row.workDate||'').startsWith(monthKey+'-')&&row.workDate<=today&&row.clockIn);
  const assigned=[...baseSchedules,...extraSchedules].reduce((sum,row)=>sum+staffAssignedMinutes(row),0);
  const actual=attendance.reduce((sum,row)=>sum+staffActualSessionMinutes(row),0);
  const baseByDate=new Map(baseSchedules.map((row)=>[row.workDate,row]));
  const settlement=attendance.reduce((sum,row)=>{
    const actualMinutes=staffActualSessionMinutes(row);
    if(row.sessionType==='extra') return sum+actualMinutes;
    const schedule=baseByDate.get(row.workDate);
    if(schedule&&row.clockOut) return sum+staffAssignedMinutes(schedule);
    return sum+actualMinutes;
  },0);
  const scheduledDates=[...new Set([...baseSchedules,...extraSchedules].filter((row)=>row.workDate<today).map((row)=>row.workDate))];
  const attendanceDates=new Set(attendance.map((row)=>row.workDate));
  const missingDates=scheduledDates.filter((date)=>!attendanceDates.has(date)).sort();
  const completedDates=new Set(attendance.filter((row)=>row.clockOut).map((row)=>row.workDate));
  return {
    monthKey,
    assigned,
    actual,
    settlement,
    delta:actual-settlement,
    missingDates,
    completedDays:completedDates.size,
    attendanceSessions:attendance.length,
  };
}

function staffSignedMinutes(value=0) {
  const n=Math.round(Number(value)||0);
  if(!n) return '0분';
  return (n>0?'+':'−')+formatMinutes(Math.abs(n));
}

function staffTimeOverviewMarkup(summary) {
  const hasIssue=summary.missingDates.length>0;
  const deltaText=staffSignedMinutes(summary.delta);
  return '<section class="staff-time-overview '+(hasIssue?'has-check':'')+'" aria-label="이번 달 누적 근무시간">'
    +'<div class="staff-time-overview-head"><div><span>이번 달 누적</span><h2>내 근무시간</h2></div><button type="button" class="staff-time-detail-button" id="staffTimeDetail">상세 확인</button></div>'
    +'<div class="staff-time-primary"><span>정산 기준</span><b>'+esc(formatMinutes(summary.settlement))+'</b><small>기본근무는 할당시간 · 추가근무는 실제시간</small></div>'
    +'<div class="staff-time-metrics"><div><span>할당 누적</span><b>'+esc(formatMinutes(summary.assigned))+'</b></div><div><span>실제 기록</span><b>'+esc(formatMinutes(summary.actual))+'</b></div><div><span>실제-정산</span><b class="'+(summary.delta===0?'is-even':summary.delta>0?'is-plus':'is-minus')+'">'+esc(deltaText)+'</b></div></div>'
    +(hasIssue?'<div class="staff-time-check-line"><b>확인 필요 '+summary.missingDates.length+'건</b><span>지난 근무일 중 출퇴근 기록이 없는 날짜가 있습니다.</span></div>':'<div class="staff-time-check-line is-ok"><b>기록 확인</b><span>문제가 보이면 상세 내용을 복사해 관리자에게 전달하세요.</span></div>')
    +'</section>';
}

function staffTimeShareText(employee,summary) {
  const monthLabel=typeof monthTitle==='function'?monthTitle(summary.monthKey):summary.monthKey;
  const missing=summary.missingDates.length?summary.missingDates.map((date)=>date.slice(5).replace('-','/')).join(', '):'없음';
  return [
    '[근태 확인 요청]',
    (employee?.name||'직원')+' · '+monthLabel,
    '할당 누적: '+formatMinutes(summary.assigned),
    '실제 기록: '+formatMinutes(summary.actual),
    '정산 기준: '+formatMinutes(summary.settlement),
    '실제-정산 차이: '+staffSignedMinutes(summary.delta),
    '근태 기록 없음: '+missing,
    '',
    '확인이 필요한 날짜/시간을 함께 전달드립니다.',
  ].join('\n');
}

async function staffCopyText(value) {
  if(navigator?.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return true;
  }
  const area=document.createElement('textarea');
  area.value=value;
  area.setAttribute('readonly','');
  area.style.position='fixed';
  area.style.opacity='0';
  document.body.appendChild(area);
  area.select();
  const ok=document.execCommand?.('copy');
  area.remove();
  return Boolean(ok);
}

function openStaffTimeDetail(employeeId,{adminPreview=false}={}) {
  const employee=employeeById(employeeId);
  if(!employee) return;
  const summary=staffTimeMonthSummary(employeeId);
  const missingRows=summary.missingDates.length
    ?'<div class="staff-time-missing-list">'+summary.missingDates.map((date)=>'<div><span>'+esc(longDate(date))+'</span><b>근태 기록 없음</b></div>').join('')+'</div>'
    :'<div class="staff-time-detail-ok">지난 근무일의 누락된 출퇴근 기록이 없습니다.</div>';
  openSheet('<div class="sheet-heading"><div><span class="sheet-kicker">내 근무시간</span><h2>'+esc(employee.name)+'님의 '+esc(monthTitle(summary.monthKey))+'</h2><p>할당시간과 실제 기록을 비교해 이상이 있으면 관리자에게 알려주세요.</p></div></div>'
    +'<div class="staff-time-detail-summary"><div><span>할당 누적</span><b>'+esc(formatMinutes(summary.assigned))+'</b></div><div><span>실제 기록</span><b>'+esc(formatMinutes(summary.actual))+'</b></div><div class="is-primary"><span>정산 기준</span><b>'+esc(formatMinutes(summary.settlement))+'</b></div><div><span>실제-정산</span><b>'+esc(staffSignedMinutes(summary.delta))+'</b></div></div>'
    +'<section class="staff-time-detail-section"><div class="staff-time-detail-title"><span>확인할 기록</span><b>'+summary.missingDates.length+'건</b></div>'+missingRows+'</section>'
    +(adminPreview?'<div class="sheet-notice">관리자 미리보기에서는 기록을 조회만 할 수 있습니다.</div>':'<div class="sheet-notice">시간이 다르거나 빠진 기록이 있다면 아래 내용을 복사해 관리자에게 전달하세요.</div><button class="action-button secondary-action" id="copyStaffTimeSummary"><span>관리자에게 전달할 내용 복사</span></button>')
    +'<button class="action-button primary-action" data-close><span>확인</span></button>',{size:'compact staff-time-detail-sheet'});
  document.querySelector('#copyStaffTimeSummary')?.addEventListener('click',async()=>{
    const button=document.querySelector('#copyStaffTimeSummary');
    try{
      await staffCopyText(staffTimeShareText(employee,summary));
      toastMsg('근무시간 요약을 복사했습니다.');
      haptic?.(8);
      if(button) button.querySelector('span').textContent='복사 완료';
    }catch(error){
      toastMsg('복사하지 못했습니다. 다시 시도해 주세요.');
    }
  });
}

function enhanceStaffTimeOverview(employeeId,{adminPreview=false}={}) {
  const facts=document.querySelector('.attendance-facts');
  if(!facts||document.querySelector('.staff-time-overview')) return;
  const summary=staffTimeMonthSummary(employeeId);
  facts.insertAdjacentHTML('afterend',staffTimeOverviewMarkup(summary));
  document.querySelector('#staffTimeDetail')?.addEventListener('click',()=>openStaffTimeDetail(employeeId,{adminPreview}));
}

const baseRenderTodayForStaffTime=renderToday;
renderToday=function renderTodayWithMonthlyTime() {
  baseRenderTodayForStaffTime();
  const employeeId=adminStaffPreviewEmployeeId||session?.employeeId;
  if(employeeId) enhanceStaffTimeOverview(employeeId,{adminPreview:Boolean(adminStaffPreviewEmployeeId)});
};

function adminStaffPreviewLock(employee) {
  const main=document.querySelector('.staff-screen');
  if(!main) return;
  main.classList.add('is-admin-staff-preview');
  const nav=main.querySelector('.native-nav');
  if(nav) nav.outerHTML='<header class="native-nav admin-staff-preview-nav"><button class="circle-button" id="adminStaffPreviewBack" aria-label="관리자 화면으로 돌아가기">'+icon('back')+'</button><div class="native-nav-title"><span>관리자 · 읽기 전용</span><b>'+esc(employee.name)+' 직원 화면</b></div><span class="admin-staff-preview-badge">미리보기</span></header>';
  const action=main.querySelector('.floating-action-shell');
  if(action) action.outerHTML='<section class="admin-staff-preview-notice"><b>직원 화면 미리보기</b><span>출퇴근과 업무 완료는 직원 계정에서만 처리할 수 있습니다.</span></section>';
  main.querySelector('.ios-tabbar')?.remove();
  main.querySelectorAll('[data-task-complete],.task-check').forEach((button)=>{
    button.disabled=true;
    button.onclick=null;
    button.removeAttribute('data-task-complete');
    button.setAttribute('aria-disabled','true');
  });
  main.querySelectorAll('.task-row').forEach((row)=>row.classList.add('is-admin-preview'));
  document.querySelector('#adminStaffPreviewBack')?.addEventListener('click',exitAdminStaffPreview);
}

function openAdminStaffPreview(employeeId) {
  if(session?.role!=='admin') return;
  const employee=employeeById(employeeId);
  if(!employee) return toastMsg('직원 정보를 찾지 못했습니다.');
  document.querySelector('#panelRoot')?.remove();
  document.querySelectorAll('.sheet-backdrop').forEach((layer)=>layer.remove());
  clearInterval(liveTimer);
  const adminSession=session;
  adminStaffPreviewEmployeeId=employeeId;
  try{
    session={...adminSession,role:'staff',employeeId};
    currentTab='today';
    renderToday();
  }finally{
    session=adminSession;
  }
  adminStaffPreviewLock(employee);
}

function exitAdminStaffPreview() {
  if(!adminStaffPreviewEmployeeId) return;
  adminStaffPreviewEmployeeId='';
  clearInterval(liveTimer);
  currentTab='today';
  renderAdmin();
}

const baseEmployeeRowForStaffPreview=employeeRow;
employeeRow=function employeeRowWithStaffPreview(employee) {
  const html=baseEmployeeRowForStaffPreview(employee);
  return html.replace('<button class="row-action" data-employee-edit="'+employee.id+'">편집</button>','<button class="row-action employee-preview-action" data-staff-preview="'+employee.id+'">화면 보기</button><button class="row-action" data-employee-edit="'+employee.id+'">편집</button>');
};

const baseOpenEmployeeManagerForStaffPreview=openEmployeeManager;
openEmployeeManager=function openEmployeeManagerWithStaffPreview() {
  baseOpenEmployeeManagerForStaffPreview();
  document.querySelectorAll('[data-staff-preview]').forEach((button)=>{
    button.onclick=()=>openAdminStaffPreview(button.dataset.staffPreview);
  });
};

if(typeof closeInternalViewForBack==='function') {
  const baseCloseInternalViewForStaffPreview=closeInternalViewForBack;
  closeInternalViewForBack=function closeInternalViewWithStaffPreview() {
    if(adminStaffPreviewEmployeeId) {
      exitAdminStaffPreview();
      return true;
    }
    return baseCloseInternalViewForStaffPreview();
  };
}
