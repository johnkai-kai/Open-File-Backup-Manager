const {chromium}=require('@playwright/test');
const fs=require('node:fs/promises');
const path=require('node:path');

async function main(){
  const root=path.resolve(__dirname,'..');
  const raw=JSON.parse((await fs.readFile(path.join(root,'.local/od-get-result.jsonl'),'utf8')).trim().split('\n').at(-1));
  const project=JSON.parse(raw.content[0].text);
  const output=path.join(root,'docs/assets');
  const browser=await chromium.launch({channel:'msedge',headless:true});
  const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1});
  try{
    await page.goto(project.previewUrl);
    await page.getByRole('heading',{name:'Work',exact:true}).waitFor();
    await page.screenshot({path:path.join(output,'landscape-profile.png')});
    await page.getByRole('button',{name:'Activity',exact:true}).click();
    await page.locator('.activity-entry summary').click();
    await page.screenshot({path:path.join(output,'landscape-activity.png')});
    await page.getByRole('button',{name:'Settings',exact:true}).click();
    await page.screenshot({path:path.join(output,'landscape-settings.png')});
    await page.getByRole('button',{name:'Work',exact:true}).click();
    await page.locator('[data-run-job=docs]').click();
    await page.getByRole('heading',{name:'Review backup'}).waitFor();
    await page.screenshot({path:path.join(output,'landscape-review.png')});
    await page.locator('#dialog [data-action=cancel]').click();
    await page.reload();
    await page.getByRole('heading',{name:'Work',exact:true}).waitFor();
    await page.getByRole('button',{name:'Settings',exact:true}).click();
    await page.locator('[data-setting=theme]').selectOption('light');
    await page.getByRole('button',{name:'Work',exact:true}).click();
    await page.screenshot({path:path.join(output,'landscape-light.png')});
    await page.getByRole('button',{name:'Settings',exact:true}).click();
    await page.locator('[data-setting=language]').selectOption('zh-TW');
    await page.screenshot({path:path.join(output,'landscape-settings-zh-TW.png')});
    await page.getByRole('button',{name:'Work',exact:true}).click();
    await page.screenshot({path:path.join(output,'landscape-zh-TW.png')});
    console.log('PASS: seven 1920x1080 OpenDesign preview screenshots captured.');
  }finally{await browser.close();}
}

main().catch(error=>{console.error(error);process.exitCode=1;});
