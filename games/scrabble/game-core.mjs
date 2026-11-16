import { randomInt, validateName } from '../../shared/random.mjs';
import { makeBag, shuffle, letterValue } from './constants.mjs';
import { evaluateMove } from './rules.mjs';
import { isScrabbleAction } from './action-schema.mjs';
export const PHASES = Object.freeze(['lobby', 'playing', 'game_result', 'disconnected']);
export const DEFAULT_SETTINGS = Object.freeze({ language: 'pl', seconds: 0 });
const requireRule = (condition, text) => { if (!condition) throw new Error(text); };
const player = (id, name, host = false) => ({ id, name: validateName(name), host, ready: host, connected: true, score: 0 });
export function createLobby(hostId, name, solo = false) {
  return { revision: 0, phase: 'lobby', solo, hostId, players: [player(hostId, name, true)], settings: { ...DEFAULT_SETTINGS },
    board: Array(225).fill(null), racks: {}, bag: [], turnIndex: 0, turnSerial: 0, endsAt: null, scoreless: 0, history: [], result: null, disconnectedNames: [] };
}
export const canStart = state => state.phase === 'lobby' && state.players.length >= (state.solo ? 1 : 2) && state.players.every(p => p.connected && p.ready);
export function createScrabbleGame({ solo = false, now = () => performance.now(), pick = randomInt } = {}) {
  let dictionary = null, dictionaryLanguage = null;
  const stageDictionary = (data, language) => { dictionary = data; dictionaryLanguage = language; };
  function addPlayer(state, id, name) {
    requireRule(!state.solo && state.phase === 'lobby' && state.players.length < 4, 'This table is full or already playing.');
    requireRule(typeof id === 'string' && !state.players.some(p => p.id === id), 'Player already joined.');
    return { ...state, revision: state.revision + 1, players: [...state.players, player(id, name)] };
  }
  function removePlayer(state, id) {
    if (id === state.hostId || !state.players.some(p => p.id === id && p.connected)) return state;
    const next = structuredClone(state); next.revision++;
    if (state.phase === 'lobby') next.players = next.players.filter(p => p.id !== id);
    else { next.players.find(p => p.id === id).connected = false; next.phase = 'disconnected'; next.endsAt = null; next.disconnectedNames = [state.players.find(p => p.id === id).name]; }
    return next;
  }
  function draw(state, id) {
    while (state.racks[id].length < 7 && state.bag.length) state.racks[id].push(state.bag.pop());
  }
  function finish(state, reason, emptiedId = null) {
    const adjustments = state.players.map(p => ({ id: p.id, remaining: state.racks[p.id].reduce((sum, tile) => sum + letterValue(state.settings.language, tile.letter), 0) }));
    const gained = adjustments.reduce((sum, p) => sum + p.remaining, 0);
    for (const p of state.players) p.score += (p.id === emptiedId && !state.solo ? gained : 0) - adjustments.find(a => a.id === p.id).remaining;
    const high = Math.max(...state.players.map(p => p.score));
    state.result = { reason, winnerIds: state.players.filter(p => p.score === high).map(p => p.id), adjustments };
    state.phase = 'game_result'; state.endsAt = null;
  }
  function record(state, entry) { state.history.push({ ...entry, serial: state.turnSerial, playerId: state.players[state.turnIndex].id }); state.history = state.history.slice(-100); }
  function advance(state, at) {
    if (state.scoreless >= 6) { finish(state, 'scoreless'); return; }
    state.turnIndex = (state.turnIndex + 1) % state.players.length;
    state.turnSerial++; state.endsAt = state.settings.seconds ? at + state.settings.seconds * 1000 : null;
  }
  function expire(state, at = now()) {
    if (state.phase !== 'playing' || state.endsAt === null || at < state.endsAt) return state;
    const next = structuredClone(state); record(next, { kind: 'timeout', points: 0 }); next.scoreless++; advance(next, at); next.revision++; return next;
  }
  function applyAction(state, actorId, type, payload = {}) {
    const at = now(), actor = state.players.find(p => p.id === actorId && p.connected);
    requireRule(actor, 'You are no longer at this table.');
    const hostOnly = () => requireRule(actor.host, 'Only the host can change this.');
    const next = structuredClone(state);
    if (type === 'SET_READY') {
      requireRule(state.phase === 'lobby' && !actor.host && typeof payload.ready === 'boolean', 'Ready is available to guests in the lobby.');
      next.players.find(p => p.id === actorId).ready = payload.ready;
    } else if (type === 'START_GAME') {
      hostOnly(); requireRule(canStart(state), 'Wait until all players are ready.');
      requireRule(dictionary && dictionaryLanguage === state.settings.language, 'Load the dictionary before starting.');
      next.phase = 'playing'; next.bag = makeBag(state.settings.language, pick); next.racks = Object.fromEntries(next.players.map(p => [p.id, []]));
      next.players.forEach(p => draw(next, p.id)); next.turnIndex = pick(next.players.length); next.turnSerial = state.turnSerial + 1;
      next.endsAt = state.settings.seconds ? at + state.settings.seconds * 1000 : null;
    } else if (type === 'PLAY_AGAIN' || type === 'RETURN_TO_LOBBY') {
      hostOnly(); requireRule(['game_result', 'disconnected'].includes(state.phase), 'Finish the current game first.');
      return { ...createLobby(state.hostId, state.players.find(p => p.host).name, state.solo), revision: state.revision + 1, turnSerial: state.turnSerial,
        settings: { ...state.settings }, players: state.players.filter(p => p.connected).map(p => player(p.id, p.name, p.host)) };
    } else {
      requireRule(type === 'SCRABBLE_ACTION' && isScrabbleAction(payload), 'Invalid Scrabble action.');
      if (payload.action === 'SETTINGS') {
        hostOnly(); requireRule(state.phase === 'lobby', 'Settings are fixed during play.');
        next.settings = { language: payload.language, seconds: payload.seconds }; next.players.forEach(p => { p.ready = p.host; });
      } else {
        requireRule(state.phase === 'playing', 'The game is not accepting moves.');
        const expired = expire(state, at); if (expired !== state) return expired;
        requireRule(state.players[state.turnIndex].id === actorId && payload.turn === state.turnSerial, 'Wait for your turn.');
        if (payload.action === 'PLAY') {
          requireRule(dictionary && dictionaryLanguage === state.settings.language, 'The dictionary is unavailable.');
          const scored = evaluateMove(state.board, state.racks[actorId], payload.placements, state.settings.language, dictionary);
          next.board = scored.board; next.racks[actorId] = next.racks[actorId].filter(tile => !payload.placements.some(p => p.tileId === tile.id));
          next.players.find(p => p.id === actorId).score += scored.points; next.scoreless = scored.points ? 0 : state.scoreless + 1;
          record(next, { kind: 'play', points: scored.points, bonus: scored.bonus, words: scored.words, indices: payload.placements.map(p => p.index) }); draw(next, actorId);
          if (!next.bag.length && !next.racks[actorId].length) finish(next, 'emptied', actorId); else advance(next, at);
        } else if (payload.action === 'EXCHANGE') {
          requireRule(state.bag.length >= 7, 'At least seven tiles must remain in the bag to exchange.');
          const ids = new Set(payload.tileIds), returned = next.racks[actorId].filter(tile => ids.has(tile.id));
          requireRule(ids.size === payload.tileIds.length && returned.length === ids.size, 'Select tiles from your own rack.');
          next.racks[actorId] = next.racks[actorId].filter(tile => !ids.has(tile.id));
          // Draw first: an exchanged tile cannot immediately be drawn back.
          for (let i = 0; i < returned.length; i++) next.racks[actorId].push(next.bag.pop());
          next.bag = shuffle([...next.bag, ...returned], pick); record(next, { kind: 'exchange', count: returned.length, points: 0 }); next.scoreless++; advance(next, at);
        } else if (payload.action === 'PASS') {
          record(next, { kind: 'pass', points: 0 }); next.scoreless++; advance(next, at);
        } else {
          requireRule(state.solo, 'Ending practice is available only in solo mode.'); finish(next, 'practice');
        }
      }
    }
    next.revision++; return next;
  }
  function buildViewForPlayer(state, id) {
    const me = state.players.find(p => p.id === id); requireRule(me, 'Unknown player.');
    return { revision: state.revision, phase: state.phase, solo: state.solo, hostId: state.hostId, me: { ...me }, settings: { ...state.settings },
      players: state.players.map(p => ({ ...p, tileCount: state.racks[p.id]?.length ?? 0 })), board: structuredClone(state.board), rack: structuredClone(state.racks[id] ?? []),
      bagCount: state.bag.length, turnId: state.players[state.turnIndex].id, turnSerial: state.turnSerial, myTurn: state.phase === 'playing' && state.players[state.turnIndex].id === id,
      remainingMs: state.endsAt === null ? null : Math.max(0, state.endsAt - now()), scoreless: state.scoreless, history: structuredClone(state.history),
      result: structuredClone(state.result), canStart: canStart(state), disconnectedNames: [...state.disconnectedNames],
      finalRacks: state.phase === 'game_result' ? Object.fromEntries(state.players.map(p => [p.id, structuredClone(state.racks[p.id])])) : null };
  }
  function automaticTransition(state) { return state.phase === 'playing' && state.endsAt !== null ? { delay: Math.max(0, state.endsAt - now()), apply: expire } : null; }
  return Object.freeze({ id: 'scrabble', title: 'Scrabble', peerNamespace: 'scrabble-v1-', phases: PHASES, stageDictionary, maxStateMessageLength: 131072,
    adapter: Object.freeze({ createLobby: (id, name) => createLobby(id, name, solo), addPlayer, removePlayer, applyAction, buildViewForPlayer, automaticTransition }) });
}
