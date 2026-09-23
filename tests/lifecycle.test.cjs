const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {Store,defaults,validate}=require('../desktop/store.cjs');
const {LOGIN_ITEM_NAME,loginItemStatus,setStartWithWindows}=require('../desktop/startup.cjs');

test('legacy settings gain safe Windows lifecycle defaults',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'ofbm-lifecycle-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const old=defaults();delete old.settings.startWithWindows;delete old.settings.closeBehavior;
  await fs.writeFile(path.join(root,'settings.json'),JSON.stringify(old));
  const data=await new Store(root).read();
  assert.equal(data.settings.startWithWindows,false);
  assert.equal(data.settings.closeBehavior,'quit');
  assert.throws(()=>validate({...data,settings:{...data.settings,startWithWindows:'yes'}}),/Invalid startup or window setting/);
  assert.throws(()=>validate({...data,settings:{...data.settings,closeBehavior:'hide'}}),/Invalid startup or window setting/);
});

test('Windows login item uses one named executable and verifies OS readback',()=>{
  const calls=[],location='C:\\Program Files\\Open File Backup Manager\\Open File Backup Manager.exe';
  let state={openAtLogin:false,executableWillLaunchAtLogin:false};
  const app={isPackaged:true,getPath:key=>{assert.equal(key,'exe');return location;},getLoginItemSettings:options=>{assert.deepEqual(options,{path:location,args:[]});return state;},setLoginItemSettings:options=>{calls.push(options);state={openAtLogin:options.openAtLogin,executableWillLaunchAtLogin:options.openAtLogin};}};
  assert.deepEqual(loginItemStatus(app,'win32'),{available:true,configured:false,active:false,path:location});
  assert.deepEqual(setStartWithWindows(app,true,'win32'),{available:true,configured:true,active:true,path:location});
  assert.deepEqual(calls[0],{openAtLogin:true,path:location,args:[],name:LOGIN_ITEM_NAME,enabled:true});
  assert.deepEqual(setStartWithWindows(app,false,'win32'),{available:true,configured:false,active:false,path:location});
  assert.deepEqual(calls[1],{openAtLogin:false,path:location,args:[],name:LOGIN_ITEM_NAME});
  state={openAtLogin:true,executableWillLaunchAtLogin:false};
  assert.deepEqual(loginItemStatus(app,'win32'),{available:true,configured:true,active:false,path:location});
  app.setLoginItemSettings=()=>{};
  assert.throws(()=>setStartWithWindows(app,true,'win32'),/Windows did not apply/);
});

test('source and non-Windows builds never write a login item',()=>{
  const app={isPackaged:false,setLoginItemSettings:()=>assert.fail('must not write OS login state')};
  assert.deepEqual(loginItemStatus(app,'win32'),{available:false,configured:false,active:false,path:null});
  assert.throws(()=>setStartWithWindows(app,true,'win32'),/installed Windows app/);
  app.isPackaged=true;
  assert.deepEqual(loginItemStatus(app,'linux'),{available:false,configured:false,active:false,path:null});
  assert.throws(()=>setStartWithWindows(app,true,'linux'),/installed Windows app/);
});

test('isolated packaged tests cannot read or change the real Windows startup item',()=>{
  const app={isPackaged:true,getPath:()=>assert.fail('must not inspect real executable'),getLoginItemSettings:()=>assert.fail('must not read OS login state'),setLoginItemSettings:()=>assert.fail('must not write OS login state')};
  const environment={OFBM_TEST_DATA:'C:\\isolated-fixture'};
  assert.deepEqual(loginItemStatus(app,'win32',environment),{available:false,configured:false,active:false,path:null});
  assert.throws(()=>setStartWithWindows(app,true,'win32',environment),/installed Windows app/);
});

test('uninstaller removes only this login value on real uninstall',async()=>{
  const script=await fs.readFile(path.join(__dirname,'../build/installer.nsh'),'utf8');
  const uninstall=script.slice(script.indexOf('!macro customUnInstall'));
  assert.match(uninstall,/\$\{ifNot\} \$\{isUpdated\}/);
  const beforePrompt=uninstall.slice(0,uninstall.indexOf('MessageBox'));
  assert.ok(beforePrompt.includes(`DeleteRegValue HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Run" "${LOGIN_ITEM_NAME}"`));
  assert.ok(beforePrompt.includes(`DeleteRegValue HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run" "${LOGIN_ITEM_NAME}"`));
  assert.ok(beforePrompt.indexOf('${ifNot} ${isUpdated}')<beforePrompt.indexOf('DeleteRegValue'));
});
