/** Optional browser checks with real HTTP caching, Web Audio and canvas rendering. */
import assert from 'node:assert/strict';
import { readFile, readdir, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

const { chromium } = process.env.PLAYWRIGHT_MODULE ? await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE)) : await import('playwright');
const root = new URL('../', import.meta.url);
const config = JSON.parse(await readFile(new URL('config.json', root), 'utf8'));
const files = (await readdir(root, { recursive: true })).filter(path => path.endsWith('.mjs') && !path.startsWith('tests/') && !path.startsWith('node_modules/')).map(path => `./${path}`).sort();
assert.deepEqual([...config.modules].sort(), files, 'Every production module must be included in the version manifest.');
let version = 'alpha', failManifest = false;
const requests = [];
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  requests.push(url);
  const relative = decodeURIComponent(url.pathname).replace(/^\/multiplayer\//, '') || 'index.html';
  if (relative.includes('..') || !url.pathname.startsWith('/multiplayer/')) { response.writeHead(404).end(); return; }
  try {
    const content = relative === 'config.json' ? JSON.stringify({ ...config, version }) : await readFile(new URL(relative, root));
    if (relative === 'config.json' && failManifest) { response.writeHead(503).end(); return; }
    const type = relative.endsWith('.mjs') ? 'text/javascript' : relative.endsWith('.css') ? 'text/css' : relative.endsWith('.svg') ? 'image/svg+xml' : relative.endsWith('.json') ? 'application/json' : 'text/html';
    response.writeHead(200, {
      'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'public, max-age=31536000, immutable',
      // Avoid sending analytics for fixtures. No Playwright routes: they disable HTTP caching.
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'",
    });
    response.end(content);
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/multiplayer/`;
const browser = await chromium.launch({ headless: true });
const output = process.env.SCREENSHOT_DIR ?? 'test-results';
await mkdir(output, { recursive: true });
let checks = 0;
const pass = label => { console.log(`PASS ${label}`); checks++; };

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  await page.locator('.featured-game').waitFor();
  const expected = [...config.modules.map(path => path.slice(2)), 'style.css'];
  const assertAssets = async current => {
    const assets = await page.evaluate(() => performance.getEntriesByType('resource').filter(entry => /\.(mjs|css)(\?|$)/.test(entry.name)).map(entry => entry.name));
    assert.deepEqual(assets.map(value => new URL(value).pathname.replace('/multiplayer/', '')).sort(), [...expected].sort());
    assert.ok(assets.every(value => new URL(value).searchParams.get('v') === current));
    assert.equal(await page.locator('#app-icon').getAttribute('href'), `./favicon.svg?v=${current}`);
  };
  await assertAssets('alpha');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.appVersion), 'alpha');
  pass('Every JS module, CSS and favicon uses the single configured version under a repository subpath');

  version = 'bravo';
  await page.goto('about:blank');
  await page.goto(base);
  await page.locator('.featured-game').waitFor();
  await assertAssets('bravo');
  const fresh = requests.filter(url => /\.(mjs|css)$/.test(url.pathname) && url.searchParams.get('v') === 'bravo');
  assert.equal(fresh.length, expected.length);
  assert.equal(requests.filter(url => url.pathname.endsWith('config.json')).length, 2);
  pass('A new deployment fetches every new module and stylesheet despite a year-long browser cache');

  await page.goto('about:blank');
  await page.goto(base);
  await page.locator('.featured-game').waitFor();
  assert.equal(requests.filter(url => /\.(mjs|css)$/.test(url.pathname) && url.searchParams.get('v') === 'bravo').length, expected.length);
  assert.equal(requests.filter(url => url.pathname.endsWith('config.json')).length, 3);
  pass('Unchanged assets reuse HTTP cache while the version configuration is always fetched afresh');

  await page.goto('about:blank');
  version = 'cedar';
  await page.goBack();
  await page.waitForFunction(() => document.documentElement.dataset.appVersion === 'cedar');
  await page.locator('.featured-game').waitFor();
  await assertAssets('cedar');
  pass('Returning with browser Back also discovers a newer deployment instead of restoring old modules');

  await page.evaluate(async () => {
    const { GameSound } = await import('./shared/sound.mjs');
    window.__testSound = new GameSound();
    window.__testSound.setEnabled(true);
  });
  // Unlock inside a trusted gesture, as the real app does for mouse and touch input.
  await page.evaluate(() => document.addEventListener('pointerdown', () => window.__testSound.unlock(), { once: true }));
  await page.getByRole('button', { name: 'PLAY PLAN' }).click();
  await page.waitForFunction(() => window.__testSound.context?.state === 'running');
  const audio = await page.evaluate(() => {
    const sound = window.__testSound;
    const create = sound.context.createBufferSource.bind(sound.context);
    const played = [];
    sound.context.createBufferSource = () => {
      const source = create(), connect = source.connect.bind(source), start = source.start.bind(source);
      let volume;
      source.connect = gain => { volume = gain.gain.value; return connect(gain); };
      source.start = () => { played.push({ duration: source.buffer.duration, volume }); start(); };
      return source;
    };
    sound.play('card', false); sound.play('card', true); sound.play('victory');
    sound.setEnabled(false);
    sound.play('card', true); sound.play('victory');
    return { played, sources: sound.sources.size, saved: localStorage.getItem('multiplayer:sound') };
  });
  assert.equal(audio.played.length, 3);
  assert.ok(Math.abs(audio.played[0].duration - .19) < .001);
  assert.ok(Math.abs(audio.played[1].duration - .19) < .001);
  assert.ok(Math.abs(audio.played[2].duration - 2.35) < .001);
  assert.ok(audio.played[1].volume > audio.played[0].volume);
  assert.equal(audio.sources, 0);
  assert.equal(audio.saved, 'off');
  await page.reload();
  await page.getByRole('button', { name: 'Enable sounds' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Enable sounds' }).getAttribute('aria-pressed'), 'false');
  await page.getByRole('button', { name: 'Enable sounds' }).click();
  assert.equal(await page.getByRole('button', { name: 'Mute sounds' }).getAttribute('aria-pressed'), 'true');
  pass('Real Web Audio unlocks, plays softer opponent cards and louder own cards, and persists a working mute control');

  await page.evaluate(async () => {
    const { VictoryCelebration } = await import('./shared/celebration.mjs');
    const { el } = await import('./shared/dom.mjs');
    document.querySelector('#main').replaceChildren(el('section', { class: 'results-panel panel' },
      el('h1', {}, 'Game over'), el('div', { class: 'winner-banner', 'data-winner-banner': '' }, el('h2', {}, 'Greg & Anna'), el('p', {}, 'A shared victory.'))));
    window.__testCelebration = new VictoryCelebration();
    window.__testCelebration.play(['Greg', 'Anna'], true);
  });
  await page.waitForTimeout(850);
  assert.equal(await page.evaluate(() => window.__testCelebration.layer.hidden), false);
  assert.equal(await page.evaluate(() => window.__testCelebration.layer.style.pointerEvents || getComputedStyle(window.__testCelebration.layer).pointerEvents), 'none');
  assert.ok(await page.evaluate(() => {
    const pixels = window.__testCelebration.canvas.getContext('2d').getImageData(0, 0, innerWidth, innerHeight).data;
    return pixels.some((value, i) => i % 4 === 3 && value > 0);
  }));
  await page.screenshot({ path: `${output}/victory-celebration.png` });
  await page.waitForFunction(() => window.__testCelebration.layer.hidden);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.evaluate(() => window.__testCelebration.play(['Greg', 'Anna'], true));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => window.__testCelebration.layer.hidden);
  assert.equal(await page.evaluate(() => window.__testCelebration.layer.hidden), true);
  await page.evaluate(() => window.__testCelebration.play(['Greg', 'Anna'], true));
  assert.equal(await page.evaluate(() => window.__testCelebration.layer.hidden), true);
  pass('Sokoban-style canvas victory supports shared winners, finishes cleanly, fits a phone and respects reduced motion');

  failManifest = true;
  await page.goto(base);
  await page.getByText('APP UNAVAILABLE', { exact: true }).waitFor();
  const reloadSize = await page.getByRole('button', { name: 'RELOAD', exact: true }).boundingBox();
  assert.ok(reloadSize.width >= 44 && reloadSize.height >= 44);
  failManifest = false;
  await page.getByRole('button', { name: 'RELOAD', exact: true }).click();
  await page.locator('.featured-game').waitFor();
  assert.deepEqual(errors, []);
  pass('A failed version fetch has a readable fallback and a reload button that recovers');
  console.log(`Browser assets/effects test: ${checks} checks passed.`);
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
