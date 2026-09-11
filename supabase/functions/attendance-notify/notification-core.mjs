const kstDate = (value) => new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Seoul' }).format(new Date(value));
const scheduleAt = (workDate, hhmm) => new Date(`${workDate}T${String(hhmm || '').slice(0,5)}:00+09:00`).getTime();

function employeeName(employeeMap, employeeId) {
  return String(employeeMap.get(employeeId)?.name || '직원');
}

export function buildActiveAlerts({ now, schedules = [], attendance = [], tasks = [], employees = [] }) {
  const nowDate = new Date(now);
  const nowMs = nowDate.getTime();
  if (!Number.isFinite(nowMs)) return [];

  const today = kstDate(nowDate);
  const activeEmployees = employees.filter((row) => row?.active !== false);
  const activeIds = new Set(activeEmployees.map((row) => row.id));
  const employeeMap = new Map(activeEmployees.map((row) => [row.id, row]));
  const alerts = [];

  const todaySchedules = schedules.filter((row) => row.workDate === today && activeIds.has(row.employeeId));
  const todayAttendance = attendance.filter((row) => row.workDate === today && activeIds.has(row.employeeId));

  for (const schedule of todaySchedules) {
    const rows = todayAttendance.filter((row) => row.employeeId === schedule.employeeId);
    const hasClockIn = rows.some((row) => Boolean(row.clockIn));
    const startMs = scheduleAt(schedule.workDate, schedule.scheduledStart);
    const endMs = scheduleAt(schedule.workDate, schedule.scheduledEnd);
    const name = employeeName(employeeMap, schedule.employeeId);

    if (Number.isFinite(startMs) && nowMs >= startMs + 10 * 60_000 && !hasClockIn) {
      alerts.push({
        alertKey:`missing_clock_in:${schedule.employeeId}:${schedule.workDate}`,
        type:'missing_clock_in',
        employeeId:schedule.employeeId,
        workDate:schedule.workDate,
        attendanceId:null,
        severity:'danger',
        title:'출근 미처리',
        body:`${name} · ${String(schedule.scheduledStart).slice(0,5)} 출근 예정`,
      });
    }

    const open = rows.find((row) => row.clockIn && !row.clockOut);
    if (open && Number.isFinite(endMs) && nowMs >= endMs + 15 * 60_000) {
      alerts.push({
        alertKey:`missing_clock_out:${open.id}`,
        type:'missing_clock_out',
        employeeId:schedule.employeeId,
        workDate:schedule.workDate,
        attendanceId:open.id,
        severity:'danger',
        title:'퇴근 미처리',
        body:`${name} · ${String(schedule.scheduledEnd).slice(0,5)} 퇴근 예정`,
      });
    }

    if (Number.isFinite(endMs) && nowMs >= endMs) {
      const pendingRequired = tasks.filter((task) =>
        task.employeeId === schedule.employeeId &&
        task.workDate === schedule.workDate &&
        task.sourceType === 'checklist' &&
        task.required === true &&
        task.status !== 'completed'
      );
      if (pendingRequired.length) {
        alerts.push({
          alertKey:`required_checklist:${schedule.employeeId}:${schedule.workDate}`,
          type:'required_checklist',
          employeeId:schedule.employeeId,
          workDate:schedule.workDate,
          attendanceId:null,
          severity:'warning',
          title:'필수 업무 미완료',
          body:`${name} · 필수 체크리스트 ${pendingRequired.length}개 남음`,
        });
      }
    }
  }

  for (const row of attendance) {
    if (!activeIds.has(row.employeeId) || !row.clockIn || row.clockOut || !row.workDate || row.workDate >= today) continue;
    const name = employeeName(employeeMap, row.employeeId);
    alerts.push({
      alertKey:`stale_open:${row.id}`,
      type:'stale_open',
      employeeId:row.employeeId,
      workDate:row.workDate,
      attendanceId:row.id,
      severity:'danger',
      title:'전날 퇴근 기록 확인 필요',
      body:`${name} · ${row.workDate} 퇴근 기록이 없습니다.`,
    });
  }

  return alerts;
}
