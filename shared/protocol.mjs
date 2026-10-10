import { randomToken } from './random.mjs';
import { CHAT_LIMITS } from './chat.mjs';
import { isCatanaAction } from '../games/catana/action-schema.mjs';

export const PROTOCOL_VERSION = 1;
export const MESSAGE = Object.freeze(Object.fromEntries([
  'JOIN_REQUEST', 'JOIN_ACCEPTED', 'JOIN_REJECTED', 'SET_READY', 'START_GAME',
  'PLACE_BID', 'PLAY_CARD', 'PLAY_BLIND_CARD', 'STATE_UPDATE', 'NEXT_HAND',
  'PLAY_AGAIN', 'RETURN_TO_LOBBY', 'PING', 'PONG', 'ERROR',
  'CHAT_SEND', 'CHAT_UPDATE',
  'CATANA_ACTION',
].map(type => [type, type])));

export const ACTION_TYPES = new Set([
  MESSAGE.SET_READY, MESSAGE.START_GAME, MESSAGE.PLACE_BID, MESSAGE.PLAY_CARD,
  MESSAGE.PLAY_BLIND_CARD, MESSAGE.NEXT_HAND, MESSAGE.PLAY_AGAIN, MESSAGE.RETURN_TO_LOBBY,
  MESSAGE.CATANA_ACTION,
]);
const KNOWN_TYPES = new Set(Object.keys(MESSAGE));
const EMPTY_PAYLOAD_TYPES = new Set([
  'START_GAME', 'PLAY_BLIND_CARD', 'NEXT_HAND', 'PLAY_AGAIN', 'RETURN_TO_LOBBY', 'PING', 'PONG',
]);
export const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function message(type, payload = {}, requestId = randomToken(20)) {
  return { v: PROTOCOL_VERSION, type, requestId, payload };
}

/** Reject malformed envelopes before any rule or room handler sees them. */
export function isMessage(value, maxLength = 32768) {
  if (!isRecord(value) || value.v !== PROTOCOL_VERSION || !KNOWN_TYPES.has(value.type) ||
      typeof value.requestId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value.requestId) ||
      !isRecord(value.payload)) return false;
  try { return JSON.stringify(value).length <= maxLength; } catch { return false; }
}

export function isClientMessage(value) {
  if (!isMessage(value, value?.type === 'CHAT_SEND' ? 2048 : 1024)) return false;
  const { type, payload } = value;
  const keys = Object.keys(payload);
  if (type === 'CATANA_ACTION') return isCatanaAction(payload);
  if (type === 'CHAT_SEND') return keys.length === 1 && typeof payload.text === 'string' && payload.text.length <= CHAT_LIMITS.length;
  if (EMPTY_PAYLOAD_TYPES.has(type)) return keys.length === 0;
  if (type === 'JOIN_REQUEST') return keys.every(key => ['nickname', 'appVersion'].includes(key)) &&
    typeof payload.nickname === 'string' && payload.nickname.length <= 16 &&
    (payload.appVersion === undefined || typeof payload.appVersion === 'string' && /^[a-z0-9]{3,16}$/i.test(payload.appVersion));
  if (type === 'SET_READY') return keys.length === 1 && typeof payload.ready === 'boolean';
  if (type === 'PLACE_BID') return keys.length === 1 && Number.isInteger(payload.bid) && payload.bid >= 0 && payload.bid <= 5;
  if (type === 'PLAY_CARD') return keys.length === 1 && typeof payload.cardId === 'string' && /^(?:[2-9]|10|J|Q|K|A)[CDHS]$/.test(payload.cardId);
  return false;
}

/** Bounded per-connection replay protection. Stale actions also carry a revision. */
export class RequestCache {
  #ids = new Set();
  constructor(limit = 256) { this.limit = limit; }
  has(id) { return this.#ids.has(id); }
  add(id) {
    this.#ids.add(id);
    if (this.#ids.size > this.limit) this.#ids.delete(this.#ids.values().next().value);
  }
}

export function acceptRevision(previous, incoming) {
  return Number.isSafeInteger(incoming) && incoming >= 0 && incoming > previous;
}
