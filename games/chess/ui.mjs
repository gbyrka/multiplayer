import { el, button, eyebrow } from '../../shared/dom.mjs';
import { Chess } from './vendor/chess.mjs';

const names = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const colorName = color => color === 'w' ? 'White' : 'Black';
const shapes = {
  p: '<circle cx="32" cy="19" r="9"/><path d="M24 31h16l-3 8c0 8 4 13 8 18H19c4-5 8-10 8-18z"/>',
  r: '<path d="M17 12h8v8h5v-8h6v8h5v-8h8v20l-7 5 2 20H20l2-20-5-5z"/><path class="carving" d="M22 31h20M25 39h14"/>',
  n: '<path d="M20 57l3-16 13-9-9-2-8 5-7-8 11-11 5-10 7 9c13 3 16 13 13 24l-2 18z"/><path class="carving" d="M23 24l8-4M26 42c5-5 11-7 13-13"/><circle class="eye" cx="34" cy="22" r="2"/>',
  b: '<path d="M32 6c-7 8-14 14-14 22 0 6 4 9 9 11l-2 10-7 8h28l-7-8-2-10c5-2 9-5 9-11 0-8-7-14-14-22z"/><path class="carving" d="M35 15l-8 14M25 40h14"/>',
  q: '<path d="M16 20l7 9 9-15 9 15 7-9-6 24H22zM24 44h16l-1 6 7 7H18l7-7z"/><circle cx="15" cy="17" r="4"/><circle cx="32" cy="10" r="4"/><circle cx="49" cy="17" r="4"/><path class="carving" d="M24 38h16"/>',
  k: '<path d="M29 6h6v7h7v6h-7v8h-6v-8h-7v-6h7zM21 29c0-7 22-7 22 0l-5 17 8 11H18l8-11z"/><path class="carving" d="M24 36h16M26 45h12"/>',
};
let pieceNumber = 0;
export function pieceIcon(type, color) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 64 80'); svg.setAttribute('class', `piece piece-${color}`); svg.setAttribute('aria-hidden', 'true');
  // Original, fixed vector artwork. Player text is always inserted through el().
  const id = `piece-${++pieceNumber}`, ivory = color === 'w';
  svg.innerHTML = `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${ivory ? '#c6ad7d' : '#0d201d'}"/><stop offset=".3" stop-color="${ivory ? '#fff8df' : '#506c5d'}"/><stop offset=".65" stop-color="${ivory ? '#eaddb8' : '#2b483e'}"/><stop offset="1" stop-color="${ivory ? '#b99a65' : '#112822'}"/></linearGradient></defs><ellipse class="piece-shadow" cx="33" cy="71" rx="24" ry="5"/><g class="piece-body" style="fill:url(#${id})">${shapes[type]}<path d="M18 57h28l4 9H14z"/><path d="M13 66h38v5H13z"/></g><path class="piece-shine" d="M19 62h26"/>`;
  return svg;
}
export const previewBoard = new Chess().board().flat().filter(Boolean);
export function renderBoard(view, ui = {}, preview = false) {
  const black = view.me?.color === 'b', files = [...'abcdefgh'], ranks = [8, 7, 6, 5, 4, 3, 2, 1];
  if (black) { files.reverse(); ranks.reverse(); }
  const pieces = new Map(view.board.map(p => [p.square, p]));
  const legal = preview ? [] : view.legalMoves;
  const sources = new Set(legal.map(m => m.from));
  const targets = new Map(legal.filter(m => m.from === ui.selected).map(m => [m.to, m]));
  return el('div', { class: `board-stage${preview ? ' preview-stage' : ''}`, 'aria-hidden': preview ? 'true' : null },
    el('div', { class: 'board-tilt' }, el('div', { class: 'board-frame' },
      el('div', { class: 'chess-board', 'aria-label': black ? 'Chessboard, Black perspective' : 'Chessboard, White perspective' }, ranks.flatMap((rank, row) => files.map((file, column) => {
        const square = file + rank, piece = pieces.get(square), target = targets.get(square);
        const movable = sources.has(square), selected = ui.selected === square;
        const enabled = !preview && !ui.pending && !ui.promotion && (movable || Boolean(target));
        const label = `${square}${piece ? `, ${colorName(piece.color)} ${names[piece.type]}` : ', empty'}${selected ? ', selected' : ''}${target ? ', legal destination' : ''}`;
        return el('button', { type: 'button', class: `square ${(file.charCodeAt(0) + rank) % 2 ? 'light-square' : 'dark-square'}${movable && !ui.selected ? ' can-move' : ''}${selected ? ' selected' : ''}${target ? ` legal-target${target.capture ? ' capture-target' : ''}` : ''}${!preview && view.checkedKing === square ? ' in-check' : ''}`,
          'data-square': square, 'aria-label': label, 'aria-pressed': selected ? 'true' : 'false', disabled: !enabled, 'data-render-key': square },
        piece ? pieceIcon(piece.type, piece.color) : null,
        column === 0 ? el('span', { class: 'rank-label', 'aria-hidden': 'true' }, rank) : null,
        row === 7 ? el('span', { class: 'file-label', 'aria-hidden': 'true' }, file) : null,
        target ? el('span', { class: 'target-dot', 'aria-hidden': 'true' }) : null);
      }))), el('div', { class: 'board-edge', 'aria-hidden': 'true' }))),
    null);
}
const field = (label, input) => el('label', { class: 'field' }, el('span', {}, label), input);
export function renderHome(ui) {
  return el('section', { class: 'home' },
    el('div', { class: 'home-copy' }, eyebrow('A TABLE FOR TWO'), el('h1', {}, ui.joining ? 'Join your opponent.' : 'Chess with a friend.'),
      el('p', { class: 'lede' }, 'Share an invite. Choose your colors and an optional clock.'),
      el('div', { class: 'home-facts' }, el('span', {}, '2 players'), el('span', {}, 'Optional chess clock'), el('span', {}, 'Mouse & touch')),
      el('form', { 'data-form': 'connect', class: 'entry-form', novalidate: true },
        field('YOUR NAME', el('input', { id: 'your-name', name: 'name', autocomplete: 'nickname', maxlength: 16, placeholder: 'What should we call you?', value: ui.name, required: true })),
        ui.joining ? field('ROOM CODE', el('input', { id: 'room-code-input', name: 'room', value: ui.code, maxlength: 8, autocomplete: 'off', autocapitalize: 'characters', spellcheck: false, placeholder: 'ABCDEFGH', required: true })) : null,
        el('p', { class: 'form-error', role: 'alert' }, ui.error),
        el('button', { type: 'submit', class: 'button primary' }, ui.joining ? 'JOIN THE TABLE ↗' : 'CREATE A TABLE ↗'),
        button(ui.joining ? 'Create a new table' : 'Have an invite? Join a table', 'switch-mode', { class: 'button text-button' })),
      el('p', { class: 'small-note' }, 'No account. No registration. Just an invite link.')),
    el('div', { class: 'home-art' }, renderBoard({ board: previewBoard, me: { color: 'w' } }, {}, true), el('p', { class: 'art-note' }, 'THE CLASSICS, IN GOOD COMPANY.')));
}
function settingsForm(view, pending, draft) {
  const settings = draft ?? view.settings;
  return el('form', { 'data-form': 'settings', id: 'settings-form', class: 'settings-form' },
    el('h2', { class: 'settings-heading' }, 'Game settings'),
    field('YOUR PIECES', el('select', { name: 'hostColor', disabled: pending }, ...[['random', 'Random colors'], ['w', 'White · first move'], ['b', 'Black · second move']].map(([value, label]) => el('option', { value, selected: value === settings.hostColor }, label)))),
    el('label', { class: 'clock-option' }, el('input', { type: 'checkbox', name: 'clock', id: 'use-clock', checked: settings.minutes > 0, disabled: pending }), el('span', {}, 'Use a chess clock', el('small', {}, 'The same time for both players. No increment.'))),
    field('MINUTES PER PLAYER', el('input', { type: 'number', id: 'clock-minutes', name: 'minutes', min: 1, max: 180, step: 1, value: settings.minutes || settings.clockMinutes || 10, disabled: settings.minutes === 0 || pending, inputmode: 'numeric' })),
    el('button', { class: 'button secondary', type: 'submit', disabled: pending }, 'SAVE SETTINGS'),
    el('p', { class: 'small-note' }, 'Save changes, then wait for your opponent to be ready.'));
}
export function settingsText(settings) {
  const color = settings.hostColor === 'random' ? 'Colors drawn at the start' : `Host plays ${colorName(settings.hostColor)}`;
  return `${color} · ${settings.minutes ? `${settings.minutes} min per player` : 'No clock'}`;
}
export function renderLobby(view, code, url, ui) {
  return el('section', { class: 'lobby' },
    el('div', { class: 'lobby-heading' }, el('h1', {}, 'Your chess table'), el('span', {}, 'White moves first')),
    el('div', { class: 'lobby-panels' },
      el('div', { class: 'lobby-invitation' },
        el('div', { class: 'invite-card panel' },
          el('div', { class: 'invite-code-row' }, el('div', {}, eyebrow('INVITE YOUR OPPONENT'), el('strong', { class: 'room-code' }, code)),
            button('COPY INVITE ↗', 'copy-invite', { class: 'button primary' })),
          field('INVITE LINK', el('input', { id: 'invite-link', value: url, readonly: true, 'aria-label': 'Invite link' }))),
        el('div', { class: 'lobby-players' }, view.players.map(p => el('div', { class: 'lobby-player' }, el('span', { class: 'avatar' }, p.name[0].toUpperCase()),
          el('div', {}, el('strong', {}, p.name, p.id === view.me.id ? ' · you' : ''), el('small', {}, p.host ? 'HOST' : p.ready ? 'READY' : 'NOT READY')),
          el('span', { class: `ready-dot${p.ready ? ' ready' : ''}`, 'aria-label': p.ready ? 'Ready' : 'Not ready' }))),
          view.players.length < 2 ? el('div', { class: 'empty-seat' }, 'Waiting for your opponent…') : null)),
      view.me.host ? settingsForm(view, ui.pending, ui.settingsDraft) : el('div', { class: 'panel guest-settings' }, el('h2', {}, 'Game settings'), el('p', {}, settingsText(view.settings)), el('p', { class: 'small-note' }, 'Changes to the settings reset your ready status.'))),
    el('div', { class: 'lobby-start' },
      el('p', { class: 'lobby-status', role: 'status' }, ui.settingsDirty ? 'Save your settings to continue.' : view.players.length < 2 ? 'Share the invite to fill the second seat.' : view.canStart ? 'Both players are ready.' : 'Waiting for your opponent to be ready.'),
      view.me.host ? button('LET’S PLAY ↗', 'start', { class: 'button primary start-button', disabled: !view.canStart || ui.pending || ui.settingsDirty }) : button(view.me.ready ? 'READY · CLICK TO UNREADY' : 'I’M READY', 'ready', { class: 'button primary start-button', disabled: ui.pending })),
    el('div', { class: 'lobby-footer' }, el('span', { class: 'small-note' }, 'Keep the host’s tab open during the game.'), button('ROOM CHAT', 'open-chat', { class: 'button text-button room-panel-button' })));
}
const explanations = {
  checkmate: 'The king is in check and has no legal escape.', stalemate: 'No legal move, and the king is not in check. The game is drawn.',
  insufficient_material: 'Neither side has enough material to deliver checkmate.', timeout: 'The chess clock has run out.',
  timeout_insufficient_material: 'Time ran out, but the opponent cannot deliver checkmate. The game is drawn.',
  resignation: 'Your opponent has resigned.', resignation_insufficient_material: 'The opponent cannot deliver checkmate. The game is drawn.',
  agreement: 'Both players agreed to a draw.', threefold_repetition: 'A draw was claimed after the same position occurred three times.',
  fivefold_repetition: 'The same position has occurred five times. The game is drawn.', fifty_moves: 'A draw was claimed after 50 moves by each side without a pawn move or a capture.',
  seventy_five_moves: '75 moves by each side without a pawn move or capture. The game is drawn.',
};
export function statusText(view) {
  if (view.phase === 'game_result') {
    const reason = view.result.reason;
    const label = reason === 'checkmate' ? 'CHECKMATE' : reason === 'stalemate' ? 'STALEMATE · DRAW' : !view.result.winnerId ? 'DRAW' : reason === 'timeout' ? 'TIME’S UP' : 'RESIGNATION';
    return { title: label, body: view.result.winnerId ? `${view.players.find(p => p.id === view.result.winnerId).name} wins with ${colorName(view.result.winnerColor)}.` : explanations[reason], detail: view.result.winnerId ? explanations[reason] : '' };
  }
  return { title: view.check ? 'CHECK' : view.myTurn ? 'YOUR MOVE' : 'OPPONENT’S MOVE',
    body: view.check ? `${colorName(view.turn)}’s king is in check.${view.myTurn ? ' Find a legal escape.' : ' Waiting for your opponent.'}` : `${colorName(view.turn)} to move.`,
    detail: view.myTurn ? 'Only pieces with a legal move are lit. Select one to see its destinations.' : 'Take a moment. Your next idea is waiting.' };
}
export const formatTime = ms => { const seconds = Math.ceil(Math.max(0, ms) / 1000); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; };
function playerBar(view, color, bottom) {
  const p = view.players.find(p => p.color === color), active = view.phase === 'playing' && view.turn === color;
  return el('div', { class: `player-bar ${bottom ? 'player-bottom' : 'player-top'}${active ? ' active-player' : ''}` },
    el('div', { class: 'player-identity' }, el('span', { class: `player-token token-${color}`, 'aria-hidden': 'true' }, '♚'), el('div', {}, el('strong', {}, p?.name ?? colorName(color), bottom ? ' · you' : ''), el('span', {}, colorName(color), active ? ' · TO MOVE' : ''))),
    view.clock ? el('time', { class: `chess-clock${active ? ' running' : ''}`, 'data-clock': color, 'aria-label': `${colorName(color)} clock` }, formatTime(view.clock[color])) : el('span', { class: 'no-clock' }, 'NO CLOCK'));
}
export function renderGame(view, ui) {
  const status = statusText(view), mine = view.me.color, theirs = mine === 'w' ? 'b' : 'w';
  return el('section', { class: 'game' },
    el('div', { id: 'game-status', class: `status-banner${view.check && view.phase === 'playing' ? ' check-banner' : ''}${view.result ? ' result-banner' : ''}`, role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true', title: `${status.body} ${status.detail}` },
      el('h1', {}, status.title), el('p', {}, view.phase === 'game_result' || view.check ? status.body : `Move ${Math.floor(view.ply / 2) + 1} · ${colorName(view.turn)}`)),
    playerBar(view, theirs, false), renderBoard(view, ui), playerBar(view, mine, true),
    el('div', { class: 'game-toolbar', 'aria-label': 'Game controls' },
      view.phase === 'game_result' ? (view.me.host ? button('PLAY AGAIN ↗', 'play-again', { class: 'button primary', disabled: ui.pending }) : el('span', { class: 'rematch-note' }, 'Waiting for the host’s rematch')) :
        button('CLEAR', 'cancel-selection', { class: 'button secondary', disabled: !ui.selected || ui.pending, 'aria-label': 'Clear selection' }),
      button('CHAT', 'open-chat', { class: 'button secondary', 'aria-label': 'Open room chat' }),
      button('MOVES', 'open-moves', { class: 'button secondary', 'aria-label': 'Open move history' }),
      button('TABLE', 'open-table', { class: 'button secondary', 'aria-label': 'Open table controls' })),
    ui.promotion ? el('section', { class: 'promotion-panel panel', role: 'group', 'aria-label': 'Choose a promotion piece' }, el('h2', {}, 'Promote your pawn'),
      el('div', { class: 'promotion-options' }, ['q', 'r', 'b', 'n'].map(type => button([pieceIcon(type, mine), el('span', {}, names[type])], 'promote', { class: 'promotion-choice', 'data-piece': type, 'aria-label': `Promote to ${names[type]}`, disabled: ui.pending }))),
      button('CANCEL', 'cancel-selection', { class: 'button text-button' })) : null);
}
export function renderSide(view, pending) {
  if (!view || view.phase === 'lobby') return el('section', { class: 'panel table-note' }, el('h2', {}, 'At the table'), el('p', {}, settingsText(view.settings)));
  const turns = new Map();
  for (const move of view.history) { const number = Math.ceil(move.ply / 2); if (!turns.has(number)) turns.set(number, {}); turns.get(number)[move.color] = move.san; }
  return el('div', { class: 'side-details' },
    el('section', { class: 'panel moves-panel' }, el('div', { class: 'moves-heading' }, el('h2', {}, 'Move history'), el('span', {}, `${view.ply} plies`)),
      el('div', { class: 'move-history', tabindex: 0, 'aria-label': 'Move history' }, view.history.length ? el('table', {}, el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, '#'), el('th', { scope: 'col' }, 'White'), el('th', { scope: 'col' }, 'Black'))), el('tbody', {}, [...turns].map(([number, moves]) => el('tr', { class: number === Math.ceil(view.ply / 2) ? 'latest-move' : '' }, el('th', { scope: 'row' }, number), el('td', {}, moves.w ?? '…'), el('td', {}, moves.b ?? '—'))))) : el('p', { class: 'muted' }, 'Every good game begins with a first move.'))),
    view.phase === 'playing' ? el('section', { class: 'panel game-actions' }, el('h2', {}, 'At the table'), el('p', { class: 'small-note' }, settingsText(view.settings)),
      view.drawOffer ? el('div', { class: 'draw-offer', role: 'status' }, el('p', {}, view.drawOffer === view.me.id ? 'Your draw offer is pending.' : 'Your opponent offers a draw.'), view.drawOffer !== view.me.id ? [button('ACCEPT DRAW', 'accept-draw', { class: 'button secondary', disabled: pending }), button('KEEP PLAYING', 'decline-draw', { class: 'button text-button', disabled: pending })] : null) : button('OFFER A DRAW', 'offer-draw', { class: 'button secondary', disabled: pending }),
      view.canClaimDraw ? button('CLAIM DRAW', 'claim-draw', { class: 'button secondary', disabled: pending }) : null,
      button('Resign game', 'resign', { class: 'button text-button resign-button', disabled: pending })) : el('section', { class: 'panel game-actions' }, el('h2', {}, 'Game finished'), el('p', {}, statusText(view).body), el('p', { class: 'small-note' }, 'The host can start another game from the lobby.')));
}
export function renderRules() {
  return el('div', { class: 'rules-copy' }, eyebrow('THE CLASSIC GAME'), el('h2', {}, 'A little thought. Every move.'),
    el('p', {}, 'White moves first. Your pieces always start closest to you; Black sees the board from the opposite side.'),
    el('h3', {}, 'Select, then move'), el('p', {}, 'Only your pieces with legal moves are highlighted on your turn. Select one, then choose a marked square. A ring marks a capture. Moves that leave your king in check are never offered. Select the piece again or press Escape to cancel.'),
    el('h3', {}, 'The special moves'), el('p', {}, 'Castling, en passant and pawn promotion are supported. To castle, select the king and its two-square destination. Promotion lets you choose a queen, rook, bishop or knight.'),
    el('h3', {}, 'Check, checkmate, stalemate'), el('p', {}, 'CHECK means your king is attacked: block, capture the attacker or move the king. CHECKMATE ends the game with a win. STALEMATE means there is no legal move but no check: it is a draw.'),
    el('h3', {}, 'The clock'), el('p', {}, 'The host chooses no clock or 1–180 minutes per player. White’s clock starts when the host starts the game. Your clock stops after a legal move; there is no increment. Time keeps running while choosing a promotion, considering a draw offer or hiding a tab. The host confirms timeouts. A player cannot win on time with a bare king.'),
    el('h3', {}, 'Other endings'), el('p', {}, 'You can resign or agree to a draw. Insufficient material, fivefold repetition and 75 moves per side without a capture or pawn move end the game automatically. On your turn, claim a draw when the current position has repeated three times or after 50 moves per side without a capture or pawn move.'),
    el('h3', {}, 'Stay connected'), el('p', {}, 'Keep the host’s tab open and the device awake. A disconnected player stops the game; the host can return to the lobby to invite a replacement. There is no mid-game reconnect or host migration.'));
}
