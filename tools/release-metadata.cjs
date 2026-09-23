const fs=require('node:fs/promises');
const path=require('node:path');
const {createHash}=require('node:crypto');
async function main(){
  const version=process.argv[2]||require('../package.json').version;
  if(!/^\d+\.\d+\.\d+(?:-[a-z]+\.\d+)?$/.test(version))throw Error('Invalid version');
  const name=`Open-File-Backup-Manager-${version}-Setup.exe`;
  const bytes=await fs.readFile(path.join(__dirname,'../release',name));
  const sha512=createHash('sha512').update(bytes).digest('base64');
  const channel=version.includes('-')?version.split('-')[1].split('.')[0]:'latest';
  const metadata=`version: ${version}\nfiles:\n  - url: ${name}\n    sha512: ${sha512}\n    size: ${bytes.length}\npath: ${name}\nsha512: ${sha512}\nreleaseDate: '${new Date().toISOString()}'\n`;
  const directory=path.join(__dirname,'../release/metadata',version);await fs.mkdir(directory,{recursive:true});
  await fs.writeFile(path.join(directory,channel+'.yml'),metadata);
  await fs.writeFile(path.join(directory,'SHA256SUMS.txt'),createHash('sha256').update(bytes).digest('hex')+'  '+name+'\n');
  console.log(`PASS: ${version} ${channel}.yml generated from installer bytes (${bytes.length}).`);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
