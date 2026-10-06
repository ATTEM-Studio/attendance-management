import test from 'node:test';
import assert from 'node:assert/strict';

await import(`../schedule-import-core.js?t=${Date.now()}`);
const Core=globalThis.ScheduleImportCore;
const XLSX={utils:{sheet_to_json(sheet){return sheet.__rows.map((row)=>row.slice());}}};

function block(employee='세영'){
  return [
    ['', '시간','월','화','수','목','금','토','','일'],
    ['', '08:00 ~ 09:00',`${employee} 8-12 (4)`,'은아 8-11 (3)','세영 8-2 (6)','은아 8-11 (3)','세영 8-11 (3)','세영 8-6 (6)','','송이 9-6 (8)'],
    ['', '09:00 ~ 10:00','','','','','','','',''],
    ['', '10:00 ~ 11:00','','','','','','','',''],
    ['', '11:00 ~ 12:00','이유림 12-6 (6)','이유림 11-6 (7)','','박시현 11-5 (6)','이유림 11-6 (7)','','',''],
    ['', '12:00 ~ 13:00','','','','','','채빈 11-5 (6)','',''],
    ['', '13:00 ~ 14:00','','','나현 1-7 (6)','','','','',''],
    ['', '18:00 ~ 19:00','김송이 6-10 (4)','나현 6-10 (4)','','김송이 6-10 (4)','나현 6-10 (4)','박시현 6-11 (5)','',''],
    ['', '21:00 ~ 22:00','','','','','','','',''],
  ];
}

test('real workbook style time-axis ranges make a full week authoritative',()=>{
  const workbook={SheetNames:['Sheet1'],Sheets:{Sheet1:{__rows:block()}}};
  const [region]=Core.detectScheduleRegions(workbook,XLSX);
  assert.equal(region.authoritative,true);
  assert.ok(region.reasons.some((reason)=>reason.includes('시간축 8')||reason.includes('시간축 9')));
  const rows=Core.parseScheduleRegion(workbook,XLSX,region);
  assert.ok(rows.some((row)=>row.employeeLabel==='김송이'&&row.scheduledStart==='18:00'&&row.scheduledEnd==='22:00'));
});

test('when comparable revisions repeat in one sheet the later block is recommended',()=>{
  const older=block('구버전직원');
  const spacer=Array.from({length:10},()=>['']);
  const newer=block('최신직원');
  const workbook={SheetNames:['Sheet1'],Sheets:{Sheet1:{__rows:[...older,...spacer,...newer]}}};
  const regions=Core.detectScheduleRegions(workbook,XLSX);
  assert.ok(regions.length>=2);
  assert.ok(regions[0].headerRow>regions[1].headerRow,'later repeated schedule should rank first when structurally comparable');
  const rows=Core.parseScheduleRegion(workbook,XLSX,regions[0]);
  assert.ok(rows.some((row)=>row.employeeLabel==='최신직원'));
});
