import test from 'node:test';
import assert from 'node:assert/strict';
import { GameRoom } from '../shared/room.mjs';
import { message } from '../shared/protocol.mjs';
import { catanaGame, buildViewForPlayer } from '../games/catana/game-core.mjs';
import { nextIntent, seededRandom } from './catana-driver.mjs';

const flush = () => new Promise(resolve => setImmediate(resolve));
/** Test transport: exercises the production GameRoom with independent serialized messages. */
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
    if (!connection.open) return false; const value = structuredClone(data); this.sent.push({ connection, data: value });
    queueMicrotask(() => { if (connection.remote.open) connection.remote.owner.onData(connection.remote, structuredClone(value)); }); return true;
  }
  drop(connection) { if (!connection.open) return; connection.open = connection.remote.open = false; connection.owner.onLost(connection); connection.remote.owner.onLost(connection.remote); }
  destroy() { if (this.key) MemoryNetwork.rooms.delete(this.key); for (const connection of this.links) this.drop(connection); }
}
function room(t, game = catanaGame) {
  const errors = [], ended = []; const room = new GameRoom({ game, Network: MemoryNetwork, appVersion: 'catana1', onView: () => {}, onStatus: () => {}, onError: text => errors.push(text), onEnded: text => ended.push(text) });
  Object.assign(room, { errors, ended }); t.after(() => room.close()); return room;
}
async function table(t, count) {
  let authoritative; const pick = seededRandom(79), adapter = { ...catanaGame.adapter,
    createLobby: (...args) => authoritative = catanaGame.adapter.createLobby(...args),
    addPlayer: (...args) => authoritative = catanaGame.adapter.addPlayer(...args),
    applyAction: (...args) => authoritative = catanaGame.adapter.applyAction(...args, pick),
    removePlayer: (...args) => authoritative = catanaGame.adapter.removePlayer(...args),
  };
  const host = room(t, { ...catanaGame, adapter }); await host.create('Host'); const guests = [];
  for (let i = 1; i < count; i++) { const guest = room(t); await guest.join(`Guest ${i}`, host.roomCode); guests.push(guest); }
  for (const guest of guests) guest.act('SET_READY', { ready: true }); await flush();
  return { host, guests, rooms: [host, ...guests], state: () => authoritative };
}

test('real GameRoom adapter synchronizes complete 2–4 player matches, private cards and host-only rematches', async t => {
  for (const count of [2, 3, 4]) {
    const tableState = await table(t, count), { host, rooms, state } = tableState; host.act('START_GAME'); await flush();
    const board = JSON.stringify(host.view.board); let steps = 0;
    while (state().phase !== 'game_result' && steps++ < 10000) {
      const intent = nextIntent(state()), actor = rooms.find(room => room.playerId === intent.actor); actor.act(intent.type, intent.payload); await flush();
      for (const room of rooms) { assert.equal(room.view.revision, state().revision); assert.equal(JSON.stringify(room.view.board), board); assert.deepEqual(room.view, buildViewForPlayer(state(), room.playerId)); assert.deepEqual(room.errors, []); }
      for (const { connection, data } of host.network.sent.splice(0)) if (data.type === 'STATE_UPDATE') {
        const assigned = host.bindings.get(connection).playerId; assert.equal(data.payload.view.me.id, assigned);
        for (const opponent of data.payload.view.players) { assert.equal(Object.hasOwn(opponent, 'resources'), false); assert.equal(Object.hasOwn(opponent, 'development'), false); }
      }
    }
    assert.equal(state().phase, 'game_result'); const identities = rooms.map(room => room.playerId);
    rooms[1].act('PLAY_AGAIN'); await flush(); assert.match(rooms[1].errors.at(-1), /host/); host.act('PLAY_AGAIN'); await flush();
    assert.equal(host.view.phase, 'setup_settlement'); assert.deepEqual(rooms.map(room => room.playerId), identities); assert.notEqual(JSON.stringify(host.view.board), board);
  }
});
test('room bindings prevent identity spoofing, replay and stale requests; older snapshots never replace a newer view', async t => {
  const { host, guests: [guest], state } = await table(t, 2);
  const revision = host.revision, ready = { ...message('SET_READY', { ready: true }, 'repeat-request'), baseRevision: revision };
  guest.network.send(guest.network.hostConnection, ready); guest.network.send(guest.network.hostConnection, ready); await flush(); assert.equal(host.revision, revision + 1);
  host.act('START_GAME'); await flush(); const before = state().revision;
  const forged = { ...message('CATANA_ACTION', { action: 'BUILD_SETTLEMENT', vertex: 0, playerId: host.playerId }), baseRevision: guest.revision };
  guest.network.send(guest.network.hostConnection, forged); await flush(); assert.equal(state().revision, before); assert.match(guest.errors.at(-1), /Invalid request/);
  const stale = { ...message('CATANA_ACTION', { action: 'END_TURN' }), baseRevision: guest.revision - 1 };
  guest.network.send(guest.network.hostConnection, stale); await flush(); assert.equal(state().revision, before); assert.match(guest.errors.at(-1), /table changed/);
  const view = structuredClone(guest.view); view.revision--; const connection = [...host.bindings.keys()][0]; host.network.send(connection, message('STATE_UPDATE', { view })); await flush(); assert.equal(guest.view.revision, before);
  const wrongActor = host.playerId === state().currentPlayerId ? guest : host; wrongActor.act('CATANA_ACTION', { action: 'BUILD_SETTLEMENT', vertex: 0 }); await flush(); assert.equal(state().revision, before); assert.match(wrongActor.errors.at(-1), /turn/);
});
test('lost guest stops an interrupted turn, then rejoins through the existing lobby; a lost host ends the room', async t => {
  const { host, guests: [guest], state } = await table(t, 2); host.act('START_GAME'); await flush(); guest.close(); await flush();
  assert.equal(state().phase, 'disconnected'); assert.equal(host.view.disconnectedNames[0], 'Guest 1'); host.act('CATANA_ACTION', { action: 'ROLL' }); assert.match(host.errors.at(-1), /not accepting/);
  host.act('RETURN_TO_LOBBY'); await flush(); const rejoined = room(t); await rejoined.join('Guest 1', host.roomCode); assert.equal(rejoined.view.phase, 'lobby'); assert.equal(host.view.players.length, 2);
  rejoined.act('SET_READY', { ready: true }); await flush(); host.act('START_GAME'); await flush(); assert.equal(rejoined.view.phase, 'setup_settlement');
  host.close(); await flush(); assert.equal(rejoined.closed, true); assert.match(rejoined.ended.at(-1), /host connection was lost/);
});
test('chat uses the same player identity and never alters the match revision or exposes private cards', async t => {
  const { host, guests: [guest] } = await table(t, 2); host.act('START_GAME'); await flush(); const revision = host.revision;
  guest.sendChat('Would you trade ore for wool?', 'trade-chat'); await flush(); assert.equal(host.revision, revision); assert.equal(host.chatView.messages.at(-1).playerId, guest.playerId);
  assert.ok(!JSON.stringify(host.chatView).includes('development')); assert.deepEqual(host.chatView, guest.chatView);
});
