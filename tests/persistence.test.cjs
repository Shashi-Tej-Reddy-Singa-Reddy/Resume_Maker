const assert = require('node:assert/strict');
const { FolioPersistence } = require('../persistence.js');
const clone = value => structuredClone(value);
class MemoryStorage {
  constructor(){this.values=new Map();this.fail=false;}
  get length(){return this.values.size;}
  key(index){return [...this.values.keys()][index];}
  getItem(key){return this.values.get(key) ?? null;}
  setItem(key,value){if(this.fail)throw new Error('Quota exceeded');this.values.set(key,value);}
  removeItem(key){this.values.delete(key);}
}
global.window={addEventListener(){}};
global.document={addEventListener(){}};
function workspace(name='Shashi') {
  return {version:1,activeId:'one',profiles:[{id:'one',profile:{name,summary:'Draft'},notes:'Unfinished notes',history:[{id:'history-one'}],template:'modern',paper:'a4',target:{role:'ai'}}]};
}
function backend() {
  const state={workspace:null,revision:null,offline:false,counter:0};
  global.fetch=async (_url,options={})=>{
    if(state.offline)throw new Error('Server stopped');
    if(options.method==='POST'){
      const input=JSON.parse(options.body);
      if(input.baseRevision!==state.revision)return {status:409,ok:false,json:async()=>clone(state)};
      state.workspace=input.workspace;state.revision=String(++state.counter);
      return {ok:true,status:200,json:async()=>({revision:state.revision})};
    }
    return {ok:true,status:200,json:async()=>clone(state)};
  };
  return state;
}
const active=[];
function manager(){
  const statuses=[];let recovered;
  const instance=new FolioPersistence({normalize:clone,onStatus:s=>statuses.push(s),onRecovered:w=>{recovered=w;},notify:()=>{}});
  instance.statuses=statuses;instance.recovery=()=>recovered;active.push(instance);return instance;
}
function stop(instance){clearTimeout(instance.timer);clearInterval(instance.retry);instance.timer=null;}
async function run(name,callback){
  global.localStorage=new MemoryStorage();
  try{await callback();console.log('PASS',name);}
  finally{active.splice(0).forEach(stop);}
}
(async()=>{
  await run('migrates existing browser profiles and restores disk after browser clear',async()=>{
    const disk=backend();localStorage.setItem('folio.workspace.v1',JSON.stringify(workspace()));
    const first=manager();assert.deepEqual(await first.start(),workspace());await first.flush();stop(first);
    assert.deepEqual(disk.workspace,workspace());localStorage.values.clear();
    const next=manager();assert.deepEqual(await next.start(),workspace());
  });
  await run('edits are cached immediately and recovered after a break before server save',async()=>{
    backend();const first=manager();await first.start();first.save(workspace('Interrupted'));
    assert.equal(JSON.parse(localStorage.getItem(first.outbox)).workspace.profiles[0].profile.name,'Interrupted');stop(first);
    const next=manager();assert.equal((await next.start()).profiles[0].profile.name,'Interrupted');await next.flush();
    assert.equal(next.pending,false);
  });
  await run('edits made while a request is in flight receive a second disk save',async()=>{
    const disk=backend();const first=manager();await first.start();first.save(workspace('First'));
    const original=global.fetch;let release;
    global.fetch=(url,options)=>new Promise(resolve=>{release=async()=>resolve(await original(url,options));});
    const inFlight=first.flush();first.save(workspace('Latest'));await release();await inFlight;
    assert.equal(first.pending,true);global.fetch=original;await first.flush();
    assert.equal(disk.workspace.profiles[0].profile.name,'Latest');assert.equal(first.pending,false);
  });
  await run('server outage preserves edits across reload and retries when available',async()=>{
    const disk=backend();const first=manager();await first.start();disk.offline=true;first.save(workspace('Offline'));
    await first.flush();assert.equal(first.pending,true);stop(first);
    const next=manager();assert.equal((await next.start()).profiles[0].profile.name,'Offline');disk.offline=false;
    await next.flush();assert.equal(disk.workspace.profiles[0].profile.name,'Offline');
  });
  await run('stale sessions preserve both versions instead of replacing newer data',async()=>{
    const disk=backend();disk.workspace=workspace('Original');disk.revision='1';disk.counter=1;
    const first=manager();const stale=manager();await first.start();await stale.start();
    first.save(workspace('Newer'));await first.flush();stale.save(workspace('Other tab'));await stale.flush();await stale.flush();
    assert.deepEqual(disk.workspace.profiles.map(p=>p.profile.name).sort(),['Newer','Other tab']);assert.ok(stale.recovery());
  });
  await run('browser storage failure still allows confirmed disk persistence',async()=>{
    const disk=backend();const first=manager();await first.start();localStorage.fail=true;first.save(workspace());
    assert.equal(first.statuses.at(-1).unsafe,true);await first.flush();
    assert.equal(first.statuses.at(-1).text,'Saved to disk');assert.deepEqual(disk.workspace,workspace());
  });
  await run('different object key order does not duplicate unchanged profiles',async()=>{
    backend();const first=manager();await first.start();const left=workspace();const right=workspace();
    right.profiles[0]={profile:right.profiles[0].profile,...right.profiles[0]};
    assert.equal(first.merge(left,right).profiles.length,1);
  });
  await run('a confirmed save does not erase a live tab’s newer pending edits',async()=>{
    backend();const record={workspace:workspace(),revision:null,dirty:true};const key='folio.pending.other-tab';
    localStorage.setItem(key,JSON.stringify(record));const first=manager();await first.start();
    const newer={...record,workspace:workspace('New pending text')};localStorage.setItem(key,JSON.stringify(newer));
    await first.flush();assert.deepEqual(JSON.parse(localStorage.getItem(key)),newer);
  });
})().catch(error=>{console.error(error);process.exitCode=1;});
