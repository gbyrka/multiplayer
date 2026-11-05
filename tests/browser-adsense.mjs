/** AdSense audit with fake, explicitly labelled ad content. Never requests/clicks a real ad. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const root = new URL('../../', import.meta.url), output = process.env.SCREENSHOT_DIR ?? 'test-results/adsense';
await mkdir(output, { recursive: true });
const types = { html:'text/html', mjs:'text/javascript', js:'text/javascript', css:'text/css', json:'application/json', svg:'image/svg+xml', jpg:'image/jpeg', png:'image/png', webp:'image/webp', gz:'application/gzip' };
const server = createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  if (pathname.includes('..')) return response.writeHead(404).end();
  const file = pathname === '/' ? 'gbyrka.github.io/index.html' : pathname.slice(1) + (pathname.endsWith('/') ? 'index.html' : '');
  try { response.writeHead(200, { 'Content-Type': types[file.split('.').at(-1)] ?? 'application/octet-stream' }).end(await readFile(new URL(file, root))); }
  catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ reducedMotion:'reduce', viewport:{width:1440,height:1000} });
const errors = [], missing = [], external = [];
let checks = 0;
const pass = text => console.log(`PASS ${++checks}: ${text}`);
await context.route('**/*', route => {
  const url = new URL(route.request().url());
  if (url.origin === origin) return route.continue();
  external.push(url.href);
  return route.fulfill({ contentType:'text/javascript', body:'' });
});
await context.addInitScript(() => {
  window.adsbygoogle = [];
  window.adsbygoogle.push = function (...args) {
    const result = Array.prototype.push.apply(this, args);
    queueMicrotask(() => {
      for (const slot of document.querySelectorAll('ins[data-ad-requested="true"]')) {
        if (slot.dataset.adStatus) continue;
        slot.dataset.adStatus = 'filled'; slot.style.height = innerWidth < 600 ? '250px' : '180px';
        slot.textContent = 'TEST ADVERTISEMENT — NO REAL AD REQUEST';
        slot.style.background = '#ddd'; slot.style.color = '#222';
      }
    });
    return result;
  };
});
const entries = [
  ['/', '#main', 0], ['/games/', '#main', 1], ['/dock/', '#overlay-title', 1], ['/park/', '#overlay-title', 1],
  ['/hamster/', '#overlay-title', 1], ['/sokoban/', '#board', 1], ['/multiplayer/', '.featured-game', 1],
  ['/multiplayer/?game=plan', '#entry-form', 1], ['/multiplayer/games/tow/', '#home', 1],
  ['/multiplayer/games/tow-drivers-seat/', '#home', 1], ['/multiplayer/games/hamster/', '#home', 1],
  ['/multiplayer/games/catana/', '#entry-form', 1], ['/multiplayer/games/chess/', '.home', 0],
  ['/multiplayer/games/checkers/', '.home', 0], ['/multiplayer/games/boggle/', '.home', 0],
  ['/games/privacy.html', '#main', 0],
];
try {
  for (const [path, ready, slots] of entries) {
    const page = await context.newPage(); page.on('pageerror', error => errors.push(`${path}: ${error.message}`));
    page.on('response', response => { if (response.url().startsWith(origin) && response.status() >= 400 && !response.url().endsWith('/favicon.ico')) missing.push(`${path}: ${response.status()} ${response.url()}`); });
    await page.goto(origin + path); await page.locator(ready).first().waitFor();
    assert.equal(await page.locator('ins.adsbygoogle').count(), slots, path);
    assert.equal(await page.locator('dialog ins.adsbygoogle, nav ins.adsbygoogle, .room-chat ins.adsbygoogle').count(), 0, path);
    if (slots) {
      if (path === '/games/') {
        await page.evaluate(() => { const dialog = document.createElement('dialog'); dialog.id = 'test-info'; dialog.textContent = 'Game information'; document.body.append(dialog); dialog.showModal(); });
        await page.locator('.ad-placement').evaluate(ad => ad.scrollIntoView());
        await page.waitForTimeout(100);
        assert.equal(await page.locator('ins.adsbygoogle').getAttribute('data-ad-requested'), null, 'Never initialize a footer ad under an open modal');
        await page.evaluate(() => document.querySelector('#test-info').close());
      }
      const ad = page.locator('.ad-placement'); await ad.scrollIntoViewIfNeeded();
      await page.waitForFunction(() => document.querySelector('ins.adsbygoogle')?.dataset.adStatus === 'filled');
    }
    for (const width of [320, 768, 1440]) {
      await page.setViewportSize({ width, height:1000 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${path}: horizontal overflow at ${width}`);
      if (slots) {
        const geometry = await page.evaluate(() => {
          const placement = document.querySelector('.ad-placement'), ad = placement.getBoundingClientRect();
          let above = Infinity, below = Infinity, overlap = false;
          for (const control of document.querySelectorAll('a,button,input,select,textarea,canvas')) {
            if (placement.contains(control) || !control.getClientRects().length) continue;
            const bounds = control.getBoundingClientRect();
            const rect = { left:bounds.left, right:bounds.right, top:bounds.top, bottom:bounds.bottom };
            // Menu cards/history lists can scroll inside the game. Their offscreen
            // descendants have DOM rects but cannot be seen or clicked beside an ad.
            for (let parent = control.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
              const style = getComputedStyle(parent), clip = parent.getBoundingClientRect();
              if (['auto','scroll','hidden','clip'].includes(style.overflowX)) { rect.left = Math.max(rect.left, clip.left); rect.right = Math.min(rect.right, clip.right); }
              if (['auto','scroll','hidden','clip'].includes(style.overflowY)) { rect.top = Math.max(rect.top, clip.top); rect.bottom = Math.min(rect.bottom, clip.bottom); }
            }
            if (rect.right <= rect.left || rect.bottom <= rect.top) continue;
            if (rect.bottom <= ad.top + 1) above = Math.min(above, ad.top - rect.bottom);
            else if (rect.top >= ad.bottom - 1) below = Math.min(below, rect.top - ad.bottom);
            else if (rect.right > ad.left && rect.left < ad.right) overlap = true;
          }
          return { above, below, overlap, position:getComputedStyle(placement).position, label:placement.querySelector('.ad-placement-label').textContent.trim() };
        });
        assert.equal(geometry.overlap, false, `${path} at ${width}: ad overlaps a control`);
        assert.ok(geometry.above === null || geometry.above >= 150, `${path} at ${width}: preceding control only ${geometry.above}px from ad`);
        assert.ok(geometry.below === null || geometry.below >= 150, `${path} at ${width}: following navigation only ${geometry.below}px from ad`);
        assert.ok(!['fixed','sticky'].includes(geometry.position)); assert.equal(geometry.label, 'Advertisements');
      }
    }
    if (slots) {
      const count = await page.evaluate(() => window.adsbygoogle.length);
      await page.evaluate(() => { const ad = document.querySelector('.ad-placement'); window.MoDITAds.setVisible(ad, false); window.MoDITAds.setVisible(ad, true); });
      assert.equal(await page.locator('.ad-placement').isVisible(), true, 'Never hide a served unit during SPA navigation');
      assert.equal(await page.evaluate(() => window.adsbygoogle.length), count);
    }
    if (['chess','checkers','boggle'].some(game => path.includes(`/games/${game}/`))) {
      await page.getByRole('button', { name:'About this game', exact:true }).click();
      assert.equal(await page.locator('#about-dialog ins').count(), 0); await page.getByRole('button', { name:'Close about', exact:true }).click();
      assert.equal(await page.evaluate(() => window.adsbygoogle.length), 0);
    }
    if (path === '/games/') {
      await page.evaluate(() => {
        window.__before = window.adsbygoogle.length;
        for (const kind of ['nav','dialog','private','fixed','label']) {
          const parent = document.createElement(kind === 'nav' ? 'nav' : kind === 'dialog' ? 'dialog' : 'div');
          if (kind === 'private') parent.className = 'room-chat';
          const ad = document.createElement('aside'); ad.className = 'ad-placement'; ad.id = `forbidden-${kind}`;
          const label = document.createElement('p'); label.className = 'ad-placement-label'; label.textContent = kind === 'label' ? 'More games' : 'Advertisements';
          const slot = document.createElement('ins'); slot.className = 'adsbygoogle';
          if (kind === 'fixed') ad.style.position = 'fixed';
          ad.append(label, slot); parent.append(ad); document.body.append(parent); window.MoDITAds.setVisible(ad, true);
        }
      });
      for (const kind of ['nav','dialog','private','fixed','label']) assert.equal(await page.locator(`#forbidden-${kind}`).isHidden(), true, kind);
      assert.equal(await page.evaluate(() => window.adsbygoogle.length), await page.evaluate(() => window.__before));
      await page.evaluate(() => document.querySelectorAll('[id^="forbidden-"]').forEach(node => node.parentElement.remove()));
      await page.locator('ins.adsbygoogle').evaluate(slot => { slot.dataset.adStatus = 'unfilled'; });
      await page.waitForFunction(() => document.querySelector('.ad-placement').hidden);
    }
    if (['/', '/games/', '/multiplayer/games/chess/'].includes(path)) {
      await page.setViewportSize({ width:1440, height:1000 });
      await page.screenshot({ path:`${output}/${path === '/' ? 'root' : path.includes('chess') ? 'chess-about-free' : 'catalog'}.png`, fullPage:true });
    }
    pass(`${path}: working entry/navigation, clear ad placement and 320–1440px layout`);
    await page.close();
  }
  const plain = await browser.newContext({ javaScriptEnabled:false, viewport:{width:390,height:844} });
  const page = await plain.newPage(); await page.goto(origin + '/');
  assert.equal(new URL(page.url()).pathname, '/'); assert.ok(await page.getByRole('link', { name:/Browse all games/ }).isVisible());
  await page.getByRole('link', { name:/Browse all games/ }).click(); assert.equal(new URL(page.url()).pathname, '/games/');
  assert.equal(await page.locator('.game-card').count(), 12);
  pass('Root and catalog work without JavaScript and without forced redirects');
  assert.deepEqual(missing, []); assert.deepEqual(errors, []);
  pass('No missing local resources or uncaught browser errors; all Google/ad requests were stubbed');
  await plain.close(); console.log(`${checks} AdSense/browser audit checks passed.`);
} finally {
  await browser.close(); await new Promise(resolve => server.close(resolve));
}
