function openCorrectionManager() {
  const records = (state.attendance || []).slice().sort((a,b) => b.workDate.localeCompare(a.workDate) || Number(b.sessionNo || 1) - Number(a.sessionNo || 1));
  openPanel(`<div class="panel-nav"><button class="circle-button" data-close aria-label="닫기">${icon('close')}</button><div><span>관리</span><h2>근태 기록</h2></div><span class="panel-status">${records.length}건</span></div><div class="panel-content"><section class="panel-intro"><h3>출퇴근 기록</h3><p>기본 근무와 추가 근무를 구간별로 수정·삭제할 수 있습니다. 사유는 서버 감사 이력에 남습니다.</p></section><div class="attendance-record-list">${records.length ? records.map(attendanceAdminRow).join('') : '<div class="native-empty"><p>관리할 근태 기록이 없습니다.</p></div>'}</div></div>`);
  document.querySelectorAll('[data-correct]').forEach((button) => { button.onclick = () => openCorrectionSheet(button.dataset.correct); });
}

function attendanceAdminRow(attendance) {
  return `<button class="record-admin-row" data-correct="${attendance.id}"><div><b>${esc(attendance.workDate)} · ${esc(employeeById(attendance.employeeId)?.name || '')} · ${esc(sessionLabel(attendance))}</b><span>출근 ${fmtTime(attendance.clockIn)} · 퇴근 ${fmtTime(attendance.clockOut)}</span></div><span>${formatMinutes(attendance.workMinutes || 0)}</span>${icon('chevron','chevron')}</button>`;
}

function localInputValue(iso) {
  if (!iso) return '';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Seoul', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false }).formatToParts(new Date(iso));
  const o = Object.fromEntries(parts.map((x) => [x.type,x.value]));
  return `${o.year}-${o.month}-${o.day}T${o.hour}:${o.minute}`;
}
function openCorrectionSheet(id) {
  const attendance = (state.attendance || []).find((a) => a.id === id);
  if (!attendance) return;
  openSheet(`<div class="sheet-heading"><div><span class="sheet-kicker">근태 수정</span><h2>${esc(attendance.workDate)} · ${esc(employeeById(attendance.employeeId)?.name || '')}</h2><p>${esc(sessionLabel(attendance))}의 잘못 기록된 출근 또는 퇴근 시간을 정정합니다.</p></div></div>${field({ id:'correctField', label:'항목', value:'clockIn', options:[{value:'clockIn',label:'출근'},{value:'clockOut',label:'퇴근'}] })}${field({ id:'correctValue', label:'변경 시간', type:'datetime-local', value:localInputValue(attendance.clockIn) })}${field({ id:'correctReason', label:'수정 사유', textarea:true, placeholder:'예: 실제 출근시간으로 정정' })}<button class="action-button primary-action" id="saveCorrection"><span>수정 저장</span></button><button class="action-button destructive-action" id="deleteAttendanceBtn" style="margin-top:10px"><span>근태 기록 삭제</span></button>`, { size:'compact' });
  document.querySelector('#correctField').onchange = (e) => { document.querySelector('#correctValue').value = localInputValue(e.target.value === 'clockIn' ? attendance.clockIn : attendance.clockOut); };
  document.querySelector('#saveCorrection').onclick = () => saveCorrection(id);
  document.querySelector('#deleteAttendanceBtn').onclick = () => openDeleteAttendanceSheet(id);
}

async function saveCorrection(attendanceId) {
  clearFieldErrors(document.querySelector('.glass-sheet'));
  const local = document.querySelector('#correctValue').value;
  const reason = document.querySelector('#correctReason').value.trim();
  if (!local) return showFieldError('correctValue', '변경 시간을 입력해 주세요.');
  if (!reason) return showFieldError('correctReason', '수정 사유를 입력해 주세요.');
  const button = document.querySelector('#saveCorrection');
  setPending(button, true, '저장 중');
  try {
    await api.correctAttendance(session.token, { attendanceId, field:document.querySelector('#correctField').value, newValue:`${local}:00+09:00`, reason });
    await load(month);
    dismissLayer(document.querySelector('.sheet-backdrop'));
    openCorrectionManager(); toastMsg('근태를 수정했습니다.');
  } catch (e) { showFieldError('correctReason', e.message); }
  finally { setPending(button, false); }
}
function openDeleteAttendanceSheet(attendanceId) {
  const attendance = (state.attendance || []).find((a) => a.id === attendanceId);
  if (!attendance) return;
  const employee = employeeById(attendance.employeeId);
  openSheet(`<div class="sheet-heading"><div><span class="sheet-kicker danger-kicker">근태 삭제</span><h2>이 ${esc(sessionLabel(attendance))} 기록을 삭제할까요?</h2><p>${esc(attendance.workDate)} · ${esc(employee?.name || '')}님의 근태 구간입니다.</p></div></div><div class="sheet-notice warning">이 근무 구간만 일반 근태 목록과 세무 제출용 보고서에서 제외됩니다. 다른 같은 날 근무 구간은 유지되며 원본 기록과 삭제 사유는 서버 감사 이력에 보관됩니다.</div>${field({ id:'deleteAttendanceReason', label:'삭제 사유', textarea:true, placeholder:'예: 테스트 입력, 중복 등록, 실제 근무하지 않음', hint:'삭제 사유는 감사 이력에 함께 저장됩니다.' })}<div class="sheet-actions"><button class="action-button secondary-action" data-close><span>취소</span></button><button class="action-button destructive-action" id="confirmDeleteAttendance"><span>기록 삭제</span></button></div>`, { size:'compact' });
  document.querySelector('#confirmDeleteAttendance').onclick = () => deleteAttendanceRecord(attendanceId);
}

async function deleteAttendanceRecord(attendanceId) {
  clearFieldErrors(document.querySelector('.glass-sheet'));
  const reason = document.querySelector('#deleteAttendanceReason').value.trim();
  if (reason.length < 2) return showFieldError('deleteAttendanceReason', '삭제 사유를 2자 이상 입력해 주세요.');
  const button = document.querySelector('#confirmDeleteAttendance');
  setPending(button, true, '삭제 중');
  try {
    await api.deleteAttendance(session.token, attendanceId, reason);
    await load(month);
    dismissLayer(document.querySelector('.sheet-backdrop'));
    openCorrectionManager();
    toastMsg('근태 기록을 삭제했습니다.');
    haptic([10,35,10]);
  } catch (e) { showFieldError('deleteAttendanceReason', e.message); }
  finally { if (button?.isConnected) setPending(button, false); }
}
async function exportExcel() {
  const button = document.querySelector('#exportExcel');
  if (button?.disabled) return;
  if (button) { button.disabled = true; button.setAttribute('aria-busy','true'); }
  toastMsg('세무 제출용 보고서를 만들고 있어요.');
  try {
    const blob = await api.downloadAttendanceReport(session.token, month);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${state.storeName || '근태관리'}_근태관리보고서_${month}.xlsx`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toastMsg('A4 근태 보고서를 저장했습니다.'); haptic(8);
  } catch (e) { toastMsg(e.message); }
  finally { if (button) { button.disabled = false; button.removeAttribute('aria-busy'); } }
}
