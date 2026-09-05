/* Attendance Management v28 administrator presentation layer */
const ADMIN_SECTIONS = [
  { key:'today', label:'오늘', icon:'home' },
  { key:'work', label:'근무', icon:'calendar' },
  { key:'operations', label:'운영', icon:'task' },
];

let adminSection = 'today';
let adminWorkView = 'schedule';
let adminWorkMonth = month;
let adminWorkSelectedDate = kstDate();
let adminTodayFilter = 'all';
let adminAttendanceFilter = 'all';
let adminAttendanceEmployee = '';

function adminSectionMeta() {
  return ADMIN_SECTIONS.find((item) => item.key === adminSection) || ADMIN_SECTIONS[0];
}

function adminNavItems(className = '') {
  return ADMIN_SECTIONS.map((item) => `<button class="${className} ${adminSection === item.key ? 'is-active' : ''}" data-admin-section="${item.key}" aria-current="${adminSection === item.key ? 'page' : 'false'}">${icon(item.icon)}<span>${item.label}</span></button>`).join('');
}

function adminTodaySnapshot(date = kstDate()) {
  const employees = activeEmployees().map((employee) => {
    const schedule = scheduleFor(employee.id, date);
    const daily = dailyAttendanceSummary(employee.id, date);
    const tasks = todayTasks(state.taskAssignments || [], employee.id, date);
    const checklist = tasks.filter((task) => task.sourceType === 'checklist');
    const manual = tasks.filter((task) => task.sourceType !== 'checklist');
    const checklistCompleted = checklist.filter((task) => task.status === 'completed').length;
    const requiredPending = checklist.filter((task) => task.required && task.status !== 'completed').length;
    const manualPending = manual.filter((task) => task.status !== 'completed').length;
    const statusKey = daily.open ? 'working' : daily.completed.length ? 'done' : schedule ? 'before' : 'none';
    const control = adminAttendanceActionState(employee, date);
    const lateMinutes = daily.sessions.reduce((max, row) => Math.max(max, Number(row.lateMinutes || 0)), 0);
    return { employee, schedule, daily, tasks, checklist, manual, checklistCompleted, requiredPending, manualPending, statusKey, control, lateMinutes };
  });

  const attention = [];
  for (const row of employees) {
    if (row.requiredPending && row.statusKey === 'working') attention.push({ employeeId:row.employee.id, tone:'warning', title:`${row.employee.name} · 필수 업무 ${row.requiredPending}개 남음`, detail:'퇴근 전 체크리스트 확인이 필요해요.' });
    if (row.requiredPending && row.statusKey === 'done') attention.push({ employeeId:row.employee.id, tone:'danger', title:`${row.employee.name} · 필수 업무 ${row.requiredPending}개 미완료`, detail:'퇴근 처리된 기록과 미완료 업무를 확인해 주세요.' });
    if (row.lateMinutes > 0) attention.push({ employeeId:row.employee.id, tone:'warning', title:`${row.employee.name} · 지각 ${row.lateMinutes}분`, detail:'오늘 실제 출근 기록 기준입니다.' });
    if (row.schedule && row.statusKey === 'before' && date === kstDate()) {
      const expected = new Date(`${date}T${row.schedule.scheduledStart}:00+09:00`).getTime();
      const delayed = Math.floor((Date.now() - expected) / 60000);
      if (delayed >= 10) attention.push({ employeeId:row.employee.id, tone:'danger', title:`${row.employee.name} · 출근 예정 ${delayed}분 지남`, detail:`${row.schedule.scheduledStart} 출근 예정이었어요.` });
    }
  }

  return {
    employees,
    attention,
    before: employees.filter((row) => row.statusKey === 'before').length,
    working: employees.filter((row) => row.statusKey === 'working').length,
    done: employees.filter((row) => row.statusKey === 'done').length,
    requiredPending: employees.reduce((sum, row) => sum + row.requiredPending, 0),
    manualPending: employees.reduce((sum, row) => sum + row.manualPending, 0),
  };
}

function adminKpiButton(label, value, key, tone = '') {
  return `<button class="admin-kpi-card ${tone} ${adminTodayFilter === key ? 'is-active' : ''}" data-today-filter="${key}"><b>${value}</b><span>${label}</span></button>`;
}

function adminTodayStaffCard(row) {
  const { employee, schedule, daily, checklist, checklistCompleted, requiredPending, manualPending, statusKey, control } = row;
  const shift = schedule ? `${schedule.scheduledStart}–${schedule.scheduledEnd} · ${shiftTypeLabel(schedule.shiftType)}` : daily.hasExtra ? '추가 근무 기록 있음' : '근무 일정 없음';
  const progress = checklist.length ? Math.round(checklistCompleted / checklist.length * 100) : 0;
  const statusClass = statusKey === 'working' ? 'is-working' : statusKey === 'done' ? 'is-done' : statusKey === 'before' ? 'is-before' : '';
  return `<article class="admin-staff-card ${statusClass}">
    <button class="admin-staff-card-main" data-admin-staff="${employee.id}">
      <span class="avatar">${esc(employee.name.slice(0,1))}</span>
      <span class="admin-staff-card-copy"><b>${esc(employee.name)}</b><small>${esc(shift)}</small><strong>${esc(control.status)}${daily.open ? ` · ${fmtTime(daily.open.clockIn)} 출근` : ''}</strong></span>
      ${icon('chevron','chevron')}
    </button>
    <div class="admin-staff-card-foot">
      <div class="admin-staff-progress-copy"><span>${checklist.length ? `체크리스트 ${checklistCompleted}/${checklist.length}` : '체크리스트 없음'}</span>${requiredPending ? `<em>필수 ${requiredPending}</em>` : ''}${manualPending ? `<em class="neutral">추가업무 ${manualPending}</em>` : ''}</div>
      ${checklist.length ? `<div class="admin-staff-progress"><span style="width:${progress}%"></span></div>` : ''}
      ${control.action ? `<button class="admin-inline-action ${control.tone}" data-admin-attendance-action="${employee.id}|${control.action}">${esc(control.label)}</button>` : ''}
    </div>
  </article>`;
}

function adminAttentionMarkup(snapshot) {
  if (!snapshot.attention.length) return `<section class="admin-side-card admin-attention-center"><div class="admin-side-heading"><div><span>확인 필요</span><h3>모두 정상이에요</h3></div><span class="admin-status-dot is-success"></span></div><div class="admin-success-empty">오늘 확인이 필요한 항목이 없습니다.</div></section>`;
  return `<section class="admin-side-card admin-attention-center"><div class="admin-side-heading"><div><span>확인 필요</span><h3>${snapshot.attention.length}개 항목</h3></div><span class="admin-attention-count">${snapshot.attention.length}</span></div><div class="admin-attention-list">${snapshot.attention.map((item) => `<button class="admin-attention-row is-${item.tone}" data-admin-staff="${item.employeeId}"><span class="admin-attention-icon">!</span><span><b>${esc(item.title)}</b><small>${esc(item.detail)}</small></span>${icon('chevron','chevron')}</button>`).join('')}</div></section>`;
}

function adminChecklistSummaryMarkup(snapshot) {
  const rows = snapshot.employees.filter((row) => row.checklist.length);
  const total = rows.reduce((sum, row) => sum + row.checklist.length, 0);
  const complete = rows.reduce((sum, row) => sum + row.checklistCompleted, 0);
  if (!rows.length) return `<section class="admin-side-card admin-checklist-summary"><div class="admin-side-heading"><div><span>오늘 체크리스트</span><h3>자동 생성된 업무가 없어요</h3></div></div><div class="admin-muted-empty">근무유형에 연결된 체크리스트가 생성되면 여기에 표시됩니다.</div></section>`;
  return `<section class="admin-side-card admin-checklist-summary"><div class="admin-side-heading"><div><span>오늘 체크리스트</span><h3>${total - complete ? `${total - complete}개 남음` : '모두 완료'}</h3></div><strong>${complete}/${total}</strong></div><div class="admin-checklist-summary-list">${rows.map((row) => {
    const percent = Math.round(row.checklistCompleted / row.checklist.length * 100);
    return `<button data-admin-staff="${row.employee.id}"><span><b>${esc(row.employee.name)}</b><small>${row.requiredPending ? `필수 ${row.requiredPending}개 남음` : '필수 완료'}</small></span><div class="admin-mini-progress"><span style="width:${percent}%"></span></div></button>`;
  }).join('')}</div></section>`;
}

function adminTodayView() {
  const date = kstDate();
  const snapshot = adminTodaySnapshot(date);
  const filtered = adminTodayFilter === 'all' ? snapshot.employees : snapshot.employees.filter((row) => row.statusKey === adminTodayFilter);
  return `<div class="admin-today-view">
    <section class="admin-today-hero"><span class="overline">${esc(longDate(date))}</span><h2>${snapshot.working ? `${snapshot.working}명이 근무 중이에요` : '현재 근무 중인 직원이 없어요'}</h2><p>출근 전 ${snapshot.before}명 · 퇴근 완료 ${snapshot.done}명${snapshot.requiredPending ? ` · 필수업무 ${snapshot.requiredPending}건 남음` : ''}</p></section>
    <section class="admin-kpi-grid" aria-label="오늘 근무 상태">${adminKpiButton('전체', snapshot.employees.length, 'all')}${adminKpiButton('출근 전', snapshot.before, 'before')}${adminKpiButton('근무 중', snapshot.working, 'working', 'is-primary')}${adminKpiButton('퇴근 완료', snapshot.done, 'done')}</section>
    <div class="admin-today-grid">
      <section class="admin-main-column"><div class="admin-section-heading"><div><span>오늘 직원</span><h3>${adminTodayFilter === 'all' ? '전체 직원 현황' : `${filtered.length}명 표시 중`}</h3></div><small>${snapshot.employees.length}명 재직</small></div><div class="admin-staff-list">${filtered.length ? filtered.map(adminTodayStaffCard).join('') : '<div class="admin-empty-state"><b>해당 상태의 직원이 없어요.</b><span>다른 상태를 선택해 확인해 보세요.</span></div>'}</div></section>
      <aside class="admin-side-column">${adminAttentionMarkup(snapshot)}${adminChecklistSummaryMarkup(snapshot)}</aside>
    </div>
  </div>`;
}

function openAdminStaffQuickSheet(employeeId) {
  const row = adminTodaySnapshot(kstDate()).employees.find((item) => item.employee.id === employeeId);
  if (!row) return;
  const { employee, schedule, daily, checklist, checklistCompleted, requiredPending, manualPending, control } = row;
  const scheduleText = schedule ? `${schedule.scheduledStart} — ${schedule.scheduledEnd} · ${shiftTypeLabel(schedule.shiftType)}` : '오늘 근무 일정 없음';
  const sessionText = daily.open ? `${fmtTime(daily.open.clockIn)} 출근 · 근무 중` : daily.completed.length ? `최근 퇴근 ${fmtTime(daily.completed[daily.completed.length - 1].clockOut)}` : '아직 출근 기록 없음';
  openSheet(`<div class="sheet-heading"><div><span class="sheet-kicker">오늘 직원</span><h2>${esc(employee.name)}님</h2><p>${esc(employee.position || '스태프')} · ${esc(scheduleText)}</p></div></div>
    <div class="admin-quick-facts"><div><span>근태</span><b>${esc(sessionText)}</b></div><div><span>체크리스트</span><b>${checklist.length ? `${checklistCompleted}/${checklist.length} 완료` : '없음'}</b></div><div><span>추가 업무</span><b>${manualPending ? `${manualPending}건 남음` : '없음'}</b></div></div>
    ${requiredPending ? `<div class="sheet-notice warning">필수 체크리스트 ${requiredPending}개가 아직 남아 있습니다.</div>` : ''}
    <div class="sheet-actions admin-quick-actions">${control.action ? `<button class="action-button ${control.tone}" id="quickAttendanceAction"><span>${esc(control.label)}</span></button>` : '<button class="action-button completed-action" disabled><span>오늘 기본 근무 완료</span></button>'}<button class="action-button secondary-action" id="quickOpenCorrection"><span>근태 기록 보기</span></button></div>`, { size:'compact' });
  document.querySelector('#quickAttendanceAction')?.addEventListener('click', () => openAdminAttendanceConfirm(employeeId, control.action));
  document.querySelector('#quickOpenCorrection')?.addEventListener('click', () => { dismissLayer(document.querySelector('.sheet-backdrop')); setTimeout(openCorrectionManager, 170); });
}

function adminWorkViewMarkup() {
  return `<div class="admin-work-view">
    <div class="admin-work-segmented" role="tablist" aria-label="근무 관리 화면"><button class="${adminWorkView === 'schedule' ? 'is-active' : ''}" data-work-view="schedule" role="tab" aria-selected="${adminWorkView === 'schedule'}">근무표</button><button class="${adminWorkView === 'attendance' ? 'is-active' : ''}" data-work-view="attendance" role="tab" aria-selected="${adminWorkView === 'attendance'}">근태기록</button></div>
    ${adminWorkView === 'attendance' ? adminAttendanceWorkspace() : adminScheduleWorkspace()}
  </div>`;
}

function adminScheduleCalendarCell(date) {
  if (!date) return '<div class="admin-schedule-spacer"></div>';
  const assignments = (state.schedules || []).filter((row) => row.workDate === date).slice().sort((a,b) => a.scheduledStart.localeCompare(b.scheduledStart) || String(employeeById(a.employeeId)?.name || '').localeCompare(String(employeeById(b.employeeId)?.name || '')));
  const names = assignments.map((row) => employeeById(row.employeeId)?.name).filter(Boolean);
  return `<button class="admin-schedule-day ${date === adminWorkSelectedDate ? 'is-selected' : ''} ${date === kstDate() ? 'is-today' : ''} ${assignments.length ? 'has-schedule' : ''}" data-admin-schedule-date="${date}"><span class="admin-schedule-day-number">${Number(date.slice(-2))}</span>${names.length ? `<span class="admin-schedule-name-list">${names.map((name) => `<span>${esc(name)}</span>`).join('')}</span>` : ''}</button>`;
}

function adminScheduleInspector() {
  const date = adminWorkSelectedDate;
  const assignments = (state.schedules || []).filter((row) => row.workDate === date).slice().sort((a,b) => a.scheduledStart.localeCompare(b.scheduledStart));
  const dateLabel = date ? longDate(date) : '';
  return `<aside class="admin-schedule-inspector">
    <div class="admin-inspector-heading"><span>선택 날짜</span><h3>${date ? esc(dateLabel) : '날짜를 선택하세요'}</h3></div>
    ${date ? `<div class="admin-inspector-list">${assignments.length ? assignments.map((row) => { const employee = employeeById(row.employeeId); return `<div class="admin-inspector-row"><span class="avatar">${esc(employee?.name?.slice(0,1) || '?')}</span><span><b>${esc(employee?.name || '직원')}</b><small>${esc(row.scheduledStart)}–${esc(row.scheduledEnd)} · ${esc(shiftTypeLabel(row.shiftType))}</small></span></div>`; }).join('') : '<div class="admin-empty-state compact"><b>배정된 근무가 없어요.</b><span>이 날짜에 첫 근무를 배정해 보세요.</span></div>'}</div>
      <button class="action-button primary-action admin-inspector-action" id="adminScheduleManage"><span>${assignments.length ? '근무 추가·수정' : '근무 배정'}</span></button>` : '<div class="admin-empty-state"><b>근무를 확인하거나 배정할 날짜를 선택하세요.</b><span>달력에서 날짜를 누르면 배정된 직원을 볼 수 있어요.</span></div>'}
  </aside>`;
}

function adminScheduleWorkspace() {
  const cells = monthCalendar(adminWorkMonth);
  return `<section class="admin-work-panel">
    <div class="admin-work-toolbar"><div><span>월간 스케줄</span><h2>${esc(monthTitle(adminWorkMonth))}</h2></div><div class="admin-work-actions"><button class="today-jump" id="adminScheduleToday">오늘</button><button class="circle-button small" id="adminWorkPrev" aria-label="이전 달">${icon('back')}</button><button class="circle-button small" id="adminWorkNext" aria-label="다음 달">${icon('forward')}</button><button class="admin-secondary-cta" id="adminWeeklyShare">${icon('download')}<span>주간 공유</span></button></div></div>
    <div class="admin-schedule-workspace">
      <div class="admin-schedule-calendar-wrap"><div class="week-row">${['일','월','화','수','목','금','토'].map((day) => `<span>${day}</span>`).join('')}</div><div class="admin-schedule-calendar">${cells.map(adminScheduleCalendarCell).join('')}</div></div>
      ${adminScheduleInspector()}
    </div>
  </section>`;
}

function adminAttendanceWorkspace() {
  const all = (state.attendance || []).slice().sort((a,b) => b.workDate.localeCompare(a.workDate) || Number(b.sessionNo || 1) - Number(a.sessionNo || 1));
  const totalMinutes = all.reduce((sum,row) => sum + Number(row.workMinutes || 0), 0);
  const lateCount = all.filter((row) => Number(row.lateMinutes || 0) > 0).length;
  const extraCount = all.filter((row) => row.sessionType === 'extra').length;
  let records = all;
  if (adminAttendanceEmployee) records = records.filter((row) => row.employeeId === adminAttendanceEmployee);
  if (adminAttendanceFilter === 'issues') records = records.filter((row) => Number(row.lateMinutes || 0) > 0 || Number(row.earlyLeaveMinutes || 0) > 0 || !row.clockOut);
  const options = activeEmployees().map((employee) => `<option value="${employee.id}" ${employee.id === adminAttendanceEmployee ? 'selected' : ''}>${esc(employee.name)}</option>`).join('');
  return `<section class="admin-work-panel">
    <div class="admin-work-toolbar"><div><span>근태 기록</span><h2>${esc(monthTitle(adminWorkMonth))}</h2></div><div class="admin-work-actions"><button class="circle-button small" id="adminWorkPrev" aria-label="이전 달">${icon('back')}</button><button class="circle-button small" id="adminWorkNext" aria-label="다음 달">${icon('forward')}</button><button class="admin-secondary-cta" id="exportExcel">${icon('download')}<span>Excel</span></button></div></div>
    <div class="admin-attendance-summary"><div><b>${formatMinutes(totalMinutes)}</b><span>총 근무시간</span></div><div><b>${lateCount}</b><span>지각 기록</span></div><div><b>${extraCount}</b><span>추가근무</span></div></div>
    <div class="admin-record-filters"><div class="admin-small-segmented"><button class="${adminAttendanceFilter === 'all' ? 'is-active' : ''}" data-attendance-filter="all">전체</button><button class="${adminAttendanceFilter === 'issues' ? 'is-active' : ''}" data-attendance-filter="issues">이상 기록</button></div><select id="adminAttendanceEmployee" aria-label="직원 필터"><option value="">전체 직원</option>${options}</select></div>
    <div class="admin-attendance-records">${records.length ? records.map(attendanceAdminRow).join('') : '<div class="admin-empty-state"><b>조건에 맞는 근태 기록이 없어요.</b><span>필터를 변경하거나 다른 달을 확인해 보세요.</span></div>'}</div>
  </section>`;
}

async function adminLoadWorkMonth(targetMonth) {
  if (!targetMonth || targetMonth === adminWorkMonth) return;
  document.querySelector('.admin-workspace')?.classList.add('is-refreshing');
  try {
    await load(targetMonth);
    adminWorkMonth = targetMonth;
    adminWorkSelectedDate = targetMonth === currentMonth() ? kstDate() : `${targetMonth}-01`;
  } catch (error) {
    toastMsg(error.message);
  }
  renderAdmin();
}

function openAdminScheduleManagerAt(date) {
  openScheduleManager();
  if (date) toggleScheduleDate(date);
}

function bindAdminWork() {
  document.querySelectorAll('[data-work-view]').forEach((button) => { button.onclick = () => { adminWorkView = button.dataset.workView === 'attendance' ? 'attendance' : 'schedule'; renderAdmin(); }; });
  document.querySelector('#adminWorkPrev')?.addEventListener('click', () => adminLoadWorkMonth(shiftMonth(adminWorkMonth, -1)));
  document.querySelector('#adminWorkNext')?.addEventListener('click', () => adminLoadWorkMonth(shiftMonth(adminWorkMonth, 1)));
  document.querySelector('#adminScheduleToday')?.addEventListener('click', () => { if (adminWorkMonth === currentMonth()) { adminWorkSelectedDate = kstDate(); renderAdmin(); } else adminLoadWorkMonth(currentMonth()); });
  document.querySelectorAll('[data-admin-schedule-date]').forEach((button) => { button.onclick = () => { adminWorkSelectedDate = button.dataset.adminScheduleDate; renderAdmin(); }; });
  document.querySelector('#adminScheduleManage')?.addEventListener('click', () => openAdminScheduleManagerAt(adminWorkSelectedDate));
  document.querySelector('#adminWeeklyShare')?.addEventListener('click', () => { scheduleMonth = adminWorkMonth; openWeeklyScheduleShare(); });
  document.querySelectorAll('[data-attendance-filter]').forEach((button) => { button.onclick = () => { adminAttendanceFilter = button.dataset.attendanceFilter === 'issues' ? 'issues' : 'all'; renderAdmin(); }; });
  document.querySelector('#adminAttendanceEmployee')?.addEventListener('change', (event) => { adminAttendanceEmployee = event.target.value || ''; renderAdmin(); });
  document.querySelectorAll('.admin-attendance-records [data-correct]').forEach((button) => { button.onclick = () => openCorrectionSheet(button.dataset.correct); });
  document.querySelector('#exportExcel')?.addEventListener('click', exportExcel);
}

function adminOperationRow(iconName, title, description, value, action, tone = '') {
  return `<button class="admin-operation-row" data-operation-action="${action}"><span class="admin-operation-icon ${tone}">${icon(iconName)}</span><span class="admin-operation-copy"><b>${esc(title)}</b><small>${esc(description)}</small></span>${value ? `<span class="admin-operation-value">${esc(value)}</span>` : ''}${icon('chevron','chevron')}</button>`;
}

function adminOperationsView() {
  const today = kstDate();
  const staff = activeEmployees();
  const manualPending = (state.taskAssignments || []).filter((task) => task.workDate === today && task.sourceType !== 'checklist' && task.status !== 'completed').length;
  const activeTemplates = (state.checklistTemplates || []).filter((template) => template.active).length;
  return `<div class="admin-operations-view">
    <section class="admin-operations-hero"><span class="overline">운영 설정</span><h2>매장 운영을 한곳에서 관리해요.</h2><p>직원, 추가 업무, 반복 체크리스트를 필요한 순간에 바로 관리할 수 있습니다.</p></section>
    <section class="admin-operation-group"><div class="admin-operation-group-title"><span>인력</span><h3>직원</h3></div>${adminOperationRow('people','직원 관리','직원 등록, 정보 수정, 재직 상태를 관리해요',`${staff.length}명`,'employees')}</section>
    <section class="admin-operation-group"><div class="admin-operation-group-title"><span>업무</span><h3>오늘 추가 업무</h3></div>${adminOperationRow('task','업무 배정','체크리스트와 별개로 직원에게 오늘 할 일을 전달해요',`${manualPending}건`,'tasks')}</section>
    <section class="admin-operation-group"><div class="admin-operation-group-title"><span>반복 업무</span><h3>체크리스트</h3></div>${adminOperationRow('check','체크리스트 템플릿','오픈 · 미들 · 마감 반복 업무를 관리해요',`${activeTemplates}개 사용 중`,'checklists','is-purple')}</section>
  </div>`;
}

function bindAdminOperations() {
  document.querySelectorAll('[data-operation-action]').forEach((button) => {
    button.onclick = () => {
      const action = button.dataset.operationAction;
      if (action === 'employees') return openEmployeeManager();
      if (action === 'tasks') return openTaskManager();
      if (action === 'checklists') return openChecklistManager();
    };
  });
}

function adminShellContent() {
  if (adminSection === 'work') return adminWorkViewMarkup();
  if (adminSection === 'operations') return adminOperationsView();
  return adminTodayView();
}

function bindAdminToday() {
  document.querySelectorAll('[data-today-filter]').forEach((button) => { button.onclick = () => { adminTodayFilter = button.dataset.todayFilter || 'all'; renderAdmin(); }; });
  document.querySelectorAll('[data-admin-staff]').forEach((button) => { button.onclick = () => openAdminStaffQuickSheet(button.dataset.adminStaff); });
  document.querySelectorAll('[data-admin-attendance-action]').forEach((button) => {
    button.onclick = (event) => {
      event.stopPropagation();
      const [employeeId, action] = button.dataset.adminAttendanceAction.split('|');
      openAdminAttendanceConfirm(employeeId, action);
    };
  });
}

function bindAdminShell() {
  document.querySelectorAll('[data-admin-section]').forEach((button) => {
    button.onclick = async () => {
      const next = button.dataset.adminSection;
      if (!ADMIN_SECTIONS.some((item) => item.key === next) || next === adminSection) return;
      if (next === 'today' && month !== currentMonth()) {
        document.querySelector('.admin-workspace')?.classList.add('is-refreshing');
        try { await load(currentMonth()); } catch (error) { toastMsg(error.message); return; }
        adminWorkMonth = month;
      }
      if (next === 'work') adminWorkMonth = month;
      adminSection = next;
      renderAdmin();
      haptic(5);
    };
  });
  document.querySelector('#adminAccount')?.addEventListener('click', openLogoutSheet);
  document.querySelector('#adminHeaderAccount')?.addEventListener('click', openLogoutSheet);
  if (adminSection === 'today') bindAdminToday();
  if (adminSection === 'work') bindAdminWork();
  if (adminSection === 'operations') bindAdminOperations();
}

function renderAdmin() {
  clearInterval(liveTimer);
  const meta = adminSectionMeta();
  root.innerHTML = `<main class="admin-redesign-shell native-canvas">
    <aside class="admin-rail glass-surface" aria-label="관리자 주요 메뉴">
      <div class="admin-rail-brand" aria-label="${esc(state?.storeName || '근태기록부')}">${icon('clock')}</div>
      <nav class="admin-rail-nav">${adminNavItems('admin-rail-item')}</nav>
      <button class="admin-rail-account" id="adminAccount" aria-label="관리자 계정">${icon('more')}<span>관리자</span></button>
    </aside>
    <section class="admin-workspace">
      <header class="admin-workspace-header"><div><span>${esc(state?.storeName || '근태기록부')}</span><h1>${esc(meta.label)}</h1></div><button class="icon-button admin-header-account" id="adminHeaderAccount" aria-label="관리자 계정">${icon('more')}</button></header>
      <div class="admin-workspace-body">${adminShellContent()}</div>
    </section>
    <nav class="admin-mobile-nav glass-surface" aria-label="관리자 주요 메뉴">${adminNavItems('admin-mobile-nav-item')}</nav>
  </main>`;
  bindAdminShell();
}
