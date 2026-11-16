import { validLetter, coordinate } from './constants.mjs';
/** Type the complete word, including letters already on the board. Blank overrides are keyed by square. */
export function draftMove(board, rack, start, vertical, text, language, blankSquares = []) {
  if (!Number.isInteger(start) || start < 0 || start >= 225) return { placements: [], error: text ? 'Choose a starting square.' : '', cells: [] };
  const letters = [...text.normalize('NFC').toLowerCase()], placements = [], cells = [], available = [...rack];
  for (let offset = 0; offset < letters.length; offset++) {
    const index = start + offset * (vertical ? 15 : 1), letter = letters[offset];
    if (index >= 225 || (!vertical && Math.floor(index / 15) !== Math.floor(start / 15))) return { placements, cells, error: 'Your word extends beyond the board.' };
    cells.push(index);
    if (!validLetter(language, letter)) return { placements, cells, error: 'Use letters from the selected language.' };
    if (board[index]) {
      if (board[index].letter !== letter) return { placements, cells, error: `${coordinate(index)} already contains ${board[index].letter.toUpperCase()}.` };
      continue;
    }
    let tileIndex = available.findIndex(tile => tile.letter === letter && !blankSquares.includes(index));
    if (tileIndex < 0) tileIndex = available.findIndex(tile => !tile.letter);
    if (tileIndex < 0) return { placements, cells, error: blankSquares.includes(index) ? 'No blank tile is available.' : `No ${letter.toUpperCase()} or blank tile is available.` };
    const [tile] = available.splice(tileIndex, 1);
    placements.push({ index, tileId: tile.id, letter });
  }
  return { placements, cells, error: '' };
}
