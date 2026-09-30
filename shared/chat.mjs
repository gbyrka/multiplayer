import { validateName } from './random.mjs';

export const CHAT_LIMITS = Object.freeze({ length: 500, history: 25, burst: 5, windowMs: 10000 });

/** Content is plain text. Markup is rejected; URLs are never converted into links. */
export function normalizeChatText(value) {
  if (typeof value !== 'string' || value.length > CHAT_LIMITS.length) throw new Error(`Use up to ${CHAT_LIMITS.length} characters.`);
  const text = value.replace(/\r\n?/g, '\n').trim();
  if (!text) throw new Error('Write a message first.');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(text)) throw new Error('Please use plain text without control characters.');
  if (/<(?:\/?[a-z][^>]*|![^>]*|\?[^>]*)>/i.test(text)) throw new Error('Plain text only. HTML tags are not allowed.');
  return text;
}

/** Independent of game revisions, hands and timers; only the host appends messages. */
export class RoomChat {
  constructor(clock = () => Date.now()) {
    this.clock = clock;
    this.revision = 0;
    this.messages = [];
    this.rates = new Map();
  }
  append(player, value) {
    const text = normalizeChatText(value);
    const name = validateName(player.name);
    const now = this.clock();
    let rate = this.rates.get(player.id);
    if (!rate || now - rate.start >= CHAT_LIMITS.windowMs) rate = { start: now, count: 0 };
    if (rate.count >= CHAT_LIMITS.burst) throw new Error('A little slower, please. Try again in a few seconds.');
    rate.count++;
    this.rates.set(player.id, rate);
    this.messages.push({ id: ++this.revision, playerId: player.id, name, text, timestamp: now });
    if (this.messages.length > CHAT_LIMITS.history) this.messages.shift();
  }
  forget(playerId) { this.rates.delete(playerId); }
  snapshot() { return { revision: this.revision, messages: this.messages.map(entry => ({ ...entry })) }; }
}

/** Validate host snapshots too, before anything reaches the DOM. */
export function isChatSnapshot(value) {
  if (!value || typeof value !== 'object' || !Number.isSafeInteger(value.revision) || value.revision < 0 ||
      !Array.isArray(value.messages) || value.messages.length > CHAT_LIMITS.history ||
      Object.keys(value).some(key => !['revision', 'messages'].includes(key))) return false;
  let previous = Math.max(0, value.revision - CHAT_LIMITS.history);
  for (const entry of value.messages) {
    if (!entry || typeof entry !== 'object' || Object.keys(entry).length !== 5 ||
        !Number.isSafeInteger(entry.id) || entry.id !== previous + 1 ||
        typeof entry.playerId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(entry.playerId) ||
        !Number.isSafeInteger(entry.timestamp) || entry.timestamp < 0 || entry.timestamp > 8640000000000000) return false;
    try { if (validateName(entry.name) !== entry.name || normalizeChatText(entry.text) !== entry.text) return false; } catch { return false; }
    previous = entry.id;
  }
  return previous === value.revision;
}
