import test from 'node:test';
import assert from 'node:assert/strict';
import { GameRoom } from '../shared/room.mjs';
import { message } from '../shared/protocol.mjs';
import { planAdapter, PHASES } from '../games/plan/game-core.mjs';

const game = { id: 'plan', peerNamespace: 'plan-v1-', phases: PHASES, adapter: planAdapter };
const flush = () => new Promise(resolve => setImmediate(resolve));

/** Transport test double only. Production always uses PeerJS WebRTC. */
class MemoryNetwork {
  static rooms = new Map();
  static collisions = 0;
  constructor(callbacks) { Object.assign(this, callbacks); this.links = []; this.sent = []; }
  async open(host, roomCode) {
    this.host = host;
    if (host) {
      if (MemoryNetwork.collisions-- > 0) { const error = new Error('Collision'); error.code = 'unavailable-id'; throw error; }
      this.code = roomCode;
      MemoryNetwork.rooms.set(roomCode, this);
    } else {
      const target = MemoryNetwork.rooms.get(roomCode);
      if (!target) throw new Error('Room not found.');
      const incoming = { open: true };
      const outgoing = { open: true };
      incoming.remote = outgoing; incoming.owner = target;
      outgoing.remote = incoming; outgoing.owner = this;
      this.links.push(outgoing); target.links.push(incoming);
      this.hostConnection = outgoing;
      target.onConnection(incoming); this.onConnection(outgoing);
    }
  }
  send(connection, data) {
    if (!connection.open) return false;
    this.sent.push(structuredClone(data));
    const copy = structuredClone(data);
    queueMicrotask(() => { if (connection.remote.open) connection.remote.owner.onData(connection.remote, copy); });
    return true;
  }
  drop(connection) {
    if (!connection.open) return;
    connection.open = connection.remote.open = false;
    connection.owner.onLost(connection);
    connection.remote.owner.onLost(connection.remote);
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.code) MemoryNetwork.rooms.delete(this.code);
    for (const connection of this.links) this.drop(connection);
  }
}

function makeRoom(t, options = {}) {
  const errors = [], ended = [], views = [];
  const room = new GameRoom({ game, Network: MemoryNetwork, onView: view => views.push(view), onStatus: () => {}, onError: text => errors.push(text), onEnded: text => ended.push(text), ...options });
  t.after(() => room.close());
  return Object.assign(room, { errors, ended, views });
}
async function pair(t) {
  const host = makeRoom(t), guest = makeRoom(t);
  await host.create('Host'); await guest.join('Guest', host.roomCode);
  return { host, guest };
}

test('room create, join, ready and start synchronize personalized views', async t => {
  const { host, guest } = await pair(t);
  assert.equal(host.view.players.length, 2);
  assert.equal(guest.view.players.length, 2);
  assert.notEqual(host.view.me.id, guest.view.me.id);
  guest.act('SET_READY', { ready: true }); await flush();
  assert.equal(host.view.canStart, true);
  host.act('START_GAME'); await flush();
  assert.equal(guest.view.phase, 'bidding');
  assert.equal(host.view.revision, guest.view.revision);
  assert.equal(host.view.me.hand.length, 5);
  const serialized = JSON.stringify(guest.view);
  for (const card of host.view.me.hand) assert.ok(!serialized.includes(`"${card.id}"`));
});
test('duplicate JOIN_REQUEST never adds a second player or changes their identity', async t => {
  const { host, guest } = await pair(t);
  const id = guest.playerId;
  guest.network.send(guest.network.hostConnection, message('JOIN_REQUEST', { nickname: 'Impostor' }));
  await flush();
  assert.equal(host.view.players.length, 2);
  assert.equal(guest.playerId, id);
  assert.equal(guest.view.me.name, 'Guest');
});
test('host and guest agree that the highest bidder leads and reject an earlier play', async t => {
  const { host, guest } = await pair(t);
  guest.act('SET_READY', { ready: true }); await flush();
  host.act('START_GAME'); await flush();
  const first = host.view.currentPlayerId === host.playerId ? host : guest;
  const last = first === host ? guest : host;
  first.act('PLACE_BID', { bid: 0 }); await flush();
  last.act('PLACE_BID', { bid: 2 }); await flush();
  for (const room of [host, guest]) {
    assert.equal(room.view.phase, 'playing');
    assert.equal(room.view.currentPlayerId, last.playerId);
    assert.equal(room.view.me.legalCardIds.length, room === last ? 5 : 0);
  }
  const revision = host.revision;
  first.act('PLAY_CARD', { cardId: first.view.me.hand[0].id }); await flush();
  assert.match(first.errors.at(-1), /turn/);
  assert.equal(host.revision, revision);
  last.act('PLAY_CARD', { cardId: last.view.me.hand[0].id }); await flush();
  assert.equal(guest.view.trick[0].playerId, last.playerId);
  assert.equal(host.view.currentPlayerId, first.playerId);
  assert.equal(guest.view.currentPlayerId, first.playerId);
});
test('identical request IDs execute once, and delayed old actions cannot overwrite new state', async t => {
  const { host, guest } = await pair(t);
  const intent = { ...message('SET_READY', { ready: true }), baseRevision: guest.revision };
  const revision = host.revision;
  guest.network.send(guest.network.hostConnection, intent);
  guest.network.send(guest.network.hostConnection, intent);
  await flush();
  assert.equal(host.revision, revision + 1);
  host.act('START_GAME'); await flush();
  const old = { ...message('PLACE_BID', { bid: 0 }), baseRevision: guest.revision - 1 };
  guest.network.send(guest.network.hostConnection, old);
  await flush();
  assert.match(guest.errors.at(-1), /table changed/);
  assert.equal(guest.view.players.find(p => p.id === guest.playerId).bid, null);
});
test('forged player ID never lets a guest start the host’s game', async t => {
  const { host, guest } = await pair(t);
  guest.act('SET_READY', { ready: true }); await flush();
  guest.network.send(guest.network.hostConnection, { ...message('START_GAME'), playerId: host.playerId, baseRevision: guest.revision });
  await flush();
  assert.equal(host.view.phase, 'lobby');
  assert.match(guest.errors.at(-1), /host/);
});
test('stale, duplicated and wrong-recipient state snapshots are ignored', async t => {
  const { host, guest } = await pair(t);
  const previous = structuredClone(guest.view);
  guest.act('SET_READY', { ready: true }); await flush();
  const current = guest.view;
  const connection = host.network.links[0];
  host.network.send(connection, message('STATE_UPDATE', { view: previous }));
  host.network.send(connection, message('STATE_UPDATE', { view: { ...current, phase: 'playing' } }));
  host.network.send(connection, message('STATE_UPDATE', { view: { ...host.view, revision: current.revision + 1 } }));
  await flush();
  assert.equal(guest.view, current);
});
test('late joins and seventh players receive readable rejection messages', async t => {
  const { host, guest } = await pair(t);
  for (let i = 0; i < 4; i++) await makeRoom(t).join(`Guest ${i}`, host.roomCode);
  const extra = makeRoom(t);
  await assert.rejects(() => extra.join('Extra', host.roomCode), /full/);
  for (const binding of host.bindings.values()) if (binding.playerId) {
    const connection = [...host.bindings].find(([, b]) => b === binding)[0];
    const request = { ...message('SET_READY', { ready: true }), baseRevision: host.revision };
    host.network.onData(connection, request);
  }
  host.act('START_GAME'); await flush();
  const late = makeRoom(t);
  await assert.rejects(() => late.join('Late', host.roomCode), /already started/);
  assert.equal(guest.view.phase, 'bidding');
});
test('lobby departures remove guests; midgame departures pause once and allow a clean lobby', async t => {
  const { host, guest } = await pair(t);
  const other = makeRoom(t); await other.join('Other', host.roomCode);
  guest.close(); await flush();
  assert.equal(host.view.players.length, 2);
  other.act('SET_READY', { ready: true }); await flush();
  host.act('START_GAME'); await flush();
  other.close(); other.close(); await flush();
  assert.equal(host.view.phase, 'disconnected');
  assert.deepEqual(host.view.disconnectedNames, ['Other']);
  host.act('RETURN_TO_LOBBY');
  assert.equal(host.view.phase, 'lobby');
  assert.equal(host.view.players.length, 1);
});
test('host closure ends each guest once', async t => {
  const { host, guest } = await pair(t);
  host.close(); host.close(); await flush();
  assert.equal(guest.ended.length, 1);
  assert.match(guest.ended[0], /host connection was lost/);
  assert.equal(guest.closed, true);
});
test('room ID collisions are retried automatically', async t => {
  MemoryNetwork.collisions = 2;
  const host = makeRoom(t);
  await host.create('Host');
  assert.equal(host.view.phase, 'lobby');
  assert.equal(MemoryNetwork.collisions, -1);
});
test('different deployments cannot join the same game and receive a clear reload instruction', async t => {
  const host = makeRoom(t, { appVersion: 'birch' });
  await host.create('Host');
  const old = makeRoom(t, { appVersion: 'older' });
  await assert.rejects(() => old.join('Guest', host.roomCode), /different app version.*reload/);
  assert.equal(host.view.players.length, 1);
  const current = makeRoom(t, { appVersion: 'birch' });
  await current.join('Guest', host.roomCode);
  assert.equal(host.view.players.length, 2);
});
