const {_electron:electron}=require('@playwright/test');
const fs=require('node:fs/promises');
const path=require('node:path');
const http=require('node:http');
const {createHash}=require('node:crypto');
const assert=require('node:assert/strict');
async function main(){
  const root=path.resolve(__dirname,'..'),install=process.env.OFBM_INSTALLED_DIR||path.join(root,'release','win-unpacked');
  const relative=path.relative(path.join(root,'release'),path.resolve(install));
  if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('Use only a disposable unpacked build inside this project release directory.');
  const version=require('../package.json').version,installer=await fs.readFile(path.join(path.dirname(install),`Open-File-Backup-Manager-${version}-Setup.exe`));
  const [major,minor,patch]=version.split('.').map(Number),nextVersion=`${major}.${minor}.${patch+1}`;
  const fixture=await fs.mkdtemp(path.join(root,'output','update-policy-')),feed=path.join(install,'resources','app-update.yml'),original=await fs.readFile(feed);
  const source=path.join(fixture,'source'),destination=path.join(fixture,'backup');await fs.mkdir(source);await fs.mkdir(destination);await fs.writeFile(path.join(source,'sample'),'fixture');
  const hash=createHash('sha512').update(installer).digest('base64');let releaseDownload;const gate=new Promise(resolve=>{releaseDownload=resolve;});
  const metadata=`version: ${nextVersion}\nfiles:\n  - url: installer.exe\n    sha512: ${hash}\n    size: ${installer.length}\npath: installer.exe\nsha512: ${hash}\nreleaseDate: '2026-09-21T00:00:00.000Z'\n`;
  const server=http.createServer(async(req,res)=>{const name=new URL(req.url,'http://localhost').pathname;if(name==='/latest.yml'){res.end(metadata);}else if(name==='/installer.exe'){await gate;res.writeHead(200,{'Content-Length':installer.length});res.end(installer);}else{res.writeHead(404);res.end();}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  await fs.writeFile(feed,`provider: generic\nurl: http://127.0.0.1:${server.address().port}/\nupdaterCacheDirName: ${path.basename(fixture)}\n`);
  const env={...process.env,OFBM_TEST_DATA:path.join(fixture,'appdata')};delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app=await electron.launch({executablePath:path.join(install,'Open File Backup Manager.exe'),args:[],env});const page=await app.firstWindow();page.setDefaultTimeout(30000);await page.getByRole('button',{name:'Settings',exact:true}).waitFor();
    await app.evaluate(({app})=>{global.__installCalls=[];const updater=process.mainModule.require(app.getAppPath()+'/node_modules/electron-updater/out/main.js').autoUpdater;updater.quitAndInstall=(...args)=>global.__installCalls.push(args);updater.disableDifferentialDownload=true;});
    const initial=(await page.evaluate(()=>window.backup.load())).data.settings;assert.deepEqual([initial.autoCheck,initial.autoDownload,initial.autoInstall],[true,true,false]);
    await page.evaluate(async paths=>{const {data}=await window.backup.load();Object.assign(data.settings,{autoCheck:false,autoDownload:false,autoInstall:false});data.profiles=[{id:'test',name:'Update fixture',mode:'copy',jobs:[{id:'job',name:'Job',mode:'copy',...paths}]}];await window.backup.save(data);},{source,destination});
    await page.evaluate(()=>window.backup.updates('check'));assert.equal((await page.evaluate(()=>window.backup.load())).update.state,'available');
    await page.evaluate(async()=>{const {data}=await window.backup.load();Object.assign(data.settings,{autoCheck:true,autoDownload:true,autoInstall:false});await window.backup.save(data);});
    await page.evaluate(()=>window.backup.prepare({profileId:'test'}));releaseDownload();
    const until=Date.now()+60000;while((await page.evaluate(()=>window.backup.load())).update.state!=='ready'){if(Date.now()>until)throw Error('Automatic download timed out');await new Promise(resolve=>setTimeout(resolve,100));}
    await new Promise(resolve=>setTimeout(resolve,1800));assert.deepEqual(await app.evaluate(()=>global.__installCalls),[]);
    await page.evaluate(()=>window.backup.cancel());await new Promise(resolve=>setTimeout(resolve,1800));assert.deepEqual(await app.evaluate(()=>global.__installCalls),[]);
    await page.getByText('Update ready to install',{exact:true}).waitFor();
    await page.evaluate(async()=>{const {data}=await window.backup.load();data.settings.autoInstall=true;await window.backup.save(data);});
    const deadline=Date.now()+5000;while(!(await app.evaluate(()=>global.__installCalls.length))){if(Date.now()>deadline)throw Error('Automatic install trigger timed out');await new Promise(resolve=>setTimeout(resolve,100));}
    assert.deepEqual(await app.evaluate(()=>global.__installCalls),[[true,true]]);
    console.log('PASS: fresh defaults check and download automatically but require manual installation; packaged updater downloads and hash-verifies installer from loopback feed, then optional auto-install waits for review cancellation and requests installation once. Installer execution is intercepted; no live upgrade is claimed.');
  }finally{releaseDownload();if(app){await app.windows()[0]?.evaluate(()=>window.backup.cancel()).catch(()=>{});await app.close();}await fs.writeFile(feed,original);server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
