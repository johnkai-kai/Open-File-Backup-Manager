const rawFs = process.versions.electron ? require('original-fs') : require('node:fs');
const fs = rawFs.promises;
const path = require('node:path');
const drives = require('./volumes.cjs');

const key = p => process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p);
const inside = (parent, child) => key(child) === key(parent) || key(child).startsWith(key(parent) + path.sep);
const signature = s => `${s.size}:${s.mtimeMs}:${s.ino}:${s.dev}`;
async function stat(p) { try { return await fs.lstat(p); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }
async function mapBatches(items,work){
  const results=[];
  for(let start=0;start<items.length;start+=32)results.push(...await Promise.all(items.slice(start,start+32).map(work)));
  return results;
}
function abort(signal) { if (signal?.aborted) throw Object.assign(new Error('Canceled'), {code:'ABORT_ERR'}); }
async function safePath(p) {
  if (!path.isAbsolute(p)) throw new Error('Choose an absolute path.');
  if (process.platform === 'win32') {
    if (/^\\\\[?.]\\/.test(p)) throw new Error('Windows device paths are not supported.');
    const parts = p.slice(path.parse(p).root.length).split(/[\\/]/).filter(Boolean);
    if (parts.some(part => part !== '.' && part !== '..' && (/[. ]$/.test(part) || /[:<>"|?*]/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)))) throw new Error('Ambiguous or reserved Windows path.');
  }
  for (let current = path.resolve(p);;) {
    const s = await stat(current);
    if (s?.isSymbolicLink()) throw new Error(`Links and junctions are not supported: ${current}`);
    if (path.dirname(current) === current) break;
    current = path.dirname(current);
  }
  let anchor = path.resolve(p), tail = [];
  while (!(await stat(anchor))) { if (path.dirname(anchor) === anchor) throw new Error('Path root is unavailable.'); tail.unshift(path.basename(anchor)); anchor = path.dirname(anchor); }
  return path.join(await fs.realpath(anchor), ...tail);
}
async function findLinks(root,{signal,onScan=()=>{}}={}){
  const links=[];
  async function visit(folder){
    abort(signal);
    for(const entry of await fs.readdir(folder,{withFileTypes:true})){
      abort(signal);
      const full=path.join(folder,entry.name);
      if(entry.isSymbolicLink())links.push(full);
      else if(entry.isDirectory())await visit(full);
    }
    onScan(folder,links.length);
  }
  await visit(root);
  return links;
}
async function validatePairs(jobs, {protectedPaths = [],volumeList} = {}) {
  const pairs = [];
  const list=process.platform==='win32'?(volumeList||await drives.volumes()):[];
  for (const job of jobs) {
    if (!job.source || !job.destination) throw new Error('Choose both source and destination.');
    drives.requirePhysical(job.source,list);drives.requirePhysical(job.destination,list);
    const source = await safePath(job.source), destination = await safePath(job.destination);
    if (key(destination) === key(path.parse(destination).root)) throw new Error('Use a dedicated destination folder, not a drive root.');
    if (inside(source, destination) || inside(destination, source)) throw new Error('Source and destination cannot overlap.');
    for (const protectedPath of protectedPaths) {
      const resolved = await safePath(protectedPath);
      if (inside(resolved,destination) || inside(destination,resolved)) throw new Error('Destination overlaps protected application files or settings.');
    }
    pairs.push({source, destination});
  }
  for (let a = 0; a < pairs.length; a++) for (let b = a + 1; b < pairs.length; b++) {
    const x = pairs[a], y = pairs[b];
    if (inside(x.destination,y.destination) || inside(y.destination,x.destination) || inside(x.destination,y.source) || inside(y.source,x.destination) || inside(y.destination,x.source) || inside(x.source,y.destination)) {
      throw new Error('Backup destinations must not overlap another job’s source or destination.');
    }
  }
  return pairs;
}
async function planJob(job, options = {}) {
  const [{source,destination}] = await validatePairs([job],{volumeList:options.volumeList});
  abort(options.signal);
  const sourceStat = await fs.lstat(source);
  if (!sourceStat.isDirectory() && !sourceStat.isFile()) throw new Error('Source must be a file or folder.');
  const ds = await stat(destination);
  if (ds && !ds.isDirectory()) throw new Error('Destination must be a folder.');
  const links=sourceStat.isDirectory()?await findLinks(source,options):[];
  const preview=await require('./robocopy-preview.cjs').previewRobocopy(source,destination,{signal:options.signal,mode:job.mode,excludedLinks:links});
  const skippedLinks=links.map(link=>path.relative(source,link));
  const sourceFiles=new Map();
  const copy=[],dirs=[],remove=[],skipped=[];
  const copyFiles=preview.copy.filter(item=>item.kind==='file');
  dirs.push(...preview.copy.filter(item=>item.kind==='dir').map(item=>item.relativePath));
  copy.push(...await mapBatches(copyFiles,async item=>{
    const [state,previous]=await Promise.all([fs.lstat(item.source),stat(item.destination)]);
    return {name:item.relativePath,kind:'file',size:item.bytes,mtime:state.mtimeMs,sig:signature(state),oldSig:previous?signature(previous):null};
  }));
  for(const item of copy)sourceFiles.set(item.name,item);
  remove.push(...await mapBatches(preview.remove,async item=>{
    const state=await fs.lstat(item.destination);
    return {name:item.relativePath,kind:item.kind,sig:signature(state),size:state.size};
  }));
  remove.sort((a,b) => b.name.split(path.sep).length-a.name.split(path.sep).length || (a.kind === 'file' ? -1 : 1));
  return {job,source,destination,sourceIsFile:sourceStat.isFile(),sourceFiles,sourceRootSig:signature(sourceStat),destinationRoot:ds ? `${ds.dev}:${ds.ino}` : null,copy,dirs,remove,skipped,skippedLinks,totalBytes:copy.reduce((sum,f)=>sum+f.size,0),nativePreview:preview.command,nativeCopy:preview.copy,nativeRemove:preview.remove};
}
async function executePlan(plan,options = {}) {
  if (process.platform !== 'win32') throw new Error('Robocopy requires Windows.');
  return require('./robocopy.cjs').execute(plan,options);
}
module.exports = {planJob,executePlan,validatePairs,findLinks,inside,safePath,signature,stat,abort};
