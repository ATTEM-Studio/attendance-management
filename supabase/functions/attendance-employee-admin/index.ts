import { createClient } from '@supabase/supabase-js'

const H={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, apikey, content-type',
  'Access-Control-Allow-Methods':'GET, POST, OPTIONS',
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
async function ph(pin:string,salt:string){
  const k=await crypto.subtle.importKey('raw',new TextEncoder().encode(pin),'PBKDF2',false,['deriveBits'])
  return hex(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:new TextEncoder().encode(salt),iterations:120000},k,256))
}
function rand(n=16){const a=new Uint8Array(n);crypto.getRandomValues(a);return [...a].map(x=>x.toString(16).padStart(2,'0')).join('')}

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
  if(s.includes('employee_not_found')) return '직원을 찾을 수 없습니다.'
  if(s.includes('employee_history_exists')) return '실제 근태 이력이 있는 직원은 삭제할 수 없습니다. 퇴사 처리를 사용해 주세요.'
  if(e?.code==='23505') return '같은 이름의 직원이 이미 있습니다.'
  console.error(e)
  return '직원 정보 처리 중 오류가 발생했습니다.'
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:H})
  const u=new URL(req.url)
  if(req.method==='GET'&&u.searchParams.get('health')==='1') return out({ok:true,service:'attendance-employee-admin',version:1})
  if(req.method!=='POST') return out({error:'허용되지 않은 요청입니다.'},405)
  try{
    if(!await adminSession(req)) return out({error:'관리자 로그인이 만료되었습니다. 다시 로그인해 주세요.'},401)
    const body=await req.json().catch(()=>({}))
    const action=String(body.action||'')
    const employeeId=String(body.employeeId||'')
    if(!employeeId) return out({error:'직원을 확인해 주세요.'},400)

    if(action==='update'){
      const name=String(body.name||'').trim()
      const position=String(body.position||'스태프').trim()||'스태프'
      const pin=body.pin===undefined?'':String(body.pin||'').trim()
      if(!name) return out({error:'이름을 입력해 주세요.'},400)
      if(pin&&!/^\d{4}$/.test(pin)) return out({error:'PIN은 4자리 숫자로 입력해 주세요.'},400)
      const {data:existing}=await db.from('employees').select('id').eq('id',employeeId).maybeSingle()
      if(!existing) return out({error:'직원을 찾을 수 없습니다.'},404)
      const patch:any={name,position}
      if(pin){const salt=rand();patch.pin_salt=salt;patch.pin_hash=await ph(pin,salt)}
      const {error}=await db.from('employees').update(patch).eq('id',employeeId)
      if(error) return out({error:msg(error)},400)
      await db.from('app_sessions').delete().eq('employee_id',employeeId)
      return out({ok:true})
    }

    if(action==='delete'){
      const {error}=await db.rpc('delete_employee_if_no_history',{p_employee_id:employeeId})
      return error?out({error:msg(error)},409):out({ok:true})
    }

    return out({error:'처리할 직원 동작을 확인해 주세요.'},400)
  }catch(e){return out({error:msg(e)},500)}
})
