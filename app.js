'use strict';
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const clone = value => JSON.parse(JSON.stringify(value));
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const blank = name => ({name, headline:'', email:'', phone:'', location:'', website:'', linkedin:'', github:'', summary:'', skills:'', experience:[], education:[], projects:[], certifications:'', languages:'', awards:''});
const templates = {
  modern: {name:'Modern', subtitle:'A fresh perspective', description:'A clean sans serif layout with a quiet green accent. A versatile choice for technology and beyond.', tag:'VERSATILE', color:'#245c51'},
  classic: {name:'Classic', subtitle:'Timeless for a reason', description:'Traditional serif typography, a centered header, and an understated monochrome finish.', tag:'TRADITIONAL', color:'#2c2d31'},
  compact: {name:'Compact', subtitle:'More experience. Less space.', description:'Tighter spacing and a restrained navy accent for a longer professional story.', tag:'EXPERIENCED', color:'#233f68'},
  graduate: {name:'Graduate', subtitle:'A strong beginning', description:'Put education first, followed by your skills, projects, and practical experience.', tag:'EARLY CAREER', color:'#2c2d31'}
};
const configs = {
  experience:{title:'Experience', description:'The work you’ve done. The difference you’ve made.', icon:'▣', number:'03', singular:'experience', fields:[['title','Job title'],['company','Company'],['location','Location'],['start','Start date'],['end','End date','Present'],['bullets','Achievements','One achievement per line',true]]},
  education:{title:'Education', description:'Where you built your foundation.', icon:'▱', number:'04', singular:'education', fields:[['degree','Degree / qualification'],['school','School / university'],['start','Start date'],['end','End date'],['details','Additional details','Honors, relevant coursework, GPA (optional)',true]]},
  projects:{title:'Projects', description:'Your ideas, brought to life.', icon:'◇', number:'05', singular:'project', fields:[['name','Project name'],['stack','Technologies / skills'],['url','Project link'],['bullets','What you built','One contribution or result per line',true]]}
};
let workspace = {version:1, activeId:null, profiles:[]};
let storageFailed = false;
let current;
let currentTab = 'details';
let aiDraft = null;
let aiProfileId = null;
let aiBusy = false;
let toastTimer;
const persistence = new FolioPersistence({
  normalize: normalizeWorkspace,
  onStatus: state => {
    storageFailed = state.unsafe;
    $('#save-state').textContent = state.text;
    $('#save-state').classList.toggle('unsaved', state.pending);
  },
  onRecovered: value => {
    workspace = value;
    current = workspace.profiles.find(p=>p.id===workspace.activeId) || workspace.profiles[0];
    if (current) renderAll();
  },
  notify: message => toast(message, true),
});

function normalizeProfile(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid profile data.');
  const p = blank('');
  for (const key of Object.keys(p)) {
    if (Array.isArray(p[key])) {
      const fields = configs[key].fields.map(f => f[0]);
      p[key] = (Array.isArray(input[key]) ? input[key] : []).filter(row => row && typeof row === 'object').map(row => Object.fromEntries(fields.map(k => [k, typeof row[k] === 'string' ? row[k] : ''])));
    } else p[key] = typeof input[key] === 'string' ? input[key] : '';
  }
  return p;
}
function normalizeEntry(entry) {
  if (!entry || typeof entry !== 'object') throw new Error('Invalid workspace entry.');
  const profile = normalizeProfile(entry.profile);
  return {id:typeof entry.id === 'string' ? entry.id : uid(), profile,
    template:templates[entry.template] ? entry.template : 'modern', paper:entry.paper === 'letter' ? 'letter' : 'a4',
    target:{role:'general', title:'', company:'', description:'', ...Object.fromEntries(Object.entries(entry.target || {}).filter(([k,v]) => ['role','title','company','description'].includes(k) && typeof v === 'string'))},
    notes: typeof entry.notes === 'string' ? entry.notes : '',
    history:(Array.isArray(entry.history) ? entry.history : []).map(h => ({id:typeof h.id === 'string' ? h.id : uid(), date:typeof h.date === 'string' ? h.date : new Date().toISOString(), label:typeof h.label === 'string' ? h.label : 'Saved resume', profile:normalizeProfile(h.profile), template:templates[h.template] ? h.template : 'modern', paper:h.paper === 'letter' ? h.paper : 'a4', target:h.target && typeof h.target === 'object' ? h.target : {}}))};
}
function normalizeWorkspace(data) {
  if (!data || !Array.isArray(data.profiles)) throw new Error('This is not a Folio workspace backup.');
  const profiles = data.profiles.map(normalizeEntry);
  const used = new Set();
  profiles.forEach(p => { if (used.has(p.id)) p.id = uid(); used.add(p.id); });
  return {version:1, activeId:profiles.some(p=>p.id===data.activeId) ? data.activeId : profiles[0]?.id || null, profiles};
}
function persist() {
  workspace.activeId = current?.id || null;
  return persistence.save(workspace);
}
function toast(message, long = false) {
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, long ? 9500 : 4000);
}
function showDialog(id) { if (!$(id).open) $(id).showModal(); }
function createProfile(name, profile) {
  current = {id:uid(), profile:profile || blank(name), template:'modern', paper:'a4', target:{role:'general', title:'', company:'', description:''}, notes:'', history:[]};
  workspace.profiles.push(current);
  persist(); renderAll();
}
function fieldHTML(key, label, placeholder = '', multiline = false, value = '', attributes = '') {
  return `<label class="${multiline ? 'field-wide' : ''}">${esc(label)}${multiline ? `<textarea rows="4" ${attributes} placeholder="${esc(placeholder)}">${esc(value)}</textarea>` : `<input ${attributes} value="${esc(value)}" placeholder="${esc(placeholder)}">`}</label>`;
}
function renderEditor() {
  const p = current.profile;
  const personal = [['name','Full name','Your full name'],['headline','Professional title','e.g. Software Engineer'],['email','Email address','you@example.com'],['phone','Phone number','+91 98765 43210'],['location','Location','City, Country'],['website','Portfolio / website','yourwebsite.com'],['linkedin','LinkedIn','linkedin.com/in/yourname'],['github','GitHub','github.com/yourname']];
  $('#personal-fields').innerHTML = personal.map(([key,label,hint]) => fieldHTML(key,label,hint,false,p[key],`data-field="${key}" ${key === 'email' ? 'type="email"' : ''}`)).join('');
  $$('[data-field]').forEach(input => { input.value = p[input.dataset.field] || ''; });
  $('#extra-fields').innerHTML = [['certifications','Certifications','Certification, issuer, and year'],['languages','Languages','English (fluent), Hindi (native)…'],['awards','Awards & volunteering','Awards, community work, or other relevant details']].map(([k,l,h])=>fieldHTML(k,l,h,true,p[k],`data-field="${k}"`)).join('');
  $('#repeatable-sections').innerHTML = Object.entries(configs).map(([section,c]) => `<section class="card section-card"><div class="section-heading"><span class="section-icon">${c.icon}</span><div><h2>${c.title}</h2><p>${c.description}</p></div><span class="section-count">${c.number}</span></div>${p[section].map((row,index)=>`<div class="entry-editor"><div class="entry-top"><strong>${esc(row.title || row.degree || row.name || `${c.singular} ${index+1}`)}</strong><button class="remove-entry" data-remove="${section}" data-index="${index}" aria-label="Remove ${c.singular} ${index+1}">Remove ×</button></div><div class="fields-grid">${c.fields.map(([key,label,hint,multi])=>fieldHTML(key,label,hint || '',multi,row[key],`data-section="${section}" data-index="${index}" data-key="${key}"`)).join('')}</div></div>`).join('')}<button class="add-entry" data-add="${section}">+ Add ${c.singular}</button></section>`).join('');
  $('#target-role').value = current.target.role;
  $('#job-title').value = current.target.title;
  $('#company').value = current.target.company;
  $('#job-description').value = current.target.description;
  $('#paper').value = current.paper;
  $('#source-notes').value = current.notes;
  $('#design-options').innerHTML = Object.entries(templates).map(([id,t])=>`<button class="design-option ${id===current.template?'selected':''}" data-template="${id}" aria-pressed="${id===current.template}"><span class="design-swatch" style="--swatch:${t.color}">Aa</span><span><strong>${t.name}</strong><small>${t.subtitle}</small></span><span class="radio-dot"></span></button>`).join('');
}
const roleKeywords = {
  ai:['python','machine learning','tensorflow','pytorch','llm','ai','nlp','deep learning','scikit-learn','rag'],
  frontend:['react','typescript','javascript','css','html','accessibility','frontend','vue','angular','ui'],
  backend:['python','java','node','sql','postgresql','api','backend','docker','redis','go'],
  fullstack:['react','typescript','javascript','node','python','sql','api','full stack'],
  data:['python','sql','data','analytics','tableau','statistics','pandas','power bi'],
  product:['figma','design','research','product','user','ux','roadmap'], general:[]
};
function targetedProfile(entry = current) {
  const p = clone(entry.profile);
  const keywords = [...(roleKeywords[entry.target?.role] || []), ...extractKeywords(entry.target?.description || '')];
  const score = value => keywords.reduce((sum,k)=>sum+(String(value).toLowerCase().includes(k.toLowerCase()) ? 1 : 0),0);
  p.skills = p.skills.split(',').map(s=>s.trim()).filter(Boolean).sort((a,b)=>score(b)-score(a)).join(', ');
  p.projects.sort((a,b)=>score(`${b.name} ${b.stack} ${b.bullets}`)-score(`${a.name} ${a.stack} ${a.bullets}`));
  return p;
}
function resumeHTML(p, template='modern') {
  const textBlock = (name, content) => content?.trim() ? `<section class="resume-section"><h3>${name}</h3><p>${esc(content).replace(/\n/g,'<br>')}</p></section>` : '';
  const bullets = value => value?.trim() ? `<ul>${value.split('\n').filter(s=>s.trim()).map(s=>`<li>${esc(s.replace(/^[\s•*\-]+/,''))}</li>`).join('')}</ul>` : '';
  const section = (title,rows,kind) => rows.length ? `<section class="resume-section"><h3>${title}</h3>${rows.map(r=>{
    if (kind==='experience') return `<div class="resume-entry"><div class="resume-entry-title"><strong>${esc([r.title,r.company].filter(Boolean).join(' · '))}</strong><span>${esc([r.start,r.end].filter(Boolean).join(' – '))}</span></div>${r.location?`<div class="resume-meta">${esc(r.location)}</div>`:''}${bullets(r.bullets)}</div>`;
    if (kind==='education') return `<div class="resume-entry"><div class="resume-entry-title"><strong>${esc(r.degree)}</strong><span>${esc([r.start,r.end].filter(Boolean).join(' – '))}</span></div><div class="resume-meta">${esc(r.school)}</div>${r.details?`<p>${esc(r.details).replace(/\n/g,'<br>')}</p>`:''}</div>`;
    return `<div class="resume-entry"><div class="resume-entry-title"><strong>${esc(r.name)}</strong></div><div class="resume-meta">${esc([r.stack,r.url].filter(Boolean).join(' | '))}</div>${bullets(r.bullets)}</div>`;
  }).join('')}</section>` : '';
  const sections = {summary:textBlock('Profile',p.summary),skills:textBlock('Skills',p.skills),experience:section('Experience',p.experience,'experience'),projects:section('Projects',p.projects,'projects'),education:section('Education',p.education,'education'),certifications:textBlock('Certifications',p.certifications),languages:textBlock('Languages',p.languages),awards:textBlock('Awards & volunteering',p.awards)};
  const order = template==='graduate' ? ['summary','education','skills','projects','experience','certifications','languages','awards'] : ['summary','skills','experience','projects','education','certifications','languages','awards'];
  const hasDetails = p.summary || p.skills || p.experience.length || p.projects.length || p.education.length;
  return `<header class="resume-header"><h2>${esc(p.name || 'Your name')}</h2>${p.headline?`<div class="resume-headline">${esc(p.headline)}</div>`:''}<div class="resume-contact">${esc([p.email,p.phone,p.location].filter(Boolean).join(' | '))}</div><div class="resume-contact">${esc([p.website,p.linkedin,p.github].filter(Boolean).join(' | '))}</div></header>${order.map(k=>sections[k]).join('')}${!hasDetails?'<div class="resume-empty"><span>YOUR STORY GOES HERE</span><p>Add your details on the left.<br>Your resume will take shape as you type.</p><div></div><div></div><div></div></div>':''}`;
}
function renderPreview() {
  const preview = $('#resume-preview');
  preview.className = `resume ${current.template} ${current.paper}`;
  preview.innerHTML = resumeHTML(targetedProfile(), current.template);
  $('#preview-template').textContent = templates[current.template].name;
  $('#preview-paper').textContent = current.paper==='letter'?'US Letter':'A4';
  $('#profile-label').textContent = current.profile.name || 'Your profile';
  $('#profile-avatar').textContent = (current.profile.name || '?').split(/\s+/).slice(0,2).map(s=>s[0]).join('').toUpperCase();
  $('#history-count').textContent = current.history.length;
  const p = current.profile;
  const essentials = [p.name.trim(),p.email.trim(),p.summary.trim(),p.skills.trim(),p.experience.length || p.projects.length,p.education.length];
  const done = essentials.filter(Boolean).length;
  $('#completion-label').textContent = `${done} of 6 essentials`;
  $('#completion-progress').style.width = `${done/6*100}%`;
  $('#completion-tip').textContent = done===6?'Looking good. Review your details before sending.':`Next: ${['add your name','add an email address','write a short summary','add your skills','add experience or a project','add your education'][essentials.findIndex(v=>!v)]}.`;
  renderKeywords();
}
function extractKeywords(description) {
  const stop = new Set('with that this from have will your you our and the for are job role work team about experience skills looking their they all can must able including using years strong required requirements responsibilities company ability knowledge working such other into more who join we us an of to in on as a is be or by at it'.split(' '));
  return [...new Set((description.toLowerCase().match(/[a-z][a-z0-9+#.-]{2,}/g)||[]).map(w=>w.replace(/[.-]+$/,'')))].filter(w=>!stop.has(w)).slice(0,28);
}
function renderKeywords() {
  const keywords = extractKeywords(current.target.description);
  const source = JSON.stringify(current.profile).toLowerCase();
  $('#keyword-feedback').innerHTML = keywords.length ? keywords.map(k=>`<span class="keyword ${source.includes(k)?'matched':''}">${source.includes(k)?'✓ ':''}${esc(k)}</span>`).join('')+'<p class="fine-print">Green words appear in your details. Add a skill only if you actually have it.</p>' : '<p class="empty-small">Paste a job description to see words to review.</p>';
}
function renderAll() { renderEditor(); renderPreview(); renderGallery(); renderHistory(); renderProfiles(); }
function setPage(page) {
  if (!current) return showDialog('#profiles-dialog');
  $$('.page').forEach(el=>{el.hidden=el.id!==`page-${page}`;});
  $$('.nav-item[data-page]').forEach(el=>el.classList.toggle('active',el.dataset.page===page));
  $('#breadcrumb').textContent = {builder:'Resume builder',templates:'Templates',history:'My resumes'}[page];
  if (page==='history') renderHistory();
  window.scrollTo({top:0,behavior:'smooth'});
}
function setTab(tab) {
  currentTab = tab;
  $$('.editor-panel').forEach(el=>el.hidden=el.id!==`editor-${tab}`);
  $$('[data-tab]').forEach(el=>{el.classList.toggle('active',el.dataset.tab===tab);el.setAttribute('aria-selected',String(el.dataset.tab===tab));});
}
function miniResume(template) {
  return `<div class="mini-resume ${template}"><div class="mini-name">Alex Morgan</div><div class="mini-subtitle">SOFTWARE ENGINEER</div><div class="mini-contact">alex@email.com · San Francisco, CA</div><div class="mini-rule"></div>${(template==='graduate'?['EDUCATION','SKILLS','PROJECTS','EXPERIENCE']:['PROFILE','EXPERIENCE','PROJECTS','EDUCATION']).map((s,i)=>`<div class="mini-heading">${s}</div>${i===0?'<div class="mini-line wide"></div><div class="mini-line"></div>':'<div class="mini-bold"></div><div class="mini-line wide"></div><div class="mini-line"></div><div class="mini-line medium"></div>'}`).join('')}</div>`;
}
function renderGallery() {
  $('#template-gallery').innerHTML = Object.entries(templates).map(([id,t])=>`<button class="template-card ${current?.template===id?'selected':''}" data-template="${id}"><div class="template-visual">${miniResume(id)}<span class="template-use">${current?.template===id?'✓ Selected':'Use this template ↗'}</span></div><div class="template-caption"><div><h2>${t.name}</h2><span class="template-tag">${t.tag}</span></div><p>${t.description}</p></div></button>`).join('');
}
function renderProfiles() {
  $('#profile-list').innerHTML = workspace.profiles.map(p=>`<button class="profile-option" data-profile="${esc(p.id)}"><span class="avatar">${esc(p.profile.name.charAt(0).toUpperCase())}</span><span><strong>${esc(p.profile.name)}</strong><small>${p.history.length} saved resume${p.history.length===1?'':'s'}${p.id===current?.id?' · Current profile':''}</small></span><span>↗</span></button>`).join('');
}
function snapshot(label) {
  return {id:uid(),date:new Date().toISOString(),label,profile:clone(current.profile),target:clone(current.target),template:current.template,paper:current.paper};
}
function saveVersion(label) {
  current.history.unshift(snapshot(label || [current.target.title || 'Resume',current.target.company].filter(Boolean).join(' · ')));
  persist(); renderHistory(); renderPreview();
}
function renderHistory() {
  if (!current) return;
  $('#history-list').innerHTML = current.history.length ? `<div class="history-grid">${current.history.map(h=>`<article class="card history-card"><div class="history-thumbnail">${miniResume(h.template)}</div><div class="history-info"><span class="eyebrow">${esc(templates[h.template].name)} · ${h.paper==='letter'?'LETTER':'A4'}</span><h2>${esc(h.label)}</h2><p>${esc(new Date(h.date).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}))}</p><div class="history-actions"><button class="button secondary small" data-history-download="${h.id}">↓ PDF</button><button class="text-button" data-history-restore="${h.id}">Restore</button><button class="remove-entry" data-history-delete="${h.id}" aria-label="Delete saved version ${esc(h.label)}">×</button></div></div></article>`).join('')}</div>` : '<div class="empty-state"><span>◷</span><h2>Your next chapter starts here.</h2><p>Download a PDF or save a version to begin your resume history.</p><button class="button primary" data-page="builder">Build your resume ↗</button></div>';
}
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download=name; a.click();
  setTimeout(()=>URL.revokeObjectURL(url),2000);
}
const fileName = name => (name || 'resume').replace(/[^\p{L}\p{N}._-]+/gu,'-').slice(0,100);
async function request(path, data, blob=false) {
  let response;
  try { response = await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}); }
  catch (error) { throw new Error('The local server is unavailable. Start it with python3 server.py and open http://localhost:8000.'); }
  if (!response.ok) { const failure = await response.json().catch(()=>({error:'The request failed.'})); throw new Error(failure.error); }
  return blob ? response.blob() : response.json();
}
async function downloadPDF(entry=current, addHistory=true) {
  if (!entry) return showDialog('#profiles-dialog');
  if (!entry.profile.name.trim()) return toast('Add your name before exporting.');
  const owner = current;
  const frozen = clone(entry);
  const button = $('#download-top'); button.disabled=true; button.textContent='Creating PDF…';
  try {
    const pdf = await request('/api/pdf',{profile:targetedProfile(frozen),template:frozen.template,paper:frozen.paper},true);
    downloadBlob(pdf,`${fileName(frozen.profile.name)}-${fileName(frozen.target?.title || 'Resume')}.pdf`);
    if (addHistory) {
      owner.history.unshift({...frozen,id:uid(),date:new Date().toISOString(),label:[frozen.target.title || 'Resume',frozen.target.company].filter(Boolean).join(' · '),history:undefined,notes:undefined});
      persist(); renderHistory(); renderPreview();
    }
    toast(addHistory ? 'Your PDF is ready. A version is saved in My resumes.' : 'Your saved PDF is ready.');
  } catch(error) { toast(error.message,true); }
  finally { button.disabled=false; button.innerHTML='↓ &nbsp; Download PDF'; }
}
function printResume() {
  if (!current) return;
  const popup = window.open('','_blank');
  if (!popup) return toast('Allow popups to open the print preview.',true);
  const style = document.createElement('style');
  style.textContent = `@page {size:${current.paper==='letter'?'letter':'A4'};margin:14mm} body{margin:0;background:white} .resume{width:auto!important;min-height:0!important;padding:0!important;box-shadow:none!important} .resume-empty{display:none} .resume-entry{break-inside:avoid} .resume-section h3{break-after:avoid}`;
  popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(current.profile.name)} — Resume</title><link rel="stylesheet" href="${new URL('styles.css',location.href).href}"></head><body><article class="resume ${current.template}">${resumeHTML(targetedProfile(),current.template)}</article></body></html>`);
  popup.document.head.append(style); popup.document.close();
  popup.onload=()=>{popup.focus();popup.print();};
}
function exportJSON(data,name) { downloadBlob(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),name); }
function backupWorkspace() { exportJSON(workspace,`folio-workspace-${new Date().toISOString().slice(0,10)}.json`); }
async function importFile(file) {
  if (!current || !file) return;
  if (file.size>8*1024*1024) throw new Error('Choose a file smaller than 8 MB.');
  if (/\.json$/i.test(file.name)) {
    const data = JSON.parse(await file.text());
    if (Array.isArray(data.profiles)) { restoreWorkspace(data); return; }
    const entry = normalizeEntry(data.profile ? data : {profile:data});
    entry.id=uid(); workspace.profiles.push(entry); current=entry; persist(); renderAll();
    $('#import-dialog').close(); toast('Profile imported into its own workspace.'); return;
  }
  let text;
  const destination = current;
  destination.notes = $('#source-notes').value;
  if (/\.(txt|md)$/i.test(file.name)) text = await file.text();
  else {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary=''; for (let offset=0;offset<bytes.length;offset+=32768) binary+=String.fromCharCode(...bytes.subarray(offset,offset+32768));
    text = (await request('/api/extract',{name:file.name,data:btoa(binary)})).text;
  }
  if (!text.trim()) throw new Error('This file contains no readable text.');
  if (text.length>100000) throw new Error('Please import fewer than 100,000 characters.');
  destination.notes=[destination.notes,`--- ${file.name} ---\n${text}`].filter(Boolean).join('\n\n');
  persist(); if (current.id===destination.id) $('#source-notes').value=destination.notes;
  toast('Text imported and saved. Use AI to organize it, or use it as a reference.');
}
function restoreWorkspace(data) {
  const restored = normalizeWorkspace(data);
  if (!restored.profiles.length) throw new Error('The backup has no profiles.');
  // Merge into separate workspaces, preserving everything already saved.
  restored.profiles.forEach(p=>{p.id=uid();workspace.profiles.push(p);});
  current=restored.profiles[0];persist();renderAll();
  $$('.open').forEach(el=>el.close?.());
  $('#settings-dialog').close();$('#import-dialog').close();
  toast(`Restored ${restored.profiles.length} profiles alongside your existing work.`);
}
async function runAI(action) {
  if (!current || aiBusy) return;
  if (action==='extract') {current.notes=$('#source-notes').value;persist();if(!current.notes.trim())return toast('Upload a file or paste some details first.');}
  aiBusy=true; const destination=current; const buttons=[$('#tailor-ai'),$('#extract-ai')];
  buttons.forEach(b=>{b.disabled=true;b.dataset.oldText=b.textContent;b.textContent='✧ Working on your draft…';});
  try {
    const result = await request('/api/ai',{action,profile:clone(destination.profile),target:clone(destination.target),source:action==='extract'?destination.notes:''});
    aiDraft=normalizeProfile(result.profile); aiProfileId=destination.id;
    $('#ai-preview').className=`resume ${destination.template}`;
    $('#ai-preview').innerHTML=resumeHTML(aiDraft,destination.template);
    $('#import-dialog').close();showDialog('#ai-dialog');
  } catch(error) {toast(error.message,true);}
  finally {aiBusy=false;buttons.forEach(b=>{b.disabled=false;b.textContent=b.dataset.oldText;});}
}

document.addEventListener('input',event=>{
  const el=event.target;if(!current)return;
  if(el.id==='source-notes'){current.notes=el.value;persist();}
  if(el.dataset.field){current.profile[el.dataset.field]=el.value;persist();renderPreview();}
  if(el.dataset.section){current.profile[el.dataset.section][Number(el.dataset.index)][el.dataset.key]=el.value;persist();renderPreview();}
  const targets={'target-role':'role','job-title':'title','company':'company','job-description':'description'};
  if(targets[el.id]){current.target[targets[el.id]]=el.value;persist();renderPreview();}
});
document.addEventListener('click',event=>{
  const el=event.target.closest('button, a.brand');if(!el)return;
  if(el.hasAttribute('data-close')){
    if(el.closest('dialog').id==='profiles-dialog' && !current)return;
    el.closest('dialog').close();
  }
  if(el.dataset.page)setPage(el.dataset.page);
  if(el.dataset.tab)setTab(el.dataset.tab);
  if(el.classList.contains('brand')){event.preventDefault();setPage('builder');}
  if(el.dataset.add&&current){const section=el.dataset.add;current.profile[section].push(Object.fromEntries(configs[section].fields.map(f=>[f[0],''])));persist();renderEditor();renderPreview();const inputs=$$(`[data-section="${section}"]`);inputs[inputs.length-configs[section].fields.length]?.focus();}
  if(el.dataset.remove&&current){if(!confirm('Remove this entry from your profile?'))return;current.profile[el.dataset.remove].splice(Number(el.dataset.index),1);persist();renderEditor();renderPreview();}
  if(el.dataset.template&&current){current.template=el.dataset.template;persist();renderEditor();renderPreview();renderGallery();toast(`${templates[current.template].name} template selected.`);}
  if(el.dataset.profile){current=workspace.profiles.find(p=>p.id===el.dataset.profile);persist();renderAll();$('#profiles-dialog').close();}
  if(el.dataset.historyDownload){const h=current.history.find(h=>h.id===el.dataset.historyDownload);if(h)downloadPDF(h,false);}
  if(el.dataset.historyRestore){const h=current.history.find(h=>h.id===el.dataset.historyRestore);if(!h||!confirm('Restore this version? Your current details will be saved in history first.'))return;saveVersion('Before restoring a version');current.profile=clone(h.profile);current.template=h.template;current.paper=h.paper;current.target={role:'general',title:'',company:'',description:'',...h.target};persist();renderAll();setPage('builder');toast('Version restored. Your previous details are saved in history.');}
  if(el.dataset.historyDelete){if(!confirm('Delete this saved version?'))return;current.history=current.history.filter(h=>h.id!==el.dataset.historyDelete);persist();renderHistory();renderPreview();}
});
$('#new-profile-form').addEventListener('submit',event=>{event.preventDefault();const name=$('#new-profile-name').value.trim();if(!name)return;createProfile(name);$('#new-profile-name').value='';$('#profiles-dialog').close();setPage('builder');});
$('#switch-profile').onclick=()=>{renderProfiles();showDialog('#profiles-dialog');};
$('#download-top').onclick=()=>downloadPDF();
$('#print-resume').onclick=printResume;
$('#paper').onchange=()=>{current.paper=$('#paper').value;persist();renderPreview();};
$('#open-import').onclick=()=>{$('#source-notes').value=current.notes;showDialog('#import-dialog');};
$('#save-notes').onclick=()=>{current.notes=$('#source-notes').value;persist();$('#import-dialog').close();toast('Source notes saved with this profile.');};
$('#import-file').onchange=async event=>{try{await importFile(event.target.files[0]);}catch(error){toast(error.message,true);}finally{event.target.value='';}};
$('#restore-file').onchange=async event=>{try{const file=event.target.files[0];if(file){if(file.size>20*1024*1024)throw new Error('Backup must be smaller than 20 MB.');restoreWorkspace(JSON.parse(await file.text()));}}catch(error){toast(`Could not restore backup: ${error.message}`,true);}finally{event.target.value='';}};
$('#tailor-ai').onclick=()=>runAI('tailor');$('#extract-ai').onclick=()=>runAI('extract');
$('#apply-ai').onclick=()=>{if(!aiDraft)return;const destination=workspace.profiles.find(p=>p.id===aiProfileId);if(!destination)return toast('The original profile no longer exists.');current=destination;saveVersion('Before applying an AI draft');current.profile=clone(aiDraft);aiDraft=null;persist();renderAll();$('#ai-dialog').close();setPage('builder');setTab('details');toast('AI draft applied. You can edit every detail.');};
$('#backup-all').onclick=backupWorkspace;$('#settings-backup').onclick=backupWorkspace;
$('#backup-profile').onclick=()=>{if(current)exportJSON(current,`folio-${fileName(current.profile.name)}.json`);};
$('#save-version').onclick=()=>{saveVersion();toast('Current version saved.');};
$('#full-preview').onclick=()=>{$('#large-preview').className=`resume ${current.template}`;$('#large-preview').innerHTML=resumeHTML(targetedProfile(),current.template);showDialog('#large-preview-dialog');};
$('#settings-button').onclick=async()=>{showDialog('#settings-dialog');$('#ai-status').textContent='Checking connection…';try{const status=await fetch('/api/status').then(r=>r.json());$('#ai-status').innerHTML=`<strong>${status.ai?'✧ AI is connected':'AI is optional · not connected'}</strong><p>${status.pdf?'PDF downloads are ready.':'Install requirements.txt for direct PDF downloads; browser Print / Save PDF is available.'}</p>`;}catch(error){$('#ai-status').textContent='Start the local server to connect AI and direct PDF export.';}};
$('#delete-profile').onclick=()=>{if(!current||!confirm(`Delete ${current.profile.name}’s active profile, notes, and history? Recovery snapshots and exported backups may retain older copies.`))return;workspace.profiles=workspace.profiles.filter(p=>p.id!==current.id);current=workspace.profiles[0];persist();$('#settings-dialog').close();if(current){renderAll();}else{renderProfiles();showDialog('#profiles-dialog');}};
$('#try-demo').onclick=()=>{
  const p=blank('Alex Morgan');Object.assign(p,{headline:'Software Engineer',email:'alex.morgan@example.com',phone:'+1 (415) 555-0138',location:'San Francisco, CA',website:'alexmorgan.dev',linkedin:'linkedin.com/in/alexmorgan',github:'github.com/alexmorgan',summary:'Software engineer building thoughtful, accessible web applications. Experienced in taking products from an early idea to reliable software, with a focus on clear interfaces and practical engineering.',skills:'TypeScript, React, Node.js, Python, PostgreSQL, REST APIs, Accessibility, Git',experience:[{title:'Software Engineer',company:'Northstar Studio',location:'San Francisco, CA',start:'Jun 2022',end:'Present',bullets:'Built a shared React component library used across three customer applications.\nPartnered with designers to improve keyboard navigation and screen reader support.\nDeveloped and maintained REST APIs for customer onboarding.'}],education:[{degree:'B.S. in Computer Science',school:'Westbridge University',start:'2018',end:'2022',details:'Relevant coursework: Algorithms, Databases, Human–Computer Interaction'}],projects:[{name:'Open Notes',stack:'React, TypeScript, PostgreSQL',url:'github.com/alexmorgan/open-notes',bullets:'Created a collaborative note-taking app with live editing and full-text search.\nDesigned a responsive interface with accessible keyboard shortcuts.'}],languages:'English (native), Spanish (conversational)'});
  createProfile(p.name,p);$('#profiles-dialog').close();toast('Example profile created. Replace the sample details with your own.');
};
window.addEventListener('beforeunload',event=>{if(storageFailed){event.preventDefault();event.returnValue='';}});
$('#profiles-dialog').addEventListener('cancel',event=>{if(!current)event.preventDefault();});
const mobileSettings = document.createElement('button');
mobileSettings.className='button secondary small';
mobileSettings.textContent='⚙';
mobileSettings.setAttribute('aria-label','AI and workspace settings');
mobileSettings.onclick=()=>{if(current)$('#settings-button').click();else showDialog('#profiles-dialog');};
$('.top-actions').append(mobileSettings);
async function initializeWorkspace() {
  document.body.inert = true;
  $('#save-state').textContent = 'Restoring saved details…';
  try {
    workspace = await persistence.start();
    current = workspace.profiles.find(p=>p.id===workspace.activeId) || workspace.profiles[0];
    if(current)renderAll();
    else {renderGallery();showDialog('#profiles-dialog');}
  } catch(error) {
    storageFailed = true;
    $('#save-state').textContent = 'Recovery failed · export a backup';
    toast('Could not restore the workspace. Your stored copies have been preserved. Reload or restore a backup.',true);
  } finally { document.body.inert = false; }
}
initializeWorkspace();
