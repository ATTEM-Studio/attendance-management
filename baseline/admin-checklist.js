let checklistDraftItems = [];
let checklistDraftMeta = null;
const CHECKLIST_WEEKDAYS = ['일','월','화','수','목','금','토'];

function checklistWeekdaySummary(days = []) {
  const sorted = [...days].map(Number).sort((a,b) => a-b);
  if (sorted.length === 7) return '매일';
  if (sorted.join(',') === '1,2,3,4,5') return '평일';
  if (sorted.join(',') === '0,6') return '주말';
  return sorted.map((d) => CHECKLIST_WEEKDAYS[d]).filter(Boolean).join(' · ') || '요일 없음';
}

function checklistTemplateCard(template) {
  return `<article class="checklist-template-card surface-card">
    <button class="checklist-template-main" data-edit-checklist="${esc(template.id)}">
      <span class="checklist-shift-badge is-${esc(template.shiftType)}">${esc(checklistShiftLabel(template.shiftType))}</span>
      <span class="checklist-template-copy"><b>${esc(template.name)}</b><small>${esc(checklistWeekdaySummary(template.weekdays))} · ${template.items?.length || 0}개 항목</small></span>
      <span class="employment-badge ${template.active ? 'is-active' : ''}">${template.active ? '사용 중' : '중지'}</span>
      ${icon('chevron','chevron')}
    </button>
    <button class="row-action destructive-text checklist-template-delete" data-delete-checklist="${esc(template.id)}">삭제</button>
  </article>`;
}

function openChecklistManager() {
  checklistEditingId = null;
  checklistDraftMeta = null;
  checklistDraftItems = [];
  const templates = (state.checklistTemplates || []).slice().sort((a,b) => Number(!a.active) - Number(!b.active) || String(a.shiftType).localeCompare(String(b.shiftType)) || String(a.name).localeCompare(String(b.name)));
  openPanel(`<div class="panel-nav"><button class="circle-button" data-close aria-label="닫기">${icon('close')}</button><div><span>관리</span><h2>체크리스트</h2></div><button class="panel-add" id="openAddChecklist">${icon('plus')}<span>추가</span></button></div>
    <div class="panel-content checklist-panel-content">
      <section class="panel-intro"><h3>반복 업무 템플릿</h3><p>오픈 · 미들 · 마감 근무에 필요한 업무를 한 번 만들어두면 근무표 배정 시 자동으로 생성됩니다.</p></section>
      <div class="checklist-template-list">${templates.length ? templates.map(checklistTemplateCard).join('') : '<div class="native-empty"><div class="empty-icon">✓</div><p>아직 체크리스트 템플릿이 없습니다.<br>오픈·미들·마감 업무를 만들어 보세요.</p></div>'}</div>
    </div>`);
  document.querySelector('#openAddChecklist').onclick = () => openChecklistTemplateSheet('');
  document.querySelectorAll('[data-edit-checklist]').forEach((button) => { button.onclick = () => openChecklistTemplateSheet(button.dataset.editChecklist); });
  document.querySelectorAll('[data-delete-checklist]').forEach((button) => { button.onclick = () => openChecklistDeleteSheet(button.dataset.deleteChecklist); });
}

function newChecklistItem(index = 0) {
  return { title:'', description:'', required:true, sortOrder:index };
}

function openChecklistTemplateSheet(id = '') {
  const template = id ? (state.checklistTemplates || []).find((t) => t.id === id) : null;
  checklistEditingId = template?.id || null;
  checklistDraftMeta = {
    name: template?.name || '',
    shiftType: template?.shiftType || 'open',
    weekdays: template?.weekdays?.length ? [...template.weekdays].map(Number) : [0,1,2,3,4,5,6],
    active: template ? Boolean(template.active) : true,
  };
  checklistDraftItems = template?.items?.length
    ? template.items.map((item, index) => ({ title:item.title || '', description:item.description || '', required:item.required !== false, sortOrder:Number(item.sortOrder ?? index) }))
    : [newChecklistItem(0)];
  renderChecklistTemplateSheet();
}

function checklistWeekdayControls() {
  const selected = new Set(checklistDraftMeta?.weekdays || []);
  return `<div class="checklist-weekdays" aria-label="적용 요일">${CHECKLIST_WEEKDAYS.map((label, day) => `<label class="checklist-weekday ${selected.has(day) ? 'is-selected' : ''}"><input type="checkbox" data-checklist-weekday="${day}" ${selected.has(day) ? 'checked' : ''}><span>${label}</span></label>`).join('')}</div>`;
}

function checklistDraftItemMarkup(item, index) {
  return `<article class="checklist-item-editor" data-checklist-item="${index}">
    <div class="checklist-item-editor-head"><b>${index + 1}. 체크 항목</b>${checklistDraftItems.length > 1 ? `<button class="row-action destructive-text" data-remove-checklist-item="${index}">삭제</button>` : ''}</div>
    ${field({ id:`checkTitle_${index}`, label:'업무명', value:item.title, placeholder:'예: 커피머신 예열' })}
    ${field({ id:`checkDescription_${index}`, label:'설명', textarea:true, value:item.description, placeholder:'필요한 확인 기준이나 세부 내용을 적어주세요.' })}
    <label class="checklist-required-row"><span><b>필수 업무</b><small>미완료 상태로 퇴근하면 사유 확인이 필요합니다.</small></span><input type="checkbox" data-checklist-required="${index}" ${item.required ? 'checked' : ''}></label>
  </article>`;
}

function renderChecklistTemplateSheet() {
  const meta = checklistDraftMeta || { name:'', shiftType:'open', weekdays:[0,1,2,3,4,5,6], active:true };
  openSheet(`<div class="sheet-heading"><div><span class="sheet-kicker">체크리스트 템플릿</span><h2>${checklistEditingId ? '반복 업무를 수정해요' : '반복 업무를 만들어요'}</h2><p>근무표에 같은 근무 유형을 배정하면 해당 요일의 체크 항목이 직원에게 자동 생성됩니다.</p></div></div>
    ${field({ id:'checklistTemplateName', label:'템플릿 이름', value:meta.name, placeholder:'예: 평일 오픈' })}
    ${field({ id:'checklistTemplateShift', label:'구분', value:meta.shiftType, options:[{value:'open',label:'오픈'},{value:'middle',label:'미들'},{value:'close',label:'마감'}] })}
    <div class="checklist-form-group"><div class="checklist-form-label">적용 요일</div>${checklistWeekdayControls()}</div>
    <label class="checklist-required-row checklist-active-row"><span><b>템플릿 사용</b><small>끄면 앞으로 새 근무표에 자동 생성되지 않습니다.</small></span><input type="checkbox" id="checklistTemplateActive" ${meta.active ? 'checked' : ''}></label>
    <div class="checklist-items-heading"><div><span>체크 항목</span><b>${checklistDraftItems.length}개</b></div><button class="text-action" id="addChecklistItem">+ 항목 추가</button></div>
    <div class="checklist-item-editors">${checklistDraftItems.map(checklistDraftItemMarkup).join('')}</div>
    <button class="action-button primary-action" id="saveChecklistTemplate"><span>템플릿 저장</span></button>`, { size:'compact checklist-template-sheet' });

  document.querySelector('#addChecklistItem').onclick = addChecklistDraftItem;
  document.querySelector('#saveChecklistTemplate').onclick = saveChecklistTemplate;
  document.querySelectorAll('[data-remove-checklist-item]').forEach((button) => { button.onclick = () => removeChecklistDraftItem(Number(button.dataset.removeChecklistItem)); });
  document.querySelectorAll('[data-checklist-weekday]').forEach((input) => { input.onchange = () => input.closest('.checklist-weekday')?.classList.toggle('is-selected', input.checked); });
}

function syncChecklistDraftFromDom() {
  if (!checklistDraftMeta) return;
  const name = document.querySelector('#checklistTemplateName');
  const shift = document.querySelector('#checklistTemplateShift');
  const active = document.querySelector('#checklistTemplateActive');
  if (name) checklistDraftMeta.name = name.value;
  if (shift) checklistDraftMeta.shiftType = shift.value;
  if (active) checklistDraftMeta.active = active.checked;
  checklistDraftMeta.weekdays = [...document.querySelectorAll('[data-checklist-weekday]:checked')].map((input) => Number(input.dataset.checklistWeekday));
  checklistDraftItems = checklistDraftItems.map((item, index) => ({
    ...item,
    title: document.querySelector(`#checkTitle_${index}`)?.value ?? item.title,
    description: document.querySelector(`#checkDescription_${index}`)?.value ?? item.description,
    required: document.querySelector(`[data-checklist-required="${index}"]`)?.checked ?? item.required,
    sortOrder:index,
  }));
}

function addChecklistDraftItem() {
  syncChecklistDraftFromDom();
  checklistDraftItems.push(newChecklistItem(checklistDraftItems.length));
  renderChecklistTemplateSheet();
  setTimeout(() => document.querySelector(`#checkTitle_${checklistDraftItems.length - 1}`)?.focus(), 40);
}

function removeChecklistDraftItem(index) {
  syncChecklistDraftFromDom();
  if (checklistDraftItems.length <= 1) return;
  checklistDraftItems.splice(index, 1);
  checklistDraftItems = checklistDraftItems.map((item, i) => ({ ...item, sortOrder:i }));
  renderChecklistTemplateSheet();
}

async function saveChecklistTemplate() {
  syncChecklistDraftFromDom();
  clearFieldErrors(document.querySelector('.glass-sheet'));
  const meta = checklistDraftMeta;
  if (!meta?.name.trim()) return showFieldError('checklistTemplateName', '템플릿 이름을 입력해 주세요.');
  if (!meta.weekdays.length) { toastMsg('적용할 요일을 하나 이상 선택해 주세요.'); return; }
  const items = checklistDraftItems.map((item, index) => ({ ...item, title:item.title.trim(), description:item.description.trim(), sortOrder:index })).filter((item) => item.title);
  if (!items.length) return showFieldError('checkTitle_0', '체크 항목을 하나 이상 입력해 주세요.');
  const button = document.querySelector('#saveChecklistTemplate');
  setPending(button, true, '저장 중');
  try {
    await api.saveChecklistTemplate(session.token, {
      ...(checklistEditingId ? { id:checklistEditingId } : {}),
      name:meta.name.trim(), shiftType:meta.shiftType, weekdays:meta.weekdays, active:meta.active, items,
    });
    await load(month);
    dismissLayer(document.querySelector('.sheet-backdrop'));
    openChecklistManager();
    toastMsg('체크리스트 템플릿을 저장했습니다.'); haptic(10);
  } catch (e) { toastMsg(e.message); }
  finally { if (button?.isConnected) setPending(button, false); }
}

function openChecklistDeleteSheet(id) {
  const template = (state.checklistTemplates || []).find((t) => t.id === id);
  if (!template) return;
  openSheet(`<div class="sheet-heading"><div><span class="sheet-kicker danger-kicker">템플릿 삭제</span><h2>${esc(template.name)}을 삭제할까요?</h2><p>이미 직원에게 생성되어 완료된 과거 체크 기록은 그대로 유지됩니다.</p></div></div><div class="sheet-notice warning">앞으로 새 근무표에는 이 템플릿이 생성되지 않습니다.</div><div class="sheet-actions"><button class="action-button secondary-action" data-close><span>취소</span></button><button class="action-button destructive-action" id="confirmDeleteChecklist"><span>템플릿 삭제</span></button></div>`, { size:'compact' });
  document.querySelector('#confirmDeleteChecklist').onclick = () => deleteChecklistTemplate(id);
}

async function deleteChecklistTemplate(id) {
  const button = document.querySelector('#confirmDeleteChecklist');
  setPending(button, true, '삭제 중');
  try {
    await api.deleteChecklistTemplate(session.token, id);
    await load(month);
    dismissLayer(document.querySelector('.sheet-backdrop'));
    openChecklistManager();
    toastMsg('체크리스트 템플릿을 삭제했습니다.');
  } catch (e) { toastMsg(e.message); }
  finally { if (button?.isConnected) setPending(button, false); }
}
