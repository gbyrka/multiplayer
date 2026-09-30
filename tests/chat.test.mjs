import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAT_LIMITS, RoomChat, normalizeChatText, isChatSnapshot } from '../shared/chat.mjs';
import { isClientMessage, isMessage, message } from '../shared/protocol.mjs';

test('chat normalizes newlines and whitespace but preserves plain URLs and literal entities', () => {
  assert.equal(normalizeChatText('  Hello\r\nthere\rfriend  '), 'Hello\nthere\nfriend');
  assert.equal(normalizeChatText('1 < 2 & 3 > 2'), '1 < 2 & 3 > 2');
  for (const text of ['https://example.com', 'javascript:alert(1)', '&lt;img src=x onerror=alert(1)&gt;']) assert.equal(normalizeChatText(text), text);
});

test('HTML, scripts, controls, empty, oversized and non-text chat are rejected', () => {
  for (const text of [null, {}, [], '', '   ', 'x'.repeat(501), 'a\u0000b', 'a\u202eb',
    '<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '<svg/onload=alert(1)>',
    '<a href="javascript:alert(1)">go</a>', '<!-- comment -->', '<ScRiPt\n>alert(1)</ScRiPt>',
  ]) assert.throws(() => normalizeChatText(text));
});

test('host chat rate limits each player and keeps a bounded independent snapshot', () => {
  let clock = 1700000000000;
  const chat = new RoomChat(() => clock);
  const player = { id: 'player', name: 'Guest' };
  for (let i = 0; i < CHAT_LIMITS.burst; i++) chat.append(player, `Hi ${i}`);
  assert.throws(() => chat.append(player, 'Too fast'), /slower/);
  chat.append({ id: 'host', name: 'Host' }, 'Separate allowance');
  for (let i = 0; i < 30; i++) { clock += CHAT_LIMITS.windowMs; chat.append(player, `Later ${i}`); }
  const snapshot = chat.snapshot();
  assert.equal(snapshot.messages.length, CHAT_LIMITS.history);
  assert.equal(snapshot.messages.at(-1).id, snapshot.revision);
  assert.equal(isChatSnapshot(snapshot), true);
  snapshot.messages[0].text = 'Tampered';
  assert.notEqual(chat.snapshot().messages[0].text, 'Tampered');
  chat.forget(player.id);
  assert.equal(chat.rates.has(player.id), false);
});

test('malformed chat snapshots are rejected and even worst-case history fits the wire limit', () => {
  let clock = 1700000000000;
  const chat = new RoomChat(() => clock);
  for (let i = 0; i < CHAT_LIMITS.history; i++) {
    clock += CHAT_LIMITS.windowMs;
    chat.append({ id: 'p'.repeat(64), name: '\\'.repeat(16) }, '\\'.repeat(CHAT_LIMITS.length));
  }
  const valid = chat.snapshot();
  assert.ok(isMessage(message('CHAT_UPDATE', { chat: valid })));
  assert.ok(isClientMessage(message('CHAT_SEND', { text: '\\'.repeat(CHAT_LIMITS.length) })));
  assert.ok(isChatSnapshot(valid));
  assert.ok(isChatSnapshot({ revision: 0, messages: [] }));
  for (const snapshot of [null, [], { revision: '1', messages: [] }, { ...valid, messages: valid.messages.slice(1) },
    { ...valid, revision: valid.revision - 1 }, { ...valid, privateHand: [] },
    { revision: 1, messages: [{ id: 1, playerId: 'p', name: 'A', text: 'Hi', timestamp: Number.MAX_SAFE_INTEGER }] },
  ]) assert.equal(isChatSnapshot(snapshot), false);
  for (const request of [message('CHAT_SEND', { text: 1 }), message('CHAT_SEND', { text: 'hi', playerId: 'host' }), message('CHAT_UPDATE', { chat: valid })]) assert.equal(isClientMessage(request), false);
});
