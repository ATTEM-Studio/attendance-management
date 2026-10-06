function staffCalendarSegments(employeeId, date) {
  const base = (state?.schedules || [])
    .filter((row) => row.employeeId === employeeId && row.workDate === date)
    .map((row) => ({ ...row, segmentType:'base' }));
  const extras = (state?.extraSchedules || [])
    .filter((row) => row.employeeId === employeeId && row.workDate === date)
    .map((row) => ({ ...row, segmentType:'extra' }));
  return [...base, ...extras].sort((a,b) => String(a.scheduledStart || '').localeCompare(String(b.scheduledStart || '')));
}

function staffCalendarDayModel(employeeId, date, today = kstDate()) {
  const segments = staffCalendarSegments(employeeId, date);
  const daily = typeof dailyAttendanceSummary === 'function'
    ? dailyAttendanceSummary(employeeId, date)
    : { sessions:[], open:null, completed:[], totalWorkMinutes:0 };
  const period = date < today ? 'past' : date === today ? 'today' : 'future';
  const hasAttendance = Boolean(daily.sessions?.length);
  const hasCompleted = Boolean(daily.completed?.length);
  let status = 'off';

  if (daily.open) status = 'working';
  else if (hasCompleted) status = 'done';
  else if (segments.length) status = period === 'past' ? 'missing' : 'scheduled';
  else if (hasAttendance) status = 'done';

  const plannedSummary = segments
    .map((row) => `${String(row.scheduledStart || '').slice(0,5)}–${String(row.scheduledEnd || '').slice(0,5)}`)
    .join(' · ');
  const summary = status === 'working'
    ? '근무 중'
    : status === 'done'
      ? (Number(daily.totalWorkMinutes || 0) > 0 && typeof formatMinutes === 'function' ? formatMinutes(daily.totalWorkMinutes) : '근무 완료')
      : status === 'missing'
        ? '근태 기록 없음'
        : plannedSummary || '휴무';

  return { date, period, status, segments, daily, summary };
}

function staffCalendarShortTime(value = '') {
  return String(value).slice(0,5).replace(':00','');
}

function staffCalendarStateLabel(model) {
  if (model.status === 'working') return '근무 중';
  if (model.status === 'done') return model.period === 'today' ? '오늘 완료' : '완료';
  if (model.status === 'missing') return '기록 없음';
  if (model.status === 'scheduled') return model.period === 'today' ? '오늘' : '예정';
  return '';
}

function staffCalendarRecordCell(date, employeeId) {
  if (!date) return '<div class="calendar-spacer"></div>';
  const model = staffCalendarDayModel(employeeId, date);
  const clickable = model.segments.length || model.daily.sessions?.length;
  const timeRows = model.segments.slice(0,2).map((row) => {
    const extra = row.segmentType === 'extra' ? ' is-extra' : '';
    return `<small class="staff-calendar-time${extra}">${esc(staffCalendarShortTime(row.scheduledStart))}–${esc(staffCalendarShortTime(row.scheduledEnd))}</small>`;
  }).join('');
  const more = model.segments.length > 2 ? `<small class="staff-calendar-more">+${model.segments.length - 2}</small>` : '';
  const statusLabel = staffCalendarStateLabel(model);
  return `<button class="calendar-day staff-calendar-day is-${model.period} status-${model.status} ${date === kstDate() ? 'is-today' : ''} ${model.segments.length > 1 ? 'has-multi-shift' : ''}" ${clickable ? `data-record-date="${date}"` : 'disabled'}>
    <span class="day-number">${Number(date.slice(-2))}</span>
    ${statusLabel ? `<span class="staff-calendar-status">${esc(statusLabel)}</span>` : ''}
    ${timeRows}${more}
  </button>`;
}

function staffCalendarActualRows(employeeId, date) {
  const sessions = typeof attendanceSessionsFor === 'function' ? attendanceSessionsFor(employeeId, date) : [];
  if (!sessions.length) return '<div class="staff-calendar-detail-empty"><span>실제 근태</span><b>기록 없음</b></div>';
  return sessions.map((attendance, index) => {
    const label = typeof sessionLabel === 'function'
      ? sessionLabel(attendance)
      : (attendance.sessionType === 'extra' ? `추가 근무 ${Math.max(1, Number(attendance.sessionNo || index + 1) - 1)}` : '기본 근무');
    const work = attendance.clockOut && typeof formatMinutes === 'function' ? formatMinutes(attendance.workMinutes || 0) : '근무 중';
    return `<div class="staff-calendar-detail-row"><span><b>${esc(label)}</b><small>${esc(fmtTime(attendance.clockIn))}–${esc(fmtTime(attendance.clockOut))}</small></span><strong>${esc(work)}</strong></div>`;
  }).join('');
}

function staffCalendarPlannedRows(model) {
  if (!model.segments.length) return '<div class="staff-calendar-detail-empty"><span>예정 근무</span><b>없음</b></div>';
  return model.segments.map((row) => `<div class="staff-calendar-detail-row planned ${row.segmentType === 'extra' ? 'is-extra' : ''}">
    <span><b>${row.segmentType === 'extra' ? '추가 근무' : '기본 근무'}</b><small>${esc(shiftTypeLabel(row.shiftType))}</small></span>
    <strong>${esc(String(row.scheduledStart || '').slice(0,5))}–${esc(String(row.scheduledEnd || '').slice(0,5))}</strong>
  </div>`).join('');
}

function staffCalendarOpenDetail(date) {
  const employeeId = session?.employeeId;
  if (!employeeId) return;
  const model = staffCalendarDayModel(employeeId, date);
  const periodLabel = model.period === 'future' ? '출근 예정' : model.period === 'today' ? '오늘 근무' : '근무 기록';
  const summary = model.status === 'missing'
    ? '근무 예정은 있었지만 실제 출퇴근 기록이 없습니다.'
    : model.status === 'off'
      ? '배정된 근무가 없습니다.'
      : model.summary;
  openSheet(`<div class="sheet-heading staff-calendar-sheet-heading"><div><span class="sheet-kicker">${esc(periodLabel)}</span><h2>${esc(longDate(date))}</h2><p>${esc(summary)}</p></div></div>
    <section class="staff-calendar-detail-section"><div class="staff-calendar-detail-title"><span>예정 근무</span><b>${model.segments.length ? `${model.segments.length}구간` : '휴무'}</b></div>${staffCalendarPlannedRows(model)}</section>
    <section class="staff-calendar-detail-section"><div class="staff-calendar-detail-title"><span>실제 근태</span><b>${model.daily.sessions?.length ? `${model.daily.sessions.length}구간` : '기록 없음'}</b></div>${staffCalendarActualRows(employeeId,date)}</section>
    <button class="action-button primary-action" data-close><span>확인</span></button>`, { size:'compact' });
}

function staffCalendarLegendMarkup() {
  return `<section class="staff-calendar-guide" aria-label="근무 캘린더 안내">
    <div><span class="staff-calendar-guide-dot is-today"></span><b>오늘</b></div>
    <div><span class="staff-calendar-guide-dot is-future"></span><b>출근 예정</b></div>
    <div><span class="staff-calendar-guide-dot is-done"></span><b>근무 완료</b></div>
    <div><span class="staff-calendar-guide-dot is-extra"></span><b>추가 근무</b></div>
  </section>`;
}

function enhanceStaffRecordsCalendar() {
  if (session?.role !== 'staff') return;
  const overline = document.querySelector('.calendar-hero .overline');
  if (overline) overline.textContent = '내 근무 일정';
  const card = document.querySelector('.calendar-card');
  if (card && !document.querySelector('.staff-calendar-guide')) card.insertAdjacentHTML('beforebegin', staffCalendarLegendMarkup());

  const summaryCards = document.querySelectorAll('.records-summary > div');
  if (summaryCards?.length) {
    const employeeId = session.employeeId;
    const plannedDates = new Set([
      ...(state?.schedules || []).filter((row) => row.employeeId === employeeId).map((row) => row.workDate),
      ...(state?.extraSchedules || []).filter((row) => row.employeeId === employeeId).map((row) => row.workDate),
    ]);
    const label = summaryCards[0]?.querySelector('span');
    const value = summaryCards[0]?.querySelector('b');
    if (label) label.textContent = '근무일';
    if (value) value.textContent = `${plannedDates.size}일`;
  }
}

if (typeof recordCell === 'function') recordCell = staffCalendarRecordCell;
if (typeof openRecordDetail === 'function') openRecordDetail = staffCalendarOpenDetail;
if (typeof renderRecords === 'function') {
  const baseRenderRecordsForStaffCalendar = renderRecords;
  renderRecords = function renderRecordsWithStaffCalendar() {
    baseRenderRecordsForStaffCalendar();
    enhanceStaffRecordsCalendar();
  };
}
