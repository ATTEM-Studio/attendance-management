import { createClient } from '@supabase/supabase-js';

const H={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
  'Content-Type':'application/json; charset=utf-8',
};
const db=createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  {auth:{persistSession:false,autoRefreshToken:false}}
);
const out=(body:any,status=200)=>new Response(JSON.stringify(body),{status,headers:H});
const hex=(a:ArrayBuffer)=>[...new Uint8Array(a)].map(x=>x.toString(16).padStart(2,'0')).join('');
const sha=(v:string)=>crypto.subtle.digest('SHA-256',new TextEncoder().encode(v)).then(hex);
const validDate=(v:string)=>/^\d{4}-\d{2}-\d{2}$/.test(v);
const categories=new Set(['attendance_issue','inventory_issue','personal_note','suggestion','general']);
const visibilities=new Set(['community','admin_only']);
const statuses=new Set(['open','reviewing','resolved']);
const text=(v:any,max=2000)=>String(v??'').trim().slice(0,max);

async function session(req:Request){
  const h=req.headers.get('authorization')||'';
  if(!h.startsWith('Bearer '))return null;
  const raw=h.slice(7).trim();
  const token_hash=await sha(raw);
  const {data,error}=await db.from('app_sessions')
    .select('token_hash,role,employee_id,expires_at')
    .eq('token_hash',token_hash)
    .gt('expires_at',new Date().toISOString())
    .maybeSingle();
  if(error||!data)return null;
  if(data.role==='staff'){
    const {data:e}=await db.from('employees').select('id,name,active').eq('id',data.employee_id).maybeSingle();
    if(!e?.active){
      await db.from('app_sessions').delete().eq('token_hash',token_hash);
      return null;
    }
  }
  await db.from('app_sessions').update({last_used_at:new Date().toISOString()}).eq('token_hash',token_hash);
  return data;
}

async function staffName(employeeId:string|null){
  if(!employeeId)return '관리자';
  const {data}=await db.from('employees').select('name').eq('id',employeeId).maybeSingle();
  return data?.name||'직원';
}

function postOut(p:any){
  return {
    id:p.id,
    authorEmployeeId:p.author_employee_id,
    authorName:p.author_name_snapshot,
    category:p.category,
    visibility:p.visibility,
    title:p.title,
    body:p.body,
    workDate:p.work_date,
    attendanceSnapshot:p.attendance_snapshot||{},
    status:p.status,
    resolvedAt:p.resolved_at,
    createdAt:p.created_at,
    updatedAt:p.updated_at,
  };
}
function commentOut(c:any){
  return {
    id:c.id,
    postId:c.post_id,
    authorType:c.author_type,
    authorEmployeeId:c.author_employee_id,
    authorName:c.author_name_snapshot,
    body:c.body,
    createdAt:c.created_at,
  };
}

async function canReadPost(s:any,post:any){
  if(s.role==='admin')return true;
  return post.visibility==='community'||post.author_employee_id===s.employee_id;
}

async function listCommunity(s:any){
  let query=db.from('community_posts').select('*').order('created_at',{ascending:false}).limit(150);
  if(s.role==='staff') query=query.or(`visibility.eq.community,author_employee_id.eq.${s.employee_id}`);
  const {data:posts,error}=await query;
  if(error)throw error;
  const ids=(posts||[]).map((p:any)=>p.id);
  let comments:any[]=[];
  if(ids.length){
    const result=await db.from('community_comments').select('*').in('post_id',ids).order('created_at',{ascending:true});
    if(result.error)throw result.error;
    comments=result.data||[];
  }
  return {
    posts:(posts||[]).map(postOut),
    comments:comments.map(commentOut),
    role:s.role,
    employeeId:s.employee_id||null,
  };
}

async function attendanceSnapshot(employeeId:string,workDate:string){
  const {data,error}=await db.from('attendance')
    .select('id,work_date,session_no,session_type,clock_in,clock_out,work_minutes')
    .eq('employee_id',employeeId)
    .eq('work_date',workDate)
    .order('session_no',{ascending:true});
  if(error)throw error;
  return {
    workDate,
    sessions:(data||[]).map((row:any)=>({
      attendanceId:row.id,
      sessionNo:Number(row.session_no||1),
      sessionType:row.session_type||'base',
      clockIn:row.clock_in,
      clockOut:row.clock_out,
      workMinutes:Number(row.work_minutes||0),
    })),
  };
}

async function createPost(s:any,b:any){
  const category=text(b.category,40);
  const visibility=text(b.visibility,30)||((category==='attendance_issue'||category==='personal_note')?'admin_only':'community');
  const title=text(b.title,120);
  const body=text(b.body,2000);
  const workDate=text(b.workDate,10);
  if(!categories.has(category))return out({error:'게시글 유형을 확인해 주세요.'},400);
  if(!visibilities.has(visibility))return out({error:'공개 범위를 확인해 주세요.'},400);
  if(!title||!body)return out({error:'제목과 내용을 입력해 주세요.'},400);
  if(category==='attendance_issue'&&s.role!=='staff')return out({error:'근태 확인 요청은 직원 계정에서 작성해 주세요.'},400);
  if(category==='attendance_issue'&&!validDate(workDate))return out({error:'확인할 근무 날짜를 선택해 주세요.'},400);

  const authorName=s.role==='admin'?'관리자':await staffName(s.employee_id);
  const snapshot=category==='attendance_issue'
    ? await attendanceSnapshot(s.employee_id,workDate)
    : {};

  const {data,error}=await db.from('community_posts').insert({
    author_employee_id:s.role==='staff'?s.employee_id:null,
    author_name_snapshot:authorName,
    category,
    visibility,
    title,
    body,
    work_date:category==='attendance_issue'?workDate:null,
    attendance_snapshot:snapshot,
    status:'open',
  }).select('*').single();
  if(error)throw error;
  return out({post:postOut(data)});
}

async function createComment(s:any,b:any){
  const postId=text(b.postId,80);
  const body=text(b.body,1500);
  if(!postId||!body)return out({error:'답글 내용을 입력해 주세요.'},400);
  const {data:post}=await db.from('community_posts').select('*').eq('id',postId).maybeSingle();
  if(!post||!(await canReadPost(s,post)))return out({error:'게시글을 찾을 수 없습니다.'},404);
  const authorName=s.role==='admin'?'관리자':await staffName(s.employee_id);
  const {data,error}=await db.from('community_comments').insert({
    post_id:postId,
    author_type:s.role,
    author_employee_id:s.role==='staff'?s.employee_id:null,
    author_name_snapshot:authorName,
    body,
  }).select('*').single();
  if(error)throw error;
  await db.from('community_posts').update({updated_at:new Date().toISOString()}).eq('id',postId);
  return out({comment:commentOut(data)});
}

async function updateStatus(s:any,b:any){
  if(s.role!=='admin')return out({error:'관리자만 처리 상태를 변경할 수 있습니다.'},403);
  const postId=text(b.postId,80);
  const status=text(b.status,30);
  if(!postId||!statuses.has(status))return out({error:'처리 상태를 확인해 주세요.'},400);
  const now=new Date().toISOString();
  const {data,error}=await db.from('community_posts').update({
    status,
    resolved_at:status==='resolved'?now:null,
    updated_at:now,
  }).eq('id',postId).select('*').maybeSingle();
  if(error)throw error;
  if(!data)return out({error:'게시글을 찾을 수 없습니다.'},404);
  return out({post:postOut(data)});
}

async function removePost(s:any,b:any){
  const postId=text(b.postId,80);
  if(!postId)return out({error:'삭제할 게시글을 확인해 주세요.'},400);
  const {data:post}=await db.from('community_posts').select('id,author_employee_id').eq('id',postId).maybeSingle();
  if(!post)return out({error:'게시글을 찾을 수 없습니다.'},404);
  if(s.role!=='admin'&&post.author_employee_id!==s.employee_id)return out({error:'본인이 작성한 글만 삭제할 수 있습니다.'},403);
  const {error}=await db.from('community_posts').delete().eq('id',postId);
  if(error)throw error;
  return out({ok:true});
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:H});
  if(req.method!=='POST')return out({error:'지원하지 않는 요청입니다.'},405);
  try{
    const s=await session(req);
    if(!s)return out({error:'로그인이 만료되었습니다. 다시 로그인해 주세요.'},401);
    const body=await req.json().catch(()=>({}));
    const action=text(body.action,40);
    if(action==='list')return out(await listCommunity(s));
    if(action==='create_post')return createPost(s,body);
    if(action==='create_comment')return createComment(s,body);
    if(action==='update_status')return updateStatus(s,body);
    if(action==='delete_post')return removePost(s,body);
    return out({error:'지원하지 않는 커뮤니티 동작입니다.'},400);
  }catch(error:any){
    console.error(error);
    return out({error:error?.message||'커뮤니티 처리 중 오류가 발생했습니다.'},500);
  }
});
