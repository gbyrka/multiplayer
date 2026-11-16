import test from 'node:test';
import assert from 'node:assert/strict';
import { GameRoom } from '../shared/room.mjs';
import { createScrabbleGame } from '../games/scrabble/game-core.mjs';
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
function room(t, game=createScrabbleGame()) {
  const errors=[],instance=new GameRoom({game,Network:MemoryNetwork,appVersion:'scrabbletest',onView:()=>{},onStatus:()=>{},onError:text=>errors.push(text),onEnded:()=>{}});
  instance.errors=errors;t.after(()=>instance.close());return instance;
}
async function table(t) {
  const game=createScrabbleGame({pick:()=>0});game.stageDictionary({has:()=>true},'pl');
  const host=room(t,game);await host.create('Host');const guests=[];
  for(let i=0;i<3;i++) {const guest=room(t);await guest.join(`Guest ${i+1}`,host.roomCode);guest.act('SET_READY',{ready:true});await flush();guests.push(guest);}
  host.act('START_GAME');await flush();return {host,guests};
}
test('four real GameRooms synchronize turns, keep racks private and reject a fifth player',async t=>{
  const {host,guests}=await table(t);const all=[host,...guests];
  for(const participant of all) {
    assert.equal(participant.view.phase,'playing');assert.equal(participant.view.rack.length,7);assert.equal(participant.view.players.length,4);assert.equal(participant.view.bagCount,72);
    assert.equal(participant.view.racks,undefined);assert.equal(participant.view.bag,undefined);assert.equal(participant.view.finalRacks,null);
  }
  for(let a=0;a<4;a++)for(let b=a+1;b<4;b++)assert.equal(all[a].view.rack.some(tile=>all[b].view.rack.some(other=>other.id===tile.id)),false);
  const extra=room(t);await assert.rejects(extra.join('Extra',host.roomCode),/full/);
  for(const participant of all) {assert.equal(participant.view.myTurn,true);participant.act('SCRABBLE_ACTION',{action:'PASS',turn:participant.view.turnSerial});await flush();}
  assert.equal(host.view.myTurn,true);assert.equal(host.view.history.length,4);
});
test('replays, out-of-turn moves, settings changes and forged tile identities do not alter the game',async t=>{
  const {host,guests:[guest]}=await table(t),serial=host.view.turnSerial;
  guest.act('SCRABBLE_ACTION',{action:'PASS',turn:serial});await flush();assert.match(guest.errors.at(-1),/turn/);
  guest.act('SCRABBLE_ACTION',{action:'SETTINGS',language:'en',seconds:10});await flush();assert.match(guest.errors.at(-1),/host/);
  host.act('SCRABBLE_ACTION',{action:'PLAY',turn:serial,placements:[{index:112,tileId:guest.view.rack[0].id,letter:guest.view.rack[0].letter||'a'}]});
  assert.match(host.errors.at(-1),/tiles/);assert.equal(host.view.turnSerial,serial);
  host.act('SCRABBLE_ACTION',{action:'PASS',turn:serial});await flush();
  const request={...message('SCRABBLE_ACTION',{action:'PASS',turn:guest.view.turnSerial},'once'),baseRevision:guest.revision};
  guest.network.send(guest.network.hostConnection,request);guest.network.send(guest.network.hostConnection,request);await flush();
  assert.equal(host.view.history.length,2);
  guest.network.send(guest.network.hostConnection,{...message('SCRABBLE_ACTION',{action:'PASS',turn:serial}),baseRevision:guest.revision+1});await flush();assert.equal(host.view.history.length,2);
});
test('chat preserves turn clock and a guest disconnect stops every peer',async t=>{
  const {host,guests}=await table(t),serial=host.view.turnSerial;
  guests[0].sendChat('Ready for another word?','chat-test');await flush();
  assert.equal(host.chatView.messages.at(-1).text,'Ready for another word?');assert.equal(host.view.turnSerial,serial);
  guests[0].close();await flush();assert.equal(host.view.phase,'disconnected');assert.equal(guests[1].view.phase,'disconnected');
  host.act('RETURN_TO_LOBBY');await flush();assert.equal(host.view.players.length,3);assert.equal(guests[1].view.players.length,3);
  assert.equal(host.chatView.messages.at(-1).text,'Ready for another word?');
});
