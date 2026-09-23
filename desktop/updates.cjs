class Updates {
  constructor(updater,{onStatus,isIdle}) {
    this.updater=updater;this.onStatus=onStatus;this.isIdle=isIdle;
    this.state={state:'unconfigured'};this.settings={};this.ready=false;this.configured=false;
    updater.autoDownload=false;updater.autoInstallOnAppQuit=false;
  }
  setState(state,info={}) {this.state={state,version:info.version,percent:info.percent,error:info.message};this.onStatus(this.state);}
  start(configured,settings) {
    this.configured=configured;
    if(!configured){this.settings=settings;return;}
    for(const [event,state]of [['checking-for-update','checking'],['update-available','available'],['update-not-available','current'],['download-progress','downloading'],['update-downloaded','ready']])this.updater.on(event,info=>{
      this.setState(state,info);
      if(state==='available'&&this.settings.autoDownload)this.download().catch(()=>{});
      if(state==='ready'){this.ready=true;this.idleChanged();}
    });
    this.updater.on('error',e=>this.setState('error',e));
    this.setState('idle');this.configure(settings,true);
  }
  configure(settings,initial=false) {
    const previous=this.settings;this.settings={...settings};
    clearInterval(this.interval);clearTimeout(this.startup);
    if(!this.configured)return;
    if(settings.autoCheck){
      this.interval=setInterval(()=>this.check().catch(()=>{}),30*60*1000);this.interval.unref?.();
      if(initial){this.startup=setTimeout(()=>this.check().catch(()=>{}),5000);this.startup.unref?.();}
      else if(!previous.autoCheck)this.check().catch(()=>{});
    }
    if(settings.autoDownload&&this.state.state==='available')this.download().catch(()=>{});
    this.idleChanged();
  }
  async check() {
    if(!this.configured||this.ready||this.downloading)return this.state;
    if(!this.checking)this.checking=Promise.resolve().then(()=>this.updater.checkForUpdates()).catch(e=>{this.setState('error',e);throw e;}).finally(()=>{this.checking=null;});
    await this.checking;return this.state;
  }
  async download() {
    if(!this.configured||this.ready)return this.state;
    if(!this.downloading){this.setState('downloading',{version:this.state.version});this.downloading=Promise.resolve().then(()=>this.updater.downloadUpdate()).catch(e=>{this.setState('error',e);throw e;}).finally(()=>{this.downloading=null;});}
    await this.downloading;return this.state;
  }
  idleChanged() {
    clearTimeout(this.installTimer);
    if(this.ready&&this.settings.autoInstall&&this.isIdle()&&!this.installing){
      this.installTimer=setTimeout(()=>{if(this.ready&&this.settings.autoInstall&&this.isIdle())this.install();},1500);this.installTimer.unref?.();
    }
  }
  install() {
    if(!this.ready)throw new Error('No downloaded update.');
    if(!this.isIdle())throw new Error('Finish or cancel the current backup first.');
    if(this.installing)return;
    this.installing=true;
    try{this.updater.quitAndInstall(true,true);}catch(e){this.installing=false;this.setState('error',e);throw e;}
  }
  stop() {clearInterval(this.interval);clearTimeout(this.startup);clearTimeout(this.installTimer);}
}
module.exports={Updates};
