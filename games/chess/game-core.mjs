import { Chess, DEFAULT_POSITION } from './vendor/chess.mjs';
import { randomInt, validateName } from '../../shared/random.mjs';
import { isChessAction } from './action-schema.mjs';

export { DEFAULT_POSITION };
export const PHASES = Object.freeze(['lobby', 'playing', 'game_result', 'disconnected']);
const now = () => performance.now();
const requireRule = (condition, text) => { if (!condition) throw new Error(text); };
const other = color => color === 'w' ? 'b' : 'w';
const positionKey = fen => fen.split(' ').slice(0, 4).join(' ');
const player = (id, name, host = false) => ({ id, name: validateName(name), host, ready: host, connected: true, color: null });

export function createLobby(hostId, name) {
  return { revision: 0, phase: 'lobby', hostId, players: [player(hostId, name, true)],
    settings: { hostColor: 'random', minutes: 0 }, fen: DEFAULT_POSITION, history: [], positions: {},
    clock: null, result: null, drawOffer: null, disconnectedNames: [] };
}
export const canStart = state => state.phase === 'lobby' && state.players.length === 2 && state.players.every(p => p.connected && p.ready);
export function addPlayer(state, id, name) {
  requireRule(state.phase === 'lobby' && state.players.length < 2, 'This chess table already has two players or a game in progress.');
  requireRule(typeof id === 'string' && !state.players.some(p => p.id === id), 'Player already joined.');
  const next = structuredClone(state); next.players.push(player(id, name)); next.revision++; return next;
}
export function remainingClock(state, at = now()) {
  if (!state.clock) return null;
  const { w, b, running, since } = state.clock, clock = { w, b, running };
  if (state.phase === 'playing' && running) clock[running] = Math.max(0, clock[running] - Math.max(0, at - since));
  return clock;
}
function settle(state, at) {
  if (!state.clock) return;
  const clock = remainingClock(state, at); state.clock = { ...clock, since: at };
}
function finish(state, reason, winnerColor = null) {
  state.phase = 'game_result'; state.drawOffer = null;
  state.result = { reason, winnerColor, winnerId: state.players.find(p => p.color === winnerColor)?.id ?? null };
  if (state.clock) state.clock.running = null;
}
/** A bare king cannot win on time; same-color bishops cannot create a mating position. */
export function canPossiblyMate(chess, color) {
  const pieces = chess.board().flat().filter(p => p && p.type !== 'k');
  const mine = pieces.filter(p => p.color === color);
  if (!mine.length) return false;
  if (mine.length === 1 && ['b', 'n'].includes(mine[0].type) && pieces.length === 1) return false;
  if (pieces.every(p => p.type === 'b')) {
    const colors = new Set(pieces.map(p => (p.square.charCodeAt(0) + Number(p.square[1])) % 2));
    if (colors.size === 1) return false;
  }
  return true;
}
export function adjudicate(state, chess = new Chess(state.fen)) {
  if (chess.isCheckmate()) finish(state, 'checkmate', other(chess.turn()));
  else if (chess.isStalemate()) finish(state, 'stalemate');
  else if (chess.isInsufficientMaterial()) finish(state, 'insufficient_material');
  else if ((state.positions[positionKey(state.fen)] ?? 0) >= 5) finish(state, 'fivefold_repetition');
  else if (Number(state.fen.split(' ')[4]) >= 150) finish(state, 'seventy_five_moves');
}
export function expireClock(state, at = now()) {
  if (state.phase !== 'playing' || !state.clock) return state;
  const clock = remainingClock(state, at), loser = state.clock.running;
  if (!loser || clock[loser] > 0) return state;
  const next = structuredClone(state); settle(next, at);
  const winner = other(loser), canWin = canPossiblyMate(new Chess(next.fen), winner);
  finish(next, canWin ? 'timeout' : 'timeout_insufficient_material', canWin ? winner : null);
  next.revision++; return next;
}
export function removePlayer(state, id, at = now()) {
  if (id === state.hostId || !state.players.some(p => p.id === id && p.connected)) return state;
  const next = structuredClone(state); settle(next, at);
  if (next.phase === 'lobby') next.players = next.players.filter(p => p.id !== id);
  else { next.players.find(p => p.id === id).connected = false; next.disconnectedNames = [next.players.find(p => p.id === id).name]; next.phase = 'disconnected'; if (next.clock) next.clock.running = null; }
  next.revision++; return next;
}
export function applyAction(state, actorId, type, payload = {}, pick = randomInt, at = now()) {
  const actor = state.players.find(p => p.id === actorId && p.connected);
  requireRule(actor, 'You are no longer at this table.');
  const hostOnly = () => requireRule(actor.host, 'Only the host can change this.');
  const next = structuredClone(state);
  if (type === 'SET_READY') {
    requireRule(state.phase === 'lobby' && !actor.host && typeof payload.ready === 'boolean', 'Ready is only available to the guest in the lobby.');
    next.players.find(p => p.id === actorId).ready = payload.ready;
  } else if (type === 'START_GAME') {
    hostOnly(); requireRule(canStart(state), 'Both players must be connected and ready.');
    const hostColor = state.settings.hostColor === 'random' ? (pick(2) === 0 ? 'w' : 'b') : state.settings.hostColor;
    next.players.forEach(p => { p.color = p.host ? hostColor : other(hostColor); });
    next.phase = 'playing'; next.fen = DEFAULT_POSITION; next.history = []; next.result = null; next.drawOffer = null;
    next.positions = { [positionKey(DEFAULT_POSITION)]: 1 };
    const time = state.settings.minutes * 60000;
    next.clock = time ? { w: time, b: time, running: 'w', since: at } : null;
  } else if (type === 'PLAY_AGAIN' || type === 'RETURN_TO_LOBBY') {
    hostOnly(); requireRule(['game_result', 'disconnected'].includes(state.phase), 'Finish this game first.');
    const lobby = createLobby(state.hostId, state.players.find(p => p.host).name);
    lobby.settings = { ...state.settings }; lobby.players = state.players.filter(p => p.connected).map(p => player(p.id, p.name, p.host));
    lobby.revision = state.revision + 1; return lobby;
  } else if (type === 'CHESS_ACTION') {
    requireRule(isChessAction(payload), 'Invalid chess action.');
    if (payload.action === 'SETTINGS') {
      hostOnly(); requireRule(state.phase === 'lobby', 'Settings are fixed while the game is running.');
      next.settings = { hostColor: payload.hostColor, minutes: payload.minutes };
      next.players.forEach(p => { p.ready = p.host; });
    } else {
      requireRule(state.phase === 'playing', 'This game is not accepting moves.');
      const expired = expireClock(state, at); if (expired !== state) return expired;
      const chess = new Chess(state.fen); settle(next, at);
      switch (payload.action) {
        case 'MOVE': {
          requireRule(actor.color === chess.turn(), 'Please wait for your turn.');
          let move; try { move = chess.move({ from: payload.from, to: payload.to, ...(payload.promotion ? { promotion: payload.promotion } : {}) }); }
          catch { throw new Error('That move is not legal. Your king must stay safe.'); }
          next.fen = chess.fen();
          next.history.push({ ply: state.history.length + 1, from: move.from, to: move.to, san: move.san, color: move.color, piece: move.piece, captured: move.captured ?? null, promotion: move.promotion ?? null });
          const key = positionKey(next.fen); next.positions[key] = (next.positions[key] ?? 0) + 1;
          // An offer remains available until the recipient plays or explicitly declines.
          if (next.drawOffer !== actorId) next.drawOffer = null;
          if (next.clock) next.clock.running = chess.turn();
          adjudicate(next, chess); break;
        }
        case 'RESIGN': { const winner = other(actor.color), canWin = canPossiblyMate(chess, winner); finish(next, canWin ? 'resignation' : 'resignation_insufficient_material', canWin ? winner : null); break; }
        case 'OFFER_DRAW': requireRule(!state.drawOffer, 'A draw offer is already pending.'); next.drawOffer = actorId; break;
        case 'ACCEPT_DRAW': requireRule(state.drawOffer && state.drawOffer !== actorId, 'There is no draw offer for you.'); finish(next, 'agreement'); break;
        case 'DECLINE_DRAW': requireRule(state.drawOffer && state.drawOffer !== actorId, 'There is no draw offer for you.'); next.drawOffer = null; break;
        case 'CLAIM_DRAW':
          requireRule(actor.color === chess.turn(), 'Claim a draw on your own turn.');
          if ((state.positions[positionKey(state.fen)] ?? 0) >= 3) finish(next, 'threefold_repetition');
          else { requireRule(Number(state.fen.split(' ')[4]) >= 100, 'A draw cannot be claimed in this position.'); finish(next, 'fifty_moves'); } break;
      }
    }
  } else throw new Error('Unknown action.');
  next.revision++; return next;
}
export function buildViewForPlayer(state, id, at = now()) {
  const me = state.players.find(p => p.id === id); requireRule(me, 'Unknown player.');
  const chess = new Chess(state.fen), myTurn = state.phase === 'playing' && me.color === chess.turn();
  return { revision: state.revision, phase: state.phase, hostId: state.hostId,
    players: state.players.map(p => ({ ...p })), me: { ...me }, settings: { ...state.settings }, fen: state.fen,
    board: chess.board().flat().filter(Boolean), turn: chess.turn(), myTurn,
    legalMoves: myTurn ? chess.moves({ verbose: true }).map(m => ({ from: m.from, to: m.to, promotion: m.promotion ?? null, capture: m.isCapture() || m.isEnPassant() })) : [],
    check: state.phase !== 'lobby' && chess.isCheck(),
    checkedKing: chess.isCheck() ? chess.board().flat().find(p => p?.type === 'k' && p.color === chess.turn()).square : null,
    history: state.history.slice(-80).map(m => ({ ...m })), ply: state.history.length,
    clock: remainingClock(state, at), result: state.result ? { ...state.result } : null, drawOffer: state.drawOffer,
    canClaimDraw: myTurn && ((state.positions[positionKey(state.fen)] ?? 0) >= 3 || Number(state.fen.split(' ')[4]) >= 100),
    canStart: canStart(state), disconnectedNames: [...state.disconnectedNames] };
}
export function automaticTransition(state, at = now()) {
  if (state.phase !== 'playing' || !state.clock?.running) return null;
  return { delay: remainingClock(state, at)[state.clock.running], apply: expireClock };
}
export const chessAdapter = Object.freeze({ createLobby, addPlayer, removePlayer, applyAction, buildViewForPlayer, automaticTransition });
export const chessGame = Object.freeze({ id: 'chess', title: 'CHESS', peerNamespace: 'chess-v1-', phases: PHASES, adapter: chessAdapter });
