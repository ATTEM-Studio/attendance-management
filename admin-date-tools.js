/* Selected-date attendance and schedule quick tools */
const MANUAL_ATTENDANCE_BASE = 'https://ndczsguqlwyiuqvsmvcb.supabase.co/functions/v1/attendance-manual-create';
const DATE_TOOL_SHIFT_OPTIONS = [
  ['open','오픈'], ['middle','미들'], ['close','마감'],
  ['open_middle','오픈+미들'], ['middle_close','미들+마감'], ['other','기타'],
];

if (typeof api !== 'undefined' && typeof externalRequest === 'function') {
  api.createManualAttendance = (token, payload) => externalRequest(MANUAL_ATTENDANCE_BASE, { method:'POST', token, body:payload });
}

function selectedDateAttendanceSessions(employeeId, date) {
  return (state?.attendance || [])
    .filter((row) => row.employeeId === employeeId && row.workDate === date)
    .slice()
    .sort((a,b) => Number(a.sessionNo || 1) - Number(b.sessionNo || 1));
}

function selectedDateAttendanceStatus(employeeId, date) {
  const sessions = selectedDateAttendanceSessions(employeeId, date);
  if (!sessions.length) return { label:'근태 기록 없음', tone:'is-missing' };
  const open = sessions.find((row) => row.clockIn && !row.clockOut);
  if (open) return { label:`실제 ${fmtTime(open.clockIn)}–미퇴근`, tone:'is-warning' };
  const latest = sessions[sessions.length - 1];
  const prefix = sessions.length > 1 ? `${sessions.length}구간 · ` : '';
  return { label:`${prefix}실제 ${fmtTime(latest.clockIn)}–${fmtTime(latest.clockOut)}`, tone:'is-complete' };
}

function adminScheduleInspector() {
  const date = adminWorkSelectedDate;
  const assignments = (state.schedules || []).filter((row) => row.workDate === date).slice().sort((a,b) => a.scheduledStart.localeCompare(b.scheduledStart));
  const dateLabel = date ? longDate(date) : '';
  return `<aside class="admin-schedule-inspector">
    <div class="admin-inspector-heading"><span>선택 날짜</span><h3>${date ? esc(dateLabel) : '날짜를 선택하세요'}</h3></div>
    ${date ? `<div class="admin-inspector-list">${assignments.length ? assignments.map((row) => {
      const employee = employeeById(row.employeeId);
      const actual = selectedDateAttendanceStatus(row.employeeId, date);
      return `<button class="admin-inspector-row admin-inspector-person" data-selected-attendance="${row.employeeId}|${date}"><span class="avatar">${esc(employee?.name?.slice(0,1) || '?')}</span><span class="admin-inspector-person-copy"><b>${esc(employee?.name || '직원')}</b><small>${esc(row.scheduledStart)}–${esc(row.scheduledEnd)} · ${esc(shiftTypeLabel(row.shiftType))}</small><em class="${actual.tone}">${esc(actual.label)}</em></span>${icon('chevron','chevron')}</button>`;
    }).join('') : '<div class="admin-empty-state compact"><b>배정된 근무가 없어요.</b><span>이 날짜에 첫 근무를 배정해 보세요.</span></div>'}</div>
      <button class="action-button primary-action admin-inspector-action" id="adminScheduleManage"><span>${assignments.length ? '근무 추가·수정' : '근무 배정'}</span></button>` : '<div class="admin-empty-state"><b>근무를 확인하거나 배정할 날짜를 선택하세요.</b><span>달력에서 날짜를 누르면 배정된 직원을 볼 수 있어요.</span></div>'}
  </aside>`;
}

function selectedDateAttendanceSheetMarkup(employeeId, date) {
  const employee = employeeById(employeeId);
  if (!employee || !date) return '';
  const schedule = (state.schedules || []).find((row) => row.employeeId === employeeId && row.workDate === date);
  const sessions = selectedDateAttendanceSessions(employeeId, date);
  const scheduleText = schedule ? `${schedule.scheduledStart}–${schedule.scheduledEnd} · ${shiftTypeLabel(schedule.shiftType)}` : '배정된 근무 없음';
  const records = sessions.length ? sessions.map((row) => `<div class="date-attendance-record"><div><span>${esc(sessionLabel(row))}</span><b>출근 ${esc(fmtTime(row.clockIn))} · 퇴근 ${row.clockOut ? esc(fmtTime(row.clockOut)) : '미기록'}</b><small>근무 ${Number(row.workMinutes || 0)}분${Number(row.lateMinutes || 0) ? ` · 지각 ${Number(row.lateMinutes)}분` : ''}</small></div><button class="row-action" data-date-attendance-edit="${row.id}|${employeeId}|${date}">시간 수정</button></div>`).join('') : `<div class="date-attendance-empty"><b>근태 기록이 없습니다.</b><span>실제 출퇴근 시간을 확인한 뒤 수동으로 추가할 수 있어요.</span></div>${field({ id:'manualAttendanceClockIn', label:'실제 출근', type:'time', value:schedule?.scheduledStart || '09:00' })}${field({ id:'manualAttendanceClockOut', label:'실제 퇴근', type:'time', value:schedule?.scheduledEnd || '18:00' })}${field({ id:'manualAttendanceReason', label:'입력 사유', textarea:true, placeholder:'예: 출퇴근 미입력으로 실제 근무시간 등록' })}<button class="action-button primary-action" id="saveManualAttendance" data-employee="${employeeId}" data-date="${date}"><span>근태 기록 추가</span></button>`;
  return `<div class="sheet-heading"><div><span class="sheet-kicker">${esc(longDate(date))}</span><h2>${esc(employee.name)}님 근태</h2><p>배정 근무 ${esc(scheduleText)}</p></div></div><div class="date-attendance-summary"><span>배정 근무</span><b>${esc(scheduleText)}</b></div><div class="date-attendance-records">${records}</div>`;
}

function openSelectedDateAttendance(employeeId, date) {
  openSheet(selectedDateAttendanceSheetMarkup(employeeId, date), { size:'compact date-attendance-sheet' });
  document.querySelectorAll('[data-date-attendance-edit]').forEach((button) => {
    button.onclick = () => {
      const [attendanceId, id, workDate] = button.dataset.dateAttendanceEdit.split('|');
      openSelectedDateAttendanceEdit(attendanceId, id, workDate);
    };
  });
  document.querySelector('#saveManualAttendance')?.addEventListener('click', () => saveSelectedDateManualAttendance(employeeId, date));
}

function selectedDateAttendanceEditMarkup(attendanceId) {
  const attendance = (state.attendance || []).find((row) => row.id === attendanceId);
  if (!attendance) return '';
  const employee = employeeById(attendance.employeeId);
  return `<div class="sheet-heading"><div><span class="sheet-kicker">근태 시간 수정</span><h2>${esc(employee?.name || '직원')} · ${esc(attendance.workDate.slice(5))}</h2><p>${esc(sessionLabel(attendance))}의 실제 출퇴근 시간을 수정합니다.</p></div></div>${field({ id:'selectedAttendanceClockIn', label:'실제 출근', type:'datetime-local', value:localInputValue(attendance.clockIn) })}${field({ id:'selectedAttendanceClockOut', label:'실제 퇴근', type:'datetime-local', value:localInputValue(attendance.clockOut) })}${field({ id:'selectedAttendanceReason', label:'수정 사유', textarea:true, placeholder:'예: 실제 출퇴근 시간으로 정정' })}<button class="action-button primary-action" id="saveSelectedAttendanceEdit"><span>수정 저장</span></button>`;
}

function openSelectedDateAttendanceEdit(attendanceId, employeeId, date) {
  openSheet(selectedDateAttendanceEditMarkup(attendanceId), { size:'compact' });
  document.querySelector('#saveSelectedAttendanceEdit')?.addEventListener('click', () => saveSelectedDateAttendanceEdit(attendanceId, employeeId, date));
}

async function refreshSelectedDateContext(date) {
  const targetMonth = String(date || adminWorkMonth || month).slice(0,7);
  await load(targetMonth);
  adminWorkMonth = targetMonth;
  adminWorkSelectedDate = date;
}

async function saveSelectedDateManualAttendance(employeeId, date) {
  clearFieldErrors(document.querySelector('.glass-sheet'));
  const clockIn = document.querySelector('#manualAttendanceClockIn')?.value || '';
  const clockOut = document.querySelector('#manualAttendanceClockOut')?.value || '';
  const reason = document.querySelector('#manualAttendanceReason')?.value.trim() || '';
  if (!clockIn) return showFieldError('manualAttendanceClockIn', '출근 시간을 입력해 주세요.');
  if (!clockOut || clockOut <= clockIn) return showFieldError('manualAttendanceClockOut', '퇴근 시간은 출근 시간보다 늦어야 합니다.');
  if (reason.length < 2) return showFieldError('manualAttendanceReason', '입력 사유를 2자 이상 입력해 주세요.');
  const button = document.querySelector('#saveManualAttendance');
  setPending(button, true, '저장 중');
  try {
    await api.createManualAttendance(session.token, { employeeId, workDate:date, clockIn:`${date}T${clockIn}:00+09:00`, clockOut:`${date}T${clockOut}:00+09:00`, reason });
    await refreshSelectedDateContext(date);
    dismissLayer(document.querySelector('.sheet-backdrop'));
    renderAdmin();
    toastMsg('누락된 근태 기록을 추가했습니다.'); haptic(10);
    setTimeout(() => openSelectedDateAttendance(employeeId, date), 170);
  } catch (error) { toastMsg(error.message); }
  finally { if (button?.isConnected) setPending(button, false); }
}

async function saveSelectedDateAttendanceEdit(attendanceId, employeeId, date) {
  clearFieldErrors(document.querySelector('.glass-sheet'));
  const attendance = (state.attendance || []).find((row) => row.id === attendanceId);
  if (!attendance) return;
  const clockIn = document.querySelector('#selectedAttendanceClockIn')?.value || '';
  const clockOut = document.querySelector('#selectedAttendanceClockOut')?.value || '';
  const reason = document.querySelector('#selectedAttendanceReason')?.value.trim() || '';
  if (!clockIn) return showFieldError('selectedAttendanceClockIn', '출근 시간을 입력해 주세요.');
  if (clockOut && clockOut <= clockIn) return showFieldError('selectedAttendanceClockOut', '퇴근 시간은 출근 시간보다 늦어야 합니다.');
  const oldIn = localInputValue(attendance.clockIn);
  const oldOut = localInputValue(attendance.clockOut);
  const changes = [];
  if (clockIn !== oldIn) changes.push(['clockIn', clockIn]);
  if (clockOut && clockOut !== oldOut) changes.push(['clockOut', clockOut]);
  if (!changes.length) { toastMsg('변경된 시간이 없습니다.'); return; }
  if (reason.length < 2) return showFieldError('selectedAttendanceReason', '수정 사유를 2자 이상 입력해 주세요.');
  const button = document.querySelector('#saveSelectedAttendanceEdit');
  setPending(button, true, '저장 중');
  try {
    for (const [fieldName, local] of changes) await api.correctAttendance(session.token, { attendanceId, field:fieldName, newValue:`${local}:00+09:00`, reason });
    await refreshSelectedDateContext(date);
    dismissLayer(document.querySelector('.sheet-backdrop'));
    renderAdmin();
    toastMsg('근태 시간을 수정했습니다.'); haptic(8);
    setTimeout(() => openSelectedDateAttendance(employeeId, date), 170);
  } catch (error) { toastMsg(error.message); }
  finally { if (button?.isConnected) setPending(button, false); }
}

function dateToolShiftOptions(selected='other') {
  return DATE_TOOL_SHIFT_OPTIONS.map(([value,label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`).join('');
}

function selectedDateScheduleEditorMarkup(date) {
  const assignments = (state.schedules || []).filter((row) => row.workDate === date).slice().sort((a,b) => a.scheduledStart.localeCompare(b.scheduledStart));
  const assignedIds = new Set(assignments.map((row) => row.employeeId));
  const addable = activeEmployees().filter((employee) => !assignedIds.has(employee.id));
  const rows = assignments.length ? assignments.map((row) => {
    const employee = employeeById(row.employeeId);
    return `<section class="date-schedule-card"><div class="date-schedule-person"><span class="avatar">${esc(employee?.name?.slice(0,1) || '?')}</span><div><b>${esc(employee?.name || '직원')}</b><small>${esc(employee?.position || '스태프')}</small></div></div><div class="date-schedule-fields"><label><span>출근</span><input id="dateScheduleStart_${row.employeeId}" type="time" value="${esc(row.scheduledStart)}"></label><label><span>퇴근</span><input id="dateScheduleEnd_${row.employeeId}" type="time" value="${esc(row.scheduledEnd)}"></label><label class="date-schedule-shift"><span>근무 유형</span><select id="dateScheduleShift_${row.employeeId}">${dateToolShiftOptions(row.shiftType)}</select></label></div><div class="date-schedule-actions"><button class="row-action destructive-text" data-date-schedule-delete="${row.employeeId}">삭제</button><button class="row-action primary-text" data-date-schedule-save="${row.employeeId}">수정 저장</button></div></section>`;
  }).join('') : '<div class="date-attendance-empty"><b>아직 배정된 근무가 없습니다.</b><span>아래에서 직원을 추가해 주세요.</span></div>';
  const addBlock = addable.length ? `<section class="date-schedule-add"><div class="section-heading compact"><div><span>빠른 배정</span><h3>직원 추가</h3></div></div><label><span>직원</span><select id="dateScheduleAddEmployee"><option value="">직원 선택</option>${addable.map((employee) => `<option value="${employee.id}">${esc(employee.name)} · ${esc(employee.position || '스태프')}</option>`).join('')}</select></label><div class="date-schedule-fields"><label><span>출근</span><input id="dateScheduleAddStart" type="time" value="09:00"></label><label><span>퇴근</span><input id="dateScheduleAddEnd" type="time" value="18:00"></label><label class="date-schedule-shift"><span>근무 유형</span><select id="dateScheduleAddShift">${dateToolShiftOptions('other')}</select></label></div><button class="action-button primary-action" id="dateScheduleAdd"><span>직원 추가</span></button></section>` : '<div class="sheet-notice">재직 중인 모든 직원이 이미 이 날짜에 배정되어 있습니다.</div>';
  return `<div class="sheet-heading"><div><span class="sheet-kicker">선택 날짜 근무 편집</span><h2>${esc(longDate(date))}</h2><p>이 날짜의 근무만 빠르게 추가하거나 수정합니다.</p></div></div><div class="date-schedule-list">${rows}</div>${addBlock}`;
}

function openSelectedDateScheduleEditor(date) {
  openSheet(selectedDateScheduleEditorMarkup(date), { size:'compact date-schedule-editor-sheet' });
  document.querySelectorAll('[data-date-schedule-save]').forEach((button) => { button.onclick = () => saveSelectedDateSchedule(button.dataset.dateScheduleSave, date); });
  document.querySelectorAll('[data-date-schedule-delete]').forEach((button) => { button.onclick = () => deleteSelectedDateSchedule(button.dataset.dateScheduleDelete, date, false); });
  document.querySelector('#dateScheduleAdd')?.addEventListener('click', () => addSelectedDateSchedule(date));
}

async function saveSelectedDateSchedule(employeeId, date) {
  const start = document.getElementById(`dateScheduleStart_${employeeId}`)?.value || '';
  const end = document.getElementById(`dateScheduleEnd_${employeeId}`)?.value || '';
  const shiftType = document.getElementById(`dateScheduleShift_${employeeId}`)?.value || 'other';
  if (!start || !end || start >= end) { toastMsg('근무 시간을 확인해 주세요.'); return; }
  const button = document.querySelector(`[data-date-schedule-save="${employeeId}"]`);
  setPending(button, true, '저장 중');
  try {
    await api.bulkSchedule(session.token, { employeeId, workDates:[date], scheduledStart:start, scheduledEnd:end, shiftType });
    await refreshSelectedDateContext(date);
    dismissLayer(document.querySelector('.sheet-backdrop'));
    renderAdmin();
    toastMsg('선택 날짜의 근무를 수정했습니다.');
    setTimeout(() => openSelectedDateScheduleEditor(date), 170);
  } catch (error) { toastMsg(error.message); }
  finally { if (button?.isConnected) setPending(button, false); }
}

async function addSelectedDateSchedule(date) {
  const employeeId = document.querySelector('#dateScheduleAddEmployee')?.value || '';
  const start = document.querySelector('#dateScheduleAddStart')?.value || '';
  const end = document.querySelector('#dateScheduleAddEnd')?.value || '';
  const shiftType = document.querySelector('#dateScheduleAddShift')?.value || 'other';
  if (!employeeId) { toastMsg('추가할 직원을 선택해 주세요.'); return; }
  if (!start || !end || start >= end) { toastMsg('근무 시간을 확인해 주세요.'); return; }
  const button = document.querySelector('#dateScheduleAdd');
  setPending(button, true, '추가 중');
  try {
    await api.bulkSchedule(session.token, { employeeId, workDates:[date], scheduledStart:start, scheduledEnd:end, shiftType });
    await refreshSelectedDateContext(date);
    dismissLayer(document.querySelector('.sheet-backdrop'));
    renderAdmin();
    toastMsg('선택 날짜에 근무를 추가했습니다.'); haptic(8);
    setTimeout(() => openSelectedDateScheduleEditor(date), 170);
  } catch (error) { toastMsg(error.message); }
  finally { if (button?.isConnected) setPending(button, false); }
}

async function deleteSelectedDateSchedule(employeeId, date, force=false) {
  try {
    await api.deleteSchedule(session.token, employeeId, date, force);
    await refreshSelectedDateContext(date);
    dismissLayer(document.querySelector('.sheet-backdrop'));
    renderAdmin();
    toastMsg('선택 날짜의 근무를 삭제했습니다.');
    setTimeout(() => openSelectedDateScheduleEditor(date), 170);
  } catch (error) {
    if (error.data?.requiresConfirmation && !force) {
      const employee = employeeById(employeeId);
      openSheet(`<div class="sheet-heading"><div><span class="sheet-kicker danger-kicker">근무 삭제</span><h2>${esc(employee?.name || '직원')} · ${esc(date.slice(5))}</h2><p>실제 근태 기록은 유지하고 근무 배정만 삭제할까요?</p></div></div><div class="sheet-notice warning">이 날짜에는 실제 출퇴근 기록이 있습니다. 근태 기록은 삭제되지 않습니다.</div><div class="sheet-actions"><button class="action-button secondary-action" data-close><span>취소</span></button><button class="action-button destructive-action" id="forceDateScheduleDelete"><span>근무표만 삭제</span></button></div>`, { size:'compact' });
      document.querySelector('#forceDateScheduleDelete')?.addEventListener('click', () => deleteSelectedDateSchedule(employeeId, date, true));
    } else toastMsg(error.message);
  }
}

function openAdminScheduleManagerAt(date) {
  openSelectedDateScheduleEditor(date);
}

const baseBindAdminWorkForDateTools = bindAdminWork;
bindAdminWork = function() {
  baseBindAdminWorkForDateTools();
  document.querySelectorAll('[data-selected-attendance]').forEach((button) => {
    button.onclick = () => {
      const [employeeId, date] = button.dataset.selectedAttendance.split('|');
      openSelectedDateAttendance(employeeId, date);
    };
  });
};
