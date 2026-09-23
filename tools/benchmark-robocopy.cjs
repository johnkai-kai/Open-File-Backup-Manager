const {_electron:electron}=require('@playwright/test');
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomBytes}=require('node:crypto');
const {spawn}=require('node:child_process');
const {performance}=require('node:perf_hooks');

const root=path.resolve(__dirname,'..');
const robocopy=path.join(process.env.SystemRoot||'C:\\Windows','System32','robocopy.exe');

async function writeLarge(file,mebibytes){
  const block=randomBytes(1024*1024),handle=await fs.open(file,'w');
  try{for(let i=0;i<mebibytes;i++){let written=0;while(written<block.length)written+=(await handle.write(block,written,block.length-written,i*block.length+written)).bytesWritten;}await handle.sync();}
  finally{await handle.close();}
}
async function rawCopy(source,destination,log){
  const args=[source,destination,'/E','/Z','/COPY:DAT','/DCOPY:DA','/MT:8','/R:0','/W:0','/XJ','/FP','/BYTES','/NP','/NDL','/UNILOG:'+log];
  const started=performance.now();
  const code=await new Promise((resolve,reject)=>{const child=spawn(robocopy,args,{windowsHide:true,stdio:'ignore'});child.once('error',reject);child.once('close',resolve);});
  if(code===null||code>=8)throw Error('Raw Robocopy exit code '+code);
  return {ms:Math.round(performance.now()-started),exitCode:code};
}
async function appCopy(page,selection){
  const result=await page.evaluate(async selection=>{const plan=await window.backup.prepare(selection);const result=await window.backup.run(plan.token);const history=await window.backup.history();return {phase:result.phase,record:history[0]};},selection);
  if(!['completed','warning'].includes(result.phase))throw Error('App backup ended '+result.phase);
  return {ms:result.record.timings.totalMs,timings:result.record.timings,copied:result.record.copied,transferred:result.record.transferred};
}
async function main(){
  const fixture=await fs.mkdtemp(path.join(root,'output','benchmark-robocopy-'));
  const source=path.join(fixture,'source'),raw=path.join(fixture,'raw'),appDestination=path.join(fixture,'app');
  await Promise.all([fs.mkdir(source),fs.mkdir(raw),fs.mkdir(appDestination)]);
  await writeLarge(path.join(source,'large.bin'),256);
  const env={...process.env,OFBM_TEST_DATA:path.join(fixture,'appdata')};delete env.ELECTRON_RUN_AS_NODE;
  const app=await electron.launch({args:[root],env});
  try{
    const page=await app.firstWindow();await page.getByRole('button',{name:'Settings',exact:true}).waitFor();
    const selection=await page.evaluate(async({source,destination})=>{const {data}=await window.backup.load();data.settings.autoCheck=false;data.profiles=[{id:'benchmark-profile',name:'Benchmark',mode:'copy',jobs:[{id:'benchmark-job',name:'Files',source,destination,mode:'inherit'}]}];await window.backup.save(data);return {profileId:'benchmark-profile'};},{source,destination:appDestination});
    const fresh={raw:await rawCopy(source,raw,path.join(fixture,'raw-fresh.log')),app:await appCopy(page,selection)};
    await writeLarge(path.join(source,'added.bin'),64);
    const tiny=randomBytes(4096);
    for(let i=0;i<2000;i++)await fs.writeFile(path.join(source,`small-${String(i).padStart(4,'0')}.bin`),tiny);
    const incremental={app:await appCopy(page,selection),raw:await rawCopy(source,raw,path.join(fixture,'raw-incremental.log'))};
    const unchanged={raw:await rawCopy(source,raw,path.join(fixture,'raw-unchanged.log')),app:await appCopy(page,selection)};
    for(const name of ['large.bin','added.bin','small-0000.bin','small-1999.bin']){
      const [sourceSize,rawSize,appSize]=await Promise.all([source,raw,appDestination].map(folder=>fs.stat(path.join(folder,name)).then(item=>item.size)));
      if(sourceSize!==rawSize||sourceSize!==appSize)throw Error('Output size mismatch: '+name);
    }
    const summary={fixture,description:'256 MiB initial file; then add 64 MiB file and 2,000 x 4 KiB files; then unchanged pass. Separate destinations; local drive only.',fresh,incremental,unchanged};
    await fs.writeFile(path.join(fixture,'summary.json'),JSON.stringify(summary,null,2));
    console.log(JSON.stringify({description:summary.description,fresh,incremental,unchanged},null,2));
  }finally{await app.windows()[0]?.evaluate(()=>window.backup.cancel()).catch(()=>{});await app.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
