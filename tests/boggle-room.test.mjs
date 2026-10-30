import test from 'node:test';
import assert from 'node:assert/strict';
import { GameRoom } from '../shared/room.mjs';
import { createBoggleGame, DEFAULT_SETTINGS } from '../games/boggle/game-core.mjs';
import { message } from '../shared/protocol.mjs';

const flush = () => new Promise(resolve => setImmediate(resolve));
class MemoryNetwork {
  static rooms = new Map();
  constructor(options) { Object.assign(this, options); this.links = []; this.sent = []; }
  async open(host, code) {
    if (host) { this.key = this.namespace + code; MemoryNetwork.rooms.set(this.key, this); return; }
    const target = MemoryNetwork.rooms.get(this.namespace + code); if (!target) throw new Error('Room not found.');
    const a = { open: true, owner: this }, b = { open: true, owner: target }; a.remote = b; b.remote = a;
    this.links.push(a); target.links.push(b); this.hostConnection = a; target.onConnection(b); this.onConnection(a);
  }
  send(connection, data) {
    if (!connection.open) return false;
    const value = structuredClone(data); this.sent.push(value);
    queueMicrotask(() => { if (connection.remote.open) connection.remote.owner.onData(connection.remote, structuredClone(value)); }); return true;
  }
  drop(connection) { if (!connection.open) return; connection.open = connection.remote.open = false; connection.owner.onLost(connection); connection.remote.owner.onLost(connection.remote); }
  destroy() { if (this.key) MemoryNetwork.rooms.delete(this.key); for (const connection of this.links) this.drop(connection); }
}
const board = [...'catsreaddogslion'];
const solutions = [['cat', [0, 1, 2]], ['cats', [0, 1, 2, 3]], ['read', [4, 5, 6, 7]], ['dog', [8, 9, 10]], ['dogs', [8, 9, 10, 11]], ['lion', [12, 13, 14, 15]]];
function room(t, game = createBoggleGame()) {
  const errors = [], ended = [], instance = new GameRoom({ game, Network: MemoryNetwork, appVersion: 'boggle1',
    onView: () => {}, onStatus: () => {}, onError: text => errors.push(text), onEnded: text => ended.push(text) });
  Object.assign(instance, { errors, ended }); t.after(() => instance.close()); return instance;
}
async function table(t, count = 2) {
  const base = createBoggleGame(), adapter = base.adapter;
  const game = { ...base, adapter: { ...adapter, applyAction(...args) {
    const state = adapter.applyAction(...args);
    return args[2] === 'START_GAME' ? { ...state, startsAt: performance.now() - 1, endsAt: performance.now() + 60000 } : state;
  } } };
  const host = room(t, game); await host.create('Host'); const guests = [];
  for (let i = 1; i < count; i++) { const guest = room(t); await guest.join('Guest ' + i, host.roomCode); guest.act('SET_READY', { ready: true }); await flush(); guests.push(guest); }
  game.stageRound({ settings: DEFAULT_SETTINGS, dictionaryVersion: 'boggle1', board, solutions }); host.act('START_GAME');
  await new Promise(resolve => setTimeout(resolve, 10)); await flush();
  assert.equal(host.view.phase, 'playing'); return { host, guests, guest: guests[0] };
}
test('two players submit concurrently at an older revision without stale-action failures or word leaks', async t => {
  const { host, guest } = await table(t), revision = guest.revision;
  host.act('BOGGLE_ACTION', { action: 'SUBMIT', word: 'cats', round: 1 });
  guest.network.send(guest.network.hostConnection, { ...message('BOGGLE_ACTION', { action: 'SUBMIT', word: 'lion', round: 1 }), baseRevision: revision });
  await flush(); assert.deepEqual(host.view.myWords, ['cats']); assert.deepEqual(guest.view.myWords, ['lion']); assert.deepEqual(guest.errors, []);
  for (const update of host.network.sent.filter(data => data.type === 'STATE_UPDATE' && data.payload.view.phase === 'playing')) {
    assert.doesNotMatch(JSON.stringify(update), /solutions|submissions|cats/);
  }
  guest.sendChat('Nice finds!', 'word-chat'); await flush(); assert.equal(host.chatView.messages.at(-1).text, 'Nice finds!');
});
test('six simultaneous players keep their own independent words, replay protection and host permissions', async t => {
  const { host, guests } = await table(t, 6), revision = host.revision;
  for (const guest of guests) {
    const request = { ...message('BOGGLE_ACTION', { action: 'SUBMIT', word: 'dog', round: 1 }, 'one-submission'), baseRevision: revision };
    guest.network.send(guest.network.hostConnection, request); guest.network.send(guest.network.hostConnection, request);
  }
  host.act('BOGGLE_ACTION', { action: 'SUBMIT', word: 'cats', round: 1 }); await flush();
  for (const guest of guests) { assert.deepEqual(guest.view.myWords, ['dog']); assert.deepEqual(guest.errors, []); }
  guests[0].act('BOGGLE_ACTION', { action: 'SETTINGS', ...DEFAULT_SETTINGS, minLength: 5 }); await flush(); assert.match(guests[0].errors.at(-1), /host/);
  const seventh = room(t); await assert.rejects(seventh.join('Extra', host.roomCode), /full|progress/);
});
test('forged, future and wrong-round intents are rejected without changing accepted words', async t => {
  const { host, guest } = await table(t);
  for (const [payload, baseRevision] of [
    [{ action: 'SUBMIT', word: 'dog', round: 1, playerId: host.playerId }, guest.revision],
    [{ action: 'SUBMIT', word: 'dog', round: 1 }, guest.revision + 10],
    [{ action: 'SUBMIT', word: 'dog', round: 2 }, guest.revision],
  ]) {
    guest.network.send(guest.network.hostConnection, { ...message('BOGGLE_ACTION', payload), baseRevision }); await flush();
    assert.equal(guest.view.myWords.length, 0);
  }
  assert.equal(guest.errors.length, 3);
});
test('disconnect stops all peers and reopening the lobby preserves chat with remaining players', async t => {
  const { host, guests } = await table(t, 3), [leaving, staying] = guests;
  staying.sendChat('Another round?', 'persistent-chat'); await flush(); leaving.close(); await flush();
  assert.equal(host.view.phase, 'disconnected'); assert.equal(staying.view.phase, 'disconnected');
  host.act('RETURN_TO_LOBBY'); await flush(); assert.equal(staying.view.phase, 'lobby'); assert.equal(staying.view.players.length, 2);
  assert.equal(staying.chatView.messages.at(-1).text, 'Another round?');
  host.close(); await flush(); assert.equal(staying.closed, true); assert.match(staying.ended.at(-1), /host/);
});
