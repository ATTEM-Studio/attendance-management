const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function kstDateOf(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Seoul' }).format(date);
}

function minutesBetween(a, b) {
  return Math.max(0, Math.round((b - a) / 60000));
}

function scheduleDateTime(workDate, time) {
  if (!time) return null;
  const date = new Date(`${workDate}T${time}:00+09:00`);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function validateManualAttendanceInput({ employeeId, workDate, clockIn, clockOut, reason, today }) {
  const employee = String(employeeId || '').trim();
  const date = String(workDate || '').trim();
  const why = String(reason || '').trim();
  const todayValue = String(today || '').trim();
  const inDate = new Date(clockIn);
  const outDate = new Date(clockOut);

  if (!employee || !DATE_RE.test(date)) return { ok:false, error:'직원과 근무 날짜를 확인해 주세요.' };
  if (todayValue && DATE_RE.test(todayValue) && date > todayValue) return { ok:false, error:'미래 날짜에는 근태 기록을 추가할 수 없습니다.' };
  if (!Number.isFinite(inDate.getTime()) || !Number.isFinite(outDate.getTime())) return { ok:false, error:'출근과 퇴근 시간을 확인해 주세요.' };
  if (kstDateOf(clockIn) !== date || kstDateOf(clockOut) !== date) return { ok:false, error:'출퇴근 시간은 선택한 근무 날짜 안에 있어야 합니다.' };
  if (outDate.getTime() <= inDate.getTime()) return { ok:false, error:'퇴근 시간은 출근 시간보다 늦어야 합니다.' };
  if (why.length < 2) return { ok:false, error:'수정 사유를 2자 이상 입력해 주세요.' };

  return {
    ok:true,
    value:{ employeeId:employee, workDate:date, clockIn:new Date(clockIn).toISOString(), clockOut:new Date(clockOut).toISOString(), reason:why },
  };
}

export function computeManualAttendanceMetrics({ workDate, clockIn, clockOut, scheduledStart, scheduledEnd }) {
  const inDate = new Date(clockIn);
  const outDate = new Date(clockOut);
  const scheduledIn = scheduleDateTime(workDate, scheduledStart);
  const scheduledOut = scheduleDateTime(workDate, scheduledEnd);

  const workMinutes = minutesBetween(inDate.getTime(), outDate.getTime());
  const lateMinutes = scheduledIn ? Math.max(0, minutesBetween(scheduledIn.getTime(), inDate.getTime())) : 0;
  const earlyLeaveMinutes = scheduledOut && outDate.getTime() < scheduledOut.getTime() ? minutesBetween(outDate.getTime(), scheduledOut.getTime()) : 0;
  const overtimeMinutes = scheduledOut && outDate.getTime() > scheduledOut.getTime() ? minutesBetween(scheduledOut.getTime(), outDate.getTime()) : 0;

  return { workMinutes, lateMinutes, earlyLeaveMinutes, overtimeMinutes };
}
