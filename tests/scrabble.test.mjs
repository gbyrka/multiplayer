import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { readDictionary } from '../games/boggle/dictionary.mjs';
import { makeBag, PREMIUMS, LANGUAGES } from '../games/scrabble/constants.mjs';
import { evaluateMove } from '../games/scrabble/rules.mjs';
import { draftMove } from '../games/scrabble/editor.mjs';
import { createScrabbleGame } from '../games/scrabble/game-core.mjs';
import { isClientMessage, message } from '../shared/protocol.mjs';
const dictionaries = {};
for (const language of ['pl','en']) {
  const binary = gunzipSync(readFileSync(new URL(`../games/boggle/data/${language}.bin.gz`,import.meta.url)));
  dictionaries[language] = readDictionary(binary.buffer.slice(binary.byteOffset,binary.byteOffset+binary.byteLength));
}
const empty = () => Array(225).fill(null);
const rack = word => [...word].map((letter,i) => ({id:`t${i}`,letter:letter === '?' ? '' : letter}));
const fixed = letter => ({letter,blank:false});
const placement = (index,tileId,letter) => ({index,tileId,letter});
const play = (board,letters,start,text,language='en',vertical=false,blanks=[]) => {
  const tiles = rack(letters), draft = draftMove(board,tiles,start,vertical,text,language,blanks);
  assert.equal(draft.error,''); return evaluateMove(board,tiles,draft.placements,language,dictionaries[language]);
};
test('language-specific bags contain 100 unique tiles, two blanks and symmetric premiums', () => {
  for (const language of ['pl','en']) {
    const bag = makeBag(language,()=>0); assert.equal(bag.length,100); assert.equal(new Set(bag.map(t=>t.id)).size,100); assert.equal(bag.filter(t=>!t.letter).length,2);
    for (const [letter,count] of LANGUAGES[language].tiles) assert.equal(bag.filter(t=>t.letter===letter).length,count);
  }
  assert.equal(PREMIUMS.length,225); assert.equal(PREMIUMS[112],'DW');
  for (let i=0;i<225;i++) { assert.equal(PREMIUMS[i],PREMIUMS[224-i]); assert.equal(PREMIUMS[i],PREMIUMS[(i%15)*15+Math.floor(i/15)]); }
});
test('opening covers centre, scores double word, and later words do not reuse its premium', () => {
  const first = play(empty(),'cat',111,'cat'); assert.equal(first.points,10);
  const next = play(first.board,'s',111,'cats'); assert.equal(next.points,6); assert.equal(next.words[0].word,'cats');
  assert.throws(()=>play(empty(),'cat',0,'cat'),/centre/);
});
test('all crossing words score and every crossing must be in the dictionary', () => {
  const board = empty(); board[97]=fixed('a'); board[98]=fixed('t');
  const result = play(board,'to',112,'to');
  assert.deepEqual(result.words.map(w=>[w.word,w.points]),[['to',4],['at',4],['to',2]]); assert.equal(result.points,10);
  const tiles=rack('to'),draft=draftMove(board,tiles,112,false,'to','en');
  assert.throws(()=>evaluateMove(board,tiles,draft.placements,'en',{has:word=>word!=='at'}),/AT/);
});
test('one new tile can form two words at once', () => {
  const board=empty(); for(const [i,letter] of [[111,'c'],[113,'t'],[97,'r'],[127,'t']]) board[i]=fixed(letter);
  assert.equal(play(board,'a',112,'a').points,16);
});
test('letter premiums, multiple word premiums and seven-tile bonus', () => {
  const tiles=rack('reading'), d=draftMove(empty(),tiles,109,false,'reading','en');
  const result=evaluateMove(empty(),tiles,d.placements,'en',dictionaries.en); assert.equal(result.bonus,50); assert.equal(result.points,68);
  const arbitrary={has:()=>true};
  // Eight is intentionally rejected, even if the dictionary would accept it.
  assert.throws(()=>evaluateMove(empty(),rack('abcdefgh'),Array.from({length:8},(_,i)=>placement(100+i,`t${i}`,'a')),'en',arbitrary),/seven/);
  const b=empty(); b[16]=fixed('a');
  const t=rack('at'),p=[placement(0,'t0','a'),placement(15,'t1','t')];
  assert.equal(evaluateMove(b,t,p,'en',arbitrary).words.find(w=>w.word==='at').points,6);
  const twoTriples=empty();for(let i=1;i<7;i++)twoTriples[i]=fixed('a');
  assert.equal(evaluateMove(twoTriples,rack('aa'),[placement(0,'t0','a'),placement(7,'t1','a')],'en',arbitrary).points,72);
  const letterPremium=empty();letterPremium[4]=fixed('a');
  assert.equal(evaluateMove(letterPremium,rack('c'),[placement(3,'t0','c')],'en',arbitrary).points,7);
});
test('blanks preserve zero value and activate word premiums; explicit choice preserves ordinary tile', () => {
  const first=play(empty(),'c?t',111,'cat'); assert.equal(first.points,8); assert.equal(first.board[112].blank,true);
  assert.equal(play(first.board,'s',111,'cats').points,5);
  const tiles=rack('cat?'),d=draftMove(empty(),tiles,111,false,'cat','en',[112]); assert.equal(d.placements[1].tileId,'t3');
  assert.equal(evaluateMove(empty(),tiles,d.placements,'en',dictionaries.en).points,8);
});
test('editor consumes full words, supports accents, boundaries, duplicate letters and conflicting fixed tiles', () => {
  const board=empty(); board[112]=fixed('o'); const d=draftMove(board,rack('kt'),111,false,'KOT','pl');
  assert.deepEqual(d.placements.map(p=>[p.index,p.letter]),[[111,'k'],[113,'t']]);
  assert.match(draftMove(board,rack('cat'),111,false,'cat','en').error,/contains O/);
  assert.match(draftMove(empty(),rack('cat'),14,false,'cat','en').error,/beyond/);
  assert.match(draftMove(empty(),rack('a'),112,false,'aa','en').error,/No A/);
  assert.equal(play(empty(),'żółw',110,'ŻÓŁW','pl').words[0].word,'żółw');
  assert.equal(dictionaries.en.has('at'),true); assert.equal(dictionaries.pl.has('za'),true);
});
test('rejects gaps, diagonal moves, disconnected plays, forged tiles and reused rack identities', () => {
  const tiles=rack('cat');
  assert.throws(()=>evaluateMove(empty(),tiles,[placement(110,'t0','c'),placement(112,'t1','a')],'en'),/gap/);
  assert.throws(()=>evaluateMove(empty(),tiles,[placement(112,'t0','c'),placement(128,'t1','a')],'en'),/row or column/);
  const board=empty();board[112]=fixed('a');
  assert.throws(()=>evaluateMove(board,tiles,[placement(0,'t0','c')],'en'),/Connect/);
  assert.throws(()=>evaluateMove(empty(),tiles,[placement(112,'t0','z')],'en'),/match/);
  assert.throws(()=>evaluateMove(empty(),tiles,[placement(112,'t0','c'),placement(113,'t0','c')],'en'),/those tiles/);
  assert.throws(()=>evaluateMove(empty(),tiles,[placement(112,'t99','c')],'en'),/those tiles/);
});
function session({solo=true,seconds=0}={}) {
  let at=1000;const game=createScrabbleGame({solo,now:()=>at,pick:()=>0});game.stageDictionary(dictionaries.en,'en');
  let state=game.adapter.createLobby('host','Host');state=game.adapter.applyAction(state,'host','SCRABBLE_ACTION',{action:'SETTINGS',language:'en',seconds});
  if(!solo) { state=game.adapter.addPlayer(state,'guest','Guest');state=game.adapter.applyAction(state,'guest','SET_READY',{ready:true}); }
  state=game.adapter.applyAction(state,'host','START_GAME');
  return {game,get state(){return state;},set state(s){state=s;},set time(t){at=t;},get time(){return at;},act(action,payload={},id=state.players[state.turnIndex].id){state=game.adapter.applyAction(state,id,'SCRABBLE_ACTION',{action,turn:state.turnSerial,...payload});return state;}};
}
test('solo and multiplayer use the same engine, with private racks and a maximum of four players', () => {
  const s=session({solo:false}),view=s.game.adapter.buildViewForPlayer(s.state,'host');
  assert.equal(view.rack.length,7); assert.equal(view.bagCount,86); assert.equal(view.finalRacks,null); assert.equal(view.racks,undefined);
  const ids=s.state.racks.guest.map(t=>t.id); assert.equal(view.rack.some(t=>ids.includes(t.id)),false);
  assert.throws(()=>s.act('PASS',{},'guest'),/turn/);
  const g=createScrabbleGame();let lobby=g.adapter.createLobby('a','A');for(const id of ['b','c','d'])lobby=g.adapter.addPlayer(lobby,id,id);
  assert.throws(()=>g.adapter.addPlayer(lobby,'e','E'),/full/);
  assert.throws(()=>createScrabbleGame({solo:true}).adapter.addPlayer(createScrabbleGame({solo:true}).adapter.createLobby('a','A'),'b','B'),/full/);
});
test('deadline is authoritative, invalid moves do not reset it, and a late action becomes a timeout pass', () => {
  const s=session({seconds:30}),end=s.state.endsAt;s.time+=1000;
  assert.throws(()=>s.act('PLAY',{placements:[placement(112,'t999','a')]}));assert.equal(s.state.endsAt,end);
  s.time=end; s.act('PASS'); assert.equal(s.state.history.at(-1).kind,'timeout');assert.equal(s.state.turnSerial,2);assert.equal(s.state.endsAt,end+30000);
  s.time+=30000;const transition=s.game.adapter.automaticTransition(s.state);assert.equal(transition.delay,0);s.state=transition.apply(s.state);assert.equal(s.state.history.length,2);
  const untimed=session();assert.equal(untimed.game.adapter.automaticTransition(untimed.state),null);
});
test('exchange draws before returning tiles, cannot exchange below seven, and records no private letters', () => {
  const s=session(),ids=s.state.racks.host.slice(0,3).map(t=>t.id);s.act('EXCHANGE',{tileIds:ids});
  assert.equal(s.state.racks.host.length,7);assert.equal(s.state.racks.host.some(t=>ids.includes(t.id)),false);assert.equal(s.state.bag.length,93);
  assert.equal(s.state.history.at(-1).tileIds,undefined);
  s.state={...s.state,bag:s.state.bag.slice(0,6)};assert.throws(()=>s.act('EXCHANGE',{tileIds:[s.state.racks.host[0].id]}),/seven/);
});
test('finishing an empty rack transfers unused points; six scoreless turns end and deduct racks', () => {
  const s=session({solo:false});s.state={...s.state,bag:[],racks:{host:rack('cat'),guest:[{id:'t20',letter:'q'}]}};
  s.act('PLAY',{placements:draftMove(s.state.board,s.state.racks.host,111,false,'cat','en').placements});
  assert.equal(s.state.phase,'game_result');assert.equal(s.state.players[0].score,20);assert.equal(s.state.players[1].score,-10);assert.deepEqual(s.state.result.winnerIds,['host']);
  const practice=session();for(let i=0;i<6;i++)practice.act('PASS');assert.equal(practice.state.phase,'game_result');assert.equal(practice.state.result.reason,'scoreless');assert.ok(practice.state.players[0].score<0);
});
test('accepted move advances a solo turn, resets clock and refills rack; rematches retain settings', () => {
  const s=session({seconds:60});s.state={...s.state,racks:{host:rack('cat')}};s.time=1500;
  s.act('PLAY',{placements:draftMove(s.state.board,s.state.racks.host,111,false,'cat','en').placements});
  assert.equal(s.state.turnSerial,2);assert.equal(s.state.endsAt,61500);assert.equal(s.state.racks.host.length,7);assert.equal(s.state.scoreless,0);
  s.act('END_PRACTICE');s.state=s.game.adapter.applyAction(s.state,'host','PLAY_AGAIN');assert.equal(s.state.phase,'lobby');assert.deepEqual(s.state.settings,{language:'en',seconds:60});assert.equal(s.state.turnSerial,2);
});
test('disconnect stops a timed game; schemas reject unexpected fields, duplicates and invalid time settings', () => {
  const s=session({solo:false,seconds:30});const stopped=s.game.adapter.removePlayer(s.state,'guest');assert.equal(stopped.phase,'disconnected');assert.equal(stopped.endsAt,null);
  const reopened=s.game.adapter.applyAction(stopped,'host','RETURN_TO_LOBBY');assert.equal(reopened.players.length,1);assert.equal(reopened.players[0].ready,true);
  for (const payload of [{action:'PASS',turn:1,playerId:'other'},{action:'SETTINGS',language:'en',seconds:-1},{action:'SETTINGS',language:'en',seconds:1.5},{action:'PLAY',turn:1,placements:[placement(225,'t0','a')]},{action:'END_PRACTICE',turn:0}]) assert.equal(isClientMessage(message('SCRABBLE_ACTION',payload)),false);
  assert.equal(isClientMessage(message('SCRABBLE_ACTION',{action:'PASS',turn:1})),true);
});
