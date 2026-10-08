/** Real WebRTC, locally signaled; fixtures and observations live only in this test. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const { PeerServer } = await import(process.env.PEER_SERVER_MODULE ? pathToFileURL(process.env.PEER_SERVER_MODULE).href : 'peer');
const clientPath = process.env.PEERJS_SCRIPT ?? join(dirname(require.resolve('peerjs')), 'peerjs.min.js');
const client = await readFile(clientPath, 'utf8'), root = new URL('../', import.meta.url);
const output = process.env.SCREENSHOT_DIR ?? 'test-results/hamster'; await mkdir(output, { recursive: true });
let signal;
await new Promise(resolve => PeerServer({ host: '127.0.0.1', port: 0, path: '/signal' }, server => { signal = server; resolve(); }));
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost'), path = decodeURIComponent(url.pathname).replace(/^\/multiplayer\//, '');
  if (!url.pathname.startsWith('/multiplayer/') || path.includes('..')) { response.writeHead(404).end(); return; }
  const relative = !path || path.endsWith('/') ? path + 'index.html' : path;
  try {
    const body = await readFile(new URL(relative, root));
    const ext = relative.split('.').at(-1), type = { mjs: 'text/javascript', js: 'text/javascript', css: 'text/css', json: 'application/json', svg: 'image/svg+xml', png: 'image/png' }[ext] ?? 'text/html';
    response.writeHead(200, { 'Content-Type': type }); response.end(body);
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/multiplayer/games/hamster/`;
const browsers = [];
const launchOptions = { headless: true, args: ['--enable-unsafe-swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] };
const pages = [], contexts = [], errors = []; let checks = 0;
const pass = label => { checks++; console.log(`PASS ${label}`); };

function observe() {
  window.__hamster = { channels: [], states: [], wire: [] };
  const capture = (direction, raw) => {
    try {
      const data = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
      window.__hamster.wire.push({ direction, data }); if (window.__hamster.wire.length > 400) window.__hamster.wire.shift();
      const state = data.kind === 'snapshot' ? data.state : data.type === 'STATE_UPDATE' && data.payload.kind === 'arena' ? data.payload.state : null;
      if (state) { window.__hamster.states.push(state); if (window.__hamster.states.length > 80) window.__hamster.states.shift(); }
    } catch { /* PeerJS metadata is not a game packet. */ }
  };
  const watch = channel => {
    window.__hamster.channels.push(channel); channel.addEventListener('message', event => capture('in', event.data));
    const send = channel.send.bind(channel); channel.send = data => { capture('out', data); return send(data); };
  };
  const Native = window.RTCPeerConnection;
  window.RTCPeerConnection = class extends Native {
    constructor(...args) { super(...args); this.addEventListener('datachannel', event => watch(event.channel)); }
    createDataChannel(...args) { const channel = super.createDataChannel(...args); watch(channel); return channel; }
  };
}
async function page({ version, noGraphics = false, noPeer = false } = {}) {
  const browser = await chromium.launch(launchOptions); browsers.push(browser);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } }); contexts.push(context);
  await context.addInitScript(observe);
  if (noGraphics) await context.addInitScript(() => { const get = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function(type, ...args) { return type.startsWith('webgl') ? null : get.call(this, type, ...args); }; });
  await context.route('**/peerjs@1.5.5/dist/peerjs.min.js', route => noPeer ? route.abort() : route.fulfill({ contentType: 'text/javascript', body: client + `\nconst RealPeer = window.Peer; window.Peer = class extends RealPeer { constructor(id, options) { super(id, { ...options, host: '127.0.0.1', port: ${signal.address().port}, path: '/signal', secure: false, config: { iceServers: [] } }); } };` }));
  await context.route(/googlesyndication|googletagmanager|google-analytics/, route => route.fulfill({ contentType: 'text/javascript', body: '' }));
  if (version) await context.route('**/config.json?*', async route => { const config = JSON.parse(await readFile(new URL('config.json', root), 'utf8')); config.version = version; await route.fulfill({ json: config }); });
  const result = await context.newPage(); result.setDefaultTimeout(20000); result.on('pageerror', error => errors.push(error.message)); result.on('console', entry => { if (entry.type() === 'error' && /THREE.WebGLProgram|Shader Error/.test(entry.text())) errors.push(entry.text()); }); pages.push(result); return result;
}
const latest = page => page.evaluate(() => {
  const states = window.__hamster.states, id = states.at(-1)?.id;
  return states.filter(s => s.id === id).reduce((a, b) => !a || b.epoch > a.epoch || (b.epoch === a.epoch && b.tick > a.tick) ? b : a, null);
});
async function observeLabels(page) {
  await page.evaluate(async () => {
    const { Scene } = await import('./vendor/three.mjs'), update = Scene.prototype.updateMatrixWorld;
    Scene.prototype.updateMatrixWorld = function(...args) {
      const result = update.apply(this, args);
      const labels = [];
      this.traverse(node => { if (node.isSprite) labels.push(node.visible && node.parent.visible); });
      if (labels.length) window.__labels = labels;
      return result;
    };
  });
}
async function noOverflow(page, width) {
  await page.setViewportSize({ width, height: 1000 }); await page.waitForTimeout(150);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px has no horizontal overflow`);
  if (await page.locator('#picnic').isVisible()) {
    const board = await page.locator('.board-wrap').boundingBox(), shell = await page.locator('.game-shell').boundingBox(), map = await page.locator('.minimap').boundingBox();
    assert.ok(board.width <= shell.width + 1, `${width}px board stays inside its shell`);
    assert.ok(map.x >= board.x && map.x + map.width <= board.x + board.width + 1, `${width}px minimap stays fully visible`);
  }
}
async function capture(page, name) {
  const options = { path: `${output}/${name}.png`, fullPage: true };
  try { await page.screenshot(options); }
  catch (error) {
    if (!error.message.includes('Unable to capture screenshot')) throw error;
    await page.waitForTimeout(300); await page.screenshot(options);
  }
}
async function joinRoom(page, invite, name) { await page.goto(invite); await page.locator('#home:not([hidden])').waitFor(); await page.locator('#your-name').fill(name); await page.locator('#connect').click(); }
async function fixture(host, callback) {
  await host.locator('#pause').click(); await host.waitForFunction(() => window.__hostSession.arena.phase === 'paused');
  await host.evaluate(callback); await host.evaluate(() => window.__hostSession.publishArena(true));
  await host.locator('#resume').click();
}

try {
  const collection = await page(); await collection.goto(new URL('../../', base).href); await collection.locator('.featured-game').first().waitFor();
  assert.equal(await collection.locator('a[href*="games/hamster"]').count(), 0);
  assert.ok(!(await collection.evaluate(() => performance.getEntriesByType('resource').map(r => r.name))).some(name => name.includes('/games/hamster/')));
  await collection.context().close(); pass('The public collection has no HAMSTER link and loads none of its files');

  const host = await page(); await host.goto(base); await host.locator('#home:not([hidden])').waitFor();
  await observeLabels(host);
  assert.equal(await host.locator('meta[name="robots"]').getAttribute('content'), 'noindex, nofollow');
  for (const width of [320, 390, 768, 1440]) await noOverflow(host, width);
  await capture(host, 'home-desktop');
  await host.locator('#your-name').fill('Greg'); await host.locator('#connect').click(); await host.locator('#lobby:not([hidden])').waitFor();
  assert.ok(await host.locator('#start').isDisabled()); const invite = await host.locator('#invite-link').inputValue();
  assert.ok(invite.includes('/multiplayer/games/hamster/?room='));
  await host.evaluate(async () => {
    const { HamsterSession } = await import('./session.mjs'), start = HamsterSession.prototype.start;
    const clock = HamsterSession.prototype.clockTick; window.__clockGaps = [];
    HamsterSession.prototype.clockTick = function() { window.__clockGaps.push(performance.now() - this.previous); if (window.__clockGaps.length > 100) window.__clockGaps.shift(); return clock.call(this); };
    HamsterSession.prototype.start = function(...args) { window.__hostSession = this; return start.apply(this, args); };
  });
  const guest = await page(); await joinRoom(guest, invite, 'Anna'); await guest.locator('#lobby:not([hidden])').waitFor();
  await guest.locator('#ready:enabled').waitFor(); assert.ok(await host.locator('#start').isDisabled()); await guest.locator('#ready').click();
  await host.locator('#start:enabled').waitFor(); pass('Invite, same room code, two-person lobby and READY gate use the existing connection rules');

  const mismatch = await page({ version: 'different' }); await joinRoom(mismatch, invite, 'Version'); await mismatch.locator('#form-error').filter({ hasText: 'Different game versions' }).waitFor(); await mismatch.context().close();
  pass('Incompatible deployment versions are rejected before joining');
  await host.locator('#start').click(); await guest.locator('#picnic:not([hidden])').waitFor();
  await guest.waitForFunction(() => window.__hamster.states.at(-1)?.phase === 'playing');
  assert.equal((await latest(guest)).hamsters.length, 2); assert.equal(await guest.locator('#standings li').count(), 2);
  const channels = await guest.evaluate(() => window.__hamster.channels.map(c => ({ label: c.label, ordered: c.ordered, retries: c.maxRetransmits })));
  assert.ok(channels.some(c => c.label === 'hamster-state-v1' && c.ordered === false && c.retries === 0));
  assert.ok(channels.some(c => c.label === 'multiplayer-v1' && c.ordered && c.retries === null));
  const initial = await latest(guest); await guest.locator('#game').focus(); await guest.keyboard.down('KeyW');
  await guest.waitForFunction(z => window.__hamster.states.at(-1)?.hamsters[1].z < z - 1, initial.hamsters[1].z); await guest.keyboard.up('KeyW');
  await capture(host, 'picnic-two-players');
  pass('Two browsers exchange real WebRTC inputs, authoritative movement and visible 3D hamster scores');
  assert.deepEqual(await host.evaluate(() => window.__labels), [false, false, false, false]);
  pass('Two-player games draw no name labels over either hamster');

  await fixture(host, async () => {
    const { tunnelPose } = await import('./tunnel.mjs');
    const [a, b] = window.__hostSession.arena.hamsters;
    for (const [p, s, direction] of [[a, 2, 1], [b, 5, -1]]) {
      p.tube = { branch: 1, s, direction, choice: 0, reverseHeld: false };
      Object.assign(p, tunnelPose(1, s, direction));
    }
  });
  await host.locator('#game').focus(); await host.keyboard.down('KeyW');
  await guest.locator('#game').focus(); await guest.keyboard.down('KeyW');
  await guest.waitForFunction(() => { const [a, b] = window.__hamster.states.at(-1).hamsters; return a.tube && b.tube && a.speed < .01 && b.speed < .01 && Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 1.405; });
  const contact = await latest(guest);
  await new Promise(resolve => setTimeout(resolve, 300));
  const stillBlocked = await latest(guest);
  assert.ok(Math.abs(contact.hamsters[0].tube.s - stillBlocked.hamsters[0].tube.s) < .03);
  assert.ok(stillBlocked.hamsters[0].tube.s < stillBlocked.hamsters[1].tube.s);
  await host.keyboard.up('KeyW'); await guest.keyboard.up('KeyW');
  await host.keyboard.down('KeyS');
  await guest.waitForFunction(() => window.__hamster.states.at(-1).hamsters[0].tube?.direction === -1);
  await host.keyboard.up('KeyS');
  await host.keyboard.down('KeyW'); await guest.waitForFunction(() => window.__hamster.states.at(-1).hamsters[0].tube === null); await host.keyboard.up('KeyW');
  pass('Opposing hamsters block over real WebRTC; the host turns around and retreats out of the pipe');
  await fixture(host, () => {
    window.__hostSession.arena.hamsters.forEach((p, slot) => Object.assign(p, { tube: null, x: (slot - 1.5) * 1.65, y: 0, z: 5.5, angle: 0, pitch: 0, curl: 0, speed: 0 }));
  });

  await fixture(host, () => { const arena = window.__hostSession.arena; arena.hamsters[1].pouch = [0, 1, 2]; arena.hamsters[1].energy = 25; });
  await guest.locator('#game').focus(); await guest.keyboard.down('Space');
  await guest.waitForFunction(() => window.__hamster.states.at(-1)?.hamsters[1].score === 60); await guest.keyboard.up('Space');
  assert.equal(await guest.locator('#score').textContent(), '60'); assert.equal((await latest(host)).hamsters[1].pouch.length, 0);
  pass('A real held key eats the fixture pouch exactly once and both browsers agree on 60 banked points');

  await fixture(host, () => {
    const [a, b] = window.__hostSession.arena.hamsters;
    Object.assign(a, { x: 0, z: 3.2, angle: 0, speed: 0, dash: 0, dashCooldown: 0, lastMask: 0 });
    Object.assign(b, { x: 0, z: 1.5, angle: 0, speed: 0, pouch: [0, 1, 2], shield: 0 });
  });
  await host.locator('#game').focus(); await host.keyboard.press('KeyQ', { delay: 160 });
  await guest.waitForFunction(() => window.__hamster.states.at(-1)?.hamsters[1].pouch.length === 2);
  const bumped = await latest(guest); assert.equal(bumped.hamsters[1].score, 60); assert.equal(bumped.hamsters[0].bumpCount, 1); assert.ok(bumped.foods.some(f => f.dropped));
  pass('A live Q dash spills one treat across WebRTC while preserving the victim’s banked score');

  await host.locator('#pause').click(); await guest.locator('#picnic-overlay:not([hidden])').waitFor();
  const paused = await latest(guest); await new Promise(resolve => setTimeout(resolve, 250)); assert.equal((await latest(guest)).tick, paused.tick);
  await host.locator('#resume').click(); await guest.waitForFunction(epoch => window.__hamster.states.at(-1)?.epoch > epoch, paused.epoch);
  pass('Host pause freezes all players and the shared clock; resume starts a fresh input epoch');

  await fixture(host, () => { window.__hostSession.arena.tick = 1979; });
  await guest.waitForFunction(() => window.__hamster.states.at(-1)?.bloom === 1); await guest.locator('#bloom-banner:not([hidden])').waitFor();
  assert.equal((await latest(guest)).foods.filter(f => f.type === 3).length, 6);
  pass('The 30-second snack event is shared, visible and creates six golden treats');

  await fixture(host, () => { const arena = window.__hostSession.arena; arena.tick = 10979; arena.hamsters[0].score = arena.hamsters[1].score = 60; });
  await guest.waitForFunction(() => window.__hamster.states.at(-1)?.phase === 'results');
  assert.match(await host.locator('#overlay-title').textContent(), /worth sharing/); assert.equal(await guest.locator('#results li.winner').count(), 2);
  assert.equal(await guest.locator('#rematch').isVisible(), false); assert.equal(await host.locator('#rematch').isVisible(), true);
  await capture(host, 'shared-results');
  await host.locator('#rematch').click(); await guest.waitForFunction(id => window.__hamster.states.at(-1)?.id !== id, bumped.id);
  assert.equal((await latest(guest)).hamsters[1].score, 0); pass('Shared winners, authoritative results and rematch keep the room and reset scores');

  await guest.locator('#leave').click(); await host.locator('#lobby:not([hidden])').waitFor(); assert.equal(await host.locator('#players li:not(.waiting)').count(), 1);
  pass('A guest departure during play returns the host to a clean lobby');

  const third = await page(), fourth = await page();
  await joinRoom(guest, invite, 'Anna'); await guest.locator('#ready:enabled').waitFor();
  await joinRoom(third, invite, '<b>Ola</b>'); await third.locator('#ready:enabled').waitFor();
  await observeLabels(third);
  await joinRoom(fourth, invite, 'Marek'); await fourth.locator('#ready:enabled').waitFor();
  await host.locator('#players li:not(.waiting)').filter({ hasText: 'Marek' }).waitFor();
  assert.equal(await host.locator('#players strong b').count(), 0); assert.ok((await host.locator('#players').textContent()).includes('<b>Ola</b>'));
  const fifth = await page(); await joinRoom(fifth, invite, 'Extra'); await fifth.locator('#form-error').filter({ hasText: 'four players' }).waitFor(); await fifth.context().close();
  for (const player of [guest, third, fourth]) await player.locator('#ready').click();
  await host.locator('#start:enabled').waitFor(); await capture(host, 'lobby-four-players');
  await host.locator('#start').click(); await fourth.waitForFunction(() => window.__hamster.states.at(-1)?.phase === 'playing');
  assert.equal((await latest(fourth)).hamsters.length, 4); assert.equal(await host.locator('#standings li').count(), 4);
  await capture(host, 'picnic-four-players');
  pass('Four real peers share the same habitat; a fifth is rejected and names stay inert text');
  assert.deepEqual(await host.evaluate(() => window.__labels), [false, true, true, true]);
  assert.deepEqual(await third.evaluate(() => window.__labels), [true, true, false, true]);
  pass('Four-player games show only other players’ labels, for the host and a guest');

  for (const width of [320, 390, 768, 1440]) await noOverflow(fourth, width);
  await fourth.setViewportSize({ width: 390, height: 1000 }); await capture(fourth, 'picnic-mobile');
  await fourth.locator('#sound-toggle').click(); assert.equal(await fourth.locator('#sound-toggle').getAttribute('aria-pressed'), 'false');
  await fourth.emulateMedia({ reducedMotion: 'reduce' }); assert.ok(await fourth.locator('#picnic').isVisible());
  pass('Home and active game fit 320–1440px, with local mute and reduced motion');

  await host.locator('#leave').click(); for (const player of [guest, third, fourth]) await player.locator('#disconnected:not([hidden])').waitFor();
  await capture(guest, 'host-disconnected'); pass('Host departure ends every guest session cleanly');
  const unsupported = await page({ noGraphics: true }); await unsupported.goto(base); await unsupported.locator('#your-name').fill('Test'); await unsupported.locator('#connect').click();
  await unsupported.locator('#form-error').filter({ hasText: 'WebGL 2 is unavailable' }).waitFor(); await unsupported.context().close();
  const missing = await page({ noPeer: true }); await missing.goto(base); await missing.locator('#your-name').fill('Test'); await missing.locator('#connect').click();
  await missing.locator('#form-error').filter({ hasText: 'connection library' }).waitFor(); await missing.context().close();
  pass('Missing WebGL or unavailable PeerJS produces readable recoverable entry errors');
  assert.deepEqual(errors, []); console.log(`HAMSTER browser: ${checks} checks passed.`);
} catch (error) {
  console.error(error);
  for (let i = 0; i < pages.length; i++) if (!pages[i].isClosed()) {
    await pages[i].screenshot({ path: `${output}/failure-${i}.png`, fullPage: true }).catch(() => {});
    console.error(`PAGE ${i}`, await pages[i].evaluate(() => ({ visible: ['home', 'connecting', 'lobby', 'picnic', 'disconnected'].filter(id => !document.getElementById(id)?.hidden), boot: document.getElementById('boot')?.textContent, error: document.getElementById('form-error')?.textContent, state: window.__hamster?.states.at(-1)?.phase, tick: window.__hamster?.states.at(-1)?.tick, hidden: document.hidden, canvas: [document.getElementById('game')?.width, document.getElementById('game')?.height], gaps: window.__clockGaps?.slice(-10) })).catch(() => ({})));
  }
  console.error('Browser errors:', errors); process.exitCode = 1;
} finally {
  await Promise.all(browsers.map(browser => browser.close())); server.close(); signal.close();
  // PeerServer's expiry timers have no public disposal API.
  process.exit(process.exitCode ?? 0);
}
