const {_electron:electron}=require('@playwright/test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {spawn}=require('node:child_process');

async function latest(page){
  const history=await page.evaluate(()=>window.backup.history());
  return history.find(entry=>entry.operation);
}
function assertTimings(entry){
  const t=entry.timings;
  for(const key of ['previewMs','previewScanMs','preflightMs','copyMs','verifyMs','deleteMs','runMs','scanMs','robocopyMs','otherMs','totalMs'])assert.ok(Number.isInteger(t[key])&&t[key]>=0,key);
  assert.equal(t.totalMs,t.previewMs+t.runMs);
  assert.equal(t.scanMs,t.previewScanMs+t.preflightMs+t.verifyMs);
  assert.equal(t.robocopyMs,t.copyMs);
  assert.ok(Math.abs(t.scanMs+t.robocopyMs+t.deleteMs+t.otherMs-t.totalMs)<=5);
  assert.ok(t.previewMs>0&&t.runMs>0&&t.robocopyMs>0);
}
async function waitForLock(child){
  await new Promise((resolve,reject)=>{
    child.stdout.once('data',resolve);
    child.once('error',reject);
    child.once('exit',code=>reject(new Error('Lock worker exited: '+code)));
  });
}
async function main(){
  const root=path.resolve(__dirname,'..');
  const output=path.join(root,'output');
  await fs.mkdir(output,{recursive:true});
  const folder=await fs.mkdtemp(path.join(output,'activity-command-'));
  const source=path.join(folder,'source files 資料'),destination=path.join(folder,'backup drive');
  await fs.mkdir(source);await fs.mkdir(destination);
  await fs.writeFile(path.join(source,'hello.txt'),'hello backup');
  await fs.writeFile(path.join(destination,'obsolete.txt'),'delete after confirmation');
  const env={...process.env,OFBM_TEST_DATA:path.join(folder,'appdata')};
  delete env.ELECTRON_RUN_AS_NODE;
  const executable=process.env.OFBM_INSTALLED_DIR
    ?path.join(process.env.OFBM_INSTALLED_DIR,'Open File Backup Manager.exe')
    :process.env.OFBM_PACKAGED?path.join(root,'release/win-unpacked/Open File Backup Manager.exe'):null;
  const app=await electron.launch(executable?{executablePath:executable,args:[],env}:{args:[root],env});
  const page=await app.firstWindow();
  await page.getByRole('button',{name:'Settings',exact:true}).waitFor();
  let worker;
  try{
    const state=await page.evaluate(()=>window.backup.load());
    state.data.profiles=[{id:'p',name:'Fixture',mode:'mirror',jobs:[{id:'j',name:'Files',mode:'inherit',source,destination}]}];
    await page.evaluate(data=>window.backup.save(data),state.data);
    let plan=await page.evaluate(()=>window.backup.prepare({profileId:'p'}));
    let result=await page.evaluate(token=>window.backup.run(token,{confirmDelete:true}),plan.token);
    assert.equal(result.phase,'completed');
    let entry=await latest(page),detail=entry.jobs[0];
    assert.equal(entry.status,'completed');
    assert.equal(detail.executable,path.join(process.env.SystemRoot,'System32','robocopy.exe'));
    assert.deepEqual(detail.args.slice(0,2),[await fs.realpath(source),await fs.realpath(destination)]);
    assert.equal(detail.command,[detail.executable,...detail.args].map(value=>'"'+value+'"').join(' '));
    assert.ok(detail.previewCommand.includes('"/L"'));
    assert.ok(detail.previewCommand.includes('"/MIR"'));
    assert.equal(detail.recheckCommands.length,2);
    for(const flag of ['/E','/Z','/COPY:DAT','/DCOPY:DA','/MT:8','/R:0','/W:0','/XJ','/FP','/BYTES','/NP','/NDL'])assert.ok(detail.args.includes(flag),flag);
    assert.ok(detail.args.some(arg=>arg.startsWith('/UNILOG:')));
    assert.ok(!detail.args.includes('/MIR'));
    assert.deepEqual(detail.deletedPaths,[path.join(destination,'obsolete.txt')]);
    assert.equal(detail.deleted,1);
    assert.equal(detail.copied,1);
    assert.equal(detail.transferred,12);
    assertTimings(entry);
    for(const key of ['previewScanMs','preflightMs','copyMs','verifyMs','deleteMs','runMs'])assert.ok(Number.isInteger(detail.timings[key])&&detail.timings[key]>=0,key);
    await page.getByRole('button',{name:'Activity',exact:true}).click();
    await page.locator('.activity-entry').first().locator('summary').click();
    assert.equal(await page.locator('.activity-entry').first().locator('.log-command').first().innerText(),detail.previewCommand);
    assert.equal(await page.locator('.activity-entry').first().locator('.log-command').last().innerText(),detail.command);
    assert.deepEqual(await page.locator('.activity-timing-meter').evaluateAll(items=>items.map(item=>item.value)),['scanMs','robocopyMs','deleteMs','otherMs'].map(key=>Math.round(entry.timings[key]/entry.timings.totalMs*100)));

    const locked=path.join(destination,'locked.txt');
    await fs.writeFile(path.join(source,'locked.txt'),'new longer content');
    await fs.writeFile(locked,'old');
    await fs.writeFile(path.join(destination,'do-not-delete.txt'),'preserve');
    plan=await page.evaluate(()=>window.backup.prepare({profileId:'p'}));
    const command='$f=[IO.File]::Open(\''+locked.replace(/'/g,"''")+'\',\'Open\',\'Read\',\'Read\');try{[Console]::WriteLine(\'ready\');[Console]::ReadLine() | Out-Null}finally{$f.Dispose()}';
    worker=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    await waitForLock(worker);
    result=await page.evaluate(token=>window.backup.run(token,{confirmDelete:true}),plan.token);
    assert.equal(result.phase,'failed');
    entry=await latest(page);detail=entry.jobs[0];
    assert.equal(entry.status,'failed');
    assert.equal(detail.status,'failed');
    assert.ok(detail.command.includes('robocopy.exe'));
    assert.deepEqual(detail.args.slice(0,2),[await fs.realpath(source),await fs.realpath(destination)]);
    assert.ok(detail.exitCode>=8);
    assert.deepEqual(detail.deletedPaths,[]);
    assertTimings(entry);
    assert.ok(detail.timings.preflightMs>=0&&detail.timings.copyMs>0);
    assert.equal(detail.timings.verifyMs,undefined);
    assert.equal(detail.timings.deleteMs,undefined);
    assert.equal(entry.timings.deleteMs,0);
    assert.equal(await fs.readFile(path.join(destination,'do-not-delete.txt'),'utf8'),'preserve');
    await page.getByRole('button',{name:'Refresh',exact:true}).click();
    await page.locator('.activity-entry').first().locator('summary').click();
    assert.equal(await page.locator('.activity-entry').first().locator('.log-command').first().innerText(),detail.previewCommand);
    assert.equal(await page.locator('.activity-entry').first().locator('.log-command').last().innerText(),detail.command);
    console.log('PASS: Activity persists exact Robocopy executable, full args/command, native totals and separate mirror deletion; failed copy retains command and blocks deletion.');
  }finally{
    if(worker){const closed=new Promise(resolve=>worker.once('close',resolve));worker.stdin.end('\n');await closed;}
    await page.evaluate(()=>window.backup.cancel()).catch(()=>{});
    await app.close();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
