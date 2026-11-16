export const SIZE = 15;
export const CENTER = 112;
export const LANGUAGES = Object.freeze({
  en: { name: 'English · UK + US', tiles: [
    ['a',9,1],['b',2,3],['c',2,3],['d',4,2],['e',12,1],['f',2,4],['g',3,2],['h',2,4],['i',9,1],['j',1,8],['k',1,5],['l',4,1],['m',2,3],['n',6,1],['o',8,1],['p',2,3],['q',1,10],['r',6,1],['s',4,1],['t',6,1],['u',4,1],['v',2,4],['w',2,4],['x',1,8],['y',2,4],['z',1,10],['',2,0],
  ] },
  pl: { name: 'Polski', tiles: [
    ['a',9,1],['ą',1,5],['b',2,3],['c',3,2],['ć',1,6],['d',3,2],['e',7,1],['ę',1,5],['f',1,5],['g',2,3],['h',2,3],['i',8,1],['j',2,3],['k',3,2],['l',3,2],['ł',2,3],['m',3,2],['n',5,1],['ń',1,7],['o',6,1],['ó',1,5],['p',3,2],['r',4,1],['s',4,1],['ś',1,5],['t',3,2],['u',2,3],['w',4,1],['y',4,2],['z',5,1],['ź',1,9],['ż',1,5],['',2,0],
  ] },
});
export const letterValue = (language, letter) => LANGUAGES[language].tiles.find(entry => entry[0] === letter)?.[2] ?? 0;
export const validLetter = (language, letter) => typeof letter === 'string' && letter.length === 1 && LANGUAGES[language].tiles.some(entry => entry[0] === letter);
export const tileValue = (language, tile) => tile.blank ? 0 : letterValue(language, tile.letter);
export const coordinate = index => `${String.fromCharCode(65 + index % SIZE)}${Math.floor(index / SIZE) + 1}`;
const rows = [
  'TW .. .. DL .. .. .. TW .. .. .. DL .. .. TW',
  '.. DW .. .. .. TL .. .. .. TL .. .. .. DW ..',
  '.. .. DW .. .. .. DL .. DL .. .. .. DW .. ..',
  'DL .. .. DW .. .. .. DL .. .. .. DW .. .. DL',
  '.. .. .. .. DW .. .. .. .. .. DW .. .. .. ..',
  '.. TL .. .. .. TL .. .. .. TL .. .. .. TL ..',
  '.. .. DL .. .. .. DL .. DL .. .. .. DL .. ..',
  'TW .. .. DL .. .. .. DW .. .. .. DL .. .. TW',
  '.. .. DL .. .. .. DL .. DL .. .. .. DL .. ..',
  '.. TL .. .. .. TL .. .. .. TL .. .. .. TL ..',
  '.. .. .. .. DW .. .. .. .. .. DW .. .. .. ..',
  'DL .. .. DW .. .. .. DL .. .. .. DW .. .. DL',
  '.. .. DW .. .. .. DL .. DL .. .. .. DW .. ..',
  '.. DW .. .. .. TL .. .. .. TL .. .. .. DW ..',
  'TW .. .. DL .. .. .. TW .. .. .. DL .. .. TW',
];
export const PREMIUMS = Object.freeze(rows.flatMap(row => row.split(' ')));
export function shuffle(items, pick) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) { const j = pick(i + 1); [result[i], result[j]] = [result[j], result[i]]; }
  return result;
}
export function makeBag(language, pick) {
  let serial = 0;
  return shuffle(LANGUAGES[language].tiles.flatMap(([letter, count]) => Array.from({ length: count }, () => ({ id: `t${serial++}`, letter }))), pick);
}
