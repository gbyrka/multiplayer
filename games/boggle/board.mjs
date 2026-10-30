// Workers have no document import map, so carry the release query through dependencies.
const query = new URL(import.meta.url).search;
const { randomInt } = await import('../../shared/random.mjs' + query);
const { solveBoard } = await import('./dictionary.mjs' + query);

const LETTERS = {
  pl: 'aaaaaaaaaąbbcccćddddeeeeeeeeęfggghhiiiiiiiiijjkkkkllllłłmmmnnnnnńoooooooóppprrrrrssssśttttuuwwwyyyzzzzzźż',
  en: 'aaaaaaaaabbcccddddeeeeeeeeeeeeeffggghhiiiiiiijkllllmmnnnnnnooooooooppqrrrrrrsssssstttttttttuuuvwxyyz',
};
export function generateBoard(language, size, pick = randomInt) {
  const letters = LETTERS[language];
  if (!letters || ![4, 5, 6].includes(size)) throw new Error('Invalid board settings.');
  return Array.from({ length: size * size }, () => letters[pick(letters.length)]);
}

export function prepareBoard(settings, dictionary, pick = randomInt) {
  let best = null;
  for (let attempt = 0; attempt < 10; attempt++) {
    const board = generateBoard(settings.language, settings.size, pick);
    const solutions = solveBoard(board, settings.size, dictionary, settings.minLength);
    const candidate = { board, solutions: [...solutions] };
    if (solutions.size >= 20 && [...solutions.keys()].some(word => word.length >= 7)) {
      best = candidate; break;
    }
    if (!best || solutions.size > best.solutions.length) best = candidate;
  }
  if (!best?.solutions.length) throw new Error('Could not prepare a playable board. Please try again.');
  return { ...best, settings: { ...settings }, dictionaryVersion: 'boggle1' };
}
