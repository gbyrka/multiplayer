/** Real HTTP cache regression checks for recovering a failed release startup. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

const { chromium } = process.env.PLAYWRIGHT_MODULE ? await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE)) : await import('playwright');
const root = new URL('../', import.meta.url);
const config = JSON.parse(await readFile(new URL('config.json', root), 'utf8'));
let failure = 'normal', target = 'shared/dom.mjs';
const requests = [];
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  requests.push(url);
  const relative = url.pathname.replace(/^\/multiplayer\//, '').replace(/\/$/, '/index.html') || 'index.html';
  if (!url.pathname.startsWith('/multiplayer/') || relative.includes('..')) { response.writeHead(404).end(); return; }
  try {
    let content = relative === 'config.json' ? JSON.stringify(config) : await readFile(new URL(relative, root));
    if (relative === target && (failure === 'all' || failure === 'normal' && !url.searchParams.has('refresh'))) {
      // A cached dependency from an incompatible release: its importer needs this export.
      content = target === 'shared/dom.mjs' ? content.toString().replace('export function patchChildren', 'function patchChildren') : 'export const broken = ;';
    }
    const ext = relative.split('.').at(-1);
    const type = { mjs: 'text/javascript', css: 'text/css', json: 'application/json', svg: 'image/svg+xml', jpg: 'image/jpeg', png: 'image/png' }[ext] || 'text/html';
    response.writeHead(200, {
      'Content-Type': type, 'Cache-Control': 'public, max-age=31536000, immutable',
      // Do not use Playwright routes: they disable the HTTP cache being tested.
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'",
    });
    response.end(content);
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/multiplayer/`;
const browser = await chromium.launch({ headless: true });
let checks = 0;
const pass = label => { console.log(`PASS ${label}`); checks++; };
const assertFreshGraph = async page => {
  const token = new URL(page.url()).searchParams.get('_refresh');
  assert.ok(token);
  const mapped = await page.evaluate(() => Object.values(JSON.parse(document.querySelector('script[type="importmap"]').textContent).imports));
  assert.equal(mapped.length, config.modules.length);
  assert.ok(mapped.every(value => new URL(value).searchParams.get('v') === config.version && new URL(value).searchParams.get('refresh') === token));
  const styles = await page.locator('link[rel="stylesheet"]').evaluateAll(elements => elements.map(element => element.href).filter(value => new URL(value).pathname.endsWith('/style.css')));
  assert.equal(styles.length, 1);
  assert.equal(new URL(styles[0]).searchParams.get('refresh'), token);
  return token;
};

try {
  let context = await browser.newContext();
  let page = await context.newPage();
  await page.goto(base);
  await page.locator('.featured-game').first().waitFor();
  await assertFreshGraph(page);
  assert.equal(requests.filter(url => url.pathname === '/multiplayer/').length, 2);
  await page.reload();
  await page.locator('.featured-game').first().waitFor();
  pass('Incompatible cached dependency recovers automatically with fresh URLs for every module and stylesheet');
  await context.close();

  context = await browser.newContext();
  page = await context.newPage();
  await page.goto(`${base}?room=K7PX4M9Q&game=plan&debug=1#invite`);
  await page.locator('#room-code-input').waitFor();
  await assertFreshGraph(page);
  const invite = new URL(page.url());
  assert.equal(invite.searchParams.get('room'), 'K7PX4M9Q');
  assert.equal(invite.searchParams.get('game'), 'plan');
  assert.equal(invite.searchParams.get('debug'), '1');
  assert.equal(invite.hash, '#invite');
  assert.equal(await page.locator('#room-code-input').inputValue(), 'K7PX4M9Q');
  pass('Recovery preserves the room invitation, game, other parameters and fragment');
  await context.close();

  failure = 'all';
  requests.length = 0;
  context = await browser.newContext();
  page = await context.newPage();
  await page.goto(base);
  await page.getByRole('heading', { name: 'APP UNAVAILABLE' }).waitFor();
  const failedToken = new URL(page.url()).searchParams.get('_refresh');
  assert.ok(failedToken);
  assert.equal(requests.filter(url => url.pathname === '/multiplayer/').length, 2);
  failure = 'none';
  await page.getByRole('button', { name: 'RELOAD', exact: true }).click();
  await page.locator('.featured-game').first().waitFor();
  const healthyToken = await assertFreshGraph(page);
  assert.notEqual(healthyToken, failedToken);
  assert.equal(requests.filter(url => url.pathname === '/multiplayer/').length, 3);
  pass('Persistent failure stops after one retry; RELOAD escapes even a cached failed retry');
  await context.close();

  for (const game of ['tow', 'hamster', 'catana']) {
    failure = 'normal'; target = `games/${game}/app.mjs`;
    context = await browser.newContext();
    page = await context.newPage();
    await page.goto(`${base}games/${game}/?room=K7PX4M9Q#invite`);
    await page.locator('#boot').waitFor({ state: 'hidden' });
    await assertFreshGraph(page);
    assert.equal(await page.locator('#room-code-input').inputValue(), 'K7PX4M9Q');
    assert.equal(new URL(page.url()).hash, '#invite');
    pass(`${game.toUpperCase()} standalone entry recovers from a cached broken application module`);
    await context.close();
  }
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
console.log(`Release recovery checks passed: ${checks} scenarios.`);
