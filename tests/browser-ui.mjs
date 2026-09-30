/** Optional responsive/UI checks. Fixtures use the real game reducer and renderer. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const { chromium } = process.env.PLAYWRIGHT_MODULE ? await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE)) : await import('playwright');
const base = process.env.PLAN_URL ?? 'http://127.0.0.1:8080/';
const output = process.env.SCREENSHOT_DIR ?? 'test-results';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
let checks = 0;
const pass = text => { console.log(`PASS ${text}`); checks++; };

try {
  const context = await browser.newContext({ viewport: { width: 320, height: 800 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const exceptions = [];
  page.on('pageerror', error => exceptions.push(error.message));
  await page.goto(base);
  await page.locator('.featured-game').waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: `${output}/collection-320.png`, fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'PLAY PLAN' }).click();
  await page.getByRole('button', { name: 'HOW TO PLAY', exact: true }).click();
  assert.ok(await page.locator('dialog').isVisible());
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.locator('dialog').getByRole('button', { name: 'Close dialog' }).click();
  pass('Collection, entry form and complete rules fit a 320px viewport');

  await page.evaluate(async () => {
    const core = await import('./games/plan/game-core.mjs');
    const { renderPlan, renderScoreboard } = await import('./games/plan/ui.mjs');
    const { renderLobby, renderHeader } = await import('./shared/screens.mjs');
    const { ChatPanel } = await import('./shared/chat-ui.mjs');
    const { el } = await import('./shared/dom.mjs');
    const names = ['Alexandra Wilson', 'Greg', 'Anna', 'Mark', 'John', 'Charlotte Brown'];
    let state = core.createLobby('p0', names[0]);
    for (let i = 1; i < 6; i++) {
      state = core.addPlayer(state, `p${i}`, names[i]);
      state = core.applyAction(state, `p${i}`, 'SET_READY', { ready: true });
    }
    const fixtures = { lobby: structuredClone(state) };
    state = core.applyAction(state, 'p0', 'START_GAME', {}, max => max - 1);
    fixtures.bidding = structuredClone(state);
    for (let i = 0; i < 1200; i++) {
      if (state.phase === 'bidding') {
        if (state.blind && !fixtures.blind) fixtures.blind = structuredClone(state);
        const forbidden = core.getForbiddenFinalBid(state.players.map(p => p.bid), state.handSize);
        state = core.applyAction(state, state.currentPlayerId, 'PLACE_BID', { bid: forbidden === 0 ? 1 : 0 });
      } else if (state.phase === 'playing') {
        fixtures.playing ??= structuredClone(state);
        const player = state.players.find(p => p.id === state.currentPlayerId);
        const cardId = core.getLegalCards(player.hand, state.trick[0]?.card.suit)[0].id;
        state = core.applyAction(state, player.id, state.blind ? 'PLAY_BLIND_CARD' : 'PLAY_CARD', state.blind ? {} : { cardId });
      } else if (state.phase === 'trick_result') {
        fixtures.trick_result ??= structuredClone(state);
        state = core.resolveTrick(state);
      } else if (state.phase === 'hand_result') {
        fixtures.hand_result ??= structuredClone(state);
        state = core.applyAction(state, 'p0', 'NEXT_HAND');
      } else if (state.phase === 'game_result') { fixtures.game_result = state; break; }
    }
    const chat = new ChatPanel(() => {});
    chat.setConnected(true, 'p0');
    window.__testChat = chat;
    const content = el('div', { class: 'room-content' });
    document.querySelector('#main').classList.add('with-chat');
    document.querySelector('#main').replaceChildren(el('div', { class: 'room-layout' }, content, chat.element));
    window.__renderFixture = (phase, playerId = 'p0') => {
      const view = core.buildViewForPlayer(fixtures[phase], playerId);
      document.querySelector('#site-header').replaceChildren(renderHeader({ game: { title: 'PLAN' }, room: {}, view, status: 'Connected' }));
      content.replaceChildren(phase === 'lobby' ? renderLobby(view, 'K7PX4M9Q', 'https://example.github.io/multiplayer/?room=K7PX4M9Q&game=plan', false) : renderPlan(view));
    };
    window.__renderScores = (count = 6) => {
      let scoreState = fixtures.game_result;
      if (count !== 6) {
        scoreState = core.createLobby('p0', names[0]);
        for (let i = 1; i < count; i++) {
          scoreState = core.addPlayer(scoreState, `p${i}`, names[i]);
          scoreState = core.applyAction(scoreState, `p${i}`, 'SET_READY', { ready: true });
        }
        scoreState = core.applyAction(scoreState, 'p0', 'START_GAME');
      }
      document.querySelector('#modal-title').textContent = 'Scoreboard';
      document.querySelector('#modal-body').replaceChildren(renderScoreboard(core.buildViewForPlayer(scoreState, 'p0')));
      document.querySelector('#modal').showModal();
    };
  });

  for (const width of [320, 360, 390, 560, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1050 });
    for (const phase of ['lobby', 'bidding', 'playing', 'trick_result', 'hand_result', 'blind', 'game_result']) {
      await page.evaluate(phase => window.__renderFixture(phase), phase);
      const dimensions = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, body: document.body.scrollWidth, viewport: innerWidth }));
      assert.ok(dimensions.document <= width && dimensions.body <= width, `${phase} at ${width}: ${JSON.stringify(dimensions)}`);
      const undersized = await page.locator('button:not(:disabled)').evaluateAll(nodes => nodes.filter(node => {
        const bounds = node.getBoundingClientRect();
        return bounds.width > 0 && (bounds.width < 43.5 || bounds.height < 43.5);
      }).map(node => node.getAttribute('aria-label') ?? node.textContent));
      assert.deepEqual(undersized, [], `Touch targets too small in ${phase} at ${width}`);
      if ([320, 768, 1440].includes(width) && ['bidding', 'blind', 'game_result'].includes(phase)) {
        await page.screenshot({ path: `${output}/six-players-${phase}-${width}.png`, fullPage: true, animations: 'disabled' });
      }
    }
  }
  pass('Six-player lobby, every game phase and room chat fit 8 widths from 320px to 1920px, with 44px touch targets');
  await page.evaluate(() => {
    const chat = window.__testChat;
    // Exercise the DOM sink directly, even bypassing the host's markup rejection.
    chat.update({ revision: 3, messages: [
      { id: 1, playerId: 'p1', name: '<svg/onload=1>', text: '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>', timestamp: Date.now() },
      { id: 2, playerId: 'p1', name: 'Anna', text: '&lt;svg onload=alert(1)&gt; https://example.com\njavascript:alert(1)', timestamp: Date.now() },
      { id: 3, playerId: 'p0', name: 'Greg', text: 'Two\nlines', timestamp: Date.now() },
    ] });
  });
  assert.equal(await page.locator('.chat-messages script, .chat-messages img, .chat-messages svg, .chat-messages a, .chat-messages iframe').count(), 0);
  assert.equal(await page.evaluate(() => window.__xss), undefined);
  assert.ok((await page.locator('.chat-messages').innerText()).includes('<img src=x'));
  assert.equal(await page.locator('.chat-text').last().textContent(), 'Two\nlines');
  pass('Chat DOM treats HTML, script, entities, nicknames and URLs as inert text without clickable links');
  await page.setViewportSize({ width: 320, height: 800 });
  await page.evaluate(() => {
    const chat = window.__testChat;
    chat.reset(); chat.setConnected(true, 'p0');
    window.__chatHistory = Array.from({ length: 25 }, (_, i) => ({ id: i + 1, playerId: 'p1', name: 'Anna', text: 'A long message '.repeat(30), timestamp: Date.now() }));
    chat.update({ revision: 25, messages: window.__chatHistory });
    chat.log.scrollTop = 0;
  });
  await page.locator('#chat-input').fill('Keep this draft');
  await page.evaluate(() => {
    window.__renderFixture('playing');
    const last = { id: 26, playerId: 'p1', name: 'Anna', text: 'One more message', timestamp: Date.now() };
    window.__testChat.update({ revision: 26, messages: [...window.__chatHistory.slice(1), last] });
  });
  assert.equal(await page.locator('#chat-input').inputValue(), 'Keep this draft');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'chat-input');
  await page.getByRole('button', { name: '1 new message ↓', exact: true }).waitFor();
  assert.equal(await page.locator('.chat-message').count(), 25);
  await page.getByRole('button', { name: '1 new message ↓', exact: true }).click();
  assert.ok(await page.locator('.chat-messages').evaluate(log => log.scrollHeight - log.scrollTop - log.clientHeight < 2));
  assert.equal(await page.locator('.current-player').evaluate(node => getComputedStyle(node).animationName), 'none');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: `${output}/chat-mobile.png`, fullPage: true, animations: 'disabled' });
  pass('Chat preserves drafts/focus and older-message scroll, bounds history and respects reduced-motion turn indicators');
  await page.setViewportSize({ width: 320, height: 800 });
  for (const count of [2, 3, 4, 5, 6]) {
    await page.evaluate(count => window.__renderScores(count), count);
    assert.ok(await page.locator('dialog .score-scroll').evaluate(node => node.scrollWidth > node.clientWidth));
    assert.ok(await page.locator('dialog .score-table tbody tr').first().evaluate(row => {
      const name = row.querySelector('th').getBoundingClientRect();
      const firstDeal = row.querySelector('td').getBoundingClientRect();
      const total = row.querySelector('.total-score').getBoundingClientRect();
      return firstDeal.left >= name.right - 1 && firstDeal.right <= total.left + 1;
    }), `Sticky columns must leave a full deal visible for ${count} players on a 320px phone.`);
  }
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  pass('The scoreboard scrolls locally without scrolling the page horizontally');
  assert.deepEqual(exceptions, []);
  pass('No renderer exceptions with six players, long names or reduced motion');
  await context.close();

  const unavailable = await browser.newContext();
  const offlinePage = await unavailable.newPage();
  await offlinePage.route('https://cdn.jsdelivr.net/npm/peerjs@1.5.5/**', route => route.abort('failed'));
  await offlinePage.goto(`${base}?game=plan`);
  await offlinePage.locator('#your-name').fill('Greg');
  await offlinePage.getByRole('button', { name: 'CREATE GAME', exact: true }).click();
  await offlinePage.getByText('MULTIPLAYER SERVICE UNAVAILABLE', { exact: true }).waitFor();
  assert.ok(await offlinePage.getByRole('button', { name: 'RELOAD', exact: true }).isVisible());
  assert.ok((await offlinePage.locator('main').innerText()).includes("We couldn't load the connection library."));
  pass('A blocked CDN produces a readable service-unavailable screen and reload action');
  await unavailable.close();

  const missing = await browser.newContext();
  const missingPage = await missing.newPage();
  await missingPage.goto(`${base}?room=ZZZZZZZZ&game=plan`);
  await missingPage.locator('#your-name').fill('Greg');
  await missingPage.getByRole('button', { name: 'JOIN GAME', exact: true }).click();
  await missingPage.getByText('Room not found. Check the code and try again.', { exact: true }).waitFor({ timeout: 50000 });
  assert.ok(await missingPage.getByRole('button', { name: 'TRY AGAIN', exact: true }).isVisible());
  pass('An absent room produces Room not found and a working retry entry point');
  await missing.close();
  console.log(`Browser UI test: ${checks} checks passed.`);
} finally {
  await browser.close();
}
