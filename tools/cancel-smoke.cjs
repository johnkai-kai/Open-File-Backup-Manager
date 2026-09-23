const {_electron:electron}=require('@playwright/test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');

async function main(){
  const root=path.resolve(__dirname,'..'),output=path.join(root,'output');
  await fs.mkdir(output,{recursive:true});
  const fixture=await fs.mkdtemp(path.join(output,'cancel-smoke-'));
  const source=path.join(fixture,'source'),destination=path.join(fixture,'destination');
  await fs.mkdir(source);await fs.mkdir(destination);
  await fs.writeFile(path.join(source,'file.txt'),'copied before cancel');
  await fs.writeFile(path.join(destination,'extra.txt'),'must stay');
  const env={...process.env,OFBM_TEST_DATA:path.join(fixture,'appdata')};delete env.ELECTRON_RUN_AS_NODE;
  const executable=process.env.OFBM_INSTALLED_DIR
    ?path.join(process.env.OFBM_INSTALLED_DIR,'Open File Backup Manager.exe')
    :process.env.OFBM_PACKAGED?path.join(root,'release/win-unpacked/Open File Backup Manager.exe'):null;
  const app=await electron.launch(executable?{executablePath:executable,args:[],env}:{args:[root],env});
  const page=await app.firstWindow();
  try{
    await page.getByRole('button',{name:'Settings',exact:true}).waitFor();
    const data=(await page.evaluate(()=>window.backup.load())).data;
    data.profiles=[{id:'fixture',name:'Fixture',mode:'mirror',jobs:[{id:'job',name:'Job',mode:'inherit',source,destination}]}];
    await page.evaluate(value=>window.backup.save(value),data);
    const review=await page.evaluate(()=>window.backup.prepare({profileId:'fixture'}));
    assert.equal(review.jobs[0].remove.length,1);
    await app.evaluate(({app})=>{
      const mod=process.mainModule.require(app.getAppPath()+'/desktop/robocopy.cjs');
      const {spawn}=process.mainModule.require('node:child_process');
      const {EventEmitter}=process.mainModule.require('node:events');
      global.__originalExecute=mod.execute;global.__robocopyClosed=false;global.__killRequested=false;
      mod.execute=(plan,options)=>global.__originalExecute(plan,{...options,spawnCopy:(file,args,config)=>{
        const child=spawn(file,args,config),proxy=new EventEmitter();
        proxy.kill=()=>{global.__killRequested=true;return child.kill();};
        child.once('error',error=>proxy.emit('error',error));
        child.once('close',code=>{global.__robocopyClosed=true;setTimeout(()=>proxy.emit('close',code),2000);});
        return proxy;
      }});
    });
    await page.evaluate(token=>{window.__pendingRun=window.backup.run(token,{confirmDelete:true});},review.token);
    await page.waitForFunction(()=>document.querySelector('#progress .progress-cancel')&&!document.querySelector('#progress .progress-cancel').hidden);
    const deadline=Date.now()+10000;
    while(!await app.evaluate(()=>global.__robocopyClosed)){if(Date.now()>deadline)throw new Error('Robocopy fixture did not finish.');await new Promise(resolve=>setTimeout(resolve,25));}
    await page.locator('#progress .progress-cancel').click();
    const result=await page.evaluate(()=>window.__pendingRun);
    assert.equal(result.phase,'canceled');
    assert.equal(await app.evaluate(()=>global.__killRequested),true);
    assert.equal(await fs.readFile(path.join(destination,'extra.txt'),'utf8'),'must stay');
    const history=await page.evaluate(()=>window.backup.history()),detail=history[0].jobs[0];
    assert.equal(history[0].status,'canceled');assert.equal(detail.status,'canceled');
    assert.ok(detail.command.includes('robocopy.exe'));
    assert.deepEqual(detail.deletedPaths,[]);
    assert.ok(history[0].timings.previewMs>0&&history[0].timings.robocopyMs>0);
    assert.ok(detail.timings.preflightMs>=0&&detail.timings.copyMs>0);
    assert.equal(history[0].timings.deleteMs,0);
    console.log(`PASS: ${executable?'packaged':'source'} Cancel button marks the operation canceled, retains its real Robocopy command, and prevents confirmed mirror deletion after copy. Close event was delayed by fixture injection.`);
  }finally{
    await app.evaluate(({app})=>{const mod=process.mainModule.require(app.getAppPath()+'/desktop/robocopy.cjs');if(global.__originalExecute)mod.execute=global.__originalExecute;delete global.__originalExecute;}).catch(()=>{});
    await page.evaluate(()=>window.backup.cancel()).catch(()=>{});
    await app.close();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
