const {_electron:electron}=require('@playwright/test');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
async function main(){
  const root=path.resolve(__dirname,'..'),fixture=path.join(root,'output','asar-smoke-'+Date.now());
  const source=path.join(fixture,'source'),destination=path.join(fixture,'destination');await fs.mkdir(source,{recursive:true});await fs.mkdir(destination);
  const bytes=Buffer.from([0,1,2,255,128,42]);await fs.writeFile(path.join(source,'default_app.asar'),bytes);await fs.writeFile(path.join(destination,'default_app.asar'),'previous');await fs.writeFile(path.join(destination,'obsolete.asar'),'extra');
  await fs.chmod(path.join(destination,'default_app.asar'),0o444);
  await fs.mkdir(path.join(source,'folder.asar'));await fs.writeFile(path.join(source,'folder.asar','file.txt'),'ordinary directory');
  const env={...process.env,OFBM_TEST_DATA:path.join(fixture,'appdata')};delete env.ELECTRON_RUN_AS_NODE;
  const app=await electron.launch((process.env.OFBM_INSTALLED_DIR||process.env.OFBM_PACKAGED)?{executablePath:path.join(process.env.OFBM_INSTALLED_DIR||path.join(root,'release/win-unpacked'),'Open File Backup Manager.exe'),args:[],env}:{args:[root],env});
  try{const page=await app.firstWindow();page.setDefaultTimeout(15000);await page.getByRole('button',{name:'Settings',exact:true}).waitFor();
    const run=async job=>page.evaluate(async job=>{const loaded=await window.backup.load();loaded.data.profiles=[{id:'asar-profile',name:'ASAR fixture',mode:'mirror',jobs:[{id:'asar-job',name:'ASAR files',...job}]}];await window.backup.save(loaded.data);const plan=await window.backup.prepare({profileId:'asar-profile'});if(plan.errors.length)throw Error(plan.errors[0].error);return window.backup.run(plan.token,{confirmDelete:true});},job);
    assert.equal((await run({source,destination,mode:'inherit'})).phase,'completed');assert.deepEqual(await fs.readFile(path.join(destination,'default_app.asar')),bytes);assert.equal(await fs.readFile(path.join(destination,'folder.asar','file.txt'),'utf8'),'ordinary directory');assert.equal(await fs.access(path.join(destination,'obsolete.asar')).then(()=>true,()=>false),false);
    const single=path.join(fixture,'single');await fs.mkdir(single);assert.equal((await run({source:path.join(source,'default_app.asar'),destination:single,mode:'copy'})).phase,'completed');assert.deepEqual(await fs.readFile(path.join(single,'default_app.asar')),bytes);
    console.log('PASS: real Electron backs up raw .asar bytes, overwrites read-only .asar, deletes extra .asar after consent, copies .asar-named directory and single-file source.');
  }finally{await app.windows()[0]?.evaluate(()=>window.backup.cancel()).catch(()=>{});await app.close();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});



