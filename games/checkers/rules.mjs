/** Brazilian-style 8×8 draughts: backward captures, flying kings and maximum capture. */
export const other = color => color === 'w' ? 'b' : 'w';
const directions = [[1,1],[-1,1],[1,-1],[-1,-1]];
const coords = square => [square.charCodeAt(0) - 97, Number(square[1]) - 1];
const squareAt = (x,y) => x >= 0 && x < 8 && y >= 0 && y < 8 ? String.fromCharCode(97+x) + (y+1) : null;
export function initialBoard() {
  const board = [];
  for (let rank=1; rank<=8; rank++) for (const file of 'abcdefgh') {
    if ((file.charCodeAt(0)+rank)%2 === 0 && (rank<=3 || rank>=6)) board.push({square:file+rank,color:rank<=3?'w':'b',king:false});
  }
  return board;
}
function capturesFrom(occupied, piece, square, taken) {
  const [x,y] = coords(square), moves=[];
  for (const [dx,dy] of directions) {
    let step=1, victim=null;
    while (true) {
      const target=squareAt(x+step*dx,y+step*dy); if (!target) break;
      const occupant=occupied.get(target);
      if (occupant) {
        // Captured pieces stay as blockers until the complete sequence finishes.
        if (victim || occupant.color===piece.color || taken.has(target)) break;
        victim=target;
      } else if (victim) {
        moves.push({from:square,to:target,capturedSquare:victim,capture:true});
        if (!piece.king) break;
      } else if (!piece.king) break;
      if (!piece.king && step>=2) break;
      step++;
    }
  }
  return moves;
}
function bestCaptures(board, piece, captured) {
  const occupied=new Map(board.filter(p=>p.square!==piece.square).map(p=>[p.square,p]));
  const memo=new Map();
  function search(square,taken) {
    const key=square+'|'+[...taken].sort().join(',');
    if (memo.has(key)) return memo.get(key);
    const candidates=capturesFrom(occupied,piece,square,taken).map(move=>{
      const more=new Set(taken);more.add(move.capturedSquare);
      return {...move, count:1+search(move.to,more).count};
    });
    const count=candidates.length?Math.max(...candidates.map(m=>m.count)):0;
    const result={count,moves:candidates.filter(m=>m.count===count)};memo.set(key,result);return result;
  }
  return search(piece.square,new Set(captured));
}
export function legalTurn(board,color,chain=null) {
  const mine=board.filter(p=>p.color===color && (!chain || p.square===chain.square));
  const captures=mine.flatMap(p=>bestCaptures(board,p,chain?.captured??[]).moves);
  if (captures.length) {
    const requiredCaptures=Math.max(...captures.map(m=>m.count));
    return {moves:captures.filter(m=>m.count===requiredCaptures),requiredCaptures};
  }
  if (chain) return {moves:[],requiredCaptures:0};
  const occupied=new Set(board.map(p=>p.square)), moves=[];
  for (const piece of mine) {
    const [x,y]=coords(piece.square);
    for (const [dx,dy] of directions) {
      if (!piece.king && dy!==(color==='w'?1:-1)) continue;
      for (let step=1; ;step++) {
        const to=squareAt(x+step*dx,y+step*dy);if(!to||occupied.has(to))break;
        moves.push({from:piece.square,to,capture:false,capturedSquare:null,count:0});
        if(!piece.king)break;
      }
    }
  }
  return {moves,requiredCaptures:0};
}
export function positionKey(board,turn) {
  return turn+'|'+board.map(p=>p.square+p.color+(p.king?'K':'m')).sort().join(',');
}
