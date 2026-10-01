/** 2–4 real WebRTC drivers, locally signaled. No production test hooks. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = process.env.PLAYWRIGHT_MODULE ? await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE)) : await import('playwright');
const { PeerServer } = process.env.PEER_SERVER_MODULE ? await import(pathToFileURL(process.env.PEER_SERVER_MODULE)) : await import('peer');
const clientPath = process.env.PEERJS_SCRIPT ?? join(dirname(require.resolve('peerjs')), 'peerjs.min.js');
const clientSource = await readFile(clientPath, 'utf8');
const root = new URL('../', import.meta.url), output = process.env.SCREENSHOT_DIR ?? 'test-results/tow';
await mkdir(output, { recursive: true });
let signalServer;
await new Promise(resolve => PeerServer({ host: '127.0.0.1', port: 0, path: '/signal' }, server => { signalServer = server; resolve(); }));
const signalPort = signalServer.address().port;
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost'), path = decodeURIComponent(url.pathname).replace(/^\/multiplayer\//, '');
  if (!url.pathname.startsWith('/multiplayer/') || path.includes('..')) { response.writeHead(404).end(); return; }
  const relative = !path || path.endsWith('/') ? path + 'index.html' : path;
  try {
    const body = await readFile(new URL(relative, root));
    const type = relative.endsWith('.mjs') ? 'text/javascript' : relative.endsWith('.css') ? 'text/css' : relative.endsWith('.json') ? 'application/json' : relative.endsWith('.svg') ? 'image/svg+xml' : 'text/html';
    response.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` }); response.end(body);
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = process.env.TOW_URL ?? `http://127.0.0.1:${server.address().port}/multiplayer/games/tow/`;
const browser = await chromium.launch({ headless: true });
const errors = [], contexts = [], pages = [];
let checks = 0, failure = false;
const pass = text => { checks++; console.log(`PASS ${text}`); };

function observe() {
  window.__tow = { channels: [], wire: [], snapshots: [], inputs: [], audio: { contexts: [], starts: [], meter: null } };
  const NativeAudio = window.AudioContext;
  if (NativeAudio) window.AudioContext = class extends NativeAudio {
    constructor(...args) { super(...args); window.__tow.audio.contexts.push(this); }
    createBufferSource() {
      const source = super.createBufferSource(), start = source.start.bind(source);
      source.start = (...args) => { window.__tow.audio.starts.push({ loop: source.loop, duration: source.buffer?.duration }); return start(...args); };
      return source;
    }
    createDynamicsCompressor() {
      const node = super.createDynamicsCompressor(), connect = node.connect.bind(node), context = this;
      node.connect = (destination, ...args) => {
        if (destination === context.destination) {
          const meter = context.createAnalyser(), silent = context.createGain(); silent.gain.value = 0;
          connect(meter); meter.connect(silent).connect(destination); window.__tow.audio.meter = meter;
        }
        return connect(destination, ...args);
      };
      return node;
    }
  };
  const capture = (direction, value) => {
    try {
      const data = JSON.parse(typeof value === 'string' ? value : new TextDecoder().decode(value));
      const wire = window.__tow.wire; wire.push({ direction, data }); if (wire.length > 500) wire.shift();
      const state = data.kind === 'snapshot' ? data.state : data.type === 'STATE_UPDATE' && data.payload.kind === 'race' ? data.payload.state : null;
      if (state) { window.__tow.snapshots.push({ direction, state, at: performance.now() }); if (window.__tow.snapshots.length > 80) window.__tow.snapshots.shift(); }
      if (data.kind === 'input') { window.__tow.inputs.push(data); if (window.__tow.inputs.length > 80) window.__tow.inputs.shift(); }
    } catch { /* PeerJS metadata is not application data. */ }
  };
  const watch = channel => {
    window.__tow.channels.push(channel); channel.addEventListener('message', event => capture('in', event.data));
    const send = channel.send.bind(channel); channel.send = value => { capture('out', value); return send(value); };
  };
  const Native = window.RTCPeerConnection;
  window.RTCPeerConnection = class extends Native {
    constructor(...args) { super(...args); this.addEventListener('datachannel', event => watch(event.channel)); }
    createDataChannel(...args) { const channel = super.createDataChannel(...args); watch(channel); return channel; }
  };
}

async function page(options = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 950 }, ...options }); contexts.push(context);
  await context.addInitScript(observe);
  await context.route('**/peerjs@1.5.5/dist/peerjs.min.js', route => route.fulfill({ contentType: 'text/javascript', body: clientSource + `\nconst RealPeer = window.Peer; window.Peer = class extends RealPeer { constructor(id, options) { super(id, { ...options, host: '127.0.0.1', port: ${signalPort}, path: '/signal', secure: false, config: { iceServers: [] } }); } };` }));
  await context.route(/googlesyndication|googletagmanager|google-analytics/, route => route.abort());
  const result = await context.newPage(); result.setDefaultTimeout(15000);
  result.on('pageerror', error => errors.push(error.message)); pages.push(result); return result;
}
const latest = page => page.evaluate(() => window.__tow.snapshots.at(-1)?.state);
const untilTick = (page, tick) => page.waitForFunction(t => window.__tow.snapshots.at(-1)?.state.tick > t, tick);
const audible = page => page.evaluate(() => {
  const meter = window.__tow.audio.meter; if (!meter) return 0;
  const samples = new Float32Array(meter.fftSize); meter.getFloatTimeDomainData(samples);
  return Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
});
async function noOverflow(page, width) {
  await page.setViewportSize({ width, height: 900 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
}
async function driveRoad(page, slot) {
  await page.evaluate(async slot => {
    const { makeTrack } = await import('./track.mjs');
    const { drivingLine, drivingMask } = await import('../../tests/tow-driver.mjs');
    const track = makeTrack(window.__tow.snapshots.at(-1).state.seed), line = drivingLine(track);
    window.__bot = setInterval(() => {
      const state = window.__tow.snapshots.at(-1)?.state;
      if (!state || state.phase !== 'racing') return;
      const car = state.rigs[slot][0], mask = drivingMask(track, line, {
        x: car[0] + car[3] * .12, y: car[1] + car[4] * .12, a: car[2] + car[5] * .12, vx: car[3], vy: car[4],
      });
      for (const [code, bit] of [['ArrowUp', 1], ['ArrowLeft', 4], ['ArrowRight', 8], ['Space', 16]]) {
        const down = !!(mask & bit);
        document.querySelector('#game').dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true }));
      }
    }, 30);
  }, slot);
}
async function stopDriving(page) {
  await page.evaluate(() => { clearInterval(window.__bot); for (const code of ['ArrowUp', 'ArrowLeft', 'ArrowRight', 'Space']) document.querySelector('#game').dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true })); });
}

try {
  const host = await page(), guest = await page({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await host.goto(new URL('../../', base).href); await host.locator('.featured-game').waitFor();
  assert.equal(await host.getByText('TOW', { exact: true }).count(), 0);
  assert.equal(await host.locator('a[href*="tow"], [data-game="tow"]').count(), 0);
  pass('TOW is absent from the multiplayer menu');
  await host.goto(base); await host.locator('#home').waitFor();
  assert.equal(await host.getByRole('button', { name: /^CREATE/ }).count(), 1);
  assert.equal(await host.locator('#create-tab, #join-tab').count(), 0);
  await host.locator('#mode-switch').click(); assert.ok(await host.locator('#code-field').isVisible());
  assert.equal(await host.locator('#connect').textContent(), 'JOIN GAME');
  await host.locator('#mode-switch').click(); assert.ok(await host.locator('#code-field').isHidden());
  assert.equal(await host.locator('#connect').textContent(), 'CREATE GAME');
  pass('The form has one active submit button and a working room-code switch');
  await host.getByRole('button', { name: 'Mute sounds' }).click(); await host.reload(); await host.locator('#home').waitFor();
  assert.equal(await host.locator('#sound-toggle').textContent(), 'SOUND OFF');
  await host.getByRole('button', { name: 'Enable sounds' }).click();
  pass('The sound preference persists and audio unlocks on a real gesture');
  await host.screenshot({ path: `${output}/home-desktop.png`, fullPage: true });
  await host.locator('#your-name').fill('Greg'); await host.locator('#connect').click(); await host.locator('#lobby').waitFor();
  const link = await host.locator('#invite-link').inputValue(), code = await host.locator('#room-code').textContent();
  assert.equal(new URL(link).pathname, new URL(base).pathname); assert.equal(new URL(link).searchParams.get('room'), code);
  assert.ok(await host.locator('#start').isDisabled());
  await host.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('Test denied')) } }));
  await host.locator('#copy-link').click(); assert.equal(await host.evaluate(() => document.activeElement.id), 'invite-link');
  pass('Room creation, subpath invite URL, disabled start and clipboard fallback');

  await guest.goto(link); await guest.locator('#home').waitFor(); assert.equal(await guest.locator('#room-code-input').inputValue(), code);
  assert.equal(await guest.getByRole('button', { name: /^JOIN/ }).count(), 1);
  await guest.locator('#your-name').fill('<b>Anna</b>'); await guest.locator('#connect').tap(); await guest.locator('#lobby').waitFor();
  await guest.waitForFunction(() => !document.querySelector('#ready').disabled);
  assert.equal(await host.locator('#players b').count(), 0); assert.ok((await host.locator('#players').innerText()).includes('<b>Anna</b>'));
  await guest.locator('#ready').tap(); await host.waitForFunction(() => !document.querySelector('#start').disabled);
  await guest.screenshot({ path: `${output}/lobby-mobile.png`, fullPage: true });
  const channels = await guest.evaluate(() => window.__tow.channels.map(c => ({ label: c.label, ordered: c.ordered, retries: c.maxRetransmits })));
  assert.ok(channels.some(c => c.label === 'tow-state-v1' && !c.ordered && c.retries === 0));
  assert.ok(channels.some(c => c.label === 'multiplayer-v1' && c.ordered && c.retries === null));
  pass('Two independent clients join and ready over reliable control plus unordered transient WebRTC');

  await host.locator('#start').click(); await guest.locator('#race').waitFor();
  const initial = await latest(guest); assert.equal(initial.phase, 'countdown');
  await guest.locator('#countdown').waitFor({ state: 'hidden' });
  for (const page of [host, guest]) {
    const starts = await page.evaluate(() => window.__tow.audio.starts);
    assert.equal(starts.filter(s => !s.loop && Math.abs(s.duration - .28) < .0001).length, 3, 'three countdown beeps');
    assert.equal(starts.filter(s => !s.loop && Math.abs(s.duration - .3) < .0001).length, 1, 'one start tone');
    assert.ok(starts.filter(s => s.loop).length >= 16, 'two complete vehicle sound layers');
    assert.ok(await audible(page) > .001, 'engines produce actual audio samples');
  }
  pass('Both browsers hear three countdown beeps, one start tone and two running engines');
  assert.equal((await latest(host)).seed, (await latest(guest)).seed);
  await host.keyboard.down('ArrowUp'); await guest.keyboard.down('ArrowUp');
  const tick = (await latest(guest)).tick; await untilTick(guest, tick + 140);
  await host.keyboard.up('ArrowUp'); await guest.keyboard.up('ArrowUp');
  assert.ok(Number(await host.locator('#speed').textContent()) > 30); assert.ok(Number(await guest.locator('#speed').textContent()) > 30);
  assert.ok((await latest(guest)).progress.every(s => s > 360));
  const pixels = await guest.locator('#game').evaluate(canvas => canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.some((value, i) => i % 4 !== 3 && value > 100));
  assert.ok(pixels); assert.ok(await guest.locator('#minimap').isVisible());
  await host.screenshot({ path: `${output}/race-desktop.png`, fullPage: true }); await guest.screenshot({ path: `${output}/race-mobile.png`, fullPage: true });
  pass('Shared seed, synchronized countdown, immediate steering, moving trailers, camera and minimap');

  const late = await page(); await late.goto(link); await late.locator('#home').waitFor();
  await late.locator('#your-name').fill('Late'); await late.locator('#connect').click();
  await late.getByText('A race is already in progress. Join when the drivers return to the lobby.', { exact: true }).waitFor();
  assert.equal((await latest(host)).rigs.length, 2); await late.close();
  pass('A running race cannot acquire a late driver');

  await host.keyboard.down('KeyH'); await guest.waitForFunction(() => window.__tow.snapshots.at(-1)?.state.horns[0] === true);
  await host.keyboard.up('KeyH'); await guest.waitForFunction(() => window.__tow.snapshots.at(-1)?.state.horns[0] === false);
  await guest.keyboard.down('KeyH'); await host.waitForFunction(() => window.__tow.snapshots.at(-1)?.state.horns[1] === true);
  await guest.keyboard.up('KeyH'); await host.waitForFunction(() => window.__tow.snapshots.at(-1)?.state.horns[1] === false);
  pass('H presses and releases reach the other player in both directions');

  await host.getByRole('button', { name: 'Mute sounds' }).click();
  await untilTick(guest, (await latest(guest)).tick + 35); assert.ok(await audible(host) < .00001, 'mute silences every voice');
  assert.ok(await audible(guest) > .001, 'muting is local');
  await host.getByRole('button', { name: 'Enable sounds' }).click(); await untilTick(guest, (await latest(guest)).tick + 20);
  assert.ok(await audible(host) > .001);
  pass('Mute silences actual output and re-enabling resumes the current engines');

  for (const width of [320, 390, 768]) await noOverflow(guest, width);
  await guest.setViewportSize({ width: 390, height: 844 });
  const touch = guest.locator('[data-key="ArrowUp"]'), box = await touch.boundingBox();
  // An actual pointer gesture tests capture/release.
  await guest.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await guest.mouse.down();
  await untilTick(guest, (await latest(guest)).tick + 35); await guest.mouse.up();
  assert.ok(await guest.locator('#touch-controls').isVisible());
  const hornBox = await guest.locator('[data-key="KeyH"]').boundingBox();
  await guest.mouse.move(hornBox.x + hornBox.width / 2, hornBox.y + hornBox.height / 2); await guest.mouse.down();
  await host.waitForFunction(() => window.__tow.snapshots.at(-1)?.state.horns[1] === true);
  await guest.mouse.up(); await host.waitForFunction(() => window.__tow.snapshots.at(-1)?.state.horns[1] === false);
  pass('Phone controls and no horizontal overflow at 320, 390 and 768 pixels');

  await host.locator('#pause').click(); await guest.waitForFunction(() => !document.querySelector('#race-overlay').hidden);
  const paused = await latest(guest); assert.equal(paused.phase, 'paused');
  await new Promise(resolve => setTimeout(resolve, 200)); assert.equal((await latest(guest)).tick, paused.tick);
  assert.ok(await audible(host) < .00001 && await audible(guest) < .00001, 'paused engines and horns are silent');
  await host.locator('#resume').click(); await untilTick(guest, paused.tick + 10);
  const penaltyBefore = (await latest(guest)).penalties[1]; await guest.locator('#reset').click();
  await guest.waitForFunction(p => window.__tow.snapshots.at(-1)?.state.penalties[1] === p + 3, penaltyBefore);
  await guest.locator('#reset').click(); await guest.getByText('Reset available every 8 seconds during the race (+3 seconds).', { exact: true }).waitFor();
  pass('Host pause freezes both clocks; guest reset is authoritative and rate limited with +3s penalty');

  await host.locator('summary').click(); await guest.locator('summary').click();
  await host.locator('#delay').selectOption('50'); await guest.locator('#delay').selectOption('100'); await guest.locator('#loss').selectOption('15');
  await guest.locator('#game').focus(); await host.locator('#game').focus();
  await driveRoad(guest, 1); await driveRoad(host, 0);
  const slowed = await latest(guest); await untilTick(guest, slowed.tick + 720);
  await stopDriving(guest); await stopDriving(host);
  const after = await latest(guest); assert.ok(after.progress[1] > slowed.progress[1] + 400);
  const ping = await guest.locator('#ping').textContent(); assert.ok(Number(ping.match(/PING (\d+)/)?.[1]) >= 100, ping);
  assert.ok(after.rigs.flat(2).every(Number.isFinite));
  await guest.screenshot({ path: `${output}/race-latency.png`, fullPage: true });
  pass('Driving continues through 150ms added round-trip delay and 15% outgoing packet loss');

  // Forge invalid transient inputs through the real channel; no position packets exist.
  await guest.evaluate(({ id, epoch }) => window.__tow.channels.find(c => c.label === 'tow-state-v1').send(JSON.stringify({ kind: 'input', id, epoch, frames: [[999999, 31]], x: 999999 })), after);
  await untilTick(guest, after.tick + 15); assert.ok((await latest(guest)).progress[1] < 15000);
  pass('The host ignores forged future ticks and never accepts client positions');

  await host.locator('#delay').selectOption('0'); await guest.locator('#delay').selectOption('0'); await guest.locator('#loss').selectOption('0');
  await guest.locator('#leave').click(); await host.locator('#lobby').waitFor(); assert.ok(await host.locator('#start').isDisabled());
  assert.ok((await host.locator('#players').innerText()).includes('Waiting for a driver'));
  pass('Leaving returns the host to the reusable lobby');

  const third = await page(), fourth = await page();
  const racers = [host, guest, third, fourth];
  for (const [index, driver] of racers.entries()) if (index) {
    await driver.goto(link); await driver.locator('#home').waitFor();
    await driver.locator('#your-name').fill(`Driver ${index + 1}`); await driver.locator('#connect').click();
    await driver.locator('#lobby').waitFor(); await driver.waitForFunction(() => !document.querySelector('#ready').disabled);
    assert.ok(await host.locator('#start').isDisabled());
    await driver.locator('#ready').click(); await host.waitForFunction(() => !document.querySelector('#start').disabled);
  }
  for (const driver of racers) assert.equal(await driver.locator('#players li:not(.waiting)').count(), 4);
  await fourth.locator('#ready').click(); await host.waitForFunction(() => document.querySelector('#start').disabled);
  assert.equal(await guest.locator('#ready').textContent(), 'NOT READY');
  await fourth.locator('#ready').click(); await host.waitForFunction(() => !document.querySelector('#start').disabled);
  pass('Four clients get distinct slots; the host waits for every driver to choose READY');

  const fifth = await page(); await fifth.goto(link); await fifth.locator('#home').waitFor();
  await fifth.locator('#your-name').fill('Fifth'); await fifth.locator('#connect').click();
  await fifth.getByText('This room already has four players.', { exact: true }).waitFor();
  assert.equal(await host.locator('#players li:not(.waiting)').count(), 4); await fifth.close();
  pass('A fifth driver is rejected without disrupting the four-player room');

  await host.locator('#start').click();
  for (const driver of racers) { await driver.locator('#race').waitFor(); await driver.locator('#countdown').waitFor({ state: 'hidden' }); }
  const race4 = await latest(host);
  for (const driver of racers) {
    const state = await latest(driver); assert.equal(state.id, race4.id); assert.equal(state.seed, race4.seed); assert.equal(state.rigs.length, 4);
    assert.match(await driver.locator('#position').textContent(), /^[1-4] \/ 4$/);
    assert.ok(await driver.locator('#minimap').isVisible());
    assert.ok(await audible(driver) > .001);
  }
  const channels4 = await host.evaluate(() => window.__tow.channels.filter(channel => channel.readyState === 'open').map(channel => channel.label));
  assert.equal(channels4.filter(label => label === 'tow-state-v1').length, 3);
  assert.equal(channels4.filter(label => label === 'multiplayer-v1').length, 3);
  pass('Four drivers share a countdown, track, four-car HUD and audio over three separate WebRTC links');

  for (const driver of racers) await driver.keyboard.down('ArrowUp');
  await host.waitForFunction(() => window.__tow.snapshots.at(-1)?.state.masks.every(mask => mask & 1));
  await untilTick(host, race4.tick + 170);
  const moved4 = await latest(host);
  for (const driver of racers) await driver.keyboard.up('ArrowUp');
  assert.ok(moved4.progress.every((s, slot) => s > race4.progress[slot] + 50), `all four drivers independently accelerate: ${moved4.progress}`);
  assert.ok(moved4.rigs.flat(2).every(Number.isFinite));
  await fourth.keyboard.down('KeyH');
  for (const driver of racers.slice(0, 3)) await driver.waitForFunction(() => window.__tow.snapshots.at(-1)?.state.horns[3] === true);
  await fourth.keyboard.up('KeyH');
  for (const driver of racers.slice(0, 3)) await driver.waitForFunction(() => window.__tow.snapshots.at(-1)?.state.horns[3] === false);
  await third.locator('#reset').click(); await host.waitForFunction(() => window.__tow.snapshots.at(-1)?.state.penalties[2] === 3);
  assert.deepEqual((await latest(host)).penalties, [0, 0, 3, 0]);
  await host.screenshot({ path: `${output}/race-four-players.png`, fullPage: true });
  pass('All four cars move independently; the fourth horn reaches everyone and the third reset affects its own car');

  // Spoof another slot on the wire: ownership still comes from the accepted connection.
  await fourth.evaluate(({ id }) => window.__tow.channels.find(c => c.label === 'multiplayer-v1' && c.readyState === 'open').send(new TextEncoder().encode(JSON.stringify({
    v: 1, requestId: 'forged-slot-horn', type: 'PLAY_AGAIN', payload: { action: 'horn', id, pressed: true, slot: 1 },
  }))), moved4);
  await host.waitForFunction(() => window.__tow.snapshots.at(-1)?.state.horns[3] === true);
  assert.equal((await latest(host)).horns[1], false);
  await fourth.keyboard.down('KeyH'); await fourth.keyboard.up('KeyH');
  await host.waitForFunction(() => window.__tow.snapshots.at(-1)?.state.horns[3] === false);
  pass('A driver cannot take over another slot by forging a slot field');

  await fourth.locator('summary').click(); await fourth.locator('#delay').selectOption('100'); await fourth.locator('#loss').selectOption('15');
  await host.locator('#delay').selectOption('50');
  for (const [slot, driver] of racers.entries()) { await driver.locator('#game').focus(); await driveRoad(driver, slot); }
  const lag4 = await latest(host); await untilTick(host, lag4.tick + 600);
  for (const driver of racers) await stopDriving(driver);
  const afterLag4 = await latest(host);
  // Cars can block one another while the test drivers converge on a passing lane.
  // Verify queue delivery and fresh shared physics independently of those collisions.
  assert.ok(afterLag4.progress.some((s, slot) => s > lag4.progress[slot] + 200), 'the shared world keeps moving');
  for (const slot of [1, 2, 3]) {
    assert.ok(await host.evaluate(({ slot, tick, id }) => window.__tow.snapshots.some(({ state }) =>
      state.id === id && state.tick > tick && (state.masks[slot] & 1)), { slot, tick: lag4.tick, id: lag4.id }), `slot ${slot} keeps receiving its own inputs`);
  }
  for (const driver of racers.slice(1)) {
    const state = await latest(driver); assert.equal(state.id, afterLag4.id);
    assert.ok(Math.abs(state.tick - afterLag4.tick) < 80, 'each guest receives recent four-car snapshots');
    assert.ok(state.rigs.flat(2).every(Number.isFinite));
  }
  assert.ok(afterLag4.rigs.flat(2).every(Number.isFinite));
  pass('Four-player driving continues while one guest has 150ms added round-trip delay and 15% packet loss');

  await host.locator('#pause').click();
  for (const driver of racers) await driver.waitForFunction(() => window.__tow.snapshots.at(-1)?.state.phase === 'paused');
  const paused4 = await latest(host); await new Promise(resolve => setTimeout(resolve, 200));
  for (const driver of racers) { assert.equal((await latest(driver)).tick, paused4.tick); assert.ok(await audible(driver) < .00001); }
  await host.locator('#resume').click(); for (const driver of racers) await untilTick(driver, paused4.tick + 10);
  pass('Pause and resume freeze and restart all four clocks and sound mixes');

  await guest.locator('#leave').click();
  for (const driver of [host, third, fourth]) await driver.locator('#lobby').waitFor();
  assert.equal(await host.locator('#players li:not(.waiting)').count(), 3); assert.ok(await host.locator('#start').isDisabled());
  assert.ok((await fourth.locator('#players').innerText()).includes('Driver 4 (you)'));
  await third.locator('#ready').click(); await fourth.locator('#ready').click();
  await host.waitForFunction(() => !document.querySelector('#start').disabled);
  await host.locator('#start').click();
  for (const driver of [host, third, fourth]) await driver.locator('#race').waitFor();
  for (const driver of [host, third, fourth]) {
    assert.equal((await latest(driver)).rigs.length, 3); assert.match(await driver.locator('#position').textContent(), /^[1-3] \/ 3$/);
  }
  await fourth.keyboard.down('KeyH'); await host.waitForFunction(() => window.__tow.snapshots.at(-1)?.state.horns[2] === true);
  await fourth.keyboard.up('KeyH'); await host.waitForFunction(() => window.__tow.snapshots.at(-1)?.state.horns[2] === false);
  pass('A guest departure returns remaining drivers to the lobby, reassigns slots and permits a three-player race');

  await host.locator('#leave').click();
  for (const driver of [third, fourth]) await driver.locator('#disconnected').waitFor();
  assert.deepEqual(errors, []); pass('Host departure ends every guest connection without browser errors');
  console.log(`TOW browser checks: ${checks} passed.`);
} catch (error) {
  failure = true; console.error(error); if (errors.length) console.error('Browser errors:', [...new Set(errors)]);
  for (let i = 0; i < pages.length; i++) if (!pages[i].isClosed()) {
    await pages[i].screenshot({ path: `${output}/failure-${i}.png`, fullPage: true }).catch(() => {});
    console.error(`PAGE ${i}`, await pages[i].locator('body').innerText().catch(() => 'closed'));
  }
} finally {
  await browser.close(); server.close(); signalServer.close();
  // PeerServer's expiry timers have no disposal API.
  process.exit(failure ? 1 : 0);
}
