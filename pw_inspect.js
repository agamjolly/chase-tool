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
  await page.goto('https://www.chase.com/travel/the-edit', {waitUntil:'networkidle', timeout:120000});
  await page.waitForTimeout(3000);
  const title = await page.title();
  const hrefs = await page.$$eval('a', as => as.map(a => a.href).filter(Boolean));
  const iframes = page.frames().map(f => f.url());
  const bodyText = await page.locator('body').innerText();
  console.log('TITLE', title);
  console.log('IFRAMES', JSON.stringify(iframes, null, 2));
  console.log('LINKS', JSON.stringify([...new Set(hrefs)].filter(h => /travel|hotel|book|secure\.chase/i.test(h)).slice(0,200), null, 2));
  console.log('REQUESTS', JSON.stringify(requests.slice(0,300), null, 2));
  console.log('BODY_SNIPPET', bodyText.slice(0,4000));
  await browser.close();
})();
