import { randomInt } from '../../shared/random.mjs';

export const SUITS = Object.freeze({
  C: { name: 'Clubs', symbol: '♣', red: false },
  D: { name: 'Diamonds', symbol: '♦', red: true },
  H: { name: 'Hearts', symbol: '♥', red: true },
  S: { name: 'Spades', symbol: '♠', red: false },
});
export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const RANK_NAMES = { J: 'Jack', Q: 'Queen', K: 'King', A: 'Ace' };
export const cardLabel = card => `${RANK_NAMES[card.rank] ?? card.rank} of ${SUITS[card.suit].name}`;

export function createDeck() {
  return Object.keys(SUITS).flatMap(suit => RANKS.map((rank, index) => ({ id: rank + suit, rank, suit, value: index + 2 })));
}

export function shuffleDeck(deck, pick = randomInt) {
  const shuffled = deck.map(card => ({ ...card }));
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = pick(i + 1);
    if (!Number.isInteger(j) || j < 0 || j > i) throw new RangeError('Invalid shuffle source.');
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function sortHand(hand) {
  return [...hand].sort((a, b) => 'CDHS'.indexOf(a.suit) - 'CDHS'.indexOf(b.suit) || a.value - b.value);
}

export function dealHand(deck, playerCount, handSize, dealerIndex = 0) {
  if (!Number.isInteger(playerCount) || playerCount < 2 || playerCount > 6 ||
      !Number.isInteger(handSize) || handSize < 1 || handSize > 5 ||
      !Number.isInteger(dealerIndex) || dealerIndex < 0 || dealerIndex >= playerCount ||
      deck.length < playerCount * handSize + 1) throw new RangeError('Invalid deal.');
  const hands = Array.from({ length: playerCount }, () => []);
  let cursor = 0;
  for (let round = 0; round < handSize; round++) {
    for (let offset = 1; offset <= playerCount; offset++) {
      hands[(dealerIndex + offset) % playerCount].push({ ...deck[cursor++] });
    }
  }
  return { hands: hands.map(sortHand), trumpCard: { ...deck[cursor] } };
}
