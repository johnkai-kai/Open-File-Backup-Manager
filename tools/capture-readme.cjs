const {chromium}=require('@playwright/test');
const fs=require('node:fs/promises');
const path=require('node:path');

async function main(){
  const root=path.resolve(__dirname,'..');
  const raw=JSON.parse((await fs.readFile(path.join(root,'.local/od-get-result.jsonl'),'utf8')).trim().split('\n').at(-1));
  const project=JSON.parse(raw.content[0].text);
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:960},deviceScaleFactor:1});
    await page.goto(project.previewUrl);
    await page.getByRole('heading',{name:'Work',exact:true}).waitFor();
    await page.locator('[data-job=projects]').click();
    await page.screenshot({path:path.join(root,'docs/assets/interface-dark.png')});
    console.log('PASS: poster interface preview captured.');
  }finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
