const { chromium } = require('playwright');
(async() => {
  const browser = await chromium.launch({headless:true});
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const requests = [];
  page.on('request', req => {
    const url = req.url();
    if (/chase|travel|hotel|search|graphql|api|secure\.chase|book|trips\.chase|destination|map/i.test(url)) {
      requests.push({method:req.method(), url});
    }
  });
  await page.goto('https://www.chase.com/travel', {waitUntil:'domcontentloaded', timeout:120000});
  await page.waitForTimeout(8000);
  const summary = await page.evaluate(() => {
    const text = document.body.innerText.slice(0,6000);
    const buttons = Array.from(document.querySelectorAll('button,[role="tab"],a')).map(el => ({text:(el.textContent||'').trim(), role:el.getAttribute('role'), href:el.href || null})).filter(x => x.text);
    const inputs = Array.from(document.querySelectorAll('input,select')).map(el => ({tag:el.tagName, type:el.type || null, name:el.name || null, placeholder:el.placeholder || null, aria:el.getAttribute('aria-label') || null}));
    return {text, buttons:buttons.slice(0,200), inputs};
  });
  console.log(JSON.stringify({summary, requests: requests.slice(0,300)}, null, 2));
  await browser.close();
})();
