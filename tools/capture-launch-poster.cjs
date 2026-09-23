const {chromium}=require('@playwright/test');
const path=require('node:path');

async function main(){
  const root=path.resolve(__dirname,'..');
  const browser=await chromium.launch({channel:'msedge',headless:true});
  const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1});
  try{
    await page.goto('file:///'+path.join(root,'docs/launch-poster.html').replaceAll('\\','/'));
    await page.evaluate(()=>document.fonts.ready);
    await page.screenshot({path:path.join(root,'docs/assets/launch-poster-16x9.png')});
    console.log('PASS: 1920x1080 dark launch artwork captured.');
  }finally{await browser.close();}
}

main().catch(error=>{console.error(error);process.exitCode=1;});
