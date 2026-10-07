function renderToday() {
  clearInterval(liveTimer);
  const date = kstDate();
  const employee = employeeById(session.employeeId);
  if (!employee) { saveSession(null); return loginView(); }
  const schedule = scheduleFor(employee.id, date);
  const daily = dailyAttendanceSummary(employee.id, date);
  const attendance = daily.open || latestAttendanceSessionFor(employee.id, date);
  const hero = attendanceHero(attendance, schedule, date);
  const tasks = sortTasksForToday(todayTasks(state.taskAssignments || [], employee.id, date));
  const checklistTasks = tasks.filter((t) => t.sourceType === 'checklist');
  const manualTasks = tasks.filter((t) => t.sourceType !== 'checklist');
  const totalNow = daily.totalWorkMinutes + (daily.open?.clockIn ? liveMinutes(daily.open.clockIn) : 0);
  const worked = daily.sessions.length ? formatMinutes(totalNow) : '—';
  const activeOrLatest = daily.open || latestAttendanceSessionFor(employee.id, date);
  const greeting = hero.state === 'before'
    ? `${employee.name}님, 좋은 하루예요.`
    : daily.open?.sessionType === 'extra'
      ? `${employee.name}님, 추가 근무 중이에요.`
      : hero.state === 'working'
        ? `${employee.name}님, 집중해서 일하고 있어요.`
        : `${employee.name}님, 오늘도 수고했어요.`;
  const canStartExtra = daily.hasCompleted && !daily.open;
  root.innerHTML = `<main class="staff-screen native-canvas">
    ${topbar({ title:'오늘' })}
    <section class="today-hero">
      <div class="overline">${esc(longDate(date))}</div>
      <h1>${esc(greeting)}</h1>
      <div class="state-line"><span class="state-dot ${esc(hero.state)}"></span><span>${esc(hero.eyebrow)}</span></div>
      <div class="hero-time">${esc(hero.title)}</div>
      <div class="hero-shift">${esc(hero.subtitle)}</div>
    </section>
    <section class="attendance-facts" aria-label="오늘 근태 요약">
      <div><span>${daily.open?.sessionType === 'extra' ? '추가 출근' : '출근'}</span><b>${fmtTime(activeOrLatest?.clockIn)}</b></div>
      <div><span>퇴근</span><b>${fmtTime(activeOrLatest?.clockOut)}</b></div>
      <div><span>오늘 합계</span><b id="liveWorked">${worked}</b></div>
    </section>
    <section class="floating-action-shell glass-surface">
      <button class="action-button ${hero.primaryAction === 'clock_out' ? 'destructive-action' : hero.completed ? 'completed-action' : 'primary-action'}" id="attendanceAction" ${hero.primaryAction ? '' : 'disabled'}><span>${esc(hero.primaryLabel)}</span></button>
      ${canStartExtra ? '<button class="text-action" id="startExtraWork">추가 근무 시작</button>' : ''}
      ${hero.secondaryAction ? '<button class="text-action destructive-text" id="cancelClockOut">퇴근을 잘못 눌렀나요?</button>' : ''}
    </section>
    ${checklistTodayMarkup(checklistTasks, manualTasks)}
    ${bottomTabs('today')}
  </main>`;
  bindTabs();
  if (hero.primaryAction) document.querySelector('#attendanceAction').onclick = () => hero.primaryAction === 'clock_in' ? openClockInConfirmSheet() : doAttendance(hero.primaryAction);
  document.querySelector('#startExtraWork')?.addEventListener('click', openExtraWorkConfirmSheet);
  document.querySelector('#cancelClockOut')?.addEventListener('click', openCancelClockOutSheet);
  document.querySelectorAll('[data-task-complete]').forEach((button) => { button.onclick = () => completeTask(button.dataset.taskComplete); });
  if (daily.open?.clockIn) {
    liveTimer = setInterval(() => {
      const el = document.querySelector('#liveWorked');
      if (el) el.textContent = formatMinutes(daily.totalWorkMinutes + liveMinutes(daily.open.clockIn));
    }, 30000);
  }
}

function checklistTaskSort(tasks = []) {
  return [...tasks].sort((a,b) => {
    const aDone = a.status === 'completed' ? 1 : 0;
    const bDone = b.status === 'completed' ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    const order = Number(a.sortOrder || 0) - Number(b.sortOrder || 0);
    return order || String(a.createdAt || a.id || '').localeCompare(String(b.createdAt || b.id || ''));
  });
}
function checklistTaskCard(task) {
  const done = task.status === 'completed';
  return `<article class="task-row checklist-task-row ${done ? 'is-done' : ''}" data-task-row="${esc(task.id)}"><button class="task-check" ${done ? 'disabled' : ''} data-task-complete="${esc(task.id)}" aria-label="${done ? '완료됨' : '업무 완료'}">${done ? icon('check') : ''}</button><div class="task-copy"><div class="checklist-task-title"><b>${esc(task.title)}</b>${task.required ? '<span class="required-badge">필수</span>' : '<span class="optional-badge">선택</span>'}</div>${task.description ? `<p>${esc(task.description)}</p>` : ''}${task.completedAt ? `<small>${fmtTime(task.completedAt)} 완료</small>` : ''}</div>${done ? '<span class="task-status">완료</span>' : ''}</article>`;
}
function checklistGroupMarkup(type, tasks) {
  if (!tasks.length) return '';
  const sorted = checklistTaskSort(tasks);
  const completed = sorted.filter((t) => t.status === 'completed').length;
  const requiredPending = sorted.filter((t) => t.required && t.status !== 'completed').length;
  return `<section class="checklist-group is-${esc(type)}"><div class="checklist-group-head"><div><span>${esc(checklistShiftLabel(type))}</span><h3>${completed === sorted.length ? '모두 완료했어요' : `${sorted.length - completed}개 남았어요`}</h3></div><div class="checklist-progress-copy"><b>${completed}/${sorted.length}</b>${requiredPending ? `<small>필수 ${requiredPending}개 남음</small>` : '<small>필수 완료</small>'}</div></div><div class="checklist-progress"><span style="width:${sorted.length ? Math.round(completed / sorted.length * 100) : 0}%"></span></div><div class="task-list">${sorted.map(checklistTaskCard).join('')}</div></section>`;
}
function manualTasksMarkup(tasks) {
  if (!tasks.length) return '';
  const sorted = sortTasksForToday(tasks);
  const completed = sorted.filter((t) => t.status === 'completed').length;
  return `<section class="native-section task-section manual-task-section"><div class="section-heading"><div><span>추가 업무</span><h2>${sorted.length - completed ? `${sorted.length - completed}개 남았어요` : '모두 완료했어요'}</h2></div><small>${completed}/${sorted.length}</small></div><div class="task-list">${sorted.map(taskCard).join('')}</div></section>`;
}
function checklistTodayMarkup(checklistTasks, manualTasks) {
  const groups = ['open','middle','close'].map((type) => checklistGroupMarkup(type, checklistTasks.filter((t) => t.shiftType === type))).filter(Boolean).join('');
  const checklist = checklistTasks.length ? `<section class="native-section checklist-today-section" data-checklist-area><div class="section-heading"><div><span>오늘 체크리스트</span><h2>${checklistTasks.filter((t) => t.status !== 'completed').length ? `${checklistTasks.filter((t) => t.status !== 'completed').length}개 남았어요` : '필수 업무를 모두 확인했어요'}</h2></div><small>${checklistTasks.filter((t) => t.status === 'completed').length}/${checklistTasks.length}</small></div><div class="checklist-groups">${groups}</div></section>` : '';
  const manual = manualTasksMarkup(manualTasks);
  if (checklist || manual) return `${checklist}${manual}`;
  return '<section class="native-section task-section"><div class="section-heading"><div><span>오늘 할 일</span><h2>추가 업무가 없어요</h2></div><small>0/0</small></div><div class="native-empty"><div class="empty-icon">✓</div><p>오늘은 별도로 배정된 업무가 없습니다.</p></div></section>';
}

function taskCard(task) {
  const done = task.status === 'completed';
  return `<article class="task-row ${done ? 'is-done' : ''}" data-task-row="${esc(task.id)}"><button class="task-check" ${done ? 'disabled' : ''} data-task-complete="${esc(task.id)}" aria-label="${done ? '완료됨' : '업무 완료'}">${done ? icon('check') : ''}</button><div class="task-copy"><b>${esc(task.title)}</b>${task.description ? `<p>${esc(task.description)}</p>` : ''}${task.completedAt ? `<small>${fmtTime(task.completedAt)} 완료</small>` : ''}</div>${done ? '<span class="task-status">완료</span>' : ''}</article>`;
}
function openClockInConfirmSheet() {
  openSheet(`<div class="sheet-heading"><div><span class="sheet-kicker warning-kicker">출근 전 확인</span><h2>근무지에 도착하셨나요?</h2><p>근무지 도착 시간은 재차 확인하고 있습니다. 실제 근무지에 도착하기 전에는 출근을 미리 기록하지 말아 주세요.</p></div></div><div class="sheet-notice warning">실제 도착 시간과 출근 기록이 다를 경우 관리자 확인이 진행될 수 있습니다.</div><div class="sheet-actions"><button class="action-button secondary-action" data-close><span>아직 도착 전이에요</span></button><button class="action-button primary-action" id="confirmClockIn"><span>근무지에 도착했어요 · 출근</span></button></div>`, { size:'compact clock-in-confirm-sheet' });
  document.querySelector('#confirmClockIn').onclick = async () => {
    const button = document.querySelector('#confirmClockIn');
    try {
      await doAttendance('clock_in', { fromSheet:true, sourceButton:button });
      dismissLayer(document.querySelector('.sheet-backdrop'));
    } catch {}
  };
}
function openExtraWorkConfirmSheet() {
  openSheet(`<div class="sheet-heading"><div><span class="sheet-kicker">추가 근무</span><h2>오늘 추가 근무를 시작하시겠습니까?</h2><p>이미 완료한 근무 기록은 그대로 유지되고 새로운 근무 구간이 추가됩니다.</p></div></div><div class="sheet-notice">추가 근무는 예정 시간이 없는 긴급 편성으로 기록되며 실제 근무시간만 합산됩니다.</div><div class="sheet-actions"><button class="action-button secondary-action" data-close><span>취소</span></button><button class="action-button primary-action" id="confirmExtraWork"><span>추가 근무 시작</span></button></div>`, { size:'compact clock-in-confirm-sheet' });
  document.querySelector('#confirmExtraWork').onclick = async () => {
    const button = document.querySelector('#confirmExtraWork');
    try {
      await doAttendance('start_extra', { fromSheet:true, sourceButton:button });
      dismissLayer(document.querySelector('.sheet-backdrop'));
    } catch {}
  };
}

function openCancelClockOutSheet() {
  openSheet(`<div class="sheet-heading"><div><span class="sheet-kicker danger-kicker">퇴근 취소</span><h2>퇴근을 취소할까요?</h2><p>오늘 한 번만 취소할 수 있습니다. 취소 이력은 관리자에게 남습니다.</p></div></div><div class="sheet-actions"><button class="action-button secondary-action" data-close><span>그대로 두기</span></button><button class="action-button destructive-action" id="confirmCancelClockOut"><span>퇴근 취소</span></button></div>`, { size:'compact' });
  document.querySelector('#confirmCancelClockOut').onclick = async () => {
    const button = document.querySelector('#confirmCancelClockOut');
    setPending(button, true, '취소 중');
    try { await doAttendance('cancel_clock_out', { fromSheet:true }); dismissLayer(document.querySelector('.sheet-backdrop')); }
    catch {} finally { setPending(button, false); }
  };
}
function openChecklistClockOutSheet(pendingItems = []) {
  const items = pendingItems.map((item) => `<li><span>${esc(checklistShiftLabel(item.shiftType))}</span><b>${esc(item.title)}</b></li>`).join('');
  openSheet(`<div class="sheet-heading"><div><span class="sheet-kicker warning-kicker">필수 업무 확인</span><h2>아직 완료하지 않은 필수 업무가 있어요.</h2><p>업무를 확인할 수 없는 예외 상황이라면 사유를 남긴 뒤 퇴근할 수 있습니다.</p></div></div><ul class="checklist-pending-list">${items}</ul>${field({ id:'checklistOverrideReason', label:'미완료 사유', textarea:true, placeholder:'예: 긴급 교대 요청으로 다음 근무자에게 인계했습니다.' })}<div class="sheet-actions"><button class="action-button secondary-action" id="reviewChecklistBeforeClockOut"><span>체크리스트 확인</span></button><button class="action-button destructive-action" id="confirmChecklistOverrideClockOut"><span>사유 입력 후 퇴근</span></button></div>`, { size:'compact checklist-override-sheet' });
  document.querySelector('#reviewChecklistBeforeClockOut').onclick = () => {
    dismissLayer(document.querySelector('.sheet-backdrop'));
    setTimeout(() => document.querySelector('[data-checklist-area]')?.scrollIntoView({ behavior:'smooth', block:'start' }), 180);
  };
  document.querySelector('#confirmChecklistOverrideClockOut').onclick = async () => {
    clearFieldErrors(document.querySelector('.glass-sheet'));
    const reason = document.querySelector('#checklistOverrideReason').value.trim();
    if (!reason) return showFieldError('checklistOverrideReason', '미완료 사유를 입력해 주세요.');
    const button = document.querySelector('#confirmChecklistOverrideClockOut');
    try {
      await doAttendance('clock_out', { fromSheet:true, sourceButton:button, checklistOverrideReason:reason });
      dismissLayer(document.querySelector('.sheet-backdrop'));
    } catch {}
  };
}
async function doAttendance(action, { fromSheet = false, sourceButton = null, checklistOverrideReason = '' } = {}) {
  if (busy) return;
  busy = true;
  const button = sourceButton || (fromSheet ? document.querySelector('#confirmCancelClockOut') : document.querySelector('#attendanceAction'));
  const pendingLabel = action === 'clock_in' ? '출근 기록 중'
    : action === 'clock_out' ? '퇴근 기록 중'
      : action === 'start_extra' ? '추가 근무 시작 중'
        : '취소 중';
  setPending(button, true, pendingLabel);
  try {
    await api.attendance(session.token, action, checklistOverrideReason);
    haptic(action === 'cancel_clock_out' ? [12, 40, 12] : 12);
    if (!fromSheet && button) button.classList.add('success-pop');
    await load(currentMonth());
    renderToday();
    const message = action === 'clock_in' ? '출근 시간이 저장되었습니다.'
      : action === 'clock_out' ? '퇴근 시간이 저장되었습니다.'
        : action === 'start_extra' ? '추가 근무를 시작했습니다.'
          : '퇴근을 취소했습니다.';
    toastMsg(message);
  } catch (e) {
    if (action === 'clock_out' && e.data?.requiresChecklistOverride) {
      if (fromSheet) dismissLayer(document.querySelector('.sheet-backdrop'));
      setTimeout(() => openChecklistClockOutSheet(e.data?.pendingItems || []), fromSheet ? 170 : 0);
      return;
    }
    toastMsg(e.message);
    if (!fromSheet) renderToday();
    throw e;
  } finally {
    busy = false;
    if (button?.isConnected) setPending(button, false);
  }
}

async function completeTask(id) {
  if (busy) return;
  busy = true;
  const row = document.querySelector(`[data-task-row="${CSS.escape(id)}"]`);
  const check = row?.querySelector('.task-check');
  row?.classList.add('is-saving');
  if (check) check.innerHTML = '<span class="spinner dark"></span>';
  try {
    await api.completeTask(session.token, id);
    haptic(10);
    row?.classList.add('complete-pop');
    await load(currentMonth());
    renderToday();
  } catch (e) { toastMsg(e.message); row?.classList.remove('is-saving'); }
  finally { busy = false; }
}

function renderRecords() {
  clearInterval(liveTimer);
  const employee = employeeById(session.employeeId);
  const cells = monthCalendar(month);
  const schedules = (state.schedules || []).filter((s) => s.employeeId === employee.id);
  const attendance = (state.attendance || []).filter((a) => a.employeeId === employee.id);
  const work = attendance.reduce((n, a) => n + Number(a.workMinutes || 0), 0);
  const completedDays = new Set(attendance.filter((a) => a.clockOut).map((a) => a.workDate)).size;
  root.innerHTML = `<main class="staff-screen records-screen native-canvas">
    ${topbar({ title:'근무기록' })}
    <section class="calendar-hero"><span class="overline">${esc(employee.name)}님의 기록</span><div class="calendar-title-row"><h1>${esc(monthTitle(month))}</h1><button class="today-jump" id="recordToday">오늘</button></div><div class="calendar-nav"><button class="circle-button" id="prevMonth" aria-label="이전 달">${icon('back')}</button><button class="circle-button" id="nextMonth" aria-label="다음 달">${icon('forward')}</button></div></section>
    <section class="records-summary"><div><span>예정</span><b>${schedules.length}일</b></div><div><span>완료</span><b>${completedDays}일</b></div><div><span>누적 근무</span><b>${formatMinutes(work)}</b></div></section>
    <section class="calendar-card"><div class="week-row">${['일','월','화','수','목','금','토'].map((d) => `<span>${d}</span>`).join('')}</div><div class="ios-calendar">${cells.map((date) => recordCell(date, employee.id)).join('')}</div></section>
    ${bottomTabs('records')}
  </main>`;
  bindTabs();
  document.querySelector('#prevMonth').onclick = () => moveRecordMonth(-1);
  document.querySelector('#nextMonth').onclick = () => moveRecordMonth(1);
  document.querySelector('#recordToday').onclick = async () => { if (month !== currentMonth()) await load(currentMonth()); renderRecords(); };
  document.querySelectorAll('[data-record-date]').forEach((button) => { button.onclick = () => openRecordDetail(button.dataset.recordDate); });
}

function recordCell(date, employeeId) {
  if (!date) return '<div class="calendar-spacer"></div>';
  const schedule = scheduleFor(employeeId, date);
  const daily = dailyAttendanceSummary(employeeId, date);
  let stateClass = '';
  let label = '';
  if (daily.open) {
    stateClass = 'is-live';
    label = daily.open.sessionType === 'extra' ? '추가 중' : '근무 중';
  } else if (daily.completed.length) {
    stateClass = daily.sessions.some((a) => Number(a.lateMinutes || 0) > 0) ? 'is-late' : 'is-complete';
    label = formatMinutes(daily.totalWorkMinutes);
  } else if (schedule) {
    stateClass = 'is-scheduled';
    label = `${schedule.scheduledStart.slice(0,2)}–${schedule.scheduledEnd.slice(0,2)}`;
  }
  const clickable = schedule || daily.sessions.length;
  return `<button class="calendar-day ${stateClass} ${date === kstDate() ? 'is-today' : ''}" ${clickable ? `data-record-date="${date}"` : 'disabled'}><span class="day-number">${Number(date.slice(-2))}</span>${stateClass ? '<span class="day-dot"></span>' : ''}${label ? `<small>${esc(label)}</small>` : ''}</button>`;
}

async function moveRecordMonth(delta) {
  try { await load(shiftMonth(month, delta)); renderRecords(); } catch (e) { toastMsg(e.message); }
}
function openRecordDetail(date) {
  const employee = employeeById(session.employeeId);
  const schedule = scheduleFor(session.employeeId, date);
  const sessions = attendanceSessionsFor(employee.id, date);
  const daily = dailyAttendanceSummary(employee.id, date);
  const total = daily.totalWorkMinutes + (daily.open?.clockIn ? liveMinutes(daily.open.clockIn) : 0);
  const rows = sessions.length
    ? sessions.map((attendance) => `<div><span>${esc(sessionLabel(attendance))} · ${fmtTime(attendance.clockIn)}–${fmtTime(attendance.clockOut)}</span><b>${attendance.clockOut ? formatMinutes(attendance.workMinutes || 0) : '근무 중'}</b></div>`).join('')
    : '<div><span>근태 기록</span><b>없음</b></div>';
  openSheet(`<div class="sheet-heading"><div><span class="sheet-kicker">${esc(longDate(date))}</span><h2>${sessions.length ? `${sessions.length}개 근무 구간` : schedule ? `${schedule.scheduledStart} — ${schedule.scheduledEnd}` : '예정 시간 없음'}</h2><p>이 날의 근무 기록을 구간별로 보여드립니다.</p></div></div><div class="detail-list">${rows}${sessions.length ? `<div><span>오늘 총 근무</span><b>${formatMinutes(total)}</b></div>` : ''}</div><button class="action-button primary-action" data-close><span>확인</span></button>`, { size:'compact' });
}
