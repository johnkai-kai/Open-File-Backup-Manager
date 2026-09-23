const {_electron:electron}=require('@playwright/test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const root=path.resolve(__dirname,'..');

async function launch(folder){
  const env={...process.env,OFBM_TEST_DATA:folder};delete env.ELECTRON_RUN_AS_NODE;
  const app=await electron.launch({args:[root],env});
  return {app,page:await app.firstWindow()};
}

async function main(){
  const folder=path.join(root,'output','tray-smoke-'+Date.now());
  await fs.mkdir(folder,{recursive:true});
  const {app,page}=await launch(path.join(folder,'tray-data'));
  try{
    await page.getByRole('button',{name:'Create your first profile'}).waitFor();
    const initial=await page.evaluate(()=>window.backup.load());
    assert.equal(initial.data.settings.startWithWindows,false);
    assert.equal(initial.data.settings.closeBehavior,'quit');
    assert.deepEqual(await page.evaluate(()=>window.backup.loginItemStatus()),{available:false,configured:false,active:false,path:null});
    initial.data.settings.startWithWindows=true;
    await assert.rejects(page.evaluate(data=>window.backup.save(data),initial.data),/installed Windows app/);
    assert.equal((await page.evaluate(()=>window.backup.load())).data.settings.startWithWindows,false);
    initial.data.settings.startWithWindows=false;
    initial.data.settings.closeBehavior='tray';
    await page.evaluate(data=>window.backup.save(data),initial.data);
    await app.evaluate(({Menu,dialog})=>{
      global.__trayOriginalMenu=Menu.buildFromTemplate;
      global.__trayOriginalDialog=dialog.showMessageBox;
      Menu.buildFromTemplate=function(template){global.__trayItems=template;return global.__trayOriginalMenu.call(this,template);};
      dialog.showMessageBox=async()=>({response:0});
    });
    await page.evaluate(()=>window.backup.windowControl('close'));
    assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false);
    assert.deepEqual(await app.evaluate(()=>global.__trayItems.map(item=>item.label)),['Open','Quit']);
    await app.evaluate(()=>global.__trayItems[0].click());
    assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),true);

    const source=path.join(folder,'source'),destination=path.join(folder,'destination');
    await fs.mkdir(source);await fs.mkdir(destination);
    await fs.writeFile(path.join(source,'fixture.txt'),'test');
    const data=(await page.evaluate(()=>window.backup.load())).data;
    data.profiles.push({id:'tray-profile',name:'Tray fixture',mode:'mirror',jobs:[{id:'tray-job',name:'Fixture',mode:'inherit',source,destination}]});
    await page.evaluate(value=>window.backup.save(value),data);
    await page.evaluate(()=>window.backup.prepare({profileId:'tray-profile'}));
    await page.evaluate(()=>window.backup.windowControl('close'));
    assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),true);
    await app.evaluate(()=>global.__trayItems[1].click());
    assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),true);
    await page.evaluate(()=>window.backup.cancel());

    const closed=app.waitForEvent('close');
    await app.evaluate(()=>global.__trayItems[1].click()).catch(()=>{});
    await closed;
    console.log('PASS: tray close hides, Open restores, pending review blocks Close/Quit, Quit exits, source build does not alter OS startup.');
  }finally{
    await page.evaluate(()=>window.backup.cancel()).catch(()=>{});
    await app.close().catch(()=>{});
  }
  const plain=await launch(path.join(folder,'quit-data'));
  try{
    await plain.page.getByRole('button',{name:'Create your first profile'}).waitFor();
    const closed=plain.app.waitForEvent('close');
    await plain.page.evaluate(()=>window.backup.windowControl('close')).catch(()=>{});
    await closed;
    console.log('PASS: default close behavior exits without creating a tray icon.');
  }finally{await plain.app.close().catch(()=>{});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
