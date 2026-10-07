let adminHomeTab = 'overview';

function renderAdmin() {
  clearInterval(liveTimer);
  const metrics = adminMetrics(state, kstDate());
  const date = kstDate();
  const staff = activeEmployees();
  const todayRows = staff.map((employee) => {
    const schedule = scheduleFor(employee.id, date);
    const daily = dailyAttendanceSummary(employee.id, date);
    const tasks = todayTasks(state.taskAssignments || [], employee.id, date);
    const stateLabel = daily.open?.sessionType === 'extra' ? '추가 근무 중'
      : daily.open ? '근무 중'
        : daily.completed.length && daily.hasExtra ? '추가 근무 완료'
          : daily.completed.length ? '퇴근 완료'
            : schedule ? '출근 전'
              : '일정 없음';
    return `<div class="person-row"><div class="avatar">${esc(employee.name.slice(0,1))}</div><div class="person-copy"><b>${esc(employee.name)}</b><span>${schedule ? `${schedule.scheduledStart} — ${schedule.scheduledEnd}` : daily.hasExtra ? '추가 근무 기록 있음' : '근무 일정 없음'}</span></div><div class="person-state"><b>${esc(stateLabel)}</b><span>${tasks.filter((t) => t.status !== 'completed').length ? `할 일 ${tasks.filter((t) => t.status !== 'completed').length}건` : '할 일 없음'}</span></div></div>`;
  }).join('');
  const overview = `<section class="admin-hero"><span class="overline">${esc(longDate(date))}</span><h1>${metrics.working ? `${metrics.working}명 근무 중` : '현재 근무 중인 직원이 없어요'}</h1><p>${metrics.clockedOut}명 퇴근 · ${metrics.pendingTasks}건 할 일 남음 · ${metrics.late}명 지각</p><div class="hero-metrics"><div><b>${metrics.scheduled}</b><span>오늘 근무</span></div><div><b>${metrics.clockedIn}</b><span>출근 완료</span></div><div><b>${metrics.clockedOut}</b><span>퇴근 완료</span></div></div></section>
    <section class="settings-list surface-card" aria-label="관리 메뉴">
      ${settingsRow('calendar','근무표','월간 스케줄을 배정하고 수정해요',`${(state.schedules || []).length}건`,'scheduleManage')}
      ${settingsRow('people','직원','직원 등록과 재직 상태를 관리해요',`${staff.length}명`,'employeeManage')}
      ${settingsRow('task','업무','직원별 오늘 할 일을 전달해요',`${metrics.pendingTasks}건`,'taskManage')}
      ${settingsRow('task','체크리스트','오픈 · 미들 · 마감 반복 업무를 관리해요',`${(state.checklistTemplates || []).filter((t) => t.active).length}개`,'checklistManage')}
      ${settingsRow('edit','근태 기록','출퇴근 기록을 확인하고 정정해요','', 'correctionManage')}
      ${settingsRow('chart','월간 리포트','이번 달 근태와 업무를 Excel로 저장해요','Excel','exportExcel')}
    </section>
    ${adminChecklistTodayMarkup(date, staff)}
    <section class="native-section admin-today"><div class="section-heading"><div><span>오늘</span><h2>직원 현황</h2></div><small>${staff.length}명 재직</small></div><div class="people-list">${todayRows || '<div class="native-empty"><p>등록된 직원이 없습니다.<br>직원 메뉴에서 실제 직원을 추가하세요.</p></div>'}</div></section>`;
  root.innerHTML = `<main class="admin-screen native-canvas">
    <header class="admin-nav"><div><span>${esc(displayStoreName())}</span><b>관리자</b></div><button class="icon-button" id="adminLogout" aria-label="계정 메뉴">${icon('more')}</button></header>
    ${adminHomeTabsMarkup()}
    ${adminHomeTab === 'attendance' ? adminAttendanceTabMarkup(date, staff) : overview}
  </main>`;
  document.querySelector('#adminLogout').onclick = openLogoutSheet;
  document.querySelector('#adminOverviewTab').onclick = () => setAdminHomeTab('overview');
  document.querySelector('#adminAttendanceTab').onclick = () => setAdminHomeTab('attendance');
  if (adminHomeTab === 'attendance') {
    document.querySelectorAll('[data-admin-attendance-action]').forEach((button) => {
      button.onclick = () => {
        const [employeeId, action] = button.dataset.adminAttendanceAction.split('|');
        openAdminAttendanceConfirm(employeeId, action);
      };
    });
    return;
  }
  document.querySelector('#employeeManage').onclick = openEmployeeManager;
  document.querySelector('#scheduleManage').onclick = openScheduleManager;
  document.querySelector('#taskManage').onclick = openTaskManager;
  document.querySelector('#checklistManage').onclick = openChecklistManager;
  document.querySelector('#correctionManage').onclick = openCorrectionManager;
  document.querySelector('#exportExcel').onclick = exportExcel;
}


function adminHomeTabsMarkup() {
  return `<nav class="admin-home-tabs" aria-label="관리자 화면"><button id="adminOverviewTab" class="admin-home-tab ${adminHomeTab === 'overview' ? 'is-active' : ''}">현황</button><button id="adminAttendanceTab" class="admin-home-tab ${adminHomeTab === 'attendance' ? 'is-active' : ''}">오늘 출퇴근</button></nav>`;
}
function setAdminHomeTab(tab) {
  adminHomeTab = tab === 'attendance' ? 'attendance' : 'overview';
  renderAdmin();
}
function adminAttendanceActionState(employee, date) {
  const daily = dailyAttendanceSummary(employee.id, date);
  const schedule = scheduleFor(employee.id, date);
  if (daily.open) return {
    status: daily.open.sessionType === 'extra' ? '추가 근무 중' : '근무 중',
    detail: `${sessionLabel(daily.open)} · ${fmtTime(daily.open.clockIn)} 출근`,
    action: 'clock_out', label: '퇴근 처리', tone: 'destructive-action',
  };
  if (daily.completed.length) {
    const latest = daily.completed[daily.completed.length - 1];
    return {
      status: daily.hasExtra ? '추가 근무 완료' : '퇴근 완료',
      detail: `최근 퇴근 ${fmtTime(latest.clockOut)} · 오늘 ${formatMinutes(daily.totalWorkMinutes)}`,
      action: 'start_extra', label: '추가 근무 시작', tone: 'secondary-action',
    };
  }
  return {
    status: schedule ? '출근 전' : '일정 없음',
    detail: schedule ? `${schedule.scheduledStart} — ${schedule.scheduledEnd}` : '오늘 배정된 근무표가 없습니다.',
    action: 'clock_in', label: '출근 처리', tone: 'primary-action',
  };
}
function adminAttendanceTabMarkup(date, staff) {
  const rows = staff.map((employee) => {
    const control = adminAttendanceActionState(employee, date);
    return `<article class="admin-attendance-row"><div class="avatar">${esc(employee.name.slice(0,1))}</div><div class="admin-attendance-copy"><b>${esc(employee.name)}</b><span>${esc(control.detail)}</span><small>${esc(control.status)}</small></div><button class="action-button ${control.tone} admin-attendance-action" data-admin-attendance-action="${employee.id}|${control.action}"><span>${esc(control.label)}</span></button></article>`;
  }).join('');
  return `<section class="admin-attendance-view"><div class="section-heading"><div><span>${esc(longDate(date))}</span><h2>오늘 출퇴근</h2></div><small>관리자 처리</small></div><p class="admin-attendance-guide">직원이 직접 기록하기 어려운 경우에만 사용하세요. 버튼을 누른 현재 시각으로 기록되며 관리자 처리 이력이 남습니다.</p><div class="admin-attendance-list">${rows || '<div class="native-empty"><p>재직 중인 직원이 없습니다.</p></div>'}</div></section>`;
}
function openAdminAttendanceConfirm(employeeId, action) {
  const employee = employeeById(employeeId);
  if (!employee) return;
  const labels = {
    clock_in: ['출근 처리', '출근'],
    clock_out: ['퇴근 처리', '퇴근'],
    start_extra: ['추가 근무 시작', '추가 근무'],
  };
  const [title, noun] = labels[action] || labels.clock_in;
  openSheet(`<div class="sheet-heading"><div><span class="sheet-kicker">관리자 처리</span><h2>${esc(employee.name)}님을 ${title}할까요?</h2><p>확인 버튼을 누르는 현재 시각으로 ${noun} 기록이 저장됩니다.</p></div></div><div class="sheet-notice">직원이 직접 입력한 기록과 구분되도록 관리자 처리 이력이 서버에 남습니다.</div><div class="sheet-actions"><button class="action-button secondary-action" data-close><span>취소</span></button><button class="action-button ${action === 'clock_out' ? 'destructive-action' : 'primary-action'}" id="confirmAdminAttendance"><span>${title}</span></button></div>`, { size:'compact' });
  document.querySelector('#confirmAdminAttendance').onclick = () => runAdminAttendanceAction(employeeId, action);
}
async function runAdminAttendanceAction(employeeId, action, checklistOverrideReason = '') {
  const button = document.querySelector('#confirmAdminAttendance') || document.querySelector('#confirmAdminChecklistOverride');
  setPending(button, true, '처리 중');
  try {
    await api.adminAttendance(session.token, employeeId, action, checklistOverrideReason);
    await load(currentMonth());
    adminHomeTab = 'attendance';
    dismissLayer(document.querySelector('.sheet-backdrop'));
    renderAdmin();
    const message = action === 'clock_in' ? '출근을 처리했습니다.' : action === 'clock_out' ? '퇴근을 처리했습니다.' : '추가 근무를 시작했습니다.';
    toastMsg(message); haptic(10);
  } catch (e) {
    if (action === 'clock_out' && e.data?.requiresChecklistOverride) {
      dismissLayer(document.querySelector('.sheet-backdrop'));
      setTimeout(() => openAdminChecklistOverride(employeeId, e.data?.pendingItems || []), 170);
      return;
    }
    toastMsg(e.message);
  } finally { if (button?.isConnected) setPending(button, false); }
}

function openAdminChecklistOverride(employeeId, pendingItems = []) {
  const employee = employeeById(employeeId);
  if (!employee) return;
  const items = pendingItems.map((item) => `<li><span>${esc(checklistShiftLabel(item.shiftType))}</span><b>${esc(item.title)}</b></li>`).join('');
  openSheet(`<div class="sheet-heading"><div><span class="sheet-kicker warning-kicker">관리자 퇴근 처리</span><h2>${esc(employee.name)}님의 필수 업무가 남아 있어요.</h2><p>예외적으로 퇴근 처리해야 한다면 미완료 사유를 남겨 주세요. 관리자 처리 이력과 함께 저장됩니다.</p></div></div><ul class="checklist-pending-list">${items}</ul>${field({ id:'adminChecklistOverrideReason', label:'미완료 사유', textarea:true, placeholder:'예: 인력 교체로 다음 근무자에게 인계함' })}<div class="sheet-actions"><button class="action-button secondary-action" data-close><span>취소</span></button><button class="action-button destructive-action" id="confirmAdminChecklistOverride"><span>사유 입력 후 퇴근 처리</span></button></div>`, { size:'compact checklist-override-sheet' });
  document.querySelector('#confirmAdminChecklistOverride').onclick = async () => {
    clearFieldErrors(document.querySelector('.glass-sheet'));
    const reason = document.querySelector('#adminChecklistOverrideReason').value.trim();
    if (!reason) return showFieldError('adminChecklistOverrideReason', '미완료 사유를 입력해 주세요.');
    await runAdminAttendanceAction(employeeId, 'clock_out', reason);
  };
}

function adminChecklistTodayMarkup(date, staff) {
  const all = (state.taskAssignments || []).filter((task) => task.workDate === date && task.sourceType === 'checklist');
  const rows = staff.map((employee) => {
    const tasks = all.filter((task) => task.employeeId === employee.id);
    if (!tasks.length) return '';
    const completed = tasks.filter((task) => task.status === 'completed').length;
    const requiredPending = tasks.filter((task) => task.required && task.status !== 'completed').length;
    const percent = Math.round(completed / tasks.length * 100);
    const shifts = [...new Set(tasks.map((task) => checklistShiftLabel(task.shiftType)))].join(' · ');
    return `<article class="admin-checklist-progress-row"><div class="avatar">${esc(employee.name.slice(0,1))}</div><div class="admin-checklist-progress-copy"><div><b>${esc(employee.name)}</b><span>${esc(shifts)}</span></div><div class="checklist-progress"><span style="width:${percent}%"></span></div><small>${completed}/${tasks.length} 완료${requiredPending ? ` · 필수 ${requiredPending}개 남음` : ' · 필수 완료'}</small></div></article>`;
  }).filter(Boolean).join('');
  if (!rows) return `<section class="native-section admin-checklist-today"><div class="section-heading"><div><span>오늘 체크리스트</span><h2>자동 생성된 체크리스트가 없어요</h2></div><small>0건</small></div></section>`;
  const completed = all.filter((task) => task.status === 'completed').length;
  return `<section class="native-section admin-checklist-today"><div class="section-heading"><div><span>오늘 체크리스트</span><h2>${all.length - completed ? `${all.length - completed}개 업무가 남았어요` : '모든 체크리스트 완료'}</h2></div><small>${completed}/${all.length}</small></div><div class="admin-checklist-progress-list">${rows}</div></section>`;
}

function settingsRow(iconName, title, description, value, id) {
  return `<button class="settings-row" id="${id}"><span class="settings-icon">${icon(iconName)}</span><span class="settings-copy"><b>${esc(title)}</b><small>${esc(description)}</small></span>${value ? `<span class="settings-value">${esc(value)}</span>` : ''}${icon('chevron','chevron')}</button>`;
}

function openEmployeeManager() {
  const employees = state.employees || [];
  openPanel(`<div class="panel-nav"><button class="circle-button" data-close aria-label="닫기">${icon('close')}</button><div><span>관리</span><h2>직원</h2></div><button class="panel-add" id="openAddEmployee">${icon('plus')}<span>추가</span></button></div><div class="panel-content"><section class="panel-intro"><h3>직원 목록</h3><p>퇴사 처리해도 과거 근무·업무 기록은 그대로 유지됩니다.</p></section><div class="employee-list">${employees.length ? employees.map(employeeRow).join('') : '<div class="native-empty"><p>등록된 직원이 없습니다.</p></div>'}</div></div>`);
  document.querySelector('#openAddEmployee').onclick = openAddEmployeeSheet;
  document.querySelectorAll('[data-employee-status]').forEach((button) => { button.onclick = () => openEmployeeStatusSheet(button.dataset.employeeStatus, button.dataset.active === 'true'); });
  document.querySelectorAll('[data-employee-edit]').forEach((button) => { button.onclick = () => openEditEmployeeSheet(button.dataset.employeeEdit); });
}
function employeeRow(employee) {
  return `<div class="employee-row"><div class="avatar large">${esc(employee.name.slice(0,1))}</div><div class="employee-copy"><b>${esc(employee.name)}</b><span>${esc(employee.position)}</span></div><span class="employment-badge ${employee.active ? 'is-active' : ''}">${employee.active ? '재직' : '퇴사'}</span><button class="row-action" data-employee-edit="${employee.id}">편집</button></div>`;
}
function openEditEmployeeSheet(employeeId) {
  const employee = employeeById(employeeId);
  if (!employee) return;
  openSheet(`<div class="sheet-heading"><div><span class="sheet-kicker">직원 편집</span><h2>${esc(employee.name)}님의 정보를 수정해요</h2><p>PIN을 비워두면 기존 PIN이 유지됩니다. 정보를 저장하면 해당 직원은 새 정보로 다시 로그인해야 합니다.</p></div></div>${field({ id:'editEmployeeName', label:'이름', value:employee.name, placeholder:'직원 이름' })}${field({ id:'editEmployeePosition', label:'직급', value:employee.position || '스태프', placeholder:'예: 바리스타' })}${field({ id:'editEmployeePin', label:'새 PIN', type:'password', inputmode:'numeric', maxlength:'4', placeholder:'변경할 때만 4자리', hint:'비워두면 기존 PIN을 유지합니다.' })}<button class="action-button primary-action" id="saveEmployeeEdit"><span>변경사항 저장</span></button><button class="action-button ${employee.active ? 'secondary-action' : 'primary-action'}" id="editEmployeeStatusBtn" style="margin-top:10px"><span>${employee.active ? '퇴사 처리' : '재직 복귀'}</span></button><button class="action-button destructive-action" id="deleteEmployeeBtn" style="margin-top:10px"><span>직원 삭제</span></button>`, { size:'compact' });
  document.querySelector('#saveEmployeeEdit').onclick = () => saveEmployeeEdit(employeeId);
  document.querySelector('#editEmployeeStatusBtn').onclick = () => openEmployeeStatusSheet(employeeId, !employee.active);
  document.querySelector('#deleteEmployeeBtn').onclick = () => openDeleteEmployeeSheet(employeeId);
}
async function saveEmployeeEdit(employeeId) {
  clearFieldErrors(document.querySelector('.glass-sheet'));
  const name = document.querySelector('#editEmployeeName').value.trim();
  const position = document.querySelector('#editEmployeePosition').value.trim() || '스태프';
  const pin = document.querySelector('#editEmployeePin').value.trim();
  if (!name) return showFieldError('editEmployeeName', '이름을 입력해 주세요.');
  if (pin && !/^\d{4}$/.test(pin)) return showFieldError('editEmployeePin', 'PIN은 변경할 경우 4자리 숫자로 입력해 주세요.');
  const button = document.querySelector('#saveEmployeeEdit');
  setPending(button, true, '저장 중');
  try {
    await api.updateEmployee(session.token, { employeeId, name, position, ...(pin ? { pin } : {}) });
    await load(month);
    dismissLayer(document.querySelector('.sheet-backdrop'));
    openEmployeeManager();
    toastMsg('직원 정보를 수정했습니다.'); haptic(10);
  } catch (e) { showFieldError(pin ? 'editEmployeePin' : 'editEmployeeName', e.message); }
  finally { if (button?.isConnected) setPending(button, false); }
}
function openDeleteEmployeeSheet(employeeId) {
  const employee = employeeById(employeeId);
  if (!employee) return;
  openSheet(`<div class="sheet-heading"><div><span class="sheet-kicker danger-kicker">직원 삭제</span><h2>${esc(employee.name)}님을 삭제할까요?</h2><p>잘못 등록한 직원처럼 실제 근태 이력이 없는 경우에만 완전 삭제할 수 있습니다.</p></div></div><div class="sheet-notice warning">실제 근태 또는 과거 근태 감사 이력이 있으면 삭제되지 않습니다. 이런 직원은 퇴사 처리를 사용해 주세요.</div><div class="sheet-actions"><button class="action-button secondary-action" data-close><span>취소</span></button><button class="action-button destructive-action" id="confirmDeleteEmployee"><span>직원 삭제</span></button></div>`, { size:'compact' });
  document.querySelector('#confirmDeleteEmployee').onclick = () => deleteEmployeeRecord(employeeId);
}
async function deleteEmployeeRecord(employeeId) {
  const button = document.querySelector('#confirmDeleteEmployee');
  setPending(button, true, '삭제 중');
  try {
    await api.deleteEmployee(session.token, employeeId);
    await load(month);
    dismissLayer(document.querySelector('.sheet-backdrop'));
    openEmployeeManager();
    toastMsg('직원을 삭제했습니다.'); haptic([10,35,10]);
  } catch (e) { toastMsg(e.message); }
  finally { if (button?.isConnected) setPending(button, false); }
}

function openAddEmployeeSheet() {
  openSheet(`<div class="sheet-heading"><div><span class="sheet-kicker">새 직원</span><h2>직원을 추가해요</h2><p>PIN은 직원이 개인 휴대폰에서 로그인할 때 사용합니다.</p></div></div>${field({ id:'empName', label:'이름', placeholder:'직원 이름', autocomplete:'name' })}${field({ id:'empPosition', label:'직급', value:'스태프', placeholder:'예: 바리스타' })}${field({ id:'empPin', label:'개인 PIN', type:'password', inputmode:'numeric', maxlength:'4', placeholder:'4자리', hint:'다른 직원과 겹치지 않게 알려주세요.' })}<button class="action-button primary-action" id="addEmployeeBtn"><span>직원 추가</span></button>`, { size:'compact' });
  document.querySelector('#addEmployeeBtn').onclick = addEmployee;
}
async function addEmployee() {
  clearFieldErrors(document.querySelector('.glass-sheet'));
  const name = document.querySelector('#empName').value.trim();
  const position = document.querySelector('#empPosition').value.trim() || '스태프';
  const pin = document.querySelector('#empPin').value;
  if (!name) return showFieldError('empName', '이름을 입력해 주세요.');
  if (!/^\d{4}$/.test(pin)) return showFieldError('empPin', 'PIN 4자리를 입력해 주세요.');
  const button = document.querySelector('#addEmployeeBtn');
  setPending(button, true, '추가 중');
  try {
    await api.addEmployee(session.token, { name, position, pin });
    await load(month);
    dismissLayer(document.querySelector('.sheet-backdrop'));
    openEmployeeManager();
    toastMsg('직원을 추가했습니다.'); haptic(10);
  } catch (e) { showFieldError('empPin', e.message); }
  finally { setPending(button, false); }
}
function openEmployeeStatusSheet(employeeId, active) {
  const employee = employeeById(employeeId);
  const returning = active;
  openSheet(`<div class="sheet-heading"><div><span class="sheet-kicker ${returning ? '' : 'danger-kicker'}">${returning ? '재직 복귀' : '퇴사 처리'}</span><h2>${esc(employee?.name || '직원')}님을 ${returning ? '재직 상태로 바꿀까요?' : '퇴사 처리할까요?'}</h2><p>${returning ? '다시 로그인하고 근무표·업무를 배정받을 수 있습니다.' : '로그인이 즉시 해제되며 과거 기록은 유지됩니다.'}</p></div></div><div class="sheet-actions"><button class="action-button secondary-action" data-close><span>취소</span></button><button class="action-button ${returning ? 'primary-action' : 'destructive-action'}" id="confirmEmployeeStatus"><span>${returning ? '재직 복귀' : '퇴사 처리'}</span></button></div>`, { size:'compact' });
  document.querySelector('#confirmEmployeeStatus').onclick = () => setEmployeeStatus(employeeId, active);
}
async function setEmployeeStatus(employeeId, active) {
  const button = document.querySelector('#confirmEmployeeStatus');
  setPending(button, true, '처리 중');
  try {
    await api.setEmployeeStatus(session.token, employeeId, active);
    await load(month);
    dismissLayer(document.querySelector('.sheet-backdrop'));
    openEmployeeManager();
    toastMsg(active ? '재직 상태로 변경했습니다.' : '퇴사 처리했습니다.');
  } catch (e) { toastMsg(e.message); }
  finally { setPending(button, false); }
}

