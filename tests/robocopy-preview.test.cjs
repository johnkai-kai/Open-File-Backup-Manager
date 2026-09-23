const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {previewRobocopy,parsePreviewLog}=require('../desktop/robocopy-preview.cjs');

async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'ofbm-robocopy-preview-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const source=path.join(root,'source'),destination=path.join(root,'destination');
  await fs.mkdir(source);await fs.mkdir(destination);
  return {root,source,destination};
}

test('native /L mirror preview reports Unicode paths, copies, extra folders and children without changing destination',{skip:process.platform!=='win32'},async t=>{
  const {root,source,destination}=await fixture(t);
  const src=path.join(root,'來源 folder'),dst=path.join(root,'目的 地');
  await fs.rename(source,src);await fs.rename(destination,dst);
  await fs.writeFile(path.join(src,'新檔.txt'),'new');
  await fs.mkdir(path.join(dst,'多餘 資料夾'));
  await fs.writeFile(path.join(dst,'多餘 資料夾','舊檔.txt'),'preserved by dry run');
  const old=await fs.stat(path.join(dst,'多餘 資料夾','舊檔.txt'));
  const result=await previewRobocopy(src,dst,{logRoot:root});
  assert.equal(result.exitCode,3);
  assert.deepEqual(result.command.args.slice(0,2),[src,dst]);
  assert.ok(result.command.args.includes('/L'));
  assert.ok(result.command.args.includes('/MIR'));
  assert.ok(result.command.args.includes('/XJ'));
  assert.ok(result.command.text.includes(src)&&result.command.text.includes(dst));
  assert.deepEqual(result.copy.map(item=>item.relativePath),['新檔.txt']);
  assert.deepEqual(result.remove.map(item=>item.relativePath).sort(),['多餘 資料夾','多餘 資料夾\\舊檔.txt'].sort());
  assert.equal(result.remove.find(item=>item.kind==='dir').bytes,null);
  assert.equal(await fs.access(path.join(dst,'新檔.txt')).then(()=>true,()=>false),false);
  assert.equal(await fs.readFile(path.join(dst,'多餘 資料夾','舊檔.txt'),'utf8'),'preserved by dry run');
  assert.equal((await fs.stat(path.join(dst,'多餘 資料夾','舊檔.txt'))).mtimeMs,old.mtimeMs);
});

test('empty source lists existing destination files for deletion but does not delete them',{skip:process.platform!=='win32'},async t=>{
  const {root,source,destination}=await fixture(t);
  await fs.writeFile(path.join(destination,'keep.txt'),'retained');
  const result=await previewRobocopy(source,destination,{logRoot:root});
  assert.equal(result.exitCode,2);
  assert.deepEqual(result.copy,[]);
  assert.deepEqual(result.remove.map(item=>item.relativePath),['keep.txt']);
  assert.equal(await fs.readFile(path.join(destination,'keep.txt'),'utf8'),'retained');
});

test('copy preview lists source changes but never destination-only items',{skip:process.platform!=='win32'},async t=>{
  const {root,source,destination}=await fixture(t);
  await fs.writeFile(path.join(source,'new.txt'),'copy');
  await fs.writeFile(path.join(destination,'extra.txt'),'preserve');
  await fs.mkdir(path.join(destination,'extra-folder'));
  await fs.writeFile(path.join(destination,'extra-folder','nested.txt'),'preserve');
  const result=await previewRobocopy(source,destination,{mode:'copy',logRoot:root});
  assert.equal(result.mode,'copy');
  assert.deepEqual(result.copy.map(item=>item.relativePath),['new.txt']);
  assert.deepEqual(result.remove,[]);
  assert.ok(result.command.args.includes('/L')&&result.command.args.includes('/E')&&result.command.args.includes('/XX'));
  assert.ok(!result.command.args.includes('/MIR'));
  assert.equal(await fs.readFile(path.join(destination,'extra.txt'),'utf8'),'preserve');
  assert.equal(await fs.readFile(path.join(destination,'extra-folder','nested.txt'),'utf8'),'preserve');
  assert.equal(await fs.access(path.join(destination,'new.txt')).then(()=>true,()=>false),false);
});

test('copy preview tolerates destination extras without listing unrelated files',{skip:process.platform!=='win32'},async t=>{
  const {root,source,destination}=await fixture(t);
  await fs.writeFile(path.join(destination,'extra.txt'),'preserve');
  const result=await previewRobocopy(source,destination,{mode:'copy',logRoot:root});
  assert.equal(result.exitCode,2);
  assert.deepEqual(result.copy,[]);
  assert.deepEqual(result.remove,[]);
  assert.equal(await fs.readFile(path.join(destination,'extra.txt'),'utf8'),'preserve');
});

test('new empty folders remain preview candidates without a copied-file exit bit',{skip:process.platform!=='win32'},async t=>{
  const {root,source,destination}=await fixture(t);
  await fs.mkdir(path.join(source,'empty'));
  const log=path.join(root,'native.log');
  const native=spawnSync(path.join(process.env.SystemRoot||'C:\\Windows','System32','robocopy.exe'),[source,destination,'/L','/E','/XX','/XJ','/COPY:DAT','/DCOPY:DA','/R:0','/W:0','/FP','/BYTES','/NP','/NJH','/NJS','/UNILOG:'+log],{windowsHide:true,stdio:'ignore'});
  assert.equal(native.status,0);
  assert.match(await fs.readFile(log,'utf16le'),/empty/);
  for(const mode of ['copy','mirror']){
    const result=await previewRobocopy(source,destination,{mode,logRoot:root});
    assert.equal(result.exitCode,0);
    assert.deepEqual(result.copy.map(item=>[item.kind,item.relativePath]),[['dir','empty']]);
    assert.deepEqual(result.remove,[]);
  }
  assert.equal(await fs.access(path.join(destination,'empty')).then(()=>true,()=>false),false);
});

test('single-file copy preview filters source siblings and destination extras',{skip:process.platform!=='win32'},async t=>{
  const {root,source,destination}=await fixture(t);
  const selected=path.join(source,'選定 file.txt');
  await fs.writeFile(selected,'selected');
  await fs.writeFile(path.join(source,'sibling.txt'),'unrelated');
  await fs.writeFile(path.join(destination,'extra.txt'),'preserve');
  const result=await previewRobocopy(selected,destination,{mode:'copy',logRoot:root});
  assert.equal(result.source,selected);
  assert.deepEqual(result.command.args.slice(0,3),[source,destination,'選定 file.txt']);
  assert.ok(result.command.args.includes('/LEV:1'));
  assert.ok(result.command.args.includes('/XX'));
  assert.deepEqual(result.copy.map(item=>item.relativePath),['選定 file.txt']);
  assert.deepEqual(result.remove,[]);
  assert.equal(await fs.readFile(path.join(destination,'extra.txt'),'utf8'),'preserve');
  assert.equal(await fs.access(path.join(destination,'選定 file.txt')).then(()=>true,()=>false),false);
});

test('single-file mirror and unknown modes fail before running Robocopy',{skip:process.platform!=='win32'},async t=>{
  const {root,source,destination}=await fixture(t);
  const selected=path.join(source,'file.txt');await fs.writeFile(selected,'selected');
  await assert.rejects(previewRobocopy(selected,destination,{mode:'mirror',logRoot:root}),/source folder/);
  await assert.rejects(previewRobocopy(source,destination,{mode:'unknown',logRoot:root}),/Invalid backup mode/);
  assert.deepEqual(await fs.readdir(destination),[]);
});

test('missing destination remains absent after native preview',{skip:process.platform!=='win32'},async t=>{
  const {root,source,destination}=await fixture(t);
  await fs.writeFile(path.join(source,'file.txt'),'new');
  await fs.rmdir(destination);
  const result=await previewRobocopy(source,destination,{logRoot:root});
  assert.ok(result.copy.some(item=>item.relativePath==='file.txt'));
  assert.deepEqual(result.remove,[]);
  assert.equal(await fs.access(destination).then(()=>true,()=>false),false);
});

test('preview log falls back to a safe destination sibling when Temp is inside source',{skip:process.platform!=='win32'},async t=>{
  const {root,source,destination}=await fixture(t);
  const nestedTemp=path.join(source,'temp');await fs.mkdir(nestedTemp);
  await fs.writeFile(path.join(source,'file.txt'),'copy candidate');
  const before=await fs.readdir(root);
  const result=await previewRobocopy(source,destination,{logRoot:nestedTemp});
  assert.ok(result.copy.some(item=>item.relativePath==='file.txt'));
  assert.deepEqual(await fs.readdir(root),before);
  assert.equal(await fs.access(path.join(destination,'file.txt')).then(()=>true,()=>false),false);
});

test('file versus folder collision fails closed even when Robocopy exits below eight',{skip:process.platform!=='win32'},async t=>{
  const {root,source,destination}=await fixture(t);
  await fs.writeFile(path.join(source,'clash'),'source file');
  await fs.mkdir(path.join(destination,'clash'));
  await fs.writeFile(path.join(destination,'clash','keep.txt'),'untouched');
  await assert.rejects(previewRobocopy(source,destination,{logRoot:root}),/file\/folder conflict/);
  assert.equal(await fs.readFile(path.join(destination,'clash','keep.txt'),'utf8'),'untouched');
});

test('folder versus file collision also fails closed',{skip:process.platform!=='win32'},async t=>{
  const {root,source,destination}=await fixture(t);
  await fs.mkdir(path.join(source,'clash'));await fs.writeFile(path.join(source,'clash','inside.txt'),'source');
  await fs.writeFile(path.join(destination,'clash'),'untouched');
  await assert.rejects(previewRobocopy(source,destination,{logRoot:root}),/file\/folder conflict/);
  assert.equal(await fs.readFile(path.join(destination,'clash'),'utf8'),'untouched');
});

test('localized older and newer file rows remain copy candidates',{skip:process.platform!=='win32'},async t=>{
  const {root,source,destination}=await fixture(t);
  for(const [name,sourceTime,destinationTime] of [['older.txt','2024-01-01','2025-01-01'],['newer.txt','2025-01-01','2024-01-01']]){
    const from=path.join(source,name),to=path.join(destination,name);
    await fs.writeFile(from,'same');await fs.writeFile(to,'same');
    await fs.utimes(from,new Date(sourceTime),new Date(sourceTime));
    await fs.utimes(to,new Date(destinationTime),new Date(destinationTime));
  }
  const result=await previewRobocopy(source,destination,{logRoot:root});
  assert.deepEqual(result.copy.map(item=>item.relativePath).sort(),['newer.txt','older.txt']);
  assert.deepEqual(result.remove,[]);
});

test('unknown or localized status and out-of-root paths fail closed',()=>{
  const source='C:\\fixture\\source',destination='C:\\fixture\\destination';
  assert.throws(()=>parsePreviewLog('\uFEFF\tMystery\t\t1\tC:\\fixture\\source\\file.txt\r\n',source,destination),/Unrecognized Robocopy preview status/);
  assert.throws(()=>parsePreviewLog('\uFEFF\t未識別狀態\t\t1\tC:\\fixture\\source\\file.txt\r\n',source,destination),/Unrecognized Robocopy preview status/);
  assert.throws(()=>parsePreviewLog('\uFEFF\t*EXTRA File\t\t1\tC:\\outside\\file.txt\r\n',source,destination),/outside its expected root/);
  assert.throws(()=>parsePreviewLog('not Unicode',source,destination),/not Unicode/);
});

test('/XJ excludes a junction and its destination counterpart',{skip:process.platform!=='win32'},async t=>{
  const {root,source,destination}=await fixture(t);
  const outside=path.join(root,'outside');await fs.mkdir(outside);await fs.writeFile(path.join(outside,'private.txt'),'outside');
  await fs.symlink(outside,path.join(source,'linked'),'junction');
  await fs.mkdir(path.join(destination,'linked'));await fs.writeFile(path.join(destination,'linked','keep.txt'),'keep');
  const result=await previewRobocopy(source,destination,{logRoot:root,excludedLinks:[path.join(source,'linked')]});
  assert.deepEqual(result.copy,[]);assert.deepEqual(result.remove,[]);
  assert.deepEqual(result.excludedLinks,[{source:path.join(source,'linked'),destination:path.join(destination,'linked')}]);
  assert.ok(result.command.args.includes('/XF')&&result.command.args.includes('/XD'));
  assert.ok(result.command.args.includes(path.join(source,'linked'))&&result.command.args.includes(path.join(destination,'linked')));
  assert.equal(await fs.readFile(path.join(destination,'linked','keep.txt'),'utf8'),'keep');
});

test('link exclusions reject ordinary files and paths outside the source',{skip:process.platform!=='win32'},async t=>{
  const {root,source,destination}=await fixture(t);
  await fs.writeFile(path.join(source,'normal.txt'),'normal');
  await assert.rejects(previewRobocopy(source,destination,{logRoot:root,excludedLinks:[path.join(source,'normal.txt')]}),/not a link/);
  await assert.rejects(previewRobocopy(source,destination,{logRoot:root,excludedLinks:[path.join(root,'outside')]}),/outside its expected root/);
});

test('file symbolic links cannot become copy candidates',{skip:process.platform!=='win32'},async t=>{
  const {root,source,destination}=await fixture(t);
  const target=path.join(root,'outside.txt');await fs.writeFile(target,'outside');
  try{await fs.symlink(target,path.join(source,'linked-file.txt'),'file');}
  catch(error){if(error.code==='EPERM'){t.skip('Windows file symlink privilege is unavailable.');return;}throw error;}
  const result=await previewRobocopy(source,destination,{logRoot:root}).catch(error=>error);
  if(result instanceof Error)assert.match(result.message,/Links and junctions|Robocopy preview/);
  else assert.ok(!result.copy.some(item=>item.relativePath==='linked-file.txt'));
});

test('directory symbolic links cannot become copy candidates',{skip:process.platform!=='win32'},async t=>{
  const {root,source,destination}=await fixture(t);
  const dir=path.join(root,'outside-dir');await fs.mkdir(dir);await fs.writeFile(path.join(dir,'private.txt'),'outside');
  try{await fs.symlink(dir,path.join(source,'linked-dir'),'dir');}
  catch(error){if(error.code==='EPERM'){t.skip('Windows directory symlink privilege is unavailable.');return;}throw error;}
  const directoryResult=await previewRobocopy(source,destination,{logRoot:root}).catch(error=>error);
  if(directoryResult instanceof Error)assert.match(directoryResult.message,/Links and junctions|Robocopy preview/);
  else assert.ok(!directoryResult.copy.some(item=>item.relativePath.startsWith('linked-dir')));
});
