const {app,BrowserWindow,ipcMain,dialog,shell,clipboard,Menu,Tray} = require('electron');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {randomUUID} = require('node:crypto');
const {performance} = require('node:perf_hooks');
const fs = require('node:fs/promises');
const {Store,validate} = require('./store.cjs');
const {planJob,executePlan,validatePairs,safePath} = require('./engine.cjs');
const drives = require('./volumes.cjs');
const {autoUpdater} = require('electron-updater');
const {Updates}=require('./updates.cjs');
const robocopy=require('./robocopy.cjs');
const {loginItemStatus,setStartWithWindows}=require('./startup.cjs');

app.setName('Open File Backup Manager');
if(process.env.OFBM_TEST_DATA)app.setPath('userData',process.env.OFBM_TEST_DATA);
const store=new Store(app.getPath('userData'));
const page=pathToFileURL(path.join(__dirname,'../index.html')).href;
let window, tray, closeBehavior='quit', trayLanguage='en', quitting=false, busy=false, controller, pending, update={state:'unconfigured'}, lastProgress=0, lastProgressFile, logQueue=Promise.resolve();
const send=(channel,data)=>{if(window&&!window.isDestroyed())window.webContents.send(channel,data);};
const updates=new Updates(autoUpdater,{onStatus:value=>{update=value;send('update-status',value);},isIdle:()=>!busy&&!pending});
function report(data,force=false){if(force||(data.phase==='copying'&&data.currentFile&&data.currentFile!==lastProgressFile)||Date.now()-lastProgress>80){lastProgress=Date.now();lastProgressFile=data.currentFile;send('progress',data);}}
function log(record){logQueue=logQueue.catch(()=>{}).then(()=>store.log(record));logQueue.catch(e=>send('log-error',e.message));return logQueue;}
function handle(name,fn){ipcMain.handle(name,async(event,...args)=>{if(event.senderFrame!==window.webContents.mainFrame||event.senderFrame.url!==page)throw new Error('Untrusted request.');return fn(...args);});}
const idle=()=>{if(busy||pending)throw new Error('Finish or cancel the current backup first.');};
function restoreWindow(){if(window&&!window.isDestroyed()){window.show();window.focus();}}
function requestQuit(){
  if(busy||pending){if(window&&!window.isDestroyed())dialog.showMessageBox(window,{type:'info',message:'Cancel or finish the current backup before closing.'});return;}
  quitting=true;app.quit();
}
function trayMenu(){return Menu.buildFromTemplate([{label:trayLanguage==='zh-TW'?'開啟':'Open',click:restoreWindow},{label:trayLanguage==='zh-TW'?'結束程式':'Quit',click:requestQuit}]);}
function ensureTray(){
  if(!tray){tray=new Tray(path.join(__dirname,'../src/assets/app-icon.png'));tray.setToolTip('Open File Backup Manager');tray.on('click',restoreWindow);}
  tray.setContextMenu(trayMenu());
}
async function getJobs(selection,list) {
  const data=await store.read(), jobs=[];
  for(const p of data.profiles)if(!selection.profileId||selection.profileId===p.id)for(const j of p.jobs)if(!selection.jobId||j.id===selection.jobId)jobs.push({...j,profileId:p.id,profileName:p.name,mode:j.mode==='inherit'?p.mode:j.mode});
  if(!jobs.length)throw new Error('Add a backup job before running.');
  return jobs.map(j=>{try{return {...j,source:drives.resolve(j.source,j.sourceVolume,list),destination:drives.resolve(j.destination,j.destinationVolume,list)};}catch(e){return {...j,resolutionError:e.message};}});
}
async function prepare(selection={}) {
  idle(); busy=true;controller=new AbortController();
  const prepareStarted=performance.now();
  try {
    const diagnosis=await robocopy.diagnose();
    if(!diagnosis.available)throw new Error('Robocopy is unavailable. Open Settings for the detected path and Windows repair steps.');
    const volumeList=await drives.volumes(),jobs=await getJobs(selection,volumeList); await validatePairs(jobs.filter(j=>!j.resolutionError),{volumeList,protectedPaths:[app.getPath('userData'),...(app.isPackaged?[path.dirname(app.getPath('exe'))]:[__dirname,path.join(__dirname,'../src')])]});
    const plans=[],errors=[];
    for(const job of jobs){
      report({phase:'scanning',jobId:job.id,jobName:job.name},true);
      const scanStarted=performance.now();
      try{if(job.resolutionError)throw new Error(job.resolutionError);const plan=await planJob(job,{signal:controller.signal,volumeList,onScan:(currentFile,count)=>report({phase:'scanning',jobId:job.id,currentFile,count})});plan.previewScanMs=Math.round(performance.now()-scanStarted);plans.push(plan);}
      catch(e){if(controller.signal.aborted)throw e;const error={jobId:job.id,jobName:job.name,error:e.message,previewScanMs:Math.round(performance.now()-scanStarted)};errors.push(error);send('job-result',{status:'failed',...error});}
    }
    const token=randomUUID();pending={token,plans,errors,selection,created:Date.now(),previewMs:Math.round(performance.now()-prepareStarted)};
    return {token,totalBytes:plans.reduce((n,p)=>n+p.totalBytes,0),jobs:plans.map(p=>({id:p.job.id,name:p.job.name,profile:p.job.profileName,mode:p.job.mode,source:p.source,destination:p.destination,copy:p.copy.length,skippedLinks:p.skippedLinks.map(name=>({source:path.join(p.source,name),destination:path.join(p.destination,name)})),remove:p.remove.map(f=>({path:path.join(p.destination,f.name),kind:f.kind}))})),errors};
  }finally{busy=false;updates.idleChanged();report({phase:pending?'review':'idle'},true);}
}
async function run(token,confirmation={}) {
  if(busy||!pending||pending.token!==token)throw new Error('Preview expired. Scan again.');
  if(pending.plans.some(plan=>plan.remove.length)&&confirmation?.confirmDelete!==true)throw new Error('Deletion preview must be confirmed.');
  if(Date.now()-pending.created>5*60*1000){pending=null;throw new Error('Preview expired. Scan again.');}
  const batch=pending;pending=null;busy=true;controller=new AbortController();
  const runId=randomUUID();
  const started=performance.now(),scope=batch.selection.jobId?'job':batch.selection.profileId?'profile':'all';
  const name=scope==='all'?'All profiles':scope==='profile'?batch.plans[0]?.job.profileName||'Profile':batch.plans[0]?.job.name||batch.errors[0]?.jobName||'Backup job';
  const details=batch.errors.map(error=>({jobId:error.jobId,name:error.jobName,status:'failed',error:error.error,timings:{previewScanMs:error.previewScanMs}}));
  let totalBytes=batch.plans.reduce((n,p)=>n+p.totalBytes,0),finishedBytes=0,transferKnown=true,finishedJobs=0,failed=batch.errors.length,warnings=0;
  const results=[];
  try{
    for(const plan of batch.plans){
      if(controller.signal.aborted)break;
      const context={jobId:plan.job.id,jobName:plan.job.name,profileName:plan.job.profileName,finishedJobs,totalJobs:batch.plans.length,totalBytes};
      const detail={jobId:plan.job.id,name:plan.job.name,profile:plan.job.profileName,source:plan.source,destination:plan.destination,mode:plan.job.mode,status:'running',previewCommand:plan.nativePreview.text,skippedLinks:[],deletedPaths:[],timings:{previewScanMs:plan.previewScanMs}};
      details.push(detail);
      report({...context,phase:'copying',transferred:null,currentFile:null},true);
      const jobStarted=performance.now();
      try{
        const list=await drives.volumes();
        drives.requirePhysical(plan.source,list);drives.requirePhysical(plan.destination,list);
        if(await safePath(drives.resolve(plan.job.source,plan.job.sourceVolume,list))!==plan.source||await safePath(drives.resolve(plan.job.destination,plan.job.destinationVolume,list))!==plan.destination)throw new Error('Drive location changed. Scan again.');
        const result=await executePlan(plan,{signal:controller.signal,confirmDelete:true,volumeList:list,onLog:event=>{if(event.status==='command'){detail.command=event.command;detail.executable=event.executable;detail.args=event.args;}else if(event.status==='preview-command'){detail.recheckCommands??=[];detail.recheckCommands.push(event.command);}else if(event.status==='engine-result'){detail.exitCode=event.exitCode;detail.copied=event.copied;detail.skipped=event.skipped;detail.transferred=event.transferred;}else if(event.status==='timing')detail.timings[event.stage+'Ms']=event.durationMs;else if(event.status==='link-skipped'&&detail.skippedLinks.length<50)detail.skippedLinks.push(event.path);else if(event.status==='deleted'&&detail.deletedPaths.length<50)detail.deletedPaths.push(event.path);},onProgress:event=>report({...context,...event,jobTotalBytes:event.totalBytes,totalBytes,transferred:transferKnown&&event.transferred!==null?finishedBytes+event.transferred:null})});
        failed+=result.failed;warnings+=result.warnings;if(result.transferred===null)transferKnown=false;else finishedBytes+=result.transferred;results.push(result);
        Object.assign(detail,{status:result.warnings?'warning':'completed',copied:result.copied,skipped:result.skipped,deleted:result.deleted,warnings:result.warnings,transferred:result.transferred});
        send('job-result',{jobId:plan.job.id,status:result.failed?'failed':result.warnings?'warning':'completed',...result});
      }catch(e){failed++;transferKnown=false;detail.status=controller.signal.aborted?'canceled':'failed';detail.error=e.message;send('job-result',{jobId:plan.job.id,status:detail.status,error:e.message});}
      detail.timings.runMs=Math.round(performance.now()-jobStarted);
      finishedJobs++;
    }
    const phase=controller.signal.aborted?'canceled':failed?'failed':warnings?'warning':'completed';
    const counts={copied:results.every(r=>r.copied!==null)?results.reduce((n,r)=>n+r.copied,0):null,skipped:results.every(r=>r.skipped!==null)?results.reduce((n,r)=>n+r.skipped,0):null,deleted:results.reduce((n,r)=>n+r.deleted,0)};
    const timings={previewMs:batch.previewMs,runMs:Math.round(performance.now()-started)};
    for(const stage of ['previewScan','preflight','copy','verify','delete'])timings[stage+'Ms']=details.reduce((total,job)=>total+(job.timings?.[stage+'Ms']||0),0);
    timings.scanMs=timings.previewScanMs+timings.preflightMs+timings.verifyMs;
    timings.robocopyMs=timings.copyMs;
    timings.totalMs=timings.previewMs+timings.runMs;
    timings.otherMs=Math.max(0,timings.totalMs-timings.scanMs-timings.robocopyMs-timings.deleteMs);
    await log({runId,operation:true,scope,name,status:phase,durationMs:timings.runMs,timings,finishedJobs,totalJobs:batch.plans.length+batch.errors.length,failed,warnings,transferred:transferKnown?finishedBytes:null,...counts,jobs:details});
    report({phase,finishedJobs,totalJobs:batch.plans.length,failed,warnings,transferred:transferKnown?finishedBytes:null,totalBytes,...counts},true);
    return {phase,results};
  }finally{busy=false;updates.idleChanged();}
}
async function updaterSetup(){
  const data=await store.read();
  const configured=app.isPackaged&&await fs.access(path.join(process.resourcesPath,'app-update.yml')).then(()=>true,()=>false);
  updates.start(configured,data.settings);
}
handle('load',async()=>({data:await store.read(),history:await store.history(),version:app.getVersion(),update}));
handle('robocopy-status',()=>robocopy.diagnose());
handle('login-item-status',()=>loginItemStatus(app));
handle('save',async data=>{idle();validate(data);const old=await store.read(),previousJobs=new Map(old.profiles.flatMap(p=>p.jobs).map(j=>[j.id,j]));let list;for(const p of data.profiles)for(const j of p.jobs)for(const k of ['source','destination']){const previous=previousJobs.get(j.id);if(previous?.[k]===j[k]&&previous[k+'Volume'])j[k+'Volume']=previous[k+'Volume'];else if(j[k]&&!j[k+'Volume']){list??=await drives.volumes();if(await fs.access(path.win32.parse(j[k]).root).then(()=>true,()=>false))drives.requirePhysical(j[k],list);j[k+'Volume']=drives.bind(j[k],list);}}if(old.settings.startWithWindows!==data.settings.startWithWindows&&!loginItemStatus(app).available)throw new Error('Windows startup is available only in the installed Windows app.');await store.save(data);if(old.settings.startWithWindows!==data.settings.startWithWindows)try{setStartWithWindows(app,data.settings.startWithWindows);}catch(error){await store.save(old);throw error;}closeBehavior=data.settings.closeBehavior;trayLanguage=data.settings.language;if(tray){if(closeBehavior==='tray')tray.setContextMenu(trayMenu());else{tray.destroy();tray=null;}}updates.configure(data.settings);return data;});
handle('pick',async kind=>{idle();const result=await dialog.showOpenDialog(window,{properties:kind==='file'?['openFile']:['openDirectory','createDirectory']});if(result.canceled)return null;const p=result.filePaths[0];return {path:p,volume:drives.bind(p,await drives.volumes())};});
handle('prepare',prepare);
handle('run',run);
handle('cancel',()=>{controller?.abort();pending=null;updates.idleChanged();return true;});
handle('history',async()=>{await logQueue.catch(()=>{});return store.history();});
handle('storage-paths',()=>({appData:store.root,settings:store.file,logs:path.join(store.root,'logs')}));
handle('copy-storage-path',kind=>{if(!['settings','logs'].includes(kind))throw new Error('Invalid storage path.');const value=kind==='settings'?store.file:path.join(store.root,'logs');clipboard.writeText(value);return value;});
handle('open-storage-path',async kind=>{
  if(!['settings','logs'].includes(kind))throw new Error('Invalid storage path.');
  if(kind==='settings'&&await fs.access(store.file).then(()=>true,()=>false)){
    shell.showItemInFolder(store.file);
    return {path:store.file,selected:true};
  }
  const folder=kind==='settings'?store.root:path.join(store.root,'logs');
  await fs.mkdir(folder,{recursive:true});
  const error=await shell.openPath(folder);
  if(error)throw new Error(error);
  return {path:folder,selected:false};
});
handle('window-control',action=>{if(action==='minimize')window.minimize();else if(action==='maximize'){if(window.isMaximized())window.unmaximize();else window.maximize();}else if(action==='close')window.close();});
handle('show-logs',async()=>{const dir=path.join(store.root,'logs');await fs.mkdir(dir,{recursive:true});return shell.openPath(dir);});
handle('updates',async action=>{
  if(action==='install')updates.install();
  else if(action==='download')await updates.download();
  else await updates.check();
  return update;
});
if(!app.requestSingleInstanceLock())app.quit();
else app.whenReady().then(async()=>{
  const settings=(await store.read()).settings;
  closeBehavior=settings.closeBehavior;trayLanguage=settings.language;
  window=new BrowserWindow({width:1440,height:960,minWidth:1024,minHeight:700,frame:false,icon:path.join(__dirname,'../src/assets/app-icon.png'),backgroundColor:'#151a1e',title:'Open File Backup Manager',autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  window.webContents.session.setPermissionCheckHandler(()=>false);
  window.webContents.on('will-navigate',(event,url)=>{if(url!==page)event.preventDefault();});
  window.on('close',event=>{
    if(busy||pending){event.preventDefault();quitting=false;dialog.showMessageBox(window,{type:'info',message:'Cancel or finish the current backup before closing.'});return;}
    if(closeBehavior==='tray'&&!quitting&&!updates.installing){ensureTray();event.preventDefault();window.hide();}
  });
  await window.loadFile(path.join(__dirname,'../index.html'));
  await updaterSetup();send('update-status',update);
});
app.on('second-instance',restoreWindow);
app.on('window-all-closed',()=>app.quit());

app.on('before-quit',()=>{quitting=true;});
app.on('will-quit',()=>{updates.stop();tray?.destroy();tray=null;});
