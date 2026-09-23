const {spawn,execFileSync}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const config=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command','codex mcp get open-design --json'],{encoding:'utf8',windowsHide:true}));
const child=spawn(config.transport.command,config.transport.args,{windowsHide:true,env:{...process.env,...config.transport.env},stdio:['pipe','pipe','pipe']});
let buffer='',id=0;const waits=new Map();
child.stdout.on('data',chunk=>{buffer+=chunk;let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);try{const msg=JSON.parse(line);const wait=waits.get(msg.id);if(wait){waits.delete(msg.id);msg.error?wait.reject(new Error(JSON.stringify(msg.error))):wait.resolve(msg.result);}}catch{}}});
child.stderr.on('data',chunk=>process.stderr.write(chunk));
const call=(method,params)=>new Promise((resolve,reject)=>{const request=++id;waits.set(request,{resolve,reject});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:request,method,params})+'\n');});
const timeout=setTimeout(()=>{console.error('OpenDesign MCP timeout after 55 seconds');child.kill();process.exitCode=1;},55000);
function structured(result){if(result.isError)throw new Error(JSON.stringify(result));if(result.structuredContent)return result.structuredContent;const text=result.content?.find(c=>c.type==='text')?.text;try{return JSON.parse(text);}catch{return {text};}}
(async()=>{try{const init=await call('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'codex-local-mcp-client',version:'1.0.0'}});console.log(JSON.stringify({server:init.serverInfo}));child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');const input=process.argv[2];
  if(input==='--create-confirmed-project'){
    const brief=structured(await call('tools/call',{name:'collect_brief',arguments:{artifactType:'product-prototype',projectTitle:'Open File Backup Manager',locale:'zh-TW',skip:true,externalPluginContext:{id:'open-design',version:'0.5.2',distributionMechanism:'git_marketplace',publisherClass:'open_design_first_party'}}}));
    if(brief.questionForm?.questions?.length)throw new Error('Interactive brief requires user answers.');
    const confirmed=structured(await call('tools/call',{name:'confirm_brief',arguments:{briefDraftId:brief.briefDraftId,nonce:brief.nonce,answers:{},locale:'zh-TW',pluginWorkflowId:brief.pluginWorkflowId}}));
    const listed=structured(await call('tools/call',{name:'list_projects',arguments:{pluginWorkflowId:brief.pluginWorkflowId}}));
    fs.mkdirSync(path.join(__dirname,'../.local'),{recursive:true});
    fs.writeFileSync(path.join(__dirname,'../.local/od-existing-projects.json'),JSON.stringify(listed,null,2));
    const projects=Array.isArray(listed)?listed:listed.projects||[];
    const existing=projects.find(p=>p.name==='Open File Backup Manager');
    const created=existing?{project:existing}:structured(await call('tools/call',{name:'create_project',arguments:{name:'Open File Backup Manager',pluginWorkflowId:brief.pluginWorkflowId}}));
    fs.writeFileSync(path.join(__dirname,'../.local/od-project.json'),JSON.stringify({workflow:brief.pluginWorkflowId,confirmed,created},null,2));
    console.log(JSON.stringify(created));
  }else{const result=input?await call('tools/call',JSON.parse(fs.readFileSync(input,'utf8'))):await call('tools/list',{});console.log(JSON.stringify(result));if(process.argv.includes('--hold')){fs.writeFileSync(path.join(__dirname,'../.local/od-get-result.jsonl'),JSON.stringify(result)+'\n');clearTimeout(timeout);console.log('OpenDesign MCP preview connection is kept alive.');await new Promise(resolve=>process.once('SIGINT',resolve));}}
}catch(e){console.error(e.message);process.exitCode=1;}finally{clearTimeout(timeout);child.kill();}})();
