import test from 'node:test';
import assert from 'node:assert/strict';
import { isMessage } from '../shared/protocol.mjs';
import {
  createDeck, shuffleDeck, dealHand, createLobby, addPlayer, removePlayer, canStart,
  applyAction, getLegalCards, isLegalPlay, getTrickWinner, getForbiddenFinalBid,
  calculateHandScore, advanceDealer, getNextPlayer, resolveTrick, buildViewForPlayer, getStandings, getHandDetails,
} from '../games/plan/game-core.mjs';

const card = id => createDeck().find(item => item.id === id);
const trick = (...ids) => ids.map((id, i) => ({ playerId: `p${i}`, card: card(id) }));
const deterministic = max => max - 1;

function lobby(count = 3) {
  let state = createLobby('p0', 'Host');
  for (let i = 1; i < count; i++) {
    state = addPlayer(state, `p${i}`, `Guest ${i}`);
    state = applyAction(state, `p${i}`, 'SET_READY', { ready: true });
  }
  return state;
}
function start(count = 3) { return applyAction(lobby(count), 'p0', 'START_GAME', {}, deterministic); }
function finishBidding(state, chooseBid = legalBids => legalBids[0]) {
  while (state.phase === 'bidding') {
    const forbidden = getForbiddenFinalBid(state.players.map(p => p.bid), state.handSize);
    const legalBids = Array.from({ length: state.handSize + 1 }, (_, bid) => bid).filter(bid => bid !== forbidden);
    state = applyAction(state, state.currentPlayerId, 'PLACE_BID', { bid: chooseBid(legalBids) });
  }
  return state;
}
function finishHand(state) {
  state = finishBidding(state);
  while (['playing', 'trick_result'].includes(state.phase)) {
    if (state.phase === 'trick_result') { state = resolveTrick(state); continue; }
    const player = state.players.find(p => p.id === state.currentPlayerId);
    const cardId = getLegalCards(player.hand, state.trick[0]?.card.suit)[0].id;
    state = applyAction(state, player.id, state.blind ? 'PLAY_BLIND_CARD' : 'PLAY_CARD', state.blind ? {} : { cardId });
  }
  return state;
}

function firstBlindHand(count) {
  let state = start(count);
  for (let hand = 1; hand <= count * 5; hand++) {
    state = applyAction(finishHand(state), 'p0', 'NEXT_HAND', {}, deterministic);
  }
  return state;
}

test('deck has 52 unique cards, four suits and ranks 2 through Ace', () => {
  const deck = createDeck();
  assert.equal(deck.length, 52);
  assert.equal(new Set(deck.map(c => c.id)).size, 52);
  for (const suit of 'CDHS') assert.deepEqual(deck.filter(c => c.suit === suit).map(c => c.value), Array.from({ length: 13 }, (_, i) => i + 2));
});

test('Fisher–Yates shuffle preserves every card and does not mutate its input', () => {
  const deck = createDeck();
  const original = structuredClone(deck);
  const result = shuffleDeck(deck, () => 0);
  assert.deepEqual(new Set(result.map(c => c.id)), new Set(deck.map(c => c.id)));
  assert.deepEqual(deck, original);
  assert.notDeepEqual(result, deck);
  result[0].rank = 'changed';
  assert.deepEqual(deck, original);
});

test('dealing is clockwise after the dealer and the next unused card is trump', () => {
  const deck = createDeck();
  const { hands, trumpCard } = dealHand(deck, 4, 5, 2);
  assert.ok(hands.every(hand => hand.length === 5));
  assert.ok(hands[3].some(c => c.id === deck[0].id));
  assert.equal(trumpCard.id, deck[20].id);
  assert.equal(new Set(hands.flat().map(c => c.id)).size, 20);
  assert.ok(!hands.flat().some(c => c.id === trumpCard.id));
});

test('Ace beats King in the same suit', () => assert.equal(getTrickWinner(trick('KS', 'AS'), 'H'), 'p1'));
test('even a low trump beats the highest lead-suit card', () => assert.equal(getTrickWinner(trick('AC', '2H', 'KC'), 'H'), 'p1'));
test('off-suit non-trump cannot win and the highest trump wins', () => {
  assert.equal(getTrickWinner(trick('2C', 'AS', 'KD'), 'H'), 'p0');
  assert.equal(getTrickWinner(trick('AC', '2H', 'KH', '3H'), 'H'), 'p2');
});
test('follow suit is mandatory only when that suit is in the hand', () => {
  const hand = ['2C', 'AH', 'AS', 'KC'].map(card);
  assert.deepEqual(getLegalCards(hand, 'C').map(c => c.id), ['2C', 'KC']);
  assert.equal(isLegalPlay(hand, 'AH', 'C'), false);
  assert.equal(isLegalPlay(hand, 'AH', 'D'), true);
  assert.equal(isLegalPlay(hand, '2H', 'D'), false);
  assert.equal(getLegalCards(hand).length, 4);
});
test('only the final bidder has a restriction, and only inside the legal range', () => {
  assert.equal(getForbiddenFinalBid([1, 1, 0, null], 4), 2);
  assert.equal(getForbiddenFinalBid([1, null, null], 4), null);
  assert.equal(getForbiddenFinalBid([4, 4, null], 4), null);
  assert.equal(getForbiddenFinalBid([0, null], 1), 1);
  assert.equal(getForbiddenFinalBid([1, null], 1), 0);
  assert.equal(getForbiddenFinalBid([0, 0], 1), null);
});
test('exact prediction scores 10 plus the bid, including zero', () => {
  for (let bid = 0; bid <= 5; bid++) assert.equal(calculateHandScore(bid, bid), 10 + bid);
});
test('a missed prediction loses the absolute difference', () => {
  assert.equal(calculateHandScore(3, 2), -1);
  assert.equal(calculateHandScore(0, 2), -2);
  assert.equal(calculateHandScore(4, 1), -3);
});
test('dealer and turn rotation wrap clockwise', () => {
  assert.equal(advanceDealer(2, 4), 3);
  assert.equal(advanceDealer(3, 4), 0);
  assert.equal(getNextPlayer(lobby(3).players, 'p2').id, 'p0');
});
test('the first dealer is sampled and the next player bids first', () => {
  const state = start(4);
  assert.equal(state.dealerIndex, 3);
  assert.equal(state.currentPlayerId, 'p0');
});
test('the highest bidder leads the first trick and other players must wait', () => {
  let state = start(4);
  for (const [id, bid] of [['p0', 0], ['p1', 2], ['p2', 1], ['p3', 0]]) {
    state = applyAction(state, id, 'PLACE_BID', { bid });
  }
  assert.equal(state.phase, 'playing');
  assert.equal(state.currentPlayerId, 'p1');
  for (const player of state.players) {
    const view = buildViewForPlayer(state, player.id);
    assert.equal(view.currentPlayerId, 'p1');
    assert.equal(view.me.legalCardIds.length, player.id === 'p1' ? 5 : 0);
  }
  assert.throws(() => applyAction(state, 'p0', 'PLAY_CARD', { cardId: state.players[0].hand[0].id }), /turn/);
  state = applyAction(state, 'p1', 'PLAY_CARD', { cardId: state.players[1].hand[0].id });
  assert.equal(state.currentPlayerId, 'p2');
});
test('the dealer can win the bidding and lead despite bidding last', () => {
  let state = start(3);
  for (const [id, bid] of [['p0', 0], ['p1', 0], ['p2', 2]]) {
    state = applyAction(state, id, 'PLACE_BID', { bid });
  }
  assert.equal(state.currentPlayerId, 'p2');
  state = applyAction(state, 'p2', 'PLAY_CARD', { cardId: state.players[2].hand[0].id });
  assert.equal(state.currentPlayerId, 'p0');
});
test('tied highest bids follow bidding order across the seat-array boundary', () => {
  let state = applyAction(lobby(4), 'p0', 'START_GAME', {}, () => 0);
  assert.equal(state.dealerIndex, 0);
  for (const [id, bid] of [['p1', 0], ['p2', 3], ['p3', 0], ['p0', 3]]) {
    state = applyAction(state, id, 'PLACE_BID', { bid });
  }
  assert.equal(state.currentPlayerId, 'p2');
});
test('if all bids are zero, the first bidder leads for every dealer position', () => {
  for (let dealer = 0; dealer < 4; dealer++) {
    const state = applyAction(lobby(4), 'p0', 'START_GAME', {}, max => dealer % max);
    assert.equal(finishBidding(state).currentPlayerId, `p${(dealer + 1) % 4}`);
  }
});
test('the blind hand also starts with the bidding winner, with ties in bidding order', () => {
  let state = firstBlindHand(3);
  assert.equal(state.blind, true);
  assert.equal(state.currentPlayerId, 'p0');
  for (const [id, bid] of [['p0', 0], ['p1', 1], ['p2', 1]]) {
    state = applyAction(state, id, 'PLACE_BID', { bid });
  }
  assert.equal(state.currentPlayerId, 'p1');
  assert.equal(buildViewForPlayer(state, 'p1').me.hand, null);
  assert.throws(() => applyAction(state, 'p0', 'PLAY_BLIND_CARD'), /turn/);
  state = applyAction(state, 'p1', 'PLAY_BLIND_CARD');
  assert.equal(state.trick[0].playerId, 'p1');
  assert.equal(state.currentPlayerId, 'p2');
});
test('start requires 2–6 players and all guests ready; join order is stable', () => {
  const one = createLobby('p0', 'Host');
  assert.equal(canStart(one), false);
  let two = addPlayer(one, 'p1', 'Guest');
  assert.equal(canStart(two), false);
  two = applyAction(two, 'p1', 'SET_READY', { ready: true });
  assert.equal(canStart(two), true);
  assert.deepEqual(lobby(6).players.map(p => p.id), ['p0', 'p1', 'p2', 'p3', 'p4', 'p5']);
  assert.throws(() => addPlayer(lobby(6), 'p6', 'Too many'), /full/);
  assert.throws(() => addPlayer(start(), 'new', 'Late'), /already started/);
});
test('host validates phase, turn, integer, range, duplicate bids and final-bid rule', () => {
  let state = start(3);
  assert.throws(() => applyAction(state, 'p1', 'PLACE_BID', { bid: 0 }), /turn/);
  for (const bid of [-1, 6, 1.5, '2', NaN, Infinity]) assert.throws(() => applyAction(state, 'p0', 'PLACE_BID', { bid }));
  state = applyAction(state, 'p0', 'PLACE_BID', { bid: 2 });
  state = applyAction(state, 'p1', 'PLACE_BID', { bid: 1 });
  assert.throws(() => applyAction(state, 'p2', 'PLACE_BID', { bid: 2 }), /total bids/);
  state = applyAction(state, 'p2', 'PLACE_BID', { bid: 0 });
  assert.throws(() => applyAction(state, 'p0', 'PLACE_BID', { bid: 1 }), /not available/);
});
test('host validates ownership, turns, repeated cards and follow suit; illegal actions never mutate state', () => {
  let state = finishBidding(start(3));
  state.players[0].hand = ['2C', '3C'].map(card);
  state.players[1].hand = ['KC', 'AH'].map(card);
  state.players[2].hand = ['AC', '2H'].map(card);
  state = applyAction(state, 'p0', 'PLAY_CARD', { cardId: '2C' });
  const before = structuredClone(state);
  assert.throws(() => applyAction(state, 'p1', 'PLAY_CARD', { cardId: 'AH' }), /follow/);
  assert.throws(() => applyAction(state, 'p1', 'PLAY_CARD', { cardId: 'AS' }), /not in/);
  assert.throws(() => applyAction(state, 'p0', 'PLAY_CARD', { cardId: '2C' }), /turn/);
  assert.deepEqual(state, before);
});
test('the trick winner collects one trick and becomes the next leader', () => {
  let state = start(3);
  for (const [id, bid] of [['p0', 0], ['p1', 0], ['p2', 2]]) {
    state = applyAction(state, id, 'PLACE_BID', { bid });
  }
  assert.equal(state.currentPlayerId, 'p2');
  state.trumpSuit = 'H';
  state.players[0].hand = ['AC', '3C'].map(card);
  state.players[1].hand = ['2H', 'AH'].map(card);
  state.players[2].hand = ['KC', '2S'].map(card);
  for (const [player, cardId] of [['p2', 'KC'], ['p0', 'AC'], ['p1', '2H']]) state = applyAction(state, player, 'PLAY_CARD', { cardId });
  assert.equal(state.phase, 'trick_result');
  assert.equal(state.players[1].tricksWon, 1);
  assert.equal(state.trickWinnerId, 'p1');
  state = resolveTrick(state);
  assert.equal(state.phase, 'playing');
  assert.equal(state.currentPlayerId, 'p1');
  assert.equal(state.trick.length, 0);
});
test('normal network view has only the recipient’s hand, with no private opponent card anywhere', () => {
  const state = start(6);
  for (const player of state.players) {
    const view = buildViewForPlayer(state, player.id);
    assert.deepEqual(view.me.hand, player.hand);
    assert.equal(view.opponents.length, 0);
    assert.ok(view.players.every(p => !('hand' in p) && !('cards' in p)));
    const serialized = JSON.stringify(view);
    for (const opponent of state.players.filter(p => p.id !== player.id)) {
      for (const card of opponent.hand) assert.ok(!serialized.includes(`"${card.id}"`));
    }
    view.me.hand.length = 0;
    view.players[0].name = 'Changed';
    assert.equal(player.hand.length, 5);
    assert.equal(state.players[0].name, 'Host');
  }
});
test('blind view excludes the recipient’s own card in the entire payload, for host and guests', () => {
  let state = firstBlindHand(6);
  assert.equal(state.blind, true);
  for (const player of state.players) {
    const view = buildViewForPlayer(state, player.id);
    assert.equal(view.me.hand, null);
    assert.equal(view.me.blind, true);
    assert.equal(view.me.cardCount, 1);
    assert.deepEqual(view.me.legalCardIds, []);
    assert.ok(!JSON.stringify(view).includes(`"${player.hand[0].id}"`));
    assert.equal(view.opponents.length, 5);
    for (const opponent of view.opponents) {
      assert.equal(opponent.visibleBlindCard.id, state.players.find(p => p.id === opponent.playerId).hand[0].id);
    }
  }
  state = finishBidding(state);
  assert.throws(() => applyAction(state, state.currentPlayerId, 'PLAY_CARD', { cardId: state.players.find(p => p.id === state.currentPlayerId).hand[0].id }), /correct card action/);
  const actor = state.currentPlayerId;
  const revealed = state.players.find(p => p.id === actor).hand[0].id;
  state = applyAction(state, actor, 'PLAY_BLIND_CARD');
  assert.equal(buildViewForPlayer(state, actor).trick[0].card.id, revealed, 'A played card is now public.');
  assert.throws(() => applyAction(finishBidding(start()), 'p0', 'PLAY_BLIND_CARD'), /correct card action/);
});
test('only the host can start, continue, rematch or return to lobby', () => {
  assert.throws(() => applyAction(lobby(), 'p1', 'START_GAME'), /host/);
  const result = finishHand(start());
  assert.throws(() => applyAction(result, 'p1', 'NEXT_HAND'), /host/);
  assert.throws(() => applyAction(result, 'p1', 'PLAY_AGAIN'), /host/);
  assert.throws(() => applyAction(removePlayer(result, 'p2'), 'p1', 'RETURN_TO_LOBBY'), /host/);
});
test('lobby departures remove seats; active departures pause with idempotent close handling', () => {
  const initial = lobby();
  const reduced = removePlayer(initial, 'p1');
  assert.equal(reduced.players.length, 2);
  assert.equal(reduced.phase, 'lobby');
  let state = removePlayer(start(), 'p1');
  assert.equal(state.phase, 'disconnected');
  assert.equal(state.players.length, 3);
  assert.deepEqual(removePlayer(state, 'p1'), state);
  assert.throws(() => applyAction(state, 'p0', 'PLACE_BID', { bid: 0 }));
  state = applyAction(state, 'p0', 'RETURN_TO_LOBBY');
  assert.deepEqual(state.players.map(p => p.id), ['p0', 'p2']);
  assert.equal(state.players[1].ready, false);
  assert.ok(state.players.every(p => p.hand.length === 0 && p.totalScore === 0));
});
test('full six-round games give every player one opening per round, preserve privacy and support rematches', () => {
  for (let count = 2; count <= 6; count++) {
    for (let game = 0; game < 8; game++) {
      let state = applyAction(lobby(count), 'p0', 'START_GAME');
      const initialDealer = state.dealerIndex;
      let revision = state.revision;
      const total = count * 6;
      let firstBidders = new Set();
      for (let hand = 1; hand <= total; hand++) {
        assert.equal(state.handNumber, hand);
        assert.equal(state.totalHands, total);
        assert.equal(state.roundNumber, Math.floor((hand - 1) / count) + 1);
        assert.equal(state.dealInRound, (hand - 1) % count + 1);
        assert.equal(state.handSize, [5, 4, 3, 2, 1, 1][state.roundNumber - 1]);
        assert.equal(state.blind, state.roundNumber === 6);
        assert.equal(state.dealerIndex, (initialDealer + hand - 1) % count);
        firstBidders.add(state.currentPlayerId);
        if (state.dealInRound === count) {
          assert.equal(firstBidders.size, count);
          firstBidders = new Set();
        }
        const dealt = state.players.flatMap(p => p.hand.map(c => c.id));
        assert.equal(new Set(dealt).size, count * state.handSize);
        assert.ok(!dealt.includes(state.trumpCard.id));
        for (const player of state.players) {
          const view = buildViewForPlayer(state, player.id);
          const forbiddenCards = state.blind ? player.hand : state.players.filter(p => p.id !== player.id).flatMap(p => p.hand);
          for (const card of forbiddenCards) assert.ok(!JSON.stringify(view).includes(`"${card.id}"`));
          assert.equal(view.me.hand === null, state.blind);
          assert.equal(view.opponents.length, state.blind ? count - 1 : 0);
        }
        state = finishBidding(state, legalBids => legalBids[(game + hand) % legalBids.length]);
        assert.equal(state.players.find(p => p.id === state.currentPlayerId).bid, Math.max(...state.players.map(p => p.bid)));
        assert.notEqual(state.players.reduce((sum, p) => sum + p.bid, 0), state.handSize);
        state = finishHand(state);
        for (const player of state.players) assert.ok(isMessage({ v: 1, type: 'STATE_UPDATE', requestId: 'size-check', payload: { view: buildViewForPlayer(state, player.id) } }), 'The entire score history must fit the network envelope.');
        assert.equal(state.players.reduce((sum, p) => sum + p.tricksWon, 0), state.handSize);
        assert.ok(state.revision > revision);
        revision = state.revision;
        assert.ok(state.players.every(p => p.history.length === hand && p.totalScore === p.history.reduce((sum, h) => sum + h.score, 0)));
        assert.ok(state.players.every(p => p.history.at(-1).handNumber === hand && p.history.at(-1).roundNumber === state.roundNumber));
        assert.equal(state.phase, hand === total ? 'game_result' : 'hand_result');
        if (hand < total) state = applyAction(state, 'p0', 'NEXT_HAND');
      }
      const ids = state.players.map(p => p.id);
      state = applyAction(state, 'p0', 'PLAY_AGAIN', {}, () => 0);
      assert.equal(state.handNumber, 1);
      assert.equal(state.roundNumber, 1);
      assert.equal(state.dealInRound, 1);
      assert.equal(state.dealerIndex, 0);
      assert.deepEqual(state.players.map(p => p.id), ids);
      assert.ok(state.players.every(p => p.totalScore === 0 && p.history.length === 0 && p.hand.length === 5));
      assert.ok(state.revision > revision);
    }
  }
});
test('round boundaries keep the card count for one full dealer rotation, including all blind deals', () => {
  for (let count = 2; count <= 6; count++) {
    for (let round = 1; round <= 6; round++) {
      for (let deal = 1; deal <= count; deal++) {
        assert.deepEqual(getHandDetails((round - 1) * count + deal, count), {
          roundNumber: round, dealInRound: deal, totalHands: count * 6,
          handSize: [5, 4, 3, 2, 1, 1][round - 1], blind: round === 6,
        });
      }
    }
  }
  for (const [hand, count] of [[0, 2], [13, 2], [1.5, 3], [1, 1], [1, 7]]) assert.throws(() => getHandDetails(hand, count));
});
test('standings preserve equal scores without an artificial tie breaker', () => {
  const players = [{ id: 'a', totalScore: 10 }, { id: 'b', totalScore: 20 }, { id: 'c', totalScore: 20 }];
  assert.deepEqual(getStandings(players).filter(p => p.totalScore === 20).map(p => p.id), ['b', 'c']);
});
