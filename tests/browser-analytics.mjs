/** Exercise visit measurement with Google requests intercepted. */
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { createPreviewServer } from '../../gbyrka.github.io/tools/preview.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const server = createPreviewServer();
await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const paths = [
  '/', '/dock/', '/park/', '/hamster/', '/sokoban/', '/games/pop/', '/games/simcity2000/',
  '/games/freedoom/', '/multiplayer/', '/multiplayer/?game=plan', '/multiplayer/games/tow/',
  '/multiplayer/games/tow-drivers-seat/', '/multiplayer/games/hamster/', '/multiplayer/games/catana/',
  '/multiplayer/games/chess/', '/multiplayer/games/checkers/', '/multiplayer/games/boggle/',
  '/multiplayer/games/scrabble/',
];
const tag = 'https://www.googletagmanager.com/gtag/js?id=G-WTPHWDLQ7K';
const tagSelector = 'script[src*="googletagmanager.com/gtag/js"]';

try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    return route.fulfill({ contentType: 'text/javascript', body: '' });
  });
  const page = await context.newPage();
  const setCMP = (target, status) => target.evaluate(status => {
    window.googlefc.getGoogleConsentModeValues = () => ({ analyticsStoragePurposeConsentStatus: status });
    window.googlefc.callbackQueue.find(callback => callback.CONSENT_MODE_DATA_READY).CONSENT_MODE_DATA_READY();
  }, status);
  const config = target => target.evaluate(() => Array.from(window.dataLayer.find(args => args[0] === 'config')));

  await page.goto(origin + '/multiplayer/');
  assert.equal(await page.locator(tagSelector).count(), 0);
  await page.getByRole('button', { name: 'Decline', exact: true }).click();
  assert.equal(await page.locator(tagSelector).count(), 0, 'Declining the local panel keeps GA4 unloaded');
  await page.getByRole('button', { name: 'Analytics settings' }).click();
  const request = page.waitForRequest(tag);
  await page.getByRole('button', { name: 'Allow analytics' }).click();
  await request;
  await page.getByRole('button', { name: 'PLAY PLAN' }).click();
  const planViews = await page.evaluate(() => window.dataLayer.filter(args => args[0] === 'event' && args[1] === 'page_view').map(args => args[2]));
  assert.deepEqual(planViews, [{ page_location: origin + '/multiplayer/?game=plan', page_title: 'PLAN — Multiplayer' }]);

  for (const path of paths) {
    const url = new URL(path, origin);
    url.searchParams.set('room', 'SYNTH123');
    url.searchParams.set('_refresh', 'test');
    url.hash = 'invite';
    await page.goto(url.href, { referer: origin + '/multiplayer/?room=PREVIOUS#invite' });
    if (await page.locator('#adsense-script').count()) {
      assert.equal(await page.locator(tagSelector).count(), 0, path);
      await setCMP(page, 4);
    }
    await page.locator(tagSelector).waitFor({ state: 'attached' });
    assert.equal(await page.locator(tagSelector).count(), 1, path);
    const [, id, params] = await config(page);
    assert.equal(id, 'G-WTPHWDLQ7K', path);
    assert.equal(params.page_location, origin + path, path);
    assert.equal(params.page_referrer, origin + '/multiplayer/', path);
  }

  await page.goto(origin + '/multiplayer/games/tow/');
  await setCMP(page, 2);
  assert.equal(await page.locator(tagSelector).count(), 0, 'CMP denial takes precedence over the stored local grant');
  await setCMP(page, 1);
  await setCMP(page, 1);
  assert.equal(await page.locator(tagSelector).count(), 1, 'Repeated CMP grants initialize GA4 once');
  await setCMP(page, 2);
  assert.equal(await page.evaluate(() => window['ga-disable-G-WTPHWDLQ7K']), true);
  await page.evaluate(() => window.gtag('event', 'after_withdrawal'));
  assert.ok(await page.evaluate(() => !window.dataLayer.some(args => args[1] === 'after_withdrawal')));

  await page.goto(origin + '/multiplayer/games/scrabble/');
  const other = await context.newPage();
  await other.goto(origin + '/games/simcity2000/');
  await page.getByRole('button', { name: 'Analytics settings' }).click();
  await page.getByRole('button', { name: 'Decline', exact: true }).click();
  await other.waitForFunction(() => window['ga-disable-G-WTPHWDLQ7K']);
  await other.reload();
  assert.equal(await other.locator(tagSelector).count(), 0, 'Withdrawal persists across games and reloads');

  await page.goto(origin + '/multiplayer/games/word-trail/');
  assert.equal(new URL(page.url()).pathname, '/multiplayer/games/boggle/');
  assert.equal(await page.locator(tagSelector).count(), 0);
  console.log(`Analytics checked on ${paths.length} entries, including PLAN navigation, CMP precedence, withdrawal and the Word Trail redirect.`);
} finally {
  await browser.close();
  server.close();
}
