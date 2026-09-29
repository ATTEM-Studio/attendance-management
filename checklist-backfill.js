function checklistScheduleTypes(shiftType) {
  return ({
    open:['open'],
    middle:['middle'],
    close:['close'],
    open_middle:['open','middle'],
    middle_close:['middle','close'],
  })[shiftType] || [];
}

function checklistWeekdayForDate(workDate) {
  return new Date(`${workDate}T00:00:00+09:00`).getDay();
}

function findChecklistBackfillGroups(snapshot, today) {
  const templates = (snapshot?.checklistTemplates || []).filter((template) => template.active);
  const assignments = snapshot?.taskAssignments || [];
  const groups = new Map();

  for (const schedule of snapshot?.schedules || []) {
    if (!schedule?.workDate || schedule.workDate < today) continue;

    const scheduleTypes = checklistScheduleTypes(schedule.shiftType);
    if (!scheduleTypes.length) continue;

    const weekday = checklistWeekdayForDate(schedule.workDate);
    const expectedTemplates = templates.filter((template) =>
      scheduleTypes.includes(template.shiftType) &&
      (template.weekdays || []).map(Number).includes(weekday)
    );
    const expectedCount = expectedTemplates.reduce((sum, template) => sum + (template.items?.length || 0), 0);
    if (!expectedCount) continue;

    const existingCount = assignments.filter((task) =>
      task.employeeId === schedule.employeeId &&
      task.workDate === schedule.workDate &&
      task.sourceType === 'checklist' &&
      scheduleTypes.includes(task.shiftType)
    ).length;
    if (existingCount >= expectedCount) continue;

    const key = [
      schedule.employeeId,
      schedule.scheduledStart,
      schedule.scheduledEnd,
      schedule.shiftType,
    ].join('|');
    if (!groups.has(key)) {
      groups.set(key, {
        employeeId:schedule.employeeId,
        scheduledStart:schedule.scheduledStart,
        scheduledEnd:schedule.scheduledEnd,
        shiftType:schedule.shiftType,
        workDates:[],
      });
    }
    groups.get(key).workDates.push(schedule.workDate);
  }

  return [...groups.values()].map((group) => ({
    ...group,
    workDates:[...new Set(group.workDates)].sort(),
  }));
}

if (typeof load === 'function') {
  const baseLoadForChecklistBackfill = load;
  let checklistBackfillRunning = false;
  let checklistBackfillSignature = '';

  load = async function loadWithChecklistBackfill(targetMonth = month) {
    await baseLoadForChecklistBackfill(targetMonth);
    if (session?.role !== 'admin' || checklistBackfillRunning) return;

    const groups = findChecklistBackfillGroups(state, kstDate());
    if (!groups.length) {
      checklistBackfillSignature = '';
      return;
    }

    const signature = JSON.stringify(groups);
    if (signature === checklistBackfillSignature) return;

    checklistBackfillSignature = signature;
    checklistBackfillRunning = true;
    try {
      for (const group of groups) {
        await api.bulkSchedule(session.token, group);
      }
      await baseLoadForChecklistBackfill(targetMonth);
    } catch (error) {
      checklistBackfillSignature = '';
      console.warn('Checklist backfill skipped:', error);
    } finally {
      checklistBackfillRunning = false;
    }
  };
}
