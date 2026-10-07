let scheduleExpandedDate = '';
function openScheduleManager() {
  scheduleMonth = month;
  scheduleSelected = new Set();
  scheduleEmployeeId = activeEmployees()[0]?.id || '';
  scheduleShiftType = 'other';
  scheduleExpandedDate = '';
  renderSchedulePanel();
}
async function loadScheduleMonth(target) {
  try {
    await load(target);
    scheduleMonth = target;
    scheduleSelected = new Set();
    scheduleExpandedDate = '';
    renderSchedulePanel();
  } catch (e) { toastMsg(e.message); }
}
function renderSchedulePanel() {
  const cells = monthCalendar(scheduleMonth);
  const employees = activeEmployees();
  const existing = (state.schedules || []).slice().sort((a,b) => a.workDate.localeCompare(b.workDate) || a.scheduledStart.localeCompare(b.scheduledStart));
  const groups = scheduleGroups(existing);
  openPanel(`<div class="panel-nav"><button class="circle-button" data-close aria-label="닫기">${icon('close')}</button><div><span>스케줄</span><h2>근무표</h2></div><div class="calendar-nav"><button class="today-jump" id="scheduleShare">주간 공유</button><button class="today-jump" id="scheduleToday">오늘</button></div></div><div class="panel-content schedule-panel-content"><section class="schedule-calendar-area"><div class="calendar-title-row"><h3>${esc(monthTitle(scheduleMonth))}</h3><div class="calendar-nav"><button class="circle-button" id="schPrev">${icon('back')}</button><button class="circle-button" id="schNext">${icon('forward')}</button></div></div><div class="week-row">${['일','월','화','수','목','금','토'].map((d) => `<span>${d}</span>`).join('')}</div><div class="ios-calendar schedule-calendar">${cells.map(scheduleCell).join('')}</div></section><aside class="schedule-inspector"><div class="inspector-form">${field({ id:'schEmployee', label:'직원', value:scheduleEmployeeId, options:[{value:'',label:'직원 선택'}, ...employees.map((e) => ({value:e.id,label:`${e.name} · ${e.position}`}))] })}${field({ id:'schShiftType', label:'근무 유형', value:scheduleShiftType, options:[{value:'open',label:'오픈'},{value:'middle',label:'미들'},{value:'close',label:'마감'},{value:'open_middle',label:'오픈+미들'},{value:'middle_close',label:'미들+마감'},{value:'other',label:'기타'}] })}<div class="field-pair">${field({ id:'schStart', label:'출근', type:'time', value:scheduleStart })}${field({ id:'schEnd', label:'퇴근', type:'time', value:scheduleEnd })}</div></div><div class="assigned-list"><div class="section-heading compact"><div><span>이번 달</span><h2>배정된 일정</h2></div><small>${existing.length}건</small></div>${groups.length ? `<div class="schedule-date-groups">${groups.map(scheduleDateGroupMarkup).join('')}</div>` : '<div class="native-empty small"><p>배정된 일정이 없습니다.</p></div>'}</div></aside></div><div class="schedule-tray glass-surface"><div class="selection-summary"><b id="selectedCount">${scheduleSelected.size}일 선택</b><div class="selected-dates" id="selectedDates">${selectedDateChips()}</div></div><button class="action-button primary-action tray-action" id="saveSchedule"><span>근무 배정</span></button></div>`);
  document.querySelector('#schPrev').onclick = () => loadScheduleMonth(shiftMonth(scheduleMonth,-1));
  document.querySelector('#schNext').onclick = () => loadScheduleMonth(shiftMonth(scheduleMonth,1));
  document.querySelector('#scheduleToday').onclick = () => loadScheduleMonth(currentMonth());
  document.querySelector('#scheduleShare').onclick = openWeeklyScheduleShare;
  document.querySelector('#schEmployee').onchange = (e) => { scheduleEmployeeId = e.target.value; };
  document.querySelector('#schShiftType').onchange = (e) => { scheduleShiftType = e.target.value; };
  document.querySelector('#schStart').onchange = (e) => { scheduleStart = e.target.value; };
  document.querySelector('#schEnd').onchange = (e) => { scheduleEnd = e.target.value; };
  document.querySelectorAll('[data-schedule-date]').forEach((button) => { button.onclick = () => toggleScheduleDate(button.dataset.scheduleDate); });
  document.querySelectorAll('[data-schedule-group]').forEach((button) => { button.onclick = () => toggleScheduleGroup(button.dataset.scheduleGroup); });
  document.querySelector('#saveSchedule').onclick = saveSchedule;
  document.querySelectorAll('[data-delete-schedule]').forEach((button) => { button.onclick = () => openDeleteScheduleSheet(...button.dataset.deleteSchedule.split('|')); });
}

let shareWeekStart = '';
let shareWeekBundle = null;
let shareWeekPreviewUrl = '';
let shareLayout = 'cards';
let shareMemoEnabled = true;
let shareMemoText = '근무 변경이 필요한 경우, 미리 관리자에게 전달해 주세요.';
const SHARE_DAYS = ['월','화','수','목','금','토','일'];
const SHARE_COLORS = [
  ['#EAF2FF','#2D6CDF'], ['#F4ECFF','#7C4DCC'], ['#E9F8F1','#238A61'],
  ['#FFF2E8','#C96B21'], ['#FDECEF','#C6455D'], ['#EAF7FA','#277A8B'],
  ['#F3F0E8','#776741'], ['#EEF0FF','#5864C7'], ['#FFF7D9','#A67812'], ['#E9F2EC','#47745A']
];

function shareDateAdd(iso, days) {
  const [y,m,d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y,m-1,d + days));
  return date.toISOString().slice(0,10);
}
function shareMonday(iso) {
  const [y,m,d] = iso.split('-').map(Number);
  const day = new Date(Date.UTC(y,m-1,d)).getUTCDay();
  return shareDateAdd(iso, day === 0 ? -6 : 1 - day);
}
function shareWeekDates(start) {
  return Array.from({length:7}, (_,i) => shareDateAdd(start,i));
}
function weekMonths(start) {
  return [...new Set(shareWeekDates(start).map((d) => d.slice(0,7)))];
}
function shareDateLabel(iso) {
  const [,m,d] = iso.split('-');
  return `${Number(m)}.${Number(d)}`;
}
function shareRangeLabel(start) {
  const end = shareDateAdd(start,6);
  const [sy,sm,sd] = start.split('-').map(Number);
  const [ey,em,ed] = end.split('-').map(Number);
  return sy === ey ? `${sy}.${String(sm).padStart(2,'0')}.${String(sd).padStart(2,'0')} — ${String(em).padStart(2,'0')}.${String(ed).padStart(2,'0')}` : `${start} — ${end}`;
}
function svgEsc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
}
function shareColorFor(id='') {
  let hash = 0;
  for (const c of String(id)) hash = ((hash << 5) - hash + c.charCodeAt(0)) | 0;
  return SHARE_COLORS[Math.abs(hash) % SHARE_COLORS.length];
}
function employeeColorMap(bundle) {
  return new Map([...bundle.employees.keys()].map((id) => [id, shareColorFor(id)]));
}
function effectiveShareMemo() {
  return shareMemoEnabled ? String(shareMemoText || '').trim() : '';
}
async function loadWeeklyShareData(start) {
  const dates = new Set(shareWeekDates(start));
  const months = weekMonths(start);
  const snapshots = await Promise.all(months.map((m) => api.bootstrap(session.token, m)));
  const employees = new Map();
  const schedules = [];
  snapshots.forEach((snapshot) => {
    (snapshot.employees || []).forEach((employee) => employees.set(employee.id, employee));
    (snapshot.schedules || []).forEach((schedule) => {
      if (dates.has(schedule.workDate)) schedules.push(schedule);
    });
  });
  schedules.sort((a,b) => a.workDate.localeCompare(b.workDate) || a.scheduledStart.localeCompare(b.scheduledStart));
  return { storeName:snapshots[0]?.storeName || state?.storeName || '근무표', employees, schedules };
}
function buildWeeklyScheduleSvg(bundle, start) {
  const dates = shareWeekDates(start);
  const colors = employeeColorMap(bundle);
  const grouped = new Map(dates.map((d) => [d, []]));
  bundle.schedules.forEach((schedule) => grouped.get(schedule.workDate)?.push(schedule));
  const maxCount = Math.max(1, ...dates.map((d) => grouped.get(d).length));
  const rowFont = maxCount >= 7 ? 18 : maxCount >= 5 ? 20 : 23;
  const rowGap = maxCount >= 7 ? 25 : maxCount >= 5 ? 29 : 34;
  const cardTop = 222;
  const cardH = 132;
  const cardGap = 12;
  const employeeX = [250, 650];
  const cards = dates.map((date,index) => {
    const daySchedules = grouped.get(date);
    const y = cardTop + index * (cardH + cardGap);
    const isSunday = index === 6;
    const isSaturday = index === 5;
    const dayColor = isSunday ? '#D94A55' : isSaturday ? '#3E6FD8' : '#55606F';
    const assignments = daySchedules.length ? daySchedules.map((schedule,i) => {
      const employee = bundle.employees.get(schedule.employeeId) || {name:'직원'};
      const [soft,strong] = colors.get(schedule.employeeId) || shareColorFor(schedule.employeeId);
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = employeeX[col];
      const iy = y + 42 + row * rowGap;
      const blockW = 352;
      return `<g><rect x="${x}" y="${iy-24}" width="${blockW}" height="30" rx="12" fill="${soft}" stroke="${strong}" stroke-opacity=".16"/><circle cx="${x+15}" cy="${iy-9}" r="5" fill="${strong}"/><text x="${x+30}" y="${iy-3}" font-size="${rowFont}" font-weight="750" fill="#1B2430">${svgEsc(employee.name)}</text><text x="${x+174}" y="${iy-3}" font-size="${Math.max(16,rowFont-4)}" font-weight="650" fill="#65717F">${svgEsc(schedule.scheduledStart)}–${svgEsc(schedule.scheduledEnd)}</text></g>`;
    }).join('') : `<text x="250" y="${y+78}" font-size="22" font-weight="600" fill="#A1A8B2">근무 일정 없음</text>`;
    return `<g><rect x="64" y="${y}" width="952" height="${cardH}" rx="28" fill="#FFFFFF"/><rect x="82" y="${y+18}" width="126" height="96" rx="22" fill="#F3F5F8"/><text x="145" y="${y+58}" text-anchor="middle" font-size="22" font-weight="800" fill="${dayColor}">${SHARE_DAYS[index]}</text><text x="145" y="${y+88}" text-anchor="middle" font-size="18" font-weight="650" fill="#8A929D">${shareDateLabel(date)}</text>${assignments}</g>`;
  }).join('');
  const memo = effectiveShareMemo();
  const memoBlock = memo ? `<rect x="64" y="1248" width="952" height="58" rx="20" fill="#EAF2FF"/><text x="540" y="1285" text-anchor="middle" font-size="20" font-weight="700" fill="#43658D">${svgEsc(memo)}</text>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350"><rect width="1080" height="1350" fill="#F4F6F8"/><g font-family="Arial, Apple SD Gothic Neo, Noto Sans KR, sans-serif"><text x="64" y="78" font-size="24" font-weight="750" fill="#2F73E8">${svgEsc(bundle.storeName)}</text><text x="64" y="140" font-size="49" font-weight="850" letter-spacing="-1.5" fill="#111827">주간 근무 스케줄</text><text x="64" y="184" font-size="24" font-weight="650" fill="#7B8491">${shareRangeLabel(start)} · 카드형</text>${cards}${memoBlock}<text x="1016" y="1328" text-anchor="end" font-size="14" font-weight="650" fill="#A0A7B0">근태관리에서 생성</text></g></svg>`;
}
function timeToMinutes(value) {
  const [h,m] = String(value || '00:00').split(':').map(Number);
  return h * 60 + m;
}
function timetableBounds(schedules) {
  if (!schedules.length) return {start:8*60,end:22*60};
  const min = Math.min(...schedules.map((s) => timeToMinutes(s.scheduledStart)));
  const max = Math.max(...schedules.map((s) => timeToMinutes(s.scheduledEnd)));
  return {start:Math.max(0, Math.floor((min-30)/60)*60), end:Math.min(24*60, Math.ceil((max+30)/60)*60)};
}
function layoutDayTimetable(schedules) {
  const sorted = schedules.slice().sort((a,b) => timeToMinutes(a.scheduledStart) - timeToMinutes(b.scheduledStart));
  const laneEnds = [];
  const placed = sorted.map((schedule) => {
    const start = timeToMinutes(schedule.scheduledStart);
    const end = timeToMinutes(schedule.scheduledEnd);
    let lane = laneEnds.findIndex((laneEnd) => laneEnd <= start);
    if (lane < 0) { lane = laneEnds.length; laneEnds.push(end); }
    else laneEnds[lane] = end;
    return {schedule,lane,start,end};
  });
  const laneCount = Math.max(1,laneEnds.length);
  return placed.map((item) => ({...item,laneCount}));
}
function buildWeeklyScheduleTimetableSvg(bundle, start) {
  const dates = shareWeekDates(start);
  const colors = employeeColorMap(bundle);
  const grouped = new Map(dates.map((d) => [d, []]));
  bundle.schedules.forEach((schedule) => grouped.get(schedule.workDate)?.push(schedule));
  const bounds = timetableBounds(bundle.schedules);
  const width = 1600;
  const height = 1000;
  const left = 126;
  const right = 1548;
  const top = 220;
  const bottom = effectiveShareMemo() ? 880 : 922;
  const gridW = right-left;
  const gridH = bottom-top;
  const colW = gridW/7;
  const totalMinutes = Math.max(60,bounds.end-bounds.start);
  const yFor = (minutes) => top + ((minutes-bounds.start)/totalMinutes)*gridH;
  let grid = '';
  for (let minute=bounds.start; minute<=bounds.end; minute+=60) {
    const y = yFor(minute);
    grid += `<line x1="${left}" y1="${y}" x2="${right}" y2="${y}" stroke="#DDE3EA" stroke-width="1"/><text x="${left-18}" y="${y+6}" text-anchor="end" font-size="17" font-weight="650" fill="#85909D">${String(Math.floor(minute/60)).padStart(2,'0')}:00</text>`;
  }
  for (let i=0;i<=7;i++) {
    const x = left + i*colW;
    grid += `<line x1="${x}" y1="${top}" x2="${x}" y2="${bottom}" stroke="#E2E7ED" stroke-width="1"/>`;
  }
  const headers = dates.map((date,index) => {
    const x = left + index*colW + colW/2;
    const color = index===6 ? '#D94A55' : index===5 ? '#3E6FD8' : '#4E5967';
    return `<text x="${x}" y="184" text-anchor="middle" font-size="22" font-weight="800" fill="${color}">${SHARE_DAYS[index]}</text><text x="${x}" y="208" text-anchor="middle" font-size="15" font-weight="650" fill="#8A929D">${shareDateLabel(date)}</text>`;
  }).join('');
  const blocks = dates.map((date,index) => {
    const day = layoutDayTimetable(grouped.get(date));
    return day.map(({schedule,lane,laneCount,start:startMin,end:endMin}) => {
      const employee = bundle.employees.get(schedule.employeeId) || {name:'직원'};
      const [soft,strong] = colors.get(schedule.employeeId) || shareColorFor(schedule.employeeId);
      const colX = left + index*colW;
      const gap = 5;
      const laneW = (colW-gap*(laneCount+1))/laneCount;
      const x = colX + gap + lane*(laneW+gap);
      const y = yFor(startMin)+2;
      const h = Math.max(34,yFor(endMin)-yFor(startMin)-4);
      const nameSize = laneCount>=3 ? 14 : laneCount===2 ? 16 : 18;
      const timeSize = laneCount>=3 ? 11 : 13;
      return `<g><rect x="${x}" y="${y}" width="${laneW}" height="${h}" rx="12" fill="${soft}" stroke="${strong}" stroke-width="2"/><rect x="${x}" y="${y}" width="5" height="${h}" rx="2.5" fill="${strong}"/><text x="${x+12}" y="${y+23}" font-size="${nameSize}" font-weight="800" fill="#1B2430">${svgEsc(employee.name)}</text><text x="${x+12}" y="${y+42}" font-size="${timeSize}" font-weight="650" fill="#687482">${svgEsc(schedule.scheduledStart)}–${svgEsc(schedule.scheduledEnd)}</text></g>`;
    }).join('');
  }).join('');
  const activeEmployeeIds = [...new Set(bundle.schedules.map((s) => s.employeeId))];
  const legend = activeEmployeeIds.slice(0,10).map((id,index) => {
    const employee = bundle.employees.get(id) || {name:'직원'};
    const [soft,strong] = colors.get(id) || shareColorFor(id);
    const x = 910 + (index%5)*128;
    const y = 70 + Math.floor(index/5)*30;
    return `<g><rect x="${x}" y="${y-14}" width="16" height="16" rx="5" fill="${soft}" stroke="${strong}"/><text x="${x+23}" y="${y}" font-size="14" font-weight="700" fill="#596473">${svgEsc(employee.name)}</text></g>`;
  }).join('');
  const memo = effectiveShareMemo();
  const memoBlock = memo ? `<rect x="126" y="902" width="1422" height="54" rx="18" fill="#EAF2FF"/><text x="837" y="936" text-anchor="middle" font-size="18" font-weight="700" fill="#43658D">${svgEsc(memo)}</text>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 1600 1000"><rect width="1600" height="1000" fill="#F4F6F8"/><g font-family="Arial, Apple SD Gothic Neo, Noto Sans KR, sans-serif"><text x="62" y="70" font-size="22" font-weight="750" fill="#2F73E8">${svgEsc(bundle.storeName)}</text><text x="62" y="124" font-size="42" font-weight="850" fill="#111827">주간 근무 스케줄</text><text x="62" y="160" font-size="21" font-weight="650" fill="#7B8491">${shareRangeLabel(start)} · 시간표형</text>${legend}<rect x="${left}" y="${top}" width="${gridW}" height="${gridH}" rx="20" fill="#FFFFFF"/>${grid}${headers}${blocks}${memoBlock}<text x="1548" y="982" text-anchor="end" font-size="13" font-weight="650" fill="#A0A7B0">근태관리에서 생성</text></g></svg>`;
}
function buildWeeklyShareSvg(bundle,start) {
  return shareLayout === 'timetable' ? buildWeeklyScheduleTimetableSvg(bundle,start) : buildWeeklyScheduleSvg(bundle,start);
}
function shareImageSize() {
  return shareLayout === 'timetable' ? {width:1600,height:1000} : {width:1080,height:1350};
}
async function svgToPngBlob(svg) {
  const svgBlob = new Blob([svg], {type:'image/svg+xml;charset=utf-8'});
  const url = URL.createObjectURL(svgBlob);
  try {
    const image = await new Promise((resolve,reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('공유 이미지를 불러오지 못했습니다.'));
      img.src = url;
    });
    const {width,height} = shareImageSize();
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image,0,0,width,height);
    return await new Promise((resolve,reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('PNG 이미지를 만들지 못했습니다.')), 'image/png', 0.96));
  } finally {
    URL.revokeObjectURL(url);
  }
}
function weeklyScheduleFileName(start) {
  const safeStore = String(shareWeekBundle?.bundle?.storeName || state?.storeName || '근무표').replace(/[\\/:*?"<>|]/g,'-');
  return `${safeStore}_${start}_${shareDateAdd(start,6)}_주간근무표_${shareLayout === 'timetable' ? '시간표형' : '카드형'}.png`;
}
async function prepareWeeklyPng() {
  if (!shareWeekBundle || shareWeekBundle.start !== shareWeekStart) {
    const bundle = await loadWeeklyShareData(shareWeekStart);
    shareWeekBundle = { start:shareWeekStart, bundle };
  }
  const svg = buildWeeklyShareSvg(shareWeekBundle.bundle,shareWeekStart);
  return svgToPngBlob(svg);
}
function savePngBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1200);
}
async function downloadWeeklyScheduleImage() {
  const button = document.querySelector('#downloadWeeklySchedule');
  setPending(button,true,'이미지 만드는 중');
  try {
    const blob = await prepareWeeklyPng();
    savePngBlob(blob, weeklyScheduleFileName(shareWeekStart));
    toastMsg('주간 근무표 이미지를 저장했습니다.'); haptic(8);
  } catch (e) { toastMsg(e.message); }
  finally { if (button?.isConnected) setPending(button,false); }
}
async function shareWeeklyScheduleImage() {
  const button = document.querySelector('#shareWeeklySchedule');
  setPending(button,true,'공유 준비 중');
  try {
    const blob = await prepareWeeklyPng();
    const file = new File([blob], weeklyScheduleFileName(shareWeekStart), {type:'image/png'});
    const shareData = { files:[file], title:'주간 근무 스케줄', text:`${shareWeekBundle.bundle.storeName} ${shareRangeLabel(shareWeekStart)} 근무표입니다.` };
    if (navigator.share && navigator.canShare?.({files:[file]})) {
      try { await navigator.share(shareData); haptic(8); return; }
      catch (e) { if (e?.name === 'AbortError') return; }
    }
    savePngBlob(blob, file.name);
    toastMsg('공유를 지원하지 않아 이미지를 저장했습니다.');
  } catch (e) { toastMsg(e.message); }
  finally { if (button?.isConnected) setPending(button,false); }
}
function shareLayoutCards() {
  shareLayout = 'cards';
  refreshWeeklySharePreview();
}
function shareLayoutTimetable() {
  shareLayout = 'timetable';
  refreshWeeklySharePreview();
}
function shareMemoToggle(checked) {
  shareMemoEnabled = Boolean(checked);
  const input = document.querySelector('#shareMemoInput');
  if (input) input.disabled = !shareMemoEnabled;
  refreshWeeklySharePreview();
}
function updateShareMemo(value) {
  shareMemoText = String(value || '').slice(0,60);
  refreshWeeklySharePreview();
}
function weeklyShareOptionsMarkup() {
  return `<div class="share-options"><div class="share-option-label">이미지 형태</div><div class="share-layout-switch"><button class="share-layout-button ${shareLayout === 'cards' ? 'is-active' : ''}" id="shareLayoutCards">카드형</button><button class="share-layout-button ${shareLayout === 'timetable' ? 'is-active' : ''}" id="shareLayoutTimetable">시간표형</button></div><label class="share-memo-row"><span><b>메모 표시</b><small>이미지 하단에 공지 메모를 표시합니다.</small></span><input type="checkbox" id="shareMemoToggle" ${shareMemoEnabled ? 'checked' : ''}></label><div class="field ${shareMemoEnabled ? '' : 'is-disabled'}"><label for="shareMemoInput">공유 메모</label><div class="field-shell"><input id="shareMemoInput" class="field-control" maxlength="60" value="${svgEsc(shareMemoText)}" ${shareMemoEnabled ? '' : 'disabled'}></div><div class="field-help">최대 60자 · 이미지에만 표시되고 근무표 데이터에는 저장되지 않습니다.</div></div></div>`;
}
function bindWeeklyShareControls() {
  document.querySelector('#shareWeekPrev').onclick = () => shareWeekShift(-7);
  document.querySelector('#shareWeekNext').onclick = () => shareWeekShift(7);
  document.querySelector('#shareLayoutCards').onclick = shareLayoutCards;
  document.querySelector('#shareLayoutTimetable').onclick = shareLayoutTimetable;
  document.querySelector('#shareMemoToggle').onchange = (e) => shareMemoToggle(e.target.checked);
  document.querySelector('#shareMemoInput').onchange = (e) => updateShareMemo(e.target.value);
  document.querySelector('#downloadWeeklySchedule').onclick = downloadWeeklyScheduleImage;
  document.querySelector('#shareWeeklySchedule').onclick = shareWeeklyScheduleImage;
}
function refreshWeeklySharePreview() {
  if (!shareWeekBundle?.bundle) return;
  const svg = buildWeeklyShareSvg(shareWeekBundle.bundle,shareWeekStart);
  if (shareWeekPreviewUrl) URL.revokeObjectURL(shareWeekPreviewUrl);
  shareWeekPreviewUrl = URL.createObjectURL(new Blob([svg], {type:'image/svg+xml;charset=utf-8'}));
  const preview = document.querySelector('#weeklySharePreview');
  if (preview) preview.src = shareWeekPreviewUrl;
  document.querySelector('#shareLayoutCards')?.classList.toggle('is-active',shareLayout==='cards');
  document.querySelector('#shareLayoutTimetable')?.classList.toggle('is-active',shareLayout==='timetable');
}
async function renderWeeklyScheduleShare() {
  openSheet(`<div class="sheet-heading"><div><span class="sheet-kicker">주간 공유</span><h2>근무표 이미지를 만들고 있어요</h2><p>주간 스케줄을 불러오는 중입니다.</p></div></div><div class="native-empty small"><p>잠시만 기다려 주세요.</p></div>`, {size:'compact'});
  try {
    const bundle = await loadWeeklyShareData(shareWeekStart);
    shareWeekBundle = {start:shareWeekStart,bundle};
    const svg = buildWeeklyShareSvg(bundle,shareWeekStart);
    if (shareWeekPreviewUrl) URL.revokeObjectURL(shareWeekPreviewUrl);
    shareWeekPreviewUrl = URL.createObjectURL(new Blob([svg], {type:'image/svg+xml;charset=utf-8'}));
    openSheet(`<div class="sheet-heading"><div><span class="sheet-kicker">주간 공유</span><h2>주간 근무 스케줄</h2><p>${shareRangeLabel(shareWeekStart)} · 단체톡 공유용 이미지</p></div><div class="calendar-nav"><button class="circle-button" id="shareWeekPrev" aria-label="이전 주">${icon('back')}</button><button class="circle-button" id="shareWeekNext" aria-label="다음 주">${icon('forward')}</button></div></div>${weeklyShareOptionsMarkup()}<div class="weekly-share-preview-shell"><img id="weeklySharePreview" src="${shareWeekPreviewUrl}" alt="주간 근무 스케줄 이미지 미리보기"></div><div class="sheet-notice">직원별 색상은 카드형과 시간표형에서 동일하게 유지됩니다.</div><div class="sheet-actions"><button class="action-button secondary-action" id="downloadWeeklySchedule"><span>이미지 저장</span></button><button class="action-button primary-action" id="shareWeeklySchedule"><span>공유하기</span></button></div>`, {size:'compact share-schedule-sheet'});
    bindWeeklyShareControls();
  } catch (e) {
    openSheet(`<div class="sheet-heading"><div><span class="sheet-kicker danger-kicker">주간 공유</span><h2>근무표를 만들지 못했어요</h2><p>${svgEsc(e.message)}</p></div></div><button class="action-button secondary-action" data-close><span>닫기</span></button>`, {size:'compact'});
  }
}
function shareWeekShift(days) {
  shareWeekStart = shareDateAdd(shareWeekStart, days);
  shareWeekBundle = null;
  renderWeeklyScheduleShare();
}
function openWeeklyScheduleShare() {
  const base = scheduleMonth === currentMonth() ? kstDate() : `${scheduleMonth}-01`;
  shareWeekStart = shareMonday(base);
  shareWeekBundle = null;
  renderWeeklyScheduleShare();
}

function scheduleGroups(records) {
  const map = new Map();
  for (const schedule of records) {
    const list = map.get(schedule.workDate) || [];
    list.push(schedule);
    map.set(schedule.workDate, list);
  }
  return [...map.entries()]
    .sort(([a],[b]) => a.localeCompare(b))
    .map(([date, items]) => ({
      date,
      items: items.sort((a,b) => a.scheduledStart.localeCompare(b.scheduledStart) || String(employeeById(a.employeeId)?.name || '').localeCompare(String(employeeById(b.employeeId)?.name || ''))),
    }));
}

function scheduleGroupDateLabel(date) {
  const [,m,d] = date.split('-').map(Number);
  const weekday = ['일요일','월요일','화요일','수요일','목요일','금요일','토요일'][new Date(`${date}T00:00:00+09:00`).getDay()];
  return `${m}월 ${d}일 · ${weekday}`;
}
function scheduleDateGroupMarkup(group) {
  const open = group.date === scheduleExpandedDate;
  return `<section class="schedule-date-group ${open ? 'is-open' : ''}"><button class="schedule-date-toggle" data-schedule-group="${group.date}" aria-expanded="${open ? 'true' : 'false'}"><b>${esc(scheduleGroupDateLabel(group.date))}</b><span>${group.items.length}명</span>${icon('chevron','chevron')}</button><div class="schedule-date-body">${group.items.map(scheduleListRow).join('')}</div></section>`;
}
function toggleScheduleGroup(date) {
  scheduleExpandedDate = scheduleExpandedDate === date ? '' : date;
  document.querySelectorAll('[data-schedule-group]').forEach((button) => {
    const open = button.dataset.scheduleGroup === scheduleExpandedDate;
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
    button.closest('.schedule-date-group')?.classList.toggle('is-open', open);
  });
}
function scheduleCell(date) {
  if (!date) return '<div class="calendar-spacer"></div>';
  const assignments = (state.schedules || [])
    .filter((s) => s.workDate === date)
    .slice()
    .sort((a,b) => a.scheduledStart.localeCompare(b.scheduledStart) || String(employeeById(a.employeeId)?.name || '').localeCompare(String(employeeById(b.employeeId)?.name || '')));
  const names = assignments.map((schedule) => employeeById(schedule.employeeId)?.name).filter(Boolean);
  return `<button class="calendar-day schedule-day ${assignments.length ? 'is-scheduled' : ''} ${scheduleSelected.has(date) ? 'is-selected' : ''} ${date === kstDate() ? 'is-today' : ''}" data-schedule-date="${date}"><span class="day-number">${Number(date.slice(-2))}</span>${names.length ? `<span class="schedule-name-list">${names.map((name) => `<span class="schedule-pill">${esc(name)}</span>`).join('')}</span>` : ''}</button>`;
}
function scheduleListRow(schedule) {
  const employee = employeeById(schedule.employeeId);
  return `<div class="schedule-list-row"><div><b>${esc(schedule.workDate.slice(5))} · ${esc(employee?.name || '')}</b><span>${esc(schedule.scheduledStart)} — ${esc(schedule.scheduledEnd)} · ${esc(shiftTypeLabel(schedule.shiftType))}</span></div><button class="row-action destructive-text" data-delete-schedule="${schedule.employeeId}|${schedule.workDate}">삭제</button></div>`;
}
function selectedDateChips() {
  return scheduleSelected.size ? [...scheduleSelected].sort().slice(0,5).map((d) => `<span class="date-chip">${d.slice(5)}</span>`).join('') + (scheduleSelected.size > 5 ? `<span class="date-chip">+${scheduleSelected.size - 5}</span>` : '') : '<span class="selection-empty">달력에서 날짜를 선택하세요</span>';
}
function toggleScheduleDate(date) {
  scheduleSelected.has(date) ? scheduleSelected.delete(date) : scheduleSelected.add(date);
  document.querySelector(`[data-schedule-date="${date}"]`)?.classList.toggle('is-selected', scheduleSelected.has(date));
  const count = document.querySelector('#selectedCount');
  const box = document.querySelector('#selectedDates');
  if (count) count.textContent = `${scheduleSelected.size}일 선택`;
  if (box) box.innerHTML = selectedDateChips();
  haptic(5);
}
async function saveSchedule() {
  clearFieldErrors(document.querySelector('.panel-root'));
  const workDates = [...scheduleSelected].sort();
  if (!scheduleEmployeeId) return showFieldError('schEmployee', '직원을 선택해 주세요.');
  if (!workDates.length) { toastMsg('달력에서 근무 날짜를 선택해 주세요.'); return; }
  if (!scheduleStart || !scheduleEnd || scheduleStart >= scheduleEnd) return showFieldError('schEnd', '퇴근 시간은 출근 시간보다 늦어야 합니다.');
  const button = document.querySelector('#saveSchedule');
  setPending(button, true, '배정 중');
  try {
    await api.bulkSchedule(session.token, { employeeId:scheduleEmployeeId, workDates, scheduledStart:scheduleStart, scheduledEnd:scheduleEnd, shiftType:scheduleShiftType });
    await load(scheduleMonth);
    scheduleSelected = new Set();
    renderSchedulePanel();
    toastMsg(`${workDates.length}일의 근무표를 저장했습니다.`); haptic(10);
  } catch (e) { toastMsg(e.message); }
  finally { setPending(button, false); }
}
function openDeleteScheduleSheet(employeeId, workDate) {
  const employee = employeeById(employeeId);
  openSheet(`<div class="sheet-heading"><div><span class="sheet-kicker danger-kicker">근무 삭제</span><h2>${esc(workDate.slice(5))} · ${esc(employee?.name || '')}</h2><p>이 날짜의 근무 배정을 삭제할까요?</p></div></div><div class="sheet-actions"><button class="action-button secondary-action" data-close><span>취소</span></button><button class="action-button destructive-action" id="confirmDeleteSchedule"><span>근무 삭제</span></button></div>`, { size:'compact' });
  document.querySelector('#confirmDeleteSchedule').onclick = () => deleteSchedule(employeeId, workDate, false);
}
async function deleteSchedule(employeeId, workDate, force) {
  const button = document.querySelector('#confirmDeleteSchedule');
  setPending(button, true, '삭제 중');
  try {
    await api.deleteSchedule(session.token, employeeId, workDate, force);
    await load(scheduleMonth);
    dismissLayer(document.querySelector('.sheet-backdrop'));
    renderSchedulePanel();
    toastMsg('근무 일정을 삭제했습니다.');
  } catch (e) {
    if (e.data?.requiresConfirmation && !force) {
      dismissLayer(document.querySelector('.sheet-backdrop'));
      setTimeout(() => {
        openSheet(`<div class="sheet-heading"><div><span class="sheet-kicker danger-kicker">기록이 있어요</span><h2>실제 근태 기록이 있는 날짜예요.</h2><p>근태 기록은 남겨두고 근무표만 삭제할 수 있습니다.</p></div></div><div class="sheet-actions"><button class="action-button secondary-action" data-close><span>취소</span></button><button class="action-button destructive-action" id="forceDeleteSchedule"><span>근무표만 삭제</span></button></div>`, { size:'compact' });
        document.querySelector('#forceDeleteSchedule').onclick = () => deleteSchedule(employeeId, workDate, true);
      }, 180);
    } else toastMsg(e.message);
  } finally { setPending(button, false); }
}

