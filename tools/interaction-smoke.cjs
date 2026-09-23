const {_electron:electron}=require('@playwright/test');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');

async function main(){
  const root=path.resolve(__dirname,'..');
  const fixture=await fs.mkdtemp(path.join(root,'output','robocopy-smoke-'));
  const source=path.join(fixture,'source'),destination=path.join(fixture,'backup');
  await fs.mkdir(source);await fs.mkdir(destination);await fs.writeFile(path.join(source,'sample.txt'),'robocopy fixture');
  const env={...process.env,OFBM_TEST_DATA:path.join(fixture,'appdata')};delete env.ELECTRON_RUN_AS_NODE;
  const executable=process.env.OFBM_INSTALLED_DIR
    ?path.join(process.env.OFBM_INSTALLED_DIR,'Open File Backup Manager.exe')
    :process.env.OFBM_PACKAGED?path.join(root,'release/win-unpacked/Open File Backup Manager.exe'):null;
  const app=await electron.launch(executable?{executablePath:executable,args:[],env}:{args:[root],env});
  try{
    const page=await app.firstWindow();page.setDefaultTimeout(15000);
    await page.getByRole('button',{name:'Settings',exact:true}).waitFor();
    await page.getByRole('button',{name:'Create your first profile'}).click();
    await page.getByRole('textbox',{name:'Profile name'}).fill('Enter profile');
    await page.getByRole('textbox',{name:'Profile name'}).press('Enter');
    await page.getByRole('button',{name:'Enter profile',exact:true}).waitFor();
    let saved=await page.evaluate(()=>window.backup.load());
    assert.equal(saved.data.profiles.length,1);
    await page.getByRole('button',{name:'Profile settings',exact:true}).click();
    await page.getByRole('button',{name:'Rename profile',exact:true}).click();
    await page.getByRole('textbox',{name:'Profile name'}).fill('Renamed profile');
    await page.getByRole('textbox',{name:'Profile name'}).press('Enter');
    await page.getByRole('button',{name:'Renamed profile',exact:true}).waitFor();
    saved=await page.evaluate(()=>window.backup.load());
    assert.equal(saved.data.profiles[0].name,'Renamed profile');
    await page.getByRole('button',{name:'New profile',exact:true}).click();
    await page.getByRole('textbox',{name:'Profile name'}).fill('Canceled profile');
    await page.getByRole('button',{name:'Cancel',exact:true}).click();
    assert.equal((await page.evaluate(()=>window.backup.load())).data.profiles.length,1);
    await page.getByRole('button',{name:'Add job',exact:true}).click();
    await page.locator('#new-job-form input[name=name]').fill('Enter job');
    await page.locator('#new-job-form input[name=source]').fill(source);
    await page.locator('#new-job-form input[name=destination]').fill(destination);
    await page.locator('#new-job-form input[name=name]').press('Enter');
    await page.getByText('Job created',{exact:true}).waitFor();
    saved=await page.evaluate(()=>window.backup.load());
    assert.equal(saved.data.profiles[0].jobs.length,1);
    await page.evaluate(async paths=>{
      const {data}=await window.backup.load();data.settings.autoCheck=false;
      data.profiles=[{id:'test',name:'Documents',mode:'copy',jobs:[{id:'job',name:'Documents',mode:'copy',...paths}]}];
      await window.backup.save(data);
    },{source,destination});
    await page.reload();await page.getByRole('button',{name:'Settings',exact:true}).click();
    await page.getByText('Robocopy is available',{exact:true}).waitFor();
    await page.getByText('Windows startup can be configured in the installed app.',{exact:true}).waitFor();
    assert.equal(await page.locator('[data-setting=startWithWindows]').isDisabled(),true);
    await page.locator('[data-setting=closeBehavior]').selectOption('tray');
    await page.waitForFunction(async()=>(await window.backup.load()).data.settings.closeBehavior==='tray');
    saved=await page.evaluate(()=>window.backup.load());
    assert.equal(saved.data.settings.startWithWindows,false);
    assert.equal(saved.data.settings.closeBehavior,'tray');
    await page.reload();await page.getByRole('button',{name:'Settings',exact:true}).click();
    assert.equal(await page.locator('[data-setting=startWithWindows]').isChecked(),false);
    assert.equal(await page.locator('[data-setting=closeBehavior]').inputValue(),'tray');
    await page.locator('[data-setting=closeBehavior]').selectOption('quit');
    await page.waitForFunction(async()=>(await window.backup.load()).data.settings.closeBehavior==='quit');
    const status=await page.evaluate(()=>window.backup.robocopyStatus());
    assert.equal(status.available,true);assert.match(status.path,/robocopy\.exe$/i);
    assert.equal(await page.locator('[data-setting=writeMode]').count(),0);
    await page.getByRole('button',{name:'Check again',exact:true}).click();
    await page.getByText('Robocopy is available',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Documents',exact:true}).click();
    await page.getByRole('button',{name:'Run profile',exact:true}).click();
    await page.getByRole('heading',{name:'Review backup'}).waitFor();
    await page.evaluate(()=>{window.__progressSamples=[];window.backup.onProgress(value=>window.__progressSamples.push(value));});
    await page.getByRole('button',{name:'Start backup'}).click();
    await page.getByText('Transfer complete',{exact:true}).waitFor();
    assert.equal(await fs.readFile(path.join(destination,'sample.txt'),'utf8'),'robocopy fixture');
    const samples=await page.evaluate(()=>window.__progressSamples);assert.ok(samples.some(value=>value.phase==='copying'&&value.indeterminate===true&&value.currentFile===path.join(source,'sample.txt')));
    const completed=samples.findLast(value=>value.phase==='completed');assert.equal(completed.copied,1);assert.equal(completed.transferred,16);
    const history=await page.evaluate(()=>window.backup.history());assert.equal(history.length,1);assert.equal(history[0].jobs[0].executable,status.path);assert.equal(history[0].jobs[0].exitCode,1);
    await page.getByRole('button',{name:'Activity',exact:true}).click();
    assert.equal(await page.locator('.activity-entry').count(),1);
    await page.locator('.activity-entry summary').click();
    await page.getByText(/robocopy\.exe/).first().waitFor();
    await page.getByRole('button',{name:'Settings',exact:true}).click();
    await page.locator('[data-setting=language]').selectOption('zh-TW');
    await page.getByText('已偵測到 Robocopy',{exact:true}).waitFor();
    await app.evaluate(({app})=>{
      const mod=process.mainModule.require(app.getAppPath()+'/desktop/robocopy.cjs');
      mod.diagnose=async()=>({available:false,path:'C:\\Windows\\System32\\robocopy.exe',error:'Missing test fixture'});
    });
    await page.getByRole('button',{name:'重新偵測',exact:true}).click();
    await page.getByText('找不到可用的 Robocopy',{exact:true}).waitFor();
    assert.equal(await page.getByText('sfc /scannow',{exact:true}).count(),1);
    await page.getByRole('button',{name:'Documents',exact:true}).click();
    await page.getByRole('button',{name:'執行這組備份',exact:true}).click();
    await page.getByRole('alert').getByText('無法使用 Robocopy。請到設定查看偵測路徑，依說明修復 Windows 系統檔案後重新偵測。',{exact:true}).waitFor();
    const blocked=await page.evaluate(async()=>{
      try{await window.backup.prepare({profileId:'test'});return false;}
      catch(error){return error.message.includes('Robocopy is unavailable');}
    });
    assert.equal(blocked,true);
    console.log('PASS: Enter creates/renames profile and creates job; Cancel does not create a profile; unavailable Windows startup is disabled and tray setting persists; detected path matches executed Robocopy; truthful running and completion statistics; one expandable command log; Chinese unavailable toast blocks backup and shows repair steps.');
  }finally{await app.windows()[0]?.evaluate(()=>window.backup.cancel()).catch(()=>{});await app.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
