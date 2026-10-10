import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { generateBoard, validateBoard, TOPOLOGY } from '../games/catana/board.mjs';
import { createLobby, addPlayer, removePlayer, applyAction, buildViewForPlayer, legalSettlements, legalRoads, legalCities, pieceCounts,
  produceResources, longestRoad, updateAwards, publicScore, totalScore, checkVictory, tradeRatios, robberDestinations, robberVictims } from '../games/catana/game-core.mjs';
import { RESOURCES, resourceBag, resourceCount, DEVELOPMENT_COUNTS, TERRAIN_RESOURCE, COSTS } from '../games/catana/constants.mjs';
import { isCatanaAction } from '../games/catana/action-schema.mjs';
import { message, isClientMessage, isMessage } from '../shared/protocol.mjs';
import { COLLECTION_GAMES, GAMES } from '../games/registry.mjs';

export function rng(seed = 12345) { return max => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) % max; }; }
const ids = ['host', 'second', 'third', 'fourth'];
export function match(count = 3, pick = rng()) {
  let state = createLobby(ids[0], 'Host');
  for (let i = 1; i < count; i++) { state = addPlayer(state, ids[i], `Player ${i + 1}`); state = applyAction(state, ids[i], 'SET_READY', { ready: true }); }
  return applyAction(state, 'host', 'START_GAME', {}, pick);
}
export const act = (state, action, payload = {}, actor = state.currentPlayerId, pick = rng()) => applyAction(state, actor, 'CATANA_ACTION', { action, ...payload }, pick);
function finishSetup(state, pick = rng()) {
  while (state.phase.startsWith('setup')) {
    const legal = state.phase === 'setup_settlement' ? legalSettlements(state, state.currentPlayerId, true) : legalRoads(state, state.currentPlayerId, state.setupVertex);
    state = act(state, state.phase === 'setup_settlement' ? 'BUILD_SETTLEMENT' : 'BUILD_ROAD', { [state.phase === 'setup_settlement' ? 'vertex' : 'edge']: legal[pick(legal.length)] }, state.currentPlayerId, pick);
  }
  return state;
}
function fixture(count = 3) {
  const state = finishSetup(match(count)); state.phase = 'main'; state.currentPlayerId = 'host';
  for (const player of state.players) player.resources = resourceBag(); state.bank = resourceBag(19); return state;
}
function grant(state, id, bag) { for (const [resource, count] of Object.entries(bag)) { state.players.find(player => player.id === id).resources[resource] += count; state.bank[resource] -= count; } }
function card(state, id, type, boughtTurn = 0) {
  const index = state.developmentDeck.findIndex(card => card.type === type); assert.ok(index >= 0);
  const value = { ...state.developmentDeck.splice(index, 1)[0], boughtTurn }; state.players.find(player => player.id === id).development.push(value); return value;
}
function emptyBoard(state) { state.buildings.fill(null); state.roads.fill(null); state.longestRoadOwner = null; return state; }
function chain(length, exclude = new Set()) {
  function walk(vertex, vertices, edges) {
    if (edges.length === length) return { vertices, edges };
    for (const edge of TOPOLOGY.vertices[vertex].edges) {
      if (exclude.has(edge) || edges.includes(edge)) continue;
      const next = TOPOLOGY.edges[edge].vertices.find(id => id !== vertex); if (vertices.includes(next)) continue;
      const found = walk(next, [...vertices, next], [...edges, edge]); if (found) return found;
    }
    return null;
  }
  for (const vertex of TOPOLOGY.vertices) { const found = walk(vertex.id, [vertex.id], []); if (found) return found; }
  throw new Error('No chain found.');
}
export function assertConservation(state) {
  for (const resource of RESOURCES) { assert.equal(state.bank[resource] + state.players.reduce((sum, player) => sum + player.resources[resource], 0), 19); assert.ok(state.bank[resource] >= 0); for (const player of state.players) assert.ok(Number.isInteger(player.resources[resource]) && player.resources[resource] >= 0); }
  const cards = [...state.developmentDeck, ...state.playedDevelopment, ...state.players.flatMap(player => player.development)];
  assert.equal(cards.length, 25); assert.equal(new Set(cards.map(card => card.id)).size, 25);
  for (const [type, count] of Object.entries(DEVELOPMENT_COUNTS)) assert.equal(cards.filter(card => card.type === type).length, count);
  for (const player of state.players) { const pieces = pieceCounts(state, player.id); assert.ok(pieces.road <= 15 && pieces.settlement <= 5 && pieces.city <= 4); }
}

test('canonical 19-hex graph has reciprocal 54 vertices, 72 edges, and a 30-edge coast', () => {
  assert.equal(TOPOLOGY.hexes.length, 19); assert.equal(TOPOLOGY.vertices.length, 54); assert.equal(TOPOLOGY.edges.length, 72); assert.equal(TOPOLOGY.coast.length, 30);
  for (const hex of TOPOLOGY.hexes) { assert.equal(hex.vertices.length, 6); assert.equal(hex.edges.length, 6); for (const neighbor of hex.neighbors) assert.ok(TOPOLOGY.hexes[neighbor].neighbors.includes(hex.id)); }
});
test('1,000 randomized layouts preserve all distributions, ports and every red-number exclusion', () => {
  const layouts = new Set();
  for (let seed = 1; seed <= 1000; seed++) { const board = generateBoard(rng(seed)); assert.equal(validateBoard(board), true); layouts.add(JSON.stringify(board)); }
  assert.equal(layouts.size, 1000); assert.equal(validateBoard(generateBoard(() => 0)), true);
  const board = generateBoard(rng()); board.hexes[0].number = 7; assert.equal(validateBoard(board), false);
  const invalid = generateBoard(rng()); invalid.harbors[1].edge = invalid.harbors[0].edge; assert.equal(validateBoard(invalid), false);
});
test('2–4 player setup is snake-ordered and only the second settlement grants starting resources', () => {
  for (const count of [2, 3, 4]) {
    let state = match(count), order = state.setupOrder.slice(0, count), expected = Object.fromEntries(ids.slice(0, count).map(id => [id, resourceBag()]));
    assert.deepEqual(state.setupOrder, [...order, ...order.toReversed()]); assert.equal(state.targetScore, count === 2 ? 12 : 10);
    for (let step = 0; step < count * 2; step++) {
      const actor = state.currentPlayerId, vertex = legalSettlements(state, actor, true)[0];
      if (step >= count) for (const hex of TOPOLOGY.vertices[vertex].hexes) { const resource = TERRAIN_RESOURCE[state.board.hexes[hex].terrain]; if (resource) expected[actor][resource]++; }
      state = act(state, 'BUILD_SETTLEMENT', { vertex }); assert.equal(state.phase, 'setup_road');
      const edge = legalRoads(state, actor, vertex)[0]; state = act(state, 'BUILD_ROAD', { edge });
      assert.deepEqual(state.players.find(player => player.id === actor).resources, expected[actor]);
      assertConservation(state);
    }
    assert.equal(state.phase, 'roll'); assert.equal(state.currentPlayerId, order[0]); assert.equal(state.turnNumber, 1);
    for (const player of state.players) assert.deepEqual(pieceCounts(state, player.id), { road: 2, settlement: 2, city: 0 });
  }
});
test('setup roads attach to the newly placed settlement and actions reject out-of-turn or forged identities atomically', () => {
  let state = match(), actor = state.currentPlayerId, other = state.players.find(player => player.id !== actor).id;
  const before = structuredClone(state); assert.throws(() => act(state, 'BUILD_SETTLEMENT', { vertex: 0 }, other)); assert.deepEqual(state, before);
  state = act(state, 'BUILD_SETTLEMENT', { vertex: legalSettlements(state, actor, true)[0] });
  const remote = TOPOLOGY.edges.find(edge => !edge.vertices.includes(state.setupVertex)).id;
  assert.throws(() => act(state, 'BUILD_ROAD', { edge: remote }));
  assert.throws(() => act(state, 'BUILD_ROAD', { edge: 0, playerId: 'host' }));
});
test('distance rule checks all owners and cities; regular settlements require a connected road', () => {
  const state = emptyBoard(fixture()), vertex = TOPOLOGY.vertices.find(vertex => vertex.neighbors.length === 3);
  state.buildings[vertex.id] = { owner: 'second', kind: 'city' };
  for (const neighbor of vertex.neighbors) assert.ok(!legalSettlements(state, 'host', true).includes(neighbor));
  assert.deepEqual(legalSettlements(state, 'host'), []);
  const edge = TOPOLOGY.edges.find(edge => edge.vertices.every(id => id !== vertex.id && !vertex.neighbors.includes(id)));
  state.roads[edge.id] = 'host'; assert.ok(legalSettlements(state, 'host').includes(edge.vertices[0]));
  grant(state, 'host', COSTS.settlement); const next = act(state, 'BUILD_SETTLEMENT', { vertex: edge.vertices[0] }); assertConservation(next);
  assert.equal(next.buildings[edge.vertices[0]].owner, 'host'); assert.equal(publicScore(next, 'host'), 1);
});
test('roads connect to owned pieces and cannot pass through another player’s town', () => {
  const state = emptyBoard(fixture()), middle = TOPOLOGY.vertices.find(vertex => vertex.edges.length === 3), [incoming, outgoing, ownEdge] = middle.edges;
  state.roads[incoming] = 'host'; assert.ok(legalRoads(state, 'host').includes(outgoing));
  state.buildings[middle.id] = { owner: 'second', kind: 'settlement' }; assert.ok(!legalRoads(state, 'host').includes(outgoing));
  state.buildings[middle.id] = { owner: 'host', kind: 'city' }; assert.ok(legalRoads(state, 'host').includes(outgoing));
  state.roads[ownEdge] = 'second'; assert.ok(!legalRoads(state, 'host').includes(ownEdge));
  grant(state, 'host', COSTS.road); assertConservation(act(state, 'BUILD_ROAD', { edge: outgoing }));
});
test('building costs, city replacement and physical component limits are enforced', () => {
  let state = fixture(), vertex = legalCities(state, 'host')[0]; assert.throws(() => act(state, 'BUILD_CITY', { vertex }));
  grant(state, 'host', COSTS.city); const counts = pieceCounts(state, 'host'); state = act(state, 'BUILD_CITY', { vertex });
  assert.equal(pieceCounts(state, 'host').settlement, counts.settlement - 1); assert.equal(pieceCounts(state, 'host').city, 1); assertConservation(state);
  assert.throws(() => act(state, 'BUILD_CITY', { vertex }));
  const blocked = emptyBoard(fixture()); TOPOLOGY.edges.slice(0, 15).forEach(edge => { blocked.roads[edge.id] = 'host'; }); assert.deepEqual(legalRoads(blocked, 'host'), []);
  TOPOLOGY.vertices.slice(0, 5).forEach(vertex => { blocked.buildings[vertex.id] = { owner: 'host', kind: 'settlement' }; }); assert.deepEqual(legalSettlements(blocked, 'host', true), []);
  TOPOLOGY.vertices.slice(5, 9).forEach(vertex => { blocked.buildings[vertex.id] = { owner: 'host', kind: 'city' }; }); assert.deepEqual(legalCities(blocked, 'host'), []);
});
test('production counts every adjacent settlement/city, respects the robber, and never produces desert resources', () => {
  const state = emptyBoard(fixture()), hex = state.board.hexes.find(hex => hex.terrain !== 'desert'), resource = TERRAIN_RESOURCE[hex.terrain], vertices = TOPOLOGY.hexes[hex.id].vertices;
  state.buildings[vertices[0]] = { owner: 'host', kind: 'settlement' }; state.buildings[vertices[2]] = { owner: 'second', kind: 'city' };
  produceResources(state, hex.number); assert.equal(state.players[0].resources[resource], 1); assert.equal(state.players[1].resources[resource], 2); assertConservation(state);
  state.robber = hex.id; produceResources(state, hex.number); assert.equal(state.players[0].resources[resource], 1); assertConservation(state);
});
test('bank shortages deny a resource to all affected players, with the single-recipient exception', () => {
  const state = emptyBoard(fixture()), hex = state.board.hexes.find(hex => hex.terrain !== 'desert'), resource = TERRAIN_RESOURCE[hex.terrain], vertices = TOPOLOGY.hexes[hex.id].vertices;
  grant(state, 'third', { [resource]: 18 });
  state.buildings[vertices[0]] = { owner: 'host', kind: 'settlement' }; state.buildings[vertices[2]] = { owner: 'second', kind: 'city' };
  produceResources(state, hex.number); assert.equal(state.players[0].resources[resource], 0); assert.equal(state.players[1].resources[resource], 0); assert.equal(state.bank[resource], 1);
  state.buildings[vertices[0]] = null; produceResources(state, hex.number); assert.equal(state.players[1].resources[resource], 1); assert.equal(state.bank[resource], 0); assertConservation(state);
});
test('rolling is required exactly once; normal turns advance clockwise', () => {
  let state = finishSetup(match()); const actor = state.currentPlayerId;
  assert.throws(() => act(state, 'END_TURN')); assert.throws(() => act(state, 'BANK_TRADE', { give: 'wool', receive: 'ore', quantity: 1 }));
  state = act(state, 'ROLL', {}, actor, () => 0); assert.deepEqual(state.dice, [1, 1]); assert.equal(state.phase, 'main');
  assert.throws(() => act(state, 'ROLL')); const index = state.players.findIndex(player => player.id === actor);
  state = act(state, 'END_TURN'); assert.equal(state.phase, 'roll'); assert.equal(state.currentPlayerId, state.players[(index + 1) % state.players.length].id); assert.equal(state.turnNumber, 2);
});
test('7 requires exactly half of hands greater than seven; all discards resolve before moving', () => {
  let state = fixture(); state.phase = 'roll'; grant(state, 'host', { brick: 9 }); grant(state, 'second', { grain: 8 }); grant(state, 'third', { ore: 7 });
  const dice = [2, 3]; state = act(state, 'ROLL', {}, 'host', () => dice.shift()); assert.equal(state.phase, 'discard'); assert.deepEqual(state.discards, { host: 4, second: 4 });
  assert.throws(() => act(state, 'MOVE_ROBBER', { hex: 0 })); assert.throws(() => act(state, 'DISCARD', { resources: { brick: 3 } }));
  state = act(state, 'DISCARD', { resources: { grain: 4 } }, 'second'); assert.equal(state.phase, 'discard');
  state = act(state, 'DISCARD', { resources: { brick: 4 } }, 'host'); assert.equal(state.phase, 'robber'); assert.equal(robberDestinations(state).length, 18); assertConservation(state);
});
test('standard robber can move to any other hex and steals exactly one uniformly indexed card', () => {
  let state = emptyBoard(fixture()); state.phase = 'robber'; state.resumePhase = 'main';
  const hex = state.board.hexes.find(hex => hex.id !== state.robber), vertices = TOPOLOGY.hexes[hex.id].vertices;
  state.buildings[vertices[0]] = { owner: 'second', kind: 'settlement' }; state.buildings[vertices[2]] = { owner: 'third', kind: 'city' }; state.buildings[vertices[4]] = { owner: 'host', kind: 'city' };
  grant(state, 'second', { brick: 2, ore: 1 }); assert.throws(() => act(state, 'MOVE_ROBBER', { hex: state.robber }));
  state = act(state, 'MOVE_ROBBER', { hex: hex.id }); assert.deepEqual(robberVictims(state), ['second']); assert.equal(state.phase, 'steal');
  assert.throws(() => act(state, 'STEAL', { victim: 'third' })); state = act(state, 'STEAL', { victim: 'second' }, 'host', () => 2);
  assert.equal(state.players[0].resources.ore, 1); assert.equal(state.players[1].resources.ore, 0); assert.equal(state.phase, 'main'); assertConservation(state);
});
test('two-player robber rerolls absent/current-only totals and limits every Knight destination', () => {
  let state = fixture(2); const knight = card(state, 'host', 'knight'); state.robber = state.board.hexes.find(hex => hex.number === 2).id;
  // 1+1 hits the current-only 2, 3+4 allows the desert.
  const sequence = [0, 0, 2, 3]; state = act(state, 'PLAY_DEVELOPMENT', { card: knight.id }, 'host', () => sequence.shift());
  assert.equal(state.robberRoll.attempts, 2); assert.equal(state.robberRoll.total, 7); assert.deepEqual(robberDestinations(state), [state.board.hexes.find(hex => hex.terrain === 'desert').id]);
  assert.throws(() => act(state, 'MOVE_ROBBER', { hex: state.board.hexes.find(hex => hex.number === 6).id }));
  state = act(state, 'MOVE_ROBBER', { hex: robberDestinations(state)[0] }); if (state.phase === 'steal') state = act(state, 'STEAL', { victim: robberVictims(state)[0] });
  assert.equal(state.phase, 'main'); assertConservation(state);
  let second = fixture(2); const dev = card(second, 'host', 'knight'); const rolls = [2, 3, 2, 2];
  second = act(second, 'PLAY_DEVELOPMENT', { card: dev.id }, 'host', () => rolls.shift()); assert.equal(second.robberRoll.total, 6); assert.equal(second.robberRoll.attempts, 2); assert.equal(robberDestinations(second).length, 2);
});
test('two-player 7 uses separate destination dice after discards, even without any victims', () => {
  let state = emptyBoard(fixture(2)); state.phase = 'roll'; const sequence = [2, 3, 4, 4];
  state = act(state, 'ROLL', {}, 'host', () => sequence.shift()); assert.deepEqual(state.dice, [3, 4]); assert.deepEqual(state.robberRoll.dice, [5, 5]); assert.equal(state.robberRoll.total, 10);
  state = act(state, 'MOVE_ROBBER', { hex: robberDestinations(state)[0] }); assert.equal(state.phase, 'main');
});
test('bank and harbor rates require a town at an endpoint; resource ports do not discount other resources', () => {
  const state = emptyBoard(fixture()), general = state.board.harbors.find(port => port.resource === null), specific = state.board.harbors.find(port => port.resource === 'ore');
  assert.deepEqual(tradeRatios(state, 'host'), resourceBag(4)); state.roads[general.edge] = 'host'; assert.deepEqual(tradeRatios(state, 'host'), resourceBag(4));
  state.buildings[TOPOLOGY.edges[specific.edge].vertices[0]] = { owner: 'host', kind: 'settlement' }; assert.equal(tradeRatios(state, 'host').ore, 2); assert.equal(tradeRatios(state, 'host').wool, 4);
  state.buildings[TOPOLOGY.edges[general.edge].vertices[0]] = { owner: 'host', kind: 'city' }; assert.equal(tradeRatios(state, 'host').wool, 3); assert.equal(tradeRatios(state, 'host').ore, 2);
  grant(state, 'host', { ore: 4 }); const next = act(state, 'BANK_TRADE', { give: 'ore', receive: 'lumber', quantity: 2 }); assert.equal(next.players[0].resources.lumber, 2); assertConservation(next);
  assert.throws(() => act(next, 'BANK_TRADE', { give: 'ore', receive: 'ore', quantity: 1 })); assert.throws(() => act(next, 'BANK_TRADE', { give: 'ore', receive: 'brick', quantity: 1 }));
});
test('player offers, guest counteroffers and atomic acceptance prohibit gifts and off-turn exchanges', () => {
  let state = fixture(); grant(state, 'host', { lumber: 3 }); grant(state, 'second', { ore: 2 });
  const offer = { give: { lumber: 2 }, want: { ore: 1 }, target: null }; state = act(state, 'OFFER_TRADE', offer); const oldOffer = state.trade.id;
  assert.throws(() => act(state, 'ACCEPT_TRADE', { offer: oldOffer }, 'host'));
  state = act(state, 'OFFER_TRADE', { give: { ore: 1 }, want: { lumber: 1 }, target: 'host' }, 'second');
  assert.throws(() => act(state, 'ACCEPT_TRADE', { offer: oldOffer }, 'second'));
  assert.throws(() => act(state, 'ACCEPT_TRADE', { offer: state.trade.id }, 'third'));
  state = act(state, 'ACCEPT_TRADE', { offer: state.trade.id }); assert.equal(state.players[0].resources.ore, 1); assert.equal(state.players[1].resources.lumber, 1); assert.equal(state.trade, null); assertConservation(state);
  assert.throws(() => act(state, 'OFFER_TRADE', { give: { ore: 1 }, want: { wool: 1 }, target: 'third' }, 'second'));
  assert.throws(() => act(state, 'OFFER_TRADE', { give: { ore: 1 }, want: {}, target: null }));
  assert.throws(() => act(state, 'OFFER_TRADE', { give: { lumber: 1 }, want: { lumber: 2 }, target: null }));
});
test('development purchases draw only from the host deck and new non-VP cards wait until a later turn', () => {
  let state = fixture(); grant(state, 'host', COSTS.development); state.developmentDeck.sort((a, b) => (a.type === 'knight') - (b.type === 'knight'));
  state = act(state, 'BUY_DEVELOPMENT'); const newest = state.players[0].development.at(-1); assert.equal(newest.boughtTurn, state.turnNumber); assertConservation(state);
  assert.throws(() => act(state, 'PLAY_DEVELOPMENT', { card: newest.id }));
  state.turnNumber++; state.phase = 'roll'; state = act(state, 'PLAY_DEVELOPMENT', { card: newest.id }); assert.equal(state.phase, 'robber'); assert.equal(state.resumePhase, 'roll');
  state = act(state, 'MOVE_ROBBER', { hex: robberDestinations(state)[0] }); if (state.phase === 'steal') state = act(state, 'STEAL', { victim: robberVictims(state)[0] }); assert.equal(state.phase, 'roll'); assertConservation(state);
  const nextCard = card(state, 'host', 'monopoly'); assert.throws(() => act(state, 'PLAY_DEVELOPMENT', { card: nextCard.id }));
});
test('Year of Plenty accepts same/different resources and handles a depleted bank without soft locks', () => {
  let state = fixture(), plenty = card(state, 'host', 'year_of_plenty'); state = act(state, 'PLAY_DEVELOPMENT', { card: plenty.id });
  assert.throws(() => act(state, 'TAKE_PLENTY', { resources: { wool: 1 } })); state = act(state, 'TAKE_PLENTY', { resources: { wool: 2 } }); assert.equal(state.players[0].resources.wool, 2); assertConservation(state);
  let scarce = fixture(); for (const resource of RESOURCES) grant(scarce, 'second', { [resource]: resource === 'ore' ? 18 : 19 }); const only = card(scarce, 'host', 'year_of_plenty');
  scarce = act(scarce, 'PLAY_DEVELOPMENT', { card: only.id }); scarce = act(scarce, 'TAKE_PLENTY', { resources: { ore: 1 } }); assert.equal(scarce.phase, 'main'); assertConservation(scarce);
  let empty = fixture(); for (const resource of RESOURCES) grant(empty, 'second', { [resource]: 19 }); const none = card(empty, 'host', 'year_of_plenty'); empty = act(empty, 'PLAY_DEVELOPMENT', { card: none.id }); assert.equal(empty.phase, 'main'); assertConservation(empty);
});
test('Monopoly takes all cards of exactly one type from all opponents, bypassing the bank', () => {
  let state = fixture(); grant(state, 'second', { wool: 3, ore: 2 }); grant(state, 'third', { wool: 4 }); const monopoly = card(state, 'host', 'monopoly');
  state = act(state, 'PLAY_DEVELOPMENT', { card: monopoly.id }); assert.throws(() => act(state, 'CHOOSE_MONOPOLY', { resource: 'gold' }));
  state = act(state, 'CHOOSE_MONOPOLY', { resource: 'wool' }); assert.equal(state.players[0].resources.wool, 7); assert.equal(state.players[1].resources.wool, 0); assert.equal(state.players[1].resources.ore, 2); assertConservation(state);
});
test('Road Building places sequential connected roads for free, with one/no piece and blocked-location cases', () => {
  let state = fixture(), roads = card(state, 'host', 'road_building'); const bank = structuredClone(state.bank); state = act(state, 'PLAY_DEVELOPMENT', { card: roads.id });
  state = act(state, 'BUILD_ROAD', { edge: legalRoads(state, 'host')[0] }); assert.equal(state.freeRoads, 1);
  state = act(state, 'BUILD_ROAD', { edge: legalRoads(state, 'host')[0] }); assert.equal(state.phase, 'main'); assert.deepEqual(state.bank, bank); assertConservation(state);
  let one = emptyBoard(fixture()); chain(14).edges.forEach(edge => { one.roads[edge] = 'host'; }); const single = card(one, 'host', 'road_building'); one = act(one, 'PLAY_DEVELOPMENT', { card: single.id }); assert.equal(one.freeRoads, 1);
  one = act(one, 'BUILD_ROAD', { edge: legalRoads(one, 'host')[0] }); assert.equal(one.phase, 'main'); assert.equal(pieceCounts(one, 'host').road, 15);
  one.developmentPlayed = false; const none = card(one, 'host', 'road_building'); one = act(one, 'PLAY_DEVELOPMENT', { card: none.id }); assert.equal(one.phase, 'main');
});
test('Longest Road handles branches, loops, tails, own towns and an opponent’s interruption', () => {
  const state = emptyBoard(fixture()), path = chain(7); path.edges.forEach(edge => { state.roads[edge] = 'host'; }); assert.equal(longestRoad(state, 'host'), 7);
  const branch = TOPOLOGY.vertices[path.vertices[3]].edges.find(edge => !path.edges.includes(edge)); if (branch !== undefined) state.roads[branch] = 'host'; assert.equal(longestRoad(state, 'host'), 7);
  state.buildings[path.vertices[3]] = { owner: 'host', kind: 'settlement' }; assert.equal(longestRoad(state, 'host'), 7);
  state.buildings[path.vertices[3]] = { owner: 'second', kind: 'city' }; assert.equal(longestRoad(state, 'host'), 4);
  emptyBoard(state); const loop = TOPOLOGY.hexes[9]; loop.edges.forEach(edge => { state.roads[edge] = 'host'; }); assert.equal(longestRoad(state, 'host'), 6);
  const tail = TOPOLOGY.vertices[loop.vertices[0]].edges.find(edge => !loop.edges.includes(edge)); state.roads[tail] = 'host'; assert.equal(longestRoad(state, 'host'), 7);
});
test('road award transfers only to a sole higher leader, preserves incumbent ties and becomes unclaimed after a split', () => {
  const state = emptyBoard(fixture()), a = chain(7), b = chain(5, new Set(a.edges)), c = chain(5, new Set([...a.edges, ...b.edges]));
  a.edges.forEach(edge => { state.roads[edge] = 'host'; }); b.edges.forEach(edge => { state.roads[edge] = 'second'; }); c.edges.forEach(edge => { state.roads[edge] = 'third'; });
  updateAwards(state); assert.equal(state.longestRoadOwner, 'host');
  state.buildings[a.vertices[3]] = { owner: 'second', kind: 'settlement' }; updateAwards(state);
  const leaders = state.players.filter(player => longestRoad(state, player.id) >= 5); assert.equal(leaders.length, 2); assert.equal(state.longestRoadOwner, null);
  state.longestRoadOwner = 'second'; updateAwards(state); assert.equal(state.longestRoadOwner, 'second');
  c.edges.forEach(edge => { state.roads[edge] = null; }); updateAwards(state); assert.equal(state.longestRoadOwner, 'second');
});
test('Largest Army starts at three played Knights and requires exceeding the holder', () => {
  const state = fixture(); state.players[0].knights = 2; updateAwards(state); assert.equal(state.largestArmyOwner, null);
  state.players[0].knights = 3; updateAwards(state); assert.equal(state.largestArmyOwner, 'host'); state.players[1].knights = 3; updateAwards(state); assert.equal(state.largestArmyOwner, 'host');
  state.players[1].knights = 4; updateAwards(state); assert.equal(state.largestArmyOwner, 'second'); assert.equal(publicScore(state, 'second'), 4);
});
test('hidden points win immediately even when bought this turn; only the active player can win', () => {
  let state = emptyBoard(fixture());
  for (const vertex of TOPOLOGY.vertices.slice(0, 4)) state.buildings[vertex.id] = { owner: 'host', kind: 'city' };
  card(state, 'host', 'victory_point'); grant(state, 'host', COSTS.development); state.developmentDeck.sort((a, b) => (a.type === 'victory_point') - (b.type === 'victory_point'));
  assert.equal(publicScore(state, 'host'), 8); assert.equal(totalScore(state, 'host'), 9);
  state = act(state, 'BUY_DEVELOPMENT'); assert.equal(state.phase, 'game_result'); assert.equal(state.winnerId, 'host'); assert.equal(buildViewForPlayer(state, 'second').players[0].score, 10); assertConservation(state);
  const offTurn = emptyBoard(fixture()); for (const vertex of TOPOLOGY.vertices.slice(0, 4)) offTurn.buildings[vertex.id] = { owner: 'second', kind: 'city' };
  card(offTurn, 'second', 'victory_point'); card(offTurn, 'second', 'victory_point'); checkVictory(offTurn); assert.equal(offTurn.phase, 'main');
  const next = act(offTurn, 'END_TURN'); assert.equal(next.winnerId, 'second'); assert.equal(next.phase, 'game_result'); assert.equal(next.dice, null);
  const two = emptyBoard(fixture(2)); for (const vertex of TOPOLOGY.vertices.slice(0, 4)) two.buildings[vertex.id] = { owner: 'host', kind: 'city' }; card(two, 'host', 'victory_point'); card(two, 'host', 'victory_point'); checkVictory(two); assert.equal(two.phase, 'main');
  card(two, 'host', 'victory_point'); card(two, 'host', 'victory_point'); checkVictory(two); assert.equal(two.phase, 'game_result');
});
test('personalized views omit opponent resources/cards, purchased times and deck order and are independent copies', () => {
  const state = fixture(); grant(state, 'host', { brick: 3 }); const secret = card(state, 'host', 'monopoly'); card(state, 'host', 'victory_point');
  const view = buildViewForPlayer(state, 'second'), host = view.players[0]; assert.equal(host.developmentCount, 2); assert.equal(host.resourceCount, 3); assert.equal(host.score, 2);
  for (const player of view.players) for (const forbidden of ['resources', 'development', 'boughtTurn', 'victoryCards']) assert.equal(Object.hasOwn(player, forbidden), false);
  assert.equal(Object.hasOwn(view, 'developmentDeck'), false); assert.ok(!JSON.stringify(view).includes(`"${secret.id}"`)); assert.ok(!JSON.stringify(view).includes('monopoly'));
  assert.ok(isMessage(message('STATE_UPDATE', { view }))); assert.ok(JSON.stringify(message('STATE_UPDATE', { view })).length < 32768);
  view.board.hexes[0].terrain = 'fake'; view.bank.brick = 0; view.roads[0] = 'second'; assert.notEqual(state.board.hexes[0].terrain, 'fake'); assert.equal(state.bank.brick, 16); assert.notEqual(state.roads[0], 'second');
});
test('disconnect policy, host-only lobby recovery, four-seat cap and rematches reuse player identities', () => {
  let state = match(4); assert.throws(() => addPlayer(state, 'fifth', 'Extra'));
  state = removePlayer(state, 'second'); assert.equal(state.phase, 'disconnected'); assert.throws(() => applyAction(state, 'third', 'RETURN_TO_LOBBY'));
  state = applyAction(state, 'host', 'RETURN_TO_LOBBY'); assert.equal(state.players.length, 3); assert.equal(state.phase, 'lobby'); assert.equal(state.players[0].id, 'host');
  let rematch = fixture(); rematch.phase = 'game_result'; rematch.winnerId = 'host'; const prior = rematch.board;
  rematch = applyAction(rematch, 'host', 'PLAY_AGAIN', {}, rng(887)); assert.equal(rematch.phase, 'setup_settlement'); assert.deepEqual(rematch.players.map(player => player.id), ['host', 'second', 'third']); assert.notDeepEqual(rematch.board, prior); assert.equal(rematch.developmentDeck.length, 25);
});
test('wire schema rejects all malformed ranges, bags, extra fields and identity injections', () => {
  const invalid = [{ action: 'BUILD_ROAD', edge: -1 }, { action: 'BUILD_ROAD', edge: 72 }, { action: 'BUILD_CITY', vertex: 54 }, { action: 'MOVE_ROBBER', hex: 19 },
    { action: 'ROLL', dice: [6, 6] }, { action: 'PLAY_DEVELOPMENT', card: 'knight' }, { action: 'DISCARD', resources: { ore: -1 } },
    { action: 'DISCARD', resources: { ore: 20 } }, { action: 'DISCARD', resources: { ore: 1.5 } }, { action: 'DISCARD', resources: { gold: 1 } },
    { action: 'END_TURN', playerId: 'host' }, { action: 'OFFER_TRADE', give: {}, want: {}, target: {} }, { action: 'BANK_TRADE', give: 'wool', receive: 'ore', quantity: 0 }];
  for (const payload of invalid) { assert.equal(isCatanaAction(payload), false); assert.equal(isClientMessage(message('CATANA_ACTION', payload)), false); }
  assert.ok(isClientMessage(message('CATANA_ACTION', { action: 'BUILD_ROAD', edge: 71 })));
});
test('Catana is accessible through its direct entry and is absent from all public game descriptors', async () => {
  assert.ok(!GAMES.some(game => game.id === 'catana')); assert.ok(!COLLECTION_GAMES.some(game => game.id === 'catana'));
  const html = await readFile(new URL('../games/catana/index.html', import.meta.url), 'utf8'); assert.match(html, /noindex, nofollow/); assert.match(html, /\.\/games\/catana\/app\.mjs/); assert.match(html, /data-site-https/);
  const config = JSON.parse(await readFile(new URL('../config.json', import.meta.url), 'utf8')); for (const module of ['constants', 'action-schema', 'board', 'game-core', 'ui', 'app']) assert.ok(config.modules.includes(`./games/catana/${module}.mjs`));
});

test('an exhausted development deck and empty bank reject purchases/trades without charging resources', () => {
  let state = fixture();
  for (let i = 0; i < 25; i++) { grant(state, 'host', COSTS.development); state = act(state, 'BUY_DEVELOPMENT'); assertConservation(state); }
  assert.equal(state.developmentDeck.length, 0); assert.equal(state.players[0].development.length, 25); grant(state, 'host', COSTS.development);
  const before = structuredClone(state); assert.throws(() => act(state, 'BUY_DEVELOPMENT'), /empty/); assert.deepEqual(state, before);
  assert.ok(isMessage(message('STATE_UPDATE', { view: buildViewForPlayer(state, 'host') })));
  const bank = fixture(); grant(bank, 'second', { ore: 19 }); grant(bank, 'host', { brick: 4 });
  const saved = structuredClone(bank); assert.throws(() => act(bank, 'BANK_TRADE', { give: 'brick', receive: 'ore', quantity: 1 })); assert.deepEqual(bank, saved);
});
test('two-player destination dice are drawn only after the last required discard is accepted', () => {
  let state = fixture(2); state.phase = 'roll'; grant(state, 'host', { wool: 9 }); grant(state, 'second', { grain: 8 });
  const production = [2, 3]; state = act(state, 'ROLL', {}, 'host', () => production.shift());
  assert.equal(state.phase, 'discard'); assert.equal(state.robberRoll, null);
  state = act(state, 'DISCARD', { resources: { wool: 4 } }, 'host', () => { throw new Error('Destination dice must wait for the other player'); });
  const destination = [1, 2]; state = act(state, 'DISCARD', { resources: { grain: 4 } }, 'second', () => destination.shift());
  assert.equal(state.phase, 'robber'); assert.deepEqual(state.dice, [3, 4]); assert.deepEqual(state.robberRoll.dice, [2, 3]); assert.equal(state.robberRoll.total, 5); assertConservation(state);
});
test('Longest Road agrees with an independent Euler-trail subset oracle on neighboring loops and branches', () => {
  const state = emptyBoard(fixture());
  // A subset supports an Euler trail iff it is connected with at most two odd-degree vertices.
  // Enumerating subsets provides an independent reference for the production path-search algorithm.
  function oracle(owned) {
    let best = 0;
    for (let mask = 1; mask < 2 ** owned.length; mask++) {
      const subset = owned.filter((_, index) => mask & (1 << index)); if (subset.length <= best) continue;
      const graph = new Map();
      for (const id of subset) { const [a, b] = TOPOLOGY.edges[id].vertices; if (!graph.has(a)) graph.set(a, []); if (!graph.has(b)) graph.set(b, []); graph.get(a).push(b); graph.get(b).push(a); }
      if ([...graph.values()].filter(neighbors => neighbors.length % 2).length > 2) continue;
      const seen = new Set(), pending = [graph.keys().next().value]; while (pending.length) { const vertex = pending.pop(); if (seen.has(vertex)) continue; seen.add(vertex); pending.push(...graph.get(vertex)); }
      if (seen.size === graph.size) best = subset.length;
    }
    return best;
  }
  const pick = rng(433);
  for (let attempt = 0; attempt < 30; attempt++) {
    const hex = TOPOLOGY.hexes[pick(19)], neighbor = TOPOLOGY.hexes[hex.neighbors[pick(hex.neighbors.length)]], union = [...new Set([...hex.edges, ...neighbor.edges])];
    const owned = attempt % 3 ? union.filter(() => pick(5) !== 0) : union; state.roads.fill(null); owned.forEach(edge => { state.roads[edge] = 'host'; });
    assert.equal(longestRoad(state, 'host'), oracle(owned));
  }
});
