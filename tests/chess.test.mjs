import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { Chess } from '../games/chess/vendor/chess.mjs';
import { createLobby, addPlayer, applyAction, buildViewForPlayer, removePlayer, automaticTransition, expireClock, adjudicate, canPossiblyMate } from '../games/chess/game-core.mjs';
import { isChessAction } from '../games/chess/action-schema.mjs';
import { isClientMessage, message } from '../shared/protocol.mjs';

function start({ color = 'w', minutes = 0, pick = () => 0 } = {}) {
  let state = addPlayer(createLobby('host', 'Host'), 'guest', 'Guest');
  state = applyAction(state, 'host', 'CHESS_ACTION', { action: 'SETTINGS', hostColor: color, minutes }, pick, 0);
  state = applyAction(state, 'guest', 'SET_READY', { ready: true }, pick, 0);
  return applyAction(state, 'host', 'START_GAME', {}, pick, 0);
}
function position(fen, options) {
  const state = start(options); state.fen = fen; state.positions = { [fen.split(' ').slice(0, 4).join(' ')]: 1 }; return state;
}
const move = (s, from, to, promotion, at = 0) => applyAction(s, s.players.find(p => p.color === new Chess(s.fen).turn()).id, 'CHESS_ACTION', { action: 'MOVE', from, to, ...(promotion ? { promotion } : {}) }, () => 0, at);
const view = s => buildViewForPlayer(s, s.players.find(p => p.color === new Chess(s.fen).turn()).id, 0);

test('two-player lobby, host colors, random assignment and White starts', () => {
  for (const [color, pick, expected] of [['w', () => 0, 'w'], ['b', () => 0, 'b'], ['random', () => 0, 'w'], ['random', () => 1, 'b']]) {
    const s = start({ color, pick }); assert.equal(s.players[0].color, expected); assert.equal(new Chess(s.fen).turn(), 'w');
    assert.equal(view(s).legalMoves.length, 20);
  }
  const s = addPlayer(createLobby('host', 'Host'), 'guest', 'Guest');
  assert.throws(() => addPlayer(s, 'third', 'Third'), /two players/);
  assert.throws(() => applyAction(s, 'host', 'START_GAME'), /ready/);
  assert.throws(() => applyAction(s, 'guest', 'CHESS_ACTION', { action: 'SETTINGS', hostColor: 'b', minutes: 5 }), /host/);
  const ready = applyAction(s, 'guest', 'SET_READY', { ready: true });
  const changed = applyAction(ready, 'host', 'CHESS_ACTION', { action: 'SETTINGS', hostColor: 'b', minutes: 15 });
  assert.equal(changed.players[1].ready, false);
});
test('only genuinely legal pieces and destinations are exposed, including pinned pieces and check evasions', () => {
  let s = start(); const v = view(s), pieces = new Set(v.legalMoves.map(m => m.from));
  assert.deepEqual([...pieces].sort(), ['a2','b1','b2','c2','d2','e2','f2','g1','g2','h2']);
  assert.equal(buildViewForPlayer(s, 'guest', 0).legalMoves.length, 0);
  s = position('k3r3/8/8/8/8/8/4B3/4K3 w - - 0 1');
  assert.ok(view(s).legalMoves.every(m => m.from !== 'e2'));
  assert.throws(() => move(s, 'e2', 'd3'), /not legal/);
  s = position('k3r3/8/8/8/8/8/8/R3K3 w - - 0 1');
  assert.equal(view(s).check, true); assert.equal(view(s).checkedKing, 'e1');
  assert.ok(view(s).legalMoves.every(m => m.from === 'e1'));
  assert.throws(() => move(s, 'a1', 'a8'), /not legal/);
});
test('castling requires a clear, safe king path and moves both pieces', () => {
  let s = position('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  assert.ok(view(s).legalMoves.some(m => m.from === 'e1' && m.to === 'g1'));
  s = move(s, 'e1', 'g1'); const c = new Chess(s.fen);
  assert.equal(c.get('g1').type, 'k'); assert.equal(c.get('f1').type, 'r'); assert.equal(c.get('h1'), undefined);
  s = position('r3k2r/8/8/8/2b5/8/8/R3K2R w KQkq - 0 1');
  assert.ok(!view(s).legalMoves.some(m => m.from === 'e1' && m.to === 'g1'));
  assert.throws(() => move(s, 'e1', 'g1'), /not legal/);
});
test('en passant works only immediately, and cannot expose the king', () => {
  let s = position('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2');
  s = move(s, 'e5', 'd6'); const c = new Chess(s.fen);
  assert.equal(c.get('d5'), undefined); assert.equal(c.get('d6').type, 'p'); assert.equal(s.history.at(-1).captured, 'p');
  s = position('k3r3/8/8/3pP3/8/8/8/4K3 w - d6 0 2');
  assert.ok(!view(s).legalMoves.some(m => m.from === 'e5' && m.to === 'd6'));
  s = position('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2');
  s = move(s, 'e1', 'f1'); s = move(s, 'e8', 'f8');
  assert.ok(!view(s).legalMoves.some(m => m.from === 'e5' && m.to === 'd6'));
});
test('all four promotion choices are required and validated', () => {
  for (const type of ['q','r','b','n']) {
    const s = position('7k/P7/8/8/8/8/8/4K3 w - - 0 1');
    assert.equal(view(s).legalMoves.filter(m => m.from === 'a7').length, 4);
    assert.throws(() => move(s, 'a7', 'a8'), /not legal/);
    assert.equal(new Chess(move(s, 'a7', 'a8', type).fen).get('a8').type, type);
  }
});
test('Fool’s mate announces checkmate, records the winner, and rejects subsequent moves', () => {
  let s = start(); for (const [from,to] of [['f2','f3'],['e7','e5'],['g2','g4'],['d8','h4']]) s = move(s,from,to);
  assert.equal(s.phase,'game_result'); assert.equal(s.result.reason,'checkmate'); assert.equal(s.result.winnerId,'guest');
  assert.equal(view(s).legalMoves.length,0); assert.throws(() => move(s,'e1','f2'),/not accepting/);
});
test('stalemate is a draw, distinct from checkmate; insufficient material ends automatically', () => {
  const s = position('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1'); adjudicate(s);
  assert.equal(s.result.reason,'stalemate'); assert.equal(s.result.winnerId,null); assert.equal(view(s).check,false);
  for (const fen of ['7k/8/6K1/8/8/8/8/8 w - - 0 1','7k/8/6K1/8/8/8/8/2B5 w - - 0 1']) {
    const s = position(fen); adjudicate(s); assert.equal(s.result.reason,'insufficient_material');
  }
});
test('threefold/fifty-move claims and automatic fivefold/75-move draws preserve history', () => {
  let s = start(); const cycle = [['g1','f3'],['g8','f6'],['f3','g1'],['f6','g8']];
  for(let i=0;i<2;i++) for(const [a,b] of cycle) s=move(s,a,b);
  assert.equal(s.phase,'playing'); assert.equal(view(s).canClaimDraw,true);
  const claimed=applyAction(s,'host','CHESS_ACTION',{action:'CLAIM_DRAW'},()=>0,0); assert.equal(claimed.result.reason,'threefold_repetition');
  for(let i=0;i<2;i++) for(const [a,b] of cycle) s=move(s,a,b);
  assert.equal(s.result.reason,'fivefold_repetition');
  s = position('6k1/8/8/8/8/8/8/R3K3 w - - 100 51');
  assert.equal(view(s).canClaimDraw,true); assert.equal(applyAction(s,'host','CHESS_ACTION',{action:'CLAIM_DRAW'},()=>0,0).result.reason,'fifty_moves');
  s=position('6k1/8/8/8/8/8/8/R3K3 w - - 149 76'); s=move(s,'a1','a2'); assert.equal(s.result.reason,'seventy_five_moves');
});
test('clocks debit only the active player and cannot be reset or bypassed by invalid moves', () => {
  let s=start({minutes:1}); assert.equal(automaticTransition(s,0).delay,60000);
  s=move(s,'e2','e4',null,1500); assert.equal(s.clock.w,58500); assert.equal(s.clock.b,60000); assert.equal(s.clock.running,'b');
  assert.equal(buildViewForPlayer(s,'host',2500).clock.b,59000);
  const before=structuredClone(s); assert.throws(()=>move(s,'e7','e4',null,5000),/not legal/); assert.deepEqual(s,before);
  s=applyAction(s,'host','CHESS_ACTION',{action:'OFFER_DRAW'},()=>0,6500); assert.equal(s.clock.b,55000);
  s=expireClock(s,61500); assert.equal(s.result.reason,'timeout'); assert.equal(s.result.winnerColor,'w'); assert.equal(s.clock.b,0);
  assert.equal(start().clock,null); assert.equal(automaticTransition(start(),0),null);
});
test('a move received at/after expiry loses on time and bare-king timeout is a draw', () => {
  let s=start({minutes:1}); s=move(s,'e2','e4',null,60000); assert.equal(s.result.reason,'timeout'); assert.equal(s.history.length,0);
  s=position('7k/8/6K1/8/8/8/8/R7 w - - 0 1',{minutes:1});
  s=expireClock(s,60000); assert.equal(s.result.reason,'timeout_insufficient_material'); assert.equal(s.result.winnerId,null);
  assert.equal(canPossiblyMate(new Chess('7k/8/6K1/8/8/8/8/R7 w - - 0 1'),'b'),false);
});
test('offers need recipient approval, resignation is final and rematch returns to a ready-checked lobby', () => {
  let s=start(); s=applyAction(s,'host','CHESS_ACTION',{action:'OFFER_DRAW'},()=>0,0);
  assert.throws(()=>applyAction(s,'host','CHESS_ACTION',{action:'ACCEPT_DRAW'},()=>0,0),/no draw offer/);
  s=applyAction(s,'guest','CHESS_ACTION',{action:'ACCEPT_DRAW'},()=>0,0); assert.equal(s.result.reason,'agreement');
  assert.throws(()=>applyAction(s,'guest','PLAY_AGAIN'),/host/);
  s=applyAction(s,'host','PLAY_AGAIN'); assert.equal(s.phase,'lobby'); assert.equal(s.players[1].ready,false);
  s=start(); s=applyAction(s,'host','CHESS_ACTION',{action:'RESIGN'},()=>0,0); assert.equal(s.result.winnerId,'guest');
});
test('a lost player freezes the game and a host can reopen the lobby', () => {
  let s=start({minutes:10}); s=removePlayer(s,'guest',2500); assert.equal(s.phase,'disconnected'); assert.equal(s.clock.w,597500); assert.equal(s.clock.running,null); assert.equal(automaticTransition(s),null);
  s=applyAction(s,'host','RETURN_TO_LOBBY'); assert.equal(s.players.length,1); assert.equal(s.settings.minutes,10);
});
test('wire schema rejects fake identities, invalid squares, settings and promotion types', () => {
  for(const p of [{action:'MOVE',from:'a2',to:'a4'},{action:'SETTINGS',hostColor:'random',minutes:180},{action:'RESIGN'}]) {
    assert.equal(isChessAction(p),true); assert.equal(isClientMessage(message('CHESS_ACTION',p)),true);
  }
  for(const p of [null,[],{action:'MOVE',from:'a2',to:'a9'},{action:'MOVE',from:'e2',to:'e4',playerId:'host'},{action:'MOVE',from:'a7',to:'a8',promotion:'k'},{action:'SETTINGS',hostColor:'w',minutes:-1},{action:'SETTINGS',hostColor:'w',minutes:181},{action:'SETTINGS',hostColor:'w',minutes:1.5},{action:'RESIGN',winnerId:'guest'}]) assert.equal(isChessAction(p),false);
});
test('chess is omitted from the multiplayer collection and all production modules are versioned, with local licensed rules', async () => {
  const {COLLECTION_GAMES}=await import('../games/registry.mjs'); assert.ok(COLLECTION_GAMES.every(g=>g.id!=='chess'));
  const root=new URL('../',import.meta.url), html=await readFile(new URL('games/chess/index.html',root),'utf8');
  assert.match(html,/noindex, nofollow/); assert.match(html,/monetization\.js/); assert.match(html,/9380002810/);
  const config=JSON.parse(await readFile(new URL('config.json',root),'utf8'));
  const files=(await readdir(root,{recursive:true})).filter(f=>f.endsWith('.mjs')&&!f.startsWith('tests/')&&!f.startsWith('node_modules/')).map(f=>'./'+f).sort();
  assert.deepEqual([...config.modules].sort(),files); assert.match(await readFile(new URL('games/chess/vendor/LICENSE',root),'utf8'),/Jeff Hlywa/);
});
