const KST = 'Asia/Seoul';

function kstDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: KST }).format(now);
}

function currentMonth(now = new Date()) {
  return kstDate(now).slice(0, 7);
}

function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function attendanceState(attendance, today = kstDate()) {
  if (!attendance?.clockIn) return { key: 'before', primary: 'clock_in', canCancelClockOut: false };
  if (!attendance.clockOut) return { key: 'working', primary: 'clock_out', canCancelClockOut: false };
  const canCancelClockOut = attendance.workDate === today && Number(attendance.clockOutCancelCount || 0) < 1;
  return { key: canCancelClockOut ? 'clocked_out_reversible' : 'done', primary: null, canCancelClockOut };
}


function sortTasksForToday(assignments = []) {
  return [...assignments].sort((a, b) => {
    const aDone = a.status === 'completed' ? 1 : 0;
    const bDone = b.status === 'completed' ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    return String(a.createdAt || a.id || '').localeCompare(String(b.createdAt || b.id || ''));
  });
}

function attendanceHero(attendance, schedule, today = kstDate()) {
  const state = attendanceState(attendance, today);
  const shift = schedule ? `${schedule.scheduledStart} — ${schedule.scheduledEnd}` : '근무시간 미등록';
  if (state.key === 'before') return {
    state: state.key,
    eyebrow: '출근 전',
    title: schedule ? `${schedule.scheduledStart} 출근 예정` : '오늘 근무를 시작해볼까요?',
    subtitle: shift,
    primaryAction: 'clock_in',
    primaryLabel: '출근하기',
    secondaryAction: null,
    completed: false,
  };
  if (state.key === 'working') {
    const extra = attendance?.sessionType === 'extra';
    return {
      state: state.key,
      eyebrow: extra ? '추가 근무 중' : '근무 중',
      title: extra ? '추가 근무 중이에요' : '지금 근무 중이에요',
      subtitle: extra ? '예정 시간 없이 실제 근무시간으로 기록합니다.' : shift,
      primaryAction: 'clock_out',
      primaryLabel: '퇴근하기',
      secondaryAction: null,
      completed: false,
    };
  }
  const reversible = state.key === 'clocked_out_reversible';
  const extra = attendance?.sessionType === 'extra';
  return {
    state: state.key,
    eyebrow: extra ? '추가 근무 완료' : '근무 완료',
    title: extra ? '추가 근무를 마쳤어요' : '오늘 근무를 마쳤어요',
    subtitle: extra ? '오늘 근무 기록에 합산되었습니다.' : shift,
    primaryAction: null,
    primaryLabel: '오늘 근무 완료',
    secondaryAction: reversible ? 'cancel_clock_out' : null,
    completed: true,
  };
}

function todayTasks(assignments = [], employeeId, date = kstDate()) {
  return assignments.filter((t) => t.employeeId === employeeId && t.workDate === date);
}

function monthCalendar(month) {
  const [y, m] = month.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: 42 }, (_, i) => {
    const day = i - first + 1;
    return day >= 1 && day <= days ? `${month}-${String(day).padStart(2, '0')}` : null;
  });
}

function adminMetrics(state, date = kstDate()) {
  const schedules = state.schedules?.filter((s) => s.workDate === date) || [];
  const attendance = state.attendance?.filter((a) => a.workDate === date) || [];
  const tasks = state.taskAssignments?.filter((t) => t.workDate === date) || [];
  const byEmployee = new Map();
  for (const row of attendance) {
    const list = byEmployee.get(row.employeeId) || [];
    list.push(row);
    byEmployee.set(row.employeeId, list);
  }
  const groups = [...byEmployee.values()];
  const hasOpen = (list) => list.some((a) => a.clockIn && !a.clockOut);
  return {
    scheduled: new Set(schedules.map((s) => s.employeeId)).size,
    clockedIn: groups.filter((list) => list.some((a) => a.clockIn)).length,
    working: groups.filter(hasOpen).length,
    clockedOut: groups.filter((list) => !hasOpen(list) && list.some((a) => a.clockOut)).length,
    late: groups.filter((list) => list.some((a) => Number(a.lateMinutes || 0) > 0)).length,
    pendingTasks: tasks.filter((t) => t.status !== 'completed').length,
  };
}

function formatMinutes(value = 0) {
  const n = Math.max(0, Number(value) || 0);
  const h = Math.floor(n / 60);
  const m = n % 60;
  if (!h) return `${m}분`;
  return m ? `${h}시간 ${m}분` : `${h}시간`;
}

function employeeStatusLabel(active) {
  return active ? '재직' : '퇴사';
}

function buildSpreadsheetXml(state, month) {
  const esc = (v) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const employeeName = (id) => state.employees?.find((e) => e.id === id)?.name || '';
  const scheduleFor = (id, date) => state.schedules?.find((s) => s.employeeId === id && s.workDate === date);
  const rows = (values) => `<Row>${values.map((v) => `<Cell><Data ss:Type="String">${esc(v)}</Data></Cell>`).join('')}</Row>`;
  const attendanceRows = [rows(['날짜','직원','예정 출근','실제 출근','예정 퇴근','실제 퇴근','실근무(분)','지각(분)','조퇴(분)','연장(분)','퇴근취소(회)'])];
  for (const a of state.attendance || []) {
    const s = scheduleFor(a.employeeId, a.workDate) || {};
    attendanceRows.push(rows([a.workDate, employeeName(a.employeeId), s.scheduledStart || '', a.clockIn || '', s.scheduledEnd || '', a.clockOut || '', a.workMinutes || 0, a.lateMinutes || 0, a.earlyLeaveMinutes || 0, a.overtimeMinutes || 0, a.clockOutCancelCount || 0]));
  }
  const taskRows = [rows(['날짜','직원','업무','설명','상태','완료시간'])];
  for (const t of state.taskAssignments || []) taskRows.push(rows([t.workDate, employeeName(t.employeeId), t.title, t.description || '', t.status === 'completed' ? '완료' : '미완료', t.completedAt || '']));
  return `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="근태기록"><Table>${attendanceRows.join('')}</Table></Worksheet><Worksheet ss:Name="업무배정"><Table>${taskRows.join('')}</Table></Worksheet><Worksheet ss:Name="월정보"><Table>${rows(['조회월', month])}</Table></Worksheet></Workbook>`;
}

function shiftTypeLabel(type) {
  return ({ open:'오픈', middle:'미들', close:'마감', open_middle:'오픈+미들', middle_close:'미들+마감', other:'기타' })[type] || '기타';
}
function checklistShiftLabel(type) {
  return ({ open:'오픈', middle:'미들', close:'마감' })[type] || '체크리스트';
}
