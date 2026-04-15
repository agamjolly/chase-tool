const { chromium } = require('playwright');
(async() => {
  const browser = await chromium.launch({headless:true});
  const page = await browser.newPage();
  const requests = [];
  page.on('request', req => {
    const url = req.url();
    if (/chase|travel|hotel|search|graphql|api|secure\.chase|book|renowned|lhrcollection/i.test(url)) {
      requests.push({method:req.method(), url});
    }
  });
  await page.goto('https://www.chase.com/travel/the-edit', {waitUntil:'domcontentloaded', timeout:120000});
  await page.waitForTimeout(12000);
  const title = await page.title();
  const hrefs = await page.$$eval('a', as => as.map(a => a.href).filter(Boolean));
  const iframes = page.frames().map(f => f.url());
  const bodyText = await page.locator('body').innerText();
  console.log(JSON.stringify({
    title,
    iframes,
    links:[...new Set(hrefs)].filter(h => /travel|hotel|book|secure\.chase/i.test(h)).slice(0,200),
    requests: requests.slice(0,400),
    bodySnippet: bodyText.slice(0,5000)
  }, null, 2));
  await browser.close();
  process.exit(0);
})();
