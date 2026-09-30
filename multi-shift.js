const SCHEDULE_TOOLS_BASE = 'https://ndczsguqlwyiuqvsmvcb.supabase.co/functions/v1/attendance-schedule-tools';

if (typeof api !== 'undefined' && typeof externalRequest === 'function') {
  api.listExtraSchedules = (token, targetMonth) =>
    externalRequest(`${SCHEDULE_TOOLS_BASE}?month=${encodeURIComponent(targetMonth)}`, { token });
  api.saveExtraSchedule = (token, payload) =>
    externalRequest(SCHEDULE_TOOLS_BASE, { method:'POST', token, body:{ action:'save_extra', ...payload } });
  api.deleteExtraSchedule = (token, id) =>
    externalRequest(SCHEDULE_TOOLS_BASE, { method:'POST', token, body:{ action:'delete_extra', id } });
  api.syncChecklists = (token, payload = {}) =>
    externalRequest(SCHEDULE_TOOLS_BASE, { method:'POST', token, body:{ action:'sync_checklists', ...payload } });

  if (typeof api.bulkSchedule === 'function') {
    const baseBulkSchedule = api.bulkSchedule;
    api.bulkSchedule = async (token, payload) => {
      const result = await baseBulkSchedule(token, payload);
      try {
        const targetMonth = String(payload?.workDates?.[0] || '').slice(0,7);
        await api.syncChecklists(token, { month:targetMonth, employeeId:payload?.employeeId });
      } catch (error) {
        console.warn('Checklist sync after schedule save skipped:', error);
      }
      return result;
    };
  }

  if (typeof api.saveChecklistTemplate === 'function') {
    const baseSaveChecklistTemplate = api.saveChecklistTemplate;
    api.saveChecklistTemplate = async (token, payload) => {
      const result = await baseSaveChecklistTemplate(token, payload);
      try {
        const targetMonth = typeof month === 'string' ? month : kstDate().slice(0,7);
        await api.syncChecklists(token, { month:targetMonth });
      } catch (error) {
        console.warn('Checklist sync after template save skipped:', error);
      }
      return result;
    };
  }
}

function extraSchedulesFor(date, employeeId = '') {
  return (state?.extraSchedules || [])
    .filter((row) => row.workDate === date && (!employeeId || row.employeeId === employeeId))
    .slice()
    .sort((a,b) => String(a.scheduledStart).localeCompare(String(b.scheduledStart)));
}

function multiShiftBaseCard(row) {
  const employee = employeeById(row.employeeId);
  return `<section class="date-schedule-card multi-shift-card is-base">
    <div class="date-schedule-person">
      <span class="avatar">${esc(employee?.name?.slice(0,1) || '?')}</span>
      <div><b>${esc(employee?.name || '직원')}</b><small>기본 근무 · ${esc(employee?.position || '스태프')}</small></div>
      <span class="multi-shift-badge">기본 근무</span>
    </div>
    <div class="date-schedule-fields">
      <label><span>출근</span><input id="dateScheduleStart_${row.employeeId}" type="time" value="${esc(row.scheduledStart)}"></label>
      <label><span>퇴근</span><input id="dateScheduleEnd_${row.employeeId}" type="time" value="${esc(row.scheduledEnd)}"></label>
      <label class="date-schedule-shift"><span>근무 유형</span><select id="dateScheduleShift_${row.employeeId}">${dateToolShiftOptions(row.shiftType)}</select></label>
    </div>
    <div class="date-schedule-actions">
      <button class="row-action" data-extra-schedule-add-for="${row.employeeId}">+ 추가 근무</button>
      <button class="row-action destructive-text" data-date-schedule-delete="${row.employeeId}">삭제</button>
      <button class="row-action primary-text" data-date-schedule-save="${row.employeeId}">수정 저장</button>
    </div>
  </section>`;
}

function multiShiftExtraCard(row) {
  const employee = employeeById(row.employeeId);
  return `<section class="date-schedule-card multi-shift-card is-extra">
    <div class="date-schedule-person">
      <span class="avatar">${esc(employee?.name?.slice(0,1) || '?')}</span>
      <div><b>${esc(employee?.name || '직원')}</b><small>추가 근무 · ${esc(employee?.position || '스태프')}</small></div>
      <span class="multi-shift-badge is-extra">추가 근무</span>
    </div>
    <div class="date-schedule-fields">
      <label><span>출근</span><input id="extraScheduleStart_${row.id}" type="time" value="${esc(row.scheduledStart)}"></label>
      <label><span>퇴근</span><input id="extraScheduleEnd_${row.id}" type="time" value="${esc(row.scheduledEnd)}"></label>
      <label class="date-schedule-shift"><span>근무 유형</span><select id="extraScheduleShift_${row.id}">${dateToolShiftOptions(row.shiftType)}</select></label>
    </div>
    <div class="date-schedule-actions">
      <button class="row-action destructive-text" data-extra-schedule-delete="${row.id}">삭제</button>
      <button class="row-action primary-text" data-extra-schedule-save="${row.id}">수정 저장</button>
    </div>
  </section>`;
}

function multiShiftScheduleEditorMarkup(date) {
  const baseAssignments = (state?.schedules || [])
    .filter((row) => row.workDate === date)
    .slice()
    .sort((a,b) => String(a.scheduledStart).localeCompare(String(b.scheduledStart)));
  const extras = extraSchedulesFor(date);
  const baseEmployeeIds = new Set(baseAssignments.map((row) => row.employeeId));
  const addableBase = activeEmployees().filter((employee) => !baseEmployeeIds.has(employee.id));
  const allEmployees = activeEmployees();

  const rows = [
    ...baseAssignments.map(multiShiftBaseCard),
    ...extras.map(multiShiftExtraCard),
  ].join('') || '<div class="date-attendance-empty"><b>아직 배정된 근무가 없습니다.</b><span>아래에서 기본 근무 또는 추가 근무를 등록해 주세요.</span></div>';

  const baseBlock = addableBase.length ? `<section class="date-schedule-add multi-shift-add-block">
    <div class="section-heading compact"><div><span>기본 근무</span><h3>직원 배정</h3></div></div>
    <label><span>직원</span><select id="dateScheduleAddEmployee"><option value="">직원 선택</option>${addableBase.map((employee)=>`<option value="${employee.id}">${esc(employee.name)} · ${esc(employee.position || '스태프')}</option>`).join('')}</select></label>
    <div class="date-schedule-fields">
      <label><span>출근</span><input id="dateScheduleAddStart" type="time" value="09:00"></label>
      <label><span>퇴근</span><input id="dateScheduleAddEnd" type="time" value="18:00"></label>
      <label class="date-schedule-shift"><span>근무 유형</span><select id="dateScheduleAddShift">${dateToolShiftOptions('other')}</select></label>
    </div>
    <button class="action-button secondary-action" id="dateScheduleAdd"><span>기본 근무 추가</span></button>
  </section>` : '';

  const extraBlock = allEmployees.length ? `<section class="date-schedule-add multi-shift-add-block is-extra" id="extraScheduleComposer">
    <div class="section-heading compact"><div><span>같은 날 두 번째 근무</span><h3>+ 추가 근무</h3></div></div>
    <p class="multi-shift-helper">기본 근무가 이미 있어도 같은 직원을 다시 선택할 수 있어요.</p>
    <label><span>직원</span><select id="extraScheduleAddEmployee"><option value="">직원 선택</option>${allEmployees.map((employee)=>`<option value="${employee.id}">${esc(employee.name)} · ${esc(employee.position || '스태프')}</option>`).join('')}</select></label>
    <div class="date-schedule-fields">
      <label><span>출근</span><input id="extraScheduleAddStart" type="time" value="18:00"></label>
      <label><span>퇴근</span><input id="extraScheduleAddEnd" type="time" value="22:00"></label>
      <label class="date-schedule-shift"><span>근무 유형</span><select id="extraScheduleAddShift">${dateToolShiftOptions('other')}</select></label>
    </div>
    <button class="action-button primary-action" id="extraScheduleAdd"><span>+ 추가 근무 등록</span></button>
  </section>` : '';

  return `<div class="sheet-heading"><div><span class="sheet-kicker">선택 날짜 근무 편집</span><h2>${esc(longDate(date))}</h2><p>기본 근무와 같은 날의 추가 근무를 각각 관리할 수 있습니다.</p></div></div>
    <div class="date-schedule-list multi-shift-list">${rows}</div>${baseBlock}${extraBlock}`;
}

async function refreshMultiShiftContext(date) {
  if (typeof refreshSelectedDateContext === 'function') {
    await refreshSelectedDateContext(date);
    return;
  }
  await load(String(date || month).slice(0,7));
}

async function saveExtraScheduleRow(id, date) {
  const row=(state?.extraSchedules || []).find((item)=>item.id===id);
  if (!row) return;
  const start=document.getElementById(`extraScheduleStart_${id}`)?.value || '';
  const end=document.getElementById(`extraScheduleEnd_${id}`)?.value || '';
  const shiftType=document.getElementById(`extraScheduleShift_${id}`)?.value || 'other';
  if (!start || !end || start >= end) return toastMsg('추가 근무 시간을 확인해 주세요.');
  const button=document.querySelector(`[data-extra-schedule-save="${id}"]`);
  setPending(button,true,'저장 중');
  try {
    await api.saveExtraSchedule(session.token,{id,employeeId:row.employeeId,workDate:date,scheduledStart:start,scheduledEnd:end,shiftType});
    await refreshMultiShiftContext(date);
    dismissLayer(document.querySelector('.sheet-backdrop'));
    renderAdmin();
    toastMsg('추가 근무를 수정했습니다.');
    setTimeout(()=>openSelectedDateScheduleEditor(date),170);
  } catch(error) { toastMsg(error.message); }
  finally { if(button?.isConnected) setPending(button,false); }
}

async function addExtraSchedule(date) {
  const employeeId=document.querySelector('#extraScheduleAddEmployee')?.value || '';
  const scheduledStart=document.querySelector('#extraScheduleAddStart')?.value || '';
  const scheduledEnd=document.querySelector('#extraScheduleAddEnd')?.value || '';
  const shiftType=document.querySelector('#extraScheduleAddShift')?.value || 'other';
  if (!employeeId) return toastMsg('추가 근무 직원을 선택해 주세요.');
  if (!scheduledStart || !scheduledEnd || scheduledStart >= scheduledEnd) return toastMsg('추가 근무 시간을 확인해 주세요.');
  const button=document.querySelector('#extraScheduleAdd');
  setPending(button,true,'추가 중');
  try {
    await api.saveExtraSchedule(session.token,{employeeId,workDate:date,scheduledStart,scheduledEnd,shiftType});
    await refreshMultiShiftContext(date);
    dismissLayer(document.querySelector('.sheet-backdrop'));
    renderAdmin();
    toastMsg('같은 날 추가 근무를 등록했습니다.'); haptic(8);
    setTimeout(()=>openSelectedDateScheduleEditor(date),170);
  } catch(error) { toastMsg(error.message); }
  finally { if(button?.isConnected) setPending(button,false); }
}

async function deleteExtraSchedule(id,date) {
  try {
    await api.deleteExtraSchedule(session.token,id);
    await refreshMultiShiftContext(date);
    dismissLayer(document.querySelector('.sheet-backdrop'));
    renderAdmin();
    toastMsg('추가 근무를 삭제했습니다.');
    setTimeout(()=>openSelectedDateScheduleEditor(date),170);
  } catch(error) { toastMsg(error.message); }
}

function focusExtraScheduleComposer(employeeId) {
  const select=document.querySelector('#extraScheduleAddEmployee');
  if (select) select.value=employeeId;
  document.querySelector('#extraScheduleComposer')?.scrollIntoView({behavior:'smooth',block:'center'});
  setTimeout(()=>document.querySelector('#extraScheduleAddStart')?.focus(),180);
}

function bindMultiShiftScheduleEditor(date) {
  document.querySelectorAll('[data-date-schedule-save]').forEach((button)=>{
    button.onclick=()=>saveSelectedDateSchedule(button.dataset.dateScheduleSave,date);
  });
  document.querySelectorAll('[data-date-schedule-delete]').forEach((button)=>{
    button.onclick=()=>deleteSelectedDateSchedule(button.dataset.dateScheduleDelete,date,false);
  });
  document.querySelector('#dateScheduleAdd')?.addEventListener('click',()=>addSelectedDateSchedule(date));
  document.querySelectorAll('[data-extra-schedule-save]').forEach((button)=>{
    button.onclick=()=>saveExtraScheduleRow(button.dataset.extraScheduleSave,date);
  });
  document.querySelectorAll('[data-extra-schedule-delete]').forEach((button)=>{
    button.onclick=()=>deleteExtraSchedule(button.dataset.extraScheduleDelete,date);
  });
  document.querySelectorAll('[data-extra-schedule-add-for]').forEach((button)=>{
    button.onclick=()=>focusExtraScheduleComposer(button.dataset.extraScheduleAddFor);
  });
  document.querySelector('#extraScheduleAdd')?.addEventListener('click',()=>addExtraSchedule(date));
}

if (typeof openSelectedDateScheduleEditor === 'function') {
  openSelectedDateScheduleEditor = function openMultiShiftScheduleEditor(date) {
    openSheet(multiShiftScheduleEditorMarkup(date),{size:'compact date-schedule-editor-sheet multi-shift-editor-sheet'});
    bindMultiShiftScheduleEditor(date);
  };
}

function plannedExtraShiftMarkup(employeeId,date) {
  const extras=extraSchedulesFor(date,employeeId);
  if (!extras.length) return '';
  return `<section class="planned-extra-shifts"><div class="section-heading compact"><div><span>오늘 일정</span><h3>추가 근무 예정</h3></div><small>${extras.length}구간</small></div>
    <div class="planned-extra-list">${extras.map((row)=>`<div class="planned-extra-row"><b>${esc(row.scheduledStart)}–${esc(row.scheduledEnd)}</b><span>${esc(shiftTypeLabel(row.shiftType))}</span></div>`).join('')}</div>
  </section>`;
}

if (typeof renderStaff === 'function') {
  const baseRenderStaffForMultiShift = renderStaff;
  renderStaff = function renderStaffWithExtraSchedule() {
    baseRenderStaffForMultiShift();
    const employeeId=session?.employeeId;
    const html=employeeId ? plannedExtraShiftMarkup(employeeId,kstDate()) : '';
    if (!html) return;
    const target=document.querySelector('[data-checklist-area]') || document.querySelector('.bottom-tabs');
    target?.insertAdjacentHTML('beforebegin',html);
  };
}

if (typeof load === 'function' && typeof api?.listExtraSchedules === 'function') {
  const baseLoadForMultiShift = load;
  let multiShiftLoading=false;

  load = async function loadWithExtraSchedules(targetMonth = month) {
    await baseLoadForMultiShift(targetMonth);
    if (!session?.token || !state) return;
    try {
      const extraResult=await api.listExtraSchedules(session.token,targetMonth);
      state.extraSchedules=extraResult?.extraSchedules || [];
      if (!multiShiftLoading) {
        multiShiftLoading=true;
        const payload=session?.role === 'staff'
          ? {month:targetMonth,employeeId:session.employeeId,workDate:kstDate()}
          : {month:targetMonth};
        const synced=await api.syncChecklists(session.token,payload);
        if (Number(synced?.created || 0) > 0) {
          await baseLoadForMultiShift(targetMonth);
          const refreshed=await api.listExtraSchedules(session.token,targetMonth);
          state.extraSchedules=refreshed?.extraSchedules || [];
        }
      }
    } catch(error) {
      state.extraSchedules=state.extraSchedules || [];
      console.warn('Extra schedule load skipped:',error);
    } finally {
      multiShiftLoading=false;
    }
  };
}
