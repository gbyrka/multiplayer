import { SIZE, CENTER, PREMIUMS, validLetter, tileValue } from './constants.mjs';
const requireRule = (condition, text) => { if (!condition) throw new Error(text); };
const adjacent = index => [index >= SIZE ? index - SIZE : -1, index < 210 ? index + SIZE : -1, index % SIZE ? index - 1 : -1, index % SIZE < 14 ? index + 1 : -1].filter(n => n >= 0);
function line(board, index, vertical) {
  const step = vertical ? SIZE : 1;
  const canStep = (from, to) => to >= 0 && to < 225 && (vertical || Math.floor(from / SIZE) === Math.floor(to / SIZE));
  let start = index;
  while (canStep(start, start - step) && board[start - step]) start -= step;
  const indices = [];
  for (let at = start; canStep(start, at) && board[at]; at += step) indices.push(at);
  return indices;
}
/** Pure placement validation; the same function drives the editor and authoritative host. */
export function evaluateMove(board, rack, placements, language, dictionary = null) {
  requireRule(Array.isArray(placements) && placements.length > 0 && placements.length <= 7, 'Place between one and seven tiles.');
  const next = [...board], newIndices = new Set(), usedTiles = new Set();
  for (const p of placements) {
    requireRule(Number.isInteger(p.index) && p.index >= 0 && p.index < 225, 'That square is outside the board.');
    requireRule(!board[p.index] && !newIndices.has(p.index), 'That square is already occupied.');
    const tile = rack.find(tile => tile.id === p.tileId);
    requireRule(tile && !usedTiles.has(p.tileId), 'You do not have those tiles.');
    requireRule(validLetter(language, p.letter) && (!tile.letter || tile.letter === p.letter), 'The tile does not match that letter.');
    usedTiles.add(p.tileId); newIndices.add(p.index);
    next[p.index] = { letter: p.letter, blank: !tile.letter };
  }
  const indices = [...newIndices].sort((a,b) => a-b), vertical = indices.length > 1 && indices.every(i => i % SIZE === indices[0] % SIZE);
  requireRule(indices.length === 1 || vertical || indices.every(i => Math.floor(i / SIZE) === Math.floor(indices[0] / SIZE)), 'All new tiles must be in one row or column.');
  const primary = line(next, indices[0], vertical);
  requireRule(indices.every(i => primary.includes(i)), 'There is a gap in your word.');
  const first = !board.some(Boolean);
  requireRule(!first || newIndices.has(CENTER), 'Your first word must cover the centre star.');
  requireRule(first || indices.some(i => adjacent(i).some(n => board[n])), 'Connect your word to the tiles on the board.');
  const words = [], seen = new Set();
  for (const i of indices) for (const direction of [false, true]) {
    const path = line(next, i, direction), key = path.join(',');
    if (path.length < 2 || seen.has(key)) continue;
    seen.add(key);
    const word = path.map(n => next[n].letter).join('');
    let sum = 0, multiplier = 1;
    for (const index of path) {
      const premium = newIndices.has(index) ? PREMIUMS[index] : '..';
      sum += tileValue(language, next[index]) * (premium === 'DL' ? 2 : premium === 'TL' ? 3 : 1);
      multiplier *= premium === 'DW' ? 2 : premium === 'TW' ? 3 : 1;
    }
    words.push({ word, indices: path, points: sum * multiplier });
  }
  requireRule(words.length > 0, 'Make a word of at least two letters.');
  const invalid = dictionary ? words.filter(entry => !dictionary.has(entry.word)).map(entry => entry.word) : [];
  requireRule(!invalid.length, `Not in this dictionary: ${invalid.map(word => word.toUpperCase()).join(', ')}.`);
  const bonus = placements.length === 7 ? 50 : 0;
  return { board: next, words, bonus, points: words.reduce((sum, entry) => sum + entry.points, bonus) };
}
