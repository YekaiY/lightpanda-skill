// RECIPE: lightpanda serve + puppeteer-core (verified: lightpanda 1.1.0-nightly.11012, puppeteer-core 25.16.0, Node 26)
// Prereq: lightpanda serve --host 127.0.0.1 --port 9222
// Usage: npm i puppeteer-core  &&  node cdp-puppeteer.mjs [port]
// NOTE: install with a writable cache if the default npm cache is read-only:
//   npm install --cache ./.npm-cache puppeteer-core
import puppeteer from 'puppeteer-core';

const PORT = process.argv[2] ?? process.env.LP_PORT ?? '9222';
const browser = await puppeteer.connect({
  browserWSEndpoint: `ws://127.0.0.1:${PORT}`, // NO /devtools/browser/<id> path needed
});

const context = browser.browserContexts()[0];   // .contexts() does not exist on this Puppeteer build
const page = await context.newPage();

await page.goto('https://quotes.toscrape.com/js/', { waitUntil: 'load', timeout: 20000 });
await page.waitForSelector('.quote .text', { timeout: 10000 });   // JS-rendered content

console.log('title :', await page.title());
console.log('quote :', (await page.$eval('.quote .text', (el) => el.textContent)).trim());
console.log('count :', (await page.$$eval('.quote', (els) => els.length)));

// page.click FAILS when the element is outside the viewport -> scroll first or use DOM click
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await page.click('.next a', { timeout: 5000 });
await page.waitForFunction(() => location.pathname === '/js/page/2/', { timeout: 10000 });
console.log('after click:', page.url());

await page.close();
await browser.disconnect();
process.exit(0);
