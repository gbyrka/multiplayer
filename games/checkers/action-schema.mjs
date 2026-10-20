const square = value => typeof value === 'string' && /^[a-h][1-8]$/.test(value) && (value.charCodeAt(0) + Number(value[1])) % 2 === 0;
export function isCheckersAction(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const keys = Object.keys(payload).filter(key => key !== 'action');
  const fields = (...names) => keys.length === names.length && names.every(name => keys.includes(name));
  switch (payload.action) {
    case 'SETTINGS': return fields('hostColor') && ['w', 'b', 'random'].includes(payload.hostColor);
    case 'MOVE': return fields('from', 'to') && square(payload.from) && square(payload.to);
    case 'RESIGN': case 'OFFER_DRAW': case 'ACCEPT_DRAW': case 'DECLINE_DRAW': return fields();
    default: return false;
  }
}
