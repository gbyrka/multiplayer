/** Offline HTTPS migration checks against all sibling Pages projects. No public requests. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';

const root = new URL('../../', import.meta.url);
const origin = 'https://mod-it.games';
const entries = [
  { file: 'gbyrka.github.io/index.html', path: '/', ready: '#main' },
  { file: 'games/index.html', path: '/games/', ready: '#main' },
  { file: 'games/privacy.html', path: '/games/privacy.html', ready: 'h1' },
  { file: 'dock/index.html', path: '/dock/', ready: '#overlay-title' },
  { file: 'park/index.html', path: '/park/', ready: '#overlay-title' },
  { file: 'hamster/index.html', path: '/hamster/', ready: 'main' },
  { file: 'sokoban/index.html', path: '/sokoban/', ready: 'main' },
  { file: 'multiplayer/index.html', path: '/multiplayer/', query: '?game=plan&room=ABCD1234&debug=1', ready: '#entry-form' },
  { file: 'multiplayer/games/tow/index.html', path: '/multiplayer/games/tow/', query: '?room=ABCD1234&debug=1', ready: '#home' },
  { file: 'multiplayer/games/hamster/index.html', path: '/multiplayer/games/hamster/', query: '?room=ABCD1234', ready: '#home' },
];
let checks = 0;
const pass = label => { checks++; console.log(`PASS ${label}`); };

for (const entry of entries) {
  const html = await readFile(new URL(entry.file, root), 'utf8');
  const guard = html.match(/<script data-site-https>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(guard, `${entry.file}: missing early redirect`);
  const externalScript = html.search(/<script[^>]+src=/);
  assert.ok(externalScript < 0 || html.indexOf('data-site-https') < externalScript, `${entry.file}: redirect must precede scripts`);
  for (const url of [
    `http://mod-it.games${entry.path}?room=ABCD1234&c=a%2Bb&mode=tug#invite`,
    `http://www.mod-it.games${entry.path}?room=ABCD1234&c=a%2Bb&mode=tug#invite`,
    `https://www.mod-it.games${entry.path}?room=ABCD1234&c=a%2Bb&mode=tug#invite`,
    `http://gbyrka.github.io${entry.path}?room=ABCD1234&c=a%2Bb&mode=tug#invite`,
    `https://gbyrka.github.io${entry.path}?room=ABCD1234&c=a%2Bb&mode=tug#invite`,
    `${origin}${entry.path}?room=ABCD1234&c=a%2Bb&mode=tug#invite`,
    `http://localhost:8080${entry.path}?room=ABCD1234#invite`,
    `http://127.0.0.1:8080${entry.path}?room=ABCD1234#invite`,
    `file:///tmp/${entry.file}?room=ABCD1234#invite`,
    `http://mod-it.games.example.com${entry.path}?room=ABCD1234#invite`,
  ]) {
    const location = new URL(url), redirects = [];
    location.replace = value => redirects.push(value);
    runInNewContext(guard, { location }, { timeout: 1000 });
    if (entry.path === '/') {
      assert.deepEqual(redirects, [`${origin}/games/${location.search}${location.hash}`]);
    } else if (['mod-it.games', 'www.mod-it.games', 'gbyrka.github.io'].includes(location.hostname)
      && (location.protocol !== 'https:' || location.hostname !== 'mod-it.games')) {
      assert.deepEqual(redirects, [`${origin}${location.pathname}${location.search}${location.hash}`]);
    } else assert.deepEqual(redirects, [], `${entry.file}: canonical and local entry must not redirect`);
  }
  const metadata = [...html.matchAll(/(?:href|content)="(https?:\/\/[^"\s]+)"/g)].map(match => new URL(match[1]));
  assert.ok(metadata.every(url => url.protocol === 'https:'), `${entry.file}: HTTP metadata`);
  assert.ok(metadata.every(url => url.hostname !== 'gbyrka.github.io'), `${entry.file}: legacy metadata`);
}
assert.equal((await readFile(new URL('gbyrka.github.io/CNAME', root), 'utf8')).trim(), 'mod-it.games');
pass('All ten HTML entry pages preserve URL parameters across HTTPS/domain redirects, keep local previews usable and publish HTTPS metadata');

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1280, height: 900 } });
const errors = [], navigation = [], frames = [], insecureRequests = [];
const types = { html: 'text/html', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', json: 'application/json', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', txt: 'text/plain' };
await context.route('**/*', async route => {
  const request = route.request(), url = new URL(request.url());
  if (request.isNavigationRequest()) navigation.push(url.href);
  if (!['mod-it.games', 'gbyrka.github.io', 'www.mod-it.games', 'localhost'].includes(url.hostname)) {
    return route.fulfill({ contentType: 'text/javascript', body: '' });
  }
  if (url.hostname === 'mod-it.games' && url.protocol !== 'https:' && !request.isNavigationRequest()) insecureRequests.push(url.href);
  const path = decodeURIComponent(url.pathname);
  if (path.includes('..')) return route.fulfill({ status: 404, body: '' });
  const relative = path === '/' ? 'gbyrka.github.io/index.html' : path.slice(1) + (path.endsWith('/') ? 'index.html' : '');
  try {
    const body = await readFile(new URL(relative, root));
    return route.fulfill({ contentType: types[relative.split('.').at(-1)] ?? 'application/octet-stream', body });
  } catch { return route.fulfill({ status: 404, body: '' }); }
});
const page = await context.newPage();
page.on('pageerror', error => errors.push(error.message));
page.on('framenavigated', frame => { if (frame === page.mainFrame()) frames.push(frame.url()); });

try {
  for (const entry of entries) {
    const query = entry.query ?? '?migration=a%2Bb', fragment = '#invite';
    const before = navigation.length;
    await page.goto(`http://gbyrka.github.io${entry.path}${query}${fragment}`, { waitUntil: 'commit' });
    await page.waitForURL(url => url.origin === origin, { waitUntil: 'domcontentloaded' });
    await page.locator(entry.ready).waitFor();
    if (['/games/', '/multiplayer/', '/multiplayer/games/tow/', '/multiplayer/games/hamster/'].includes(entry.path)) {
      await page.waitForFunction(() => document.documentElement.dataset.appVersion);
    }
    const targetPath = entry.path === '/' ? '/games/' : entry.path;
    assert.ok(navigation.slice(before).includes(`${origin}${targetPath}${query}`), `${entry.path}: canonical redirect lost parameters`);
    assert.ok(frames.includes(`${origin}${targetPath}${query}${fragment}`), `${entry.path}: canonical redirect lost the fragment`);
    const links = await page.locator('a[href]').evaluateAll(anchors => anchors.map(anchor => anchor.href));
    for (const href of links) {
      const url = new URL(href);
      if (['http:', 'https:'].includes(url.protocol)) {
        assert.equal(url.protocol, 'https:', `${entry.path}: insecure link ${href}`);
        assert.notEqual(url.hostname, 'gbyrka.github.io', `${entry.path}: legacy link ${href}`);
      }
    }
    if (entry.query?.includes('room=')) assert.equal(await page.locator('#room-code-input, #join-code').count() > 0
      ? await page.locator('#room-code-input, #join-code').first().inputValue()
      : await page.locator('input').evaluateAll(inputs => inputs.find(input => input.value === 'ABCD1234')?.value), 'ABCD1234');
  }
  pass('Real browser redirects all games from the old HTTP origin to the custom HTTPS domain without losing room codes; every navigation link stays HTTPS');

  await page.goto(`${origin}/games/`);
  const paths = ['/dock/', '/park/', '/hamster/', '/multiplayer/?game=plan', '/multiplayer/games/tow/'];
  for (const path of paths) {
    const link = page.locator(`a[href="..${path}"]`).first();
    assert.equal(await link.evaluate(anchor => anchor.href), origin + path);
  }
  assert.equal(await page.locator('a[href*="multiplayer/games/hamster"]').count(), 0);
  await page.locator('a[href="../dock/"]').first().click();
  await page.waitForURL(origin + '/dock/');
  await page.getByRole('link', { name: '← Browse all games' }).click();
  await page.waitForURL(origin + '/games/');
  pass('Catalog and return navigation use custom-domain HTTPS URLs, while HAMSTER multiplayer remains unlisted');

  await page.goto(`${origin}/dock/`);
  const challenge = await page.evaluate(() => buildChallengeUrl(1234));
  assert.equal(new URL(challenge).origin, origin);
  await page.goto(challenge.replace(origin, 'http://gbyrka.github.io') + '&mode=tug#challenge', { waitUntil: 'commit' });
  await page.waitForURL(url => url.origin === origin, { waitUntil: 'domcontentloaded' });
  assert.equal(new URL(page.url()).searchParams.get('mode'), 'tug');
  assert.equal(await page.evaluate(() => readChallengeScore()), 1234);
  assert.equal(await page.locator('#challenge-score').textContent(), '1234');
  pass('DOCK creates HTTPS challenge links on the new domain and retains encoded scores and tug mode through a legacy HTTP redirect');

  await page.goto('http://localhost/dock/');
  await page.locator('#overlay-title').waitFor();
  assert.equal(new URL(page.url()).origin, 'http://localhost');
  assert.deepEqual(insecureRequests, []);
  assert.deepEqual(errors, []);
  pass('Local HTTP previews still work; canonical game pages issue no insecure asset requests or browser exceptions');
  console.log(`HTTPS domain: ${checks} checks passed.`);
} finally {
  await browser.close();
}
