/** Unbiased cryptographic randomness, shared by room IDs and game adapters. */
export function randomInt(max) {
  if (!Number.isSafeInteger(max) || max < 1 || max > 0x100000000) {
    throw new RangeError('Invalid random range.');
  }
  const values = new Uint32Array(1);
  const limit = 0x100000000 - (0x100000000 % max);
  do { globalThis.crypto.getRandomValues(values); } while (values[0] >= limit);
  return values[0] % max;
}

export const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function randomToken(length = 16, alphabet = ROOM_ALPHABET) {
  return Array.from({ length }, () => alphabet[randomInt(alphabet.length)]).join('');
}
export const createRoomCode = () => randomToken(8);

export function normalizeRoomCode(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}
export function isValidRoomCode(value) {
  return typeof value === 'string' && /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/.test(value);
}

export function validateName(value) {
  if (typeof value !== 'string') throw new Error('Please enter your name.');
  const name = value.trim();
  if (!name || name.length > 16 || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(name)) {
    throw new Error('Use a name with 1–16 characters.');
  }
  return name;
}
