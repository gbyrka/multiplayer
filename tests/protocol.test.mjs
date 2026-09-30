import test from 'node:test';
import assert from 'node:assert/strict';
import { randomInt, createRoomCode, normalizeRoomCode, isValidRoomCode, validateName } from '../shared/random.mjs';
import { isClientMessage, isMessage, message, RequestCache, acceptRevision } from '../shared/protocol.mjs';

test('room codes use 8 readable cryptographically generated characters', () => {
  const codes = Array.from({ length: 100 }, createRoomCode);
  assert.ok(codes.every(isValidRoomCode));
  assert.equal(new Set(codes).size, 100);
  assert.equal(normalizeRoomCode(' abcd2345 '), 'ABCD2345');
  for (const code of ['ABCD1234', 'ABCO2345', 'ABCI2345', 'ABC', 'abcd2345', '<script>']) assert.equal(isValidRoomCode(code), false);
  for (let i = 0; i < 100; i++) assert.ok(randomInt(6) >= 0 && randomInt(6) < 6);
  assert.throws(() => randomInt(0));
});
test('names are bounded plain text and control characters are rejected', () => {
  assert.equal(validateName('  Anna  '), 'Anna');
  assert.equal(validateName('<b>Anna</b>'), '<b>Anna</b>');
  for (const name of ['', ' ', '12345678901234567', 'A\nB', 'A\u202eB', null, {}]) assert.throws(() => validateName(name));
});
test('only known bounded versioned envelopes are accepted', () => {
  const good = message('PLAY_CARD', { cardId: 'AS' });
  assert.ok(isMessage(good));
  for (const value of [null, [], 'hello', { ...good, v: 2 }, { ...good, type: 'EXECUTE' }, { ...good, payload: [] }, { ...good, requestId: 'x'.repeat(65) }, { ...good, payload: { text: 'x'.repeat(32768) } }]) assert.equal(isMessage(value), false);
});
test('client schemas reject forged identity, wrong types, excess keys and fake host updates', () => {
  assert.ok(isClientMessage(message('PLACE_BID', { bid: 2 })));
  assert.ok(isClientMessage(message('PLAY_BLIND_CARD')));
  assert.ok(isClientMessage(message('JOIN_REQUEST', { nickname: 'Anna', appVersion: 'birch' })));
  for (const value of [
    message('PLACE_BID', { bid: 1.2 }), message('PLACE_BID', { bid: 6 }), message('PLACE_BID', { bid: '2' }),
    message('PLAY_CARD', { cardId: 'BAD' }), message('PLAY_CARD', { cardId: 'AS', playerId: 'host' }),
    message('SET_READY', { ready: 'true' }), message('JOIN_REQUEST', { nickname: 'x'.repeat(17) }),
    message('STATE_UPDATE', { view: {} }), message('JOIN_ACCEPTED', { playerId: 'hacked' }),
    message('JOIN_REQUEST', { nickname: 'Anna', appVersion: 'x'.repeat(17) }),
    message('JOIN_REQUEST', { nickname: 'Anna', appVersion: { version: 'birch' } }),
  ]) assert.equal(isClientMessage(value), false);
});
test('replay cache is bounded and revisions must strictly increase', () => {
  const cache = new RequestCache(2);
  cache.add('a'); cache.add('b');
  assert.equal(cache.has('a'), true);
  cache.add('c');
  assert.equal(cache.has('a'), false);
  assert.equal(cache.has('b'), true);
  assert.equal(acceptRevision(4, 5), true);
  for (const next of [3, 4, -1, 5.5, '5', Infinity]) assert.equal(acceptRevision(4, next), false);
});
