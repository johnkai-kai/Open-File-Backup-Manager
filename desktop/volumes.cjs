const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const path = require('node:path');
function parseMountvol(stdout){
  const result=[];
  let current;
  for(const line of stdout.split(/\r?\n/)){
    const value=line.trim();
    if(/^\\\\\?\\Volume\{[0-9a-f-]+\}\\$/i.test(value)){
      current={DeviceID:value,DriveLetter:null,Label:null};
      result.push(current);
    }else if(current&&/^[a-z]:\\$/i.test(value))current.DriveLetter=value.slice(0,2);
  }
  return result;
}
async function volumes() {
  if(process.platform!=='win32')return [];
  const executable=path.join(process.env.SystemRoot||'C:\\Windows','System32','mountvol.exe');
  const {stdout}=await promisify(execFile)(executable,[],{windowsHide:true,timeout:5000});
  const result=parseMountvol(stdout);
  if(!result.some(item=>item.DriveLetter))throw new Error('Windows volume identities could not be read.');
  return result;
}
function bind(p,list) {
  const root=path.win32.parse(p).root;
  const volume=list.find(v=>v.DriveLetter && root.toLowerCase()===v.DriveLetter.toLowerCase()+'\\');
  return volume ? {id:volume.DeviceID,relative:path.win32.relative(root,p),label:volume.Label||volume.DriveLetter} : null;
}
function requirePhysical(p,list) {
  if(process.platform!=='win32')return;
  if(/^\\\\[?.]\\/.test(p))throw new Error('Windows device paths are not supported.');
  const root=path.win32.parse(p).root;
  if(!/^[a-z]:\\$/i.test(root))throw new Error('Choose a local or external Windows drive.');
  if(!list.some(v=>v.DeviceID&&v.DriveLetter?.toLowerCase()===root.slice(0,2).toLowerCase()))throw new Error('Virtual or disconnected drives are not supported. Choose a physical Windows volume.');
}
function resolve(p,binding,list) {
  if(!binding)return p;
  const volume=list.find(v=>v.DeviceID===binding.id);
  if(!volume?.DriveLetter)throw new Error('Drive disconnected: '+binding.label);
  if(typeof binding.relative!=='string'||path.win32.isAbsolute(binding.relative)||binding.relative.split(/[\\/]/).includes('..'))throw new Error('Invalid drive binding.');
  return path.win32.join(volume.DriveLetter+'\\',binding.relative);
}
module.exports={volumes,parseMountvol,bind,resolve,requirePhysical};
