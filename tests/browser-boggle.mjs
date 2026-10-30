/** Real HTTP, local signaling, real PeerJS/WebRTC, production dictionary worker. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium, webkit, devices } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const mobileAudit = Boolean(process.env.BOGGLE_DEVICE), engine = process.env.BOGGLE_ENGINE === 'webkit' ? webkit : chromium;
const { PeerServer } = await import(process.env.PEER_SERVER_MODULE ? pathToFileURL(process.env.PEER_SERVER_MODULE).href : 'peer');
const client = await readFile(process.env.PEERJS_SCRIPT ?? join(dirname(require.resolve('peerjs')), 'peerjs.min.js'), 'utf8');
const root = new URL('../../', import.meta.url), output = process.env.SCREENSHOT_DIR ?? 'test-results/boggle';
await mkdir(output, { recursive: true });
let signal;
await new Promise(resolve => PeerServer({ host: '127.0.0.1', port: 0, path: '/signal' }, server => { signal = server; resolve(); }));
const server = createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  if (!/^\/(games|multiplayer)\//.test(pathname) || pathname.includes('..')) return response.writeHead(404).end();
  const file = pathname.slice(1) + (pathname.endsWith('/') ? 'index.html' : '');
  try {
    const data = await readFile(new URL(file, root));
    response.writeHead(200, { 'Content-Type': { mjs: 'text/javascript', js: 'text/javascript', css: 'text/css', json: 'application/json', svg: 'image/svg+xml', txt: 'text/plain', gz: 'application/gzip' }[file.split('.').at(-1)] ?? 'text/html' }).end(data);
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/multiplayer/games/boggle/`;
const browser = await engine.launch({ headless: true, ...(engine === chromium ? { args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] } : {}) });
const contexts = [], errors = [], dictionaryRequests = [], touchPages = new WeakSet();
let checks = 0, auditedViewports = 0;
function pass(text) { console.log(`PASS ${++checks}: ${text}`); }
async function page(touch = false) {
  const device = touch && mobileAudit ? devices[process.env.BOGGLE_DEVICE] : null;
  const context = await browser.newContext({ ...device, viewport: device?.viewport ?? (touch ? { width: 390, height: 844 } : { width: 1440, height: 1000 }), reducedMotion: 'reduce', hasTouch: touch });
  contexts.push(context);
  await context.route('**/peerjs@1.5.5/dist/peerjs.min.js', route => route.fulfill({ contentType: 'text/javascript', body: client + `\nconst OriginalPeer=window.Peer;window.Peer=class extends OriginalPeer{constructor(id,options){super(id,{...options,host:'127.0.0.1',port:${signal.address().port},path:'/signal',secure:false,config:{iceServers:[]}})}};` }));
  await context.route('**/pagead2.googlesyndication.com/**', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await context.route('**/www.googletagmanager.com/**', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
  const p = await context.newPage(); p.on('pageerror', error => errors.push(error.message));
  if (touch) touchPages.add(p);
  context.on('request', request => { if (request.url().includes('.bin.gz')) dictionaryRequests.push(request.url()); });
  return p;
}
async function hooks(p) {
  await p.evaluate(async () => {
    const { GameRoom } = await import('../../shared/room.mjs');
    const original = GameRoom.prototype.create, join = GameRoom.prototype.join;
    GameRoom.prototype.create = function (...args) {
      window.__room = this; const adapter = this.game.adapter;
      this.game = { ...this.game, adapter: { ...adapter, applyAction(...args) {
        let next;
        if (window.__finishNext) {
          window.__finishNext = false; next = { ...args[0], revision: args[0].revision + 1, endsAt: performance.now() - 1 };
        } else {
          next = adapter.applyAction(...args);
          if (['START_GAME', 'NEXT_HAND'].includes(args[2])) next = { ...next, startsAt: performance.now() + 250, endsAt: performance.now() + 60250 };
        }
        window.__state = next; return next;
      } } };
      return original.apply(this, args);
    };
    GameRoom.prototype.join = function (...args) { window.__room = this; return join.apply(this, args); };
    window.__finish = () => { window.__finishNext = true; window.__room.act('SET_READY', { ready: false }); };
  });
}
async function fits(p, phase) {
  // Desktop WebKit's emulated touch API need not report navigator.maxTouchPoints.
  const touchAudit = mobileAudit && touchPages.has(p);
  const sizes = touchAudit ? [[320,568], [360,740], [375,667], [390,844], [412,915], [600,960], [768,1024], [800,1280], [820,1180], [1024,1366], [568,320], [667,375], [844,390], [1024,768], [1180,820]] : [[1440, 1000], [1024, 768], [768, 1024], [390, 844], [320, 568], [667, 375]];
  for (const [width, height] of sizes) {
    await p.setViewportSize({ width, height });
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${phase} overflows ${width}×${height}`);
    auditedViewports++;
    if (touchAudit) {
      const dimensions = await p.evaluate(() => ({
        board: document.querySelector('#letter-board')?.getBoundingClientRect().height,
        tiles: [...document.querySelectorAll('[data-tile]')].map(tile => tile.getBoundingClientRect().width),
        tileBounds: [...document.querySelectorAll('[data-tile]')].map(tile => {
          const r = tile.getBoundingClientRect(), b = tile.closest('.letter-board').getBoundingClientRect();
          return { inside: r.x >= b.x && r.y >= b.y && r.right <= b.right + 1 && r.bottom <= b.bottom + 1, height: r.height };
        }),
        fields: [...document.querySelectorAll('input, select, textarea')].filter(input => input.getClientRects().length).map(input => ({ id: input.id || input.name, font: parseFloat(getComputedStyle(input).fontSize) })),
        inactiveTouchActions: [...document.querySelectorAll('.letter-board[data-interactive="false"],.letter-board[data-interactive="false"] .tile')].map(node => getComputedStyle(node).touchAction),
      }));
      for (const field of dimensions.fields) assert.ok(field.font >= 16, `${phase} ${width}×${height}: ${field.id} risks mobile input zoom (${field.font}px)`);
      if (dimensions.board && width > height && height <= 550) assert.ok(dimensions.board <= height - 16, `${phase} ${width}×${height}: entire board must fit a landscape swipe (${dimensions.board}px)`);
      for (const tile of dimensions.tiles) assert.ok(tile >= 43.9, `${phase} ${width}×${height}: tile too small for touch (${tile}px)`);
      for (const tile of dimensions.tileBounds) assert.ok(tile.inside && tile.height >= 43.9, `${phase} ${width}×${height}: tile must fit inside the board with a 44px touch height`);
      for (const action of dimensions.inactiveTouchActions) assert.equal(action, 'pan-y', 'Home/result boards must allow normal page scrolling');
    }
    if (width === 1440 || width === 390 || (touchAudit && [568, 768].includes(width))) await p.screenshot({ path: `${output}/${phase}-${width}.png`, fullPage: true });
  }
  await p.setViewportSize(touchAudit ? devices[process.env.BOGGLE_DEVICE].viewport : { width: 1440, height: 1000 });
}
async function candidates(host, minimum = 3) {
  return host.evaluate(minimum => [...window.__state.solutions].filter(([word]) => word.length >= minimum).sort(([a], [b]) => a.length - b.length), minimum);
}
async function submit(p, word) {
  await p.locator('#word-input').fill(word); await p.locator('#word-input').press('Enter');
  await p.locator('.found-words li > span').filter({ hasText: new RegExp(`^${word}$`) }).waitFor();
}
async function point(p, index) {
  await p.locator(`[data-tile="${index}"]`).scrollIntoViewIfNeeded();
  const box = await p.locator(`[data-tile="${index}"]`).boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
async function dragWord(p, path) {
  const start = await point(p, path[0]); await p.mouse.move(start.x, start.y); await p.mouse.down();
  for (const index of path.slice(1)) { const target = await point(p, index); await p.mouse.move(target.x, target.y, { steps: 4 }); }
  await p.mouse.up();
}
try {
  const host = await page(); await host.goto(base); await host.locator('.home').waitFor(); await hooks(host);
  assert.equal(await host.locator('meta[name="robots"]').getAttribute('content'), 'noindex, nofollow');
  assert.equal(dictionaryRequests.length, 0); await fits(host, 'home');
  pass('Unlisted entry loads without dictionaries; home fits desktop, mobile and landscape');
  await host.locator('#your-name').fill('Alex'); await host.getByRole('button', { name: 'CREATE GAME ↗', exact: true }).click(); await host.locator('.lobby').waitFor();
  const invite = await host.locator('#invite-link').inputValue(); assert.match(invite, /games\/boggle\/\?room=/);
  const guest = await page(true), legacyInvite = new URL(invite);
  legacyInvite.pathname = legacyInvite.pathname.replace('/boggle/', '/word-trail/'); legacyInvite.hash = '#invitation';
  await guest.goto(legacyInvite.href); await guest.locator('.home').waitFor(); await hooks(guest);
  assert.equal(new URL(guest.url()).pathname, '/multiplayer/games/boggle/');
  assert.equal(new URL(guest.url()).search, new URL(invite).search); assert.equal(new URL(guest.url()).hash, '#invitation');
  assert.match(await guest.title(), /^Boggle/);
  if (mobileAudit) await fits(guest, 'mobile-home');
  await guest.locator('#your-name').fill('Sam'); await guest.getByRole('button', { name: 'JOIN GAME ↗', exact: true }).click(); await guest.locator('.lobby').waitFor();
  for (const minLength of ['4', '5', '3']) {
    await host.locator('[name="minLength"]').selectOption(minLength); await host.getByRole('button', { name: 'SAVE SETTINGS' }).click();
    await guest.waitForFunction(value => window.__room.view.settings.minLength === Number(value), minLength);
  }
  await host.locator('[name="language"]').selectOption('en'); await host.locator('[name="seconds"]').selectOption('60');
  await host.locator('[name="size"]').selectOption(process.env.BOGGLE_FIRST_SIZE ?? '4');
  await host.getByRole('button', { name: 'SAVE SETTINGS' }).click();
  await guest.getByRole('button', { name: 'I’M READY', exact: true }).click(); await host.locator('[data-action="start"]:not(:disabled)').waitFor(); await fits(host, 'lobby');
  pass('Actual two-player room, invite, ready state and all three minimum-length options synchronize');
  if (mobileAudit) await fits(guest, 'mobile-lobby');
  let failDictionary = true;
  await host.context().route('**/data/en.bin.gz*', route => {
    if (failDictionary) { failDictionary = false; return route.fulfill({ status: 503, body: 'Unavailable' }); }
    return route.continue();
  });
  await host.locator('[data-action="start"]').click();
  await host.waitForFunction(() => document.querySelector('#toast').textContent.includes('Dictionary download failed'));
  await host.locator('[data-action="start"]:not(:disabled)').waitFor();
  assert.equal(await host.evaluate(() => window.__room.view.phase), 'lobby');
  pass('A failed dictionary download keeps the lobby intact and allows a clean retry');
  await host.locator('[data-action="start"]').click(); await host.locator('#word-input').waitFor(); await guest.locator('#word-input').waitFor();
  assert.ok(dictionaryRequests.some(url => url.includes('/en.bin.gz')));
  await fits(host, 'playing');
  if (mobileAudit) await fits(guest, 'mobile-playing');
  const words = await candidates(host), [word1, path1] = words[0], [word2, path2] = words.find(([word]) => word !== word1);
  await submit(host, word1);
  assert.equal((await guest.locator('.found-words').innerText()).trim(), 'Your first word is waiting on the board.');
  assert.equal(await guest.evaluate(() => JSON.stringify(window.__room.view).includes('solutions')), false);
  await host.locator('#word-input').fill(word1); await host.locator('#word-input').press('Enter'); assert.match(await host.locator('#word-feedback').innerText(), /already/);
  await submit(guest, word1);
  pass('Keyboard submissions validate; duplicates are rejected and other players’ words stay private');
  await host.locator('[data-action="clear-word"]').click(); await dragWord(host, path2);
  await host.locator('.found-words li > span').filter({ hasText: new RegExp(`^${word2}$`) }).waitFor();
  pass('Mouse dragging across adjacent tiles submits a real dictionary word');
  const [touchWord, touchPath] = words.find(([word]) => word !== word1 && word !== word2);
  if (await guest.locator('[data-action="clear-word"]').isEnabled()) await guest.locator('[data-action="clear-word"]').click();
  for (const index of touchPath) await guest.locator(`[data-tile="${index}"]`).tap();
  assert.equal(await guest.locator('#word-input').inputValue(), touchWord);
  await guest.getByRole('button', { name: 'ADD WORD ↗', exact: true }).tap();
  await guest.locator('.found-words li > span').filter({ hasText: new RegExp(`^${touchWord}$`) }).waitFor();
  pass('Touch tapping traces and submits a word on a portrait phone');
  const [touchDragWord, touchDragPath] = words.find(([word]) => ![word1, word2, touchWord].includes(word));
  if (engine === chromium) {
    const cdp = await guest.context().newCDPSession(guest), startTouch = await point(guest, touchDragPath[0]);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...startTouch, id: 1 }] });
    for (const index of touchDragPath.slice(1)) {
      const target = await point(guest, index);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...target, id: 1 }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await cdp.detach();
  } else {
    // WebKit has no CDP touch injection. Native tap is covered above; pointer-mouse drag
    // below exercises the shared path handler, without claiming a physical iOS swipe.
    await dragWord(guest, touchDragPath);
  }
  await guest.locator('.found-words li > span').filter({ hasText: new RegExp(`^${touchDragWord}$`) }).waitFor();
  pass(engine === chromium ? 'Touch dragging and release submits without scrolling the board' : 'WebKit drag and release submits on a touch device layout');
  if (mobileAudit) {
    const original = devices[process.env.BOGGLE_DEVICE].viewport;
    await guest.setViewportSize({ width: original.width, height: Math.max(300, original.height - 350) });
    await guest.locator('#word-input').fill('draft');
    await guest.locator('#word-input').scrollIntoViewIfNeeded();
    const focused = await guest.evaluate(() => document.activeElement.id);
    assert.equal(focused, 'word-input');
    await host.evaluate(() => window.__room.sendChat('Keyboard viewport check'));
    await guest.waitForFunction(() => window.__room.chatView.messages.some(message => message.text === 'Keyboard viewport check'));
    assert.equal(await guest.locator('#word-input').inputValue(), 'draft');
    assert.equal(await guest.evaluate(() => document.activeElement.id), 'word-input');
    await guest.setViewportSize(original); await guest.locator('#word-input').fill('');
    if (engine === chromium) {
      await guest.locator('#letter-board').scrollIntoViewIfNeeded();
      const cdp = await guest.context().newCDPSession(guest), first = await point(guest, 0), third = await point(guest, 2);
      await guest.locator('#word-input').focus();
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...first, id: 1 }] });
      assert.notEqual(await guest.evaluate(() => document.activeElement.id), 'word-input', 'Touching the board should dismiss the keyboard');
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...third, id: 1 }] });
      const expected = await guest.evaluate(() => window.__room.view.board.slice(0, 3).join(''));
      assert.equal(await guest.locator('#word-input').inputValue(), expected, 'Fast touch events must include tiles between sampled points');
      const count = await guest.evaluate(() => window.__room.view.myWords.length);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }); await cdp.detach();
      assert.equal(await guest.evaluate(() => window.__room.view.myWords.length), count, 'Canceled touches must not submit');
      await guest.locator('[data-action="clear-word"]').tap();
    }
    pass(engine === chromium ? 'Reduced keyboard viewport preserves focus and drafts; touch cancels safely and fast swipes keep intermediate tiles' : 'WebKit reduced keyboard viewport preserves focus and the word draft');
  }
  const sharedWords = words.filter(([word]) => ![word1, word2, touchWord, touchDragWord].includes(word));
  const [concurrent1] = sharedWords[0], [concurrent2] = sharedWords[1];
  await guest.evaluate(async ({ word, other }) => {
    const { message } = await import('../../shared/protocol.mjs'), room = window.__room, baseRevision = room.revision;
    for (const w of [word, other]) room.network.send(room.network.hostConnection, { ...message('BOGGLE_ACTION', { action: 'SUBMIT', word: w, round: 1 }), baseRevision });
  }, { word: concurrent1, other: concurrent2 });
  await guest.waitForFunction(word => window.__room.view.myWords.includes(word), concurrent2);
  pass('Concurrent submissions with the same base revision are both accepted');
  await guest.locator('#word-input').fill('zzzzzz'); await guest.locator('#word-input').press('Enter');
  await guest.waitForFunction(() => document.querySelector('#word-feedback').textContent.includes('dictionary'));
  await host.locator('#word-input').fill('draft');
  await guest.evaluate(() => window.__room.sendChat('Good words!'));
  await host.waitForFunction(() => window.__room.chatView.messages.some(message => message.text === 'Good words!'));
  assert.equal(await host.locator('#word-input').inputValue(), 'draft');
  pass('Invalid words are rejected; chat works without disturbing the word draft');
  await host.evaluate(() => window.__finish()); await host.locator('.results').waitFor(); await guest.locator('.results').waitFor();
  assert.equal(await host.locator('.shared-word span').filter({ hasText: new RegExp(`^${word1}$`) }).count(), 2);
  await host.locator('.longest-word').first().click(); assert.ok(await host.locator('.tile.selected').count() >= 3);
  assert.equal(await host.locator('.longest-word').count() <= 5, true); await fits(host, 'round-result');
  if (mobileAudit) await fits(guest, 'mobile-results');
  pass('Results cancel shared words, reveal submissions and draw exact longest-word trails');
  await host.locator('[data-action="next-round"]:not(:disabled)').waitFor(); await host.locator('[data-action="next-round"]').click();
  await guest.waitForFunction(() => window.__room.view.round === 2 && window.__room.view.phase === 'playing');
  assert.equal(await guest.evaluate(() => window.__room.view.myWords.length), 0);
  await host.evaluate(() => window.__finish()); await host.locator('[data-action="next-round"]:not(:disabled)').waitFor(); await host.locator('[data-action="next-round"]').click();
  await guest.waitForFunction(() => window.__room.view.round === 3 && window.__room.view.phase === 'playing');
  await host.evaluate(() => window.__finish()); await guest.waitForFunction(() => window.__room.view.phase === 'game_result');
  await host.locator('[data-action="play-again"]:not(:disabled)').waitFor(); await host.locator('[data-action="play-again"]').click(); await guest.locator('.lobby').waitFor();
  assert.equal(await guest.evaluate(() => window.__room.view.me.ready), false);
  pass('Three rounds preserve totals and the same room supports a clean rematch');
  await host.locator('[name="language"]').selectOption('pl'); await host.locator('[name="size"]').selectOption('6'); await host.locator('[name="minLength"]').selectOption('5');
  await host.getByRole('button', { name: 'SAVE SETTINGS' }).click(); await guest.getByRole('button', { name: 'I’M READY', exact: true }).click();
  await host.locator('[data-action="start"]:not(:disabled)').click(); await guest.locator('#word-input').waitFor();
  assert.equal(await guest.locator('[data-tile]').count(), 36); await fits(host, 'polish-6x6');
  if (mobileAudit) await fits(guest, 'mobile-6x6');
  const [polish] = (await candidates(host, 5)).find(([word]) => /[ąćęłńóśźż]/.test(word)) ?? (await candidates(host, 5))[0];
  await guest.locator('#word-input').fill(polish.slice(0, 4)); await guest.locator('#word-input').press('Enter');
  assert.match(await guest.locator('#word-feedback').innerText(), /at least 5/);
  await submit(guest, polish);
  assert.ok(dictionaryRequests.some(url => url.includes('/pl.bin.gz')));
  await guest.evaluate(() => window.__room.close()); await host.waitForFunction(() => window.__room.view.phase === 'disconnected');
  await host.locator('[data-action="return-lobby"]').click(); await host.locator('.lobby').waitFor();
  assert.equal(await host.evaluate(() => window.__room.view.players.length), 1);
  pass('Real Polish dictionary, 6×6 board, 5-letter minimum, accents and disconnect recovery');
  assert.deepEqual(errors, []); pass('No uncaught browser or worker errors');
  console.log(`${checks} browser checks passed; ${auditedViewports} phase/viewport combinations (${engine.name()}, ${process.env.BOGGLE_DEVICE ?? 'desktop + touch'}).`);
} catch (error) {
  console.error(error); process.exitCode = 1;
  for (const [index, context] of contexts.entries()) for (const p of context.pages()) await p.screenshot({ path: `${output}/failure-${index}.png`, fullPage: true }).catch(() => {});
} finally {
  await browser.close(); server.close(); signal.close();
}

// PeerServer retains housekeeping timers after HTTP close.
process.exit(process.exitCode ?? 0);
