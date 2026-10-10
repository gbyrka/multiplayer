import { randomInt, validateName } from '../../shared/random.mjs';
import { generateBoard, shuffle, TOPOLOGY } from './board.mjs';
import { isCatanaAction } from './action-schema.mjs';
import { RESOURCES, resourceBag, resourceCount, TERRAIN_RESOURCE, DEVELOPMENT_COUNTS, COSTS, COLORS, PIECE_LIMITS, PHASES } from './constants.mjs';
export { PHASES } from './constants.mjs';

export class RuleError extends Error { constructor(message) { super(message); this.name = 'RuleError'; } }
const requireRule = (condition, text) => { if (!condition) throw new RuleError(text); };
const findPlayer = (state, id) => state.players.find(player => player.id === id);
const normalizedBag = bag => Object.fromEntries(RESOURCES.map(resource => [resource, bag[resource] ?? 0]));
const hasResources = (player, bag) => RESOURCES.every(resource => player.resources[resource] >= (bag[resource] ?? 0));
const rollDice = pick => [pick(6) + 1, pick(6) + 1];
const log = (state, text) => { state.log.push({ id: state.revision + 1, text }); state.log = state.log.slice(-30); };

function makePlayer(id, name, host = false) {
  return { id, name: validateName(name), host, ready: host, connected: true, resources: resourceBag(), development: [], knights: 0 };
}
export function createLobby(hostId, name) {
  return { revision: 0, phase: 'lobby', hostId, players: [makePlayer(hostId, name, true)], currentPlayerId: null,
    board: null, roads: [], buildings: [], bank: resourceBag(19), developmentDeck: [], playedDevelopment: [],
    longestRoadOwner: null, largestArmyOwner: null, turnNumber: 0, targetScore: 10, dice: null, robber: null,
    robberRoll: null, resumePhase: null, discards: {}, freeRoads: 0, developmentPlayed: false,
    setupOrder: [], setupStep: 0, setupVertex: null, trade: null, winnerId: null, log: [], disconnectedNames: [] };
}
export function addPlayer(state, id, name) {
  requireRule(state.phase === 'lobby', 'A match is already in progress.');
  requireRule(state.players.length < 4, 'This room already has four players.');
  requireRule(typeof id === 'string' && !findPlayer(state, id), 'Player already joined.');
  const next = structuredClone(state); next.players.push(makePlayer(id, name)); next.revision++; return next;
}
export function removePlayer(state, id) {
  if (!findPlayer(state, id)?.connected || id === state.hostId) return state;
  const next = structuredClone(state);
  if (state.phase === 'lobby') next.players = next.players.filter(player => player.id !== id);
  else { findPlayer(next, id).connected = false; next.phase = 'disconnected'; next.trade = null; next.disconnectedNames.push(findPlayer(state, id).name); }
  next.revision++; return next;
}
export const canStart = state => state.phase === 'lobby' && state.players.length >= 2 && state.players.length <= 4 && state.players.every(player => player.connected && player.ready);

export function pieceCounts(state, id) {
  return { road: state.roads.filter(owner => owner === id).length,
    settlement: state.buildings.filter(building => building?.owner === id && building.kind === 'settlement').length,
    city: state.buildings.filter(building => building?.owner === id && building.kind === 'city').length };
}
export function legalSettlements(state, id, initial = false) {
  if (!state.board || pieceCounts(state, id).settlement >= PIECE_LIMITS.settlement) return [];
  return TOPOLOGY.vertices.filter(vertex => !state.buildings[vertex.id] && vertex.neighbors.every(neighbor => !state.buildings[neighbor]) &&
    (initial || vertex.edges.some(edge => state.roads[edge] === id))).map(vertex => vertex.id);
}
export function legalRoads(state, id, initialVertex = null) {
  if (!state.board || pieceCounts(state, id).road >= PIECE_LIMITS.road) return [];
  return TOPOLOGY.edges.filter(edge => !state.roads[edge.id] && (initialVertex !== null ? edge.vertices.includes(initialVertex) : edge.vertices.some(vertexId => {
    const building = state.buildings[vertexId];
    if (building) return building.owner === id;
    return TOPOLOGY.vertices[vertexId].edges.some(other => state.roads[other] === id);
  }))).map(edge => edge.id);
}
export function legalCities(state, id) {
  return pieceCounts(state, id).city >= PIECE_LIMITS.city ? [] : TOPOLOGY.vertices.filter(vertex => state.buildings[vertex.id]?.owner === id && state.buildings[vertex.id].kind === 'settlement').map(vertex => vertex.id);
}

/** Longest edge-simple trail: branches, loops, disconnected components and blocking towns. */
export function longestRoad(state, id) {
  if (!state.board) return 0;
  const search = (vertex, used) => {
    if (used.size && state.buildings[vertex] && state.buildings[vertex].owner !== id) return used.size;
    let best = used.size;
    for (const edgeId of TOPOLOGY.vertices[vertex].edges) {
      if (state.roads[edgeId] !== id || used.has(edgeId)) continue;
      used.add(edgeId);
      const next = TOPOLOGY.edges[edgeId].vertices.find(other => other !== vertex);
      best = Math.max(best, search(next, used)); used.delete(edgeId);
    }
    return best;
  };
  let best = 0;
  for (const vertex of TOPOLOGY.vertices) if (vertex.edges.some(edge => state.roads[edge] === id)) best = Math.max(best, search(vertex.id, new Set()));
  return best;
}
function awardOwner(current, values, minimum) {
  const highest = Math.max(...values.map(entry => entry.value));
  if (highest < minimum) return null;
  const leaders = values.filter(entry => entry.value === highest).map(entry => entry.id);
  return leaders.includes(current) ? current : leaders.length === 1 ? leaders[0] : null;
}
export function updateAwards(state) {
  state.longestRoadOwner = awardOwner(state.longestRoadOwner, state.players.map(player => ({ id: player.id, value: longestRoad(state, player.id) })), 5);
  state.largestArmyOwner = awardOwner(state.largestArmyOwner, state.players.map(player => ({ id: player.id, value: player.knights })), 3);
}
export function publicScore(state, id) {
  const pieces = pieceCounts(state, id);
  return pieces.settlement + 2 * pieces.city + (state.longestRoadOwner === id ? 2 : 0) + (state.largestArmyOwner === id ? 2 : 0);
}
export const totalScore = (state, id) => publicScore(state, id) + (findPlayer(state, id)?.development.filter(card => card.type === 'victory_point').length ?? 0);
export function checkVictory(state) {
  if (['lobby', 'setup_settlement', 'setup_road', 'disconnected', 'game_result'].includes(state.phase)) return;
  if (totalScore(state, state.currentPlayerId) >= state.targetScore) {
    state.winnerId = state.currentPlayerId; state.phase = 'game_result'; state.trade = null;
    log(state, `${findPlayer(state, state.winnerId).name} wins Catana Codex!`);
  }
}
export function tradeRatios(state, id) {
  const ratios = resourceBag(4);
  for (const harbor of state.board?.harbors ?? []) {
    if (!TOPOLOGY.edges[harbor.edge].vertices.some(vertex => state.buildings[vertex]?.owner === id)) continue;
    for (const resource of RESOURCES) if (harbor.resource === null || harbor.resource === resource) ratios[resource] = Math.min(ratios[resource], harbor.resource === null ? 3 : 2);
  }
  return ratios;
}
function pay(state, player, cost) {
  requireRule(hasResources(player, cost), 'You do not have the resources for that action.');
  for (const resource of RESOURCES) { const count = cost[resource] ?? 0; player.resources[resource] -= count; state.bank[resource] += count; }
}
function takeFromBank(state, player, resources) {
  for (const resource of RESOURCES) { player.resources[resource] += resources[resource] ?? 0; state.bank[resource] -= resources[resource] ?? 0; }
}
export function produceResources(state, number) {
  const claims = Object.fromEntries(RESOURCES.map(resource => [resource, new Map()]));
  for (const hex of state.board.hexes) {
    const resource = TERRAIN_RESOURCE[hex.terrain];
    if (!resource || hex.number !== number || hex.id === state.robber) continue;
    for (const vertex of TOPOLOGY.hexes[hex.id].vertices) {
      const building = state.buildings[vertex]; if (!building) continue;
      const counts = claims[resource]; counts.set(building.owner, (counts.get(building.owner) ?? 0) + (building.kind === 'city' ? 2 : 1));
    }
  }
  for (const resource of RESOURCES) {
    const counts = claims[resource], total = [...counts.values()].reduce((sum, count) => sum + count, 0);
    if (total > state.bank[resource] && counts.size > 1) { log(state, `The bank cannot supply ${resource}; nobody receives it this roll.`); continue; }
    for (const [id, requested] of counts) { const count = Math.min(requested, state.bank[resource]); findPlayer(state, id).resources[resource] += count; state.bank[resource] -= count; }
  }
}
export function robberDestinations(state) {
  return state.board.hexes.filter(hex => hex.id !== state.robber && (state.players.length !== 2 ||
    (state.robberRoll?.total === 7 ? hex.terrain === 'desert' : hex.number === state.robberRoll?.total))).map(hex => hex.id);
}
function beginRobber(state, resumePhase, pick) {
  state.phase = 'robber'; state.resumePhase = resumePhase; state.robberRoll = null;
  if (state.players.length === 2) {
    let attempts = 0;
    do { const dice = rollDice(pick); state.robberRoll = { dice, total: dice[0] + dice[1], attempts: ++attempts }; } while (!robberDestinations(state).length);
    log(state, `Robber destination roll: ${state.robberRoll.total}${attempts > 1 ? ` (${attempts - 1} automatic rerolls)` : ''}.`);
  }
}
export function robberVictims(state) {
  const adjacent = new Set(TOPOLOGY.hexes[state.robber].vertices.map(vertex => state.buildings[vertex]?.owner).filter(Boolean));
  return state.players.filter(player => player.id !== state.currentPlayerId && adjacent.has(player.id) && resourceCount(player.resources) > 0).map(player => player.id);
}
function resumeTurn(state) { state.phase = state.resumePhase; state.resumePhase = null; state.freeRoads = 0; }
function startMatch(state, pick) {
  const fresh = createLobby(state.hostId, findPlayer(state, state.hostId).name);
  fresh.players = state.players.map(player => makePlayer(player.id, player.name, player.host));
  fresh.players.forEach(player => { player.ready = true; });
  fresh.revision = state.revision;
  Object.assign(state, fresh);
  state.targetScore = state.players.length === 2 ? 12 : 10;
  state.board = generateBoard(pick); state.roads = Array(72).fill(null); state.buildings = Array(54).fill(null);
  state.robber = state.board.hexes.find(hex => hex.terrain === 'desert').id;
  state.developmentDeck = shuffle(Object.entries(DEVELOPMENT_COUNTS).flatMap(([type, count]) => Array(count).fill(type)), pick).map((type, index) => ({ id: `d${index}`, type }));
  const first = pick(state.players.length), order = state.players.map((_, index) => state.players[(index + first) % state.players.length].id);
  state.setupOrder = [...order, ...order.toReversed()]; state.currentPlayerId = order[0]; state.phase = 'setup_settlement';
  log(state, `${findPlayer(state, order[0]).name} places first. Setup follows snake order.`);
}

/** All player actions, including those of the host, pass through this atomic reducer. */
export function applyAction(state, actorId, type, payload = {}, pick = randomInt) {
  requireRule(findPlayer(state, actorId)?.connected, 'You are no longer connected to this room.');
  const next = structuredClone(state), player = findPlayer(next, actorId);
  const hostOnly = () => requireRule(actorId === state.hostId, 'Only the host can do that.');
  if (type === 'SET_READY') {
    requireRule(state.phase === 'lobby' && !player.host && typeof payload.ready === 'boolean', 'Ready is only available in the lobby.'); player.ready = payload.ready;
  } else if (type === 'START_GAME' || type === 'PLAY_AGAIN') {
    hostOnly(); requireRule(type === 'START_GAME' ? canStart(state) : state.phase === 'game_result' && state.players.every(p => p.connected), 'Everyone must be ready and connected.'); startMatch(next, pick);
  } else if (type === 'RETURN_TO_LOBBY') {
    hostOnly(); requireRule(state.phase === 'disconnected', 'This match is still active.');
    const lobby = createLobby(state.hostId, findPlayer(state, state.hostId).name);
    lobby.players = state.players.filter(p => p.connected).map(p => makePlayer(p.id, p.name, p.host)); lobby.revision = state.revision + 1; return lobby;
  } else {
    requireRule(type === 'CATANA_ACTION' && isCatanaAction(payload), 'Invalid Catana action.');
    requireRule(!['lobby', 'game_result', 'disconnected'].includes(state.phase), 'This match is not accepting moves.');
    const turn = (...phases) => { requireRule(state.currentPlayerId === actorId, 'Please wait for your turn.'); requireRule(phases.includes(state.phase), 'Finish the current action first.'); };
    switch (payload.action) {
      case 'BUILD_SETTLEMENT': {
        turn('setup_settlement', 'main'); const initial = state.phase === 'setup_settlement';
        requireRule(legalSettlements(state, actorId, initial).includes(payload.vertex), 'Choose a legal settlement location. Keep one empty intersection between towns.');
        if (!initial) pay(next, player, COSTS.settlement);
        next.buildings[payload.vertex] = { owner: actorId, kind: 'settlement' }; next.trade = null;
        if (initial) {
          next.setupVertex = payload.vertex; next.phase = 'setup_road';
          if (state.setupStep >= state.players.length) {
            const resources = resourceBag(); for (const hex of TOPOLOGY.vertices[payload.vertex].hexes) { const resource = TERRAIN_RESOURCE[state.board.hexes[hex].terrain]; if (resource) resources[resource]++; }
            takeFromBank(next, player, resources);
          }
        }
        log(next, `${player.name} built a settlement.`); break;
      }
      case 'BUILD_ROAD': {
        turn('setup_road', 'main', 'road_building');
        requireRule(legalRoads(state, actorId, state.phase === 'setup_road' ? state.setupVertex : null).includes(payload.edge), 'Choose a connected, unoccupied road location.');
        if (state.phase === 'main') pay(next, player, COSTS.road);
        next.roads[payload.edge] = actorId; next.trade = null;
        if (state.phase === 'setup_road') {
          next.setupStep++; next.setupVertex = null;
          if (next.setupStep === next.setupOrder.length) { next.currentPlayerId = next.setupOrder[0]; next.phase = 'roll'; next.turnNumber = 1; }
          else { next.currentPlayerId = next.setupOrder[next.setupStep]; next.phase = 'setup_settlement'; }
        } else if (state.phase === 'road_building') { next.freeRoads--; if (!next.freeRoads || !legalRoads(next, actorId).length) resumeTurn(next); }
        log(next, `${player.name} built a road.`); break;
      }
      case 'BUILD_CITY':
        turn('main'); requireRule(legalCities(state, actorId).includes(payload.vertex), 'Upgrade one of your settlements. You have four city pieces.');
        pay(next, player, COSTS.city); next.buildings[payload.vertex].kind = 'city'; next.trade = null; log(next, `${player.name} upgraded a settlement to a city.`); break;
      case 'ROLL': {
        turn('roll'); next.dice = rollDice(pick); const total = next.dice[0] + next.dice[1]; log(next, `${player.name} rolled ${total}.`);
        if (total === 7) {
          next.discards = Object.fromEntries(next.players.filter(p => resourceCount(p.resources) > 7).map(p => [p.id, Math.floor(resourceCount(p.resources) / 2)]));
          if (Object.keys(next.discards).length) next.phase = 'discard'; else beginRobber(next, 'main', pick);
        } else { produceResources(next, total); next.phase = 'main'; }
        break;
      }
      case 'DISCARD': {
        requireRule(state.phase === 'discard' && state.discards[actorId] > 0, 'You do not need to discard.');
        const resources = normalizedBag(payload.resources);
        requireRule(resourceCount(resources) === state.discards[actorId] && hasResources(player, resources), `Discard exactly ${state.discards[actorId]} cards from your hand.`);
        pay(next, player, resources); delete next.discards[actorId]; log(next, `${player.name} discarded ${resourceCount(resources)} cards.`);
        if (!Object.keys(next.discards).length) beginRobber(next, 'main', pick); break;
      }
      case 'MOVE_ROBBER':
        turn('robber'); requireRule(robberDestinations(state).includes(payload.hex), 'Choose a highlighted hex. The robber must move.');
        next.robber = payload.hex; log(next, `${player.name} moved the robber.`);
        if (robberVictims(next).length) next.phase = 'steal'; else resumeTurn(next); break;
      case 'STEAL': {
        turn('steal'); requireRule(robberVictims(state).includes(payload.victim), 'Choose an opponent with resources beside the robber.');
        const victim = findPlayer(next, payload.victim); let draw = pick(resourceCount(victim.resources));
        for (const resource of RESOURCES) { if (draw < victim.resources[resource]) { victim.resources[resource]--; player.resources[resource]++; break; } draw -= victim.resources[resource]; }
        log(next, `${player.name} stole a resource card from ${victim.name}.`); resumeTurn(next); break;
      }
      case 'BUY_DEVELOPMENT': {
        turn('main'); requireRule(next.developmentDeck.length, 'The development deck is empty.'); pay(next, player, COSTS.development);
        player.development.push({ ...next.developmentDeck.pop(), boughtTurn: state.turnNumber }); next.trade = null;
        log(next, `${player.name} bought a development card.`); break;
      }
      case 'PLAY_DEVELOPMENT': {
        turn('roll', 'main'); requireRule(!state.developmentPlayed, 'You may play only one development card per turn.');
        const card = player.development.find(card => card.id === payload.card);
        requireRule(card && card.type !== 'victory_point' && card.boughtTurn < state.turnNumber, 'Choose an unplayed development card bought on an earlier turn.');
        player.development = player.development.filter(item => item.id !== card.id); next.playedDevelopment.push({ ...card, owner: actorId });
        next.developmentPlayed = true; next.trade = null; next.resumePhase = state.phase; log(next, `${player.name} played ${card.type.replaceAll('_', ' ')}.`);
        if (card.type === 'knight') { player.knights++; beginRobber(next, state.phase, pick); }
        else if (card.type === 'road_building') { next.phase = 'road_building'; next.freeRoads = Math.min(2, 15 - pieceCounts(next, actorId).road); if (!legalRoads(next, actorId).length) resumeTurn(next); }
        else if (card.type === 'year_of_plenty') { next.phase = 'year_of_plenty'; if (!resourceCount(next.bank)) resumeTurn(next); }
        else next.phase = 'monopoly'; break;
      }
      case 'FINISH_ROADS': turn('road_building'); resumeTurn(next); break;
      case 'TAKE_PLENTY': {
        turn('year_of_plenty'); const resources = normalizedBag(payload.resources), count = Math.min(2, resourceCount(state.bank));
        requireRule(resourceCount(resources) === count && RESOURCES.every(resource => resources[resource] <= state.bank[resource]), `Choose ${count} available resource cards from the bank.`);
        takeFromBank(next, player, resources); resumeTurn(next); break;
      }
      case 'CHOOSE_MONOPOLY':
        turn('monopoly'); for (const other of next.players) if (other.id !== actorId) { player.resources[payload.resource] += other.resources[payload.resource]; other.resources[payload.resource] = 0; }
        log(next, `${player.name} claimed all ${payload.resource} with Monopoly.`); resumeTurn(next); break;
      case 'BANK_TRADE': {
        turn('main'); requireRule(payload.give !== payload.receive, 'Choose two different resource types.');
        const cost = tradeRatios(state, actorId)[payload.give] * payload.quantity;
        requireRule(state.bank[payload.receive] >= payload.quantity && player.resources[payload.give] >= cost, 'The bank or your hand does not have enough cards.');
        pay(next, player, { [payload.give]: cost }); takeFromBank(next, player, { [payload.receive]: payload.quantity }); next.trade = null;
        log(next, `${player.name} traded with the bank.`); break;
      }
      case 'OFFER_TRADE': {
        requireRule(state.phase === 'main', 'Trade after rolling and resolving the robber.');
        const target = payload.target, active = state.currentPlayerId;
        requireRule(actorId === active ? target === null || (target !== actorId && findPlayer(state, target)?.connected) : target === active, 'Every trade must involve the current player.');
        const give = normalizedBag(payload.give), want = normalizedBag(payload.want);
        requireRule(resourceCount(give) > 0 && resourceCount(want) > 0 && hasResources(player, give), 'Offer resources you own and request at least one card.');
        requireRule(RESOURCES.every(resource => !give[resource] || !want[resource]), 'A trade cannot exchange the same resource in both directions.');
        next.trade = { id: state.revision + 1, proposer: actorId, target, give, want }; log(next, `${player.name} proposed a trade.`); break;
      }
      case 'ACCEPT_TRADE': {
        const offer = state.trade;
        requireRule(state.phase === 'main' && offer && offer.id === payload.offer && offer.proposer !== actorId && (offer.target === null || offer.target === actorId) &&
          (actorId === state.currentPlayerId || offer.proposer === state.currentPlayerId), 'That offer is no longer available to you.');
        const proposer = findPlayer(next, offer.proposer);
        requireRule(hasResources(proposer, offer.give) && hasResources(player, offer.want), 'A player no longer has the offered cards.');
        for (const resource of RESOURCES) { proposer.resources[resource] += offer.want[resource] - offer.give[resource]; player.resources[resource] += offer.give[resource] - offer.want[resource]; }
        next.trade = null; log(next, `${player.name} traded with ${proposer.name}.`); break;
      }
      case 'CANCEL_TRADE':
        requireRule(state.phase === 'main' && state.trade && [state.currentPlayerId, state.trade.proposer, state.trade.target].includes(actorId), 'There is no offer for you to cancel.'); next.trade = null; break;
      case 'END_TURN': {
        turn('main'); const index = state.players.findIndex(p => p.id === actorId);
        next.currentPlayerId = state.players[(index + 1) % state.players.length].id; next.turnNumber++; next.phase = 'roll'; next.developmentPlayed = false;
        next.trade = null; next.dice = null; next.robberRoll = null; next.discards = {}; break;
      }
      default: throw new RuleError('Unknown action.');
    }
    updateAwards(next); checkVictory(next);
  }
  next.revision++; return next;
}

/** Explicit allowlist. Opponent resources, card types and deck order never cross the wire. */
export function buildViewForPlayer(state, id) {
  const me = findPlayer(state, id); requireRule(me, 'Unknown player.');
  const active = state.currentPlayerId === id, main = state.phase === 'main' && active, result = state.phase === 'game_result';
  const counts = pieceCounts(state, id), development = me.development.map(card => ({ id: card.id, type: card.type,
    boughtThisTurn: card.boughtTurn === state.turnNumber, playable: active && ['roll', 'main'].includes(state.phase) && !state.developmentPlayed && card.boughtTurn < state.turnNumber && card.type !== 'victory_point' }));
  const roads = active && (['setup_road', 'road_building'].includes(state.phase) || main && hasResources(me, COSTS.road)) ? legalRoads(state, id, state.phase === 'setup_road' ? state.setupVertex : null) : [];
  const settlements = active && (state.phase === 'setup_settlement' || main && hasResources(me, COSTS.settlement)) ? legalSettlements(state, id, state.phase === 'setup_settlement') : [];
  return {
    revision: state.revision, phase: state.phase, hostId: state.hostId, currentPlayerId: state.currentPlayerId, turnNumber: state.turnNumber, targetScore: state.targetScore,
    players: state.players.map((player, index) => ({ id: player.id, name: player.name, color: COLORS[index], host: player.host, ready: player.ready, connected: player.connected,
      score: result ? totalScore(state, player.id) : publicScore(state, player.id), resourceCount: resourceCount(player.resources), developmentCount: player.development.length,
      knights: player.knights, longestRoad: longestRoad(state, player.id), pieces: pieceCounts(state, player.id),
      ...(result ? { victoryCards: player.development.filter(card => card.type === 'victory_point').length } : {}) })),
    me: { id: me.id, host: me.host, ready: me.ready, resources: { ...me.resources }, development, score: totalScore(state, id),
      pieces: Object.fromEntries(Object.entries(PIECE_LIMITS).map(([kind, limit]) => [kind, limit - counts[kind]])), ratios: tradeRatios(state, id) },
    board: state.board ? structuredClone(state.board) : null, roads: [...state.roads], buildings: structuredClone(state.buildings), bank: { ...state.bank }, developmentRemaining: state.developmentDeck.length,
    playedDevelopment: state.playedDevelopment.map(card => ({ type: card.type, owner: card.owner })), dice: state.dice ? [...state.dice] : null,
    robber: state.robber, robberRoll: state.robberRoll ? structuredClone(state.robberRoll) : null, discards: { ...state.discards }, freeRoads: state.freeRoads,
    setupStep: state.setupStep, setupTotal: state.setupOrder.length, longestRoadOwner: state.longestRoadOwner, largestArmyOwner: state.largestArmyOwner,
    legal: { roads, settlements, cities: main && hasResources(me, COSTS.city) ? legalCities(state, id) : [],
      robberHexes: active && state.phase === 'robber' ? robberDestinations(state) : [], victims: active && state.phase === 'steal' ? robberVictims(state) : [],
      canRoll: active && state.phase === 'roll', canEnd: main, canTrade: state.phase === 'main',
      canBuyDevelopment: main && state.developmentDeck.length > 0 && hasResources(me, COSTS.development) },
    trade: state.trade ? structuredClone(state.trade) : null, canStart: canStart(state), winnerId: state.winnerId,
    log: structuredClone(state.log.slice(-12)), disconnectedNames: [...state.disconnectedNames],
  };
}
export const catanaAdapter = Object.freeze({ createLobby, addPlayer, removePlayer, applyAction, buildViewForPlayer, automaticTransition: () => null });
export const catanaGame = Object.freeze({ id: 'catana', title: 'Catana Codex', peerNamespace: 'catana-v1-', phases: PHASES, adapter: catanaAdapter });
