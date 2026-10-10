import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateMatch } from './catana-driver.mjs';
import { RESOURCES, DEVELOPMENT_COUNTS } from '../games/catana/constants.mjs';
import { buildViewForPlayer, totalScore, pieceCounts } from '../games/catana/game-core.mjs';
import { validateBoard } from '../games/catana/board.mjs';
import { isMessage, message } from '../shared/protocol.mjs';

test('complete 2, 3, and 4 player games reach real victory while preserving every component and privacy boundary', () => {
  const visited = new Set();
  for (const count of [2, 3, 4]) for (const seed of [22, 79, 219]) {
    let board, previous = -1;
    const { state, actions, phases } = simulateMatch(count, seed, current => {
      assert.ok(current.revision > previous); previous = current.revision;
      const layout = JSON.stringify(current.board); if (!board) board = layout; else assert.equal(layout, board, 'One immutable randomized board per match');
      assert.ok(validateBoard(current.board));
      for (const resource of RESOURCES) { assert.equal(current.bank[resource] + current.players.reduce((sum, player) => sum + player.resources[resource], 0), 19); assert.ok(current.bank[resource] >= 0); }
      const cards = [...current.developmentDeck, ...current.playedDevelopment, ...current.players.flatMap(player => player.development)];
      assert.equal(cards.length, 25); assert.equal(new Set(cards.map(card => card.id)).size, 25);
      for (const [type, quantity] of Object.entries(DEVELOPMENT_COUNTS)) assert.equal(cards.filter(card => card.type === type).length, quantity);
      for (const player of current.players) {
        for (const resource of RESOURCES) assert.ok(Number.isInteger(player.resources[resource]) && player.resources[resource] >= 0);
        const pieces = pieceCounts(current, player.id); assert.ok(pieces.road <= 15 && pieces.settlement <= 5 && pieces.city <= 4);
        if (current.revision % 13 === 0 || current.phase === 'game_result') {
          const view = buildViewForPlayer(current, player.id); assert.ok(isMessage(message('STATE_UPDATE', { view })));
          for (const opponent of view.players) assert.equal(Object.hasOwn(opponent, 'resources'), false);
          for (const opponent of current.players.filter(other => other.id !== player.id)) for (const card of opponent.development) assert.ok(!view.me.development.some(own => own.id === card.id));
        }
      }
    });
    assert.equal(state.phase, 'game_result', `Game with ${count} players/seed ${seed} stalled after ${actions} actions, turn ${state.turnNumber}`);
    assert.ok(totalScore(state, state.winnerId) >= (count === 2 ? 12 : 10)); assert.equal(state.winnerId, state.currentPlayerId);
    for (const phase of phases) visited.add(phase);
  }
  for (const phase of ['setup_settlement', 'setup_road', 'roll', 'main', 'discard', 'robber', 'steal', 'year_of_plenty', 'monopoly', 'road_building']) assert.ok(visited.has(phase), `Full matches exercised ${phase}`);
});
