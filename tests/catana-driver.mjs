/** Deterministic legal-player strategy, shared only by Node/browser tests. Never loaded by the app. */
import { TOPOLOGY } from '../games/catana/board.mjs';
import { createLobby, addPlayer, applyAction, legalSettlements, legalRoads, legalCities, pieceCounts, tradeRatios, robberDestinations, robberVictims } from '../games/catana/game-core.mjs';
import { RESOURCES, TERRAIN_RESOURCE, COSTS, resourceBag, resourceCount } from '../games/catana/constants.mjs';

export function seededRandom(seed = 12345) { return max => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) % max; }; }
const enough = (state, id, cost) => RESOURCES.every(resource => state.players.find(player => player.id === id).resources[resource] >= (cost[resource] ?? 0));
function yieldAt(state, vertex) {
  return TOPOLOGY.vertices[vertex].hexes.reduce((sum, hex) => sum + (state.board.hexes[hex].number ? 6 - Math.abs(7 - state.board.hexes[hex].number) : 0), 0);
}
function expansionEdge(state, id) {
  const legal = legalRoads(state, id), destinations = legalSettlements(state, id, true), reachable = new Set();
  for (const vertex of TOPOLOGY.vertices) if ((state.buildings[vertex.id]?.owner === id || vertex.edges.some(edge => state.roads[edge] === id)) && (!state.buildings[vertex.id] || state.buildings[vertex.id].owner === id)) reachable.add(vertex.id);
  let best;
  for (const start of reachable) {
    const queue = [{ vertex: start, path: [], cost: 0 }], visited = new Map([[start, 0]]);
    while (queue.length) {
      queue.sort((a, b) => a.cost - b.cost); const item = queue.shift();
      if (destinations.includes(item.vertex) && item.path.length) {
        const rank = item.cost * 100 - yieldAt(state, item.vertex);
        if (legal.includes(item.path[0]) && (!best || rank < best.rank)) best = { edge: item.path[0], rank };
        continue;
      }
      if (state.buildings[item.vertex] && state.buildings[item.vertex].owner !== id) continue;
      for (const edge of TOPOLOGY.vertices[item.vertex].edges) {
        if (state.roads[edge] && state.roads[edge] !== id) continue;
        const next = TOPOLOGY.edges[edge].vertices.find(vertex => vertex !== item.vertex), cost = item.cost + (state.roads[edge] === id ? 0 : 1);
        if (cost >= (visited.get(next) ?? Infinity)) continue;
        visited.set(next, cost); queue.push({ vertex: next, cost, path: state.roads[edge] === id ? item.path : [...item.path, edge] });
      }
    }
  }
  return best?.edge ?? legal[0];
}
function goalCost(state, id) {
  if (legalCities(state, id).length) return COSTS.city;
  if (legalSettlements(state, id).length) return COSTS.settlement;
  if (pieceCounts(state, id).settlement < 5 && legalRoads(state, id).length) return COSTS.road;
  if (state.developmentDeck.length) return COSTS.development;
  return COSTS.city;
}
/** A next intent with explicit actor. Does not mutate state or generate game randomness. */
export function nextIntent(state) {
  const id = state.currentPlayerId, player = state.players.find(player => player.id === id), resources = player.resources;
  const intent = (action, payload = {}, actor = id) => ({ actor, type: 'CATANA_ACTION', payload: { action, ...payload } });
  switch (state.phase) {
    case 'setup_settlement': {
      const previousTypes = new Set(state.buildings.flatMap((building, vertex) => building?.owner === id ? TOPOLOGY.vertices[vertex].hexes.map(hex => TERRAIN_RESOURCE[state.board.hexes[hex].terrain]) : []));
      const ranked = legalSettlements(state, id, true).sort((a, b) => {
        const rank = vertex => yieldAt(state, vertex) + TOPOLOGY.vertices[vertex].hexes.reduce((sum, hex) => sum + (!previousTypes.has(TERRAIN_RESOURCE[state.board.hexes[hex].terrain]) ? 4 : 0), 0);
        return rank(b) - rank(a);
      });
      return intent('BUILD_SETTLEMENT', { vertex: ranked[0] });
    }
    case 'setup_road': {
      const legal = legalRoads(state, id, state.setupVertex), edge = legal.sort((a, b) => {
        const rank = edge => { const next = TOPOLOGY.edges[edge].vertices.find(vertex => vertex !== state.setupVertex); return TOPOLOGY.vertices[next].neighbors.reduce((sum, vertex) => sum + (legalSettlements(state, id, true).includes(vertex) ? yieldAt(state, vertex) : 0), 0); };
        return rank(b) - rank(a);
      })[0]; return intent('BUILD_ROAD', { edge });
    }
    case 'discard': {
      const actor = Object.keys(state.discards)[0], player = state.players.find(player => player.id === actor), bag = resourceBag(); let remaining = state.discards[actor];
      const sorted = [...RESOURCES].sort((a, b) => player.resources[b] - player.resources[a]);
      for (const resource of sorted) { const count = Math.min(player.resources[resource], remaining); bag[resource] = count; remaining -= count; } return intent('DISCARD', { resources: bag }, actor);
    }
    case 'robber': {
      const ranked = robberDestinations(state).sort((a, b) => {
        const rank = hex => TOPOLOGY.hexes[hex].vertices.reduce((sum, vertex) => sum + (!state.buildings[vertex] ? 0 : state.buildings[vertex].owner === id ? -8 : 4), 0);
        return rank(b) - rank(a);
      }); return intent('MOVE_ROBBER', { hex: ranked[0] });
    }
    case 'steal': return intent('STEAL', { victim: robberVictims(state)[0] });
    case 'road_building': return legalRoads(state, id).length ? intent('BUILD_ROAD', { edge: expansionEdge(state, id) }) : intent('FINISH_ROADS');
    case 'year_of_plenty': {
      const bag = resourceBag(), cost = goalCost(state, id); let count = Math.min(2, resourceCount(state.bank));
      while (count--) { const resource = RESOURCES.filter(resource => state.bank[resource] > bag[resource]).sort((a, b) => ((cost[b] ?? 0) - resources[b] - bag[b]) - ((cost[a] ?? 0) - resources[a] - bag[a]))[0]; bag[resource]++; }
      return intent('TAKE_PLENTY', { resources: bag });
    }
    case 'monopoly': {
      const resource = [...RESOURCES].sort((a, b) => state.players.reduce((sum, player) => sum + (player.id === id ? 0 : player.resources[b] - player.resources[a]), 0))[0]; return intent('CHOOSE_MONOPOLY', { resource });
    }
    case 'roll': case 'main': {
      const playable = !state.developmentPlayed && player.development.find(card => card.type !== 'victory_point' && card.boughtTurn < state.turnNumber);
      if (playable) return intent('PLAY_DEVELOPMENT', { card: playable.id });
      if (state.phase === 'roll') return intent('ROLL');
      if (enough(state, id, COSTS.city) && legalCities(state, id).length) return intent('BUILD_CITY', { vertex: legalCities(state, id).sort((a, b) => yieldAt(state, b) - yieldAt(state, a))[0] });
      if (enough(state, id, COSTS.settlement) && legalSettlements(state, id).length) return intent('BUILD_SETTLEMENT', { vertex: legalSettlements(state, id).sort((a, b) => yieldAt(state, b) - yieldAt(state, a))[0] });
      if (enough(state, id, COSTS.road) && legalRoads(state, id).length && pieceCounts(state, id).settlement < 5) return intent('BUILD_ROAD', { edge: expansionEdge(state, id) });
      if (enough(state, id, COSTS.development) && state.developmentDeck.length) return intent('BUY_DEVELOPMENT');
      const cost = goalCost(state, id), ratios = tradeRatios(state, id);
      const wanted = RESOURCES.filter(resource => resources[resource] < (cost[resource] ?? 0) && state.bank[resource] > 0);
      for (const receive of wanted) {
        const give = [...RESOURCES].filter(resource => resource !== receive && resources[resource] - (cost[resource] ?? 0) >= ratios[resource]).sort((a, b) => resources[b] - resources[a])[0];
        if (give) return intent('BANK_TRADE', { give, receive, quantity: 1 });
      }
      return intent('END_TURN');
    }
    default: return null;
  }
}
export function simulateMatch(count, seed, onState = () => {}) {
  const pick = seededRandom(seed); let state = createLobby('host', 'Host');
  for (let i = 1; i < count; i++) { const id = `player${i}`; state = addPlayer(state, id, id); state = applyAction(state, id, 'SET_READY', { ready: true }, pick); }
  state = applyAction(state, 'host', 'START_GAME', {}, pick); onState(state);
  const phases = new Set(); let actions = 0;
  while (state.phase !== 'game_result' && actions < 10000) { phases.add(state.phase); const next = nextIntent(state); if (!next) throw new Error(`Stalled in ${state.phase}`); state = applyAction(state, next.actor, next.type, next.payload, pick); actions++; onState(state); }
  return { state, actions, phases };
}
