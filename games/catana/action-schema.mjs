import { RESOURCES } from './constants.mjs';

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = (value, max) => Number.isSafeInteger(value) && value >= 0 && value <= max;
export const validBag = bag => record(bag) && Object.keys(bag).every(key => RESOURCES.includes(key)) &&
  Object.values(bag).every(value => integer(value, 19));
const identity = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);

/** Small, explicit wire schema. The authoritative reducer checks ownership and legality. */
export function isCatanaAction(payload) {
  if (!record(payload) || typeof payload.action !== 'string') return false;
  const keys = Object.keys(payload).filter(key => key !== 'action');
  const fields = (...allowed) => keys.length === allowed.length && allowed.every(key => keys.includes(key));
  switch (payload.action) {
    case 'ROLL': case 'END_TURN': case 'BUY_DEVELOPMENT': case 'CANCEL_TRADE': case 'FINISH_ROADS':
      return fields();
    case 'BUILD_ROAD': return fields('edge') && integer(payload.edge, 71);
    case 'BUILD_SETTLEMENT': case 'BUILD_CITY': return fields('vertex') && integer(payload.vertex, 53);
    case 'MOVE_ROBBER': return fields('hex') && integer(payload.hex, 18);
    case 'STEAL': return fields('victim') && identity(payload.victim);
    case 'DISCARD': case 'TAKE_PLENTY': return fields('resources') && validBag(payload.resources);
    case 'CHOOSE_MONOPOLY': return fields('resource') && RESOURCES.includes(payload.resource);
    case 'PLAY_DEVELOPMENT': return fields('card') && typeof payload.card === 'string' && /^d\d{1,2}$/.test(payload.card);
    case 'BANK_TRADE': return fields('give', 'receive', 'quantity') && RESOURCES.includes(payload.give) &&
      RESOURCES.includes(payload.receive) && integer(payload.quantity, 19) && payload.quantity > 0;
    case 'OFFER_TRADE': return fields('give', 'want', 'target') && validBag(payload.give) && validBag(payload.want) &&
      (payload.target === null || identity(payload.target));
    case 'ACCEPT_TRADE': return fields('offer') && integer(payload.offer, Number.MAX_SAFE_INTEGER);
    default: return false;
  }
}
