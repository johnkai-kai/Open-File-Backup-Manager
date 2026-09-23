const {chromium}=require('@playwright/test');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
async function main(){
  const raw=JSON.parse((await fs.readFile('.local/od-get-result.jsonl','utf8')).trim().split('\n').at(-1));
  const project=JSON.parse(raw.content[0].text);
  const browser=await chromium.launch({channel:'msedge',headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:960}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const checks=[];
  try{
    await page.goto(project.previewUrl);await page.getByRole('heading',{name:'Work',exact:true}).waitFor();
    assert.equal(await page.locator('.job').count(),3);checks.push('OpenDesign raw preview loads all frontend modules');
    await page.locator('[data-job=projects]').click();
    await page.screenshot({path:'output/design-dark.png'});
    await page.getByRole('button',{name:'Settings',exact:true}).click();await page.locator('[data-setting=theme]').selectOption('light');await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');
    await page.getByRole('button',{name:'Work',exact:true}).click();await page.screenshot({path:'output/design-light.png'});checks.push('light and dark previews');
    await page.getByRole('button',{name:'Settings',exact:true}).click();await page.locator('[data-setting=language]').selectOption('zh-TW');await page.getByRole('heading',{name:'設定',exact:true}).waitFor();checks.push('localized preview');
    await page.locator('[data-setting=language]').selectOption('en');await page.locator('[data-setting=theme]').selectOption('dark');await page.getByRole('button',{name:'Work',exact:true}).click();
    await page.getByRole('button',{name:'Run profile',exact:true}).click();await page.getByRole('heading',{name:'Review backup'}).waitFor();await page.getByRole('button',{name:'Start backup'}).click();await page.locator('#toast').filter({hasText:'no files are copied'}).waitFor();checks.push('preview explicitly performs no filesystem operations');
    await page.setViewportSize({width:1024,height:768});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'output/design-compact.png'});checks.push('1024px desktop layout fits');
    assert.deepEqual(errors,[]);checks.push('no preview script exceptions');
    await fs.writeFile('output/preview-smoke.json',JSON.stringify({checks,errors,url:project.previewUrl},null,2));console.log(`PASS ${checks.length}/${checks.length}: `+checks.join('; '));
  }finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
