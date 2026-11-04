import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source=await readFile(new URL('../community.js',import.meta.url),'utf8');
const build=await readFile(new URL('../build.mjs',import.meta.url),'utf8');

test('community script loads before boot without requiring closeInternalViewForBack',()=>{
  let loadHandler=null;
  const context={
    api:{},
    externalRequest(){},
    bottomTabs(){return 'legacy-tabs';},
    bindTabs(){},
    renderStaff(){},
    adminHomeTabsMarkup(){return 'legacy-admin-tabs';},
    setAdminHomeTab(){},
    renderAdmin(){},
    adminHomeTab:'overview',
    currentTab:'today',
    session:{role:'staff',employeeId:'e1',token:'token'},
    month:'2026-11',
    state:{attendance:[]},
    window:{
      addEventListener(name,handler){if(name==='load')loadHandler=handler;}
    },
    document:{querySelector(){return null;},querySelectorAll(){return [];}},
    icon(name){return '<i>'+name+'</i>';},
    currentMonth(){return '2026-11';},
    load:async()=>{},
    renderToday(){},
    renderRecords(){},
    toastMsg(){},
  };
  vm.createContext(context);
  assert.doesNotThrow(()=>vm.runInContext(source,context));
  assert.equal(context.window.__attendanceCommunityLoaded,true);
  assert.match(context.bottomTabs('community'),/id="tabCommunity"/);
  assert.match(context.adminHomeTabsMarkup(),/id="adminCommunityTab"/);
  assert.equal(typeof loadHandler,'function');

  let baseCalls=0;
  context.closeInternalViewForBack=()=>{baseCalls++;return false;};
  loadHandler();
  assert.equal(context.window.__communityBackHandlerInstalled,true);
  context.currentTab='today';
  assert.equal(context.closeInternalViewForBack(),false);
  assert.equal(baseCalls,1);
});

test('build ships community before boot and refreshes PWA cache',()=>{
  assert.match(build,/community\.js/);
  assert.match(build,/styles-community\.css/);
  assert.match(build,/attendance-management-v28-hardening-v5/);
  const communityInsert=build.indexOf("if (!index.includes('/community.js'))");
  const writeIndex=build.indexOf("await writeOut('index.html', index)");
  assert.ok(communityInsert>=0&&writeIndex>communityInsert);
});
