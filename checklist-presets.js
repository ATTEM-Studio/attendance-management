(function () {
  const baseOpenChecklistManager = typeof openChecklistManager === 'function' ? openChecklistManager : null;
  if (!baseOpenChecklistManager || typeof DEFAULT_CHECKLIST_PRESETS === 'undefined') return;

  function checklistPresetMissing() {
    const existing = new Set((state.checklistTemplates || []).map((item) => String(item.name || '').trim()));
    return DEFAULT_CHECKLIST_PRESETS.filter((preset) => !existing.has(preset.name));
  }

  function checklistPresetMarkup(missing) {
    const counts = missing.map((preset) => `${checklistShiftLabel(preset.shiftType)} ${preset.items.length}개`).join(' · ');
    return `<section class="sheet-notice info" data-checklist-preset-box>
      <b>기본 오픈·마감 템플릿</b>
      <p>근무 체크리스트를 모바일용으로 정리해 두었어요. ${esc(counts)}</p>
      <button class="action-button primary-action" id="installChecklistPresets"><span>기본 템플릿 ${missing.length}개 추가</span></button>
    </section>`;
  }

  function bindChecklistPresetInstaller() {
    const button = document.querySelector('#installChecklistPresets');
    if (!button) return;
    button.onclick = async () => {
      const missing = checklistPresetMissing();
      if (!missing.length) return openChecklistManager();
      setPending(button, true, '추가 중');
      try {
        for (const preset of missing) {
          await api.saveChecklistTemplate(session.token, {
            name:preset.name,
            shiftType:preset.shiftType,
            weekdays:[...preset.weekdays],
            active:preset.active,
            items:preset.items.map((item, index) => ({ ...item, sortOrder:index })),
          });
        }
        await load(month);
        toastMsg(`기본 템플릿 ${missing.length}개를 추가했습니다.`);
        haptic(10);
        openChecklistManager();
      } catch (error) {
        toastMsg(error?.message || '기본 템플릿을 추가하지 못했습니다.');
        if (button?.isConnected) setPending(button, false);
      }
    };
  }

  openChecklistManager = function openChecklistManagerWithPresets() {
    baseOpenChecklistManager();
    const missing = checklistPresetMissing();
    if (!missing.length) return;
    const content = document.querySelector('.checklist-panel-content');
    if (!content || content.querySelector('[data-checklist-preset-box]')) return;
    content.insertAdjacentHTML('afterbegin', checklistPresetMarkup(missing));
    bindChecklistPresetInstaller();
  };
})();
