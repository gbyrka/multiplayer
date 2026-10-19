import test from 'node:test';
import assert from 'node:assert/strict';
import { GameRoom } from '../shared/room.mjs';
import { chessGame } from '../games/chess/game-core.mjs';
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

function room(t, game = chessGame) {
  const errors=[], ended=[];
  const r=new GameRoom({game,Network:MemoryNetwork,appVersion:'chess1',onView:()=>{},onStatus:()=>{},onError:x=>errors.push(x),onEnded:x=>ended.push(x)});
  Object.assign(r,{errors,ended});t.after(()=>r.close());return r;
}
async function table(t) {
  const host=room(t);await host.create('Host');
  host.act('CHESS_ACTION',{action:'SETTINGS',hostColor:'w',minutes:0});
  const guest=room(t);await guest.join('Guest',host.roomCode);guest.act('SET_READY',{ready:true});await flush();
  host.act('START_GAME');await flush();return {host,guest};
}
test('two real GameRooms synchronize a complete checkmate and share persistent chat', async t=>{
  const {host,guest}=await table(t);
  for(const [room,from,to] of [[host,'f2','f3'],[guest,'e7','e5'],[host,'g2','g4'],[guest,'d8','h4']]){
    room.act('CHESS_ACTION',{action:'MOVE',from,to});await flush();assert.equal(host.view.fen,guest.view.fen);assert.equal(host.revision,guest.revision);
  }
  assert.equal(host.view.result.reason,'checkmate');assert.equal(guest.view.result.winnerId,guest.playerId);
  const revision=host.revision;guest.sendChat('Good game!','chess-chat');await flush();assert.equal(host.revision,revision);assert.equal(host.chatView.messages.at(-1).text,'Good game!');
  host.act('PLAY_AGAIN');await flush();assert.equal(guest.view.phase,'lobby');assert.equal(guest.view.me.ready,false);assert.equal(host.chatView.messages.at(-1).text,'Good game!');
  assert.deepEqual(host.errors,[]);assert.deepEqual(guest.errors,[]);
});
test('room bindings reject spoofed, stale, replayed and out-of-turn moves',async t=>{
  const {host,guest}=await table(t), revision=host.revision;
  guest.act('CHESS_ACTION',{action:'MOVE',from:'e2',to:'e4'});await flush();assert.match(guest.errors.at(-1),/turn/);assert.equal(host.revision,revision);
  guest.network.send(guest.network.hostConnection,{...message('CHESS_ACTION',{action:'MOVE',from:'e2',to:'e4',playerId:host.playerId}),baseRevision:revision});await flush();assert.match(guest.errors.at(-1),/Invalid request/);
  host.act('CHESS_ACTION',{action:'MOVE',from:'e2',to:'e4'});await flush();
  const request={...message('CHESS_ACTION',{action:'MOVE',from:'e7',to:'e5'},'one-move'),baseRevision:guest.revision};
  guest.network.send(guest.network.hostConnection,request);guest.network.send(guest.network.hostConnection,request);await flush();assert.equal(host.view.ply,2);
  guest.network.send(guest.network.hostConnection,{...message('CHESS_ACTION',{action:'RESIGN'}),baseRevision:0});await flush();assert.match(guest.errors.at(-1),/table changed/);assert.equal(host.view.phase,'playing');
});
test('host clock expiry is automatically published without another player action',async t=>{
  const fast={...chessGame,adapter:{...chessGame.adapter,applyAction(...args){const next=chessGame.adapter.applyAction(...args);if(args[2]==='START_GAME')next.clock={w:30,b:60000,running:'w',since:performance.now()};return next;}}};
  const host=room(t,fast);await host.create('Host');host.act('CHESS_ACTION',{action:'SETTINGS',hostColor:'w',minutes:1});
  const guest=room(t);await guest.join('Guest',host.roomCode);guest.act('SET_READY',{ready:true});await flush();host.act('START_GAME');
  await new Promise(resolve=>setTimeout(resolve,100));await flush();assert.equal(host.view.result.reason,'timeout');assert.equal(guest.view.result.winnerId,guest.playerId);assert.equal(host.view.clock.w,0);
});
test('guest disconnect freezes the match; host disconnect ends the guest room',async t=>{
  const {host,guest}=await table(t);guest.close();await flush();assert.equal(host.view.phase,'disconnected');host.act('RETURN_TO_LOBBY');assert.equal(host.view.players.length,1);
  const next=room(t);await next.join('Replacement',host.roomCode);host.close();await flush();assert.equal(next.closed,true);assert.match(next.ended.at(-1),/host connection was lost/);
});
