export function isBoggleAction(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const keys = Object.keys(payload).filter(key => key !== 'action');
  const fields = (...names) => keys.length === names.length && names.every(name => keys.includes(name));
  switch (payload.action) {
    case 'SETTINGS': return fields('language', 'size', 'minLength', 'seconds', 'rounds') &&
      ['pl', 'en'].includes(payload.language) && [4, 5, 6].includes(payload.size) && [3, 4, 5].includes(payload.minLength) &&
      [60, 120, 180].includes(payload.seconds) && [1, 3, 5].includes(payload.rounds);
    case 'SUBMIT': return fields('word', 'round') && typeof payload.word === 'string' &&
      /^[a-ząćęłńóśźż]{1,36}$/u.test(payload.word) && Number.isSafeInteger(payload.round) && payload.round >= 1;
    default: return false;
  }
}
