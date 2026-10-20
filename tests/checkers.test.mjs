import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {initialBoard,legalTurn,positionKey} from '../games/checkers/rules.mjs';
import {createLobby,addPlayer,applyAction,buildViewForPlayer,adjudicate,removePlayer,checkersAdapter} from '../games/checkers/game-core.mjs';
import {isCheckersAction} from '../games/checkers/action-schema.mjs';
import {isClientMessage,message} from '../shared/protocol.mjs';
const piece=(square,color='w',king=false)=>({square,color,king});
function start(color='w',pick=()=>0){let s=addPlayer(createLobby('host','Host'),'guest','Guest');s=applyAction(s,'host','CHECKERS_ACTION',{action:'SETTINGS',hostColor:color},pick);s=applyAction(s,'guest','SET_READY',{ready:true},pick);return applyAction(s,'host','START_GAME',{},pick);}
function position(board,turn='w'){const s=start();Object.assign(s,{board,turn,positions:{[positionKey(board,turn)]:1}});return s;}
const move=(s,from,to)=>applyAction(s,s.players.find(p=>p.color===s.turn).id,'CHECKERS_ACTION',{action:'MOVE',from,to});
const legal=s=>legalTurn(s.board,s.turn,s.chain).moves;
test('8×8 starts with 12 men per side on dark squares and no clock',()=>{
  const board=initialBoard();assert.equal(board.length,24);assert.equal(board.filter(p=>p.color==='w').length,12);assert.ok(board.every(p=>(p.square.charCodeAt(0)+Number(p.square[1]))%2===0&&!p.king));
  const s=start();assert.equal(legal(s).length,7);assert.equal(Object.hasOwn(s,'clock'),false);assert.equal(checkersAdapter.automaticTransition(s),null);
  assert.equal(buildViewForPlayer(s,'guest').legalMoves.length,0);
});
test('host colors and random selection choose who starts; lobby permits exactly two ready players',()=>{
  for(const [color,pick,expected]of[['w',()=>0,'w'],['b',()=>0,'b'],['random',()=>0,'w'],['random',()=>1,'b']]){const s=start(color,pick);assert.equal(s.players[0].color,expected);assert.equal(s.turn,'w');}
  let s=addPlayer(createLobby('host','Host'),'guest','Guest');assert.throws(()=>addPlayer(s,'third','Third'),/two players/);assert.throws(()=>applyAction(s,'host','START_GAME'),/ready/);
  assert.throws(()=>applyAction(s,'guest','CHECKERS_ACTION',{action:'SETTINGS',hostColor:'b'}),/host/);
  s=applyAction(s,'guest','SET_READY',{ready:true});s=applyAction(s,'host','CHECKERS_ACTION',{action:'SETTINGS',hostColor:'b'});assert.equal(s.players[1].ready,false);
});
test('men move one diagonal step forwards, never onto occupied or light squares',()=>{
  const s=position([piece('c3'),piece('d4'),piece('h8','b')]);assert.deepEqual(legal(s).filter(m=>m.from==='c3').map(m=>m.to),['b4']);
  for(const [from,to]of[['c3','b2'],['c3','c4'],['c3','e5'],['c3','d4']])assert.throws(()=>move(s,from,to));
});
test('captures are compulsory globally; only sources with maximum capture length can move',()=>{
  let s=position([piece('a3'),piece('h2'),piece('b4','b'),piece('d6','b'),piece('g3','b')]);
  assert.deepEqual(legal(s).map(m=>[m.from,m.to,m.count]),[['a3','c5',2]]);
  const before=structuredClone(s);assert.throws(()=>move(s,'h2','f4'),/compulsory/);assert.throws(()=>move(s,'h2','g3'),/compulsory/);assert.deepEqual(s,before);
  s=move(s,'a3','c5');assert.equal(s.turn,'w');assert.equal(s.chain.square,'c5');assert.deepEqual(s.chain.captured,['b4']);assert.equal(s.history.length,0);
  assert.ok(legal(s).every(m=>m.from==='c5'&&m.to==='e7'));assert.throws(()=>move(s,'h2','f4'),/compulsory/);
  s=move(s,'c5','e7');assert.equal(s.turn,'b');assert.equal(s.chain,null);assert.equal(s.history[0].notation,'a3×c5×e7');assert.equal(s.history[0].captured.length,2);assert.ok(!s.board.some(p=>['b4','d6'].includes(p.square)));
});
test('men capture backwards and a continuation must take the longest remaining branch',()=>{
  let s=position([piece('c3'),piece('d2','b'),piece('h8','b')]);s=move(s,'c3','e1');assert.ok(s.board.some(p=>p.square==='e1'&&!p.king));
  s=position([piece('c3'),piece('d4','b'),piece('d6','b'),piece('f4','b'),piece('f2','b')]);s=move(s,'c3','e5');
  assert.deepEqual(legal(s).map(m=>m.to),['g3']);assert.throws(()=>move(s,'e5','c7'),/compulsory/);s=move(s,'e5','g3');s=move(s,'g3','e1');assert.equal(s.history[0].captured.length,3);
});
test('flying kings choose only landing squares that allow the longest full sequence',()=>{
  let s=position([piece('c3','w',true),piece('e5','b'),piece('g5','b')]);assert.deepEqual(legal(s).map(m=>m.to),['f6']);
  s=move(s,'c3','f6');assert.deepEqual(legal(s).map(m=>m.to),['h4']);s=move(s,'f6','h4');assert.equal(s.result.reason,'all_captured');
  s=position([piece('c3','w',true),piece('h8','b')]);assert.ok(legal(s).some(m=>m.to==='g7'));assert.throws(()=>move(s,'c3','h8'));
});
test('jumped pieces remain blockers until the sequence ends and cannot be jumped twice',()=>{
  const s=position([piece('c3','w',true),piece('d4','b'),piece('b2','b')]);assert.ok(legal(s).every(m=>m.count===1));
  const finished=move(s,'c3','e5');assert.equal(finished.chain,null);assert.equal(finished.history[0].captured.length,1);assert.equal(finished.turn,'b');
});
test('empty squares, including the source, may be revisited during a four-capture loop',()=>{
  let s=position([piece('c3'),piece('d4','b'),piece('f4','b'),piece('f2','b'),piece('d2','b'),piece('h8','b')]);
  for(const [from,to]of[['c3','e5'],['e5','g3'],['g3','e1'],['e1','c3']])s=move(s,from,to);
  assert.equal(s.history[0].captured.length,4);assert.equal(s.history[0].to,'c3');assert.equal(s.chain,null);assert.equal(s.board.length,2);
});
test('promotion happens only at the completed turn, never in the middle of a capture',()=>{
  let s=position([piece('a7'),piece('h8','b')]);s=move(s,'a7','b8');assert.equal(s.board.find(p=>p.square==='b8').king,true);assert.equal(s.history[0].promoted,true);
  s=position([piece('b6'),piece('c7','b'),piece('e7','b'),piece('h8','b')]);s=move(s,'b6','d8');assert.equal(s.board.find(p=>p.square==='d8').king,false);assert.equal(s.chain.square,'d8');s=move(s,'d8','f6');assert.equal(s.board.find(p=>p.square==='f6').king,false);
});
test('a player with no pieces or no legal move loses; threefold and quiet kings are drawn',()=>{
  let s=position([piece('a1'),piece('h8','b')],'w');s.board=[piece('a1')];s.turn='b';adjudicate(s);assert.equal(s.result.reason,'all_captured');
  s=position([piece('a1','b'),piece('h8')],'b');adjudicate(s);assert.equal(s.result.reason,'blocked');assert.equal(s.result.winnerColor,'w');
  s=position([piece('a1','w',true),piece('h8','b',true)]);s.positions[positionKey(s.board,s.turn)]=3;adjudicate(s);assert.equal(s.result.reason,'repetition');
  s=position([piece('a1','w',true),piece('h8','b',true)]);s.quietKings=49;s=move(s,'a1','b2');assert.equal(s.result.reason,'quiet_kings');
});
test('views expose legal moves only to the active player, pending captures and independent copies',()=>{
  let s=position([piece('c3'),piece('d4','b'),piece('f6','b')]);s=move(s,'c3','e5');const v=buildViewForPlayer(s,'host');assert.equal(v.continuation,'e5');assert.deepEqual(v.pendingCaptured,['d4']);assert.equal(v.requiredCaptures,1);
  v.board[0].square='h8';assert.notEqual(s.board[0].square,'h8');assert.equal(buildViewForPlayer(s,'guest').legalMoves.length,0);
});
test('draws, resignation, rematches and disconnect recovery reuse the room with fresh readiness',()=>{
  let s=start();s=applyAction(s,'host','CHECKERS_ACTION',{action:'OFFER_DRAW'});assert.throws(()=>applyAction(s,'host','CHECKERS_ACTION',{action:'ACCEPT_DRAW'}),/no draw offer/);
  s=applyAction(s,'guest','CHECKERS_ACTION',{action:'ACCEPT_DRAW'});assert.equal(s.result.reason,'agreement');assert.throws(()=>applyAction(s,'guest','PLAY_AGAIN'),/host/);s=applyAction(s,'host','PLAY_AGAIN');assert.equal(s.phase,'lobby');assert.equal(s.players[1].ready,false);
  s=applyAction(start(),'host','CHECKERS_ACTION',{action:'RESIGN'});assert.equal(s.result.winnerId,'guest');
  s=removePlayer(start(),'guest');assert.equal(s.phase,'disconnected');s=applyAction(s,'host','RETURN_TO_LOBBY');assert.equal(s.players.length,1);
});
test('wire schema rejects clocks, forged identity, impossible squares and chess promotions',()=>{
  for(const p of [{action:'SETTINGS',hostColor:'random'},{action:'MOVE',from:'c3',to:'d4'},{action:'RESIGN'}]){assert.ok(isCheckersAction(p));assert.ok(isClientMessage(message('CHECKERS_ACTION',p)));}
  for(const p of [null,[],{action:'SETTINGS',hostColor:'w',minutes:5},{action:'MOVE',from:'c3',to:'c4'},{action:'MOVE',from:'c3',to:'j9'},{action:'MOVE',from:'c3',to:'d4',playerId:'host'},{action:'MOVE',from:'a7',to:'b8',promotion:'q'},{action:'RESIGN',winnerId:'guest'}])assert.equal(isCheckersAction(p),false);
});
test('checkers is omitted from the multiplayer collection; production modules are versioned and artwork is local',async()=>{
  const {COLLECTION_GAMES}=await import('../games/registry.mjs');assert.ok(COLLECTION_GAMES.every(g=>g.id!=='checkers'));
  const root=new URL('../',import.meta.url),html=await readFile(new URL('games/checkers/index.html',root),'utf8');assert.match(html,/noindex, nofollow/);assert.match(html,/monetization\.js/);assert.match(html,/baseStyle.href = '\.\.\/chess\/style.css' \+ assetQuery/);
  const config=JSON.parse(await readFile(new URL('config.json',root),'utf8'));
  const files=(await readdir(root,{recursive:true})).filter(f=>f.endsWith('.mjs')&&!f.startsWith('tests/')&&!f.startsWith('node_modules/')).map(f=>'./'+f).sort();assert.deepEqual([...config.modules].sort(),files);
});
test('seeded full matches preserve material, square uniqueness and a locked capturing player',()=>{
  let seed=79;const pick=max=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%max;};
  for(let game=0;game<24;game++){
    let s=start(),steps=0;
    while(s.phase==='playing'&&steps++<2000){
      const options=legal(s),selected=options[pick(options.length)],before=s;
      assert.ok(options.length);assert.ok(options.every(m=>m.capture===Boolean(legalTurn(s.board,s.turn,s.chain).requiredCaptures)));
      s=move(s,selected.from,selected.to);
      assert.equal(new Set(s.board.map(p=>p.square)).size,s.board.length);assert.ok(s.board.length<=before.board.length);assert.ok(s.board.every(p=>(p.square.charCodeAt(0)+Number(p.square[1]))%2===0));
      if(s.chain){assert.equal(s.turn,before.turn);assert.equal(s.board.length,before.board.length);assert.ok(legal(s).every(m=>m.from===s.chain.square));}
      else{assert.notEqual(s.turn,before.turn);assert.equal(before.board.length-s.board.length,s.history.at(-1).captured.length);}
    }
    assert.equal(s.phase,'game_result',`Seeded game ${game} should finish`);
  }
});
