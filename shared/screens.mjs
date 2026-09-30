import { el, button, eyebrow, playingCard, friendsInstructions } from './dom.mjs';

export function renderHeader({ game, room, view, status, soundEnabled = true }) {
  return el('div', { class: 'header-inner' },
    button([el('span', { class: 'brand-mark', 'aria-hidden': 'true' }, 'm'), el('span', { class: 'brand-name' }, 'multiplayer', el('small', {}, 'GOOD GAMES. GOOD COMPANY.'))], 'collection', { class: 'brand', 'aria-label': 'Multiplayer game collection' }),
    el('nav', { class: 'header-nav', 'aria-label': 'Main navigation' },
      !game && !room ? el('a', { class: 'button text-button collection-link', href: '../games/' }, '← Browse all games') : null,
      room ? el('span', { class: 'connection-status', id: 'connection-status' }, el('i', { 'aria-hidden': 'true' }), el('span', {}, status)) : null,
      view && view.phase !== 'lobby' ? button('SCOREBOARD', 'scoreboard', { class: 'button text-button' }) : null,
      game ? button('HOW TO PLAY', 'rules', { class: 'button text-button' }) : null,
      button(soundEnabled ? 'SOUND ON' : 'SOUND OFF', 'toggle-sound', {
        class: 'button text-button sound-button', 'aria-pressed': String(soundEnabled),
        'aria-label': soundEnabled ? 'Mute sounds' : 'Enable sounds', title: soundEnabled ? 'Mute sounds' : 'Enable sounds',
      }),
      room ? button('LEAVE GAME', 'leave', { class: 'button text-button leave-button' }) : null,
    ),
  );
}

export function renderCollection(games) {
  return el('div', { class: 'collection-page' },
    el('section', { class: 'collection-hero' }, eyebrow('THE MULTIPLAYER COLLECTION'),
      el('h1', {}, 'Good company.', el('br'), el('em', {}, 'Great games.')),
      el('p', { class: 'hero-description' }, 'Bring your people. Pick a game. Make an evening of it.'),
      el('aside', { class: 'play-promise' }, el('strong', {}, 'Serverless. No registration.'),
        el('p', {}, 'Every game in this collection runs in your browser. No account needed — just invite your friends and play.')),
    ),
    el('div', { class: 'section-heading' }, el('h2', {}, 'Find your next favorite'), el('span', {}, 'THE COLLECTION · 01')),
    el('section', { class: 'game-collection', 'aria-label': 'Choose a game' }, games.map(game =>
      el('article', { class: 'featured-game' },
        el('div', { class: 'game-art', 'aria-hidden': 'true' }, el('span', { class: 'art-orbit orbit-one' }), el('span', { class: 'art-orbit orbit-two' }),
          el('span', { class: 'art-caption' }, 'A GOOD HAND STARTS WITH A PLAN'),
          el('div', { class: 'showcase-cards' },
            playingCard({ rank: 'K', suit: 'C' }, { index: 0 }),
            playingCard({ rank: 'Q', suit: 'H' }, { index: 1 }),
            playingCard({ rank: 'A', suit: 'S' }, { index: 2 })),
          el('span', { class: 'art-signature' }, '♣ ♦ ♥ ♠')),
        el('div', { class: 'featured-content' }, eyebrow(game.category),
          el('h2', {}, game.title), el('p', { class: 'game-subtitle' }, game.subtitle), el('p', { class: 'muted' }, game.description),
          el('div', { class: 'game-facts' }, el('span', {}, game.players), el('span', {}, game.duration), el('span', {}, 'Ages 8+')),
          button(['PLAY ', game.title, el('span', { 'aria-hidden': 'true' }, '↗')], 'select-game', { class: 'button primary', 'data-game': game.id }),
        ),
      ),
    )),
    el('aside', { class: 'coming-soon' }, el('span', { class: 'coming-icon', 'aria-hidden': 'true' }, '✦'),
      el('div', {}, el('h2', {}, 'There’s more at the table.'), el('p', {}, 'More games are on the way. For now, let’s make a PLAN.')),
      el('span', { class: 'pill' }, 'COMING SOON')),
    el('footer', { class: 'collection-footer' },
      el('p', { class: 'collection-signoff' }, 'Made for friends, near and far.'),
      el('p', { class: 'author-credit' }, 'Created by ',
        el('a', { href: 'https://www.linkedin.com/in/grzegorz-byrka-81175515/', target: '_blank', rel: 'noopener noreferrer' },
          'Grzegorz Byrka', el('span', { class: 'sr-only' }, ' on LinkedIn (opens in a new tab)'), el('span', { 'aria-hidden': 'true' }, ' ↗'))),
    ),
  );
}

export function renderGameHome(game, { name = '', code = '', join = false } = {}) {
  return el('div', { class: 'game-home' },
    button('← ALL GAMES', 'collection', { class: 'button text-button back-link' }),
    el('div', { class: 'home-columns' },
      el('section', { class: 'plan-intro' }, eyebrow(game.category), el('h1', { class: 'plan-title' }, game.title),
        el('p', { class: 'plan-tagline' }, game.subtitle),
        el('p', { class: 'intro-description' }, 'Six rounds. Everyone opens the bidding once per round. A card game about knowing when to aim high — and when to play it safe.'),
        el('div', { class: 'intro-cards', 'aria-hidden': 'true' }, playingCard({ rank: 'A', suit: 'S' }), playingCard({ rank: '7', suit: 'H' }), playingCard(null, { back: true })),
        el('div', { class: 'game-facts' }, el('span', {}, game.players), el('span', {}, game.duration), el('span', {}, 'Play anywhere')),
        button('HOW TO PLAY ↗', 'rules', { class: 'button secondary' }),
      ),
      el('section', { class: 'entry-panel panel' }, eyebrow(join ? 'YOUR SEAT IS WAITING' : 'GATHER YOUR PEOPLE'),
        el('h2', {}, join ? 'Join the table.' : 'Let’s play.'),
        el('p', { class: 'muted' }, join ? 'Enter your name and the room code from your host.' : 'Create a room and invite your friends, or join their table.'),
        el('form', { id: 'entry-form', novalidate: true, 'data-mode': join ? 'join' : 'create' },
          el('label', { for: 'your-name' }, 'YOUR NAME'),
          el('input', { id: 'your-name', name: 'nickname', type: 'text', maxlength: '16', autocomplete: 'nickname', placeholder: 'What should we call you?', value: name, required: true }),
          join ? [el('label', { for: 'room-code-input' }, 'ROOM CODE'),
            el('input', { id: 'room-code-input', class: 'room-code-input', name: 'room', maxlength: '8', type: 'text', autocapitalize: 'characters', autocomplete: 'off', spellcheck: 'false', placeholder: 'K7PX4M9Q', value: code, required: true })] : null,
          el('p', { class: 'form-error', id: 'form-error', role: 'alert' }),
          el('button', { type: 'submit', class: 'button primary wide' }, join ? 'JOIN GAME' : 'CREATE GAME'),
          button(join ? 'CREATE A NEW GAME' : 'JOIN GAME', join ? 'show-create' : 'show-join', { class: 'button secondary wide' }),
        ), el('p', { class: 'entry-note' }, 'No sign-up. No downloads. Just good company.'),
      ),
    ), friendsInstructions(),
  );
}

export function renderConnecting(status, retrying) {
  return el('section', { class: 'connection-panel panel' }, el('div', { class: 'loader', 'aria-hidden': 'true' }),
    eyebrow(retrying ? 'RETRYING...' : 'PULLING UP A CHAIR'), el('h1', {}, 'Connecting…'),
    el('p', { id: 'connecting-detail', class: 'muted', role: 'status' }, status), button('CANCEL', 'cancel-connect', { class: 'button secondary' }));
}

export function renderConnectionError(error, library = false) {
  return el('section', { class: 'connection-panel panel' }, el('span', { class: 'error-symbol', 'aria-hidden': 'true' }, '◇'),
    eyebrow(library ? 'MULTIPLAYER SERVICE UNAVAILABLE' : 'CONNECTION FAILED'), el('h1', {}, library ? 'Let’s reconnect.' : 'Couldn’t find your seat.'),
    el('p', { class: 'muted' }, error), button(library ? 'RELOAD' : 'TRY AGAIN', library ? 'reload' : 'retry', { class: 'button primary' }),
    button('RETURN TO HOME', 'home', { class: 'button secondary' }));
}

export function renderLobby(view, roomCode, inviteLink, pending) {
  const waiting = view.players.length < 2 ? 'Invite at least one friend to get started.' : view.players.some(p => !p.host && !p.ready) ? 'Waiting for every guest to get ready.' : 'Everyone’s ready. Let’s make a plan.';
  return el('div', { class: 'lobby-page' },
    el('div', { class: 'lobby-heading' }, eyebrow('PLAN · THE GATHERING'), el('h1', {}, 'A seat for your friends.'), el('p', { class: 'muted' }, 'Share the invitation. Settle in. Your next good game starts here.')),
    el('div', { class: 'lobby-columns' },
      el('section', { class: 'invite-panel panel' }, eyebrow('ROOM CODE'), el('strong', { class: 'room-code', id: 'room-code' }, roomCode),
        el('p', { class: 'muted' }, 'Send this code or share an invite link.'), button('COPY INVITE LINK', 'copy-invite', { class: 'button primary wide' }),
        el('div', { id: 'invite-fallback', class: 'invite-fallback' }, el('label', { for: 'invite-link' }, 'INVITE LINK'),
          el('input', { id: 'invite-link', type: 'text', value: inviteLink, readonly: true, 'aria-label': 'Invite link; select and copy', spellcheck: 'false' }),
          button('SELECT LINK', 'select-invite', { class: 'button text-button' })),
        el('p', { class: 'host-note' }, "Keep the host's browser tab open during the whole game.")),
      el('section', { class: 'lobby-players panel' },
        el('div', { class: 'section-heading' }, el('h2', {}, 'At the table'), el('span', {}, `${view.players.length} / 6 PLAYERS`)),
        el('ol', { class: 'lobby-list' }, view.players.map((player, index) => el('li', { 'data-player-id': player.id },
          el('span', { class: 'seat-number' }, String(index + 1).padStart(2, '0')),
          el('span', { class: 'avatar', 'aria-hidden': 'true' }, [...player.name][0].toUpperCase()),
          el('strong', {}, player.name, player.id === view.me.id ? el('small', {}, ' YOU') : null),
          el('span', { class: `ready-status${player.host || player.ready ? ' is-ready' : ''}` }, player.host ? '♔ HOST' : player.ready ? '✓ READY' : 'NOT READY'),
        ))),
        view.players.length < 6 ? el('p', { class: 'empty-seat' }, `${6 - view.players.length} open ${view.players.length === 5 ? 'seat' : 'seats'} · Invite someone along`) : null,
        el('p', { class: 'lobby-waiting' }, waiting),
        view.me.host ? button('START GAME', 'start', { class: 'button primary wide', disabled: !view.canStart || pending }) :
          button(view.me.ready ? '✓ READY · CLICK TO UNREADY' : 'READY', 'ready', { class: `button ${view.me.ready ? 'secondary' : 'primary'} wide`, 'aria-pressed': String(view.me.ready), disabled: pending }),
        el('p', { class: 'entry-note' }, view.me.host ? 'You’re the host. Start when everybody is ready.' : 'The host will start when everybody is ready.'),
      ),
    ),
    el('aside', { class: 'lobby-tip' }, el('span', { 'aria-hidden': 'true' }, '✦'), el('p', {}, el('strong', {}, 'First time here? '), 'Predict exactly how many tricks you’ll win. Accuracy beats ambition.'), button('LEARN TO PLAY', 'rules', { class: 'button text-button' })),
  );
}

export function renderDisconnected({ view, reason, host }) {
  return el('section', { class: 'connection-panel panel' }, eyebrow(view?.phase === 'disconnected' ? 'PLAYER DISCONNECTED' : host ? 'CONNECTION LOST' : 'HOST DISCONNECTED'),
    el('h1', {}, 'The table is on pause.'),
    el('p', { class: 'muted' }, view?.phase === 'disconnected' ? `${view.disconnectedNames.join(' & ')} left the game. This game has stopped.` : reason),
    view?.phase === 'disconnected' ? view.me.host ? button('RETURN TO LOBBY', 'return-lobby', { class: 'button primary' }) : el('p', { class: 'waiting-note' }, 'Waiting for host…') : button('RETURN TO HOME', 'home', { class: 'button primary' }),
  );
}
