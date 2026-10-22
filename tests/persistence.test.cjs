const assert=require('node:assert/strict');
const {FolioPersistence}=require('../persistence.js');
const clone=value=>structuredClone(value);
class MemoryStorage{
  constructor(){this.values=new Map();this.writes=0;}
  get length(){return this.values.size;}
  key(i){return [...this.values.keys()][i];}
  getItem(k){return this.values.get(k)??null;}
  setItem(k,v){this.writes++;this.values.set(k,v);}
  removeItem(k){this.values.delete(k);}
}
global.window={addEventListener(){}};global.document={addEventListener(){}};
function workspace(name='Shashi'){return {version:1,activeId:'one',profiles:[{id:'one',profile:{name},notes:'Notes',history:[],template:'modern',paper:'a4',target:{}}]};}
function backend(){
  const state={workspace:null,revision:null,offline:false,counter:0,storage:{directory:'/local/Resume_Maker/data'}};
  global.fetch=async(_url,options={})=>{
    if(state.offline)throw new Error('Server unavailable');
    if(options.method==='POST'){
      const input=JSON.parse(options.body);
      if(input.baseRevision!==state.revision)return {status:409,ok:false,json:async()=>clone(state)};
      state.workspace=input.workspace;state.revision=String(++state.counter);
      return {status:200,ok:true,json:async()=>({revision:state.revision,folderCopy:true})};
    }
    return {ok:true,json:async()=>clone(state)};
  };return state;
}
const active=[];
function manager(){const statuses=[];const m=new FolioPersistence({normalize:clone,onStatus:s=>statuses.push(s),onRecovered:()=>{},notify:()=>{}});m.statuses=statuses;active.push(m);return m;}
async function idle(m){while(m.running)await new Promise(resolve=>setImmediate(resolve));}
async function run(name,fn){global.localStorage=new MemoryStorage();try{await fn();console.log('PASS',name);}finally{for(const m of active.splice(0)){clearInterval(m.retry);clearTimeout(m.timer);}}}
(async()=>{
  await run('new edits save directly to folder without any browser writes',async()=>{
    const disk=backend();const m=manager();await m.start();m.save(workspace());await idle(m);
    assert.deepEqual(disk.workspace,workspace());assert.equal(localStorage.writes,0);
    assert.equal(m.statuses.at(-1).text,'Saved to local folder');assert.equal(m.location,disk.storage.directory);
  });
  await run('folder data restores in a different browser with empty storage',async()=>{
    backend();const m=manager();await m.start();m.save(workspace('On disk'));await idle(m);
    global.localStorage=new MemoryStorage();assert.deepEqual(await manager().start(),workspace('On disk'));
  });
  await run('legacy browser data migrates only after disk acknowledgement',async()=>{
    const disk=backend();localStorage.setItem('folio.workspace.v1',JSON.stringify(workspace()));localStorage.writes=0;
    const m=manager();assert.deepEqual(await m.start(),workspace());
    assert.deepEqual(disk.workspace,workspace());assert.equal(localStorage.getItem('folio.workspace.v1'),null);assert.equal(localStorage.writes,0);
  });
  await run('startup fails clearly when local directory is unavailable',async()=>{
    const disk=backend();disk.offline=true;localStorage.setItem('folio.workspace.v1',JSON.stringify(workspace()));
    await assert.rejects(manager().start(),/Server unavailable/);
    assert.ok(localStorage.getItem('folio.workspace.v1'));
  });
  await run('disk failure stays unsaved and retries without browser fallback',async()=>{
    const disk=backend();const m=manager();await m.start();disk.offline=true;m.save(workspace('Retry me'));await idle(m);
    assert.equal(m.statuses.at(-1).unsafe,true);assert.equal(m.statuses.at(-1).text,'Not saved to folder · reconnect');
    assert.equal(localStorage.writes,0);disk.offline=false;await m.flush();assert.deepEqual(disk.workspace,workspace('Retry me'));
  });
  await run('in-flight newer edits receive a subsequent folder save',async()=>{
    const disk=backend();const m=manager();await m.start();const original=fetch;let release;
    global.fetch=(url,options)=>new Promise(resolve=>{release=async()=>resolve(await original(url,options));});
    m.save(workspace('First'));m.save(workspace('Latest'));await release();await idle(m);assert.equal(m.pending,true);
    global.fetch=original;await m.flush();assert.equal(disk.workspace.profiles[0].profile.name,'Latest');assert.equal(m.pending,false);
  });
  await run('stale sessions preserve both profiles with revision checks',async()=>{
    const disk=backend();disk.workspace=workspace('Original');disk.revision='1';disk.counter=1;
    const first=manager();const second=manager();await first.start();await second.start();
    first.save(workspace('First tab'));await idle(first);second.save(workspace('Other tab'));await idle(second);await second.flush();
    assert.deepEqual(disk.workspace.profiles.map(p=>p.profile.name).sort(),['First tab','Other tab']);
  });
})().catch(error=>{console.error(error);process.exitCode=1;});
