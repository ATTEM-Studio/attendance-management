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
function importDiffRow(row) {
  const employee=row.employeeName || row.employeeLabel || '';
  const date=row.workDate || '';
  const before=Array.isArray(row.before)?row.before.map((item)=>`${item.scheduledStart}~${item.scheduledEnd}`).join(', '):'';
  const after=Array.isArray(row.after)?row.after.map((item)=>`${item.scheduledStart}~${item.scheduledEnd}`).join(', '):'';
  const detail=row.detail || (row.status==='add'?after:row.status==='remove'?before:before&&after?`${before} → ${after}`:after||before);
  return `<div class="schedule-import-diff is-${esc(row.status)}"><em>${esc(IMPORT_STATUS_COPY[row.status]||row.status)}</em><span><b>${esc(date)} ${esc(employee)}</b><small>${esc(detail || '')}</small></span></div>`;
}

function importPreviewStep(model) {
  const preview=model.preview || buildImportPreviewModel({sourceType:model.sourceType,targetMonth:model.targetMonth,effectiveDate:model.effectiveDate,diff:[]});
  const s=preview.summary || emptyImportSummary();
  const actionable=s.add+s.update+s.remove;
  return `<section class="schedule-import-stage"><div class="schedule-import-heading"><span>변경사항 확인</span><h3>적용 전에 달라지는 일정만 확인하세요.</h3></div>
    <div class="schedule-import-summary"><div><b>${s.add}</b><span>신규</span></div><div><b>${s.update}</b><span>변경</span></div><div><b>${s.remove}</b><span>삭제</span></div><div><b>${s.protected}</b><span>보호</span></div><div><b>${s.needs_review}</b><span>확인 필요</span></div></div>
    <div class="schedule-import-diffs">${(preview.diff||[]).map(importDiffRow).join('') || '<div class="schedule-import-empty">변경할 일정이 없습니다.</div>'}</div>
    <button class="action-button primary-action" id="scheduleImportApply" ${!actionable||s.needs_review?'disabled':''}><span>변경사항 적용</span></button></section>`;
}

function renderScheduleImportStep(model=scheduleImportState) {
  if (!model) model=defaultScheduleImportState();
  const body=model.step===2?importCandidateStep(model):model.step===3?importEmployeeStep(model):model.step===4?importPreviewStep(model):importFileStep(model);
  return `<div class="schedule-import"><div class="sheet-heading"><div><span class="sheet-kicker">근무표 가져오기</span><h2>${esc(importStepLabel(model.step))}</h2><p>기존 Excel·사진 시간표를 앱 일정으로 변환합니다.</p></div></div>${importStepper(model.step)}${body}</div>`;
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
