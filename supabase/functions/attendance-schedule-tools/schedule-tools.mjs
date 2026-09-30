const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const SHIFT_TYPES = new Set(['open','middle','close','open_middle','middle_close','other']);

export function scheduleShiftTypes(shiftType) {
  return ({
    open:['open'],
    middle:['middle'],
    close:['close'],
    open_middle:['open','middle'],
    middle_close:['middle','close'],
  })[shiftType] || [];
}

export function validateExtraScheduleInput(input = {}) {
  const employeeId = String(input.employeeId || '').trim();
  const workDate = String(input.workDate || '').trim();
  const scheduledStart = String(input.scheduledStart || '').slice(0,5);
  const scheduledEnd = String(input.scheduledEnd || '').slice(0,5);
  const shiftType = String(input.shiftType || 'other').trim();

  if (!UUID_RE.test(employeeId)) return { ok:false, error:'직원을 확인해 주세요.' };
  if (!DATE_RE.test(workDate)) return { ok:false, error:'근무 날짜를 확인해 주세요.' };
  if (!TIME_RE.test(scheduledStart) || !TIME_RE.test(scheduledEnd) || scheduledStart >= scheduledEnd) {
    return { ok:false, error:'추가 근무 시간을 확인해 주세요.' };
  }
  if (!SHIFT_TYPES.has(shiftType)) return { ok:false, error:'근무 유형을 확인해 주세요.' };

  return { ok:true, value:{ employeeId, workDate, scheduledStart, scheduledEnd, shiftType } };
}

function weekdayOf(workDate) {
  return new Date(`${workDate}T00:00:00+09:00`).getDay();
}

function camel(row = {}) {
  return {
    employeeId: row.employeeId ?? row.employee_id,
    workDate: row.workDate ?? row.work_date,
    sourceType: row.sourceType ?? row.source_type,
    shiftType: row.shiftType ?? row.shift_type,
    title: row.title,
  };
}

export function buildMissingChecklistRows({ today, schedules = [], templates = [], existing = [] }) {
  const existingKeys = new Set(existing.map((row) => {
    const task = camel(row);
    return [task.employeeId, task.workDate, task.shiftType, task.title].join('|');
  }));
  const rows = [];

  for (const scheduleRaw of schedules) {
    const schedule = {
      employeeId:scheduleRaw.employeeId ?? scheduleRaw.employee_id,
      workDate:scheduleRaw.workDate ?? scheduleRaw.work_date,
      shiftType:scheduleRaw.shiftType ?? scheduleRaw.shift_type,
    };
    if (!schedule.employeeId || !schedule.workDate || schedule.workDate < today) continue;
    const shiftTypes = scheduleShiftTypes(schedule.shiftType);
    if (!shiftTypes.length) continue;
    const weekday = weekdayOf(schedule.workDate);

    for (const template of templates) {
      const templateShift = template.shiftType ?? template.shift_type;
      const weekdays = (template.weekdays || []).map(Number);
      const active = template.active !== false;
      if (!active || !shiftTypes.includes(templateShift) || !weekdays.includes(weekday)) continue;

      for (const [index, item] of (template.items || []).entries()) {
        const key = [schedule.employeeId, schedule.workDate, templateShift, item.title].join('|');
        if (existingKeys.has(key)) continue;
        existingKeys.add(key);
        rows.push({
          employee_id:schedule.employeeId,
          work_date:schedule.workDate,
          title:String(item.title || '').trim(),
          description:String(item.description || '').trim(),
          status:'pending',
          source_type:'checklist',
          shift_type:templateShift,
          required:item.required !== false,
          sort_order:Number(item.sortOrder ?? item.sort_order ?? index),
        });
      }
    }
  }

  return rows.filter((row) => row.title);
}
