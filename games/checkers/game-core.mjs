import { randomInt, validateName } from '../../shared/random.mjs';
import { isCheckersAction } from './action-schema.mjs';
import { initialBoard, legalTurn, positionKey, other } from './rules.mjs';
export { initialBoard, legalTurn };
export const PHASES=Object.freeze(['lobby','playing','game_result','disconnected']);
const requireRule=(condition,text)=>{if(!condition)throw new Error(text);};
const player=(id,name,host=false)=>({id,name:validateName(name),host,ready:host,connected:true,color:null});
export function createLobby(hostId,name) {
  return {revision:0,phase:'lobby',hostId,players:[player(hostId,name,true)],settings:{hostColor:'random'},
    board:initialBoard(),turn:'w',chain:null,history:[],stepSerial:0,quietKings:0,positions:{},result:null,drawOffer:null,disconnectedNames:[]};
}
export const canStart=s=>s.phase==='lobby'&&s.players.length===2&&s.players.every(p=>p.connected&&p.ready);
export function addPlayer(state,id,name) {
  requireRule(state.phase==='lobby'&&state.players.length<2,'This checkers table already has two players or a game in progress.');
  requireRule(typeof id==='string'&&!state.players.some(p=>p.id===id),'Player already joined.');
  const next=structuredClone(state);next.players.push(player(id,name));next.revision++;return next;
}
function finish(state,reason,winnerColor=null) {
  state.phase='game_result';state.drawOffer=null;
  state.result={reason,winnerColor,winnerId:state.players.find(p=>p.color===winnerColor)?.id??null};
}
export function adjudicate(state) {
  if (!state.board.some(p=>p.color===state.turn)) finish(state,'all_captured',other(state.turn));
  else if (!legalTurn(state.board,state.turn).moves.length) finish(state,'blocked',other(state.turn));
  else if ((state.positions[positionKey(state.board,state.turn)]??0)>=3) finish(state,'repetition');
  else if (state.quietKings>=50) finish(state,'quiet_kings');
}
export function removePlayer(state,id) {
  if(id===state.hostId||!state.players.some(p=>p.id===id&&p.connected))return state;
  const next=structuredClone(state);
  if(next.phase==='lobby')next.players=next.players.filter(p=>p.id!==id);
  else{next.players.find(p=>p.id===id).connected=false;next.disconnectedNames=[next.players.find(p=>p.id===id).name];next.phase='disconnected';}
  next.revision++;return next;
}
export function applyAction(state,actorId,type,payload={},pick=randomInt) {
  const actor=state.players.find(p=>p.id===actorId&&p.connected);requireRule(actor,'You are no longer at this table.');
  const hostOnly=()=>requireRule(actor.host,'Only the host can change this.');
  const next=structuredClone(state);
  if(type==='SET_READY') {
    requireRule(state.phase==='lobby'&&!actor.host&&typeof payload.ready==='boolean','Ready is only available to the guest in the lobby.');
    next.players.find(p=>p.id===actorId).ready=payload.ready;
  } else if(type==='START_GAME') {
    hostOnly();requireRule(canStart(state),'Both players must be connected and ready.');
    const hostColor=state.settings.hostColor==='random'?(pick(2)===0?'w':'b'):state.settings.hostColor;
    next.players.forEach(p=>{p.color=p.host?hostColor:other(hostColor);});
    Object.assign(next,{phase:'playing',board:initialBoard(),turn:'w',chain:null,history:[],stepSerial:0,quietKings:0,result:null,drawOffer:null});
    next.positions={[positionKey(next.board,next.turn)]:1};
  } else if(type==='PLAY_AGAIN'||type==='RETURN_TO_LOBBY') {
    hostOnly();requireRule(['game_result','disconnected'].includes(state.phase),'Finish this game first.');
    const lobby=createLobby(state.hostId,state.players.find(p=>p.host).name);lobby.settings={...state.settings};
    lobby.players=state.players.filter(p=>p.connected).map(p=>player(p.id,p.name,p.host));lobby.revision=state.revision+1;return lobby;
  } else if(type==='CHECKERS_ACTION') {
    requireRule(isCheckersAction(payload),'Invalid checkers action.');
    if(payload.action==='SETTINGS') {
      hostOnly();requireRule(state.phase==='lobby','Settings are fixed while the game is running.');
      next.settings={hostColor:payload.hostColor};next.players.forEach(p=>{p.ready=p.host;});
    } else {
      requireRule(state.phase==='playing','This game is not accepting moves.');
      switch(payload.action) {
        case 'MOVE': {
          requireRule(actor.color===state.turn,'Please wait for your turn.');
          const legal=legalTurn(state.board,state.turn,state.chain), move=legal.moves.find(m=>m.from===payload.from&&m.to===payload.to);
          requireRule(move,legal.requiredCaptures?'A capture is compulsory. Follow a longest available capture sequence.':'That diagonal move is not legal.');
          const piece=next.board.find(p=>p.square===move.from),wasKing=piece.king;piece.square=move.to;next.stepSerial++;
          if(next.drawOffer!==actorId)next.drawOffer=null;
          const chain=state.chain?structuredClone(state.chain):{origin:move.from,square:move.from,path:[move.from],captured:[],wasKing};
          chain.square=move.to;chain.path.push(move.to);if(move.capture)chain.captured.push(move.capturedSquare);
          if(move.capture&&legalTurn(next.board,next.turn,chain).moves.length) {next.chain=chain;break;}
          const captured=new Set(chain.captured);next.board=next.board.filter(p=>!captured.has(p.square));
          const promoted=!wasKing&&Number(move.to[1])===(piece.color==='w'?8:1);if(promoted)piece.king=true;
          next.chain=null;next.quietKings=wasKing&&!captured.size?state.quietKings+1:0;
          next.history.push({ply:state.history.length+1,color:state.turn,from:chain.origin,to:move.to,path:chain.path,captured:[...captured],promoted,
            notation:chain.path.join(move.capture?'×':'–')+(promoted?' ♛':'')});
          next.turn=other(state.turn);const key=positionKey(next.board,next.turn);next.positions[key]=(next.positions[key]??0)+1;adjudicate(next);break;
        }
        case 'RESIGN':finish(next,'resignation',other(actor.color));break;
        case 'OFFER_DRAW':requireRule(!state.drawOffer,'A draw offer is already pending.');next.drawOffer=actorId;break;
        case 'ACCEPT_DRAW':requireRule(state.drawOffer&&state.drawOffer!==actorId,'There is no draw offer for you.');finish(next,'agreement');break;
        case 'DECLINE_DRAW':requireRule(state.drawOffer&&state.drawOffer!==actorId,'There is no draw offer for you.');next.drawOffer=null;break;
      }
    }
  } else throw new Error('Unknown action.');
  next.revision++;return next;
}
export function buildViewForPlayer(state,id) {
  const me=state.players.find(p=>p.id===id);requireRule(me,'Unknown player.');
  const legal=state.phase==='playing'?legalTurn(state.board,state.turn,state.chain):{moves:[],requiredCaptures:0},myTurn=state.phase==='playing'&&me.color===state.turn;
  return {revision:state.revision,phase:state.phase,hostId:state.hostId,players:state.players.map(p=>({...p})),me:{...me},settings:{...state.settings},
    board:state.board.map(p=>({...p})),turn:state.turn,myTurn,legalMoves:myTurn?legal.moves.map(m=>({...m})):[],requiredCaptures:legal.requiredCaptures,
    continuation:state.chain?.square??null,pendingCaptured:[...(state.chain?.captured??[])],history:state.history.slice(-80).map(m=>structuredClone(m)),ply:state.history.length,stepSerial:state.stepSerial,
    result:state.result?{...state.result}:null,drawOffer:state.drawOffer,canStart:canStart(state),disconnectedNames:[...state.disconnectedNames]};
}
export const checkersAdapter=Object.freeze({createLobby,addPlayer,removePlayer,applyAction,buildViewForPlayer,automaticTransition:()=>null});
export const checkersGame=Object.freeze({id:'checkers',title:'CHECKERS',peerNamespace:'checkers-v1-',phases:PHASES,adapter:checkersAdapter});
