const {_electron:electron}=require('@playwright/test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
async function main(){
  const folder=path.join(root,'output','smoke-'+Date.now());await fs.mkdir(folder,{recursive:true});
  const source=path.join(folder,'source'),destination=path.join(folder,'destination');await fs.mkdir(source);await fs.mkdir(destination);
  await fs.writeFile(path.join(source,'hello.txt'),'hello backup');await fs.writeFile(path.join(destination,'obsolete.txt'),'delete fixture only');
  const env={...process.env,OFBM_TEST_DATA:path.join(folder,'appdata')};delete env.ELECTRON_RUN_AS_NODE;
  const executable=process.env.OFBM_INSTALLED_DIR?path.join(process.env.OFBM_INSTALLED_DIR,'Open File Backup Manager.exe'):process.env.OFBM_PACKAGED?path.join(root,'release/win-unpacked/Open File Backup Manager.exe'):null;
  const app=await electron.launch(executable?{executablePath:executable,args:[],env}:{args:[root],env});
  const page=await app.firstWindow();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const checks=[];
  try{
    await page.getByRole('button',{name:'Create your first profile'}).click();
    await page.getByRole('textbox',{name:'Profile name'}).fill('Work');await page.getByRole('button',{name:'Create',exact:true}).click();
    await page.getByRole('button',{name:'Add job',exact:true}).click();
    await page.locator('#new-job-form input[name=name]').fill('Documents');
    await page.locator('#new-job-form input[name=source]').fill(source);
    await page.locator('#new-job-form input[name=destination]').fill(destination);
    await page.getByRole('button',{name:'Create job',exact:true}).click();
    await page.getByText('Job created',{exact:true}).waitFor();checks.push('profile/job persistence through UI');
    const storagePaths=await page.evaluate(()=>window.backup.storagePaths());
    assert.deepEqual(storagePaths,{appData:path.join(folder,'appdata'),settings:path.join(folder,'appdata','settings.json'),logs:path.join(folder,'appdata','logs')});
    assert.deepEqual(await page.evaluate(()=>window.backup.storagePaths('ignored')),storagePaths);
    await app.evaluate(({clipboard})=>{global.__storageClipboard=[];global.__originalWriteText=clipboard.writeText;clipboard.writeText=value=>global.__storageClipboard.push(value);});
    try{
      assert.equal(await page.evaluate(()=>window.backup.copyStoragePath('settings')),storagePaths.settings);
      assert.equal(await page.evaluate(()=>window.backup.copyStoragePath('logs')),storagePaths.logs);
      await assert.rejects(page.evaluate(()=>window.backup.copyStoragePath('C:\\arbitrary')),/Invalid storage path/);
      assert.deepEqual(await app.evaluate(()=>global.__storageClipboard),[storagePaths.settings,storagePaths.logs]);
    }finally{await app.evaluate(({clipboard})=>{clipboard.writeText=global.__originalWriteText;delete global.__storageClipboard;delete global.__originalWriteText;});}
    checks.push('fixed local storage paths and restricted clipboard copy');
    await app.evaluate(({shell})=>{global.__storageOpen=[];global.__originalOpenPath=shell.openPath;global.__originalShowItem=shell.showItemInFolder;shell.openPath=async value=>{global.__storageOpen.push(['folder',value]);return global.__storageOpenError||'';};shell.showItemInFolder=value=>global.__storageOpen.push(['selected',value]);});
    try{
      assert.deepEqual(await page.evaluate(()=>window.backup.openStoragePath('settings')),{path:storagePaths.settings,selected:true});
      assert.deepEqual(await page.evaluate(()=>window.backup.openStoragePath('logs')),{path:storagePaths.logs,selected:false});
      assert.deepEqual(await app.evaluate(()=>global.__storageOpen),[['selected',storagePaths.settings],['folder',storagePaths.logs]]);
      const heldSettings=storagePaths.settings+'.fixture-held';
      await fs.rename(storagePaths.settings,heldSettings);
      try{assert.deepEqual(await page.evaluate(()=>window.backup.openStoragePath('settings')),{path:storagePaths.appData,selected:false});}
      finally{await fs.rename(heldSettings,storagePaths.settings);}
      await assert.rejects(page.evaluate(()=>window.backup.openStoragePath('C:\\arbitrary')),/Invalid storage path/);
      await app.evaluate(()=>{global.__storageOpenError='Explorer failed in fixture';});
      await assert.rejects(page.evaluate(()=>window.backup.openStoragePath('logs')),/Explorer failed in fixture/);
    }finally{await app.evaluate(({shell})=>{shell.openPath=global.__originalOpenPath;shell.showItemInFolder=global.__originalShowItem;delete global.__storageOpen;delete global.__originalOpenPath;delete global.__originalShowItem;delete global.__storageOpenError;});}
    checks.push('restricted Explorer navigation and error reporting');
    const denied=await page.evaluate(async()=>{const loaded=await window.backup.load();const plan=await window.backup.prepare({profileId:loaded.data.profiles[0].id});try{await window.backup.run(plan.token);return false;}catch(e){return e.message.includes('Deletion preview must be confirmed');}finally{await window.backup.cancel();}});
    assert.equal(denied,true);assert.equal(await fs.readFile(path.join(destination,'obsolete.txt'),'utf8'),'delete fixture only');checks.push('backend rejects deletion without explicit consent');
    await page.getByRole('button',{name:'Run profile',exact:true}).click();
    await page.getByRole('heading',{name:'Review backup'}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Start backup'}).isDisabled(),true);
    await page.locator('#delete-consent').check();await page.getByRole('button',{name:'Start backup'}).click();
    await page.locator('#progress .progress-title').filter({hasText:'Transfer complete'}).waitFor();
    assert.equal(await fs.readFile(path.join(destination,'hello.txt'),'utf8'),'hello backup');assert.equal(await fs.access(path.join(destination,'obsolete.txt')).then(()=>true,()=>false),false);checks.push('real mirror copy, deletion consent and completion');
    await page.getByRole('button',{name:'Settings',exact:true}).click();
    await page.locator('[data-setting=theme]').selectOption('light');
    await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');
    await page.locator('[data-setting=language]').selectOption('zh-TW');await page.getByRole('heading',{name:'設定',exact:true}).waitFor();checks.push('light theme and Traditional Chinese');
    await page.locator('[data-setting=language]').selectOption('en');await page.locator('[data-setting=theme]').selectOption('dark');
    const updateConfigured=Boolean(executable)&&await fs.access(path.join(process.env.OFBM_INSTALLED_DIR||path.join(root,'release/win-unpacked'),'resources','app-update.yml')).then(()=>true,()=>false);
    if(updateConfigured){checks.push('packaged update feed is configured');}
    else{await page.getByRole('button',{name:'Check for updates',exact:true}).click();await page.getByText('Update source is not configured for this build.').waitFor();checks.push('honest unconfigured updater state');}
    await page.getByRole('button',{name:'Activity',exact:true}).click();assert.equal(await page.locator('.activity-entry').count(),1);await page.locator('.activity-entry').first().locator('summary').click();const commands=await page.locator('.activity-entry').first().locator('.log-command').allInnerTexts();assert.ok(commands[0].includes('robocopy.exe')&&commands[0].includes('\"/L\"'));const command=commands.at(-1);assert.ok(command.includes('robocopy.exe')&&command.includes('\"/E\"'));assert.ok(command.includes(await fs.realpath(source)));assert.ok(command.includes(await fs.realpath(destination)));await page.screenshot({path:path.join(root,'output','activity-detail.png')});checks.push('one expandable activity entry per run with actual Robocopy command');
    await page.getByRole('button',{name:'Work',exact:true}).click();
    await page.screenshot({path:path.join(root,'output','desktop-dark.png')});
    const state=await page.evaluate(()=>window.backup.load());assert.equal(state.data.profiles[0].name,'Work');
    await page.reload();await page.getByRole('heading',{name:'Work',exact:true}).waitFor();checks.push('settings survive renderer reload');
    const copySource=path.join(folder,'copy-source'),copyDestination=path.join(folder,'copy-destination');await fs.mkdir(copySource);await fs.mkdir(copyDestination);await fs.writeFile(path.join(copySource,'copy.txt'),'copy-only');await fs.writeFile(path.join(copyDestination,'keep.txt'),'preserve');
    const next=await page.evaluate(()=>window.backup.load());next.data.profiles.push({id:'personal-test',name:'Personal',mode:'mirror',jobs:[{id:'copy-test',name:'Local copy',source:copySource,destination:copyDestination,mode:'copy'}]});await page.evaluate(d=>window.backup.save(d),next.data);await page.reload();
    await page.getByRole('button',{name:'Run all profiles',exact:true}).click();await page.getByRole('heading',{name:'Review backup'}).waitFor();assert.equal(await page.locator('.review-job').count(),2);await page.getByRole('button',{name:'Start backup'}).click();await page.locator('#progress .progress-title').filter({hasText:'Transfer complete'}).waitFor();
    assert.equal(await fs.readFile(path.join(copyDestination,'copy.txt'),'utf8'),'copy-only');assert.equal(await fs.readFile(path.join(copyDestination,'keep.txt'),'utf8'),'preserve');checks.push('all profiles run with per-job copy override preserving extras');
    await page.getByRole('button',{name:'Personal',exact:true}).click();await page.locator('[data-run-job=copy-test]').click();await page.getByRole('heading',{name:'Review backup'}).waitFor();assert.equal(await page.locator('.review-job').count(),1);await page.getByRole('button',{name:'Start backup'}).click();await page.locator('#progress .progress-title').filter({hasText:'Transfer complete'}).waitFor();checks.push('individual job execution and unchanged-file skip');
    const link=path.join(copySource,'linked'),kept=path.join(copyDestination,'linked');await fs.symlink(source,link,'junction');await fs.mkdir(kept);await fs.writeFile(path.join(kept,'keep.txt'),'preserved behind skipped link');
    await page.locator('[data-run-job=copy-test]').click();await page.getByRole('heading',{name:'Review backup'}).waitFor();await page.locator('.link-notice').filter({hasText:'Links skipped (1)'}).waitFor();assert.ok((await page.locator('.link-notice').innerText()).includes('will not be copied or recreated'));await page.screenshot({path:path.join(root,'output','links-review.png')});await page.getByRole('button',{name:'Start backup'}).click();await page.locator('#progress .progress-title').filter({hasText:'Completed with warnings'}).waitFor();assert.equal(await fs.readFile(path.join(kept,'keep.txt'),'utf8'),'preserved behind skipped link');
    await page.getByRole('button',{name:'Activity',exact:true}).click();await page.locator('.activity-entry').first().locator('summary').click();await page.getByText('Links skipped: 1',{exact:true}).waitFor();checks.push('skipped-link preview, preserved destination, completion warning and activity reason');
    await page.getByRole('button',{name:'Settings',exact:true}).click();await page.locator('[data-setting=language]').selectOption('zh-TW');await page.getByRole('button',{name:'Personal',exact:true}).click();await page.locator('[data-run-job=copy-test]').click();await page.getByRole('heading',{name:'檢查備份內容'}).waitFor();await page.locator('.link-notice').filter({hasText:'略過的連結 (1)'}).waitFor();await page.getByRole('button',{name:'開始備份'}).click();await page.locator('#progress .progress-title').filter({hasText:'已完成，請查看提醒'}).waitFor();checks.push('Traditional Chinese skipped-link review and completion');
    assert.equal(await page.locator('.app-name').count(),1);assert.equal(await page.locator('.brand-mark').count(),1);checks.push('single title and original Fold mark');
    assert.deepEqual(errors,[]);checks.push('no renderer exceptions');
    const preferences=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences());assert.equal(preferences.sandbox,true);assert.equal(preferences.contextIsolation,true);assert.equal(preferences.nodeIntegration,false);assert.equal(await page.evaluate(()=>typeof require),'undefined');checks.push('renderer sandbox, isolation and Node boundary');
    await fs.writeFile(path.join(root,'output','desktop-smoke.json'),JSON.stringify({checks,errors,fixture:folder},null,2));
    console.log(`PASS ${checks.length}/${checks.length}: `+checks.join('; '));
  }catch(error){await page.screenshot({path:path.join(root,'output','desktop-failure.png')});console.error('Renderer errors:',errors);console.error('Page text:',await page.locator('body').innerText());throw error;}finally{await page.evaluate(()=>window.backup.cancel()).catch(()=>{});await app.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
