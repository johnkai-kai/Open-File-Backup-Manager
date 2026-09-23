const rawFs=process.versions.electron?require('original-fs'):require('node:fs');
const fs=rawFs.promises;
const path=require('node:path');
const os=require('node:os');
const {spawn}=require('node:child_process');
const {safePath,inside,stat}=require('./engine.cjs');

const executable=()=>path.join(process.env.SystemRoot||'C:\\Windows','System32','robocopy.exe');
const copyStatuses=new Map([['New File','file'],['新檔案','file'],['New Dir','dir'],['新目錄','dir'],['Older','file'],['較舊','file'],['Newer','file'],['較新','file'],['Changed','file'],['已變更','file'],['Modified','file'],['Tweaked','file']]);
const extraStatuses=new Map([['*EXTRA File','file'],['*其他檔案','file'],['*EXTRA Dir','dir'],['*其他目錄','dir']]);
const quote=value=>'"'+value.replace(/(\\*)"/g,'$1$1\\"').replace(/(\\+)$/,'$1$1')+'"';
async function verifyItems(items,signal,work){
  for(let start=0;start<items.length;start+=32)await Promise.all(items.slice(start,start+32).map(async item=>{
    if(signal?.aborted)throw new Error('Canceled');
    await work(item);
  }));
}

function relativePath(root,full,allowRoot=false){
  if(!path.isAbsolute(full)||full.split(/[\\/]/).includes('..')||!inside(root,full))throw new Error('Robocopy preview reported a path outside its expected root.');
  const relative=path.relative(root,full);
  if(!relative&&!allowRoot)throw new Error('Robocopy preview reported the backup root as an item.');
  return relative;
}

function parsePreviewLog(text,source,destination){
  if(!text.startsWith('\uFEFF'))throw new Error('Robocopy preview log is not Unicode.');
  const copy=[],remove=[];
  for(const line of text.slice(1).split(/\r?\n/)){
    if(!line.trim())continue;
    const tab=line.lastIndexOf('\t');
    if(tab<0)throw new Error('Unrecognized Robocopy preview output: '+line.slice(0,120));
    const description=line.slice(0,tab).trim(),rawPath=line.slice(tab+1).trim();
    const match=/^(.*?)(-?(?:\d+|\d{1,3}(?:[,.]\d{3})+))$/.exec(description);
    if(!match||!path.isAbsolute(rawPath))throw new Error('Unrecognized Robocopy preview output: '+line.slice(0,120));
    const status=match[1].trim().replace(/\s+/g,' '),size=Number(match[2].replace(/[,.]/g,''));
    if(!Number.isSafeInteger(size))throw new Error('Unrecognized Robocopy preview size.');
    const full=path.resolve(rawPath);
    if(!status){relativePath(source,full,true);continue;}
    if(status==='*MISMATCH'||status==='*不相符')throw new Error('Robocopy reported a file/folder conflict. Resolve it before backup.');
    if(extraStatuses.has(status)){
      const relative=relativePath(destination,full);
      const kind=extraStatuses.get(status);
      remove.push({kind,status,relativePath:relative,source:path.join(source,relative),destination:full,bytes:kind==='file'&&size>=0?size:null});
      continue;
    }
    if(!copyStatuses.has(status))throw new Error('Unrecognized Robocopy preview status: '+status);
    const kind=copyStatuses.get(status),relative=relativePath(source,full,kind==='dir');
    copy.push({kind,status,relativePath:relative,source:full,destination:path.join(destination,relative),bytes:kind==='dir'?null:size});
  }
  return {copy,remove};
}

function run(command,args,signal){
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{windowsHide:true,stdio:'ignore'});
    let settled=false;
    const abort=()=>child.kill();
    const finish=(error,code)=>{
      if(settled)return;
      settled=true;signal?.removeEventListener('abort',abort);
      if(error)reject(error);else resolve(code);
    };
    signal?.addEventListener('abort',abort,{once:true});
    child.once('error',error=>finish(error));
    child.once('close',code=>finish(null,code));
    if(signal?.aborted)abort();
  });
}

async function previewRobocopy(sourcePath,destinationPath,{signal,logRoot=os.tmpdir(),excludedLinks=[],mode='mirror'}={}){
  if(process.platform!=='win32')throw new Error('Robocopy requires Windows.');
  if(signal?.aborted)throw new Error('Canceled');
  if(mode!=='mirror'&&mode!=='copy')throw new Error('Invalid backup mode.');
  const source=await safePath(sourcePath),destination=await safePath(destinationPath);
  if(inside(source,destination)||inside(destination,source))throw new Error('Source and destination cannot overlap.');
  if(destination.toLowerCase()===path.parse(destination).root.toLowerCase())throw new Error('Use a dedicated destination folder, not a drive root.');
  const sourceState=await fs.lstat(source),destinationState=await stat(destination);
  if(mode==='mirror'&&!sourceState.isDirectory())throw new Error('Robocopy mirror preview requires a source folder.');
  if(!sourceState.isDirectory()&&!sourceState.isFile())throw new Error('Robocopy preview requires a source file or folder.');
  if(destinationState&&!destinationState.isDirectory())throw new Error('Robocopy preview requires a destination folder.');
  const sourceIsFile=sourceState.isFile(),commandSource=sourceIsFile?path.dirname(source):source;
  let logParent=await safePath(logRoot);
  if(inside(commandSource,logParent)||inside(destination,logParent))logParent=await safePath(path.dirname(destination));
  if(logParent.toLowerCase()===path.parse(logParent).root.toLowerCase()||inside(commandSource,logParent)||inside(destination,logParent))throw new Error('No safe preview log location outside source and destination.');
  if(!Array.isArray(excludedLinks))throw new Error('Invalid link exclusions.');
  if(sourceIsFile&&excludedLinks.length)throw new Error('Single-file preview cannot have nested link exclusions.');
  const links=[];
  for(const linkPath of excludedLinks){
    if(typeof linkPath!=='string'||!path.isAbsolute(linkPath))throw new Error('Invalid link exclusion path.');
    const link=path.resolve(linkPath),relative=relativePath(source,link);
    await safePath(path.dirname(link));
    if(!(await fs.lstat(link)).isSymbolicLink())throw new Error('Link exclusion is not a link: '+link);
    links.push({source:link,destination:path.join(destination,relative)});
  }
  const folder=await fs.mkdtemp(path.join(logParent,'.ofbm-preview-')),log=path.join(folder,'preview.log');
  const args=[commandSource,destination];
  if(sourceIsFile)args.push(path.basename(source));
  args.push('/L',...(mode==='mirror'?['/MIR']:['/E','/XX']),...(sourceIsFile?['/LEV:1']:[]),'/XJ','/COPY:DAT','/DCOPY:DA','/R:0','/W:0','/FP','/BYTES','/NP','/NJH','/NJS','/UNILOG:'+log);
  if(links.length)args.push('/XF',...links.flatMap(link=>[link.source,link.destination]),'/XD',...links.flatMap(link=>[link.source,link.destination]));
  const command={executable:executable(),args:[...args],text:[executable(),...args].map(quote).join(' ')};
  try{
    if(args.join(' ').length>24000)throw new Error('Too many links to exclude safely. Choose a narrower source folder.');
    const exitCode=await run(command.executable,args,signal);
    if(signal?.aborted)throw new Error('Canceled');
    if(exitCode===null||exitCode>=8)throw new Error('Robocopy preview failed (exit '+exitCode+').');
    const logState=await fs.stat(log);
    if(logState.size<2||logState.size>64*1024*1024)throw new Error('Robocopy preview log is missing or too large to verify.');
    const bytes=await fs.readFile(log);
    if(bytes[0]!==0xff||bytes[1]!==0xfe)throw new Error('Robocopy preview log is not UTF-16LE.');
    const {copy,remove}=parsePreviewLog(bytes.toString('utf16le'),commandSource,destination);
    if(mode==='copy'&&remove.length)throw new Error('Robocopy copy preview unexpectedly listed deletions.');
    if(sourceIsFile&&copy.some(item=>item.kind!=='file'||item.relativePath.toLowerCase()!==path.basename(source).toLowerCase()))throw new Error('Robocopy single-file preview listed an unrelated item.');
    if(Boolean(exitCode&1)!==copy.some(item=>item.kind==='file')||(mode==='mirror'&&Boolean(exitCode&2)!==(remove.length>0))||exitCode&4)throw new Error('Robocopy preview output does not match its exit code.');
    const parents=new Set([...copy,...remove].flatMap(item=>[path.dirname(item.source),path.dirname(item.destination)]));
    await verifyItems([...parents],signal,safePath);
    await verifyItems(copy,signal,async item=>{
      const [state,destinationState]=await Promise.all([stat(item.source),stat(item.destination)]);
      if(!state||(item.kind==='dir'?!state.isDirectory():!state.isFile()))throw new Error('Robocopy preview item changed while it was being verified.');
      if(destinationState?.isSymbolicLink())throw new Error('Links and junctions are not supported: '+item.destination);
    });
    await verifyItems(remove,signal,async item=>{
      const state=await stat(item.destination);
      if(state?.isSymbolicLink())throw new Error('Links and junctions are not supported: '+item.destination);
      if(!state||(item.kind==='dir'?!state.isDirectory():!state.isFile()))throw new Error('Robocopy preview item changed while it was being verified.');
    });
    return {source,destination,mode,exitCode,command,copy,remove,excludedLinks:links};
  }finally{
    await fs.unlink(log).catch(()=>{});
    await fs.rmdir(folder).catch(()=>{});
  }
}

module.exports={previewRobocopy,parsePreviewLog};
