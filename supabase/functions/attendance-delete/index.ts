import { createClient } from '@supabase/supabase-js'

const H={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
  'Content-Type':'application/json; charset=utf-8',
}
const db=createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  {auth:{persistSession:false,autoRefreshToken:false}},
)
const out=(body:any,status=200)=>new Response(JSON.stringify(body),{status,headers:H})
const hex=(a:ArrayBuffer)=>[...new Uint8Array(a)].map(x=>x.toString(16).padStart(2,'0')).join('')
const sha=(v:string)=>crypto.subtle.digest('SHA-256',new TextEncoder().encode(v)).then(hex)

async function adminSession(req:Request){
  const h=req.headers.get('authorization')||''
  if(!h.startsWith('Bearer ')) return null
  const raw=h.slice(7).trim()
  if(!raw) return null
  const token_hash=await sha(raw)
  const {data}=await db.from('app_sessions')
    .select('token_hash,role,expires_at')
    .eq('token_hash',token_hash)
    .eq('role','admin')
    .gt('expires_at',new Date().toISOString())
    .maybeSingle()
  if(!data) return null
  await db.from('app_sessions').update({last_used_at:new Date().toISOString()}).eq('token_hash',token_hash)
  return data
}

function msg(e:any){
  const s=String(e?.message||e||'')
  if(s.includes('attendance_not_found')) return '근태 기록을 찾을 수 없습니다.'
  if(s.includes('delete_reason_required')) return '삭제 사유를 2자 이상 입력해 주세요.'
  console.error(e)
  return '근태 기록 삭제 중 오류가 발생했습니다.'
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:H})
  if(req.method!=='POST') return out({error:'허용되지 않은 요청입니다.'},405)
  try{
    const s=await adminSession(req)
    if(!s) return out({error:'관리자 로그인이 만료되었습니다. 다시 로그인해 주세요.'},401)
    const body=await req.json().catch(()=>({}))
    const attendanceId=String(body.attendanceId||'')
    const reason=String(body.reason||'').trim()
    if(!attendanceId || reason.length<2) return out({error:'삭제 사유를 2자 이상 입력해 주세요.'},400)
    const {error}=await db.rpc('delete_attendance_with_audit',{
      p_attendance_id:attendanceId,
      p_deleted_by:'점장',
      p_reason:reason,
    })
    return error?out({error:msg(error)},400):out({ok:true})
  }catch(e){
    return out({error:msg(e)},500)
  }
})
