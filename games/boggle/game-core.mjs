import { validateName } from '../../shared/random.mjs';
import { isBoggleAction } from './action-schema.mjs';
import { isWord, validPath } from './dictionary.mjs';

export const PHASES = Object.freeze(['lobby', 'countdown', 'playing', 'round_result', 'game_result', 'disconnected']);
export const DEFAULT_SETTINGS = Object.freeze({ language: 'pl', size: 4, minLength: 3, seconds: 180, rounds: 3 });
const rule = (condition, text) => { if (!condition) throw new Error(text); };
const player = (id, name, host = false) => ({ id, name: validateName(name), host, ready: host, connected: true, total: 0 });
export const pointsFor = length => length < 3 ? 0 : length < 5 ? 1 : length === 5 ? 2 : length === 6 ? 3 : length === 7 ? 5 : 11;
export const canStart = state => state.phase === 'lobby' && state.players.length >= 2 && state.players.every(p => p.connected && p.ready);
export function createLobby(hostId, name) {
  return { revision: 0, phase: 'lobby', hostId, players: [player(hostId, name, true)], settings: { ...DEFAULT_SETTINGS },
    round: 0, roundSerial: 0, board: [], solutions: new Map(), submissions: {}, startsAt: 0, endsAt: 0, results: [], result: null, disconnectedNames: [] };
}
export function addPlayer(state, id, name) {
  rule(state.phase === 'lobby' && state.players.length < 6, 'This room is full or a game is already in progress.');
  rule(typeof id === 'string' && !state.players.some(p => p.id === id), 'Player already joined.');
  return { ...state, revision: state.revision + 1, players: [...state.players, player(id, name)] };
}
export function removePlayer(state, id) {
  if (id === state.hostId || !state.players.some(p => p.id === id && p.connected)) return state;
  if (state.phase === 'lobby') return { ...state, revision: state.revision + 1, players: state.players.filter(p => p.id !== id) };
  return { ...state, revision: state.revision + 1, phase: 'disconnected',
    players: state.players.map(p => p.id === id ? { ...p, connected: false } : p), disconnectedNames: [state.players.find(p => p.id === id).name] };
}

function finishRound(state, now) {
  const counts = new Map();
  for (const words of Object.values(state.submissions)) for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
  const scores = state.players.map(p => {
    const words = state.submissions[p.id].map(word => ({ word, shared: counts.get(word) > 1, points: counts.get(word) > 1 ? 0 : pointsFor(word.length) }));
    return { id: p.id, name: p.name, words, score: words.reduce((sum, entry) => sum + entry.points, 0) };
  });
  let longestLength = 0;
  for (const word of state.solutions.keys()) longestLength = Math.max(longestLength, word.length);
  const longest = [...state.solutions].filter(([word]) => word.length === longestLength).sort(([a], [b]) => a.localeCompare(b, state.settings.language)).slice(0, 5)
    .map(([word, path]) => ({ word, path: [...path], foundBy: scores.filter(p => p.words.some(entry => entry.word === word)).map(p => p.id) }));
  const players = state.players.map(p => ({ ...p, total: p.total + scores.find(score => score.id === p.id).score }));
  const best = Math.max(...players.map(p => p.total)), final = state.round === state.settings.rounds;
  const result = { round: state.round, scores, longest, board: [...state.board] };
  return { ...state, revision: state.revision + 1, phase: final ? 'game_result' : 'round_result', players, result,
    results: [...state.results, { round: state.round, scores: scores.map(({ id, score }) => ({ id, score })) }],
    nextAt: now + 3000, winnerIds: final ? players.filter(p => p.total === best).map(p => p.id) : [] };
}

/** Prepared solutions stay exclusively on the authoritative host; never sent as an intent. */
export function createBoggleGame({ now = () => performance.now() } = {}) {
  let prepared = null;
  const stageRound = round => { prepared = round; };
  function begin(state, timestamp) {
    const data = prepared; prepared = null;
    rule(data && data.dictionaryVersion === 'boggle1' && Object.entries(state.settings).every(([key, value]) => data.settings[key] === value), 'Prepare the dictionary and board before starting.');
    rule(Array.isArray(data.board) && data.board.length === state.settings.size ** 2 && data.board.every(letter => isWord(letter) && letter.length === 1), 'Invalid prepared board.');
    const solutions = new Map(data.solutions);
    rule(solutions.size > 0 && [...solutions].every(([word, path]) => isWord(word) && word.length >= state.settings.minLength && validPath(data.board, state.settings.size, path, word)), 'Invalid prepared dictionary paths.');
    return { ...state, revision: state.revision + 1, phase: 'countdown', round: state.round + 1, roundSerial: state.roundSerial + 1, board: [...data.board], solutions,
      submissions: Object.fromEntries(state.players.map(p => [p.id, []])), startsAt: timestamp + 4000, endsAt: timestamp + 4000 + state.settings.seconds * 1000, result: null };
  }
  function applyAction(state, actorId, type, payload = {}) {
    const timestamp = now(), actor = state.players.find(p => p.id === actorId && p.connected);
    rule(actor, 'You are no longer in this room.');
    const hostOnly = () => rule(actor.host, 'Only the host can do that.');
    if (type === 'SET_READY') {
      rule(state.phase === 'lobby' && !actor.host && typeof payload.ready === 'boolean', 'Ready is available to guests in the lobby.');
      return { ...state, revision: state.revision + 1, players: state.players.map(p => p.id === actorId ? { ...p, ready: payload.ready } : p) };
    }
    if (type === 'START_GAME' || type === 'NEXT_HAND') {
      hostOnly();
      rule(type === 'START_GAME' ? canStart(state) : state.phase === 'round_result' && timestamp >= state.nextAt, 'Wait until everyone is ready or the results countdown has finished.');
      return begin(state, timestamp);
    }
    if (type === 'PLAY_AGAIN' || type === 'RETURN_TO_LOBBY') {
      hostOnly(); rule(['game_result', 'disconnected'].includes(state.phase), 'Finish the game first.');
      rule(state.phase !== 'game_result' || timestamp >= state.nextAt, 'Take a breath before the next game.');
      prepared = null;
      const lobby = createLobby(state.hostId, state.players.find(p => p.host).name);
      return { ...lobby, revision: state.revision + 1, roundSerial: state.roundSerial, settings: { ...state.settings }, players: state.players.filter(p => p.connected).map(p => player(p.id, p.name, p.host)) };
    }
    rule(type === 'BOGGLE_ACTION' && isBoggleAction(payload), 'Invalid word game action.');
    if (payload.action === 'SETTINGS') {
      hostOnly(); rule(state.phase === 'lobby', 'Settings are fixed during the game.');
      const { action, ...settings } = payload;
      prepared = null;
      return { ...state, revision: state.revision + 1, settings, players: state.players.map(p => ({ ...p, ready: p.host })) };
    }
    rule(state.phase === 'playing' && timestamp >= state.startsAt && timestamp < state.endsAt && payload.round === state.roundSerial, 'This round is not accepting words.');
    rule(payload.word.length >= state.settings.minLength, `Use at least ${state.settings.minLength} letters.`);
    rule(state.solutions.has(payload.word), 'That word is not in this dictionary or cannot be traced on the board.');
    const words = state.submissions[actorId];
    rule(!words.includes(payload.word), 'You already found that word.');
    rule(words.length < 250, 'You have reached the 250-word limit for this round.');
    return { ...state, revision: state.revision + 1, submissions: { ...state.submissions, [actorId]: [...words, payload.word] } };
  }
  function buildViewForPlayer(state, id) {
    const me = state.players.find(p => p.id === id); rule(me, 'Unknown player.');
    const timestamp = now();
    return { revision: state.revision, phase: state.phase, hostId: state.hostId, me: { ...me }, players: state.players.map(p => ({ ...p })),
      settings: { ...state.settings }, round: state.round, roundSerial: state.roundSerial, board: state.phase === 'countdown' ? [] : [...state.board],
      remainingMs: Math.max(0, (state.phase === 'countdown' ? state.startsAt : state.endsAt) - timestamp),
      nextInMs: Math.max(0, (state.nextAt ?? 0) - timestamp), myWords: [...(state.submissions[id] ?? [])],
      result: state.result ? structuredClone(state.result) : null, results: structuredClone(state.results),
      winnerIds: [...(state.winnerIds ?? [])], canStart: canStart(state), disconnectedNames: [...state.disconnectedNames] };
  }
  function automaticTransition(state) {
    if (state.phase === 'countdown') return { delay: Math.max(0, state.startsAt - now()), apply: snapshot => ({ ...snapshot, phase: 'playing', revision: snapshot.revision + 1 }) };
    if (state.phase === 'playing') return { delay: Math.max(0, state.endsAt - now()), apply: snapshot => finishRound(snapshot, now()) };
    return null;
  }
  return Object.freeze({ id: 'boggle', title: 'Boggle', peerNamespace: 'boggle-v1-', phases: PHASES, stageRound, maxStateMessageLength: 262144,
    // Simultaneous word intents tolerate other players' newer submissions. The round token and
    // authoritative deadline still reject delayed actions from a previous round.
    acceptsConcurrentAction: (type, payload) => type === 'BOGGLE_ACTION' && payload.action === 'SUBMIT',
    adapter: Object.freeze({ createLobby, addPlayer, removePlayer, applyAction, buildViewForPlayer, automaticTransition }) });
}
