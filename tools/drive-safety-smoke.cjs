const {_electron:electron}=require('@playwright/test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');

const run=promisify(execFile);
const subst=path.join(process.env.SystemRoot||'C:\\Windows','System32','subst.exe');
async function mapping(letter){
  const {stdout}=await run(subst,[],{windowsHide:true});
  const prefix=`${letter}:\\: => `;
  const row=stdout.split(/\r?\n/).find(value=>value.toLowerCase().startsWith(prefix.toLowerCase()));
  return row?row.slice(prefix.length).trim():null;
}
async function freeLetter(){
  for(const letter of 'ZYXWVUTSRQP'){
    if(await mapping(letter))continue;
    if(!await fs.stat(`${letter}:\\`).then(()=>true,()=>false))return letter;
  }
  throw new Error('No free drive letter for the isolated fixture.');
}
async function main(){
  const root=path.resolve(__dirname,'..'),output=path.join(root,'output');
  await fs.mkdir(output,{recursive:true});
  const fixture=await fs.mkdtemp(path.join(output,'drive-disconnect-'));
  const source=path.join(fixture,'source'),mounted=path.join(fixture,'mounted');
  await fs.mkdir(source);await fs.mkdir(mounted);
  await fs.writeFile(path.join(source,'hello.txt'),'isolated backup');
  await fs.mkdir(path.join(mounted,'backup'));
  await fs.writeFile(path.join(mounted,'backup','obsolete.txt'),'preserve until confirmed copy');
  const letter=await freeLetter(),drive=`${letter}:`,virtualDestination=path.win32.join(`${drive}\\`,'backup');
  const destination=path.join(mounted,'backup'),disconnected=path.join(mounted,'disconnected-backup');
  let attached=false,app;
  const attach=async()=>{
    if(await mapping(letter)||await fs.stat(`${drive}\\`).then(()=>true,()=>false))throw new Error('Fixture drive letter became occupied.');
    await run(subst,[drive,mounted],{windowsHide:true});attached=true;
    if((await mapping(letter))?.toLowerCase()!==mounted.toLowerCase())throw new Error('Fixture mapping did not match its target.');
  };
  const detach=async()=>{
    if(!attached)return;
    if((await mapping(letter))?.toLowerCase()!==mounted.toLowerCase())throw new Error('Fixture drive mapping changed; refusing to remove another mapping.');
    await run(subst,[drive,'/D'],{windowsHide:true});attached=false;
  };
  try{
    await attach();
    const env={...process.env,OFBM_TEST_DATA:path.join(fixture,'appdata')};delete env.ELECTRON_RUN_AS_NODE;
    const executable=process.env.OFBM_INSTALLED_DIR
      ?path.join(process.env.OFBM_INSTALLED_DIR,'Open File Backup Manager.exe')
      :process.env.OFBM_PACKAGED?path.join(root,'release/win-unpacked/Open File Backup Manager.exe'):null;
    app=await electron.launch(executable?{executablePath:executable,args:[],env}:{args:[root],env});
    const page=await app.firstWindow();await page.getByRole('button',{name:'Settings',exact:true}).waitFor();
    const data=(await page.evaluate(()=>window.backup.load())).data;
    data.profiles=[{id:'fixture',name:'Fixture',mode:'mirror',jobs:[{id:'job',name:'Mounted destination',mode:'inherit',source,destination:virtualDestination}]}];
    await assert.rejects(page.evaluate(value=>window.backup.save(value),data),/Virtual or disconnected drives/);
    assert.deepEqual((await page.evaluate(()=>window.backup.load())).data.profiles,[]);
    assert.equal(await fs.readFile(path.join(destination,'obsolete.txt'),'utf8'),'preserve until confirmed copy');
    await detach();
    data.profiles[0].jobs[0].destination=destination;
    await page.evaluate(value=>window.backup.save(value),data);
    let preview=await page.evaluate(()=>window.backup.prepare({profileId:'fixture'}));
    assert.equal(preview.jobs[0].remove.length,1);
    assert.ok(disconnected.startsWith(fixture+path.sep));
    await fs.rename(destination,disconnected);
    let result=await page.evaluate(token=>window.backup.run(token,{confirmDelete:true}),preview.token);
    assert.equal(result.phase,'failed');
    let history=await page.evaluate(()=>window.backup.history());
    assert.equal(history[0].jobs[0].status,'failed');
    assert.equal(await fs.readFile(path.join(disconnected,'obsolete.txt'),'utf8'),'preserve until confirmed copy');
    await fs.rename(disconnected,destination);
    preview=await page.evaluate(()=>window.backup.prepare({profileId:'fixture'}));
    result=await page.evaluate(token=>window.backup.run(token,{confirmDelete:true}),preview.token);
    assert.equal(result.phase,'completed');
    assert.equal(await fs.readFile(path.join(destination,'hello.txt'),'utf8'),'isolated backup');
    await assert.rejects(fs.access(path.join(destination,'obsolete.txt')),{code:'ENOENT'});
    history=await page.evaluate(()=>window.backup.history());
    assert.equal(history[0].jobs[0].copied,1);
    assert.equal(history[0].jobs[0].deleted,1);
    console.log(`PASS: ${executable?'packaged':'source'} rejected SUBST ${drive}; isolated destination vanished after mirror review without deleting data, then returned and completed Robocopy copy/deletion.`);
  }finally{
    if(app){await app.windows()[0]?.evaluate(()=>window.backup.cancel()).catch(()=>{});await app.close();}
    if(!await fs.stat(destination).then(()=>true,()=>false)&&await fs.stat(disconnected).then(()=>true,()=>false))await fs.rename(disconnected,destination);
    await detach();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
