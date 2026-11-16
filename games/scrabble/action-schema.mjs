const record = value => value && typeof value === 'object' && !Array.isArray(value);
const tileId = value => typeof value === 'string' && /^t\d{1,3}$/.test(value);
export function isScrabbleAction(payload) {
  if (!record(payload)) return false;
  const fields = (...names) => Object.keys(payload).length === names.length + 1 && names.every(name => Object.hasOwn(payload, name));
  const turn = () => Number.isSafeInteger(payload.turn) && payload.turn > 0;
  switch (payload.action) {
    case 'SETTINGS': return fields('language', 'seconds') && ['pl','en'].includes(payload.language) && Number.isInteger(payload.seconds) && payload.seconds >= 0 && payload.seconds <= 3600;
    case 'PLAY': return fields('turn', 'placements') && turn() && Array.isArray(payload.placements) && payload.placements.length >= 1 && payload.placements.length <= 7 && payload.placements.every(p =>
      record(p) && Object.keys(p).length === 3 && Number.isInteger(p.index) && p.index >= 0 && p.index < 225 && tileId(p.tileId) && typeof p.letter === 'string' && /^[a-ząćęłńóśźż]$/u.test(p.letter));
    case 'EXCHANGE': return fields('turn', 'tileIds') && turn() && Array.isArray(payload.tileIds) && payload.tileIds.length >= 1 && payload.tileIds.length <= 7 && payload.tileIds.every(tileId);
    case 'PASS': case 'END_PRACTICE': return fields('turn') && turn();
    default: return false;
  }
}
