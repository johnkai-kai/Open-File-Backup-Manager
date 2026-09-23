const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {spawn,execFileSync}=require('node:child_process');
const {planJob,executePlan,validatePairs,signature}=require('../desktop/engine.cjs');
const {diagnose,parseSummary,latestFile}=require('../desktop/robocopy.cjs');
const {Store,defaults}=require('../desktop/store.cjs');
const volumes=require('../desktop/volumes.cjs');
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'ofbm-test-'));const source=path.join(root,'source'),destination=path.join(root,'destination');await fs.mkdir(source);await fs.mkdir(destination);t.after(()=>fs.rm(root,{recursive:true,force:true}));return {root,source,destination,mode:'mirror'};}
test('Robocopy alone copies files and reports its real command and result',{skip:process.platform!=='win32'},async t=>{
  const j=await fixture(t),logs=[];await fs.writeFile(path.join(j.source,'file'),'direct');await fs.writeFile(path.join(j.destination,'file'),'old');await fs.chmod(path.join(j.destination,'file'),0o444);const result=await executePlan(await planJob(j),{onLog:r=>logs.push(r)});assert.equal(result.copied,1);assert.equal(result.transferred,6);assert.equal(logs.find(r=>r.status==='engine').engine,'robocopy');assert.equal(logs.find(r=>r.status==='command').args[1],await fs.realpath(j.destination));assert.equal(logs.find(r=>r.status==='engine-result').copied,1);assert.equal(await fs.readFile(path.join(j.destination,'file'),'utf8'),'direct');assert.deepEqual(await fs.readdir(j.destination),['file']);
});
test('logged command matches the exact executable and arguments passed to spawn',{skip:process.platform!=='win32'},async t=>{
  const j=await fixture(t),events=[],calls=[];
  j.mode='copy';j.source=path.join(j.root,'source files 資料');j.destination=path.join(j.root,'backup drive');
  await fs.mkdir(j.source);await fs.mkdir(j.destination);await fs.writeFile(path.join(j.source,'one.txt'),'one');
  const spawnCopy=(file,args,options)=>{calls.push({file,args:[...args],options});return spawn(file,args,options);};
  await executePlan(await planJob(j),{spawnCopy,onLog:event=>events.push(event)});
  assert.equal(calls.length,1);
  const actual=calls[0],logged=events.find(event=>event.status==='command');
  assert.equal(logged.executable,actual.file);
  assert.deepEqual(logged.args,actual.args);
  assert.equal(logged.command,[actual.file,...actual.args].map(value=>'"'+value+'"').join(' '));
  assert.equal(actual.options.shell,undefined);
  assert.equal(actual.options.windowsHide,true);
  assert.deepEqual(actual.args.slice(0,2),[await fs.realpath(j.source),await fs.realpath(j.destination)]);
  for(const flag of ['/E','/Z','/COPY:DAT','/DCOPY:DA','/MT:8','/R:0','/W:0','/XJ','/FP','/BYTES','/NP','/NDL'])assert.ok(actual.args.includes(flag),flag);
  assert.ok(actual.args.some(arg=>arg.startsWith('/UNILOG:')));
});
test('direct mirror keeps skipped-link destinations and deletes only confirmed extras',{skip:process.platform!=='win32'},async t=>{
  const j=await fixture(t),logs=[];await fs.symlink(j.root,path.join(j.source,'link'),'junction');await fs.mkdir(path.join(j.destination,'link'));await fs.writeFile(path.join(j.destination,'link','keep'),'safe');await fs.writeFile(path.join(j.source,'file'),'new');await fs.writeFile(path.join(j.destination,'extra'),'old');const plan=await planJob(j);await assert.rejects(executePlan(plan),/confirmed/);const result=await executePlan(plan,{confirmDelete:true,onLog:event=>logs.push(event)});assert.equal(result.deleted,1);assert.equal(await fs.readFile(path.join(j.destination,'link','keep'),'utf8'),'safe');const args=logs.find(event=>event.status==='command').args;assert.ok(args.includes('/XJ'));assert.ok(args.includes('/XF'));assert.ok(args.includes('/XD'));assert.ok(!args.includes('/SL'));for(const stage of ['preflight','copy','verify','delete']){const timings=logs.filter(event=>event.status==='timing'&&event.stage===stage);assert.equal(timings.length,1);assert.ok(Number.isInteger(timings[0].durationMs)&&timings[0].durationMs>=0);}
});
test('Robocopy detection reports the executable location',{skip:process.platform!=='win32'},async()=>{
  const result=await diagnose();assert.equal(result.available,true);assert.match(result.path,/System32\\robocopy\.exe$/i);assert.equal(result.error,null);
});
test('direct mode creates empty folders even when no file needs copying',{skip:process.platform!=='win32'},async t=>{
  const j=await fixture(t);await fs.mkdir(path.join(j.source,'empty','nested'),{recursive:true});const result=await executePlan(await planJob(j));assert.equal(result.failed,0);assert.ok((await fs.stat(path.join(j.destination,'empty','nested'))).isDirectory());
});
test('Robocopy makes unchanged-file decisions and reports actual counts',{skip:process.platform!=='win32'},async t=>{
  const j=await fixture(t);await fs.mkdir(path.join(j.source,'space 資料'));await fs.writeFile(path.join(j.source,'space 資料','new.txt'),'new');await fs.writeFile(path.join(j.source,'unchanged.txt'),'same');await executePlan(await planJob(j));
  await fs.writeFile(path.join(j.source,'space 資料','new.txt'),'changed content');const logs=[];const result=await executePlan(await planJob(j),{onLog:r=>logs.push(r)});assert.equal(result.copied,1);assert.equal(result.skipped,1);assert.equal(result.transferred,15);
  const command=logs.find(r=>r.status==='command');assert.ok(command.command.includes('robocopy.exe'));assert.ok(command.args.includes('/E'));assert.ok(!command.args.includes('/MIR'));assert.ok(!command.args.includes('/SL'));assert.equal(logs.find(r=>r.status==='engine-result').exitCode,1);
  assert.equal(await fs.readFile(path.join(j.destination,'space 資料','new.txt'),'utf8'),'changed content');
});
test('preview candidates do not inflate actual transferred bytes',{skip:process.platform!=='win32'},async t=>{
  const j=await fixture(t);j.mode='copy';await fs.writeFile(path.join(j.source,'same.txt'),'unchanged');await executePlan(await planJob(j));
  const plan=await planJob(j);
  assert.equal(plan.copy.length,0);
  assert.equal(plan.totalBytes,0);
  const result=await executePlan(plan);
  assert.equal(result.copied,0);assert.equal(result.transferred,0);
});
test('unknown localized summary never becomes a guessed transfer count',()=>{
  assert.deepEqual(parseSummary('  Fichiers :  5  3  2  0  0  0\n  Octets :  100  60  40  0  0  0'),{copied:null,skipped:null,transferred:null});
});
test('current file comes only from a known Robocopy file row',()=>{
  const source=path.join(os.tmpdir(),'ofbm-log-source'),file=path.join(source,'資料.txt');
  const plan={source,sourceIsFile:false,sourceFiles:new Map([['資料.txt',{kind:'file'}]])};
  assert.equal(latestFile('   Source : '+source+'\\\r\n   Files : *.*',plan),null);
  assert.equal(latestFile('\t    New File  \t       6\t'+file+'\r\n   Source : '+source+'\\',plan),file);
  assert.equal(latestFile('\t    New File  \t       6\t'+path.join(source,'unknown.txt'),plan),null);
  assert.equal(latestFile('\t    New File  \t       6\t'+path.join(os.tmpdir(),'outside.txt'),plan),null);
});
test('Windows copy replaces read-only hidden files and retains source read-only attribute',{skip:process.platform!=='win32'},async t=>{
  const j=await fixture(t),source=path.join(j.source,'object'),destination=path.join(j.destination,'object');
  await fs.writeFile(source,'new object');await fs.writeFile(destination,'old');
  await fs.chmod(source,0o444);execFileSync('attrib.exe',['+R','+H',destination],{windowsHide:true});
  const result=await executePlan(await planJob(j));
  assert.equal(result.failed,0);assert.equal(result.copied,1);
  assert.equal(await fs.readFile(destination,'utf8'),'new object');
  assert.equal((await fs.stat(destination)).mode & 0o200,0);
  assert.equal((await planJob(j)).copy.length,0);
});
test('Robocopy failure leaves mirror deletions untouched',{skip:process.platform!=='win32'},async t=>{
  const j=await fixture(t),destination=path.join(j.destination,'locked');
  await fs.writeFile(path.join(j.source,'locked'),'new longer data');await fs.writeFile(destination,'original');await fs.writeFile(path.join(j.destination,'extra'),'keep');
  await fs.chmod(destination,0o444);
  const plan=await planJob(j),events=[];
  const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',`$f=[IO.File]::Open('${destination.replace(/'/g,"''")}','Open','Read','Read');try{[Console]::WriteLine('ready');[Console]::ReadLine() | Out-Null}finally{$f.Dispose()}`],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  const closed=new Promise(resolve=>child.once('close',resolve));
  try {
    await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);child.once('exit',code=>reject(new Error(`Lock worker exited: ${code}`)));});
    await assert.rejects(executePlan(plan,{confirmDelete:true,onLog:event=>events.push(event)}),/Robocopy failed/);
    assert.equal(await fs.readFile(destination,'utf8'),'original');
    assert.deepEqual((await fs.readdir(j.destination)).sort(),['extra','locked']);
    assert.ok(events.find(event=>event.status==='command')?.command.includes('/UNILOG:'));
    assert.ok(events.find(event=>event.status==='engine-result')?.exitCode>=8);
    assert.deepEqual(events.filter(event=>event.status==='timing').map(event=>event.stage),['preflight','copy']);
  } finally {child.stdin.end('\n');await closed;}
});
test('Robocopy handles paths beyond MAX_PATH',{skip:process.platform!=='win32'},async t=>{
  const j=await fixture(t),relative=path.join(...Array.from({length:5},(_,i)=>`${i}-${'a'.repeat(48)}`),'unicode-資料.txt');
  await fs.mkdir(path.dirname(path.join(j.source,relative)),{recursive:true});await fs.writeFile(path.join(j.source,relative),'complete');
  const result=await executePlan(await planJob(j));assert.equal(result.failed,0);assert.equal(await fs.readFile(path.join(j.destination,relative),'utf8'),'complete');
});
test('copy mode replaces old file and keeps unrelated destination files',async t=>{const j=await fixture(t);j.mode='copy';await fs.writeFile(path.join(j.source,'a.txt'),'new data');await fs.writeFile(path.join(j.destination,'a.txt'),'old');await fs.writeFile(path.join(j.destination,'keep.txt'),'keep');const result=await executePlan(await planJob(j));assert.equal(result.copied,1);assert.equal(await fs.readFile(path.join(j.destination,'a.txt'),'utf8'),'new data');assert.equal(await fs.readFile(path.join(j.destination,'keep.txt'),'utf8'),'keep');assert.equal((await planJob(j)).copy.length,0);});
test('mirror requires confirmation and removes only extras inside its destination',async t=>{const j=await fixture(t);await fs.writeFile(path.join(j.source,'a.txt'),'a');await fs.mkdir(path.join(j.destination,'extra'));await fs.writeFile(path.join(j.destination,'extra','old.txt'),'old');await fs.writeFile(path.join(j.root,'outside.txt'),'outside');const p=await planJob(j);await assert.rejects(executePlan(p),/confirmed/);const result=await executePlan(p,{confirmDelete:true});assert.equal(result.deleted,2);assert.deepEqual(await fs.readdir(j.destination),['a.txt']);assert.equal(await fs.readFile(path.join(j.root,'outside.txt'),'utf8'),'outside');});
test('missing source cannot become an empty mirror',async t=>{const j=await fixture(t);await fs.rmdir(j.source);await fs.writeFile(path.join(j.destination,'keep'),'safe');await assert.rejects(planJob(j),/ENOENT/);assert.equal(await fs.readFile(path.join(j.destination,'keep'),'utf8'),'safe');});
test('overlapping and root destinations are rejected',async t=>{const j=await fixture(t);await assert.rejects(planJob({...j,destination:j.source}),/overlap/);await assert.rejects(planJob({...j,destination:path.join(j.source,'nested')}),/overlap/);await assert.rejects(planJob({...j,destination:path.parse(j.destination).root}),/drive root/);});
test('cross-job destination and source overlaps rejected',async t=>{const j=await fixture(t);await assert.rejects(validatePairs([j,{source:path.join(j.destination,'nested'),destination:path.join(j.root,'other')}]),/overlap/);});
test('pre-canceled execution preserves existing destination',async t=>{const j=await fixture(t);await fs.writeFile(path.join(j.source,'a'),'new');await fs.writeFile(path.join(j.destination,'a'),'old');const p=await planJob(j),controller=new AbortController();controller.abort();await assert.rejects(executePlan(p,{signal:controller.signal}),/Canceled/);assert.equal(await fs.readFile(path.join(j.destination,'a'),'utf8'),'old');});
test('canceled Robocopy retains the attempted command and does not mirror-delete',{skip:process.platform!=='win32'},async t=>{
  const j=await fixture(t),events=[],calls=[],controller=new AbortController();
  await fs.writeFile(path.join(j.source,'large'),Buffer.alloc(4*1024*1024,1));
  await fs.writeFile(path.join(j.destination,'extra'),'preserve');
  const plan=await planJob(j);
  const spawnCopy=(file,args,options)=>{calls.push({file,args:[...args]});return spawn(file,args,options);};
  await assert.rejects(executePlan(plan,{signal:controller.signal,confirmDelete:true,spawnCopy,onLog:event=>events.push(event),onProgress:event=>{if(event.phase==='copying')controller.abort();}}),/Canceled/);
  assert.equal(calls.length,1);
  assert.deepEqual(events.find(event=>event.status==='command').args,calls[0].args);
  assert.equal(await fs.readFile(path.join(j.destination,'extra'),'utf8'),'preserve');
});
test('cancel after Robocopy starts leaves confirmed mirror extras intact',{skip:process.platform!=='win32'},async t=>{
  const j=await fixture(t),controller=new AbortController(),events=[];
  await fs.writeFile(path.join(j.source,'large'),Buffer.alloc(8*1024*1024,1));
  await fs.writeFile(path.join(j.destination,'extra'),'preserved');
  const spawnCopy=(file,args,options)=>{const child=spawn(file,args,options);child.once('spawn',()=>controller.abort());return child;};
  await assert.rejects(executePlan(await planJob(j),{signal:controller.signal,confirmDelete:true,spawnCopy,onLog:event=>events.push(event)}),/Canceled/);
  assert.ok(events.some(event=>event.status==='command'));
  assert.deepEqual(events.filter(event=>event.status==='timing').map(event=>event.stage),['preflight','copy']);
  assert.equal(await fs.readFile(path.join(j.destination,'extra'),'utf8'),'preserved');
});
test('cancel during mirror deletion leaves the next confirmed item intact',{skip:process.platform!=='win32'},async t=>{
  const j=await fixture(t),controller=new AbortController();
  await fs.writeFile(path.join(j.source,'normal'),'copied');
  await fs.writeFile(path.join(j.destination,'extra'),'preserved');
  const plan=await planJob(j);
  await assert.rejects(executePlan(plan,{signal:controller.signal,confirmDelete:true,onProgress:event=>{if(event.phase==='deleting')controller.abort();}}),/Canceled/);
  assert.equal(await fs.readFile(path.join(j.destination,'normal'),'utf8'),'copied');
  assert.equal(await fs.readFile(path.join(j.destination,'extra'),'utf8'),'preserved');
});
test('disconnected source after review blocks copy and mirror deletion',{skip:process.platform!=='win32'},async t=>{
  const j=await fixture(t);
  await fs.writeFile(path.join(j.source,'normal'),'source');
  await fs.writeFile(path.join(j.destination,'extra'),'preserved');
  const plan=await planJob(j);
  await fs.rename(j.source,path.join(j.root,'disconnected-source'));
  await assert.rejects(executePlan(plan,{confirmDelete:true}));
  assert.equal(await fs.readFile(path.join(j.destination,'extra'),'utf8'),'preserved');
});
test('changed source blocks copy and mirror deletion',async t=>{const j=await fixture(t);await fs.writeFile(path.join(j.source,'a'),'a');await fs.writeFile(path.join(j.destination,'extra'),'safe');const p=await planJob(j);await fs.writeFile(path.join(j.source,'a'),'changed');await assert.rejects(executePlan(p,{confirmDelete:true}),/Source changed/);assert.equal(await fs.readFile(path.join(j.destination,'extra'),'utf8'),'safe');});
test('new source file after preview prevents mirror deletion',async t=>{const j=await fixture(t);await fs.writeFile(path.join(j.destination,'extra'),'safe');const p=await planJob(j);await fs.writeFile(path.join(j.source,'new'),'new');await assert.rejects(executePlan(p,{confirmDelete:true}),/Source changed/);assert.equal(await fs.readFile(path.join(j.destination,'extra'),'utf8'),'safe');});
test('destination edits after preview are preserved',async t=>{const j=await fixture(t);await fs.writeFile(path.join(j.source,'a'),'new content');await fs.writeFile(path.join(j.destination,'a'),'old');const p=await planJob(j);await fs.writeFile(path.join(j.destination,'a'),'user changes');await assert.rejects(executePlan(p),/Destination changed/);assert.equal(await fs.readFile(path.join(j.destination,'a'),'utf8'),'user changes');});
test('root junctions remain rejected',async t=>{const j=await fixture(t);const link=path.join(j.root,'link');await fs.symlink(j.source,link,'junction');await assert.rejects(planJob({...j,source:link}),/Links and junctions/);await assert.rejects(planJob({...j,destination:link}),/Links and junctions/);});
test('file-folder collision stops preflight without deletion',async t=>{const j=await fixture(t);await fs.writeFile(path.join(j.source,'a'),'a');await fs.mkdir(path.join(j.destination,'a'));await assert.rejects(planJob(j),/conflict/);});
test('empty directories and unicode names survive backup',async t=>{const j=await fixture(t);await fs.mkdir(path.join(j.source,'空資料夾'));await fs.writeFile(path.join(j.source,'備份.txt'),'完整');await executePlan(await planJob(j));assert.equal(await fs.readFile(path.join(j.destination,'備份.txt'),'utf8'),'完整');assert.ok((await fs.stat(path.join(j.destination,'空資料夾'))).isDirectory());});
test('single file is supported in copy mode, rejected in mirror mode',async t=>{const j=await fixture(t);const file=path.join(j.source,'a.txt');await fs.writeFile(file,'a');await assert.rejects(planJob({...j,source:file}),/mirror preview requires/i);await executePlan(await planJob({...j,source:file,mode:'copy'}));assert.equal(await fs.readFile(path.join(j.destination,'a.txt'),'utf8'),'a');});
test('completed transfer reflects Robocopy summary, not a planned estimate',{skip:process.platform!=='win32'},async t=>{const j=await fixture(t);await fs.writeFile(path.join(j.source,'a'),Buffer.alloc(200000));const events=[];const result=await executePlan(await planJob(j),{onProgress:e=>events.push(e)});assert.equal(result.transferred,200000);assert.equal(events.at(-1).transferred,200000);});
test('store persists settings and logs; corrupt data is not overwritten',async t=>{const j=await fixture(t),s=new Store(path.join(j.root,'app'));const data=defaults();data.settings.language='zh-TW';await s.save(data);assert.equal((await s.read()).settings.language,'zh-TW');await s.log({status:'failed',error:'fixture failure'});assert.equal((await s.history())[0].error,'fixture failure');await fs.writeFile(s.file,'broken');await assert.rejects(s.read(),/preserved/);assert.equal(await fs.readFile(s.file,'utf8'),'broken');});
test('drive binding follows volume identity instead of letter',()=>{const old=[{DeviceID:'volume-a',DriveLetter:'E:',Label:'Backup'}],binding=volumes.bind('E:\\Backup\\Docs',old);assert.equal(volumes.resolve('E:\\Backup\\Docs',binding,[{DeviceID:'volume-a',DriveLetter:'F:'}]),'F:\\Backup\\Docs');assert.throws(()=>volumes.resolve('',binding,[{DeviceID:'other',DriveLetter:'E:'}]),/disconnected/);});
test('native Windows volume listing maps drive letters without relying on localized text',()=>{
  const listing='\\\\?\\Volume{7d3fc31c-6ac9-450a-9d32-b8ec1faa0e73}\\\r\n    C:\\\r\n\\\\?\\Volume{cefc5c22-cf9b-4fec-a9a9-a6e8456824e7}\\\r\n    *** 無掛接點 ***\r\n';
  assert.deepEqual(volumes.parseMountvol(listing),[{DeviceID:'\\\\?\\Volume{7d3fc31c-6ac9-450a-9d32-b8ec1faa0e73}\\',DriveLetter:'C:',Label:null},{DeviceID:'\\\\?\\Volume{cefc5c22-cf9b-4fec-a9a9-a6e8456824e7}\\',DriveLetter:null,Label:null}]);
});
test('drive aliases without a Windows volume identity are rejected before scanning',{skip:process.platform!=='win32'},async()=>{await assert.rejects(validatePairs([{source:'Z:\\source',destination:'Z:\\backup'}],{volumeList:[{DeviceID:'real-c',DriveLetter:'C:'}]}),/Virtual or disconnected drives/);});
test('destinations cannot contain or be inside protected application data',async t=>{const j=await fixture(t);const settings=path.join(j.destination,'appdata');await fs.mkdir(settings);await assert.rejects(validatePairs([j],{protectedPaths:[settings]}),/protected/);await assert.rejects(validatePairs([{...j,destination:path.join(settings,'backup')}],{protectedPaths:[settings]}),/protected/);});
test('ambiguous Windows names and device paths are rejected',{skip:process.platform!=='win32'},async t=>{const j=await fixture(t);for(const name of ['folder.','folder ','CON','file:stream'])await assert.rejects(planJob({...j,destination:path.join(j.destination,name)}),/reserved/);await assert.rejects(planJob({...j,destination:'\\\\?\\C:\\backup'}),/device/);});
test('drive bindings cannot escape their volume',()=>{for(const relative of ['..\\escape','C:\\escape','\\\\server\\share'])assert.throws(()=>volumes.resolve('',{id:'v',relative},[{DeviceID:'v',DriveLetter:'E:'}]),/Invalid/);});
test('nested source junction is skipped while mirror preserves its destination subtree',async t=>{const j=await fixture(t);const outside=path.join(j.root,'outside');await fs.mkdir(outside);await fs.writeFile(path.join(outside,'private'),'outside');await fs.mkdir(path.join(j.source,'skills'));await fs.symlink(outside,path.join(j.source,'skills','herdr'),'junction');await fs.writeFile(path.join(j.source,'normal'),'copied');await fs.mkdir(path.join(j.destination,'skills','herdr','nested'),{recursive:true});await fs.writeFile(path.join(j.destination,'skills','herdr','nested','keep'),'preserved');await fs.writeFile(path.join(j.destination,'obsolete'),'remove');const p=await planJob(j);assert.deepEqual(p.skippedLinks,[path.join('skills','herdr')]);assert.deepEqual(p.remove.map(f=>f.name),['obsolete']);const logs=[];const result=await executePlan(p,{confirmDelete:true,onLog:e=>logs.push(e)});assert.equal(result.warnings,1);assert.equal(result.failed,0);assert.equal(await fs.readFile(path.join(j.destination,'normal'),'utf8'),'copied');assert.equal(await fs.readFile(path.join(j.destination,'skills','herdr','nested','keep'),'utf8'),'preserved');assert.equal(await fs.readFile(path.join(outside,'private'),'utf8'),'outside');assert.equal(logs.filter(e=>e.status==='link-skipped').length,1);});
test('file symbolic links are excluded without replacing their destination counterpart',{skip:process.platform!=='win32'},async t=>{
  const j=await fixture(t),outside=path.join(j.root,'private.txt');
  await fs.writeFile(outside,'private');
  try{await fs.symlink(outside,path.join(j.source,'link.txt'),'file');}
  catch(e){if(e.code==='EPERM'){t.skip('Windows symlink privilege is unavailable on this host.');return;}throw e;}
  await fs.writeFile(path.join(j.source,'normal.txt'),'copy');await fs.writeFile(path.join(j.destination,'link.txt'),'preserve');
  await fs.writeFile(path.join(j.destination,'obsolete.txt'),'remove');
  const plan=await planJob(j),logs=[];assert.deepEqual(plan.skippedLinks,['link.txt']);assert.deepEqual(plan.remove.map(item=>item.name),['obsolete.txt']);
  const result=await executePlan(plan,{confirmDelete:true,onLog:event=>logs.push(event)});
  assert.equal(result.deleted,1);assert.equal(result.warnings,1);
  assert.equal(await fs.readFile(path.join(j.destination,'link.txt'),'utf8'),'preserve');
  assert.equal(await fs.readFile(outside,'utf8'),'private');
  assert.equal(await fs.readFile(path.join(j.destination,'normal.txt'),'utf8'),'copy');
  assert.ok(logs.find(event=>event.status==='command').args.includes('/XF'));
});
test('copy skips junction loops and dangling junctions without recreating them',async t=>{const j=await fixture(t);j.mode='copy';await fs.symlink(j.source,path.join(j.source,'loop'),'junction');await fs.symlink(path.join(j.root,'missing'),path.join(j.source,'dangling'),'junction');await fs.writeFile(path.join(j.source,'normal'),'ok');const p=await planJob(j);assert.equal(p.skippedLinks.length,2);await executePlan(p);assert.deepEqual(await fs.readdir(j.destination),['normal']);});
test('a destination junction matching a skipped source link is preserved without following it',async t=>{const j=await fixture(t);const outside=path.join(j.root,'outside');await fs.mkdir(outside);await fs.writeFile(path.join(outside,'keep'),'untouched');await fs.symlink(outside,path.join(j.source,'link'),'junction');await fs.symlink(outside,path.join(j.destination,'link'),'junction');await executePlan(await planJob(j));assert.ok((await fs.lstat(path.join(j.destination,'link'))).isSymbolicLink());assert.equal(await fs.readFile(path.join(outside,'keep'),'utf8'),'untouched');});
test('unmatched destination junction remains a blocking scan failure',async t=>{const j=await fixture(t);await fs.symlink(j.source,path.join(j.destination,'link'),'junction');await assert.rejects(planJob(j),/Links and junctions/);});
test('a source link changed after preview cancels mirror deletion',async t=>{const j=await fixture(t);await fs.symlink(j.destination,path.join(j.source,'link'),'junction');await fs.writeFile(path.join(j.destination,'extra'),'keep');const p=await planJob(j);await fs.unlink(path.join(j.source,'link'));await fs.mkdir(path.join(j.source,'link'));await assert.rejects(executePlan(p,{confirmDelete:true}),/Source changed/);assert.equal(await fs.readFile(path.join(j.destination,'extra'),'utf8'),'keep');});
test('skipped source link protects a same-name destination file',async t=>{const j=await fixture(t);await fs.symlink(j.root,path.join(j.source,'link'),'junction');await fs.writeFile(path.join(j.destination,'link'),'keep');const p=await planJob(j);assert.equal(p.remove.length,0);await executePlan(p);assert.equal(await fs.readFile(path.join(j.destination,'link'),'utf8'),'keep');});
