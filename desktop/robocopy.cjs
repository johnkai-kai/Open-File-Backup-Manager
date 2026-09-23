const rawFs=process.versions.electron ? require('original-fs') : require('node:fs');
const fs=rawFs.promises;
const path=require('node:path');
const os=require('node:os');
const {performance}=require('node:perf_hooks');
const {spawn}=require('node:child_process');
const {safePath,findLinks,signature,stat,abort,inside}=require('./engine.cjs');
const {previewRobocopy}=require('./robocopy-preview.cjs');
const drives=require('./volumes.cjs');

const executable=()=>path.join(process.env.SystemRoot || 'C:\\Windows','System32','robocopy.exe');

async function diagnose() {
  const location=executable();
  try{await fs.access(location);}catch(e){return {available:false,path:location,error:e.message};}
  return new Promise(resolve=>{
    let help=false,done=false,timer,child;
    const finish=(available,error)=>{
      if(done)return;
      done=true;clearTimeout(timer);
      resolve({available,path:location,error:available?null:error});
    };
    try{child=spawn(location,['/?'],{windowsHide:true,stdio:['ignore','pipe','ignore']});}
    catch(e){finish(false,e.message);return;}
    child.stdout.on('data',chunk=>{if(/robocopy/i.test(chunk.toString()))help=true;});
    timer=setTimeout(()=>{child.kill();finish(false,'Robocopy did not respond within five seconds.');},5000);
    child.once('error',e=>finish(false,e.message));
    child.once('close',code=>finish(help&&(code===0||code===16),'Robocopy could not start (exit code '+code+').'));
  });
}
async function available(){return (await diagnose()).available;}

function parseNumber(value) {
  if(!/^\d{1,3}(?:[,.]\d{3})+$|^\d+$/.test(value))return null;
  const number=Number(value.replace(/[,.]/g,''));
  return Number.isSafeInteger(number)?number:null;
}
function parseSummary(output) {
  const rows={};
  for(const line of output.split(/\r?\n/)){
    const match=/^\s*(Files|Bytes|檔案|位元組)\s*:\s*(.*?)\s*$/i.exec(line);
    if(!match)continue;
    const values=match[2].split(/\s+/).map(parseNumber);
    const key=/^(Files|檔案)$/i.test(match[1])?'files':'bytes';
    if(values.length===6&&values.every(value=>value!==null))rows[key]=values;
  }
  return {copied:rows.files?.[1]??null,skipped:rows.files?.[2]??null,transferred:rows.bytes?.[1]??null};
}
async function readTail(file,limit) {
  const handle=await fs.open(file,'r').catch(()=>null);
  if(!handle)return null;
  try{
    const size=(await handle.stat()).size,start=Math.max(0,size-limit)&~1;
    const buffer=Buffer.alloc(size-start);
    const {bytesRead}=await handle.read(buffer,0,buffer.length,start);
    return buffer.subarray(0,bytesRead&~1).toString('utf16le');
  }finally{await handle.close();}
}
function quote(value){return '"'+value.replace(/(\\*)"/g,'$1$1\\"').replace(/(\\+)$/,'$1$1')+'"';}
function latestFile(output,plan) {
  const source=plan.sourceIsFile?path.dirname(plan.source):plan.source;
  for(const line of output.split(/[\r\n]+/).reverse()){
    const fields=line.split('\t');
    if(fields.length<3||parseNumber(fields.at(-2).trim())===null)continue;
    const candidate=fields.at(-1).trim(),relative=path.relative(source,candidate);
    if(relative&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative)&&plan.sourceFiles.get(relative)?.kind==='file')return candidate;
  }
  return null;
}
function previewKey(items){
  return items.map(item=>[item.kind,item.relativePath.toLowerCase(),item.status,item.bytes].join('\t')).sort().join('\n');
}
async function recheck(plan,signal,onLog){
  abort(signal);
  const links=plan.sourceIsFile?[]:await findLinks(plan.source,{signal});
  if(links.map(link=>path.relative(plan.source,link).toLowerCase()).sort().join('\n')!==plan.skippedLinks.map(link=>link.toLowerCase()).sort().join('\n'))throw new Error('Source changed since preview: links differ. Scan again.');
  const current=await previewRobocopy(plan.source,plan.destination,{signal,mode:plan.job.mode,excludedLinks:links});
  onLog({status:'preview-command',engine:'robocopy',command:current.command.text,executable:current.command.executable,args:current.command.args});
  return current;
}
function copyArgs(plan,log) {
  const source=plan.sourceIsFile?path.dirname(plan.source):plan.source;
  const args=[source,plan.destination];
  if(plan.sourceIsFile)args.push(path.basename(plan.source));
  args.push(plan.sourceIsFile?'/LEV:1':'/E','/Z','/COPY:DAT','/DCOPY:DA','/MT:8','/R:0','/W:0','/XJ','/XX','/FP','/BYTES','/NP','/NDL');
  if(plan.skippedLinks.length){
    const links=plan.skippedLinks.flatMap(name=>[path.join(plan.source,name),path.join(plan.destination,name)]);
    args.push('/XF',...links,'/XD',...links);
  }
  args.push('/UNILOG:'+log);
  if(args.join(' ').length>24000)throw new Error('Too many links to exclude safely. Choose a narrower source folder.');
  return args;
}
async function runCopy(plan,{signal,onProgress,onLog,spawnCopy}) {
  const logRoot=inside(plan.source,os.tmpdir())?plan.destination:os.tmpdir();
  const folder=await fs.mkdtemp(path.join(logRoot,'.ofbm-robocopy-log-'));
  const log=path.join(folder,'copy.log');
  let timer,reading=false;
  try{
    const location=executable(),args=Object.freeze(copyArgs(plan,log));
    const command=[location,...args].map(quote).join(' ');
    onLog({status:'command',engine:'robocopy',executable:location,args:[...args],command});
    onProgress({phase:'copying',indeterminate:true,currentFile:null,transferred:null,totalBytes:plan.totalBytes});
    timer=setInterval(async()=>{
      if(reading)return;
      reading=true;
      try{
        const tail=await readTail(log,8192),file=tail&&latestFile(tail,plan);
        if(file)onProgress({phase:'copying',indeterminate:true,currentFile:file,transferred:null,totalBytes:plan.totalBytes});
      }catch{}finally{reading=false;}
    },150);
    const copyStarted=performance.now();
    let code;
    try{
      code=await new Promise((resolve,reject)=>{
        const child=spawnCopy(location,args,{windowsHide:true,stdio:'ignore'});
        let settled=false;
        const cancel=()=>child.kill();
        const finish=(error,value)=>{
          if(settled)return;
          settled=true;signal?.removeEventListener('abort',cancel);
          if(error)reject(error);else resolve(value);
        };
        signal?.addEventListener('abort',cancel,{once:true});
        child.once('error',error=>finish(error));
        child.once('close',value=>finish(null,value));
        if(signal?.aborted)cancel();
      });
    }finally{onLog({status:'timing',stage:'copy',durationMs:Math.round(performance.now()-copyStarted)});}
    const tail=await readTail(log,65536),summary=parseSummary(tail||''),file=tail&&latestFile(tail,plan);
    if(file)onProgress({phase:'copying',indeterminate:true,currentFile:file,transferred:null,totalBytes:plan.totalBytes});
    onLog({status:'engine-result',engine:'robocopy',exitCode:code,reason:'Robocopy exit code: '+code,...summary});
    abort(signal);
    if(code===null||code>=8)throw Object.assign(new Error('Robocopy failed (exit '+code+'). Destination files may be incomplete.\n'+(tail||'No Robocopy log was available.').slice(-6000)),{code:'ROBOCOPY_FAILED'});
    return summary;
  }finally{
    clearInterval(timer);
    while(reading)await new Promise(resolve=>setTimeout(resolve,10));
    await fs.unlink(log).catch(()=>{});
    await fs.rmdir(folder).catch(()=>{});
  }
}
async function execute(plan,{signal,onProgress=()=>{},onLog=()=>{},confirmDelete=false,spawnCopy=spawn,volumeList}={}) {
  if(process.platform!=='win32')throw new Error('Robocopy requires Windows.');
  if(plan.remove.length&&!confirmDelete)throw new Error('Deletion preview must be confirmed.');
  abort(signal);
  const timed=async(stage,work)=>{const started=performance.now();try{return await work();}finally{onLog({status:'timing',stage,durationMs:Math.round(performance.now()-started)});}};
  let destinationIdentity;
  await timed('preflight',async()=>{
    const list=volumeList||await drives.volumes();
    drives.requirePhysical(plan.source,list);drives.requirePhysical(plan.destination,list);
    await safePath(plan.source);await safePath(plan.destination);
    const sourceRoot=await fs.lstat(plan.source),destinationRoot=await stat(plan.destination);
    if((sourceRoot.ino+':'+sourceRoot.dev)!==plan.sourceRootSig.split(':').slice(-2).join(':'))throw new Error('Source identity changed. Scan again.');
    if((destinationRoot?destinationRoot.dev+':'+destinationRoot.ino:null)!==plan.destinationRoot)throw new Error('Destination changed since preview. Scan again.');
    for(let start=0;start<plan.copy.length;start+=32)await Promise.all(plan.copy.slice(start,start+32).map(async item=>{
      const target=path.join(plan.destination,item.name);
      const [source,previous]=await Promise.all([fs.lstat(path.join(plan.sourceIsFile?path.dirname(plan.source):plan.source,item.name)),stat(target)]);
      if(signature(source)!==item.sig)throw new Error('Source changed since preview. Scan again.');
      if((previous?signature(previous):null)!==item.oldSig)throw new Error('Destination changed since preview. Scan again.');
    }));
    const current=await recheck(plan,signal,onLog);
    if(previewKey(current.copy)!==previewKey(plan.nativeCopy))throw new Error('Source changed since preview. Scan again.');
    if(previewKey(current.remove)!==previewKey(plan.nativeRemove))throw new Error('Destination changed since preview. Scan again.');
    await fs.mkdir(plan.destination,{recursive:true});
    const createdRoot=await fs.lstat(plan.destination);
    destinationIdentity=createdRoot.dev+':'+createdRoot.ino;
    for(const name of plan.skippedLinks)onLog({status:'link-skipped',path:path.join(plan.source,name),reason:'Link target was not backed up. Matching destination content was preserved.'});
    onLog({status:'engine',engine:'robocopy',reason:'Robocopy writes directly to the destination.'});
  });
  const summary=await runCopy(plan,{signal,onProgress,onLog,spawnCopy});
  await timed('verify',async()=>{
    if(!plan.remove.length)return;
    const current=await recheck(plan,signal,onLog);
    if(current.copy.length)throw new Error('Source changed during copying. Mirror deletions canceled. Scan again.');
    if(previewKey(current.remove)!==previewKey(plan.nativeRemove))throw new Error('Destination changed during copying. Mirror deletions canceled. Scan again.');
  });
  let deleted=0;
  if(plan.remove.length)await timed('delete',async()=>{
    abort(signal);
    await safePath(plan.destination);
    const root=await fs.lstat(plan.destination);
    if((root.dev+':'+root.ino)!==destinationIdentity)throw new Error('Destination changed. Mirror deletions canceled.');
    for(const item of plan.remove){
      const target=path.join(plan.destination,item.name);
      await safePath(target);
      if(signature(await fs.lstat(target))!==item.sig)throw new Error('Destination changed. Mirror deletions canceled.');
    }
    for(const item of plan.remove){
      abort(signal);
      const target=path.join(plan.destination,item.name);
      if(!inside(plan.destination,target))throw new Error('Deletion target escaped the destination.');
      await safePath(target);
      const current=await fs.lstat(target);
      if(item.kind==='file'&&signature(current)!==item.sig)throw new Error('Destination changed. Remaining deletions canceled.');
      if(item.kind==='dir'&&!current.isDirectory())throw new Error('Destination changed. Remaining deletions canceled.');
      onProgress({phase:'deleting',currentFile:target,transferred:summary.transferred,totalBytes:plan.totalBytes});
      abort(signal);
      if(item.kind==='dir')await fs.rmdir(target);else await fs.unlink(target);
      deleted++;onLog({status:'deleted',path:target});
    }
  });
  onProgress({phase:'finalizing',transferred:summary.transferred,totalBytes:plan.totalBytes});
  return {copied:summary.copied,failed:0,deleted,skipped:summary.skipped,warnings:plan.skippedLinks.length,transferred:summary.transferred};
}
module.exports={available,diagnose,execute,parseSummary,latestFile};
