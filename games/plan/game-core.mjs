import { createDeck, shuffleDeck, dealHand } from './cards.mjs';
import { randomInt, validateName } from '../../shared/random.mjs';
export { createDeck, shuffleDeck, dealHand } from './cards.mjs';

export const HAND_SIZES = Object.freeze([5, 4, 3, 2, 1, 1]);
export const PHASES = Object.freeze(['lobby', 'bidding', 'playing', 'trick_result', 'hand_result', 'game_result', 'disconnected']);

export class RuleError extends Error {
  constructor(message) { super(message); this.name = 'RuleError'; }
}
function requireRule(condition, message) { if (!condition) throw new RuleError(message); }
export const advanceDealer = (index, count) => (index + 1) % count;
export const getNextPlayer = (players, playerId) => players[(players.findIndex(p => p.id === playerId) + 1) % players.length];
export const calculateHandScore = (bid, won) => bid === won ? 10 + bid : -Math.abs(bid - won);

export function getForbiddenFinalBid(bids, handSize) {
  const missing = bids.filter(bid => bid === null).length;
  if (missing !== 1) return null;
  const forbidden = handSize - bids.reduce((sum, bid) => sum + (bid ?? 0), 0);
  return forbidden >= 0 && forbidden <= handSize ? forbidden : null;
}

export function getLegalCards(hand, leadSuit = null) {
  const following = hand.filter(card => card.suit === leadSuit);
  return following.length ? following : hand;
}
export const isLegalPlay = (hand, cardId, leadSuit = null) => getLegalCards(hand, leadSuit).some(card => card.id === cardId);

export function getTrickWinner(trick, trumpSuit) {
  requireRule(trick.length > 0, 'A trick must contain a card.');
  const lead = trick[0].card.suit;
  const strength = card => (card.suit === trumpSuit ? 200 : card.suit === lead ? 100 : 0) + card.value;
  return trick.reduce((best, entry) => strength(entry.card) > strength(best.card) ? entry : best).playerId;
}

function makePlayer(id, name, host = false) {
  return { id, name: validateName(name), host, ready: host, connected: true, hand: [], bid: null, tricksWon: 0, totalScore: 0, history: [] };
}

export function createLobby(hostId, name) {
  return {
    revision: 0, phase: 'lobby', hostId, players: [makePlayer(hostId, name, true)],
    handNumber: 0, handSize: 0, blind: false, dealerIndex: 0, currentPlayerId: null,
    trumpCard: null, trumpSuit: null, trick: [], trickNumber: 0, trickWinnerId: null,
    handResults: [], disconnectedNames: [],
  };
}

export function addPlayer(state, id, name) {
  requireRule(state.phase === 'lobby', 'Game already started.');
  requireRule(state.players.length < 6, 'Room is full.');
  requireRule(typeof id === 'string' && !state.players.some(p => p.id === id), 'Player already joined.');
  const next = structuredClone(state);
  next.players.push(makePlayer(id, name));
  next.revision++;
  return next;
}

export function removePlayer(state, id) {
  const player = state.players.find(p => p.id === id);
  if (!player || !player.connected || id === state.hostId) return state;
  const next = structuredClone(state);
  if (next.phase === 'lobby') next.players = next.players.filter(p => p.id !== id);
  else {
    next.players.find(p => p.id === id).connected = false;
    next.phase = 'disconnected';
    next.currentPlayerId = null;
    next.disconnectedNames.push(player.name);
  }
  next.revision++;
  return next;
}

export function canStart(state) {
  return state.phase === 'lobby' && state.players.length >= 2 && state.players.length <= 6 &&
    state.players.every(p => p.connected && (p.host || p.ready));
}

function setupHand(state, pick) {
  state.handSize = HAND_SIZES[state.handNumber - 1];
  state.blind = state.handNumber === 6;
  const deal = dealHand(shuffleDeck(createDeck(), pick), state.players.length, state.handSize, state.dealerIndex);
  state.players.forEach((player, i) => { player.hand = deal.hands[i]; player.bid = null; player.tricksWon = 0; });
  state.trumpCard = deal.trumpCard;
  state.trumpSuit = deal.trumpCard.suit;
  state.trick = [];
  state.trickNumber = 1;
  state.trickWinnerId = null;
  state.handResults = [];
  state.currentPlayerId = state.players[advanceDealer(state.dealerIndex, state.players.length)].id;
  state.phase = 'bidding';
}

function startGame(state, pick) {
  state.players.forEach(player => { player.totalScore = 0; player.history = []; });
  state.handNumber = 1;
  state.dealerIndex = pick(state.players.length);
  state.disconnectedNames = [];
  setupHand(state, pick);
}

/** The only entry point for player intents. Never takes player identity from a payload. */
export function applyAction(state, actorId, type, payload = {}, pick = randomInt) {
  const actor = state.players.find(p => p.id === actorId);
  requireRule(actor?.connected, 'Player is not connected.');
  requireRule(payload !== null && typeof payload === 'object' && !Array.isArray(payload), 'Invalid action.');
  const next = structuredClone(state);
  const player = next.players.find(p => p.id === actorId);
  const hostOnly = () => requireRule(actorId === state.hostId, 'Only the host can do that.');
  const turn = phase => {
    requireRule(state.phase === phase, 'That action is not available right now.');
    requireRule(state.currentPlayerId === actorId, 'Please wait for your turn.');
  };
  switch (type) {
    case 'SET_READY':
      requireRule(state.phase === 'lobby' && !player.host && typeof payload.ready === 'boolean', 'Ready is only available to guests in the lobby.');
      player.ready = payload.ready;
      break;
    case 'START_GAME':
      hostOnly();
      requireRule(canStart(state), 'At least two players must be connected and all guests ready.');
      startGame(next, pick);
      break;
    case 'PLACE_BID': {
      turn('bidding');
      const { bid } = payload;
      requireRule(player.bid === null && Number.isInteger(bid) && bid >= 0 && bid <= state.handSize, `Choose a whole number from 0 to ${state.handSize}.`);
      const forbidden = getForbiddenFinalBid(state.players.map(p => p.bid), state.handSize);
      requireRule(bid !== forbidden, `You can't bid ${bid} — total bids may not equal ${state.handSize}.`);
      player.bid = bid;
      if (next.players.every(p => p.bid !== null)) {
        next.phase = 'playing';
        next.currentPlayerId = next.players[advanceDealer(next.dealerIndex, next.players.length)].id;
      } else next.currentPlayerId = getNextPlayer(next.players, actorId).id;
      break;
    }
    case 'PLAY_CARD':
    case 'PLAY_BLIND_CARD': {
      turn('playing');
      requireRule(type === 'PLAY_BLIND_CARD' ? state.blind && player.hand.length === 1 : !state.blind, 'Use the correct card action for this hand.');
      const cardId = state.blind ? player.hand[0].id : payload.cardId;
      requireRule(typeof cardId === 'string' && player.hand.some(card => card.id === cardId), 'That card is not in your hand.');
      requireRule(!state.trick.some(entry => entry.card.id === cardId), 'That card was already played.');
      requireRule(isLegalPlay(player.hand, cardId, state.trick[0]?.card.suit), 'You must follow the lead suit.');
      const index = player.hand.findIndex(card => card.id === cardId);
      next.trick.push({ playerId: actorId, card: player.hand.splice(index, 1)[0] });
      if (next.trick.length === next.players.length) {
        next.trickWinnerId = getTrickWinner(next.trick, next.trumpSuit);
        next.players.find(p => p.id === next.trickWinnerId).tricksWon++;
        next.currentPlayerId = null;
        next.phase = 'trick_result';
      } else next.currentPlayerId = getNextPlayer(next.players, actorId).id;
      break;
    }
    case 'NEXT_HAND':
      hostOnly();
      requireRule(state.phase === 'hand_result' && state.handNumber < 6, 'The next hand is not available yet.');
      next.handNumber++;
      next.dealerIndex = advanceDealer(next.dealerIndex, next.players.length);
      setupHand(next, pick);
      break;
    case 'PLAY_AGAIN':
      hostOnly();
      requireRule(state.phase === 'game_result' && state.players.every(p => p.connected), 'Finish this game before playing again.');
      startGame(next, pick);
      break;
    case 'RETURN_TO_LOBBY': {
      hostOnly();
      requireRule(state.phase === 'disconnected', 'The game is still active.');
      const lobby = createLobby(state.hostId, state.players.find(p => p.host).name);
      lobby.players = state.players.filter(p => p.connected).map(p => makePlayer(p.id, p.name, p.host));
      lobby.revision = state.revision + 1;
      return lobby;
    }
    default: throw new RuleError('Unknown action.');
  }
  next.revision++;
  return next;
}

/** Called by the host timer, never by a client message. */
export function resolveTrick(state) {
  requireRule(state.phase === 'trick_result', 'There is no trick to collect.');
  const next = structuredClone(state);
  if (next.players.every(p => p.hand.length === 0)) {
    next.handResults = next.players.map(player => {
      const score = calculateHandScore(player.bid, player.tricksWon);
      player.totalScore += score;
      player.history.push({ bid: player.bid, won: player.tricksWon, score });
      return { playerId: player.id, bid: player.bid, won: player.tricksWon, score, totalScore: player.totalScore };
    });
    next.phase = next.handNumber === 6 ? 'game_result' : 'hand_result';
  } else {
    next.phase = 'playing';
    next.currentPlayerId = next.trickWinnerId;
    next.trickNumber++;
    next.trick = [];
    next.trickWinnerId = null;
  }
  next.revision++;
  return next;
}

export function getStandings(players) {
  return [...players].sort((a, b) => b.totalScore - a.totalScore);
}

/** Explicit allowlist: no authoritative object is spread into a network view. */
export function buildViewForPlayer(state, playerId) {
  const me = state.players.find(p => p.id === playerId);
  requireRule(Boolean(me), 'Unknown player.');
  const myTurn = state.currentPlayerId === playerId;
  const forbiddenBid = state.phase === 'bidding' && myTurn ? getForbiddenFinalBid(state.players.map(p => p.bid), state.handSize) : null;
  return {
    revision: state.revision, phase: state.phase,
    handNumber: state.handNumber, handSize: state.handSize, blind: state.blind,
    trumpCard: state.trumpCard ? { ...state.trumpCard } : null, trumpSuit: state.trumpSuit,
    currentPlayerId: state.currentPlayerId, dealerId: state.players[state.dealerIndex]?.id ?? null,
    leadSuit: state.trick[0]?.card.suit ?? null, trickNumber: state.trickNumber,
    trick: state.trick.map(entry => ({ playerId: entry.playerId, card: { ...entry.card } })),
    trickWinnerId: state.trickWinnerId, totalBids: state.players.reduce((sum, p) => sum + (p.bid ?? 0), 0),
    forbiddenBid, canStart: canStart(state),
    me: {
      id: me.id, name: me.name, host: me.host, ready: me.ready, blind: state.blind,
      hand: state.blind ? null : me.hand.map(card => ({ ...card })), cardCount: me.hand.length,
      legalCardIds: !state.blind && state.phase === 'playing' && myTurn ? getLegalCards(me.hand, state.trick[0]?.card.suit).map(card => card.id) : [],
    },
    players: state.players.map(player => ({
      id: player.id, name: player.name, host: player.host, ready: player.ready, connected: player.connected,
      cardCount: player.hand.length, bid: player.bid, tricksWon: player.tricksWon, totalScore: player.totalScore,
      history: player.history.map(entry => ({ ...entry })),
    })),
    opponents: state.blind ? state.players.filter(p => p.id !== playerId).map(player => ({
      playerId: player.id, visibleBlindCard: player.hand[0] ? { ...player.hand[0] } : null,
    })) : [],
    handResults: state.handResults.map(result => ({ ...result })),
    disconnectedNames: [...state.disconnectedNames],
  };
}

export const planAdapter = {
  createLobby, addPlayer, removePlayer, applyAction, buildViewForPlayer,
  automaticTransition(state) {
    return state.phase === 'trick_result' ? { delay: 2200, apply: resolveTrick } : null;
  },
};
