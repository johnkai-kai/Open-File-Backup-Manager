const fs=require('node:fs/promises');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const names=['index.html','src/app.js','src/styles.css','src/i18n.js','src/assets/fold.svg','src/assets/Manrope.ttf','src/assets/Manrope-OFL.txt','src/assets/InstrumentSans.ttf','src/assets/InstrumentSans-OFL.txt','src/assets/canopy-atmosphere.png','src/assets/nocturne-atmosphere.png'];
const hash=b=>createHash('sha256').update(b).digest('hex');
async function read(p){try{return await fs.readFile(p);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function safe(base,name){const p=path.resolve(base,name);if(!p.startsWith(base+path.sep))throw new Error('Path outside workspace.');for(let v=p;v!==path.dirname(base);v=path.dirname(v)){const st=await fs.lstat(v).catch(e=>{if(e.code==='ENOENT')return null;throw e;});if(st?.isSymbolicLink())throw new Error('Symlink refused: '+v);}return p;}
async function main(){
  const apply=process.argv.includes('--apply');
  if(process.argv.slice(2).some(a=>a!=='--apply'))throw new Error('Only --apply is supported.');
  const config=await read(path.join(root,'.local/design-target.json'));
  if(!config){console.log(JSON.stringify({status:'not-connected',message:'OpenDesign project is not connected. No files changed.',files:names},null,2));process.exitCode=2;return;}
  const settings=JSON.parse(config),target=path.resolve(settings.directory);
  if(target===root||target.startsWith(root+path.sep)||root.startsWith(target+path.sep))throw new Error('Design must be a separate directory.');
  await safe(target,'index.html');
  const manifestPath=path.join(root,'.local/design-sync-manifest.json');
  const raw=await read(manifestPath),baseline=raw?JSON.parse(raw):{target,files:{}};
  if(baseline.target!==target)throw new Error('Design target changed; review the previous baseline first.');
  const plan=[],conflicts=[],files={};
  for(const name of names){const from=await fs.readFile(await safe(root,name)),dest=await read(await safe(target,name));files[name]=hash(from);if(dest&&hash(dest)===hash(from))continue;if(dest&&hash(dest)!==baseline.files[name])conflicts.push(name);else plan.push(name);}
  console.log(JSON.stringify({mode:apply?'apply':'check',target,plan,conflicts},null,2));
  if(conflicts.length){process.exitCode=2;return;}
  if(apply){for(const name of plan){
    const input=path.join(root,'.local/od-sync-input.json');
    const encoding=/\.(ttf|png)$/.test(name)?'base64':'utf8';
    await fs.writeFile(input,JSON.stringify({name:'write_file',arguments:{project:settings.project,path:name,encoding,content:(await fs.readFile(path.join(root,name))).toString(encoding)}}));
    const output=execFileSync(process.execPath,[path.join(root,'tools/opendesign-mcp.cjs'),input],{encoding:'utf8',windowsHide:true});
    const result=JSON.parse(output.trim().split('\n').at(-1));if(result.isError)throw new Error(JSON.stringify(result));
  }for(const name of names)if(hash(await fs.readFile(path.join(target,name)))!==files[name])throw new Error('Verification failed: '+name);await fs.writeFile(manifestPath,JSON.stringify({target,files,updatedAt:new Date().toISOString()},null,2));console.log(`PASS: ${names.length} frontend files matched through OpenDesign MCP. Backend and private state excluded.`);}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
