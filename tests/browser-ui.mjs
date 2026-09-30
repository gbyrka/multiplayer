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
    window.__renderFixture = (phase, playerId = 'p0') => {
      const view = core.buildViewForPlayer(fixtures[phase], playerId);
      document.querySelector('#site-header').replaceChildren(renderHeader({ game: { title: 'PLAN' }, room: {}, view, status: 'Connected' }));
      document.querySelector('#main').replaceChildren(phase === 'lobby' ? renderLobby(view, 'K7PX4M9Q', 'https://example.github.io/multiplayer/?room=K7PX4M9Q&game=plan', false) : renderPlan(view));
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
  pass('Six-player lobby and every game phase fit 8 widths from 320px to 1920px, with 44px touch targets');
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
