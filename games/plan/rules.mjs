import { el, eyebrow, friendsInstructions } from '../../shared/dom.mjs';

export function renderRules() {
  const section = (title, ...content) => el('section', { class: 'rule-section' }, el('h3', {}, title), ...content.map(text => typeof text === 'string' ? el('p', {}, text) : text));
  return el('div', { class: 'rules-content' },
    eyebrow('A LITTLE FORESIGHT GOES A LONG WAY'),
    el('p', { class: 'rules-intro' }, 'Predict your tricks. Make your plan. Try to keep it.'),
    section('The goal', 'Predict exactly how many tricks you will win. An exact prediction earns a bonus. The highest total after six hands wins; equal highest scores share the win.'),
    section('Six hands. One plan at a time.',
      el('div', { class: 'rule-hands' }, [5, 4, 3, 2, 1, '1 blind'].map(size => el('span', {}, el('strong', {}, size), el('small', {}, typeof size === 'number' && size > 1 ? 'cards' : 'card')))),
      'Play with 2–6 people and a standard 52-card deck. Ace is high, 2 is low. The first dealer is random; the dealer moves one seat clockwise after each hand. Seats follow lobby join order.'),
    section('Trump', 'After each fresh deal, the next card determines the trump suit. That face-up card stays out of play. Everyone sees it before bidding.'),
    section('Make your prediction', 'Starting with the player after the dealer, each player predicts how many tricks they will win. The dealer bids last. You may bid from 0 up to the number of cards in your hand.',
      el('aside', { class: 'rule-callout' }, el('strong', {}, 'The total bids may never equal the available tricks.'),
        el('p', {}, 'The last bidder may have one unavailable number. With 4 cards and earlier bids of 1, 1 and 0, the dealer cannot bid 2: that would make a total of 4.'))),
    section('Play a trick', 'The player with the highest bid wins the bidding and leads the first trick. If the highest bids are tied, the player who bid earlier leads. If everyone bids 0, the first bidder leads. This also applies to the blind hand.',
      'Each person plays one card clockwise. The first card sets the lead suit. If you have that suit, you must follow it. If you do not, you may play any card, including a trump.'),
    section('Who wins the trick?', 'Trump beats every non-trump card. The highest trump wins. Without a trump, the highest card of the lead suit wins. The winner collects the trick and leads the next one.',
      'Example: Clubs are led, but Hearts are trump. A 2♥ beats an A♣. A high Spade cannot win unless Spades are the lead suit or trump.'),
    section('Every prediction counts',
      el('div', { class: 'scoring-examples' },
        el('div', {}, el('strong', {}, 'EXACT: 10 + YOUR BID'), el('p', {}, 'Bid 2, win 2 → +12 points'), el('p', {}, 'Bid 0, win 0 → +10 points')),
        el('div', {}, el('strong', {}, 'MISS: −1 PER TRICK AWAY'), el('p', {}, 'Bid 3, win 1 → −2 points'), el('p', {}, 'Bid 0, win 2 → −2 points'))),
      'After each hand, review the results. The host chooses NEXT HAND when everyone is ready to continue.'),
    section('The blind finale', 'In hand six, you get one card you cannot see. Everyone else can see it, and you can see everybody else’s card. Trump is visible as usual.',
      'Bid 0 or 1 based on what you can see. The final bidder still cannot make the total equal 1. On your turn, choose PLAY MY CARD. Your card is revealed to everyone only when it is played.'),
    friendsInstructions(),
    section('Stay at the table', 'If a player disconnects, the hand stops. The host can return the remaining players to the lobby. If the host leaves, the room closes. Keep your device awake and the game tab open while playing.'),
  );
}
