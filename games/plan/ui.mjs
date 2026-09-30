import { el, button, eyebrow, playingCard, signed } from '../../shared/dom.mjs';
import { SUITS } from './cards.mjs';
import { getStandings, HAND_SIZES } from './game-core.mjs';

const playerName = (view, id) => view.players.find(player => player.id === id)?.name ?? 'Player';

export function renderScoreboard(view) {
  const count = view.players.length;
  const header = el('tr', {}, el('th', { scope: 'col', rowspan: 2 }, 'PLAYER'),
    HAND_SIZES.map((size, i) => el('th', { scope: 'colgroup', colspan: count, class: 'score-round' },
      el('span', { class: 'score-round-label' }, `R${i + 1} · ${i === 5 ? 'BLIND' : `${size} ${size === 1 ? 'CARD' : 'CARDS'}`}`))),
    el('th', { scope: 'col', rowspan: 2, class: 'total-score' }, 'TOTAL'));
  const deals = el('tr', {}, Array.from({ length: view.totalHands }, (_, i) => el('th', {
    scope: 'col', class: i % count === 0 ? 'round-start' : '',
    'aria-label': `Round ${Math.floor(i / count) + 1}, deal ${i % count + 1}`,
  }, `D${i % count + 1}`)));
  return el('div', {},
    el('p', { class: 'score-help' }, `Six rounds · ${count} deals per round · ${view.totalHands} hands. Scroll to see every deal.`),
    el('div', { class: 'score-scroll', tabindex: '0', role: 'region', 'aria-label': 'Scores by round and deal; scroll horizontally' },
      el('table', { class: 'score-table', style: `--score-deals:${view.totalHands}` },
        el('caption', { class: 'sr-only' }, `Scores for all ${view.totalHands} hands, grouped into six rounds`), el('thead', {}, header, deals),
        el('tbody', {}, getStandings(view.players).map(player => el('tr', { class: player.id === view.me.id ? 'my-score' : '' },
          el('th', { scope: 'row' }, player.name, player.id === view.me.id ? el('small', {}, ' YOU') : null),
          Array.from({ length: view.totalHands }, (_, i) => el('td', {
            class: `${(player.history[i]?.score ?? 0) < 0 ? 'negative' : 'positive'}${i % count === 0 ? ' round-start' : ''}`,
            title: player.history[i] ? `Bid ${player.history[i].bid}, won ${player.history[i].won}` : 'Not played yet',
          }, player.history[i] ? signed(player.history[i].score) : '—')),
          el('td', { class: 'total-score' }, player.totalScore),
        ))),
      )),
  );
}

function handProgress(view) {
  return el('ol', { class: 'hand-progress', 'aria-label': 'Game progress' }, [5, 4, 3, 2, 1, 'Blind'].map((size, i) =>
    el('li', { class: `${i + 1 === view.roundNumber ? 'active' : ''} ${i + 1 < view.roundNumber ? 'complete' : ''}`, 'aria-current': i + 1 === view.roundNumber ? 'step' : null },
      el('span', {}, `R${i + 1}`), el('strong', {}, size),
      el('small', {}, i + 1 === view.roundNumber ? `${view.dealInRound}/${view.players.length} deals` : `${view.players.length} deals`),
    ),
  ));
}

function playerTile(view, player) {
  const current = ['bidding', 'playing'].includes(view.phase) && view.currentPlayerId === player.id;
  const winner = view.phase === 'trick_result' && view.trickWinnerId === player.id;
  const isMe = player.id === view.me.id;
  const blindCard = view.opponents.find(opponent => opponent.playerId === player.id)?.visibleBlindCard;
  return el('article', { class: `player-tile${current ? ' current-player' : ''}${winner ? ' trick-winner' : ''}${isMe ? ' self-player' : ''}`, 'aria-label': `${player.name}${current ? ', current turn' : ''}`, 'aria-current': current ? 'true' : null, 'data-player-id': player.id },
    el('div', { class: 'player-top' },
      el('span', { class: 'avatar', 'aria-hidden': 'true' }, [...player.name][0].toUpperCase()),
      el('div', { class: 'player-name-wrap' }, el('strong', { class: 'player-name', title: player.name }, player.name),
        el('span', { class: 'player-role' }, isMe ? 'YOU' : player.host ? 'HOST' : `${player.cardCount} ${player.cardCount === 1 ? 'card' : 'cards'}`)),
      player.id === view.dealerId ? el('span', { class: 'dealer-badge', title: 'Dealer', 'aria-label': 'Dealer' }, 'D') : null,
    ),
    el('div', { class: 'player-stats' },
      el('span', {}, 'BID ', el('b', {}, player.bid ?? '—')),
      el('span', {}, 'WON ', el('b', {}, player.tricksWon)),
      el('span', { class: 'player-total' }, el('b', {}, player.totalScore), ' pts'),
    ),
    view.blind && !isMe && blindCard ? el('div', { class: 'opponent-blind' }, playingCard(blindCard, { small: true }), el('small', {}, 'Their card')) : null,
    el('span', { class: 'turn-indicator' }, current ? el('i', { class: 'turn-dot', 'aria-hidden': 'true' }) : null,
      winner ? '✦ TRICK WON' : current ? isMe ? 'YOUR TURN' : 'THEIR TURN' : player.bid !== null && view.phase === 'bidding' ? 'BID PLACED' : 'AT THE TABLE'),
  );
}

function trumpPanel(view) {
  return el('aside', { class: 'trump-panel' }, eyebrow('TRUMP'), playingCard(view.trumpCard, { small: true }),
    el('strong', { class: 'trump-suit' }, SUITS[view.trumpSuit].name.toUpperCase()),
    el('span', { class: 'trump-hint' }, 'Beats other suits'),
  );
}

function biddingPanel(view, pending) {
  const myTurn = view.currentPlayerId === view.me.id;
  return el('div', { class: 'bidding-panel' }, eyebrow('BIDDING'),
    el('h2', {}, myTurn ? 'How many tricks will you win?' : `${playerName(view, view.currentPlayerId)} is choosing a bid…`),
    myTurn ? el('div', { class: 'bid-options', 'aria-label': 'Choose your bid' }, Array.from({ length: view.handSize + 1 }, (_, bid) =>
      button(bid, 'bid', {
        class: 'bid-button', 'data-bid': bid, disabled: pending || bid === view.forbiddenBid,
        'aria-label': bid === view.forbiddenBid ? `Bid ${bid}, unavailable: total bids cannot equal ${view.handSize}` : `Bid ${bid}`,
      }),
    )) : el('p', { class: 'muted' }, 'Take a look at your cards. Make a plan.'),
    view.forbiddenBid !== null ? el('p', { class: 'bid-warning', role: 'note' }, `You can't bid ${view.forbiddenBid} — total bids may not equal ${view.handSize}.`) : null,
    el('p', { class: 'bid-total' }, 'TOTAL BIDS ', el('strong', {}, view.totalBids), el('span', {}, ` / ${view.handSize} tricks available`)),
  );
}

function trickPanel(view) {
  const result = view.phase === 'trick_result';
  const myTurn = view.currentPlayerId === view.me.id;
  return el('div', { class: `trick-panel${result ? ' collecting-trick' : ''}` },
    eyebrow(result ? 'TRICK COMPLETE' : `PLAYING · TRICK ${view.trickNumber} OF ${view.handSize}`),
    el('h2', {}, result ? `${playerName(view, view.trickWinnerId)} wins the trick` : myTurn ? 'Your turn. Play a card.' : `${playerName(view, view.currentPlayerId)}’s turn`),
    el('div', { class: 'played-cards' }, view.trick.length ? view.trick.map((entry, i) =>
      el('div', { class: `played-card${result && entry.playerId === view.trickWinnerId ? ' winning-card' : ''}`, style: `--card-index:${i}` },
        playingCard(entry.card, { small: true }), el('span', { title: playerName(view, entry.playerId) }, playerName(view, entry.playerId)),
      ),
    ) : el('div', { class: 'empty-trick' }, el('span', { 'aria-hidden': 'true' }, '♧'), el('p', {}, myTurn ? 'You lead this trick.' : 'Waiting for the first card…'))),
    view.leadSuit && !result ? el('p', { class: 'lead-suit' }, `LEAD SUIT · ${SUITS[view.leadSuit].symbol} ${SUITS[view.leadSuit].name.toUpperCase()}`) : null,
  );
}

function myHand(view, pending) {
  const player = view.players.find(p => p.id === view.me.id);
  const myTurn = view.phase === 'playing' && view.currentPlayerId === view.me.id;
  let help = 'Plan your bid while the other players choose.';
  if (view.phase === 'bidding' && view.currentPlayerId === view.me.id) help = 'Look at your hand and choose a number above.';
  if (view.phase === 'playing') help = myTurn ? view.leadSuit ? `Follow ${SUITS[view.leadSuit].name} if you can. Available cards are highlighted.` : 'You lead. Choose any card.' : 'Your cards are ready. Wait for your turn.';
  if (view.phase === 'trick_result') help = 'The winner leads the next trick.';
  if (view.blind) help = 'You cannot see your own card. Everyone else can.';
  return el('section', { class: `hand-section${view.blind ? ' blind-hand-section' : ''}`, 'aria-label': 'Your hand' },
    el('div', { class: 'hand-heading' }, el('h2', {}, view.blind ? 'Your mystery card' : 'Your hand'),
      el('span', { class: 'my-bid' }, player.bid === null ? 'NOT BID YET' : `YOUR BID: ${player.bid} · WON: ${player.tricksWon}`)),
    el('p', { class: 'hand-help' }, help),
    el('div', { class: `my-cards${myTurn ? ' playable-hand' : ''}`, 'data-hand-number': view.handNumber },
      view.me.cardCount === 0 ? el('p', { class: 'empty-hand' }, 'All cards played.') : view.blind ?
        playingCard(null, { back: true, interactive: true, disabled: !myTurn || pending, action: 'play-blind' }) :
        view.me.hand.map((card, index) => playingCard(card, {
          interactive: true, disabled: pending || !view.me.legalCardIds.includes(card.id), index, count: view.me.hand.length,
        })),
    ),
    view.blind && view.me.cardCount > 0 ? button('PLAY MY CARD', 'play-blind', { class: 'button primary blind-play-button', disabled: !myTurn || pending }) : null,
    pending ? el('p', { class: 'pending-note', role: 'status' }, 'Sending your move…') : null,
  );
}

function handResults(view, pending) {
  const over = view.phase === 'game_result';
  const standings = getStandings(view.players);
  const winners = standings.filter(player => player.totalScore === standings[0].totalScore);
  return el('section', { class: 'results-panel panel' },
    eyebrow(over ? `${view.totalHands} HANDS. WELL PLAYED.` : `ROUND ${view.roundNumber} / 6 · DEAL ${view.dealInRound} / ${view.players.length}`),
    el('h1', {}, over ? 'Game over' : 'Hand results'),
    over ? el('div', { class: 'winner-banner', 'data-winner-banner': '' }, el('span', { class: 'winner-star', 'aria-hidden': 'true' }, '✦'),
      eyebrow(winners.length > 1 ? 'TIE' : 'WINNER'), el('h2', {}, winners.map(player => player.name).join(' & ')),
      el('p', {}, `${winners[0].totalScore} points${winners.length > 1 ? ' each' : ''}`)) :
      el('p', { class: 'muted' }, `Hand ${view.handNumber} of ${view.totalHands} complete. ${view.dealInRound === view.players.length ? 'Everyone has opened the bidding in this round.' : 'The next player opens the bidding in the next deal.'}`),
    el('h2', { class: 'section-label' }, over ? 'FINAL BLIND HAND RESULTS' : 'THIS HAND'),
    el('div', { class: 'hand-results-grid' }, (over ? standings : view.players).map(player => {
      const result = view.handResults.find(entry => entry.playerId === player.id);
      return el('article', { class: `hand-result-card${result.bid === result.won ? ' exact-result' : ''}` },
        el('h3', {}, player.name, player.id === view.me.id ? el('small', {}, ' YOU') : null),
        el('p', {}, `BID ${result.bid} · WON ${result.won}`),
        el('strong', { class: `score-change ${result.score < 0 ? 'negative' : 'positive'}` }, signed(result.score)),
        el('span', { class: 'result-verdict' }, result.bid === result.won ? 'EXACT PREDICTION' : 'OFF THE PLAN'),
        el('div', { class: 'result-total' }, 'TOTAL SCORE ', el('b', {}, result.totalScore)),
      );
    })), renderScoreboard(view),
    el('div', { class: 'results-actions' }, view.me.host ? button(over ? 'PLAY AGAIN' : 'NEXT HAND', over ? 'play-again' : 'next-hand', { class: 'button primary', disabled: pending }) : el('p', { class: 'waiting-note' }, 'Waiting for host…')),
  );
}

export function renderPlan(view, { pending = false } = {}) {
  if (['hand_result', 'game_result'].includes(view.phase)) return handResults(view, pending);
  return el('div', { class: 'game-layout', 'data-phase': view.phase },
    el('div', { class: 'game-heading' }, el('div', {}, eyebrow(`PLAN · ROUND ${view.roundNumber} / 6 · DEAL ${view.dealInRound} / ${view.players.length}`),
      el('h1', {}, view.blind ? 'The blind finale.' : `${view.handSize} ${view.handSize === 1 ? 'card' : 'cards'}. Make them count.`)),
      handProgress(view)),
    el('section', { class: 'players-row', style: `--players:${view.players.length}`, 'aria-label': 'Players in clockwise order' }, view.players.map(player => playerTile(view, player))),
    view.blind ? el('p', { class: 'blind-notice' }, el('strong', {}, 'BLIND HAND'), ' You see their cards. They see yours.') : null,
    el('section', { class: 'felt-table', 'aria-label': 'Card table' }, trumpPanel(view), view.phase === 'bidding' ? biddingPanel(view, pending) : trickPanel(view)),
    myHand(view, pending),
  );
}

export function turnAnnouncement(view) {
  if (view.phase === 'bidding') return `${view.currentPlayerId === view.me.id ? 'Your turn to bid' : `${playerName(view, view.currentPlayerId)} is bidding`}. Hand ${view.handNumber}. Trump is ${SUITS[view.trumpSuit].name}.`;
  if (view.phase === 'playing') return view.currentPlayerId === view.me.id ? 'Your turn to play a card.' : `${playerName(view, view.currentPlayerId)} is playing.`;
  if (view.phase === 'trick_result') return `${playerName(view, view.trickWinnerId)} wins the trick.`;
  if (view.phase === 'hand_result') return 'Hand results are ready.';
  if (view.phase === 'game_result') return 'Game over. Final scores are ready.';
  return '';
}
