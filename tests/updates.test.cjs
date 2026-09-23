const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {Updates}=require('../desktop/updates.cjs');
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function setup(t,settings={autoCheck:true,autoDownload:true,autoInstall:true}) {
  t.mock.timers.enable({apis:['setTimeout','setInterval']});
  const updater=new EventEmitter(),calls={check:0,download:0,install:0},state={idle:true};
  updater.checkForUpdates=async()=>{calls.check++;};updater.downloadUpdate=async()=>{calls.download++;};updater.quitAndInstall=()=>{calls.install++;};
  const controller=new Updates(updater,{onStatus:()=>{},isIdle:()=>state.idle});controller.start(true,settings);t.after(()=>controller.stop());
  return {updater,calls,state,controller};
}
test('automatic update checking repeats while the app remains open',async t=>{const {calls}=setup(t);t.mock.timers.tick(5000);await turn();assert.equal(calls.check,1);t.mock.timers.tick(30*60*1000);await turn();assert.equal(calls.check,2);});
test('enabling automatic checks takes effect without restarting',async t=>{const {calls,controller}=setup(t,{autoCheck:false,autoDownload:false,autoInstall:false});controller.configure({autoCheck:true,autoDownload:false,autoInstall:false});await turn();assert.equal(calls.check,1);controller.configure({autoCheck:false,autoDownload:false,autoInstall:false});t.mock.timers.tick(60*60*1000);await turn();assert.equal(calls.check,1);});
test('automatic download works when enabled after an update was found',async t=>{const {calls,controller,updater}=setup(t,{autoCheck:false,autoDownload:false,autoInstall:false});updater.emit('update-available',{version:'1.0.1'});await turn();assert.equal(calls.download,0);controller.configure({autoCheck:false,autoDownload:true,autoInstall:false});await turn();assert.equal(calls.download,1);});
test('automatic download starts once when an update is found',async t=>{const {calls,updater}=setup(t,{autoCheck:false,autoDownload:true,autoInstall:false});updater.emit('update-available',{version:'1.0.1'});await turn();assert.equal(calls.download,1);});
test('downloaded update waits for backup or review to finish or cancel',async t=>{const {calls,controller,updater,state}=setup(t);state.idle=false;updater.emit('update-downloaded',{version:'1.0.1'});t.mock.timers.tick(2000);assert.equal(calls.install,0);state.idle=true;controller.idleChanged();t.mock.timers.tick(1500);assert.equal(calls.install,1);controller.idleChanged();t.mock.timers.tick(1500);assert.equal(calls.install,1);});
test('disabling auto-install or starting a backup cancels pending installation',async t=>{const {calls,controller,updater,state}=setup(t);updater.emit('update-downloaded',{version:'1.0.1'});controller.configure({autoCheck:false,autoDownload:false,autoInstall:false});t.mock.timers.tick(2000);assert.equal(calls.install,0);controller.configure({autoCheck:false,autoDownload:false,autoInstall:true});state.idle=false;t.mock.timers.tick(2000);assert.equal(calls.install,0);});
test('manual checks and downloads remain available with automation disabled',async t=>{const {calls,controller,updater}=setup(t,{autoCheck:false,autoDownload:false,autoInstall:false});await controller.check();updater.emit('update-available',{version:'1.0.1'});await controller.download();updater.emit('update-downloaded',{version:'1.0.1'});t.mock.timers.tick(2000);assert.deepEqual(calls,{check:1,download:1,install:0});controller.install();assert.equal(calls.install,1);});
test('manual installation cannot interrupt active backup or review',async t=>{const {calls,controller,updater,state}=setup(t,{autoCheck:false,autoDownload:false,autoInstall:false});updater.emit('update-downloaded',{version:'1.0.1'});state.idle=false;assert.throws(()=>controller.install(),/Finish or cancel/);assert.equal(calls.install,0);state.idle=true;controller.install();assert.equal(calls.install,1);});
