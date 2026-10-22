'use strict';

// Browser writes are immediate. Server writes are serialized and acknowledged only
// after the SQLite transaction commits. Each tab has its own durable pending copy.
class FolioPersistence {
  constructor({normalize, onStatus, onRecovered, notify}) {
    this.normalize = normalize;
    this.onStatus = onStatus;
    this.onRecovered = onRecovered;
    this.notify = notify;
    this.key = 'folio.persistence.v2';
    this.outboxPrefix = 'folio.pending.';
    this.outbox = this.outboxPrefix + crypto.randomUUID();
    this.revision = null;
    this.generation = 0;
    this.pending = false;
    this.browserOK = true;
    this.diskOK = false;
    this.running = false;
    this.timer = null;
    this.recoveredKeys = [];
  }

  document(value) {
    return JSON.parse(JSON.stringify({version:1, activeId:value.activeId || null, profiles:value.profiles}));
  }

  same(left, right) {
    const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value==='object' ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])) : value;
    return JSON.stringify(canonical(left))===JSON.stringify(canonical(right));
  }

  report() {
    this.onStatus({
      unsafe: this.pending && !this.browserOK,
      text: !this.pending && this.diskOK ? 'Saved to disk' : this.browserOK ? 'Saved in browser · disk pending' : 'Not saved · export a backup',
      pending: this.pending || !this.diskOK,
    });
  }

  cache() {
    const record = JSON.stringify({workspace:this.latest, revision:this.revision, dirty:this.pending});
    let written = false;
    try {
      if (this.pending) { localStorage.setItem(this.outbox, record); written = true; }
      else localStorage.removeItem(this.outbox);
    } catch (_) { /* A full browser store must not prevent a disk save. */ }
    try { localStorage.setItem(this.key, record); written = true; } catch (_) { /* Report below. */ }
    this.browserOK = written;
    this.report();
  }

  merge(remote, local) {
    const merged = this.document(remote);
    for (const entry of local.profiles) {
      const existing = merged.profiles.find(p => p.id === entry.id);
      if (existing && this.same(existing,entry)) continue;
      const recovered = JSON.parse(JSON.stringify(entry));
      if (existing) recovered.id = crypto.randomUUID();
      merged.profiles.push(recovered);
      if (local.activeId === entry.id) merged.activeId = recovered.id;
    }
    if (!merged.profiles.some(p => p.id === merged.activeId)) merged.activeId = merged.profiles[0]?.id || null;
    return merged;
  }

  async start() {
    const empty = {version:1, activeId:null, profiles:[]};
    let cached = null;
    const interrupted = [];
    let unreadable = false;
    try {
      const raw = localStorage.getItem(this.key);
      if (raw) {
        try { cached = JSON.parse(raw); cached.workspace = this.normalize(cached.workspace); }
        catch (_) { unreadable = true; cached = null; }
      }
      if (!cached) {
        const legacy = localStorage.getItem('folio.workspace.v1');
        if (legacy) {
          try { cached = {workspace:this.normalize(JSON.parse(legacy)),revision:null,dirty:true}; }
          catch (_) { unreadable = true; }
        }
      }
      for (let i=0;i<localStorage.length;i++) {
        const key = localStorage.key(i);
        if (!key.startsWith(this.outboxPrefix)) continue;
        try {
          const record = JSON.parse(localStorage.getItem(key));
          record.workspace = this.normalize(record.workspace);
          if (record.dirty) interrupted.push({key, raw:localStorage.getItem(key), ...record});
        } catch (_) { unreadable = true; }
      }
    } catch (_) { this.browserOK = false; }
    this.latest = this.document(cached?.workspace || empty);
    this.revision = cached?.revision || null;
    this.pending = !!cached?.dirty;
    let recovered = false;
    for (const record of interrupted) {
      this.recoveredKeys.push({key:record.key,raw:record.raw});
      if (!this.same(record.workspace,this.latest)) {
        this.latest = this.merge(this.latest,record.workspace);
        recovered = true;
      }
      this.pending = true;
    }
    try {
      const response = await fetch('/api/workspace',{cache:'no-store',signal:AbortSignal.timeout(10000)});
      if (!response.ok) throw new Error('Disk unavailable');
      const state = await response.json();
      const remote = state.workspace ? this.normalize(state.workspace) : null;
      if (remote) {
        if (this.pending && this.revision !== state.revision) {
          this.latest = this.merge(remote,this.latest);
          recovered = true;
        } else if (!this.pending) this.latest = this.document(remote);
      } else if (this.latest.profiles.length) this.pending = true;
      this.revision = state.revision;
      this.diskOK = true;
      if (state.recovered) this.notify('Recovered your workspace from an earlier disk snapshot.');
    } catch (_) {
      // Keep pending data and its old revision. Do not replace inaccessible disk data.
      this.diskOK = false;
      if (this.latest.profiles.length) this.pending = true;
      this.notify('Disk saving is unavailable. Your browser recovery copy is being kept; saving will retry automatically.');
    }
    if (unreadable) this.notify('Some browser data could not be read. Existing copies were preserved; disk and pending copies were used where available.');
    if (recovered) this.notify('Interrupted or conflicting edits were recovered. Different versions are kept as separate profiles.');
    this.cache();
    if (this.pending) this.schedule(0);
    this.retry = setInterval(()=>{if(this.pending)this.schedule(0);},5000);
    window.addEventListener('online',()=>this.schedule(0));
    window.addEventListener('pagehide',()=>{if(this.pending){this.cache();this.flush();}});
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden' && this.pending)this.flush();});
    return this.latest;
  }

  save(value) {
    this.latest = this.document(value);
    this.generation++;
    this.pending = true;
    this.cache();
    this.schedule(250);
    return this.browserOK;
  }

  schedule(delay) {
    if (this.timer !== null || this.running || !this.pending) return;
    this.timer = setTimeout(()=>{this.timer=null;this.flush();},delay);
  }

  async flush() {
    if (this.running || !this.pending) return;
    this.running = true;
    const generation = this.generation;
    const body = JSON.stringify({workspace:this.latest,baseRevision:this.revision});
    try {
      const response = await fetch('/api/workspace',{
        method:'POST',headers:{'Content-Type':'application/json'},body,
        keepalive:new Blob([body]).size < 60000,signal:AbortSignal.timeout(20000),
      });
      if (response.status===409) {
        const state = await response.json();
        const merged = this.merge(this.normalize(state.workspace),this.latest);
        this.latest = merged;
        this.revision = state.revision;
        this.generation++;
        this.diskOK = true;
        this.cache();
        this.onRecovered(merged);
        this.notify('Another session saved changes. Both versions were preserved; recovered edits are in separate profiles.');
      } else {
        if (!response.ok) throw new Error('Save was not acknowledged');
        const state = await response.json();
        this.revision = state.revision;
        this.diskOK = true;
        this.pending = generation !== this.generation;
        this.cache();
        if (!this.pending) {
          for (const {key,raw} of this.recoveredKeys) {
            try {
              // A live tab may have updated its pending copy since startup.
              if (localStorage.getItem(key)===raw) localStorage.removeItem(key);
            } catch (_) { /* Safe to retain. */ }
          }
          this.recoveredKeys = [];
        }
      }
    } catch (_) {
      this.diskOK = false;
      this.report();
    } finally {
      this.running = false;
      if (this.pending) this.schedule(this.diskOK ? 0 : 3000);
    }
  }
}
if (typeof module !== 'undefined') module.exports = {FolioPersistence};
