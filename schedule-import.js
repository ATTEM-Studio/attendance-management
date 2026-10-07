/* Schedule import wizard: Excel stays local; server validates preview/apply. */
const SCHEDULE_IMPORT_API = 'https://ndczsguqlwyiuqvsmvcb.supabase.co/functions/v1/attendance-schedule-import';
const SCHEDULE_IMPORT_TYPES = ['add','update','remove','protected','needs_review','unchanged'];

if (typeof api !== 'undefined' && typeof externalRequest === 'function') {
  api.previewScheduleImport = (token,payload) => externalRequest(SCHEDULE_IMPORT_API,{method:'POST',token,body:{action:'preview',...payload}});
  api.applyScheduleImport = (token,payload) => externalRequest(SCHEDULE_IMPORT_API,{method:'POST',token,body:{action:'apply',...payload}});
  api.saveScheduleImportAlias = (token,payload) => externalRequest(SCHEDULE_IMPORT_API,{method:'POST',token,body:{action:'save_alias',...payload}});
  api.listScheduleImportAliases = (token) => externalRequest(SCHEDULE_IMPORT_API,{method:'POST',token,body:{action:'aliases'}});
}

let scheduleImportState = null;

function scheduleImportToday() {
  return typeof kstDate === 'function' ? kstDate() : new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul'}).format(new Date());
}

function scheduleImportMonth() {
  if (typeof adminWorkMonth === 'string' && /^\d{4}-\d{2}$/.test(adminWorkMonth)) return adminWorkMonth;
  if (typeof month === 'string' && /^\d{4}-\d{2}$/.test(month)) return month;
  return scheduleImportToday().slice(0,7);
}

function clampEffectiveDate(value,today=scheduleImportToday()) {
  const candidate=/^\d{4}-\d{2}-\d{2}$/.test(String(value||'')) ? String(value) : today;
  return candidate < today ? today : candidate;
}

function emptyImportSummary() {
  return {add:0,update:0,remove:0,protected:0,needs_review:0,unchanged:0};
}

function buildImportPreviewModel(input={}) {
  const today=String(input.today || scheduleImportToday());
  const diff=Array.isArray(input.diff) ? input.diff : [];
  const summary=emptyImportSummary();
  for (const row of diff) {
    const status=String(row?.status || '');
    if (SCHEDULE_IMPORT_TYPES.includes(status)) summary[status]+=1;
  }
  return {
    sourceType:String(input.sourceType || ''),
    targetMonth:/^\d{4}-\d{2}$/.test(String(input.targetMonth||'')) ? String(input.targetMonth) : scheduleImportMonth(),
    effectiveDate:clampEffectiveDate(input.effectiveDate,today),
    candidateRegionId:String(input.candidateRegionId || ''),
    employeeMatches:Array.isArray(input.employeeMatches) ? input.employeeMatches : [],
    authoritative:input.authoritative === true,
    diff,
    summary,
  };
}

function defaultScheduleImportState() {
  const targetMonth=scheduleImportMonth();
  const today=scheduleImportToday();
  return {
    step:1,
    sourceType:'',
    sourceName:'',
    sourceFingerprint:'',
    file:null,
    workbook:null,
    regions:[],
    candidateRegionId:'',
    targetMonth,
    effectiveDate:today.startsWith(targetMonth) ? today : `${targetMonth}-01`,
    authoritative:false,
    parsedRows:[],
    shifts:[],
    employeeMatches:[],
    aliases:{},
    preview:null,
    previewSelectedDate:'',
    busy:false,
    error:'',
  };
}

function importStepLabel(step) {
  return ['','파일 선택','근무표 선택','직원 확인','변경사항 확인'][step] || '근무표 가져오기';
}

function importStepper(current) {
  return `<div class="schedule-import-stepper">${[1,2,3,4].map((step)=>`<span class="${step===current?'is-current':step<current?'is-done':''}"><b>${step}</b><small>${esc(importStepLabel(step))}</small></span>`).join('')}</div>`;
}

function importFileStep(model) {
  return `<section class="schedule-import-stage"><div class="schedule-import-intro"><span>Excel 전용</span><h3>엑셀 근무표 파일을 올려주세요.</h3><p>.xlsx 파일은 기기 안에서 직접 읽고, 원본 파일은 서버에 저장하지 않습니다.</p></div>
    <label class="schedule-import-dropzone" for="scheduleImportFile"><b>Excel 파일 선택</b><span>.xlsx</span><input id="scheduleImportFile" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"></label>
    ${model.error?`<div class="schedule-import-error">${esc(model.error)}</div>`:''}</section>`;
}

function importCandidateStep(model) {
  const regionOptions=model.regions.map((region,index)=>`<button class="schedule-import-candidate ${region.id===model.candidateRegionId?'is-selected':''}" data-import-region="${esc(region.id)}"><span><b>${esc(region.sheetName || `근무표 ${index+1}`)}</b><small>${esc(region.range || '')} · 점수 ${Number(region.score||0)}</small></span>${index===0?'<em>추천</em>':''}</button>`).join('');
  return `<section class="schedule-import-stage"><div class="schedule-import-heading"><span>근무표 선택</span><h3>적용할 범위와 시작일을 확인하세요.</h3></div>
    <div class="schedule-import-candidates">${regionOptions || '<div class="schedule-import-empty">근무표 후보를 찾지 못했습니다.</div>'}</div>
    <div class="schedule-import-fields"><label><span>대상 월</span><input id="scheduleImportMonth" type="month" value="${esc(model.targetMonth)}"></label><label><span>변경 적용 시작일</span><input id="scheduleImportEffective" type="date" min="${esc(scheduleImportToday())}" value="${esc(clampEffectiveDate(model.effectiveDate))}"></label></div>
    <p class="schedule-import-safety">적용 시작일 이전 일정과 실제 출퇴근이 발생한 일정은 자동으로 바꾸지 않습니다.</p>
    <button class="action-button primary-action" id="scheduleImportParse"><span>직원 확인으로 계속</span></button></section>`;
}

function importEmployeeStep(model) {
  const review=model.employeeMatches.filter((row)=>row.match?.needsReview);
  const safe=model.employeeMatches.filter((row)=>!row.match?.needsReview);
  const employees=(typeof activeEmployees==='function'?activeEmployees():(state?.employees||[]).filter((row)=>row.active!==false));
  const rows=model.employeeMatches.map((row)=>{
    const match=row.match || {};
    if (!match.needsReview) return `<div class="schedule-import-match is-ok"><span><b>${esc(row.label)}</b><small>${esc(match.matchedName || '')} 자동 연결</small></span><em>확인</em></div>`;
    return `<div class="schedule-import-match is-review"><span><b>${esc(row.label)}</b><small>일치하는 직원을 선택하세요.</small></span><select data-import-alias="${esc(row.label)}"><option value="">직원 선택</option>${employees.map((employee)=>`<option value="${employee.id}">${esc(employee.name)}</option>`).join('')}</select></div>`;
  }).join('');
  return `<section class="schedule-import-stage"><div class="schedule-import-heading"><span>직원 확인</span><h3>${review.length?`${review.length}명만 확인하면 됩니다.`:`${safe.length}명 모두 자동 연결됐어요.`}</h3></div><div class="schedule-import-matches">${rows || '<div class="schedule-import-empty">인식된 근무가 없습니다.</div>'}</div>
    <button class="action-button primary-action" id="scheduleImportPreview" ${review.length?'disabled':''}><span>변경사항 확인</span></button></section>`;
}


const IMPORT_STATUS_COPY={add:'신규',update:'변경',remove:'삭제',protected:'보호',needs_review:'확인 필요',unchanged:'변경 없음'};
const IMPORT_STATUS_PRIORITY=['needs_review','protected','remove','update','add'];

function importDiffRow(row) {
  const employee=row.employeeName || row.employeeLabel || '';
  const date=row.workDate || '';
  const before=Array.isArray(row.before)?row.before.map((item)=>item.scheduledStart+'~'+item.scheduledEnd).join(', '):'';
  const after=Array.isArray(row.after)?row.after.map((item)=>item.scheduledStart+'~'+item.scheduledEnd).join(', '):'';
  const detail=row.detail || (row.status==='add'?after:row.status==='remove'?before:before&&after?before+' → '+after:after||before);
  return '<div class="schedule-import-diff is-'+esc(row.status)+'"><em>'+esc(IMPORT_STATUS_COPY[row.status]||row.status)+'</em><span><b>'+esc(date)+' '+esc(employee)+'</b><small>'+esc(detail || '')+'</small></span></div>';
}

function importPreviewChanges(preview) {
  return (preview?.diff||[]).filter((row)=>row?.status && row.status!=='unchanged' && /^\d{4}-\d{2}-\d{2}$/.test(String(row.workDate||'')));
}

function importPreviewByDate(preview) {
  const grouped=new Map();
  for (const row of importPreviewChanges(preview)) {
    const date=String(row.workDate);
    if (!grouped.has(date)) grouped.set(date,[]);
    grouped.get(date).push(row);
  }
  return grouped;
}

function importCalendarMonthMeta(targetMonth) {
  const parts=String(targetMonth||'').split('-').map(Number);
  const year=parts[0], monthNumber=parts[1];
  if (!year || !monthNumber) return {year:0,month:0,days:0,firstWeekday:0};
  return {
    year,
    month:monthNumber,
    days:new Date(Date.UTC(year,monthNumber,0)).getUTCDate(),
    firstWeekday:new Date(Date.UTC(year,monthNumber-1,1)).getUTCDay(),
  };
}

function importCalendarCellStatus(rows) {
  for (const status of IMPORT_STATUS_PRIORITY) {
    if (rows.some((row)=>row.status===status)) return status;
  }
  return rows[0]?.status || '';
}

function importCalendarMiniRows(rows) {
  return rows.slice(0,2).map((row)=>{
    const employee=row.employeeName || row.employeeLabel || '직원';
    const after=Array.isArray(row.after)&&row.after.length?row.after[0]:null;
    const before=Array.isArray(row.before)&&row.before.length?row.before[0]:null;
    const shift=after||before;
    const time=shift?.scheduledStart&&shift?.scheduledEnd?shift.scheduledStart+'–'+shift.scheduledEnd:'';
    return '<span class="schedule-import-calendar-mini is-'+esc(row.status)+'"><b>'+esc(employee)+'</b>'+(time?'<small>'+esc(time)+'</small>':'')+'</span>';
  }).join('');
}

function importPreviewCalendar(preview,targetMonth,selectedDate) {
  const grouped=importPreviewByDate(preview);
  const meta=importCalendarMonthMeta(targetMonth);
  if (!meta.days) return '<div class="schedule-import-empty">달력을 표시할 수 없습니다.</div>';
  const weekday=['일','월','화','수','목','금','토'].map((day)=>'<span>'+day+'</span>').join('');
  const cells=[];
  for(let blank=0;blank<meta.firstWeekday;blank++) cells.push('<span class="schedule-import-calendar-day is-blank" aria-hidden="true"></span>');
  for(let day=1;day<=meta.days;day++){
    const date=meta.year+'-'+String(meta.month).padStart(2,'0')+'-'+String(day).padStart(2,'0');
    const rows=grouped.get(date)||[];
    const status=importCalendarCellStatus(rows);
    const isSelected=date===selectedDate;
    const classes=['schedule-import-calendar-day',rows.length?'has-changes':'is-empty',status?'is-'+status:'',isSelected?'is-selected':''].filter(Boolean).join(' ');
    const count=rows.length?'<span class="schedule-import-calendar-count">'+rows.length+'건</span>':'';
    const mini=rows.length?'<span class="schedule-import-calendar-mini-list">'+importCalendarMiniRows(rows)+(rows.length>2?'<small class="schedule-import-calendar-more">+'+(rows.length-2)+'</small>':'')+'</span>':'';
    cells.push('<button type="button" class="'+classes+'" data-import-preview-date="'+date+'" '+(rows.length?'':'disabled')+'><span class="schedule-import-calendar-date">'+day+'</span>'+count+mini+'</button>');
  }
  return '<div class="schedule-import-calendar-wrap"><div class="schedule-import-calendar-title"><b>'+meta.year+'년 '+meta.month+'월</b><span>변경 있는 날짜를 눌러 상세 확인</span></div><div class="schedule-import-calendar-weekdays">'+weekday+'</div><div class="schedule-import-calendar">'+cells.join('')+'</div></div>';
}

function importSelectedDateDetail(preview,selectedDate) {
  const grouped=importPreviewByDate(preview);
  const rows=grouped.get(selectedDate)||[];
  if (!selectedDate || !rows.length) return '<div class="schedule-import-calendar-hint">변경이 있는 날짜를 선택하면 그날 일정만 표시됩니다.</div>';
  return '<div class="schedule-import-selected"><div class="schedule-import-selected-heading"><b>'+esc(selectedDate)+'</b><span>'+rows.length+'건</span></div><div class="schedule-import-diffs">'+rows.map(importDiffRow).join('')+'</div></div>';
}

function importPreviewStep(model) {
  const preview=model.preview || buildImportPreviewModel({sourceType:model.sourceType,targetMonth:model.targetMonth,effectiveDate:model.effectiveDate,diff:[]});
  const summary=preview.summary || emptyImportSummary();
  const actionable=summary.add+summary.update+summary.remove;
  const changes=importPreviewChanges(preview);
  const firstDate=changes.map((row)=>String(row.workDate||'')).sort()[0] || '';
  if (!model.previewSelectedDate || !changes.some((row)=>row.workDate===model.previewSelectedDate)) model.previewSelectedDate=firstDate;
  return '<section class="schedule-import-stage"><div class="schedule-import-heading"><span>변경사항 확인</span><h3>캘린더로 한눈에 확인하세요.</h3><p>전체 목록을 내리지 않고 날짜를 눌러 그날 변경만 확인할 수 있습니다.</p></div>'
    +'<div class="schedule-import-summary"><div><b>'+summary.add+'</b><span>신규</span></div><div><b>'+summary.update+'</b><span>변경</span></div><div><b>'+summary.remove+'</b><span>삭제</span></div><div><b>'+summary.protected+'</b><span>보호</span></div><div><b>'+summary.needs_review+'</b><span>확인 필요</span></div></div>'
    +(changes.length?importPreviewCalendar(preview,model.targetMonth,model.previewSelectedDate):'<div class="schedule-import-empty">변경할 일정이 없습니다.</div>')
    +'<div id="scheduleImportSelectedDetail">'+importSelectedDateDetail(preview,model.previewSelectedDate)+'</div>'
    +'<div class="schedule-import-apply-bar"><span>'+(actionable?'적용 예정 '+actionable+'건':'적용할 변경 없음')+'</span><button class="action-button primary-action" id="scheduleImportApply" '+(!actionable||summary.needs_review?'disabled':'')+'><span>변경사항 적용</span></button></div></section>';
}

function renderScheduleImportStep(model=scheduleImportState) {
  if (!model) model=defaultScheduleImportState();
  const body=model.step===2?importCandidateStep(model):model.step===3?importEmployeeStep(model):model.step===4?importPreviewStep(model):importFileStep(model);
  return `<div class="schedule-import"><div class="sheet-heading"><div><span class="sheet-kicker">근무표 가져오기</span><h2>${esc(importStepLabel(model.step))}</h2><p>기존 Excel 근무표를 앱 일정으로 변환합니다.</p></div></div>${importStepper(model.step)}${body}</div>`;
}

function reopenScheduleImport() {
  if (typeof dismissLayer==='function') dismissLayer(document.querySelector?.('.sheet-backdrop'));
  setTimeout(()=>openScheduleImport(scheduleImportState),80);
}

function uniqueEmployeeLabels(rows) {
  return [...new Set((rows||[]).map((row)=>String(row.employeeLabel||'').trim()).filter(Boolean))];
}

async function loadScheduleImportAliases() {
  if (typeof api?.listScheduleImportAliases !== 'function' || !session?.token) return scheduleImportState.aliases;
  try {
    const result=await api.listScheduleImportAliases(session.token);
    const loaded={};
    for (const row of result?.aliases || []) {
      const employeeId=String(row?.employee_id || '').trim();
      const originalLabel=String(row?.original_label || '').trim();
      const labelKey=String(row?.label_key || '').trim();
      if (!employeeId) continue;
      if (originalLabel) loaded[originalLabel]=employeeId;
      if (labelKey) loaded[labelKey]=employeeId;
    }
    scheduleImportState.aliases={...loaded,...scheduleImportState.aliases};
  } catch (error) {
    console.warn('Saved schedule import aliases unavailable:',error);
  }
  return scheduleImportState.aliases;
}

function rematchScheduleImportRows() {
  const employees=typeof activeEmployees==='function'?activeEmployees():(state?.employees||[]).filter((row)=>row.active!==false);
  scheduleImportState.employeeMatches=uniqueEmployeeLabels(scheduleImportState.shifts).map((label)=>({label,match:ScheduleImportCore.matchEmployeeLabel(label,employees,scheduleImportState.aliases)}));
  const byLabel=new Map(scheduleImportState.employeeMatches.filter((item)=>item.match?.employeeId).map((item)=>[item.label,item.match.employeeId]));
  scheduleImportState.shifts=scheduleImportState.shifts.map((row)=>byLabel.has(row.employeeLabel)?{...row,employeeId:byLabel.get(row.employeeLabel)}:row);
}

async function handleScheduleImportFile(file) {
  if (!file) return;
  const name=String(file.name||'');
  const ext=name.toLowerCase().split('.').pop();
  scheduleImportState.file=file;
  scheduleImportState.sourceName=name;
  scheduleImportState.error='';
  if (ext!=='xlsx') throw new Error('지원 형식은 .xlsx 입니다.');
  if (typeof XLSX==='undefined' || !ScheduleImportCore) throw new Error('Excel 분석 모듈을 불러오지 못했습니다.');
  const buffer=await file.arrayBuffer();
  scheduleImportState.sourceType='xlsx';
  scheduleImportState.sourceFingerprint=await ScheduleImportCore.fingerprintArrayBuffer(buffer);
  scheduleImportState.workbook=XLSX.read(buffer,{type:'array',cellStyles:true,cellDates:true});
  scheduleImportState.regions=ScheduleImportCore.detectScheduleRegions(scheduleImportState.workbook,XLSX);
  if (!scheduleImportState.regions.length) throw new Error('근무표로 보이는 영역을 찾지 못했습니다.');
  scheduleImportState.candidateRegionId=scheduleImportState.regions[0].id;
  scheduleImportState.authoritative=scheduleImportState.regions[0].authoritative===true;
  scheduleImportState.step=2;
  reopenScheduleImport();
}

async function parseSelectedScheduleImportRegion() {
  scheduleImportState.targetMonth=document.querySelector?.('#scheduleImportMonth')?.value || scheduleImportState.targetMonth;
  scheduleImportState.effectiveDate=clampEffectiveDate(document.querySelector?.('#scheduleImportEffective')?.value || scheduleImportState.effectiveDate);
  const region=scheduleImportState.regions.find((item)=>item.id===scheduleImportState.candidateRegionId) || scheduleImportState.regions[0];
  if (!region) throw new Error('근무표 영역을 선택해 주세요.');
  scheduleImportState.authoritative=region.authoritative===true;
  const weekly=ScheduleImportCore.parseScheduleRegion(scheduleImportState.workbook,XLSX,region);
  scheduleImportState.parsedRows=weekly;
  scheduleImportState.shifts=ScheduleImportCore.expandWeeklyPattern(weekly,scheduleImportState.targetMonth,scheduleImportState.effectiveDate);
  await loadScheduleImportAliases();
  rematchScheduleImportRows();
  scheduleImportState.step=3;
}

async function requestScheduleImportPreview() {
  const unresolved=scheduleImportState.employeeMatches.filter((row)=>row.match?.needsReview);
  if (unresolved.length) throw new Error('확인이 필요한 직원을 먼저 연결해 주세요.');
  const result=await api.previewScheduleImport(session.token,{
    sourceType:scheduleImportState.sourceType,sourceName:scheduleImportState.sourceName,sourceFingerprint:scheduleImportState.sourceFingerprint,
    targetMonth:scheduleImportState.targetMonth,effectiveDate:clampEffectiveDate(scheduleImportState.effectiveDate),authoritative:scheduleImportState.authoritative,shifts:scheduleImportState.shifts,
  });
  scheduleImportState.preview=buildImportPreviewModel({...result,sourceType:scheduleImportState.sourceType,targetMonth:scheduleImportState.targetMonth,effectiveDate:scheduleImportState.effectiveDate,authoritative:scheduleImportState.authoritative,diff:result?.diff||[]});
  const firstPreviewDate=importPreviewChanges(scheduleImportState.preview).map((row)=>String(row.workDate||'')).sort()[0] || '';
  scheduleImportState.previewSelectedDate=firstPreviewDate;
  scheduleImportState.runId=result?.runId || '';
  scheduleImportState.step=4;
}

async function applyScheduleImportChanges() {
  const result=await api.applyScheduleImport(session.token,{
    runId:scheduleImportState.runId,sourceType:scheduleImportState.sourceType,sourceName:scheduleImportState.sourceName,sourceFingerprint:scheduleImportState.sourceFingerprint,
    targetMonth:scheduleImportState.targetMonth,effectiveDate:clampEffectiveDate(scheduleImportState.effectiveDate),authoritative:scheduleImportState.authoritative,shifts:scheduleImportState.shifts,
  });
  return result;
}

function bindScheduleImportSheet() {
  const file=document.querySelector?.('#scheduleImportFile');
  if (file) file.onchange=async(event)=>{try{setPending?.(event.target,true,'분석 중');await handleScheduleImportFile(event.target.files?.[0]);}catch(error){scheduleImportState.error=error.message;toastMsg?.(error.message);reopenScheduleImport();}};
  document.querySelectorAll?.('[data-import-region]').forEach((button)=>{button.onclick=()=>{scheduleImportState.candidateRegionId=button.dataset.importRegion;reopenScheduleImport();};});
  const parseButton=document.querySelector?.('#scheduleImportParse');
  if (parseButton) parseButton.onclick=async()=>{setPending?.(parseButton,true,'확인 중');try{await parseSelectedScheduleImportRegion();reopenScheduleImport();}catch(error){toastMsg?.(error.message);}finally{if(parseButton?.isConnected)setPending?.(parseButton,false);}};
  document.querySelectorAll?.('[data-import-alias]').forEach((select)=>{select.onchange=async()=>{const label=select.dataset.importAlias;const employeeId=select.value;if(!employeeId)return;scheduleImportState.aliases[label]=employeeId;try{await api.saveScheduleImportAlias(session.token,{label,employeeId});}catch(error){console.warn('Alias save skipped:',error);}rematchScheduleImportRows();reopenScheduleImport();};});
  const preview=document.querySelector?.('#scheduleImportPreview');
  if(preview) preview.onclick=async()=>{setPending?.(preview,true,'비교 중');try{await requestScheduleImportPreview();reopenScheduleImport();}catch(error){toastMsg?.(error.message);}finally{if(preview?.isConnected)setPending?.(preview,false);}};
  document.querySelectorAll?.('[data-import-preview-date]').forEach((button)=>{button.onclick=()=>{
    scheduleImportState.previewSelectedDate=button.dataset.importPreviewDate||'';
    document.querySelectorAll?.('[data-import-preview-date]').forEach((cell)=>cell.classList?.toggle('is-selected',cell.dataset.importPreviewDate===scheduleImportState.previewSelectedDate));
    const detail=document.querySelector?.('#scheduleImportSelectedDetail');
    if(detail) detail.innerHTML=importSelectedDateDetail(scheduleImportState.preview,scheduleImportState.previewSelectedDate);
  };});
  const apply=document.querySelector?.('#scheduleImportApply');
  if(apply) apply.onclick=async()=>{setPending?.(apply,true,'적용 중');try{const result=await applyScheduleImportChanges();await load(scheduleImportState.targetMonth);renderAdmin();dismissLayer?.(document.querySelector?.('.sheet-backdrop'));toastMsg?.(`근무표를 적용했습니다. ${Number(result?.summary?.add||0)+Number(result?.summary?.update||0)}건 반영`);}catch(error){toastMsg?.(error.message);}finally{if(apply?.isConnected)setPending?.(apply,false);}};
}

function openScheduleImport(existingState=null) {
  if (session?.role !== 'admin') return typeof toastMsg==='function' ? toastMsg('관리자만 근무표를 가져올 수 있습니다.') : undefined;
  scheduleImportState=existingState || defaultScheduleImportState();
  openSheet(renderScheduleImportStep(scheduleImportState),{size:'schedule-import-sheet'});
  bindScheduleImportSheet();
}

if (typeof adminScheduleWorkspace === 'function') {
  const baseAdminScheduleWorkspaceForImport=adminScheduleWorkspace;
  adminScheduleWorkspace=function adminScheduleWorkspaceWithImport() {
    const html=baseAdminScheduleWorkspaceForImport();
    if (html.includes('id="adminScheduleImport"')) return html;
    return html.replace('<div class="admin-work-actions">','<div class="admin-work-actions"><button class="admin-secondary-cta schedule-import-entry" id="adminScheduleImport"><span>근무표 가져오기</span></button>');
  };
}

if (typeof bindAdminWork === 'function') {
  const baseBindAdminWorkForImport=bindAdminWork;
  bindAdminWork=function bindAdminWorkWithImport() {
    baseBindAdminWorkForImport();
    document.querySelector?.('#adminScheduleImport')?.addEventListener('click',()=>openScheduleImport());
  };
}
