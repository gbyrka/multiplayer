import { el, button, eyebrow } from '../../shared/dom.mjs';
import { pointsFor } from './game-core.mjs';

const field = (label, control) => el('label', { class: 'field' }, el('span', {}, label), control);
const languageName = language => language === 'pl' ? 'Polski' : 'English · UK + US';
export const settingsText = settings => `${languageName(settings.language)} · ${settings.size}×${settings.size} · ${settings.minLength}+ letters · ${settings.seconds / 60} min · ${settings.rounds} ${settings.rounds === 1 ? 'round' : 'rounds'}`;
const choice = (name, label, value, options, disabled) => field(label, el('select', { name, disabled }, options.map(([key, text]) => el('option', { value: key, selected: key === value }, text))));

export function renderBoard(board, size, { path = [], preview = false, disabled = false } = {}) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'trail-lines'); svg.setAttribute('viewBox', `0 0 ${size * 100} ${size * 100}`); svg.setAttribute('aria-hidden', 'true');
  if (path.length > 1) {
    const line = document.createElementNS(svg.namespaceURI, 'polyline');
    line.setAttribute('points', path.map(index => `${(index % size) * 100 + 50},${Math.floor(index / size) * 100 + 50}`).join(' '));
    svg.append(line);
  }
  return el('div', { class: `letter-board${preview ? ' preview-board' : ''}`, id: preview ? 'preview-board' : 'letter-board', 'data-size': size, 'data-interactive': String(!preview && !disabled), style: `--size:${size}`, 'aria-label': preview ? 'Example letter board' : `${size} by ${size} letter board` },
    el('div', { class: 'tiles' }, board.map((letter, index) => {
      const order = path.indexOf(index);
      return el('button', { type: 'button', class: `tile${order >= 0 ? ' selected' : ''}${path.at(-1) === index ? ' trail-end' : ''}`, 'data-tile': preview ? null : index,
        'data-render-key': `tile-${index}`, disabled: preview || disabled, 'aria-label': `${letter.toUpperCase()}, row ${Math.floor(index / size) + 1}, column ${index % size + 1}${order >= 0 ? `, letter ${order + 1} in word` : ''}`,
        'aria-pressed': order >= 0 ? 'true' : 'false' }, el('span', { class: 'tile-letter' }, letter.toUpperCase()),
        order >= 0 ? el('small', { class: 'tile-order', 'aria-hidden': 'true' }, order + 1) : null);
    })), svg);
}

export function renderHome(ui) {
  const letters = [...'boggiwelthfriend'];
  return el('section', { class: 'home' },
    el('div', { class: 'home-copy' }, el('h1', {}, 'A little wordplay'),
      el('div', { class: 'facts' }, el('span', {}, '2–6 friends'), el('span', {}, 'Polski / English'), el('span', {}, 'Keyboard, mouse & touch')),
      el('form', { 'data-form': 'connect', class: 'entry-form', novalidate: true },
        field('YOUR NAME', el('input', { id: 'your-name', name: 'name', value: ui.name, maxlength: 16, autocomplete: 'nickname', placeholder: 'What should we call you?', required: true })),
        ui.joining ? field('ROOM CODE', el('input', { id: 'room-code-input', name: 'room', value: ui.code, maxlength: 8, autocapitalize: 'characters', autocomplete: 'off', spellcheck: false, placeholder: 'ABCDEFGH' })) : null,
        el('p', { class: 'form-error', role: 'alert' }, ui.error),
        el('button', { type: 'submit', class: 'button primary' }, ui.joining ? 'JOIN GAME ↗' : 'CREATE GAME ↗'),
        button(ui.joining ? 'Create a new room' : 'Have an invite? Join a room', 'switch-mode', { class: 'button text-button' })),
      el('p', { class: 'small-note' }, 'No account. Just a name, an invite, and a way with words.')),
    el('div', { class: 'home-art' }, el('div', { class: 'art-caption' }, el('span', {}, 'FOLLOW YOUR CURIOSITY'), el('span', { 'aria-hidden': 'true' }, '↗')),
      renderBoard(letters, 4, { preview: true, path: [0, 1, 2, 3, 7, 6] }), el('p', { class: 'art-note' }, 'There’s always another word.')));
}

export function renderLobby(view, code, url, ui) {
  const s = ui.settingsDraft ?? view.settings;
  return el('section', { class: 'lobby' }, eyebrow('GOOD WORDS. GOOD COMPANY.'),
    el('div', { class: 'section-heading' }, el('h1', {}, 'Gather your word people.'), el('span', { class: 'badge' }, `${view.players.length} / 6 PLAYERS`)),
    el('div', { class: 'lobby-grid' },
      el('div', { class: 'lobby-company' }, el('section', { class: 'panel invite-card' },
        el('div', { class: 'invite-code-row' }, el('div', {}, eyebrow('YOUR ROOM CODE'), el('strong', { class: 'room-code' }, code)), button('COPY INVITE ↗', 'copy-invite', { class: 'button primary' })),
        field('INVITE LINK', el('input', { id: 'invite-link', readonly: true, value: url, 'aria-label': 'Invite link' }))),
        el('div', { class: 'lobby-players' }, view.players.map(p => el('div', { class: 'lobby-player', 'data-render-key': p.id },
          el('span', { class: 'avatar', 'aria-hidden': 'true' }, p.name[0].toUpperCase()), el('div', {}, el('strong', {}, p.name, p.id === view.me.id ? ' · you' : ''), el('small', {}, p.host ? 'HOST' : p.ready ? 'READY' : 'GETTING READY')),
          el('span', { class: `ready-dot${p.ready ? ' ready' : ''}`, 'aria-label': p.ready ? 'Ready' : 'Not ready' }))),
          view.players.length < 2 ? el('p', { class: 'empty-seat' }, 'A good game starts with a friend. Share your invite.') : null)),
      view.me.host ? el('form', { id: 'settings-form', 'data-form': 'settings', class: 'panel settings-form' }, el('h2', {}, 'Make it your game.'),
        choice('language', 'DICTIONARY', s.language, [['pl', 'Polski'], ['en', 'English · British + American']], ui.pending || ui.preparing),
        el('div', { class: 'field-pair' }, choice('size', 'BOARD', s.size, [[4, '4 × 4'], [5, '5 × 5'], [6, '6 × 6']], ui.pending || ui.preparing),
          choice('minLength', 'MINIMUM WORD LENGTH', s.minLength, [[3, '3 letters'], [4, '4 letters'], [5, '5 letters']], ui.pending || ui.preparing)),
        el('div', { class: 'field-pair' }, choice('seconds', 'TIME PER ROUND', s.seconds, [[60, '1 minute'], [120, '2 minutes'], [180, '3 minutes']], ui.pending || ui.preparing),
          choice('rounds', 'ROUNDS', s.rounds, [[1, '1 round'], [3, '3 rounds'], [5, '5 rounds']], ui.pending || ui.preparing)),
        el('p', { class: 'small-note' }, 'Inflected forms count. Names and abbreviations don’t. Shared words cancel out at the end of each round.'),
        el('button', { type: 'submit', class: 'button secondary', disabled: ui.pending || ui.preparing }, 'SAVE SETTINGS')) :
        el('section', { class: 'panel guest-settings' }, el('h2', {}, 'This is how we play.'), el('p', {}, settingsText(view.settings)), el('p', { class: 'small-note' }, 'The host chooses the settings. A change resets everyone’s ready status.'))),
    el('div', { class: 'lobby-start' }, el('p', { class: 'muted', role: 'status' }, ui.preparing ? 'Loading the dictionary and finding a good board…' : ui.settingsDraft ? 'Save your settings before starting.' : view.canStart ? 'Everyone’s here. Everyone’s ready.' : 'Waiting for at least two connected, ready players.'),
      view.me.host ? button(ui.preparing ? 'PREPARING…' : 'LET’S FIND SOME WORDS ↗', 'start', { class: 'button primary', disabled: !view.canStart || ui.pending || ui.preparing || Boolean(ui.settingsDraft) }) :
        button(view.me.ready ? 'READY · CLICK TO UNREADY' : 'I’M READY', 'ready', { class: 'button primary', disabled: ui.pending })),
    el('p', { class: 'small-note' }, 'Keep the host’s tab open and devices awake throughout the game.'));
}

function standings(view) {
  const ranking = [...view.players].sort((a, b) => b.total - a.total);
  return el('section', { class: 'panel standings' }, el('div', { class: 'section-heading' }, el('h2', {}, 'The company'), el('small', {}, 'TOTAL POINTS')),
    el('ol', {}, ranking.map(p => el('li', { 'data-render-key': p.id }, el('span', {}, p.name, p.id === view.me.id ? ' · you' : ''), el('strong', {}, p.total)))),
    el('p', { class: 'small-note' }, view.phase === 'playing' ? 'Your words stay private until time is up.' : 'Scores carry over between rounds.'));
}

export function renderGame(view, ui) {
  if (view.phase === 'countdown') return el('section', { class: 'countdown-screen panel' }, eyebrow(`ROUND ${view.round} OF ${view.settings.rounds}`), el('h1', {}, 'A fresh board.\nA fresh pair of eyes.'),
    el('strong', { id: 'countdown-number', class: 'countdown-number', 'aria-label': 'Seconds until the round begins' }, '4'), el('p', {}, settingsText(view.settings)), el('p', { class: 'muted' }, 'Find a trail. Make a word. Keep going.'));
  const result = ['round_result', 'game_result'].includes(view.phase), selected = ui.resultWord;
  const path = result ? view.result.longest.find(entry => entry.word === selected)?.path ?? [] : ui.path;
  return el('section', { class: `game${result ? ' results' : ''}` },
    el('div', { class: 'round-heading' }, el('div', {}, eyebrow(`ROUND ${view.round} OF ${view.settings.rounds} · ${languageName(view.settings.language)}`), el('h1', {}, result ? view.phase === 'game_result' ? 'Good words. Great game.' : 'Time to compare notes.' : 'Follow a little possibility.')),
      !result ? el('div', { class: 'clock', role: 'timer', 'aria-label': 'Time remaining' }, el('span', { id: 'round-clock' }, '3:00'), el('small', {}, `${view.settings.minLength}+ LETTERS`)) : el('span', { class: 'badge' }, 'TIME’S UP')),
    el('div', { class: 'play-grid' },
      el('div', { class: 'board-column' }, renderBoard(view.board, view.settings.size, { path, disabled: result || ui.pending || ui.expired }),
        result ? el('p', { id: 'path-description', class: 'board-hint' }, selected ? `${selected.toUpperCase()} · ${selected.length} letters` : 'Choose a longest word to see its trail.') :
          el('div', { class: 'word-entry' }, el('form', { 'data-form': 'word', id: 'word-form', novalidate: true },
            field('YOUR NEXT WORD', el('input', { id: 'word-input', name: 'word', value: ui.draft, maxlength: view.board.length, autocomplete: 'off', autocorrect: 'off', autocapitalize: 'none', spellcheck: false, enterkeyhint: 'send', lang: view.settings.language,
              placeholder: 'Type a word, or trace the tiles', disabled: ui.expired, readonly: ui.pending, 'aria-describedby': 'word-feedback board-help' })),
            el('button', { type: 'submit', class: 'button primary', disabled: ui.pending || ui.expired || !ui.draft }, ui.pending ? 'SENDING…' : 'ADD WORD ↗')),
          el('div', { class: 'entry-bottom' }, el('p', { id: 'word-feedback', class: `feedback${ui.feedbackError ? ' feedback-error' : ''}`, role: 'status' }, ui.feedback || `At least ${view.settings.minLength} letters. Every new trail counts.`), button('CLEAR', 'clear-word', { class: 'button text-button', disabled: !ui.draft || ui.pending })),
          el('p', { id: 'board-help', class: 'board-hint' }, 'Type + Enter, drag + release, or tap tiles + Add word. Diagonals welcome. Each tile once.'))),
      el('div', { class: 'round-sidebar' }, result ? resultSummary(view, ui) : el('section', { class: 'panel found-panel' },
        el('div', { class: 'section-heading' }, el('h2', {}, 'Your discoveries'), el('span', { class: 'badge' }, view.myWords.length)),
        el('p', { class: 'small-note' }, 'Shared words cancel out. Final points arrive when the round ends.'),
        el('ul', { class: 'found-words', 'aria-label': 'Your accepted words' }, view.myWords.length ? [...view.myWords].reverse().map(word => el('li', { 'data-render-key': word }, el('span', { lang: view.settings.language }, word), el('small', {}, `${word.length} letters`))) : el('li', { class: 'empty-words' }, 'Your first word is waiting on the board.'))), standings(view))),
    result ? roundWords(view) : null);
}

function resultSummary(view, ui) {
  const final = view.phase === 'game_result';
  return el('section', { class: 'panel result-summary' }, eyebrow(final ? 'THE FINAL WORD' : 'ROUND COMPLETE'),
    el('h2', {}, final ? `${view.players.filter(p => view.winnerIds.includes(p.id)).map(p => p.name).join(' & ')} ${view.winnerIds.length === 1 ? 'wins!' : 'tie!'}` : 'Nice finds, everyone.'),
    el('p', { class: 'muted' }, final ? 'One board. Plenty of ways to see it.' : 'There’s another board around the corner.'),
    el('h3', {}, 'The longest trails'), el('p', { class: 'small-note' }, 'Longest words in this dictionary. Select one to follow its path.'),
    el('div', { class: 'longest-words' }, view.result.longest.map(entry => button(entry.word, 'show-path', { class: `longest-word${ui.resultWord === entry.word ? ' active' : ''}`, 'data-word': entry.word, 'aria-pressed': ui.resultWord === entry.word ? 'true' : 'false', lang: view.settings.language }))),
    el('p', { id: 'longest-credit', class: 'small-note' }, (() => {
      const entry = view.result.longest.find(word => word.word === ui.resultWord) ?? view.result.longest[0];
      return `${entry.word.length} letters · ${entry.foundBy.length ? 'Found by ' + entry.foundBy.map(id => view.players.find(p => p.id === id).name).join(', ') : 'Nobody found this one.'}`;
    })()),
    view.me.host ? button(ui.preparing ? 'PREPARING…' : final ? 'PLAY AGAIN ↗' : 'NEXT ROUND ↗', final ? 'play-again' : 'next-round', { class: 'button primary next-round', disabled: ui.pending || ui.preparing || ui.nextLocked, 'data-next-label': final ? 'PLAY AGAIN ↗' : 'NEXT ROUND ↗' }) : el('p', { class: 'small-note' }, 'Waiting for the host.'));
}

function roundWords(view) {
  return el('section', { class: 'round-review' }, el('div', { class: 'section-heading' }, el('h2', {}, 'Every discovery, revealed.'), el('p', { class: 'small-note' }, 'Crossed-out words were found by more than one player.')),
    el('div', { class: 'review-grid' }, view.result.scores.map(p => el('section', { class: 'panel player-review', 'data-render-key': p.id },
      el('div', { class: 'section-heading' }, el('h3', {}, p.name), el('strong', {}, `+${p.score}`)),
      el('ul', {}, p.words.length ? [...p.words].sort((a, b) => b.word.length - a.word.length || a.word.localeCompare(b.word, view.settings.language)).map(entry => el('li', { class: entry.shared ? 'shared-word' : '' }, el('span', { lang: view.settings.language }, entry.word), el('small', {}, entry.shared ? 'shared · 0' : `+${entry.points}`))) : el('li', { class: 'muted' }, 'No words this round.'))))));
}

export function renderRules() {
  return el('div', { class: 'rules-copy' }, eyebrow('Boggle'), el('h2', {}, 'Find your own way with words.'),
    el('p', {}, 'Everyone plays the same board at the same time. The host chooses Polish or English, a 4×4, 5×5 or 6×6 board, 1–3 minutes per round, 1, 3 or 5 rounds, and a minimum word length of 3, 4 or 5 letters.'),
    el('h3', {}, 'Type it. Trace it. Find it.'), el('p', {}, 'Type a word and press Enter, drag through the tiles and release to submit, or tap individual tiles and choose Add word. Move horizontally, vertically or diagonally. A tile can be used once per word. Trace back to the previous tile to undo a step; Clear or Escape starts again.'),
    el('h3', {}, 'Every form has a place.'), el('p', {}, 'Inflected forms and irregular forms count as separate words. Polish accents matter: l and ł are different letters. English accepts British and American spelling. Proper names, abbreviations, spaces, hyphens and apostrophes are excluded. A spelling that also has an ordinary meaning remains valid. Historical-only Polish entries are excluded. Dictionaries are fixed for this release; no dictionary covers every word.'),
    el('h3', {}, 'A word of your own.'), el('p', {}, 'Submit each spelling once per round. If multiple players find the same word, it earns no points for anyone. Different inflections count separately. Up to 250 accepted words per player per round.'),
    el('table', { class: 'scoring-table' }, el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Letters'), el('th', { scope: 'col' }, 'Points'))),
      el('tbody', {}, [3, 4, 5, 6, 7, 8].map(length => el('tr', {}, el('td', {}, length === 8 ? '8+' : length), el('td', {}, pointsFor(length)))))),
    el('p', {}, 'A higher minimum excludes shorter words; it doesn’t change the points for longer words. Totals carry over between rounds. Highest total wins; ties share the win.'),
    el('h3', {}, 'One last discovery.'), el('p', {}, 'After each round, see everyone’s accepted words and up to five equally longest possible words. Select a longest word to reveal its trail and see who found it. We don’t display the full list of possible words.'),
    el('h3', {}, 'Keep the connection.'), el('p', {}, 'The host’s browser validates words and controls the clock. Keep that tab open and devices awake. Words must reach the host before the deadline. A lost player connection stops the game; the host can reopen the lobby. Refreshing leaves the room.'));
}
