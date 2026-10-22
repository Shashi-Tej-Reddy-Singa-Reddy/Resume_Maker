'use strict';

// The local server is the source of truth. Browser storage is read only to migrate
// older versions; new resume data is never written to localStorage.
class FolioPersistence {
  constructor({normalize, onStatus, onRecovered, notify}) {
    Object.assign(this,{normalize,onStatus,onRecovered,notify});
    this.revision=null;this.generation=0;this.pending=false;this.diskOK=false;
    this.running=false;this.timer=null;this.sources=[];this.location='data/';
  }
  document(value) {
    return JSON.parse(JSON.stringify({version:1,activeId:value.activeId || null,profiles:value.profiles}));
  }
  same(left,right) {
    const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
    return JSON.stringify(canonical(left))===JSON.stringify(canonical(right));
  }
  report() {
    this.onStatus({unsafe:this.pending,pending:this.pending,error:!this.diskOK,
      text:!this.diskOK?'Not saved to folder · reconnect':this.pending?'Saving to local folder…':'Saved to local folder',
      directory:this.location});
  }
  merge(remote,local) {
    const merged=this.document(remote);
    for(const entry of local.profiles){
      const existing=merged.profiles.find(p=>p.id===entry.id);
      if(existing&&this.same(existing,entry))continue;
      const recovered=JSON.parse(JSON.stringify(entry));
      if(existing)recovered.id=crypto.randomUUID();
      merged.profiles.push(recovered);
      if(local.activeId===entry.id)merged.activeId=recovered.id;
    }
    if(!merged.profiles.some(p=>p.id===merged.activeId))merged.activeId=merged.profiles[0]?.id || null;
    return merged;
  }
  async start() {
    const response=await fetch('/api/workspace',{cache:'no-store',signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw new Error('Local directory storage is unavailable. Restart the server and retry.');
    const state=await response.json();
    this.latest=state.workspace?this.normalize(state.workspace):{version:1,activeId:null,profiles:[]};
    this.revision=state.revision;this.diskOK=true;
    this.location=state.storage?.directory || 'data/';
    let recovered=false;
    const candidates=[];
    // Migration only: preserve existing data from the former browser-based app.
    try {
      const raw=localStorage.getItem('folio.persistence.v2');
      if(raw){
        try {
          const record=JSON.parse(raw);
          if(record.dirty||state.workspace===null)candidates.push({key:'folio.persistence.v2',raw,...record});
        }catch(_){this.notify('Old browser data could not be imported. Your folder data is available; the old browser copy was preserved.');}
      }else if(state.workspace===null){
        const legacy=localStorage.getItem('folio.workspace.v1');
        if(legacy)candidates.push({key:'folio.workspace.v1',raw:legacy,workspace:JSON.parse(legacy),revision:null});
      }
      for(let i=0;i<localStorage.length;i++){
        const key=localStorage.key(i);
        if(!key?.startsWith('folio.pending.'))continue;
        try {
          const raw=localStorage.getItem(key);const record=JSON.parse(raw);
          if(record.dirty)candidates.push({key,raw,...record});
        }catch(_){/* Preserve unreadable old copies. */}
      }
    }catch(_){/* Folder storage works even when browser storage is disabled. */}
    for(const record of candidates){
      try {
        const local=this.normalize(record.workspace);
        if(!this.same(this.latest,local)){
          this.latest=record.revision===state.revision&&!recovered?this.document(local):this.merge(this.latest,local);
          recovered=true;
        }
        this.sources.push({key:record.key,raw:record.raw});this.pending=true;
      }catch(_){this.notify('An old browser copy could not be imported and was preserved.');}
    }
    if(state.recovered)this.notify('Your folder data was restored from an earlier disk snapshot.');
    if(this.pending){
      for(let attempt=0;attempt<4&&this.pending;attempt++){
        await this.flush();
        if(!this.diskOK)break;
      }
      if(this.pending)throw new Error('Browser data has not yet been saved to the local directory. Keep this page open, restart the server, and retry.');
      this.notify('Existing browser data was moved to the local directory.');
    }
    this.report();
    this.retry=setInterval(()=>{if(this.pending)this.schedule(0);},3000);
    window.addEventListener('online',()=>this.schedule(0));
    window.addEventListener('pagehide',()=>{if(this.pending)this.flush();});
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&this.pending)this.flush();});
    return this.latest;
  }
  save(value) {
    this.latest=this.document(value);this.generation++;this.pending=true;this.report();
    // Start the disk request on the input event; serialize later edits behind it.
    this.flush();
    return false; // The asynchronous disk acknowledgement controls the saved state.
  }
  schedule(delay) {
    if(this.timer!==null||this.running||!this.pending)return;
    this.timer=setTimeout(()=>{this.timer=null;this.flush();},delay);
  }
  async flush() {
    if(this.running||!this.pending)return;
    this.running=true;
    const generation=this.generation;
    const body=JSON.stringify({workspace:this.latest,baseRevision:this.revision});
    try {
      const response=await fetch('/api/workspace',{method:'POST',headers:{'Content-Type':'application/json'},body,
        keepalive:new Blob([body]).size<60000,signal:AbortSignal.timeout(20000)});
      if(response.status===409){
        const state=await response.json();
        this.latest=this.merge(this.normalize(state.workspace),this.latest);
        this.revision=state.revision;this.generation++;this.diskOK=true;
        this.onRecovered(this.latest);
        this.notify('Another session saved changes. Both versions were kept as separate profiles.');
      }else{
        if(!response.ok)throw new Error('Disk save failed');
        const state=await response.json();
        this.revision=state.revision;this.diskOK=true;
        this.pending=generation!==this.generation;
        if(state.folderCopy===false)this.notify('The database is saved, but the readable JSON copy could not be refreshed. Check folder permissions.');
        if(!this.pending){
          for(const {key,raw} of this.sources){
            try{if(localStorage.getItem(key)===raw)localStorage.removeItem(key);}catch(_){/* Already saved on disk. */}
          }
          this.sources=[];
        }
      }
    }catch(_){this.diskOK=false;}
    finally{
      this.running=false;this.report();
      if(this.pending)this.schedule(this.diskOK?0:3000);
    }
  }
}
if(typeof module!=='undefined')module.exports={FolioPersistence};
