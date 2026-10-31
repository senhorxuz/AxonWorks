import { chromium } from '@playwright/test';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1638, height: 865 }, deviceScaleFactor: 1 });
await page.goto('http://127.0.0.1:4317/#projects', { waitUntil: 'networkidle' });
await page.screenshot({ path: 'output/playwright/manual-review/axon-works-logo-v3.png', fullPage: true });
const metrics = await page.evaluate(() => ({
  innerWidth: window.innerWidth,
  clientWidth: document.documentElement.clientWidth,
  scrollWidth: document.documentElement.scrollWidth,
  bodyScrollWidth: document.body.scrollWidth,
}));
console.log(JSON.stringify(metrics));
await browser.close();
