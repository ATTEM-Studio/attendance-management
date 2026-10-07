import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const adapterUrl=new URL('../supabase/functions/attendance-schedule-import/vision-adapter.mjs',import.meta.url);
async function adapter(){assert.equal(existsSync(adapterUrl),true,'vision-adapter.mjs must exist');return import(`${adapterUrl.href}?t=${Date.now()}-${Math.random()}`);}

test('image request validation rejects unsupported and oversized images before model work',async()=>{
  const {validateImageRequest,MAX_IMAGE_DATA_URL_CHARS}=await adapter();
  assert.equal(validateImageRequest({mimeType:'application/pdf',imageDataUrl:'data:application/pdf;base64,AA=='}).ok,false);
  assert.equal(validateImageRequest({mimeType:'image/png',imageDataUrl:`data:image/png;base64,${'A'.repeat(MAX_IMAGE_DATA_URL_CHARS+1)}`}).ok,false);
  assert.equal(validateImageRequest({mimeType:'image/webp',imageDataUrl:'data:image/webp;base64,AAAA'}).ok,true);
});

test('complete week and intact time axis can be authoritative',async()=>{
  const {sanitizeVisionResult}=await adapter();
  const result=sanitizeVisionResult({
    hasCompleteWeek:true,hasTimeAxis:true,authoritative:true,confidence:.97,warnings:[],
    rows:[{employeeLabel:'세영',workDate:'2026-10-19',scheduledStart:'08:00',scheduledEnd:'12:00',confidence:.98,needsReview:false,notes:[]}],
  },{targetMonth:'2026-10',effectiveDate:'2026-10-15'});
  assert.equal(result.authoritative,true);
  assert.equal(result.rows[0].needsReview,false);
  assert.equal(result.rows[0].scheduledStart,'08:00');
});

test('cropped week or missing time axis is always non-authoritative',async()=>{
  const {sanitizeVisionResult}=await adapter();
  for(const raw of [
    {hasCompleteWeek:false,hasTimeAxis:true,authoritative:true,confidence:.9,warnings:[],rows:[]},
    {hasCompleteWeek:true,hasTimeAxis:false,authoritative:true,confidence:.9,warnings:[],rows:[]},
  ]){
    const result=sanitizeVisionResult(raw,{targetMonth:'2026-10',effectiveDate:'2026-10-15'});
    assert.equal(result.authoritative,false);
    assert.ok(result.warnings.length>0);
  }
});

test('invalid and overlapping model rows are marked needs review instead of trusted',async()=>{
  const {sanitizeVisionResult}=await adapter();
  const result=sanitizeVisionResult({
    hasCompleteWeek:true,hasTimeAxis:true,authoritative:true,confidence:.9,warnings:[],
    rows:[
      {employeeLabel:'김송이',workDate:'2026-10-20',scheduledStart:'09:00',scheduledEnd:'14:00',confidence:.9,needsReview:false,notes:[]},
      {employeeLabel:'김송이',workDate:'2026-10-20',scheduledStart:'13:00',scheduledEnd:'18:00',confidence:.9,needsReview:false,notes:[]},
      {employeeLabel:'세영',workDate:'2026-10-21',scheduledStart:'25:00',scheduledEnd:'18:00',confidence:.8,needsReview:false,notes:[]},
    ],
  },{targetMonth:'2026-10',effectiveDate:'2026-10-15'});
  assert.equal(result.authoritative,false);
  assert.equal(result.rows.every((row)=>row.needsReview===true),true);
  assert.ok(result.warnings.some((warning)=>/겹|시간/.test(warning)));
});

test('Responses API request uses image input and strict structured output',async()=>{
  const {analyzeScheduleImage}=await adapter();
  let request=null;
  const fetchImpl=async(url,options)=>{
    request={url,options,body:JSON.parse(options.body)};
    return {ok:true,json:async()=>({output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({hasCompleteWeek:true,hasTimeAxis:true,authoritative:true,confidence:.95,warnings:[],rows:[]})}]}]})};
  };
  const result=await analyzeScheduleImage({
    imageDataUrl:'data:image/png;base64,AAAA',mimeType:'image/png',targetMonth:'2026-10',effectiveDate:'2026-10-15',apiKey:'test-key',model:'gpt-6-luna',fetchImpl,
  });
  assert.equal(request.url,'https://api.openai.com/v1/responses');
  assert.equal(request.body.model,'gpt-6-luna');
  assert.equal(request.body.input[0].content.some((item)=>item.type==='input_image'),true);
  assert.equal(request.body.text.format.type,'json_schema');
  assert.equal(request.body.text.format.strict,true);
  assert.equal(result.authoritative,true);
});
