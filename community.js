
const COMMUNITY_BASE='https://ndczsguqlwyiuqvsmvcb.supabase.co/functions/v1/attendance-community';
api.communityList=(token)=>externalRequest(COMMUNITY_BASE,{method:'POST',token,body:{action:'list'}});
api.communityCreatePost=(token,payload)=>externalRequest(COMMUNITY_BASE,{method:'POST',token,body:Object.assign({action:'create_post'},payload)});
api.communityCreateComment=(token,postId,body)=>externalRequest(COMMUNITY_BASE,{method:'POST',token,body:{action:'create_comment',postId,body}});
api.communityUpdateStatus=(token,postId,status)=>externalRequest(COMMUNITY_BASE,{method:'POST',token,body:{action:'update_status',postId,status}});
api.communityDeletePost=(token,postId)=>externalRequest(COMMUNITY_BASE,{method:'POST',token,body:{action:'delete_post',postId}});

const COMMUNITY_CATEGORY={
  attendance_issue:{label:'근태 확인',tone:'blue'},
  inventory_issue:{label:'재고 이슈',tone:'orange'},
  personal_note:{label:'특이사항',tone:'purple'},
  suggestion:{label:'건의사항',tone:'green'},
  general:{label:'자유 글',tone:'gray'}
};
const COMMUNITY_STATUS={
  open:{label:'확인 전',tone:'open'},
  reviewing:{label:'확인 중',tone:'reviewing'},
  resolved:{label:'처리 완료',tone:'resolved'}
};
let communityCache=null;
let communityLoading=false;
let communityFilter='all';

function communityCategory(key){return COMMUNITY_CATEGORY[key]||COMMUNITY_CATEGORY.general;}
function communityStatus(key){return COMMUNITY_STATUS[key]||COMMUNITY_STATUS.open;}
function communityPosts(){return communityCache&&communityCache.posts||[];}
function communityComments(postId){return (communityCache&&communityCache.comments||[]).filter((row)=>row.postId===postId);}
function communityFmtCreated(value){
  if(!value)return '';
  try{return new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value));}
  catch{return '';}
}
async function communityLoad(force){
  if(communityLoading)return communityCache;
  if(communityCache&&!force)return communityCache;
  communityLoading=true;
  try{communityCache=await api.communityList(session.token);return communityCache;}
  finally{communityLoading=false;}
}
function communityInvalidate(){communityCache=null;}

function communityAttendanceDays(){
  if(session&&session.role!=='staff')return [];
  const rows=(state&&state.attendance||[]).filter((row)=>row.employeeId===session.employeeId&&row.clockIn).slice().sort((a,b)=>String(b.workDate).localeCompare(String(a.workDate))||Number(a.sessionNo||1)-Number(b.sessionNo||1));
  const grouped=new Map();
  rows.forEach((row)=>{if(!grouped.has(row.workDate))grouped.set(row.workDate,[]);grouped.get(row.workDate).push(row);});
  return Array.from(grouped.entries()).slice(0,8).map(([workDate,sessions])=>({workDate,sessions:sessions.sort((a,b)=>Number(a.sessionNo||1)-Number(b.sessionNo||1))}));
}
function communityAttendanceSummary(sessions){
  return sessions.map((row)=>(row.sessionType==='extra'?'추가 ':'기본 ')+fmtTime(row.clockIn)+'–'+fmtTime(row.clockOut)).join(' · ');
}
function communityAttendanceMarkup(){
  const rows=communityAttendanceDays();
  const body=rows.length?rows.map((item)=>{
    const minutes=item.sessions.reduce((sum,row)=>sum+Number(row.workMinutes||0),0);
    return '<article class="community-attendance-row"><div><b>'+esc(longDate(item.workDate))+'</b><span>'+esc(communityAttendanceSummary(item.sessions))+'</span><small>실제 기록 '+esc(formatMinutes(minutes))+'</small></div><button class="community-request-button" data-community-attendance="'+esc(item.workDate)+'">확인 요청</button></article>';
  }).join(''):'<div class="native-empty"><p>이번 달에 기록된 출퇴근 내역이 없습니다.</p></div>';
  return '<section class="community-attendance-check"><div class="section-heading"><div><span>내 실제 기록</span><h2>출퇴근 반영 확인</h2></div><small>'+rows.length+'일</small></div><p class="community-section-help">실제 출근·퇴근 시간을 확인하고 누락되거나 다른 내용이 있으면 해당 날짜에서 바로 관리자에게 요청하세요.</p><div class="community-attendance-list">'+body+'</div></section>';
}
function communityQuickMarkup(){
  const data=[
    ['inventory_issue','재고 이슈','부족·파손·발주 필요'],
    ['personal_note','특이사항','본인 상황을 관리자에게'],
    ['suggestion','건의사항','운영 개선 아이디어'],
    ['general','자유 글','직원들과 공유']
  ];
  return '<section class="community-quick-section"><div class="section-heading"><div><span>새 글</span><h2>빠르게 남기기</h2></div></div><div class="community-quick-grid">'+data.map((row)=>'<button data-community-compose="'+row[0]+'" class="community-quick-card is-'+communityCategory(row[0]).tone+'"><b>'+row[1]+'</b><small>'+row[2]+'</small></button>').join('')+'</div></section>';
}
function communityPostCard(post){
  const cat=communityCategory(post.category),stat=communityStatus(post.status);
  const privateBadge=post.visibility==='admin_only'?'<span class="community-private">관리자만</span>':'';
  return '<button class="community-post-card" data-community-post="'+esc(post.id)+'"><div class="community-post-card-top"><span class="community-category is-'+cat.tone+'">'+esc(cat.label)+'</span>'+privateBadge+'<span class="community-status is-'+stat.tone+'">'+esc(stat.label)+'</span></div><h3>'+esc(post.title)+'</h3><p>'+esc(post.body)+'</p><div class="community-post-meta"><span>'+esc(post.authorName)+' · '+esc(communityFmtCreated(post.createdAt))+'</span><span>답글 '+communityComments(post.id).length+'</span></div></button>';
}
function communityFeedMarkup(admin){
  let posts=communityPosts();
  if(admin&&communityFilter!=='all')posts=posts.filter((row)=>row.status===communityFilter);
  const filters=admin?'<div class="community-filter-row">'+[['all','전체'],['open','확인 전'],['reviewing','확인 중'],['resolved','완료']].map((row)=>'<button class="'+(communityFilter===row[0]?'is-active':'')+'" data-community-filter="'+row[0]+'">'+row[1]+'</button>').join('')+'</div>':'';
  const body=communityLoading&&!communityCache?'<div class="community-loading">불러오는 중입니다.</div>':posts.length?posts.map(communityPostCard).join(''):'<div class="native-empty"><p>아직 작성된 글이 없습니다.</p></div>';
  return '<section class="community-feed-section"><div class="section-heading"><div><span>'+(admin?'직원 소통':'매장 커뮤니티')+'</span><h2>'+(admin?'요청과 게시글':'최근 이야기')+'</h2></div><button class="community-refresh" id="communityRefresh">새로고침</button></div>'+filters+'<div class="community-feed">'+body+'</div></section>';
}
function communityStaffMarkup(){
  return '<main class="staff-screen community-screen native-canvas">'+topbar({title:'커뮤니티'})+'<section class="community-hero"><span>함께 확인하고 개선해요</span><h1>근태부터 매장 이야기까지</h1><p>근태 오류는 관리자에게 요청하고, 재고·특이사항·아이디어는 한곳에서 공유하세요.</p></section>'+communityAttendanceMarkup()+communityQuickMarkup()+communityFeedMarkup(false)+bottomTabs('community')+'</main>';
}
function communityAdminMetrics(){
  const posts=communityPosts();
  return {open:posts.filter((p)=>p.status==='open').length,reviewing:posts.filter((p)=>p.status==='reviewing').length,resolved:posts.filter((p)=>p.status==='resolved').length,attendance:posts.filter((p)=>p.category==='attendance_issue'&&p.status!=='resolved').length};
}
function communityAdminMarkup(){
  const m=communityAdminMetrics();
  return '<main class="admin-screen native-canvas community-admin-screen"><header class="admin-nav"><div><span>'+esc(displayStoreName())+'</span><b>관리자</b></div><button class="icon-button" id="adminLogout" aria-label="계정 메뉴">'+icon('more')+'</button></header>'+adminHomeTabsMarkup()+'<section class="admin-hero community-admin-hero"><span class="overline">직원 커뮤니티</span><h1>'+(m.open?'확인할 글 '+m.open+'건':'새로운 미확인 글이 없어요')+'</h1><p>근태 요청 '+m.attendance+'건 · 확인 중 '+m.reviewing+'건 · 완료 '+m.resolved+'건</p><div class="hero-metrics"><div><b>'+m.open+'</b><span>확인 전</span></div><div><b>'+m.reviewing+'</b><span>확인 중</span></div><div><b>'+m.resolved+'</b><span>처리 완료</span></div></div></section><div class="community-admin-actions"><button class="action-button secondary-action" id="adminCommunityCompose"><span>관리자 글 작성</span></button></div>'+communityFeedMarkup(true)+'</main>';
}
function renderStaffCommunity(){
  clearInterval(liveTimer);
  root.innerHTML=communityStaffMarkup();
  bindTabs();
  bindCommunityScreen(false);
  if(!communityCache&&!communityLoading)communityLoad(false).then(()=>{if(currentTab==='community'&&session.role==='staff')renderStaffCommunity();}).catch((e)=>toastMsg(e.message));
}
function renderAdminCommunity(){
  clearInterval(liveTimer);
  root.innerHTML=communityAdminMarkup();
  document.querySelector('#adminLogout')?.addEventListener('click',openLogoutSheet);
  document.querySelector('#adminOverviewTab')?.addEventListener('click',()=>setAdminHomeTab('overview'));
  document.querySelector('#adminAttendanceTab')?.addEventListener('click',()=>setAdminHomeTab('attendance'));
  document.querySelector('#adminCommunityTab')?.addEventListener('click',()=>setAdminHomeTab('community'));
  bindCommunityScreen(true);
  document.querySelector('#adminCommunityCompose')?.addEventListener('click',()=>openCommunityComposer({category:'general',admin:true}));
  if(!communityCache&&!communityLoading)communityLoad(false).then(()=>{if(adminHomeTab==='community'&&session.role==='admin')renderAdminCommunity();}).catch((e)=>toastMsg(e.message));
}
function bindCommunityScreen(admin){
  document.querySelector('#communityRefresh')?.addEventListener('click',()=>{communityInvalidate();admin?renderAdminCommunity():renderStaffCommunity();});
  document.querySelectorAll('[data-community-compose]').forEach((button)=>button.onclick=()=>openCommunityComposer({category:button.dataset.communityCompose}));
  document.querySelectorAll('[data-community-attendance]').forEach((button)=>button.onclick=()=>openCommunityComposer({category:'attendance_issue',workDate:button.dataset.communityAttendance}));
  document.querySelectorAll('[data-community-post]').forEach((button)=>button.onclick=()=>openCommunityDetail(button.dataset.communityPost,admin));
  document.querySelectorAll('[data-community-filter]').forEach((button)=>button.onclick=()=>{communityFilter=button.dataset.communityFilter||'all';renderAdminCommunity();});
}
function communityDefaultVisibility(category){return ['attendance_issue','personal_note'].includes(category)?'admin_only':'community';}
function communityAttendancePrefill(workDate){
  const item=communityAttendanceDays().find((row)=>row.workDate===workDate);
  return item?communityAttendanceSummary(item.sessions):'해당 날짜의 실제 근태 기록이 없습니다.';
}
function openCommunityComposer(options){
  options=options||{};
  const category=options.category||'general';
  const workDate=options.workDate||'';
  const admin=Boolean(options.admin);
  const fixed=category==='attendance_issue'&&workDate;
  const categoryOptions=Object.entries(COMMUNITY_CATEGORY).filter((row)=>admin?row[0]!=='attendance_issue':true).map((row)=>'<option value="'+row[0]+'" '+(row[0]===category?'selected':'')+'>'+esc(row[1].label)+'</option>').join('');
  const categoryField=fixed?'<div class="community-attendance-prefill"><span>'+esc(longDate(workDate))+'</span><b>'+esc(communityAttendancePrefill(workDate))+'</b></div>':'<label class="community-field"><span>유형</span><select id="communityCategory">'+categoryOptions+'</select></label>';
  const title=fixed?workDate.slice(5).replace('-','/')+' 출퇴근 기록 확인 요청':'';
  openSheet('<div class="sheet-heading"><div><span class="sheet-kicker">커뮤니티</span><h2>'+(fixed?'근태 확인 요청':'새 글 작성')+'</h2><p>'+(fixed?'실제 기록은 서버에서 다시 확인해 함께 전달합니다.':'재고, 특이사항, 건의사항을 한곳에 남겨주세요.')+'</p></div></div>'+categoryField+'<label class="community-field"><span>제목</span><input id="communityTitle" maxlength="120" value="'+esc(title)+'" placeholder="무엇을 확인하거나 공유할까요?"></label><label class="community-field"><span>내용</span><textarea id="communityBody" maxlength="2000" rows="6" placeholder="'+(fixed?'반영되지 않은 시간이나 확인이 필요한 내용을 적어주세요.':'상황을 구체적으로 적어주세요.')+'"></textarea></label><label class="community-field"><span>공개 범위</span><select id="communityVisibility"><option value="community" '+(communityDefaultVisibility(category)==='community'?'selected':'')+'>직원 전체와 공유</option><option value="admin_only" '+(communityDefaultVisibility(category)==='admin_only'?'selected':'')+'>관리자에게만</option></select><small>근태 및 개인 특이사항은 관리자에게만 공유하는 것을 권장합니다.</small></label><button class="action-button primary-action" id="communitySubmit"><span>'+(fixed?'확인 요청 보내기':'게시하기')+'</span></button>',{size:'compact community-compose-sheet'});
  const categoryInput=document.querySelector('#communityCategory');
  categoryInput?.addEventListener('change',()=>{const v=document.querySelector('#communityVisibility');if(v)v.value=communityDefaultVisibility(categoryInput.value);});
  document.querySelector('#communitySubmit').onclick=async()=>{
    const button=document.querySelector('#communitySubmit');
    const selected=fixed?'attendance_issue':categoryInput?.value||category;
    const payload={category:selected,visibility:document.querySelector('#communityVisibility')?.value||communityDefaultVisibility(selected),title:document.querySelector('#communityTitle')?.value?.trim()||'',body:document.querySelector('#communityBody')?.value?.trim()||'',workDate:fixed?workDate:''};
    if(!payload.title||!payload.body)return toastMsg('제목과 내용을 입력해 주세요.');
    setPending(button,true,'등록 중');
    try{
      await api.communityCreatePost(session.token,payload);
      communityInvalidate();
      dismissLayer(document.querySelector('.sheet-backdrop'));
      toastMsg(fixed?'관리자에게 확인 요청을 보냈습니다.':'커뮤니티에 글을 올렸습니다.');
      session.role==='admin'?renderAdminCommunity():renderStaffCommunity();
    }catch(e){toastMsg(e.message);}
    finally{if(button?.isConnected)setPending(button,false);}
  };
}
function communitySnapshotMarkup(post){
  if(post.category!=='attendance_issue')return '';
  const sessions=post.attendanceSnapshot&&post.attendanceSnapshot.sessions||[];
  const rows=sessions.length?sessions.map((row)=>'<div class="community-snapshot-row"><span>'+(row.sessionType==='extra'?'추가 근무':'기본 근무')+'</span><b>'+esc(fmtTime(row.clockIn))+'–'+esc(fmtTime(row.clockOut))+'</b><small>'+esc(formatMinutes(row.workMinutes||0))+'</small></div>').join(''):'<div class="community-snapshot-empty">서버에 기록된 출퇴근 구간이 없습니다.</div>';
  return '<section class="community-snapshot"><div class="community-detail-section-title"><span>요청 당시 실제 근태</span><b>'+esc(post.workDate||'')+'</b></div>'+rows+'</section>';
}
function communityCommentsMarkup(postId){
  const rows=communityComments(postId);
  return '<section class="community-comments"><div class="community-detail-section-title"><span>답글</span><b>'+rows.length+'개</b></div>'+(rows.length?rows.map((row)=>'<article class="community-comment '+(row.authorType==='admin'?'is-admin':'')+'"><div><b>'+esc(row.authorName)+'</b><span>'+esc(communityFmtCreated(row.createdAt))+'</span></div><p>'+esc(row.body)+'</p></article>').join(''):'<div class="community-comments-empty">아직 답글이 없습니다.</div>')+'</section>';
}
function openCommunityDetail(postId,admin){
  const post=communityPosts().find((row)=>row.id===postId);
  if(!post)return toastMsg('게시글을 찾지 못했습니다.');
  const cat=communityCategory(post.category),stat=communityStatus(post.status);
  const canDelete=admin||post.authorEmployeeId===session.employeeId;
  const adminActions=admin?'<div class="community-admin-status-actions"><button data-community-status="open" class="action-button secondary-action"><span>확인 전</span></button><button data-community-status="reviewing" class="action-button secondary-action"><span>확인 중</span></button><button data-community-status="resolved" class="action-button completed-action"><span>처리 완료</span></button></div>':'';
  openSheet('<div class="sheet-heading"><div><span class="sheet-kicker">'+esc(cat.label)+'</span><h2>'+esc(post.title)+'</h2><p>'+esc(post.authorName)+' · '+esc(communityFmtCreated(post.createdAt))+'</p></div></div><div class="community-detail-badges">'+(post.visibility==='admin_only'?'<span class="community-private">관리자만</span>':'')+'<span class="community-status is-'+stat.tone+'">'+esc(stat.label)+'</span></div><div class="community-detail-body">'+esc(post.body).replaceAll('\n','<br>')+'</div>'+communitySnapshotMarkup(post)+communityCommentsMarkup(post.id)+'<label class="community-field"><span>답글 남기기</span><textarea id="communityCommentBody" rows="3" maxlength="1500" placeholder="'+(admin?'처리 내용이나 답변을 남겨주세요.':'추가로 전달할 내용을 남겨주세요.')+'"></textarea></label><button class="action-button primary-action" id="communityCommentSubmit"><span>답글 등록</span></button>'+adminActions+(canDelete?'<button class="text-action destructive-text" id="communityDeletePost">게시글 삭제</button>':''),{size:'compact community-detail-sheet'});
  document.querySelector('#communityCommentSubmit').onclick=async()=>{
    const body=document.querySelector('#communityCommentBody')?.value?.trim()||'';
    if(!body)return toastMsg('답글 내용을 입력해 주세요.');
    const button=document.querySelector('#communityCommentSubmit');setPending(button,true,'등록 중');
    try{await api.communityCreateComment(session.token,post.id,body);communityInvalidate();communityCache=await api.communityList(session.token);dismissLayer(document.querySelector('.sheet-backdrop'));openCommunityDetail(post.id,admin);toastMsg('답글을 등록했습니다.');}
    catch(e){toastMsg(e.message);}finally{if(button?.isConnected)setPending(button,false);}
  };
  document.querySelectorAll('[data-community-status]').forEach((button)=>button.onclick=async()=>{try{await api.communityUpdateStatus(session.token,post.id,button.dataset.communityStatus);communityInvalidate();dismissLayer(document.querySelector('.sheet-backdrop'));renderAdminCommunity();toastMsg('처리 상태를 변경했습니다.');}catch(e){toastMsg(e.message);}});
  document.querySelector('#communityDeletePost')?.addEventListener('click',async()=>{if(!confirm('이 게시글을 삭제할까요?'))return;try{await api.communityDeletePost(session.token,post.id);communityInvalidate();dismissLayer(document.querySelector('.sheet-backdrop'));admin?renderAdminCommunity():renderStaffCommunity();toastMsg('게시글을 삭제했습니다.');}catch(e){toastMsg(e.message);}});
}

bottomTabs=function(on){
  return '<nav class="ios-tabbar glass-surface community-tabbar" aria-label="직원 메뉴"><button class="tab-item '+(on==='today'?'is-active':'')+'" id="tabToday">'+icon('home')+'<span>오늘</span></button><button class="tab-item '+(on==='records'?'is-active':'')+'" id="tabRecords">'+icon('calendar')+'<span>근무기록</span></button><button class="tab-item '+(on==='community'?'is-active':'')+'" id="tabCommunity">'+icon('people')+'<span>커뮤니티</span></button></nav>';
};
bindTabs=function(){
  document.querySelector('#logoutBtn')?.addEventListener('click',openLogoutSheet);
  document.querySelector('#tabToday')?.addEventListener('click',async()=>{currentTab='today';if(month!==currentMonth())await load(currentMonth());renderToday();});
  document.querySelector('#tabRecords')?.addEventListener('click',()=>{currentTab='records';renderRecords();});
  document.querySelector('#tabCommunity')?.addEventListener('click',()=>{currentTab='community';renderStaffCommunity();});
};
renderStaff=function(){
  if(currentTab==='community')return renderStaffCommunity();
  return currentTab==='records'?renderRecords():renderToday();
};

adminHomeTabsMarkup=function(){
  return '<nav class="admin-home-tabs community-admin-tabs" aria-label="관리자 화면"><button id="adminOverviewTab" class="admin-home-tab '+(adminHomeTab==='overview'?'is-active':'')+'">현황</button><button id="adminAttendanceTab" class="admin-home-tab '+(adminHomeTab==='attendance'?'is-active':'')+'">오늘 출퇴근</button><button id="adminCommunityTab" class="admin-home-tab '+(adminHomeTab==='community'?'is-active':'')+'">커뮤니티</button></nav>';
};
setAdminHomeTab=function(tab){adminHomeTab=['attendance','community'].includes(tab)?tab:'overview';renderAdmin();};
const communityBaseRenderAdmin=renderAdmin;
renderAdmin=function(){
  if(adminHomeTab==='community')return renderAdminCommunity();
  communityBaseRenderAdmin();
  document.querySelector('#adminCommunityTab')?.addEventListener('click',()=>setAdminHomeTab('community'));
};
const communityBaseCloseInternalViewForBack=closeInternalViewForBack;
closeInternalViewForBack=function(){
  if(session?.role==='staff'&&currentTab==='community'){currentTab='today';if(month!==currentMonth())load(currentMonth()).then(renderToday).catch((e)=>toastMsg(e.message));else renderToday();return true;}
  return communityBaseCloseInternalViewForBack();
};
