const LOGIN_ITEM_NAME='Open File Backup Manager';
function loginItemStatus(app,platform=process.platform,environment=process.env) {
  if(platform!=='win32'||!app.isPackaged||environment.OFBM_TEST_DATA)return {available:false,configured:false,active:false,path:null};
  const location=app.getPath('exe');
  const state=app.getLoginItemSettings({path:location,args:[]});
  return {available:true,configured:Boolean(state.openAtLogin),active:Boolean(state.openAtLogin&&state.executableWillLaunchAtLogin!==false),path:location};
}
function setStartWithWindows(app,enabled,platform=process.platform,environment=process.env) {
  if(platform!=='win32'||!app.isPackaged||environment.OFBM_TEST_DATA)throw new Error('Windows startup is available only in the installed Windows app.');
  const location=app.getPath('exe');
  app.setLoginItemSettings({openAtLogin:enabled,path:location,args:[],name:LOGIN_ITEM_NAME,...(enabled?{enabled:true}:{})});
  const status=loginItemStatus(app,platform,environment);
  if(status.configured!==enabled||enabled&&!status.active)throw new Error('Windows did not apply the startup setting. Check Startup Apps in Windows Settings.');
  return status;
}
module.exports={LOGIN_ITEM_NAME,loginItemStatus,setStartWithWindows};
