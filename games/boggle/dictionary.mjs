/** Compact, immutable word graph. No guessing, stemming or network lookups during play. */
export const ALPHABET = 'abcdefghijklmnopqrstuvwxyząćęłńóśźż';
const letterIds = new Map([...ALPHABET].map((letter, index) => [letter, index]));
export const normalizeWord = value => typeof value === 'string' ? value.trim().normalize('NFC').toLowerCase() : '';
export const isWord = value => typeof value === 'string' && /^[a-ząćęłńóśźż]{1,36}$/u.test(value);

export function readDictionary(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 24 || buffer.byteLength % 4) throw new Error('Invalid dictionary file.');
  const header = new DataView(buffer), root = header.getUint32(4, true), count = header.getUint32(8, true), edgeCount = header.getUint32(12, true);
  if (header.getUint32(0, true) !== 0x31525457 || !count || root >= count || buffer.byteLength !== 16 + (count + 1 + edgeCount) * 4) throw new Error('Invalid dictionary header.');
  const offsets = new Uint32Array(buffer, 16, count + 1), edges = new Uint32Array(buffer, 16 + (count + 1) * 4, edgeCount);
  if (offsets[0] >>> 1 || offsets[count] !== edgeCount * 2) throw new Error('Invalid dictionary offsets.');
  for (let node = 0; node < count; node++) {
    const start = offsets[node] >>> 1, end = offsets[node + 1] >>> 1;
    if (start > end || end > edgeCount) throw new Error('Invalid dictionary node.');
    let previous = -1;
    for (let edge = start; edge < end; edge++) {
      const letter = edges[edge] & 63, child = edges[edge] >>> 6;
      if (letter <= previous || letter >= ALPHABET.length || child >= node) throw new Error('Invalid dictionary edge.');
      previous = letter;
    }
  }
  const step = (node, letter) => {
    const id = letterIds.get(letter);
    if (id === undefined || node < 0) return -1;
    let lo = offsets[node] >>> 1, hi = (offsets[node + 1] >>> 1) - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1, value = edges[mid] & 63;
      if (value === id) return edges[mid] >>> 6;
      if (value < id) lo = mid + 1; else hi = mid - 1;
    }
    return -1;
  };
  const terminal = node => node >= 0 && Boolean(offsets[node] & 1);
  return Object.freeze({ root, step, terminal, has(word) {
    let node = root;
    for (const letter of word) { node = step(node, letter); if (node < 0) return false; }
    return terminal(node);
  } });
}

export function neighbors(size) {
  return Array.from({ length: size * size }, (_, index) => {
    const row = Math.floor(index / size), column = index % size, adjacent = [];
    for (let y = Math.max(0, row - 1); y <= Math.min(size - 1, row + 1); y++) {
      for (let x = Math.max(0, column - 1); x <= Math.min(size - 1, column + 1); x++) {
        if (y * size + x !== index) adjacent.push(y * size + x);
      }
    }
    return adjacent;
  });
}

export function validPath(board, size, path, word) {
  return Array.isArray(path) && path.length === word.length && new Set(path).size === path.length &&
    path.every((index, i) => Number.isInteger(index) && index >= 0 && index < board.length && board[index] === word[i] &&
      (!i || (Math.abs(Math.floor(index / size) - Math.floor(path[i - 1] / size)) <= 1 && Math.abs(index % size - path[i - 1] % size) <= 1)));
}

/** Exact search with immediate prefix pruning; different paths for one word count once. */
export function solveBoard(board, size, dictionary, minLength = 3) {
  if (![4, 5, 6].includes(size) || board.length !== size * size || board.some(letter => !letterIds.has(letter))) throw new Error('Invalid letter board.');
  const adjacent = neighbors(size), used = new Uint8Array(board.length), path = [], found = new Map();
  function walk(index, node, prefix) {
    node = dictionary.step(node, board[index]);
    if (node < 0) return;
    const word = prefix + board[index];
    path.push(index); used[index] = 1;
    if (word.length >= minLength && dictionary.terminal(node) && !found.has(word)) found.set(word, [...path]);
    for (const next of adjacent[index]) if (!used[next]) walk(next, node, word);
    used[index] = 0; path.pop();
  }
  for (let index = 0; index < board.length; index++) walk(index, dictionary.root, '');
  return found;
}

export function findPath(board, size, word) {
  if (!word || word.length > board.length) return null;
  const counts = new Map();
  for (const letter of board) counts.set(letter, (counts.get(letter) ?? 0) + 1);
  for (const letter of word) { const left = (counts.get(letter) ?? 0) - 1; if (left < 0) return null; counts.set(letter, left); }
  const adjacent = neighbors(size), path = [], used = new Set();
  let visits = 0;
  function walk(index, position) {
    if (++visits > 200000) return false; // Bound local typing work on adversarial repeated-letter paths.
    if (board[index] !== word[position] || used.has(index)) return false;
    path.push(index); used.add(index);
    if (position === word.length - 1) return true;
    for (const next of adjacent[index]) if (walk(next, position + 1)) return true;
    path.pop(); used.delete(index); return false;
  }
  for (let index = 0; index < board.length; index++) if (walk(index, 0)) return [...path];
  return null;
}
