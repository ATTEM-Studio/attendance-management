function openTaskManager() {
  taskEditingId = null;
  taskEmployeeId = taskEmployeeId || activeEmployees()[0]?.id || '';
  taskDate = taskDate || kstDate();
  renderTaskPanel();
}
function renderTaskPanel() {
  const employees = activeEmployees();
  const tasks = (state.taskAssignments || []).filter((t) => t.sourceType !== 'checklist').slice().sort((a,b) => a.workDate.localeCompare(b.workDate));
  openPanel(`<div class="panel-nav"><button class="circle-button" data-close aria-label="닫기">${icon('close')}</button><div><span>관리</span><h2>업무</h2></div><span class="panel-status">${tasks.filter((t) => t.status !== 'completed').length}건 미완료</span></div><div class="panel-content task-panel-content"><section class="task-compose surface-card"><div class="panel-intro"><h3>업무 배정</h3><p>같은 직원과 날짜를 유지한 채 여러 업무를 연속으로 추가할 수 있어요.</p></div><div class="form-grid">${field({ id:'taskEmployee', label:'직원', value:taskEmployeeId, options:[{value:'',label:'직원 선택'}, ...employees.map((e) => ({value:e.id,label:e.name}))] })}${field({ id:'taskDate', label:'날짜', type:'date', value:taskDate })}<div class="span2">${field({ id:'taskTitle', label:'업무', placeholder:'예: 쇼케이스 재고 확인' })}</div><div class="span2">${field({ id:'taskDescription', label:'설명', textarea:true, placeholder:'필요한 세부 내용이 있다면 적어주세요.' })}</div></div><button class="action-button primary-action" id="assignTaskBtn"><span>업무 배정</span></button></section><section class="task-admin-list"><div class="section-heading"><div><span>이번 달</span><h2>배정된 업무</h2></div><small>${tasks.length}건</small></div>${tasks.length ? tasks.map(taskAdminCard).join('') : '<div class="native-empty"><p>배정된 업무가 없습니다.</p></div>'}</section></div>`);
  document.querySelector('#taskEmployee').onchange = (e) => { taskEmployeeId = e.target.value; };
  document.querySelector('#taskDate').onchange = (e) => { taskDate = e.target.value; };
  document.querySelector('#assignTaskBtn').onclick = assignTask;
  document.querySelectorAll('[data-edit-task]').forEach((button) => { button.onclick = () => openTaskEditSheet(button.dataset.editTask); });
  document.querySelectorAll('[data-delete-task]').forEach((button) => { button.onclick = () => openDeleteTaskSheet(button.dataset.deleteTask); });
}
function taskAdminCard(task) {
  const employee = employeeById(task.employeeId);
  return `<div class="admin-task-row"><div class="task-state-dot ${task.status === 'completed' ? 'done' : ''}"></div><div class="admin-task-copy"><b>${esc(task.title)}</b><span>${esc(task.workDate)} · ${esc(employee?.name || '')}${task.description ? ` · ${esc(task.description)}` : ''}</span></div><span class="task-status ${task.status === 'completed' ? 'is-done' : ''}">${task.status === 'completed' ? '완료' : '미완료'}</span><button class="circle-button small" data-edit-task="${task.id}" aria-label="수정">${icon('edit')}</button><button class="row-action destructive-text" data-delete-task="${task.id}">삭제</button></div>`;
}
async function assignTask() {
  clearFieldErrors(document.querySelector('.panel-root'));
  taskEmployeeId = document.querySelector('#taskEmployee').value;
  taskDate = document.querySelector('#taskDate').value;
  const title = document.querySelector('#taskTitle').value.trim();
  const description = document.querySelector('#taskDescription').value.trim();
  if (!taskEmployeeId) return showFieldError('taskEmployee', '직원을 선택해 주세요.');
  if (!taskDate) return showFieldError('taskDate', '날짜를 선택해 주세요.');
  if (!title) return showFieldError('taskTitle', '업무 내용을 입력해 주세요.');
  const button = document.querySelector('#assignTaskBtn');
  setPending(button, true, '배정 중');
  try {
    await api.assignTask(session.token, { employeeId:taskEmployeeId, workDate:taskDate, title, description });
    await load(month);
    renderTaskPanel();
    const titleInput = document.querySelector('#taskTitle');
    if (titleInput) titleInput.focus();
    toastMsg('업무를 배정했습니다.'); haptic(8);
  } catch (e) { showFieldError('taskTitle', e.message); }
  finally { setPending(button, false); }
}
function openTaskEditSheet(id) {
  taskEditingId = id;
  const task = (state.taskAssignments || []).find((t) => t.id === id);
  if (!task) return;
  openSheet(`<div class="sheet-heading"><div><span class="sheet-kicker">업무 수정</span><h2>${esc(task.title)}</h2><p>날짜, 내용, 상태를 정정할 수 있습니다.</p></div></div>${field({ id:'editTaskDate', label:'날짜', type:'date', value:task.workDate })}${field({ id:'editTaskTitle', label:'업무', value:task.title })}${field({ id:'editTaskDescription', label:'설명', textarea:true, value:task.description || '' })}${field({ id:'editTaskStatus', label:'상태', value:task.status, options:[{value:'pending',label:'미완료'},{value:'completed',label:'완료'}] })}<button class="action-button primary-action" id="saveTaskEdit"><span>수정 저장</span></button>`, { size:'compact' });
  document.querySelector('#saveTaskEdit').onclick = () => saveTaskEdit(id);
}
async function saveTaskEdit(id) {
  clearFieldErrors(document.querySelector('.glass-sheet'));
  const title = document.querySelector('#editTaskTitle').value.trim();
  if (!title) return showFieldError('editTaskTitle', '업무 내용을 입력해 주세요.');
  const button = document.querySelector('#saveTaskEdit');
  setPending(button, true, '저장 중');
  try {
    await api.updateTask(session.token, { taskAssignmentId:id, workDate:document.querySelector('#editTaskDate').value, title, description:document.querySelector('#editTaskDescription').value, status:document.querySelector('#editTaskStatus').value });
    await load(month);
    dismissLayer(document.querySelector('.sheet-backdrop'));
    renderTaskPanel(); toastMsg('업무를 수정했습니다.');
  } catch (e) { showFieldError('editTaskTitle', e.message); }
  finally { setPending(button, false); }
}
function openDeleteTaskSheet(id) {
  const task = (state.taskAssignments || []).find((t) => t.id === id);
  openSheet(`<div class="sheet-heading"><div><span class="sheet-kicker danger-kicker">업무 삭제</span><h2>${esc(task?.title || '이 업무')}</h2><p>삭제하면 직원의 오늘 할 일에서도 사라집니다.</p></div></div><div class="sheet-actions"><button class="action-button secondary-action" data-close><span>취소</span></button><button class="action-button destructive-action" id="confirmDeleteTask"><span>삭제</span></button></div>`, { size:'compact' });
  document.querySelector('#confirmDeleteTask').onclick = () => deleteTask(id);
}
async function deleteTask(id) {
  const button = document.querySelector('#confirmDeleteTask');
  setPending(button, true, '삭제 중');
  try {
    await api.updateTask(session.token, { taskAssignmentId:id, delete:true });
    await load(month);
    dismissLayer(document.querySelector('.sheet-backdrop'));
    renderTaskPanel(); toastMsg('업무를 삭제했습니다.');
  } catch (e) { toastMsg(e.message); }
  finally { setPending(button, false); }
}

