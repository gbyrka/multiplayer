import test from 'node:test';
import assert from 'node:assert/strict';
import { GameRoom } from '../shared/room.mjs';
import { checkersGame } from '../games/checkers/game-core.mjs';
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
    if (!connection.open) return false; const value = structuredClone(data); this.sent.push({ connection, data: value });
    queueMicrotask(() => { if (connection.remote.open) connection.remote.owner.onData(connection.remote, structuredClone(value)); }); return true;
  }
  drop(connection) { if (!connection.open) return; connection.open = connection.remote.open = false; connection.owner.onLost(connection); connection.remote.owner.onLost(connection.remote); }
  destroy() { if (this.key) MemoryNetwork.rooms.delete(this.key); for (const connection of this.links) this.drop(connection); }
}

function room(t, game = checkersGame) {
  const errors=[], ended=[];
  const r=new GameRoom({game,Network:MemoryNetwork,appVersion:'draughts1',onView:()=>{},onStatus:()=>{},onError:x=>errors.push(x),onEnded:x=>ended.push(x)});
  Object.assign(r,{errors,ended});t.after(()=>r.close());return r;
}
async function table(t,hostColor='w'){
  const game={...checkersGame,adapter:{...checkersGame.adapter,applyAction(...args){const next=checkersGame.adapter.applyAction(...args);if(args[2]==='START_GAME')next.board=[{square:'c3',color:'w',king:false},{square:'d4',color:'b',king:false},{square:'f6',color:'b',king:false}];return next;}}};
  const host=room(t,game);await host.create('Host');host.act('CHECKERS_ACTION',{action:'SETTINGS',hostColor});
  const guest=room(t);await guest.join('Guest',host.roomCode);guest.act('SET_READY',{ready:true});await flush();host.act('START_GAME');await flush();return {host,guest};
}
test('two GameRooms synchronize a forced chain, final removal, victory and persistent chat',async t=>{
  const {host,guest}=await table(t);host.act('CHECKERS_ACTION',{action:'MOVE',from:'c3',to:'e5'});await flush();
  assert.equal(host.view.turn,'w');assert.equal(guest.view.continuation,'e5');assert.deepEqual(host.view.pendingCaptured,['d4']);assert.equal(host.view.history.length,0);
  guest.act('CHECKERS_ACTION',{action:'MOVE',from:'f6',to:'g5'});await flush();assert.match(guest.errors.at(-1),/turn/);
  host.act('CHECKERS_ACTION',{action:'MOVE',from:'e5',to:'g7'});await flush();assert.equal(guest.view.result.reason,'all_captured');assert.equal(guest.view.result.winnerId,host.playerId);assert.equal(guest.view.board.length,1);
  const revision=host.revision;guest.sendChat('Good game!','checkers-chat');await flush();assert.equal(host.revision,revision);assert.equal(host.chatView.messages.at(-1).text,'Good game!');
  host.act('PLAY_AGAIN');await flush();assert.equal(guest.view.phase,'lobby');assert.equal(guest.view.me.ready,false);assert.equal(host.chatView.messages.at(-1).text,'Good game!');
});
test('room bindings reject forged identity, stale and replayed checkers requests',async t=>{
  const {host,guest}=await table(t,'b'),revision=host.revision;
  guest.network.send(guest.network.hostConnection,{...message('CHECKERS_ACTION',{action:'MOVE',from:'c3',to:'e5',playerId:host.playerId}),baseRevision:revision});await flush();assert.match(guest.errors.at(-1),/Invalid request/);assert.equal(host.revision,revision);
  const request={...message('CHECKERS_ACTION',{action:'MOVE',from:'c3',to:'e5'},'capture-once'),baseRevision:revision};
  guest.network.send(guest.network.hostConnection,request);guest.network.send(guest.network.hostConnection,request);await flush();assert.equal(host.view.stepSerial,1);
  guest.network.send(guest.network.hostConnection,{...message('CHECKERS_ACTION',{action:'MOVE',from:'e5',to:'g7'}),baseRevision:revision});await flush();assert.equal(host.view.stepSerial,1);assert.match(guest.errors.at(-1),/table changed/);
  const third=room(t);await assert.rejects(third.join('Third',host.roomCode),/two players|progress/);
});
test('disconnection stops a capture and reopening the lobby removes disconnected players',async t=>{
  const {host,guest}=await table(t);host.act('CHECKERS_ACTION',{action:'MOVE',from:'c3',to:'e5'});await flush();guest.close();await flush();assert.equal(host.view.phase,'disconnected');
  host.act('RETURN_TO_LOBBY');assert.equal(host.view.players.length,1);assert.equal(host.view.continuation,null);
  const replacement=room(t);await replacement.join('Replacement',host.roomCode);host.close();await flush();assert.equal(replacement.closed,true);assert.match(replacement.ended.at(-1),/host connection was lost/);
});
