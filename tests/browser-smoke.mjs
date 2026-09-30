/** Optional real-network browser checks. No browser tooling is used in production. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const playwright = process.env.PLAYWRIGHT_MODULE ? await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE)) : await import('playwright');
const { chromium } = playwright;
const base = process.env.PLAN_URL ?? 'http://127.0.0.1:8080/';
const output = process.env.SCREENSHOT_DIR ?? 'test-results';
await mkdir(output, { recursive: true });

const errors = [];
const browsers = [];
const contexts = [];
let checks = 0;
const checked = label => { checks++; console.log(`PASS ${label}`); };

// Observe actual JSON on RTCDataChannels without adding a production debug hook.
function observeWire() {
  window.__wire = [];
  window.__channels = [];
  window.__audioPlays = [];
  const sourcePrototype = window.AudioBufferSourceNode?.prototype;
  if (sourcePrototype) {
    const connect = sourcePrototype.connect, start = sourcePrototype.start;
    sourcePrototype.connect = function (destination, ...args) {
      if (destination instanceof GainNode) this.__testVolume = destination.gain.value;
      return connect.call(this, destination, ...args);
    };
    sourcePrototype.start = function (...args) {
      window.__audioPlays.push({ duration: this.buffer?.duration, volume: this.__testVolume });
      return start.call(this, ...args);
    };
  }
  const capture = (direction, value) => {
    try {
      const json = typeof value === 'string' ? value : new TextDecoder().decode(value);
      const data = JSON.parse(json);
      if (data?.v === 1) window.__wire.push({ direction, data });
    } catch { /* Not an application envelope. */ }
  };
  const watch = channel => {
    if (window.__channels.includes(channel)) return;
    window.__channels.push(channel);
    channel.addEventListener('message', event => capture('in', event.data));
    const send = channel.send.bind(channel);
    channel.send = value => { capture('out', value); return send(value); };
  };
  const NativePeer = window.RTCPeerConnection;
  window.RTCPeerConnection = class extends NativePeer {
    constructor(...args) { super(...args); this.addEventListener('datachannel', event => watch(event.channel)); }
    createDataChannel(...args) { const channel = super.createDataChannel(...args); watch(channel); return channel; }
  };
}

async function newPage(options = {}) {
  const browser = await chromium.launch({ headless: true });
  browsers.push(browser);
  const context = await browser.newContext({ viewport: { width: 1365, height: 1050 }, ...options });
  contexts.push(context);
  await context.addInitScript(observeWire);
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', entry => { if (entry.type() === 'error') errors.push(entry.text()); });
  return page;
}
const latest = page => page.evaluate(() => window.__wire.filter(entry => entry.direction === 'in' && entry.data.type === 'STATE_UPDATE').at(-1)?.data.payload.view);
async function advance(page, revision) {
  await page.waitForFunction(revision => window.__wire.some(entry => entry.direction === 'in' && entry.data.type === 'STATE_UPDATE' && entry.data.payload.view.revision > revision), revision);
}
async function sendIntent(page, type, payload, revision, requestId) {
  await page.evaluate(({ type, payload, revision, requestId }) => {
    window.__channels.find(channel => channel.readyState === 'open').send(new TextEncoder().encode(JSON.stringify({ v: 1, type, payload, requestId: requestId ?? crypto.randomUUID(), baseRevision: revision })));
  }, { type, payload, revision, requestId });
}
async function noOverflow(page, label) {
  const size = await page.evaluate(() => ({ width: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert.ok(size.document <= size.width && size.body <= size.width, `${label}: horizontal page overflow ${JSON.stringify(size)}`);
}

try {
  const host = await newPage();
  const guest = await newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  await host.goto(base);
  await host.locator('.featured-game').waitFor();
  await host.screenshot({ path: `${output}/collection-desktop.png`, fullPage: true, animations: 'disabled' });
  await noOverflow(host, 'Desktop collection');
  await host.getByRole('button', { name: 'PLAY PLAN' }).click();
  await host.locator('#your-name').fill('Greg');
  await host.getByRole('button', { name: 'CREATE GAME', exact: true }).click();
  await host.locator('#room-code').waitFor({ timeout: 55000 });
  const code = await host.locator('#room-code').textContent();
  const link = await host.locator('#invite-link').inputValue();
  assert.equal(new URL(link).searchParams.get('room'), code);
  assert.equal(new URL(link).pathname, new URL(base).pathname);
  assert.ok(await host.getByRole('button', { name: 'START GAME' }).isDisabled());
  checked('Create room through public PeerJS Cloud, room code and path-relative invite URL');

  // Clipboard denial must leave a selectable real link.
  await host.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('Denied for test')) } }));
  await host.getByRole('button', { name: 'COPY INVITE LINK' }).click();
  await host.waitForFunction(() => document.activeElement?.id === 'invite-link');
  assert.equal(await host.locator('#invite-link').inputValue(), link);
  checked('Clipboard fallback selects the invite link');

  await guest.goto(link);
  assert.equal(await guest.locator('#room-code-input').inputValue(), code);
  await guest.locator('#your-name').fill('<b>Anna</b>');
  await guest.getByRole('button', { name: 'JOIN GAME', exact: true }).tap();
  await guest.locator('.lobby-list li').nth(1).waitFor({ timeout: 55000 });
  assert.equal(await guest.locator('.lobby-list li strong b').count(), 0);
  assert.ok((await host.locator('.lobby-list').innerText()).includes('<b>Anna</b>'));
  assert.ok(await host.getByRole('button', { name: 'START GAME' }).isDisabled());
  await guest.getByRole('button', { name: 'READY', exact: true }).tap();
  await host.waitForFunction(() => !document.querySelector('[data-action="start"]').disabled);
  await guest.screenshot({ path: `${output}/lobby-mobile.png`, fullPage: true, animations: 'disabled' });
  await host.getByRole('button', { name: 'START GAME' }).click();
  await guest.locator('.game-layout').waitFor();
  let view = await latest(guest);
  const initialRevision = view.revision;
  assert.equal(view.phase, 'bidding');
  const transport = await guest.evaluate(() => window.__channels.map(channel => ({ ordered: channel.ordered, retries: channel.maxRetransmits, lifetime: channel.maxPacketLifeTime })));
  assert.ok(transport.every(c => c.ordered && c.retries === null && c.lifetime === null));
  checked('Independent browsers join, render names as text, toggle ready and start over ordered reliable WebRTC');

  const hostHand = await host.locator('.my-cards [data-card-id]').evaluateAll(nodes => nodes.map(node => node.dataset.cardId));
  for (const id of hostHand) assert.ok(!JSON.stringify(view).includes(`"${id}"`));
  checked('Actual guest DataChannel payload contains no host hand');

  for (const width of [320, 390, 768]) {
    await guest.setViewportSize({ width, height: 1000 });
    await noOverflow(guest, `Bidding at ${width}px`);
  }
  await guest.setViewportSize({ width: 320, height: 800 });
  await guest.screenshot({ path: `${output}/bidding-320.png`, fullPage: true, animations: 'disabled' });
  await host.screenshot({ path: `${output}/table-desktop.png`, fullPage: true, animations: 'disabled' });
  checked('No page overflow at 320, 390, 768 and desktop widths');

  let rejectedFollowSuit = false;
  let finalBidChecked = false;
  let blindChecked = false;
  const seenHands = new Set();
  const openingBidders = new Map();
  for (let iteration = 0; iteration < 500; iteration++) {
    view = await latest(guest);
    seenHands.add(view.handNumber);
    const active = view.currentPlayerId === view.me.id ? guest : host;
    if (view.phase === 'bidding') {
      if (view.players.every(player => player.bid === null)) {
        if (!openingBidders.has(view.roundNumber)) openingBidders.set(view.roundNumber, new Set());
        openingBidders.get(view.roundNumber).add(view.currentPlayerId);
      }
      if (view.blind && !blindChecked) {
        const hostCard = view.opponents[0].visibleBlindCard;
        assert.ok(hostCard);
        const hostBlindView = await host.evaluate(() => window.__wire.filter(entry => entry.direction === 'out' && entry.data.type === 'STATE_UPDATE').at(-1).data.payload.view);
        assert.equal(hostBlindView.me.hand, null);
        assert.equal(view.me.hand, null);
        assert.equal(view.me.cardCount, 1);
        assert.equal(await guest.locator('.my-cards [data-card-id]').count(), 0);
        assert.equal(await host.locator('.my-cards [data-card-id]').count(), 0);
        assert.equal(await guest.locator('.opponent-blind .playing-card').count(), 1);
        const ownCard = await host.locator('.opponent-blind .playing-card').getAttribute('aria-label');
        const [rank, suit] = ownCard.split(' of ');
        const ownId = ({ Ace: 'A', King: 'K', Queen: 'Q', Jack: 'J' }[rank] ?? rank) + ({ Clubs: 'C', Diamonds: 'D', Hearts: 'H', Spades: 'S' }[suit]);
        assert.ok(!JSON.stringify(view).includes(`"${ownId}"`));
        const guestDOM = await guest.locator('.my-cards').evaluate(node => node.outerHTML);
        assert.ok(!guestDOM.includes(ownCard));
        await guest.screenshot({ path: `${output}/blind-mobile.png`, fullPage: true, animations: 'disabled' });
        blindChecked = true;
        checked('Blind finale shows opponent cards, excludes own card from hand payload and DOM');
      }
      const unavailable = active.locator('.bid-options button:disabled');
      if (await unavailable.count()) {
        const bid = Number(await unavailable.first().getAttribute('data-bid'));
        if (active === guest && !finalBidChecked) {
          await sendIntent(guest, 'PLACE_BID', { bid }, view.revision);
          await guest.waitForFunction(() => window.__wire.some(entry => entry.data.type === 'ERROR' && entry.data.payload.message.includes('total bids')));
          assert.equal((await latest(guest)).revision, view.revision);
        }
        finalBidChecked = true;
      }
      await active.locator('.bid-options button:not(:disabled)').first().click();
      await advance(guest, view.revision);
    } else if (view.phase === 'playing') {
      if (view.blind) await active.getByRole('button', { name: 'PLAY MY CARD', exact: true }).click();
      else {
        const forbidden = active.locator('.my-cards [data-card-id]:disabled');
        if (active === guest && await forbidden.count() && !rejectedFollowSuit) {
          const cardId = await forbidden.first().getAttribute('data-card-id');
          await sendIntent(guest, 'PLAY_CARD', { cardId }, view.revision);
          await guest.waitForFunction(() => window.__wire.some(entry => entry.data.type === 'ERROR' && entry.data.payload.message.includes('follow')));
          assert.equal((await latest(guest)).revision, view.revision);
          rejectedFollowSuit = true;
          checked('Forged illegal follow-suit intent is rejected by the actual host');
        }
        let playable = active.locator('.my-cards [data-card-id]:not(:disabled)').first();
        // Prefer a lead that exercises guest follow-suit validation, without changing the deal.
        if (active === host && view.trick.length === 0 && !rejectedFollowSuit) {
          const candidate = (await active.locator('.my-cards [data-card-id]:not(:disabled)').evaluateAll(nodes => nodes.map(node => node.dataset.cardId)))
            .find(id => view.me.hand.some(c => c.suit === id.at(-1)) && view.me.hand.some(c => c.suit !== id.at(-1)));
          if (candidate) playable = active.locator(`[data-card-id="${candidate}"]`);
        }
        await playable.click();
      }
      await advance(guest, view.revision);
    } else if (view.phase === 'trick_result') await advance(guest, view.revision);
    else if (view.phase === 'hand_result') {
      assert.equal(view.players.reduce((sum, p) => sum + p.tricksWon, 0), view.handSize);
      await host.getByRole('button', { name: 'NEXT HAND', exact: true }).click();
      await advance(guest, view.revision);
    } else if (view.phase === 'game_result') break;
    else throw new Error(`Unexpected phase: ${view.phase}`);
  }
  view = await latest(guest);
  assert.equal(view.phase, 'game_result');
  assert.deepEqual([...seenHands], Array.from({ length: 12 }, (_, i) => i + 1));
  assert.equal(openingBidders.size, 6);
  assert.ok([...openingBidders.values()].every(bidders => bidders.size === 2));
  assert.equal(blindChecked, true);
  assert.equal(finalBidChecked, true);
  assert.ok(view.players.every(p => p.history.length === 12 && p.history.reduce((sum, h) => sum + h.score, 0) === p.totalScore));
  const bestScore = Math.max(...view.players.map(player => player.totalScore));
  const guestWon = view.players.find(player => player.id === view.me.id).totalScore === bestScore;
  const hostWon = view.players.find(player => player.id !== view.me.id).totalScore === bestScore;
  for (const [page, won] of [[host, hostWon], [guest, guestWon]]) {
    const sounds = await page.evaluate(() => window.__audioPlays);
    const cards = sounds.filter(sound => Math.abs(sound.duration - .19) < .001);
    assert.equal(cards.length, 64, 'One sound per accepted card, including blind plays; no rerender duplicates.');
    assert.equal(cards.filter(sound => Math.abs(sound.volume - .72) < .001).length, 32);
    assert.equal(cards.filter(sound => Math.abs(sound.volume - .48) < .001).length, 32);
    assert.equal(sounds.filter(sound => Math.abs(sound.duration - 2.35) < .001).length, won ? 1 : 0);
    assert.equal(await page.locator('.celebration.playing').count(), 1);
  }
  checked('Each accepted card sounds once; own cards are louder and only winners hear triumph during the shared animation');
  await guest.screenshot({ path: `${output}/results-mobile.png`, fullPage: true, animations: 'disabled' });
  checked('Complete six-round / twelve-hand game, every bidding opener, trump, scores and final standings');
  if (!rejectedFollowSuit) console.log('NOTE This random deal did not offer a guest off-suit attempt; core tests cover it deterministically.');

  await guest.getByRole('button', { name: 'SCOREBOARD' }).click();
  assert.equal(await guest.locator('dialog .score-table').count(), 1);
  await noOverflow(guest, 'Scoreboard dialog at 320px');
  await guest.getByRole('button', { name: 'Close dialog' }).click();
  await host.getByRole('button', { name: 'PLAY AGAIN' }).click();
  await advance(guest, view.revision);
  view = await latest(guest);
  assert.equal(view.handNumber, 1);
  assert.ok(view.players.every(p => p.totalScore === 0 && p.history.length === 0));
  assert.equal(await host.locator('.celebration').isHidden(), true);
  assert.equal(await guest.locator('.celebration').isHidden(), true);
  assert.equal(new URL(await host.url()).searchParams.get('room'), code);
  assert.ok(view.revision > initialRevision);
  checked('Scoreboard and rematch preserve the room and reset all scores');

  await guest.getByRole('button', { name: 'LEAVE GAME', exact: true }).click();
  await guest.getByRole('button', { name: 'STAY AT THE TABLE' }).click();
  assert.equal(await guest.locator('.game-layout').count(), 1);
  await guest.getByRole('button', { name: 'LEAVE GAME', exact: true }).click();
  await guest.locator('dialog').getByRole('button', { name: 'LEAVE GAME', exact: true }).click();
  await host.getByRole('button', { name: 'RETURN TO LOBBY' }).waitFor();
  await host.getByRole('button', { name: 'RETURN TO LOBBY' }).click();
  assert.equal(await host.locator('.lobby-list li').count(), 1);
  checked('Confirmed guest departure pauses the game and returns host to a clean lobby');

  await guest.goto(link);
  await guest.locator('#your-name').fill('Anna');
  await guest.getByRole('button', { name: 'JOIN GAME', exact: true }).click();
  await guest.locator('.lobby-list li').nth(1).waitFor({ timeout: 45000 });
  await host.getByRole('button', { name: 'LEAVE GAME' }).click();
  await guest.getByText('HOST DISCONNECTED', { exact: true }).waitFor();
  checked('Host departure ends the room and gives guests a return-home action');

  assert.deepEqual(errors, []);
  checked('No browser console errors or unhandled exceptions during the multiplayer game');
  console.log(`Browser smoke test: ${checks} checks passed.`);
} finally {
  await Promise.all(contexts.map(context => context.close().catch(() => {})));
  await Promise.all(browsers.map(browser => browser.close().catch(() => {})));
}
