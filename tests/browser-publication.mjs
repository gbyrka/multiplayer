/** Local publication checks; Google scripts are stubbed so no real ads or analytics run. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const root = new URL('../../', import.meta.url);
const output = process.env.SCREENSHOT_DIR ?? 'test-results/publication';
await mkdir(output, { recursive: true });
const server = createServer(async (request, response) => {
  const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  if (!/^\/(games|multiplayer)\//.test(path) || path.includes('..')) return response.writeHead(404).end();
  const relative = path.slice(1) + (path.endsWith('/') ? 'index.html' : '');
  try {
    const body = await readFile(new URL(relative, root));
    const extension = relative.split('.').at(-1);
    const type = { html: 'text/html', mjs: 'text/javascript', js: 'text/javascript', css: 'text/css', json: 'application/json', svg: 'image/svg+xml', jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[extension];
    response.writeHead(200, { 'Content-Type': type ?? 'application/octet-stream' }).end(body);
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const errors = [], analyticsRequests = [];
let checks = 0;
const pass = label => { checks++; console.log(`PASS ${label}`); };

async function context(blockAds = false) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  await context.route('**/pagead2.googlesyndication.com/**', route => blockAds ? route.abort() : route.fulfill({ contentType: 'text/javascript', body: '' }));
  await context.route('**/www.googletagmanager.com/**', route => {
    analyticsRequests.push(route.request().url());
    return route.fulfill({ contentType: 'text/javascript', body: '' });
  });
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  return context;
}

try {
  const normal = await context(), page = await normal.newPage();
  await page.goto(`${base}/games/`);
  await page.waitForFunction(() => document.documentElement.dataset.appVersion);
  const section = page.locator('#multiplayer');
  assert.equal(await section.locator('a').count(), 3);
  await section.getByRole('link', { name: /Play PLAN/ }).click();
  await page.locator('#entry-form').waitFor();
  assert.equal(new URL(page.url()).searchParams.get('game'), 'plan');
  await page.goto(`${base}/games/`);
  await section.getByRole('link', { name: /Play TOW/ }).click();
  await page.locator('#home').waitFor();
  assert.equal(new URL(page.url()).pathname, '/multiplayer/games/tow/');
  await page.getByRole('link', { name: '← All multiplayer' }).click();
  await page.locator('.featured-game').first().waitFor();
  assert.equal(await page.locator('.featured-game').count(), 2);
  await page.goto(`${base}/games/`);
  await section.getByRole('link', { name: /All multiplayer/ }).click();
  await page.locator('.featured-game').first().waitFor();
  assert.equal(new URL(page.url()).pathname, '/multiplayer/');
  pass('All three catalog links work; PLAN opens its entry, TOW its track, and All multiplayer its collection');

  for (const path of ['/games/', '/multiplayer/', '/multiplayer/games/tow/']) {
    await page.goto(base + path);
    await page.waitForFunction(() => document.documentElement.dataset.appVersion);
    if (path.endsWith('tow/')) await page.locator('#home').waitFor();
    else if (path === '/multiplayer/') await page.locator('.featured-game').first().waitFor();
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 950 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${path} overflows at ${width}px`);
      const notice = page.locator('.keyboard-notice').first();
      assert.ok(await notice.isVisible());
      const box = await notice.boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= width + 1);
      await page.screenshot({ path: `${output}/${path.includes('tow') ? 'tow' : path.includes('multiplayer') ? 'multiplayer' : 'games'}-${width}.png`, fullPage: true });
    }
    await page.locator('img').evaluateAll(images => Promise.all(images.map(image => image.decode())));
  }
  pass('Both catalogs and TOW fit 320–1280px, load local artwork and keep keyboard notices visible');

  await page.goto(`${base}/multiplayer/games/tow/`);
  await page.locator('#home').waitFor();
  assert.equal(await page.locator('meta[name="robots"]').count(), 0);
  assert.equal(await page.locator('link[rel="canonical"]').getAttribute('href'), 'https://mod-it.games/multiplayer/games/tow/');
  const preview = await page.locator('meta[property="og:image"]').getAttribute('content');
  assert.ok((await page.request.get(base + new URL(preview).pathname)).ok());
  assert.match(await page.locator('meta[property="og:description"]').getAttribute('content'), /2–4 drivers.*Keyboard/);
  assert.equal(await page.locator('.privacy-footer a[href="../../../games/privacy.html"]').count(), 1);
  pass('TOW is indexable, has its own social preview and links to the shared privacy policy');

  assert.equal(analyticsRequests.length, 0);
  await page.evaluate(() => {
    window.gtag('event', 'before_consent');
    window.googlefc.getGoogleConsentModeValues = () => ({ analyticsStoragePurposeConsentStatus: 0 });
    window.googlefc.callbackQueue.find(callback => callback.CONSENT_MODE_DATA_READY).CONSENT_MODE_DATA_READY();
  });
  assert.equal(analyticsRequests.length, 0);
  assert.ok(await page.evaluate(() => !window.dataLayer.some(args => args[0] === 'event')));
  await page.evaluate(() => {
    window.googlefc.getGoogleConsentModeValues = () => ({ analyticsStoragePurposeConsentStatus: 1 });
    window.googlefc.callbackQueue.find(callback => callback.CONSENT_MODE_DATA_READY).CONSENT_MODE_DATA_READY();
    window.gtag('event', 'after_consent');
  });
  await page.waitForFunction(() => document.querySelector('script[src*="googletagmanager"]'));
  assert.equal(analyticsRequests.length, 1);
  assert.match(analyticsRequests[0], /G-WTPHWDLQ7K/);
  assert.ok(await page.evaluate(() => window.dataLayer.some(args => args[0] === 'event' && args[1] === 'after_consent')));
  await page.evaluate(() => {
    window.googlefc.getGoogleConsentModeValues = () => ({ analyticsStoragePurposeConsentStatus: 2 });
    window.googlefc.callbackQueue.find(callback => callback.CONSENT_MODE_DATA_READY).CONSENT_MODE_DATA_READY();
    window.gtag('event', 'after_denial');
  });
  assert.ok(await page.evaluate(() => !window.dataLayer.some(args => args[1] === 'after_denial')));
  pass('Analytics is absent before permission, loads once after grant, and discards events after denial');

  await page.evaluate(() => { window.__adNode = document.querySelector('#tow-ad'); });
  const gap = await page.evaluate(() => document.querySelector('#tow-ad').getBoundingClientRect().top - document.querySelector('main').getBoundingClientRect().bottom);
  assert.ok(gap >= 150, `Ad separation: ${gap}px`);
  await page.locator('#tow-ad').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => document.querySelector('#tow-ad ins').dataset.adRequested === 'true');
  await page.evaluate(() => {
    window.MoDITAds.setVisible(window.__adNode, false);
    window.MoDITAds.setVisible(window.__adNode, true);
  });
  assert.equal(await page.evaluate(() => window.adsbygoogle.length), 1);
  await page.locator('#tow-ad ins').evaluate(slot => { slot.dataset.adStatus = 'unfilled'; });
  await page.waitForFunction(() => document.querySelector('#tow-ad').hidden);
  await page.evaluate(() => window.MoDITAds.setVisible(window.__adNode, true));
  assert.ok(await page.locator('#tow-ad').isHidden());
  pass('TOW has one stable footer ad with 150px separation; it is requested once and unfilled ads stay hidden');

  const blocked = await context(true), blockedPage = await blocked.newPage();
  await blockedPage.goto(`${base}/multiplayer/games/tow/`);
  await blockedPage.locator('#home').waitFor();
  assert.ok(await blockedPage.locator('#tow-ad').isHidden());
  await blockedPage.locator('#mode-switch').click();
  assert.equal(await blockedPage.locator('#connect').textContent(), 'JOIN GAME');
  pass('Blocked ad scripts hide the placement and leave the game entry usable');

  const failed = await context(), failedPage = await failed.newPage();
  await failed.route('**/config.json?*', route => route.fulfill({ status: 503, body: '' }));
  await failedPage.goto(`${base}/multiplayer/games/tow/`);
  await failedPage.getByRole('button', { name: 'RELOAD' }).waitFor();
  assert.ok(await failedPage.locator('#tow-ad').isHidden());
  assert.deepEqual(errors, []);
  pass('A failed game loader keeps ads hidden and offers reload; no browser exceptions occurred');
  console.log(`Publication: ${checks} checks passed.`);
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
