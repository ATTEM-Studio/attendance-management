import { zipSync, strToU8 } from 'npm:fflate@0.8.2';
import { createClient } from '@supabase/supabase-js';

const H = {
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, apikey, content-type',
  'Access-Control-Allow-Methods':'GET, OPTIONS',
};

const esc=(v='')=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const col=(n:number)=>{let s='';while(n){n--;s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26)}return s};
const sc=(r:number,c:number,v:any,s=9)=>`<c r="${col(c)}${r}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
const nc=(r:number,c:number,v:any,s=8)=>`<c r="${col(c)}${r}" s="${s}" t="n"><v>${Number(v)||0}</v></c>`;
const rw=(r:number,c:string[],h?:number)=>`<row r="${r}"${h?` ht="${h}" customHeight="1"`:''}>${c.join('')}</row>`;
const fm=(n:any)=>{n=Math.max(0,Number(n)||0);return `${Math.floor(n/60)}:${String(n%60).padStart(2,'0')}`};
const ft=(v:any)=>!v?'':new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(v));
const wd=(d:string)=>['일','월','화','수','목','금','토'][new Date(`${d}T00:00:00+09:00`).getDay()];
const sl=(a:any)=>a?.session_type==='extra'?`추가 근무 ${Math.max(1,Number(a.session_no||2)-1)}`:'기본 근무';
const workDays=(rows:any[])=>new Set(rows.filter(a=>a.clock_in).map(a=>a.work_date)).size;

const sheet=(rows:string[],merges:string[],widths:number[],freeze:number,dim:string)=>`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="${dim}"/><sheetViews><sheetView workbookViewId="0">${freeze?`<pane ySplit="${freeze-1}" topLeftCell="A${freeze}" activePane="bottomLeft" state="frozen"/>`:''}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols>${widths.map((w,i)=>`<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${rows.join('')}</sheetData>${merges.length?`<mergeCells count="${merges.length}">${merges.map(x=>`<mergeCell ref="${x}"/>`).join('')}</mergeCells>`:''}<pageMargins left="0.22" right="0.22" top="0.35" bottom="0.45" header="0.2" footer="0.2"/><pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="0"/><headerFooter><oddFooter>&amp;L근태관리 보고서&amp;C페이지 &amp;P / &amp;N&amp;R시스템 출력</oddFooter></headerFooter></worksheet>`;

const styles=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="5"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="18"/><color rgb="FF111827"/><name val="Arial"/></font><font><b/><sz val="11"/><color rgb="FF1F2937"/><name val="Arial"/></font><font><b/><sz val="9"/><color rgb="FF5B6472"/><name val="Arial"/></font><font><b/><sz val="9"/><color rgb="FFFFFFFF"/><name val="Arial"/></font></fonts><fills count="6"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1677FF"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEAF3FF"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF4F6F8"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEAF8F0"/></patternFill></fill></fills><borders count="2"><border/><border><left style="thin"><color rgb="FFE1E5EA"/></left><right style="thin"><color rgb="FFE1E5EA"/></right><top style="thin"><color rgb="FFE1E5EA"/></top><bottom style="thin"><color rgb="FFE1E5EA"/></bottom></border></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="11"><xf/><xf fontId="1" applyFont="1"/><xf fontId="3" applyFont="1"/><xf fontId="3" fillId="3" borderId="1" applyFont="1" applyFill="1" applyBorder="1"><alignment horizontal="center"/></xf><xf fontId="2" borderId="1" applyFont="1" applyBorder="1"/><xf fontId="3" fillId="4" borderId="1" applyFont="1" applyFill="1" applyBorder="1"><alignment horizontal="center"/></xf><xf fontId="2" borderId="1" applyFont="1" applyBorder="1"><alignment horizontal="center"/></xf><xf fontId="4" fillId="2" borderId="1" applyFont="1" applyFill="1" applyBorder="1"><alignment horizontal="center" wrapText="1"/></xf><xf borderId="1" applyBorder="1"><alignment horizontal="center"/></xf><xf borderId="1" applyBorder="1"/><xf fontId="2" fillId="5" borderId="1" applyFont="1" applyFill="1" applyBorder="1"><alignment horizontal="center"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

function build(store:string,month:string,emps:any[],sched:any[],att:any[]){
  const E=new Map(emps.map(e=>[e.id,e]));
  const S=new Map(sched.map(x=>[`${x.employee_id}|${x.work_date}`,x]));
  const attendanceByDay=new Map<string,any[]>();
  for(const a of att){
    const k=`${a.employee_id}|${a.work_date}`;
    const list=attendanceByDay.get(k)||[];
    list.push(a);
    attendanceByDay.set(k,list);
  }
  for(const list of attendanceByDay.values()) list.sort((a,b)=>Number(a.session_no||1)-Number(b.session_no||1));

  const keys=[...new Set([...S.keys(),...attendanceByDay.keys()])];
  const rec:any[]=[];
  for(const k of keys){
    const [employee_id,work_date]=k.split('|');
    const emp=E.get(employee_id);
    if(!emp) continue;
    const schedule=S.get(k)||null;
    const sessions=attendanceByDay.get(k)||[];
    if(!sessions.length){
      rec.push({employee_id,work_date,emp,schedule,attendance:null});
      continue;
    }
    for(const attendance of sessions){
      rec.push({employee_id,work_date,emp,schedule:attendance.session_type==='base'?schedule:null,attendance});
    }
  }
  rec.sort((a,b)=>a.work_date.localeCompare(b.work_date)||a.emp.name.localeCompare(b.emp.name)||Number(a.attendance?.session_no||1)-Number(b.attendance?.session_no||1));

  const ids=new Set(rec.map(x=>x.employee_id));
  const rel=emps.filter(e=>ids.has(e.id)).sort((a,b)=>a.name.localeCompare(b.name));
  const sheets:string[]=[];
  const names=['통합 근태관리'];
  const areas:string[]=[];
  const titles:number[]=[];
  const tw=att.reduce((n,a)=>n+(a.work_minutes||0),0);
  const ov=att.reduce((n,a)=>n+(a.overtime_minutes||0),0);
  const overallWorkDays=new Set(att.filter(a=>a.clock_in).map(a=>`${a.employee_id}|${a.work_date}`)).size;

  let rows:string[]=[];
  rows.push(
    rw(1,[sc(1,1,'근태관리 월간 보고서',1)],30),
    rw(2,[sc(2,1,'세무 증빙 제출용 · 시스템 근태 기록 기준',2)]),
    rw(4,[sc(4,1,'사업장',3),sc(4,2,store,4),sc(4,5,'대상기간',3),sc(4,6,month,4),sc(4,10,'출력일',3),sc(4,11,new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul'}).format(new Date()),4)]),
    rw(6,[sc(6,1,'근무 인원',5),nc(6,2,rel.length,6),sc(6,3,'총 근무일',5),nc(6,4,overallWorkDays,6),sc(6,5,'총 근무시간',5),sc(6,6,fm(tw),6),sc(6,7,'지각',5),nc(6,8,att.filter(a=>a.late_minutes>0).length,6),sc(6,9,'조퇴',5),nc(6,10,att.filter(a=>a.early_leave_minutes>0).length,6),sc(6,11,'연장근무',5),sc(6,12,fm(ov),6)]),
    rw(8,['직원','직급','근무일','근무구간','총 근무','지각','조퇴','연장'].map((v,i)=>sc(8,i+1,v,7)))
  );
  let r=9;
  for(const e of rel){
    const aa=att.filter(a=>a.employee_id===e.id);
    rows.push(rw(r,[sc(r,1,e.name,9),sc(r,2,e.position,8),nc(r,3,workDays(aa),8),nc(r,4,aa.filter(a=>a.clock_in).length,8),sc(r,5,fm(aa.reduce((n,a)=>n+(a.work_minutes||0),0)),8),nc(r,6,aa.filter(a=>a.late_minutes>0).length,8),nc(r,7,aa.filter(a=>a.early_leave_minutes>0).length,8),sc(r,8,fm(aa.reduce((n,a)=>n+(a.overtime_minutes||0),0)),8)]));
    r++;
  }
  r++;
  const integratedHeader=r;
  rows.push(rw(r,['날짜','요일','직원','직급','근무 구분','예정 출근','예정 퇴근','실제 출근','실제 퇴근','실근무','지각','조퇴','연장'].map((v,i)=>sc(r,i+1,v,7)),24));
  r++;
  for(const x of rec){
    const a=x.attendance;
    const s=x.schedule||{};
    rows.push(rw(r,[
      sc(r,1,x.work_date,8),sc(r,2,wd(x.work_date),8),sc(r,3,x.emp.name,9),sc(r,4,x.emp.position,8),
      sc(r,5,a?sl(a):'기본 근무',8),sc(r,6,String(s.scheduled_start||'').slice(0,5),8),sc(r,7,String(s.scheduled_end||'').slice(0,5),8),
      sc(r,8,ft(a?.clock_in),8),sc(r,9,ft(a?.clock_out),8),sc(r,10,a?.clock_in?fm(a.work_minutes):'',8),
      sc(r,11,a?.late_minutes||'',8),sc(r,12,a?.early_leave_minutes||'',8),sc(r,13,a?.overtime_minutes||'',8)
    ]));
    r++;
  }
  rows.push(rw(r,[sc(r,1,'합계',10),sc(r,10,fm(tw),10),sc(r,11,String(att.reduce((n,a)=>n+(a.late_minutes||0),0)),10),sc(r,12,String(att.reduce((n,a)=>n+(a.early_leave_minutes||0),0)),10),sc(r,13,fm(ov),10)]));
  sheets.push(sheet(rows,['A1:M1',`A${r}:I${r}`],[11,6,11,10,12,10,10,11,11,10,7,7,9],integratedHeader,`A1:M${r}`));
  areas.push(`$A$1:$M$${r}`);
  titles.push(integratedHeader);

  for(const e of rel){
    const name=`${e.name.replace(/[\\/?*\[\]:]/g,' ').slice(0,26)}_근태`.slice(0,31);
    names.push(name);
    const er=rec.filter(x=>x.employee_id===e.id);
    const aa=att.filter(a=>a.employee_id===e.id);
    rows=[
      rw(1,[sc(1,1,`${e.name} 개인 근태관리 기록 보고서`,1)],30),
      rw(2,[sc(2,1,'세무 증빙 제출용 · 개인 월간 근태',2)]),
      rw(4,[sc(4,1,'사업장',3),sc(4,2,store,4),sc(4,4,'직원',3),sc(4,5,e.name,4),sc(4,7,'직급',3),sc(4,8,e.position,4)]),
      rw(5,[sc(5,1,'대상기간',3),sc(5,2,month,4)]),
      rw(7,[sc(7,1,'근무일',5),nc(7,2,workDays(aa),6),sc(7,3,'근무구간',5),nc(7,4,aa.filter(a=>a.clock_in).length,6),sc(7,5,'총 근무',5),sc(7,6,fm(aa.reduce((n,a)=>n+(a.work_minutes||0),0)),6),sc(7,7,'지각',5),nc(7,8,aa.filter(a=>a.late_minutes>0).length,6),sc(7,9,'조퇴',5),nc(7,10,aa.filter(a=>a.early_leave_minutes>0).length,6),sc(7,11,'연장',5),sc(7,12,fm(aa.reduce((n,a)=>n+(a.overtime_minutes||0),0)),6)]),
      rw(9,['날짜','요일','근무 구분','예정 근무','출근','퇴근','실근무','지각','조퇴','연장','비고'].map((v,i)=>sc(9,i+1,v,7)),24)
    ];
    r=10;
    for(const x of er){
      const a=x.attendance;
      const s=x.schedule||{};
      rows.push(rw(r,[
        sc(r,1,x.work_date,8),sc(r,2,wd(x.work_date),8),sc(r,3,a?sl(a):'기본 근무',8),
        sc(r,4,s.scheduled_start?`${String(s.scheduled_start).slice(0,5)}–${String(s.scheduled_end).slice(0,5)}`:'',8),
        sc(r,5,ft(a?.clock_in),8),sc(r,6,ft(a?.clock_out),8),sc(r,7,a?.clock_in?fm(a.work_minutes):'',8),
        sc(r,8,a?.late_minutes||'',8),sc(r,9,a?.early_leave_minutes||'',8),sc(r,10,a?.overtime_minutes||'',8),
        sc(r,11,!a?.clock_in?'미출근':a?.session_type==='extra'?'추가 근무':'',8)
      ]));
      r++;
    }
    rows.push(rw(r,[sc(r,1,'월 합계',10),sc(r,7,fm(aa.reduce((n,a)=>n+(a.work_minutes||0),0)),10),sc(r,8,String(aa.reduce((n,a)=>n+(a.late_minutes||0),0)),10),sc(r,9,String(aa.reduce((n,a)=>n+(a.early_leave_minutes||0),0)),10),sc(r,10,fm(aa.reduce((n,a)=>n+(a.overtime_minutes||0),0)),10)]));
    sheets.push(sheet(rows,['A1:K1',`A${r}:F${r}`],[11,6,12,16,10,10,10,7,7,8,10],9,`A1:K${r}`));
    areas.push(`$A$1:$K$${r}`);
    titles.push(9);
  }

  const wbs=names.map((n,i)=>`<sheet name="${esc(n)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('');
  const defs=names.map((n,i)=>`<definedName name="_xlnm.Print_Area" localSheetId="${i}">'${n.replaceAll("'","''")}'!${areas[i]}</definedName><definedName name="_xlnm.Print_Titles" localSheetId="${i}">'${n.replaceAll("'","''")}'!$${titles[i]}:$${titles[i]}</definedName>`).join('');
  const wb=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${wbs}</sheets><definedNames>${defs}</definedNames></workbook>`;
  const ct=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`;
  const rels=`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const wrels=`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const z:any={
    '[Content_Types].xml':strToU8(ct),
    '_rels/.rels':strToU8(rels),
    'xl/workbook.xml':strToU8(wb),
    'xl/_rels/workbook.xml.rels':strToU8(wrels),
    'xl/styles.xml':strToU8(styles),
  };
  sheets.forEach((x,i)=>z[`xl/worksheets/sheet${i+1}.xml`]=strToU8(x));
  return zipSync(z,{level:6});
}

const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
const hex=(a:ArrayBuffer)=>[...new Uint8Array(a)].map(x=>x.toString(16).padStart(2,'0')).join('');
const sha=(v:string)=>crypto.subtle.digest('SHA-256',new TextEncoder().encode(v)).then(hex);
async function admin(req:Request){
  const h=req.headers.get('authorization')||'';
  if(!h.startsWith('Bearer '))return null;
  const token_hash=await sha(h.slice(7).trim());
  const{data}=await db.from('app_sessions').select('role,expires_at').eq('token_hash',token_hash).eq('role','admin').gt('expires_at',new Date().toISOString()).maybeSingle();
  return data;
}
const js=(b:any,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...H,'Content-Type':'application/json; charset=utf-8'}});

Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:H});
  const u=new URL(req.url);
  if(u.searchParams.get('health')==='1')return js({ok:true,service:'attendance-report',version:2});
  if(req.method!=='GET')return js({error:'허용되지 않은 요청입니다.'},405);
  try{
    if(!await admin(req))return js({error:'관리자 로그인이 만료되었습니다. 다시 로그인해 주세요.'},401);
    const month=u.searchParams.get('month')||new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul'}).format(new Date()).slice(0,7);
    if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return js({error:'조회할 월 형식을 확인해 주세요.'},400);
    const[y,m]=month.split('-').map(Number);
    const lo=`${month}-01`;
    const d=new Date(Date.UTC(y,m,1));
    const hi=`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-01`;
    const[{data:set},{data:emps,error:e1},{data:sched,error:e2},{data:att,error:e3}]=await Promise.all([
      db.from('app_settings').select('value').eq('key','store_name').single(),
      db.from('employees').select('id,name,position,active').order('name'),
      db.from('schedules').select('employee_id,work_date,scheduled_start,scheduled_end').gte('work_date',lo).lt('work_date',hi).order('work_date'),
      db.from('attendance').select('employee_id,work_date,session_no,session_type,clock_in,clock_out,work_minutes,late_minutes,early_leave_minutes,overtime_minutes').gte('work_date',lo).lt('work_date',hi).order('work_date').order('session_no'),
    ]);
    if(e1||e2||e3)return js({error:'보고서 데이터를 불러오지 못했습니다.'},500);
    const store=set?.value||'근태관리 사업장';
    const bytes=build(store,month,emps||[],sched||[],att||[]);
    const name=`${store}_근태관리보고서_${month}.xlsx`;
    return new Response(bytes,{headers:{...H,'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(name)}`,'Cache-Control':'no-store'}});
  }catch(e){
    console.error(e);
    return js({error:'근태 보고서 생성 중 오류가 발생했습니다.'},500);
  }
});
