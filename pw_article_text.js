const { chromium } = require('playwright');
(async() => {
  const browser = await chromium.launch({headless:true});
  const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
  await page.goto(process.argv[2], {waitUntil:'domcontentloaded', timeout:120000});
  await page.waitForTimeout(3000);
  const text = await page.locator('body').innerText();
  console.log(text.slice(0,12000));
  await browser.close();
})();
