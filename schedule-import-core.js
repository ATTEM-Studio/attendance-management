(function attachScheduleImportCore(root) {
  'use strict';

  const WEEKDAY_MAP = { '일':0, '일요일':0, '월':1, '월요일':1, '화':2, '화요일':2, '수':3, '수요일':3, '목':4, '목요일':4, '금':5, '금요일':5, '토':6, '토요일':6 };
  const SHIFT_TYPES = new Set(['open','middle','close','open_middle','middle_close','other']);
  const NEGATIVE_SHEET = /(급여|시급|합계|회의|안건|발주|주문|정산|매출)/i;
  const ROLE_WORDS = /(점장|매니저|스태프|직원|알바|파트타이머|님|쌤)/g;

  function text(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function normalizeLabel(value) {
    return text(value)
      .replace(/\([^)]*\)/g, ' ')
      .replace(ROLE_WORDS, ' ')
      .replace(/[·•|,/]/g, ' ')
      .replace(/\s+/g, '')
      .trim();
  }

  function weekdayFromCell(value) {
    const raw = text(value).replace(/[()\[\]]/g, '').trim();
    if (Object.prototype.hasOwnProperty.call(WEEKDAY_MAP, raw)) return WEEKDAY_MAP[raw];
    const match = raw.match(/(^|\s)([월화수목금토일])(?:요일)?($|\s)/);
    return match ? WEEKDAY_MAP[match[2]] : null;
  }

  function parseGridHour(value) {
    const raw = text(value);
    const match = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*$/);
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2] || 0);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
    return hour + minute / 60;
  }

  function toClock(hour, minute = 0) {
    return `${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`;
  }

  function timeCandidates(raw) {
    const match = text(raw).match(/^(\d{1,2})(?::(\d{2}))?$/);
    if (!match) return [];
    const base = Number(match[1]);
    const minute = Number(match[2] || 0);
    if (base > 23 || minute > 59) return [];
    if (match[2]) return [{hour:base,minute,value:base + minute/60}];
    const hours = new Set([base]);
    if (base <= 11) hours.add(base + 12);
    return [...hours].filter((hour) => hour <= 23).map((hour) => ({hour,minute,value:hour + minute/60}));
  }

  function normalizeRange(startRaw, endRaw, contextStart = null) {
    const starts = timeCandidates(startRaw);
    const ends = timeCandidates(endRaw);
    if (!starts.length || !ends.length) return null;

    let start;
    if (contextStart != null && Number.isFinite(contextStart)) {
      start = starts.slice().sort((a,b) => Math.abs(a.value-contextStart)-Math.abs(b.value-contextStart))[0];
    } else {
      start = starts.find((candidate) => candidate.value >= 8 && candidate.value <= 22) || starts[0];
      if (start.value < 8 && starts.length > 1) start = starts[starts.length-1];
    }

    const validEnds = ends
      .filter((candidate) => candidate.value > start.value && candidate.value - start.value <= 14)
      .sort((a,b) => (a.value-start.value)-(b.value-start.value));
    let end = validEnds[0];
    if (!end) {
      const later = ends.map((candidate) => ({...candidate,value:candidate.value + 12,hour:candidate.hour + 12}))
        .filter((candidate) => candidate.hour <= 23 && candidate.value > start.value && candidate.value-start.value <= 14)
        .sort((a,b) => (a.value-start.value)-(b.value-start.value));
      end = later[0];
    }
    if (!end) return null;
    return { start:toClock(start.hour,start.minute), end:toClock(end.hour,end.minute) };
  }

  function parseShiftCell(value, contextStart, sourceRowId, weekday) {
    const raw = text(value);
    if (!raw) return null;
    const match = raw.match(/^(.*?)\s*(\d{1,2}(?::\d{2})?)\s*(?:-|~|–|—|－)\s*(\d{1,2}(?::\d{2})?)(.*)$/);
    if (!match) return null;
    const employeeLabel = text(match[1]).replace(/[,:：-]+$/g,'').trim();
    if (!employeeLabel) return null;
    const range = normalizeRange(match[2],match[3],contextStart);
    if (!range) return null;
    const notes = [];
    const suffix = text(match[4]);
    if (suffix) notes.push(suffix);
    return {
      sourceRowId,
      employeeLabel,
      weekday,
      scheduledStart:range.start,
      scheduledEnd:range.end,
      shiftType:'other',
      confidence:0.98,
      notes,
    };
  }

  function matrixFor(workbook, XLSX, sheetName) {
    const sheet = workbook?.Sheets?.[sheetName];
    if (!sheet) return [];
    const rows = XLSX?.utils?.sheet_to_json?.(sheet,{header:1,raw:false,defval:''});
    return Array.isArray(rows) ? rows.map((row) => Array.isArray(row) ? row : []) : [];
  }

  function colName(index) {
    let value = index + 1;
    let result = '';
    while (value > 0) {
      const rem = (value - 1) % 26;
      result = String.fromCharCode(65 + rem) + result;
      value = Math.floor((value - 1) / 26);
    }
    return result;
  }

  function detectScheduleRegions(workbook, XLSX) {
    const regions = [];
    for (const sheetName of workbook?.SheetNames || []) {
      const matrix = matrixFor(workbook,XLSX,sheetName);
      const headerRows = [];
      for (let r=0;r<matrix.length;r+=1) {
        const weekdayCols = [];
        for (let c=0;c<(matrix[r] || []).length;c+=1) {
          const weekday = weekdayFromCell(matrix[r][c]);
          if (weekday != null) weekdayCols.push({col:c,weekday});
        }
        if (weekdayCols.length >= 4) headerRows.push({row:r,weekdayCols});
      }
      if (!headerRows.length) continue;

      for (let i=0;i<headerRows.length;i+=1) {
        const header = headerRows[i];
        const endRow = (headerRows[i+1]?.row ?? matrix.length) - 1;
        const firstWeekdayCol = Math.min(...header.weekdayCols.map((item) => item.col));
        let timeCol = 0;
        let bestTimeCount = -1;
        for (let c=0;c<firstWeekdayCol;c+=1) {
          let count = 0;
          for (let r=header.row+1;r<=endRow;r+=1) if (parseGridHour(matrix[r]?.[c]) != null) count += 1;
          if (count > bestTimeCount) { bestTimeCount=count; timeCol=c; }
        }
        let shiftCells = 0;
        for (let r=header.row+1;r<=endRow;r+=1) {
          for (const {col,weekday} of header.weekdayCols) {
            if (parseShiftCell(matrix[r]?.[col],parseGridHour(matrix[r]?.[timeCol]),`${sheetName}:${r+1}:${col+1}`,weekday)) shiftCells += 1;
          }
        }
        let score = header.weekdayCols.length * 12 + Math.max(0,bestTimeCount) * 2 + shiftCells * 3;
        const reasons = [`요일 ${header.weekdayCols.length}개`, `시간축 ${Math.max(0,bestTimeCount)}개`, `근무셀 ${shiftCells}개`];
        if (NEGATIVE_SHEET.test(sheetName)) { score -= 45; reasons.push('비근무표 시트명 감점'); }
        const maxCol = Math.max(timeCol,...header.weekdayCols.map((item) => item.col));
        regions.push({
          id:`${sheetName}:${header.row+1}:${endRow+1}`,
          sheetName,
          range:`${colName(Math.min(timeCol,firstWeekdayCol))}${header.row+1}:${colName(maxCol)}${endRow+1}`,
          score,
          reasons,
          authoritative:header.weekdayCols.length >= 7 && bestTimeCount >= 4,
          headerRow:header.row,
          endRow,
          timeCol,
          weekdayCols:header.weekdayCols,
        });
      }
    }
    return regions.sort((a,b) => b.score-a.score || a.sheetName.localeCompare(b.sheetName));
  }

  function parseScheduleRegion(workbook, XLSX, region) {
    if (!region?.sheetName) return [];
    const matrix = matrixFor(workbook,XLSX,region.sheetName);
    const headerRow = Number.isInteger(region.headerRow) ? region.headerRow : 0;
    const endRow = Number.isInteger(region.endRow) ? region.endRow : matrix.length-1;
    const weekdayCols = Array.isArray(region.weekdayCols) && region.weekdayCols.length
      ? region.weekdayCols
      : (matrix[headerRow] || []).map((value,col) => ({col,weekday:weekdayFromCell(value)})).filter((item) => item.weekday != null);
    const timeCol = Number.isInteger(region.timeCol) ? region.timeCol : 0;
    const rows = [];
    for (let r=headerRow+1;r<=endRow;r+=1) {
      const contextStart = parseGridHour(matrix[r]?.[timeCol]);
      for (const {col,weekday} of weekdayCols) {
        const parsed = parseShiftCell(matrix[r]?.[col],contextStart,`${region.sheetName}:${r+1}:${col+1}`,weekday);
        if (parsed) rows.push(parsed);
      }
    }
    return rows.sort((a,b) => a.weekday-b.weekday || a.scheduledStart.localeCompare(b.scheduledStart) || a.employeeLabel.localeCompare(b.employeeLabel));
  }

  function expandWeeklyPattern(rows, targetMonth, effectiveDate) {
    if (!/^\d{4}-\d{2}$/.test(String(targetMonth || ''))) return [];
    const [year,month] = targetMonth.split('-').map(Number);
    const lastDay = new Date(Date.UTC(year,month,0)).getUTCDate();
    const result = [];
    for (let day=1;day<=lastDay;day+=1) {
      const workDate = `${targetMonth}-${String(day).padStart(2,'0')}`;
      if (effectiveDate && workDate < effectiveDate) continue;
      const weekday = new Date(`${workDate}T00:00:00Z`).getUTCDay();
      for (const row of rows || []) {
        if (Number(row.weekday) !== weekday) continue;
        result.push({...row,sourceRowId:`${row.sourceRowId || 'row'}:${workDate}`,workDate});
      }
    }
    return normalizeImportedShifts(result);
  }

  function normalizeImportedShifts(rows) {
    return (rows || []).map((row,index) => ({
      sourceRowId:text(row.sourceRowId || `row-${index+1}`),
      employeeLabel:text(row.employeeLabel),
      ...(row.employeeId ? {employeeId:text(row.employeeId)} : {}),
      ...(row.workDate ? {workDate:text(row.workDate)} : {}),
      ...(row.weekday != null ? {weekday:Number(row.weekday)} : {}),
      scheduledStart:text(row.scheduledStart),
      scheduledEnd:text(row.scheduledEnd),
      shiftType:SHIFT_TYPES.has(row.shiftType) ? row.shiftType : 'other',
      confidence:Number.isFinite(Number(row.confidence)) ? Math.max(0,Math.min(1,Number(row.confidence))) : 1,
      notes:Array.isArray(row.notes) ? row.notes.map(text).filter(Boolean) : [],
    })).filter((row) => row.employeeLabel && row.scheduledStart && row.scheduledEnd)
      .sort((a,b) => String(a.workDate || '').localeCompare(String(b.workDate || '')) || String(a.employeeId || a.employeeLabel).localeCompare(String(b.employeeId || b.employeeLabel),'ko') || a.scheduledStart.localeCompare(b.scheduledStart));
  }

  function matchEmployeeLabel(label, employees, aliases = {}) {
    const raw = text(label);
    const key = normalizeLabel(raw);
    const active = (employees || []).filter((employee) => employee?.active !== false);
    const aliasId = aliases?.[raw] || aliases?.[key];
    if (aliasId) {
      const aliased = active.find((employee) => String(employee.id) === String(aliasId));
      if (aliased) return {employeeId:aliased.id,matchedName:aliased.name,matchType:'alias',confidence:1,needsReview:false};
    }
    const exact = active.find((employee) => normalizeLabel(employee.name) === key);
    if (exact) return {employeeId:exact.id,matchedName:exact.name,matchType:'exact',confidence:1,needsReview:false};

    const candidates = key.length >= 2 ? active.filter((employee) => {
      const employeeKey = normalizeLabel(employee.name);
      return employeeKey.endsWith(key) || key.endsWith(employeeKey) || employeeKey.includes(key);
    }) : [];
    if (candidates.length === 1) {
      const employee = candidates[0];
      return {employeeId:employee.id,matchedName:employee.name,matchType:'abbreviation',confidence:0.92,needsReview:false};
    }
    return {
      employeeId:undefined,
      matchedName:undefined,
      matchType:candidates.length > 1 ? 'ambiguous' : 'unmatched',
      confidence:candidates.length > 1 ? 0.5 : 0,
      needsReview:true,
      candidates:candidates.map((employee) => ({id:employee.id,name:employee.name})),
    };
  }

  async function fingerprintArrayBuffer(buffer) {
    const value = buffer instanceof ArrayBuffer ? buffer : buffer?.buffer;
    if (!(value instanceof ArrayBuffer)) throw new TypeError('ArrayBuffer가 필요합니다.');
    if (!root.crypto?.subtle) throw new Error('SHA-256을 지원하지 않는 환경입니다.');
    const digest = await root.crypto.subtle.digest('SHA-256',value);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2,'0')).join('');
  }

  root.ScheduleImportCore = Object.freeze({
    detectScheduleRegions,
    parseScheduleRegion,
    expandWeeklyPattern,
    matchEmployeeLabel,
    normalizeImportedShifts,
    fingerprintArrayBuffer,
  });
})(globalThis);
