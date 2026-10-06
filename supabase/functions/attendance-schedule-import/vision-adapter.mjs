export const MAX_IMAGE_DATA_URL_CHARS = 12 * 1024 * 1024;

const ALLOWED_MIME = new Set(['image/png','image/jpeg','image/webp']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const cleanText = (value) => String(value ?? '').trim();
const clamp01 = (value) => Math.max(0, Math.min(1, Number.isFinite(Number(value)) ? Number(value) : 0));
const labelKey = (value) => cleanText(value).normalize('NFKC').replace(/\s+/g,'').toLowerCase();

export function validateImageRequest({imageDataUrl,mimeType}={}) {
  const mime=cleanText(mimeType).toLowerCase();
  const data=cleanText(imageDataUrl);
  if(!ALLOWED_MIME.has(mime)) return {ok:false,error:'지원하지 않는 이미지 형식입니다.'};
  if(!data.startsWith(`data:${mime};base64,`)) return {ok:false,error:'이미지 데이터 형식이 올바르지 않습니다.'};
  if(data.length>MAX_IMAGE_DATA_URL_CHARS) return {ok:false,error:'이미지 용량이 너무 큽니다.'};
  if(data.length<=(`data:${mime};base64,`).length) return {ok:false,error:'이미지 데이터가 비어 있습니다.'};
  return {ok:true};
}

function addWarning(warnings,message){
  if(message&&!warnings.includes(message)) warnings.push(message);
}

function normalizeVisionRow(raw,index,{targetMonth,effectiveDate},warnings){
  const row={
    sourceRowId:cleanText(raw?.sourceRowId || `vision-${index+1}`),
    employeeLabel:cleanText(raw?.employeeLabel),
    workDate:cleanText(raw?.workDate),
    scheduledStart:cleanText(raw?.scheduledStart).slice(0,5),
    scheduledEnd:cleanText(raw?.scheduledEnd).slice(0,5),
    shiftType:'other',
    confidence:clamp01(raw?.confidence),
    needsReview:raw?.needsReview===true,
    notes:Array.isArray(raw?.notes)?raw.notes.map(cleanText).filter(Boolean):[],
  };
  if(!row.employeeLabel){row.needsReview=true;row.notes.push('직원명 확인 필요');addWarning(warnings,`행 ${index+1}: 직원명을 확인해 주세요.`);}
  if(!DATE_RE.test(row.workDate)||!row.workDate.startsWith(`${targetMonth}-`)||row.workDate<effectiveDate){
    row.needsReview=true;row.notes.push('날짜 확인 필요');addWarning(warnings,`행 ${index+1}: 날짜가 적용 범위와 맞지 않습니다.`);
  }
  if(!TIME_RE.test(row.scheduledStart)||!TIME_RE.test(row.scheduledEnd)||row.scheduledStart>=row.scheduledEnd){
    row.needsReview=true;row.notes.push('시간 확인 필요');addWarning(warnings,`행 ${index+1}: 근무 시간을 확인해 주세요.`);
  }
  if(row.confidence<0.75){row.needsReview=true;row.notes.push('낮은 인식 신뢰도');addWarning(warnings,`행 ${index+1}: 이미지 인식 신뢰도가 낮습니다.`);}
  return row;
}

export function sanitizeVisionResult(raw={},context={}) {
  const targetMonth=cleanText(context.targetMonth);
  const effectiveDate=cleanText(context.effectiveDate);
  const warnings=Array.isArray(raw?.warnings)?raw.warnings.map(cleanText).filter(Boolean):[];
  const hasCompleteWeek=raw?.hasCompleteWeek===true;
  const hasTimeAxis=raw?.hasTimeAxis===true;
  if(!hasCompleteWeek) addWarning(warnings,'요일 전체 범위를 확인할 수 없어 삭제 판단을 하지 않습니다.');
  if(!hasTimeAxis) addWarning(warnings,'시간축 전체를 확인할 수 없어 삭제 판단을 하지 않습니다.');

  const rows=(Array.isArray(raw?.rows)?raw.rows:[]).map((row,index)=>normalizeVisionRow(row,index,{targetMonth,effectiveDate},warnings));
  const groups=new Map();
  rows.forEach((row,index)=>{
    if(!row.employeeLabel||!DATE_RE.test(row.workDate)||!TIME_RE.test(row.scheduledStart)||!TIME_RE.test(row.scheduledEnd)) return;
    const key=`${labelKey(row.employeeLabel)}|${row.workDate}`;
    if(!groups.has(key)) groups.set(key,[]);
    groups.get(key).push({row,index});
  });
  for(const items of groups.values()){
    items.sort((a,b)=>a.row.scheduledStart.localeCompare(b.row.scheduledStart));
    for(let i=1;i<items.length;i+=1){
      const previous=items[i-1];
      const current=items[i];
      if(current.row.scheduledStart<previous.row.scheduledEnd){
        previous.row.needsReview=true;
        current.row.needsReview=true;
        if(!previous.row.notes.includes('근무시간 겹침')) previous.row.notes.push('근무시간 겹침');
        if(!current.row.notes.includes('근무시간 겹침')) current.row.notes.push('근무시간 겹침');
        addWarning(warnings,`${current.row.workDate} ${current.row.employeeLabel}: 인식된 근무 시간이 겹칩니다.`);
      }
    }
  }

  const anyReview=rows.some((row)=>row.needsReview);
  const authoritative=raw?.authoritative===true&&hasCompleteWeek&&hasTimeAxis&&!anyReview;
  const confidence=clamp01(raw?.confidence);
  return {
    regions:[{id:'vision-1',sheetName:'이미지 근무표',range:'전체 이미지',score:Math.round(confidence*100),authoritative}],
    rows,
    authoritative,
    confidence,
    warnings,
    hasCompleteWeek,
    hasTimeAxis,
  };
}

const VISION_SCHEMA={
  type:'object',
  additionalProperties:false,
  required:['hasCompleteWeek','hasTimeAxis','authoritative','confidence','warnings','rows'],
  properties:{
    hasCompleteWeek:{type:'boolean'},
    hasTimeAxis:{type:'boolean'},
    authoritative:{type:'boolean'},
    confidence:{type:'number',minimum:0,maximum:1},
    warnings:{type:'array',items:{type:'string'}},
    rows:{
      type:'array',
      items:{
        type:'object',
        additionalProperties:false,
        required:['employeeLabel','workDate','scheduledStart','scheduledEnd','confidence','needsReview','notes'],
        properties:{
          employeeLabel:{type:'string'},
          workDate:{type:'string'},
          scheduledStart:{type:'string'},
          scheduledEnd:{type:'string'},
          confidence:{type:'number',minimum:0,maximum:1},
          needsReview:{type:'boolean'},
          notes:{type:'array',items:{type:'string'}},
        },
      },
    },
  },
};

function responseText(payload){
  if(typeof payload?.output_text==='string'&&payload.output_text.trim()) return payload.output_text;
  for(const item of payload?.output||[]){
    for(const part of item?.content||[]){
      if(part?.type==='output_text'&&typeof part.text==='string') return part.text;
    }
  }
  return '';
}

export async function analyzeScheduleImage({imageDataUrl,mimeType,targetMonth,effectiveDate,apiKey,model='gpt-6-luna',fetchImpl=fetch}={}){
  const checked=validateImageRequest({imageDataUrl,mimeType});
  if(!checked.ok) throw new Error(checked.error);
  if(!cleanText(apiKey)) throw new Error('이미지 분석 API 설정이 필요합니다.');
  if(!/^\d{4}-\d{2}$/.test(cleanText(targetMonth))) throw new Error('대상 월을 확인해 주세요.');
  if(!DATE_RE.test(cleanText(effectiveDate))) throw new Error('적용 시작일을 확인해 주세요.');

  const prompt=[
    '한국 매장의 직원 근무 시간표 이미지를 구조적으로 읽어 JSON으로 반환하세요.',
    `대상 월: ${targetMonth}. 변경 적용 시작일: ${effectiveDate}.`,
    '표 안의 글자뿐 아니라 요일 열, 왼쪽 시간축, 셀/색칠 블록의 시작과 끝 위치를 함께 사용하세요.',
    '월~일 반복 패턴이면 대상 월의 실제 날짜로 펼치되 적용 시작일 이전 날짜는 반환하지 마세요.',
    '직원명과 근무 시작/종료 시간을 보이는 그대로 읽고, 불명확한 값은 추측하지 말고 needsReview=true로 표시하세요.',
    '이미지가 잘렸거나 월~일 전체 헤더 또는 시간축이 보이지 않으면 authoritative=false로 하세요.',
    '잘려서 보이지 않는 요일/직원을 휴무로 해석하지 마세요. 누락 영역은 삭제 근거가 아닙니다.',
    '동일 직원이 같은 날 두 구간을 근무하면 두 행으로 분리하세요.',
    '시간은 24시간 HH:mm, 날짜는 YYYY-MM-DD 형식으로 반환하세요.',
  ].join('\n');

  const response=await fetchImpl('https://api.openai.com/v1/responses',{
    method:'POST',
    headers:{'Authorization':`Bearer ${apiKey}`,'Content-Type':'application/json'},
    body:JSON.stringify({
      model,
      input:[{role:'user',content:[
        {type:'input_text',text:prompt},
        {type:'input_image',image_url:imageDataUrl,detail:'high'},
      ]}],
      text:{format:{type:'json_schema',name:'schedule_import_analysis',strict:true,schema:VISION_SCHEMA}},
    }),
  });
  const payload=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(cleanText(payload?.error?.message)||'이미지 근무표 분석에 실패했습니다.');
  const output=responseText(payload);
  if(!output) throw new Error('이미지 분석 결과가 비어 있습니다.');
  let parsed;
  try{parsed=JSON.parse(output);}catch{throw new Error('이미지 분석 결과 형식을 확인하지 못했습니다.');}
  return sanitizeVisionResult(parsed,{targetMonth,effectiveDate});
}
