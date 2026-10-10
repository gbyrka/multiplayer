/** Actual PeerJS/WebRTC, complete games through the UI, touch and responsive/privacy checks. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { nextIntent, simulateMatch } from './catana-driver.mjs';
import { buildViewForPlayer } from '../games/catana/game-core.mjs';

const require = createRequire(import.meta.url);
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const { PeerServer } = await import(process.env.PEER_SERVER_MODULE ? pathToFileURL(process.env.PEER_SERVER_MODULE).href : 'peer');
const client = await readFile(process.env.PEERJS_SCRIPT ?? join(dirname(require.resolve('peerjs')), 'peerjs.min.js'), 'utf8');
const root = new URL('../', import.meta.url), output = process.env.SCREENSHOT_DIR ?? 'test-results/catana'; await mkdir(output, { recursive: true });
let signal; await new Promise(resolve => PeerServer({ host: '127.0.0.1', port: 0, path: '/signal' }, server => { signal = server; resolve(); }));
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost'), path = decodeURIComponent(url.pathname).replace(/^\/multiplayer\//, '');
  if (!url.pathname.startsWith('/multiplayer/') || path.includes('..')) { response.writeHead(404).end(); return; }
  const file = !path || path.endsWith('/') ? path + 'index.html' : path;
  try { const body = await readFile(new URL(file, root)), type = { mjs: 'text/javascript', js: 'text/javascript', css: 'text/css', json: 'application/json', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }[file.split('.').at(-1)] ?? 'text/html'; response.writeHead(200, { 'Content-Type': type }); response.end(body); }
  catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/multiplayer/games/catana/`, errors = [], contexts = [];
const browser = await chromium.launch({ headless: true, args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
let checks = 0, failure = false; const pass = text => { checks++; console.log(`PASS ${text}`); };

function observe() {
  window.__wire = []; const Native = window.RTCPeerConnection;
  const capture = (channel, raw) => {
    try { const value = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw)); if (value.type) { window.__wire.push({ label: channel.label, data: value }); if (window.__wire.length > 2000) window.__wire.shift(); } }
    catch { /* Support-test packets are not JSON game messages. */ }
  };
  function watch(channel) { const send = channel.send.bind(channel); channel.send = value => { capture(channel, value); return send(value); }; channel.addEventListener('message', event => capture(channel, event.data)); }
  window.RTCPeerConnection = class extends Native { constructor(...args) { super(...args); this.addEventListener('datachannel', event => watch(event.channel)); } createDataChannel(...args) { const channel = super.createDataChannel(...args); watch(channel); return channel; } };
}
async function page({ touch = false, noPeer = false, unsupported = false } = {}) {
  const context = await browser.newContext({ viewport: touch ? { width: 1024, height: 1000 } : { width: 1440, height: 1100 }, hasTouch: touch, reducedMotion: 'reduce' }); contexts.push(context);
  await context.addInitScript(observe);
  if (unsupported) await context.addInitScript(() => { window.RTCPeerConnection = undefined; });
  await context.route('**/peerjs@1.5.5/dist/peerjs.min.js', route => noPeer ? route.abort() : route.fulfill({ contentType: 'text/javascript', body: client + `\nconst OriginalPeer = window.Peer; window.Peer = class extends OriginalPeer { constructor(id, options) { super(id, { ...options, host: '127.0.0.1', port: ${signal.address().port}, path: '/signal', secure: false, config: { iceServers: [] } }); } };` }));
  await context.route(/googlesyndication|googletagmanager|google-analytics/, route => route.fulfill({ contentType: 'text/javascript', body: '' }));
  const page = await context.newPage(); page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message)); return page;
}
async function instrument(page, host) {
  await page.evaluate(async host => {
    const { GameRoom } = await import('../../shared/room.mjs');
    const { seededRandom } = await import('../../tests/catana-driver.mjs');
    const original = GameRoom.prototype[host ? 'create' : 'join'];
    GameRoom.prototype[host ? 'create' : 'join'] = function(...args) {
      window.__room = this;
      if (host) {
        const originalAdapter = this.game.adapter, pick = seededRandom(79);
        this.game = { ...this.game, adapter: { ...originalAdapter,
          createLobby: (...args) => window.__state = originalAdapter.createLobby(...args),
          addPlayer: (...args) => window.__state = originalAdapter.addPlayer(...args),
          removePlayer: (...args) => window.__state = originalAdapter.removePlayer(...args),
          applyAction: (...args) => window.__state = originalAdapter.applyAction(...args, pick),
        } };
      }
      return original.apply(this, args);
    };
  }, host);
}
async function joinRoom(page, invite, name) { await page.goto(invite); await page.locator('#entry-form').waitFor(); await instrument(page, false); await page.locator('#your-name').fill(name); await page.getByRole('button', { name: 'JOIN GAME ↗' }).click(); await page.locator('.lobby').waitFor(); }
async function noOverflow(page, width) { await page.setViewportSize({ width, height: 1050 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width}px: no horizontal overflow`); }
const tap = async (page, locator) => { if (await page.evaluate(() => navigator.maxTouchPoints > 0)) await locator.tap(); else await locator.click(); };
async function performUI(page, intent, phase) {
  const { action, ...payload } = intent.payload;
  if (['BUILD_SETTLEMENT', 'BUILD_CITY', 'BUILD_ROAD'].includes(action)) {
    const kind = { BUILD_SETTLEMENT: 'settlement', BUILD_CITY: 'city', BUILD_ROAD: 'road' }[action];
    if (phase === 'main') { await page.locator('[data-action="panel"][data-panel="build"]').click(); await page.locator(`[data-action="build-mode"][data-kind="${kind}"]`).click(); }
    const selector = kind === 'road' ? `[data-action="select-road"][data-edge="${payload.edge}"]` : `[data-action="select-vertex"][data-vertex="${payload.vertex}"]`;
    await tap(page, page.locator(selector)); await tap(page, page.locator('[data-action="confirm-placement"]'));
  } else if (action === 'ROLL') await page.locator('[data-action="roll"]').click();
  else if (action === 'END_TURN') await page.locator('[data-action="end-turn"]').click();
  else if (action === 'PLAY_DEVELOPMENT') { await page.locator('[data-action="panel"][data-panel="cards"]').click(); await page.locator(`[data-action="play-development"][data-card="${payload.card}"]`).click(); }
  else if (action === 'BUY_DEVELOPMENT') { await page.locator('[data-action="panel"][data-panel="build"]').click(); await page.locator('[data-action="buy-development"]').click(); }
  else if (action === 'MOVE_ROBBER') { await tap(page, page.locator(`[data-action="select-hex"][data-hex="${payload.hex}"]`)); await page.locator('[data-action="confirm-placement"]').click(); }
  else if (action === 'STEAL') await page.locator(`[data-action="steal"][data-victim="${payload.victim}"]`).click();
  else if (action === 'CHOOSE_MONOPOLY') await page.locator(`[data-action="monopoly"][data-resource="${payload.resource}"]`).click();
  else if (action === 'FINISH_ROADS') await page.locator('[data-action="finish-roads"]').click();
  else if (action === 'DISCARD' || action === 'TAKE_PLENTY') { for (const [resource, count] of Object.entries(payload.resources)) await page.locator(`#choose-${resource}`).fill(String(count)); await page.locator('#submit-resources').click(); }
  else if (action === 'BANK_TRADE') { await page.locator('[role="tab"][data-action="panel"][data-panel="trade"]').click(); await page.locator('[data-action="trade-mode"][data-mode="bank"]').click(); await page.locator('#bank-give').selectOption(payload.give); await page.locator('#bank-receive').selectOption(payload.receive); await page.locator('#bank-quantity').fill(String(payload.quantity)); await page.locator('#bank-trade button[type="submit"]').click(); }
  else throw new Error(`Missing UI driver for ${action}`);
}

try {
  const collection = await page(); await collection.goto(new URL('../../', base).href); await collection.locator('.featured-game').first().waitFor();
  assert.equal(await collection.locator('a[href*="catana"],[data-game="catana"]').count(), 0);
  assert.ok(!(await collection.evaluate(() => performance.getEntriesByType('resource').map(entry => entry.name))).some(url => /catana\/(app|ui|board|game-core)\.mjs/.test(url))); pass('Game remains unlisted and its board/UI/engine are not loaded by the collection');
  const host = await page(); await host.goto(base); await host.locator('#entry-form').waitFor(); await instrument(host, true);
  await host.screenshot({ path: `${output}/home-desktop.png`, fullPage: true });
  for (const width of [1920, 1440, 1024, 834, 768, 430, 360, 320]) await noOverflow(host, width);
  await host.setViewportSize({ width: 1440, height: 1100 }); await host.getByRole('button', { name: 'HOW TO PLAY' }).click(); assert.ok(await host.locator('.rules-content').isVisible()); await host.getByRole('button', { name: 'Close dialog' }).click();
  await host.locator('#your-name').fill('Ada'); await host.getByRole('button', { name: 'CREATE GAME ↗' }).click(); await host.locator('.lobby').waitFor();
  const invite = await host.locator('#invite-link').inputValue(); assert.ok(invite.startsWith(base));
  const guest = await page({ touch: true }); await joinRoom(guest, invite, 'Grace'); await guest.getByRole('button', { name: 'READY', exact: true }).click(); await host.getByRole('button', { name: 'START GAME', exact: true }).click();
  await host.locator('.game').waitFor(); await guest.locator('.game').waitFor(); pass('Mouse host and touch tablet join the existing GameRoom via a subdirectory invite');
  const pages = [host, guest], actors = new Map(); for (const page of pages) actors.set(await page.evaluate(() => window.__room.playerId), page);
  const observed = new Set(); let actions = 0, desktopSaved = false, tabletSaved = false, negotiated = false;
  while (actions < 1000) {
    // Match human pacing: shared transport intentionally limits each peer to 100 packets / 10 seconds.
    await new Promise(resolve => setTimeout(resolve, 130));
    const state = await host.evaluate(() => window.__state); if (state.phase === 'game_result') break;
    if (!negotiated && state.phase === 'main') {
      const proposer = state.players.find(player => player.id === state.currentPlayerId), partner = state.players.find(player => player.id !== proposer.id);
      const give = Object.keys(proposer.resources).find(resource => proposer.resources[resource] > 0 && Object.keys(partner.resources).some(other => other !== resource && partner.resources[other] > 0));
      const want = give && Object.keys(partner.resources).find(resource => resource !== give && partner.resources[resource] > 0);
      if (give && want) {
        const proposerPage = actors.get(proposer.id), partnerPage = actors.get(partner.id);
        await proposerPage.locator('[role="tab"][data-action="panel"][data-panel="trade"]').click(); await proposerPage.locator('[data-action="trade-mode"][data-mode="offer"]').click();
        await proposerPage.locator(`[name="give-${give}"]`).fill('1'); await proposerPage.locator(`[name="want-${want}"]`).fill('1'); await proposerPage.locator('#trade-target').selectOption(partner.id); await proposerPage.locator('#player-trade button[type="submit"]').click();
        await host.waitForFunction(() => Boolean(window.__state.trade));
        await partnerPage.waitForFunction(() => Boolean(window.__room.view.trade)); await partnerPage.locator('[role="tab"][data-action="panel"][data-panel="trade"]').click(); await partnerPage.locator('[data-action="counteroffer"]').click();
        await partnerPage.locator('#player-trade button[type="submit"]').click(); await host.waitForFunction(partner => window.__state.trade?.proposer === partner, partner.id);
        await proposerPage.waitForFunction(partner => window.__room.view.trade?.proposer === partner, partner.id); await proposerPage.locator('[data-action="accept-trade"]').click(); await host.waitForFunction(() => window.__state.trade === null);
        const tradeRevision = await host.evaluate(() => window.__state.revision); await Promise.all(pages.map(page => page.waitForFunction(revision => window.__room.view.revision === revision, tradeRevision)));
        negotiated = true; pass('Player-trade form, guest counteroffer and atomic acceptance work through the actual UI'); continue;
      }
    }
    const intent = nextIntent(state), current = actors.get(intent.actor); observed.add(intent.payload.action);
    await performUI(current, intent, state.phase);
    await host.waitForFunction(revision => window.__state.revision > revision, state.revision);
    const revision = await host.evaluate(() => window.__state.revision); await Promise.all(pages.map(page => page.waitForFunction(revision => window.__room.view.revision === revision, revision)));
    actions++;
    if (actions % 30 === 0) console.log(`Two-player UI match: ${actions} actions`);
    if (!desktopSaved && state.phase === 'main' && actions > 15) { await host.screenshot({ path: `${output}/game-desktop.png`, fullPage: true }); desktopSaved = true; }
    if (!tabletSaved && state.phase === 'robber') { await guest.screenshot({ path: `${output}/game-tablet.png`, fullPage: true }); tabletSaved = true; }
  }
  const completed = await host.evaluate(() => window.__state); assert.equal(completed.phase, 'game_result'); assert.equal(completed.targetScore, 12);
  assert.equal(negotiated, true);
  assert.ok(await host.locator('.result-overlay').isVisible()); await host.screenshot({ path: `${output}/victory.png`, fullPage: true });
  pass(`Complete two-player match wins at 12 VP after ${actions} UI actions (${[...observed].join(', ')})`);
  const guestWire = await guest.evaluate(() => window.__wire.filter(entry => entry.data.type === 'STATE_UPDATE').map(entry => entry.data.payload.view)); assert.ok(guestWire.length > 20);
  for (const view of guestWire) { for (const player of view.players) { assert.equal(Object.hasOwn(player, 'resources'), false); assert.equal(Object.hasOwn(player, 'development'), false); } assert.equal(Object.hasOwn(view, 'developmentDeck'), false); }
  assert.ok((await guest.evaluate(() => window.__wire)).some(entry => entry.label === 'multiplayer-v1')); pass('Actual WebRTC snapshots contain only recipient cards, public pieces and card counts');
  await host.getByRole('button', { name: 'Review the island' }).click(); await host.getByRole('button', { name: 'SHOW RESULTS · PLAY AGAIN' }).click(); await host.getByRole('button', { name: 'PLAY AGAIN · A NEW ISLAND' }).click(); await host.locator('.result-overlay').waitFor({ state: 'hidden' });
  assert.equal((await host.evaluate(() => window.__state)).phase, 'setup_settlement'); pass('Game-over review and rematch preserve the room and start a fresh island');
  await guest.locator('#chat-container>summary').click(); await guest.locator('#chat-input').fill('Good game! Shall we trade?'); await guest.locator('#chat-form button[type="submit"]').click(); await host.waitForFunction(() => window.__room.chatView.messages.some(entry => entry.text === 'Good game! Shall we trade?'));
  await guest.locator('[data-action="leave"]').click(); await guest.locator('[data-action="confirm-leave"]').click(); await host.locator('[data-action="return-lobby"]').waitFor(); await host.locator('[data-action="return-lobby"]').click(); await host.locator('.lobby').waitFor();
  pass('Shared chat and interrupted-match recovery work through the production room lifecycle');

  const four = [host];
  for (const name of ['Grace', 'Linus', 'Margaret']) { const player = await page({ touch: name === 'Margaret' }); await joinRoom(player, invite, name); await player.getByRole('button', { name: 'READY', exact: true }).click(); four.push(player); }
  await host.getByRole('button', { name: 'START GAME', exact: true }).click(); await host.locator('.game').waitFor();
  const playerPages = new Map(); for (const page of four) { await page.waitForFunction(() => window.__room.view.phase === 'setup_settlement'); playerPages.set(await page.evaluate(() => window.__room.playerId), page); }
  const initialBoard = JSON.stringify((await host.evaluate(() => window.__state)).board); let steps = 0;
  while (steps++ < 1000) {
    await new Promise(resolve => setTimeout(resolve, 130));
    const state = await host.evaluate(() => window.__state); if (state.phase === 'game_result') break;
    const intent = nextIntent(state), page = playerPages.get(intent.actor);
    // Two-player test exercises all controls; this second full match focuses on 4-way real transport.
    await page.evaluate(intent => window.__room.act(intent.type, intent.payload), intent);
    await host.waitForFunction(revision => window.__state.revision > revision, state.revision);
    const revision = await host.evaluate(() => window.__state.revision); await Promise.all(four.map(page => page.waitForFunction(revision => window.__room.view.revision === revision, revision)));
    if (steps % 40 === 0) console.log(`Four-player WebRTC match: ${steps} actions`);
    if (steps === 40) { for (const width of [1920, 1440, 1024, 834, 768, 430, 360, 320]) await noOverflow(host, width); await host.setViewportSize({ width: 1440, height: 1100 }); await host.screenshot({ path: `${output}/four-players.png`, fullPage: true }); }
  }
  assert.equal((await host.evaluate(() => window.__state)).phase, 'game_result');
  for (const page of four) { const view = await page.evaluate(() => window.__room.view); assert.equal(view.targetScore, 10); assert.equal(view.phase, 'game_result'); assert.equal(JSON.stringify(view.board), initialBoard); }
  pass(`Complete four-player WebRTC match stays synchronized and wins at 10 VP (${steps - 1} actions)`);

  const fixture = await page(); await fixture.goto(base); await fixture.locator('#entry-form').waitFor();
  const fixtures = {}; simulateMatch(4, 22, state => { if (!fixtures[state.phase]) fixtures[state.phase] = structuredClone(state); });
  for (const phase of ['discard', 'year_of_plenty', 'monopoly', 'steal', 'road_building']) {
    const state = fixtures[phase]; assert.ok(state); const actor = phase === 'discard' ? Object.keys(state.discards)[0] : state.currentPlayerId;
    await fixture.evaluate(async view => { const { renderGame } = await import('./ui.mjs'); document.querySelector('#main').replaceChildren(renderGame(view, { panel: 'cards', buildMode: 'road' }, false)); }, buildViewForPlayer(state, actor));
    for (const width of [1440, 1024, 768, 430, 320]) await noOverflow(fixture, width);
  }
  pass('Discard, development, robber and player panels remain readable without overflow from desktop to 320px');
  const unavailable = await page({ noPeer: true }); await unavailable.goto(base); await unavailable.locator('#your-name').fill('No CDN'); await unavailable.getByRole('button', { name: 'CREATE GAME ↗' }).click(); await unavailable.getByText('Couldn’t find your seat.').waitFor();
  const unsupported = await page({ unsupported: true }); await unsupported.goto(base); await unsupported.locator('#form-error').filter({ hasText: 'Multiplayer is not supported' }).waitFor(); pass('CDN failure and unsupported WebRTC display readable recovery screens');
  assert.deepEqual(errors, []); console.log(`PASS ${checks} browser checks; screenshots in ${output}`);
} catch (error) {
  failure = true;
  console.log('Browser errors:', errors);
  for (let i = 0; i < contexts.length; i++) for (const page of contexts[i].pages()) {
    console.log('Failure diagnostics:', i, await page.evaluate(() => ({ url: location.href, status: document.querySelector('#connection-status')?.textContent, toast: document.querySelector('#toast')?.textContent,
      host: window.__room?.isHost, closed: window.__room?.closed, revision: window.__room?.revision, phase: window.__room?.view?.phase,
      authoritativeRevision: window.__state?.revision, authoritativePhase: window.__state?.phase,
      lastPackets: window.__wire?.slice(-4).map(packet => ({ type: packet.data.type, revision: packet.data.payload.view?.revision, length: JSON.stringify(packet.data).length })) })));
    await page.screenshot({ path: `${output}/failure-${i}.png`, fullPage: true });
  }
  console.error(error);
} finally {
  await browser.close(); server.close(); signal.close();
  // PeerServer expiry timers have no public disposal API; follow the other WebRTC browser tests.
  process.exit(failure ? 1 : 0);
}
