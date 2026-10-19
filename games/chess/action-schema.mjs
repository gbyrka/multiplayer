const square = value => typeof value === 'string' && /^[a-h][1-8]$/.test(value);
export function isChessAction(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const keys = Object.keys(payload).filter(key => key !== 'action');
  const fields = (...names) => keys.length === names.length && names.every(name => keys.includes(name));
  switch (payload.action) {
    case 'SETTINGS': return fields('hostColor', 'minutes') && ['w', 'b', 'random'].includes(payload.hostColor) &&
      Number.isInteger(payload.minutes) && payload.minutes >= 0 && payload.minutes <= 180;
    case 'MOVE': return (fields('from', 'to') || fields('from', 'to', 'promotion')) && square(payload.from) && square(payload.to) &&
      (payload.promotion === undefined || ['q', 'r', 'b', 'n'].includes(payload.promotion));
    case 'RESIGN': case 'OFFER_DRAW': case 'ACCEPT_DRAW': case 'DECLINE_DRAW': case 'CLAIM_DRAW': return fields();
    default: return false;
  }
}
