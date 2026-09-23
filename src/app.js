import {zh} from './i18n.js';

const $=s=>document.querySelector(s);
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icons={
  folder:'<path d="M3.5 8V6.5A2 2 0 0 1 5.5 4.5h4l2.3 2.5h6.7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><path d="M3.5 10.25h17"/>',
  file:'<path d="M6 3h8.5L19 7.5v12A1.5 1.5 0 0 1 17.5 21h-11A1.5 1.5 0 0 1 5 19.5v-15A1.5 1.5 0 0 1 6.5 3z"/><path d="M14.5 3v4.5H19M8.5 12h7M8.5 16h6"/>',
  play:'<path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none"/>',
  plus:'<path d="M12 4.5v15M4.5 12h15" stroke-width="2.2"/>',
  settings:'<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2" fill="currentColor" stroke="none"/><circle cx="16" cy="12" r="2" fill="currentColor" stroke="none"/><circle cx="11" cy="18" r="2" fill="currentColor" stroke="none"/>',
  activity:'<path d="M7 4v16M12 6h8M12 12h6M12 18h8"/><circle cx="7" cy="6" r="1.8" fill="currentColor" stroke="none"/><circle cx="7" cy="12" r="1.8" fill="currentColor" stroke="none"/><circle cx="7" cy="18" r="1.8" fill="currentColor" stroke="none"/>',
  more:'<circle cx="5" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.7" fill="currentColor" stroke="none"/>',
  stop:'<rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" stroke="none"/>',
  check:'<path d="m5 12.5 4.3 4.3L19 7" stroke-width="2.2"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 6.5v5.8l3.5 2.2"/>',
  error:'<circle cx="12" cy="12" r="9"/><path d="M12 7v6" stroke-width="2.2"/><circle cx="12" cy="17" r="1" fill="currentColor" stroke="none"/>',
  spin:'<path d="M20.5 8.5A9 9 0 1 0 21 12" stroke-width="2"/>',
  copy:'<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  trash:'<path d="M4.5 6.5h15M9 6.5V4h6v2.5M6.5 6.5l1 13.5h9l1-13.5M10 10.5v5.5M14 10.5v5.5"/>',
  minimize:'<path d="M5.5 12h13" stroke-width="1.9"/>',
  maximize:'<rect x="5.5" y="5.5" width="13" height="13" rx="1.5" stroke-width="1.8"/>',
  close:'<path d="M6.5 6.5l11 11m0-11-11 11" stroke-width="1.9"/>'
};
const icon=(name,cls='')=>`<svg class="ui-icon ui-icon-${name} ${cls}" viewBox="0 0 24 24" aria-hidden="true">${icons[name]||icons.folder}</svg>`;
let data,selectedProfile,selectedJob,view='profiles',busy=false,progress={phase:'idle'},history=[],update={state:'unconfigured'},robocopyInfo={state:'checking'},storageInfo={state:'idle'},loginInfo={state:'checking'},version='1.0.0',results={},saveQueue=Promise.resolve();
const t=s=>data?.settings.language==='zh-TW'?(zh[s]||s):s;
const bytes=n=>{if(!n)return '0 B';const i=Math.min(3,Math.floor(Math.log(n)/Math.log(1024)));return `${(n/1024**i).toFixed(i?1:0)} ${['B','KB','MB','GB'][i]}`;};
const elapsed=n=>{const ms=Math.max(0,Number(n)||0);if(ms<1000)return `${Math.round(ms)} ms`;if(ms<60000)return `${(ms/1000).toFixed(ms<10000?1:0)} s`;const seconds=Math.round(ms/1000);return `${Math.floor(seconds/60)} min ${seconds%60} s`;};
const jobCount=n=>`${n} ${t(n===1?'job processed':'jobs processed')}`;
const modeName=m=>t(m==='mirror'?'Mirror':'Copy & overwrite');
const profile=()=>data.profiles.find(p=>p.id===selectedProfile);
const job=()=>profile()?.jobs.find(j=>j.id===selectedJob);
const dis=()=>busy?'disabled':'';
const button=(text,action,ico,cls='',attrs='')=>`<button type="button" class="${cls}" data-action="${action}" ${attrs}>${ico?icon(ico):''}${escape(t(text))}</button>`;
const sample=()=>({schema:1,settings:{theme:'dark',language:'en',autoCheck:true,autoDownload:true,autoInstall:false,startWithWindows:false,closeBehavior:'quit'},profiles:[{id:'work',name:'Work',mode:'mirror',jobs:[{id:'docs',name:'Documents',source:'C:\\Users\\You\\Documents',destination:'E:\\Backup\\Documents',mode:'inherit'},{id:'projects',name:'Projects',source:'C:\\Projects',destination:'D:\\Local Backup\\Projects',mode:'copy'},{id:'assets',name:'Assets',source:'C:\\Assets',destination:'E:\\Backup\\Assets',mode:'inherit'}]},{id:'personal',name:'Personal',mode:'copy',jobs:[]},{id:'photos',name:'Photos',mode:'mirror',jobs:[]}]});
const previewHistory=()=>[{time:new Date().toISOString(),runId:'preview-sample',operation:true,scope:'profile',name:'Work (sample)',status:'completed',totalJobs:1,finishedJobs:1,copied:1,skipped:2,deleted:0,transferred:4096,timings:{totalMs:1600,scanMs:360,robocopyMs:1110,deleteMs:0,otherMs:130},jobs:[{name:'Documents',profile:'Work',source:'C:\\Users\\You\\Documents',destination:'E:\\Backup\\Documents',mode:'mirror',status:'completed',command:'"C:\\Windows\\System32\\robocopy.exe" "C:\\Users\\You\\Documents" "E:\\Backup\\Documents" "/E" "/Z" "/COPY:DAT" "/DCOPY:DA" "/MT:8" "/R:0" "/W:0" "/XJ" "/FP" "/BYTES" "/NP" "/NDL" "/UNILOG:C:\\Users\\You\\AppData\\Local\\Temp\\.ofbm-robocopy-log-example\\copy.log"',executable:'C:\\Windows\\System32\\robocopy.exe',exitCode:1,copied:1,skipped:2,deleted:0,transferred:4096}]}];
const preview=!window.backup;
const listeners={};
const api=window.backup||{
  async load(){return {data:JSON.parse(localStorage.getItem('ofbm-preview')||'null')||sample(),history:previewHistory(),version,update};},
  async save(d){localStorage.setItem('ofbm-preview',JSON.stringify(d));return d;},
  async pick(){toast(t('Use the desktop app to choose a real path.'));return null;},
  async prepare(selection){const jobs=data.profiles.filter(p=>!selection.profileId||p.id===selection.profileId).flatMap(p=>p.jobs.filter(j=>!selection.jobId||j.id===selection.jobId).map(j=>({...j,profile:p.name,mode:j.mode==='inherit'?p.mode:j.mode,copy:12,skip:3,remove:[]})));if(!jobs.length)throw new Error(t('No jobs in this profile'));return {token:'preview',jobs,errors:[],totalBytes:1024**3};},
  async run(){toast(t('Design preview — no files are copied'));return {phase:'idle'};},
  async cancel(){},async history(){return previewHistory();},async robocopyStatus(){return {available:true,path:'C:\\Windows\\System32\\robocopy.exe',error:null};},async showLogs(){toast(t('Use the desktop app to choose a real path.'));},async updates(){return update;},
  onProgress(fn){listeners.progress=fn;},onResult(fn){listeners.result=fn;},onUpdate(fn){listeners.update=fn;},onLogError(){}
};
function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').hidden=true,7000);}
function displayError(error){const message=String(error?.message||error);const unavailable='Robocopy is unavailable. Open Settings for the detected path and Windows repair steps.';return message.includes(unavailable)?t(unavailable):message;}
function save(){const snapshot=structuredClone(data);const task=saveQueue.then(()=>api.save(snapshot)).then(saved=>{for(const p of saved.profiles)for(const j of p.jobs){const current=data.profiles.flatMap(p=>p.jobs).find(item=>item.id===j.id);if(current)for(const k of ['source','destination'])if(current[k]===j[k])current[k+'Volume']=j[k+'Volume'];}});saveQueue=task.catch(e=>toast(e.message));return task;}
function applyTheme(){const theme=data.settings.theme==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):data.settings.theme;document.documentElement.dataset.theme=theme;document.documentElement.lang=data.settings.language;}
function render(){
  applyTheme();if(!profile()){selectedProfile=data.profiles[0]?.id;selectedJob=profile()?.jobs[0]?.id;}
  $('#environment').textContent=preview?t('Design preview — no files are copied'):'';
  $('#window-controls').innerHTML=preview?'':`<button type="button" data-window="minimize" title="${t('Minimize')}" aria-label="${t('Minimize')}">${icon('minimize')}</button><button type="button" data-window="maximize" title="${t('Maximize')}" aria-label="${t('Maximize')}">${icon('maximize')}</button><button type="button" data-window="close" title="${t('Close')}" aria-label="${t('Close')}">${icon('close')}</button>`;
  $('#sidebar').innerHTML=`<h2>${t('Profiles')}</h2><div class="profile-list">${data.profiles.map(p=>`<button data-profile="${escape(p.id)}" aria-label="${escape(p.name)}" class="${p.id===selectedProfile&&view==='profiles'?'active':''}">${icon('folder')}<span class="profile-name">${escape(p.name)}</span><span class="profile-count" aria-hidden="true">${p.jobs.length}</span></button>`).join('')}</div><div class="nav-actions">${button('New profile','new-profile','plus','',dis())}${button('Run all profiles','run-all','play','',dis()||(!data.profiles.some(p=>p.jobs.length)?'disabled':''))}</div><div class="nav-bottom">${button('Activity','activity','activity',view==='activity'?'active':'')}${button('Settings','settings','settings',view==='settings'?'active':'')}</div>`;
  const wide=view!=='profiles'||!data.profiles.length;$('.shell').classList.toggle('wide',wide);$('#inspector').hidden=wide;
  if(view==='settings')renderSettings();else if(view==='activity')renderHistory();else renderProfiles();
  renderProgress();
}
function renderProfiles(){
  const p=profile();
  if(!p){$('#main').innerHTML=`<div class="empty">${icon('folder')}<h1>${t('Your backup routine, in one place.')}</h1><p>${t('Create a profile, add your source and destination, then run whenever you need.')}</p>${button('Create your first profile','new-profile','plus','primary')}</div>`;return;}
  $('#main').innerHTML=`<div class="heading"><div><h1>${escape(p.name)}</h1><p class="subtitle">${p.jobs.length} ${t(p.jobs.length===1?'backup job':'backup jobs')}</p></div><div class="header-actions"><label class="default-mode">${t('Default mode')}<select id="profile-mode" ${dis()}><option value="mirror" ${p.mode==='mirror'?'selected':''}>${t('Mirror')}</option><option value="copy" ${p.mode==='copy'?'selected':''}>${t('Copy & overwrite')}</option></select></label>${button(busy?'Cancel profile':'Run profile',busy?'cancel':'run-profile',busy?'stop':'play','primary',!busy&&!p.jobs.length?'disabled':'')}${button('Add job','new-job','plus','outline',dis())}<button class="icon" data-action="profile-menu" title="${t('Profile settings')}" aria-label="${t('Profile settings')}" ${dis()}>${icon('more')}</button></div></div><div class="work-list"><div class="work-list-title"><h2>${t('Backup jobs')}</h2><span>${t('Select a job to edit its source, destination and mode.')}</span></div><div class="jobs">${p.jobs.map(j=>renderJob(j,p)).join('')}</div>${!p.jobs.length?`<div class="empty small">${icon('folder')}<h2>${t('No jobs in this profile')}</h2><p>${t('Add a folder or file to get started.')}</p></div>`:''}</div>`;
  renderInspector();
}
function renderJob(j,p){
  const state=progress.jobId===j.id&&busy?progress.phase:results[j.id]?.status||'ready';
  const title=state==='warning'?'Completed with warnings':state[0].toUpperCase()+state.slice(1);
  const active=busy&&progress.jobId===j.id&&['copying','deleting','scanning'].includes(state);
  return `<article class="job ${j.id===selectedJob?'selected':''}" data-job="${escape(j.id)}" tabindex="0" aria-label="${escape(j.name)}"><div class="job-top"><div class="job-title">${icon('file')}<span>${escape(j.name)}</span></div><div class="job-status ${state}" title="${escape(results[j.id]?.error||'')}">${icon(active?'spin':['failed','warning'].includes(state)?'error':state==='queued'?'clock':'check',active?'spin':'')}<span>${t(title)}</span></div></div><div class="job-route"><div class="path source-path"><span class="label">${t('Source')}</span><span class="path-value" title="${escape(j.source)}">${escape(j.source||'—')}</span></div><div class="route-arrow" aria-hidden="true">→</div><div class="path destination-path"><span class="label">${t('Destination')}</span><span class="path-value" title="${escape(j.destination)}">${escape(j.destination||'—')}</span></div></div><div class="job-bottom"><div class="job-mode"><select aria-label="${t('Mode')} ${escape(j.name)}" id="mode-${escape(j.id)}" data-mode-job="${escape(j.id)}" ${dis()}>${modeOptions(j.mode,p.mode)}</select></div><div class="row-actions"><button data-run-job="${escape(j.id)}" ${dis()}>${icon('play')}<span>${t('Run')}</span></button></div></div>${active?'<div class="job-progress" data-job-progress></div>':''}</article>`;
}
function modeOptions(value,parent){return `<option value="inherit" ${value==='inherit'?'selected':''}>${t('Inherited')}: ${modeName(parent)}</option><option value="mirror" ${value==='mirror'?'selected':''}>${t('Mirror')}</option><option value="copy" ${value==='copy'?'selected':''}>${t('Copy & overwrite')}</option>`;}
function renderInspector(){
  const j=job(),p=profile();
  if(!j){$('#inspector').innerHTML=`<h2>${t('Job settings')}</h2><p class="help">${t('Select a job to edit its paths and mode.')}</p>`;return;}
  const effective=j.mode==='inherit'?p.mode:j.mode;
  $('#inspector').innerHTML=`<h2>${t('Job settings')}</h2><form id="job-form"><label class="field"><span>${t('Name')}</span><input type="text" name="name" value="${escape(j.name)}" required maxlength="100" ${dis()}></label><div class="divider"></div>${['source','destination'].map(k=>`<label class="field"><span>${t(k==='source'?'Source':'Destination')}</span><div class="path-picker"><input type="text" name="${k}" value="${escape(j[k])}" title="${escape(j[k])}" required ${dis()}><button type="button" class="icon" data-pick="${k}" title="${t('Choose folder')}" aria-label="${t('Choose folder')} ${t(k==='source'?'Source':'Destination')}" ${dis()}>${icon('folder')}</button>${k==='source'?`<button type="button" class="icon" data-pick-file="source" title="${t('Choose file')}" aria-label="${t('Choose file')}" ${dis()}>${icon('file')}</button>`:''}</div></label>`).join('')}<div class="divider"></div><label class="field"><span>${t('Mode')}</span><select name="mode" ${dis()}>${modeOptions(j.mode,p.mode)}</select></label><p class="help">${t(effective==='mirror'?'Keep the destination identical to the source. Extra destination files will be deleted after confirmation.':'Update matching files. Keep extra destination files.')}</p><div class="inspector-bottom"><button type="submit" class="outline" ${dis()}>${t('Save changes')}</button>${button('Remove job','remove-job','trash','danger',dis())}<small class="muted">${busy?t('Settings locked while running'):''}</small></div></form>`;
}
function renderSettings(){
  const s=data.settings;
  const engine=robocopyInfo.state==='checking'?`<p class="help">${t('Checking Robocopy…')}</p>`:robocopyInfo.available?`<p class="engine-state ready">${t('Robocopy is available')}</p><div class="engine-path"><span>${t('Executable used for backups')}</span><code>${escape(robocopyInfo.path)}</code></div>`:`<p class="engine-state unavailable">${t('Robocopy is unavailable')}</p><div class="engine-path"><span>${t('Checked path')}</span><code>${escape(robocopyInfo.path||'—')}</code></div><p class="help">${t('Robocopy is included with Windows. There is no separate download in this app. Repair Windows system files from an administrator Command Prompt, then check again.')}</p><code class="repair-command">DISM /Online /Cleanup-Image /RestoreHealth</code><code class="repair-command">sfc /scannow</code>${robocopyInfo.error?`<p class="help">${escape(robocopyInfo.error)}</p>`:''}`;
  $('#main').innerHTML=`<div class="settings-page"><div class="heading"><h1>${t('Settings')}</h1><span class="muted">${t('Version')} ${version}</span></div><section class="settings-section"><h2>${t('Appearance')}</h2><label class="setting-row">${t('Theme')}<select data-setting="theme" ${dis()}>${['dark','light','system'].map(v=>`<option value="${v}" ${s.theme===v?'selected':''}>${t(v[0].toUpperCase()+v.slice(1))}</option>`).join('')}</select></label><label class="setting-row">${t('Language')}<select data-setting="language" ${dis()}><option value="en" ${s.language==='en'?'selected':''}>English</option><option value="zh-TW" ${s.language==='zh-TW'?'selected':''}>繁體中文</option></select></label></section><section class="settings-section"><div class="setting-heading"><h2>${t('File transfer')}</h2>${button('Check again','robocopy-check',null,'outline')}</div>${engine}<p class="help">${t('Robocopy writes directly to the destination. If canceled or disconnected, the current file may be incomplete. Run the backup again to finish.')}</p></section><section class="settings-section"><h2>${t('Updates')}</h2>${[['autoCheck','Automatically check for updates'],['autoDownload','Automatically download updates'],['autoInstall','Automatically install when idle']].map(([key,label])=>`<label class="toggle"><span>${t(label)}</span><input type="checkbox" data-setting="${key}" ${s[key]?'checked':''} ${dis()}></label>`).join('')}<p class="help update-install-help">${t('Automatic installation restarts the app when no backup or review is active.')}</p><p id="update-state" class="help">${updateMessage()}</p><div class="update-actions">${button('Check for updates','update-check',null,'outline',busy?'disabled':'')}${update.state==='available'?button('Download update','update-download',null,'primary',dis()):''}${update.state==='ready'?button('Install and restart','update-install',null,'primary',dis()):''}</div></section></div>`;
  const startupStatus=loginInfo.state==='ready'?(loginInfo.available?(loginInfo.active?'Windows startup is active.':s.startWithWindows?(loginInfo.configured?'Windows startup is configured but currently inactive.':'Windows startup could not be registered. Check Windows Startup apps.'):'Windows startup is off.'):'Windows startup can be configured in the installed app.'):loginInfo.state==='error'?'Could not check Windows startup status.':loginInfo.state==='preview'?'Design preview — Windows startup is not configured.':'Checking Windows startup…';
  $('#main .settings-page').insertAdjacentHTML('beforeend',`<section class="settings-section startup-section"><h2>${t('Startup & window')}</h2><div class="startup-options"><div><label class="toggle"><span>${t('Start when I sign in to Windows')}</span><input type="checkbox" data-setting="startWithWindows" ${s.startWithWindows?'checked':''} ${dis()||loginInfo.state!=='ready'||!loginInfo.available?'disabled':''}></label><p class="help">${t('Launches after you sign in to Windows.')}</p><p class="startup-status ${loginInfo.state==='ready'&&s.startWithWindows&&!loginInfo.active?'unavailable':''}" role="status">${t(startupStatus)}</p></div><div><label class="setting-row"><span>${t('When closing the window')}</span><select data-setting="closeBehavior" ${dis()}><option value="quit" ${s.closeBehavior!=='tray'?'selected':''}>${t('Quit')}</option><option value="tray" ${s.closeBehavior==='tray'?'selected':''}>${t('Keep running in notification area')}</option></select></label><p class="help">${t('Use the notification area icon to reopen or quit.')}</p></div></div></section>`);
  const locations=storageInfo.state==='ready'?['settings','logs'].map(kind=>`<div class="storage-location"><div class="storage-location-title"><strong>${t(kind==='settings'?'Settings file':'Activity logs')}</strong><div class="storage-actions">${button('Open in Explorer','open-storage','folder','outline',`data-kind="${kind}"`)}<button class="icon storage-copy" data-action="copy-storage" data-kind="${kind}" title="${t('Copy path')}" aria-label="${t('Copy path')} ${t(kind==='settings'?'Settings file':'Activity logs')}">${icon('copy')}</button></div></div><code>${escape(storageInfo[kind])}</code></div>`).join(''):`<p class="help">${t(storageInfo.state==='preview'?'Design preview — local paths are shown only in the desktop app.':storageInfo.state==='error'?'Could not load local data paths.':'Loading local data paths…')}</p>`;
  $('#main .settings-page').insertAdjacentHTML('beforeend',`<section class="settings-section storage-section"><h2>${t('Local data')}</h2><p class="help">${t('Settings and activity records stay on this computer. Backup files remain in their chosen destinations.')}</p>${locations}</section>`);
}
function updateMessage(){const names={unconfigured:'Update source is not configured for this build.',checking:'Checking for updates…',current:'You are up to date.',available:'An update is available.',downloading:'Downloading update…',ready:'Update is ready to install.',idle:'Check for updates'};return escape(update.state==='error'?update.error:t(names[update.state]||'Check for updates'))+(update.percent?` ${Math.floor(update.percent)}%`:'');}
function activityGroups(){
  const seen=new Set(),groups=[];
  for(const record of history){
    if(!record.runId||record.operation){groups.push(record);continue;}
    if(seen.has(record.runId))continue;
    seen.add(record.runId);
    const events=history.filter(item=>item.runId===record.runId),summary=events.find(item=>item.summary)||record;
    groups.push({...summary,legacyEvents:events,name:summary.jobName||t('Backup run')});
  }
  return groups;
}
function activityStatus(status){return t(status==='warning'?'Completed with warnings':status==='link-skipped'?'Link skipped':status||'completed');}
function timingDetails(timings){
  if(!Number.isFinite(timings?.totalMs))return `<p class="activity-timing-missing">${t('No timing breakdown for this run.')}</p>`;
  const total=Math.max(0,timings.totalMs),parts=[['scanMs','Scanning'],['robocopyMs','Robocopy'],['deleteMs','Mirror deletion'],['otherMs','Other work']];
  return `<section class="activity-timing"><div class="activity-timing-head"><strong>${t('Time breakdown')}</strong><span>${t('Total active time')}: ${elapsed(total)}</span></div><p>${t('Review waiting time is excluded. Scanning includes preview and safety checks.')}</p><div class="activity-timing-list">${parts.map(([key,label])=>{const value=Math.max(0,Number(timings[key])||0),percent=total?Math.min(100,Math.round(value/total*100)):null;return `<div class="activity-timing-row"><span>${t(label)}</span><span class="activity-timing-duration">${elapsed(value)}</span><span class="activity-timing-percent">${percent===null?'—':`${percent}%`}</span><progress class="activity-timing-meter" max="100" value="${percent??0}" aria-hidden="true"></progress></div>`;}).join('')}</div></section>`;
}
function activityCommands(job){
  const commands=[];
  if(job.previewCommand)commands.push([t('Preview command'),job.previewCommand]);
  for(const command of job.recheckCommands||[])commands.push([t('Safety recheck command'),command]);
  if(job.command)commands.push([t('Transfer command'),job.command]);
  return commands.map(([label,command])=>`<p class="activity-label">${label}</p><code class="log-command">${escape(command)}</code>`).join('');
}
function activityDetails(record){
  const timing=timingDetails(record.timings);
  if(record.operation)return timing+record.jobs.map(job=>`<section class="activity-job"><strong>${escape(job.profile?job.profile+' / '+job.name:job.name)}</strong><span class="activity-result ${escape(job.status)}">${escape(activityStatus(job.status))}</span>${job.source?`<p>${t('Source')}: ${escape(job.source)}<br>${t('Destination')}: ${escape(job.destination)}</p>`:''}${activityCommands(job)}${Number.isInteger(job.exitCode)?`<p>${t(job.exitCode<8?'Robocopy succeeded':'Robocopy failed')} · ${t('Exit code')}: ${job.exitCode}</p>`:''}${job.copied!==undefined&&job.copied!==null?`<p>${job.copied} ${t('copied')} · ${job.skipped??'—'} ${t('skipped')} · ${job.deleted??0} ${t('deleted')}${job.transferred!==null&&job.transferred!==undefined?` · ${bytes(job.transferred)} ${t('Transferred')}`:''}</p>`:''}${job.skippedLinks?.length?`<p>${t('Links skipped')}: ${job.skippedLinks.length}</p>`:''}${job.error?`<p class="error">${escape(job.error)}</p>`:''}</section>`).join('');
  const events=record.legacyEvents||[record];
  return timing+events.map(event=>`<p><strong>${escape(event.jobName||activityStatus(event.status))}</strong> · ${escape(activityStatus(event.status))}${event.command?`<br><code class="log-command">${escape(event.command)}</code>`:''}${event.error?`<br><span class="error">${escape(event.error)}</span>`:''}${event.reason?`<br>${escape(t(event.reason))}`:''}</p>`).join('');
}
function renderHistory(){
  $('#main').innerHTML=`<div class="heading"><div><h1>${t('Activity')}</h1><p class="subtitle">${t('One entry per backup run. Open it for commands and results.')}</p></div><div class="header-actions">${button('Refresh','refresh','activity','outline')}${button('Open log folder','logs','folder','outline')}</div></div>${history.length?`<div class="activity-list">${activityGroups().map(record=>`<details class="activity-entry"><summary><span class="activity-time">${escape(new Date(record.time).toLocaleString(data.settings.language))}</span><strong>${escape(record.name||record.jobName||t('Backup run'))}</strong><span class="activity-result ${escape(record.status||'')}">${escape(activityStatus(record.status))}</span><span class="activity-count">${jobCount(record.totalJobs??record.finishedJobs??1)}</span></summary><div class="activity-detail">${activityDetails(record)}</div></details>`).join('')}</div>`:`<div class="empty">${icon('activity')}<h2>${t('No activity yet')}</h2><p>${t('Completed backup runs will appear here.')}</p></div>`}`;
  if(preview){const sample=$('.activity-entry .activity-count');if(sample){sample.className='activity-sample';sample.textContent=t('Design preview — no files are copied');}}
}
function renderProgress(){
    const p=progress,phase=p.phase||'idle',running=['scanning','copying','finalizing','deleting','review'].includes(phase),indeterminate=['scanning','copying','deleting','finalizing'].includes(phase)||p.indeterminate;
    const percentage=['completed','warning'].includes(phase)?100:0;
    const completedJobs=Number.isInteger(p.finishedJobs)&&Number.isInteger(p.totalJobs)?`${p.finishedJobs}/${p.totalJobs} ${t('jobs completed')}`:'';
    const root=$('#progress');
    root.classList.toggle('is-active',running);
    if(!root.querySelector('[data-progress-title]'))root.innerHTML=`<div class="progress-title"><span data-progress-title></span><small data-progress-subtitle></small></div><div class="progress-body"><div class="progress-meta"><span data-progress-left></span><span data-progress-right></span></div><progress max="100"></progress><div class="current-file"></div></div><button class="progress-log" data-action="activity">${icon('activity')}<span data-label></span></button><button class="outline update-notice" data-action="settings" hidden>${icon('check')}<span data-label></span></button><button class="outline progress-cancel" data-action="cancel">${icon('stop')}<span data-label></span></button>`;
    const title=phase==='idle'?'Waiting for your next backup':phase==='completed'?'Transfer complete':phase==='failed'?'Backup finished with errors':phase==='warning'?'Completed with warnings':phase[0].toUpperCase()+phase.slice(1);
    root.querySelector('[data-progress-title]').textContent=t(title);
    root.querySelector('[data-progress-subtitle]').textContent=phase==='idle'?t('All files stay on your chosen drives.'):[p.jobName,completedJobs,p.warnings?`${p.warnings} ${t('Links skipped')}`:''].filter(Boolean).join(' · ');
    root.querySelector('[data-progress-left]').textContent=phase==='scanning'?`${p.count||0} ${t('found')}`:phase==='review'?t('Review every destination before starting.'):phase==='copying'?t('Robocopy is transferring files…'):phase==='deleting'?t('Removing confirmed destination items…'):phase==='finalizing'?t('Finishing backup…'):[p.copied!==null&&p.copied!==undefined?`${p.copied} ${t('copied')}`:'',p.skipped!==null&&p.skipped!==undefined?`${p.skipped} ${t('skipped')}`:'',p.deleted?`${p.deleted} ${t('deleted')}`:''].filter(Boolean).join(' · ');
    root.querySelector('[data-progress-right]').textContent=indeterminate?t('No overall percentage available'):phase==='review'?'':p.transferred===null?t('Transferred amount unavailable'):`${t('Transferred')}: ${bytes(p.transferred)}`;
    const bar=root.querySelector('progress');bar.hidden=['idle','review','failed','canceled'].includes(phase);if(indeterminate)bar.removeAttribute('value');else bar.value=percentage;
    root.querySelector('.progress-body').hidden=phase==='idle';
    const file=root.querySelector('.current-file');file.textContent=p.currentFile?`${t('Current file')}: ${p.currentFile}`:'';file.title=p.currentFile||'';
    root.querySelector('.progress-log [data-label]').textContent=t('View log');
    const notice=root.querySelector('.update-notice');notice.hidden=update.state!=='ready';notice.querySelector('[data-label]').textContent=t('Update ready to install');
    const cancel=root.querySelector('.progress-cancel');cancel.hidden=!running;cancel.querySelector('[data-label]').textContent=t('Cancel');
    const jp=$('[data-job-progress]');if(jp)jp.innerHTML=`<progress ${indeterminate?'':'value="100" max="100"'}></progress><div class="progress-meta">${t('Robocopy is transferring files…')}</div><div class="current-file">${t('Current file')}: ${escape(p.currentFile||'')}</div>`;
  }


function modal(html){const d=$('#dialog');d.innerHTML=html;if(!d.open)d.showModal();}
function closeModal(){$('#dialog').close();}
function nameDialog(type){const rename=type==='rename';modal(`<form id="name-form" data-kind="${rename?'rename':'new'}"><h2>${t(rename?'Rename profile':'Create profile')}</h2><label class="field"><span>${t('Profile name')}</span><input name="name" type="text" required maxlength="100" value="${rename?escape(profile().name):''}" autofocus></label><div class="actions">${button('Cancel','close') }<button class="primary" type="submit">${t(rename?'Save changes':'Create')}</button></div></form>`);}
function jobDialog(){
  const p=profile();
  modal(`<form id="new-job-form"><h2>${t('Create job')}</h2><p class="help">${t('Set a source and destination before adding this job to the profile.')}</p><label class="field"><span>${t('Name')}</span><input name="name" type="text" value="${escape(t('Backup job'))}" required maxlength="100" autofocus></label>${['source','destination'].map(k=>`<label class="field"><span>${t(k==='source'?'Source':'Destination')}</span><div class="path-picker"><input type="text" name="${k}" required><button type="button" class="icon" data-pick="${k}" title="${t('Choose folder')}" aria-label="${t('Choose folder')} ${t(k==='source'?'Source':'Destination')}">${icon('folder')}</button>${k==='source'?`<button type="button" class="icon" data-pick-file="source" title="${t('Choose file')}" aria-label="${t('Choose file')}">${icon('file')}</button>`:''}</div></label>`).join('')}<label class="field"><span>${t('Mode')}</span><select name="mode">${modeOptions('inherit',p.mode)}</select></label><div class="actions">${button('Cancel','close')}<button class="primary" type="submit">${t('Create job')}</button></div></form>`);
  $('#new-job-form input[name=name]').focus();
}
function revealInspector(){
  if(!matchMedia('(max-width: 1130px)').matches)return;
  const inspector=$('#inspector');inspector.tabIndex=-1;inspector.focus({preventScroll:true});inspector.scrollIntoView({behavior:'smooth',block:'start'});
}
async function runSelection(selection){
  await saveQueue;busy=true;progress={phase:'scanning'};render();
  try{
    const plan=await api.prepare(selection);
    if(!busy){await api.cancel();return;}
    const deletions=plan.jobs.flatMap(j=>j.remove);
    modal(`<h2>${t('Review backup')}</h2><p class="help">${t('Robocopy decides the actual transfers. Preview counts are estimates.')}</p><p class="help">${t('Direct writes: interrupted files may be incomplete. Run the backup again to finish.')}</p>${plan.jobs.map(j=>`<section class="review-job"><strong>${escape(j.profile)} / ${escape(j.name)}</strong><p>${escape(j.source)}<br>→ ${escape(j.destination)}</p><div class="review-stats"><span>${modeName(j.mode)}</span><span>${j.copy} ${t('Potential updates')}</span><span>${j.remove.length} ${t('Items to delete')}</span></div>${j.skippedLinks?.length?`<details class="link-notice" open><summary>${t('Links skipped')} (${j.skippedLinks.length})</summary><p>${t('Other files will be backed up. Links and their targets will not be copied or recreated. Matching destination content will be preserved.')}</p><ul>${j.skippedLinks.map(link=>`<li>${escape(link.source)}<br>${t('Preserved destination')}: ${escape(link.destination)}</li>`).join('')}</ul></details>`:''}${j.remove.length?`<details open><summary>${t('Destination-only items')} (${j.remove.length})</summary><ul>${j.remove.map(f=>`<li>${escape(f.path)}</li>`).join('')}</ul></details>`:''}</section>`).join('')}${plan.errors.length?`<h3>${t('These jobs will not run')}</h3>${plan.errors.map(e=>`<p class="error-box">${escape(e.jobName)}: ${escape(e.error)}</p>`).join('')}`:''}${deletions.length?`<label class="consent"><input id="delete-consent" type="checkbox">${t('I reviewed the deletion list and allow these items to be deleted.')}</label>`:`<p class="help">${t('No files will be deleted.')}</p>`}<div class="actions">${button('Cancel','cancel') }<button id="confirm-run" class="primary" ${deletions.length||!plan.jobs.length?'disabled':''}>${t('Start backup')}</button></div>`);
    const ready=()=>$('#confirm-run').disabled=!plan.jobs.length||(deletions.length&&!$('#delete-consent').checked);
    $('#delete-consent')?.addEventListener('change',ready);
    $('#confirm-run').onclick=async()=>{const confirmDelete=$('#delete-consent')?.checked===true;closeModal();for(const j of plan.jobs)results[j.id]={status:'queued'};render();try{const result=await api.run(plan.token,{confirmDelete});if(preview)progress={phase:result.phase};}catch(e){toast(e.message);progress={phase:'failed'};}finally{busy=false;history=await api.history();render();}};
  }catch(e){busy=false;progress={phase:'idle'};toast(displayError(e));render();}
}
const actions={
  'new-profile':()=>nameDialog('new'),
  'profile-menu':()=>modal(`<h2>${t('Profile settings')}</h2><div class="actions">${button('Rename profile','rename-profile')}${button('Remove profile','remove-profile','trash','danger')}${button('Cancel','close')}</div>`),
  'rename-profile':()=>nameDialog('rename'),
  'new-job':jobDialog,
  'remove-job':()=>removeDialog('job'),'remove-profile':()=>removeDialog('profile'),
  'close':closeModal,
  'run-all':()=>runSelection({}),'run-profile':()=>runSelection({profileId:selectedProfile}),
  'cancel':async()=>{await api.cancel();closeModal();if(progress.phase==='review'||progress.phase==='scanning'){busy=false;progress={phase:'canceled'};render();}},
  'activity':async()=>{view='activity';history=await api.history();render();},'refresh':async()=>{history=await api.history();renderHistory();},
  'settings':()=>{view='settings';render();refreshRobocopyStatus();refreshStoragePaths();refreshLoginItemStatus();},'logs':()=>api.showLogs(),
  'open-storage':async b=>{try{await api.openStoragePath(b.dataset.kind);toast(t('Opened in File Explorer'));}catch(e){toast(`${t('Could not open location')}: ${e.message}`);}},
  'copy-storage':async b=>{try{await api.copyStoragePath(b.dataset.kind);toast(t('Path copied to clipboard'));}catch(e){toast(`${t('Could not copy path')}: ${e.message}`);}},
  'robocopy-check':refreshRobocopyStatus,
  'update-check':async()=>{update=await api.updates('check');renderSettings();},'update-download':async()=>{update=await api.updates('download');renderSettings();},'update-install':()=>api.updates('install')
};
function removeDialog(type){modal(`<h2>${t(type==='job'?'Remove job':'Remove profile')}</h2><p class="help">${t('Remove this configuration? Backup files will not be deleted.')}</p><div class="actions">${button('Cancel','close')}<button class="danger" id="confirm-remove">${t('Remove')}</button></div>`);$('#confirm-remove').onclick=async()=>{if(type==='job'){profile().jobs=profile().jobs.filter(j=>j.id!==selectedJob);selectedJob=profile().jobs[0]?.id;}else{data.profiles=data.profiles.filter(p=>p.id!==selectedProfile);selectedProfile=null;}await save();closeModal();render();};}
document.addEventListener('click',async e=>{
  const b=e.target.closest('button');
  try{
    if(b?.disabled)return;
    if(b?.dataset.window){await api.windowControl(b.dataset.window);return;}
    if(b?.dataset.action){e.preventDefault();await actions[b.dataset.action]?.(b);return;}
    if(b?.dataset.profile){selectedProfile=b.dataset.profile;selectedJob=profile().jobs[0]?.id;view='profiles';render();return;}
    if(b?.dataset.runJob){await runSelection({profileId:selectedProfile,jobId:b.dataset.runJob});return;}
    if(b?.dataset.pick||b?.dataset.pickFile){const key=b.dataset.pick||b.dataset.pickFile;const picked=await api.pick(b.dataset.pickFile?'file':'folder');if(picked){const form=b.closest('form');form.elements[key].value=picked.path;form.dataset[key+'Binding']=JSON.stringify(picked.volume);form.dataset[key+'Picked']=picked.path;}return;}
    const row=e.target.closest('[data-job]');if(row&&!e.target.closest('select')){selectedJob=row.dataset.job;renderProfiles();renderProgress();revealInspector();}
  }catch(error){toast(error.message);}
});
document.addEventListener('keydown',e=>{if(e.target.matches('[data-job]')&&['Enter',' '].includes(e.key)){e.preventDefault();selectedJob=e.target.dataset.job;renderProfiles();revealInspector();}});
document.addEventListener('change',async e=>{
  try{
    if(e.target.id==='profile-mode'){profile().mode=e.target.value;await save();render();}
    if(e.target.dataset.modeJob){const j=profile().jobs.find(j=>j.id===e.target.dataset.modeJob);j.mode=e.target.value;await save();render();}
    if(e.target.dataset.setting){const key=e.target.dataset.setting,previous=data.settings[key];data.settings[key]=e.target.type==='checkbox'?e.target.checked:e.target.value;try{await save();}catch(error){data.settings[key]=previous;render();throw error;}render();if(key==='startWithWindows')refreshLoginItemStatus();}
  }catch(error){toast(error.message);}
});
document.addEventListener('submit',async e=>{
  e.preventDefault();const form=e.target;
  if(form.dataset.submitting==='true')return;
  form.dataset.submitting='true';const submitButton=form.querySelector('[type=submit]');if(submitButton)submitButton.disabled=true;
  try{
    if(form.id==='name-form'){
      const name=form.elements.name.value.trim();if(!name)throw new Error(t('Enter a profile name.'));
      if(form.dataset.kind==='rename'){
        const p=profile(),previous=p.name;p.name=name;
        try{await save();}catch(error){p.name=previous;throw error;}
      }else{
        const p={id:crypto.randomUUID(),name,mode:'mirror',jobs:[]};data.profiles.push(p);
        try{await save();}catch(error){data.profiles=data.profiles.filter(item=>item.id!==p.id);throw error;}
        selectedProfile=p.id;selectedJob=null;view='profiles';
      }
      closeModal();render();
    }
    if(form.id==='job-form'){
      const j=job();for(const key of ['source','destination']){const value=form.elements[key].value.trim();if(value!==j[key])j[key+'Volume']=form.dataset[key+'Picked']===value?JSON.parse(form.dataset[key+'Binding']||'null'):null;j[key]=value;}
      j.name=form.elements.name.value.trim();j.mode=form.elements.mode.value;await save();render();toast(t('Changes saved'));
    }
    if(form.id==='new-job-form'){
      const name=form.elements.name.value.trim(),source=form.elements.source.value.trim(),destination=form.elements.destination.value.trim();
      if(!name||!source||!destination)throw new Error(t('Enter a name, source and destination.'));
      const j={id:crypto.randomUUID(),name,source,destination,mode:form.elements.mode.value};
      for(const key of ['source','destination'])j[key+'Volume']=form.dataset[key+'Picked']===j[key]?JSON.parse(form.dataset[key+'Binding']||'null'):null;
      const p=profile();p.jobs.push(j);
      try{await save();}catch(error){p.jobs=p.jobs.filter(item=>item.id!==j.id);throw error;}
      selectedJob=j.id;closeModal();render();revealInspector();toast(t('Job created'));
    }
  }catch(error){toast(displayError(error));}
  finally{delete form.dataset.submitting;if(submitButton)submitButton.disabled=false;}
});
$('#dialog').addEventListener('cancel',e=>{if(busy){e.preventDefault();actions.cancel();}});
api.onProgress(value=>{const changed=value.phase!==progress.phase||value.jobId!==progress.jobId;progress=value;if(changed&&view==='profiles')renderProfiles();renderProgress();});
api.onResult(result=>{results[result.jobId]=result;if(view==='profiles'){renderProfiles();renderProgress();}});
api.onUpdate(value=>{const becameReady=value.state==='ready'&&update.state!=='ready';update=value;if(view==='settings')renderSettings();renderProgress();if(becameReady)toast(t('Update is ready to install.'));});
api.onLogError(message=>toast(message));
matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>applyTheme());
async function refreshRobocopyStatus(){
  robocopyInfo={state:'checking'};if(view==='settings')renderSettings();
  try{robocopyInfo={state:'ready',...await api.robocopyStatus()};}
  catch(e){robocopyInfo={state:'ready',available:false,path:'',error:e.message};}
  if(view==='settings')renderSettings();
}
async function refreshStoragePaths(){
  if(preview){storageInfo={state:'preview'};if(view==='settings')renderSettings();return;}
  storageInfo={state:'loading'};if(view==='settings')renderSettings();
  try{storageInfo={state:'ready',...await api.storagePaths()};}
  catch(e){storageInfo={state:'error',error:e.message};}
  if(view==='settings')renderSettings();
}
async function refreshLoginItemStatus(){
  if(preview){loginInfo={state:'preview'};if(view==='settings')renderSettings();return;}
  loginInfo={state:'checking'};if(view==='settings')renderSettings();
  try{loginInfo={state:'ready',...await api.loginItemStatus()};}
  catch(error){loginInfo={state:'error',error:error.message};}
  if(view==='settings')renderSettings();
}
try{const initial=await api.load();data=initial.data;history=initial.history;version=initial.version;update=initial.update;selectedProfile=data.profiles[0]?.id;selectedJob=profile()?.jobs[0]?.id;render();refreshRobocopyStatus();}catch(e){$('#main').textContent=e.message;}
