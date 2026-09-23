const fs = require('node:fs/promises');
const path = require('node:path');
const defaults = () => ({schema:1,profiles:[],settings:{theme:'dark',language:'en',autoCheck:true,autoDownload:true,autoInstall:false,startWithWindows:false,closeBehavior:'quit'}});
function validate(data) {
  if (!data || !Array.isArray(data.profiles) || data.profiles.length > 1000) throw new Error('Invalid profiles.');
  if (!['en','zh-TW'].includes(data.settings?.language) || !['dark','light','system'].includes(data.settings?.theme)) throw new Error('Invalid settings.');
  delete data.settings.writeMode;
  if (!Object.hasOwn(data.settings,'startWithWindows')) data.settings.startWithWindows=false;
  if (!Object.hasOwn(data.settings,'closeBehavior')) data.settings.closeBehavior='quit';
  if (typeof data.settings.startWithWindows !== 'boolean' || !['quit','tray'].includes(data.settings.closeBehavior)) throw new Error('Invalid startup or window setting.');
  const ids = new Set();
  for (const profile of data.profiles) {
    if (typeof profile.id !== 'string' || ids.has(profile.id) || typeof profile.name !== 'string' || !profile.name.trim() || !['mirror','copy'].includes(profile.mode) || !Array.isArray(profile.jobs)) throw new Error('Invalid profile.');
    ids.add(profile.id);
    for (const job of profile.jobs) {
      if (typeof job.id !== 'string' || ids.has(job.id) || typeof job.name !== 'string' || !job.name.trim() || !['inherit','mirror','copy'].includes(job.mode) || typeof job.source !== 'string' || typeof job.destination !== 'string') throw new Error('Invalid backup job.');
      ids.add(job.id);
    }
  }
  for (const flag of ['autoCheck','autoDownload','autoInstall']) if (typeof data.settings[flag] !== 'boolean') throw new Error('Invalid update setting.');
  return data;
}
class Store {
  constructor(root) { this.root=root; this.file=path.join(root,'settings.json'); this.queue=Promise.resolve(); }
  async read() { try { return validate(JSON.parse(await fs.readFile(this.file,'utf8'))); } catch(e) { if(e.code==='ENOENT')return defaults(); throw new Error('Settings cannot be read. Existing file was preserved. ' + e.message); } }
  save(data) {
    validate(data);
    const text = JSON.stringify(data,null,2);
    const task = this.queue.then(async()=>{await fs.mkdir(this.root,{recursive:true}); await fs.writeFile(this.file+'.tmp',text); await fs.rename(this.file+'.tmp',this.file);});
    this.queue=task.catch(()=>{}); return task;
  }
  async log(record) { return this.logBatch([record]); }
  async logBatch(records) { if(!records.length)return;await fs.mkdir(path.join(this.root,'logs'),{recursive:true});await fs.appendFile(path.join(this.root,'logs',new Date().toISOString().slice(0,10)+'.jsonl'),records.map(record=>JSON.stringify({time:new Date().toISOString(),...record})).join('\n')+'\n'); }
  async history() {
    const dir=path.join(this.root,'logs');
    const names=await fs.readdir(dir).catch(()=>[]);
    const records=[];
    for(const name of names.filter(n=>/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(n)).sort().slice(-7)) {
      const lines=(await fs.readFile(path.join(dir,name),'utf8')).trim().split('\n');
      for(const line of lines)if(line)try{records.push(JSON.parse(line));}catch{}
    }
    return records.slice(-1000).reverse();
  }
}
module.exports={Store,defaults,validate};
