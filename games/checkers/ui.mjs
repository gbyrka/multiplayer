import { el, button, eyebrow } from '../../shared/dom.mjs';
import { initialBoard } from './rules.mjs';
const colorName = color => color === 'w' ? 'White' : 'Black';
let pieceNumber = 0;
export function pieceIcon(king, color) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox','0 0 64 80');svg.setAttribute('class',`piece piece-${color}`);svg.setAttribute('aria-hidden','true');
  const id=`counter-${++pieceNumber}`,ivory=color==='w',top=king?24:34;
  // Fixed original vector counter artwork; no player-authored HTML.
  svg.innerHTML=`<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${ivory?'#fff5d5':'#78947a'}"/><stop offset=".55" stop-color="${ivory?'#e4c78f':'#294a3d'}"/><stop offset="1" stop-color="${ivory?'#b08a48':'#102b21'}"/></linearGradient></defs><ellipse class="piece-shadow" cx="32" cy="66" rx="27" ry="8"/><g class="piece-body" style="fill:url(#${id})"><path d="M7 ${top}v20c0 19 50 19 50 0V${top}z"/><ellipse cx="32" cy="${top}" rx="25" ry="15"/><ellipse class="counter-ring" cx="32" cy="${top}" rx="19" ry="10"/><ellipse class="counter-ring" cx="32" cy="${top}" rx="14" ry="6"/>${king?'<path class="counter-seam" d="M7 43c0 18 50 18 50 0"/><path class="counter-crown" d="m21 23 3 8h16l3-8-7 4-4-7-4 7z"/>':''}</g>`;
  return svg;
}
export const previewBoard=initialBoard();
export function renderBoard(view, ui = {}, preview = false) {
  const black = view.me?.color === 'b', files = [...'abcdefgh'], ranks = [8, 7, 6, 5, 4, 3, 2, 1];
  if (black) { files.reverse(); ranks.reverse(); }
  const pieces = new Map(view.board.map(p => [p.square, p]));
  const legal = preview ? [] : view.legalMoves;
  const sources = new Set(legal.map(m => m.from));
  const targets = new Map(legal.filter(m => m.from === ui.selected).map(m => [m.to, m]));
  return el('div', { class: `board-stage${preview ? ' preview-stage' : ''}`, 'aria-hidden': preview ? 'true' : null },
    el('div', { class: 'board-tilt' }, el('div', { class: 'board-frame' },
      el('div', { class: 'chess-board', 'aria-label': black ? 'Checkers board, Black perspective' : 'Checkers board, White perspective' }, ranks.flatMap((rank, row) => files.map((file, column) => {
        const square = file + rank, piece = pieces.get(square), target = targets.get(square);
        const movable = sources.has(square), selected = ui.selected === square;
        const enabled = !preview && !ui.pending && (movable || Boolean(target));
        const label = `${square}${piece ? `, ${colorName(piece.color)} ${(piece.king ? 'king' : 'man')}` : ', empty'}${selected ? ', selected' : ''}${target ? ', legal destination' : ''}`;
        return el('button', { type: 'button', class: `square ${(file.charCodeAt(0) + rank) % 2 ? 'light-square' : 'dark-square'}${movable && !ui.selected ? ' can-move' : ''}${selected ? ' selected' : ''}${target ? ` legal-target${target.capture ? ' capture-target' : ''}` : ''}${view.pendingCaptured?.includes(square) ? ' captured-square' : ''}`,
          'data-square': square, 'aria-label': label, 'aria-pressed': selected ? 'true' : 'false', disabled: !enabled, 'data-render-key': square },
        piece ? pieceIcon(piece.king, piece.color) : null,
        column === 0 ? el('span', { class: 'rank-label', 'aria-hidden': 'true' }, rank) : null,
        row === 7 ? el('span', { class: 'file-label', 'aria-hidden': 'true' }, file) : null,
        target ? el('span', { class: 'target-dot', 'aria-hidden': 'true' }) : null);
      }))), el('div', { class: 'board-edge', 'aria-hidden': 'true' }))),
    null);
}
const field = (label, input) => el('label', { class: 'field' }, el('span', {}, label), input);
export function renderHome(ui) {
  return el('section', { class: 'home' },
    el('div', { class: 'home-copy' }, eyebrow('A TABLE FOR TWO'), el('h1', {}, ui.joining ? 'Join your opponent.' : 'Checkers with a friend.'),
      el('p', { class: 'lede' }, 'Share an invite. Choose who starts. Every capture counts.'),
      el('div', { class: 'home-facts' }, el('span', {}, '2 players'), el('span', {}, 'Compulsory captures'), el('span', {}, 'Mouse & touch')),
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
  const settings=draft??view.settings;
  return el('form',{'data-form':'settings',id:'settings-form',class:'settings-form checkers-settings'},
    el('h2',{class:'settings-heading'},'Game settings'),
    field('YOUR PIECES',el('select',{name:'hostColor',disabled:pending},...[
      ['random','Random colors'],['w','White · first move'],['b','Black · second move']
    ].map(([value,label])=>el('option',{value,selected:value===settings.hostColor},label)))),
    el('p',{class:'small-note'},'8×8 · Compulsory longest capture · Flying kings'),
    el('button',{class:'button secondary',type:'submit',disabled:pending},'SAVE SETTINGS'));
}
export function settingsText(settings) {
  return (settings.hostColor==='random'?'Colors drawn at the start':`Host plays ${colorName(settings.hostColor)}`)+' · Compulsory captures';
}
export function renderLobby(view, code, url, ui) {
  return el('section', { class: 'lobby' },
    el('div', { class: 'lobby-heading' }, el('h1', {}, 'Your checkers table'), el('span', {}, 'White moves first')),
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
export function statusText(view) {
  if(view.phase==='game_result'){
    const reason=view.result.reason;
    const detail={all_captured:'All opposing pieces have been captured.',blocked:'The opponent has no legal move.',resignation:'Your opponent has resigned.',agreement:'Both players agreed to a draw.',repetition:'The same position occurred three times.',quiet_kings:'25 moves per side by kings, without a capture or a man moving.'}[reason];
    return {title:view.result.winnerId?'VICTORY':'DRAW',body:view.result.winnerId?`${view.players.find(p=>p.id===view.result.winnerId).name} wins with ${colorName(view.result.winnerColor)}.`:detail,detail};
  }
  const required=view.requiredCaptures;
  return {title:view.continuation?'CONTINUE CAPTURE':view.myTurn&&required?'CAPTURE REQUIRED':view.myTurn?'YOUR MOVE':'OPPONENT’S MOVE',
    body:required?`${colorName(view.turn)} · ${required} ${view.continuation?'more to capture':'to capture'}`:`Move ${Math.floor(view.ply/2)+1} · ${colorName(view.turn)}`,
    detail:required?'Capturing is compulsory. Choose a longest capture sequence.':'Select a highlighted piece, then a marked destination.'};
}
function playerBar(view, color, bottom) {
  const p = view.players.find(p => p.color === color), active = view.phase === 'playing' && view.turn === color;
  return el('div', { class: `player-bar ${bottom ? 'player-bottom' : 'player-top'}${active ? ' active-player' : ''}` },
    el('div', { class: 'player-identity' }, el('span', { class: `player-token token-${color}`, 'aria-hidden': 'true' }, '●'), el('div', {}, el('strong', {}, p?.name ?? colorName(color), bottom ? ' · you' : ''), el('span', {}, colorName(color), active ? ' · TO MOVE' : ''))),
    el('span',{class:'piece-count'},
      `${view.board.filter(piece=>piece.color===color&&!view.pendingCaptured.includes(piece.square)).length} pieces · ${view.board.filter(piece=>piece.color===color&&piece.king&&!view.pendingCaptured.includes(piece.square)).length} kings`));
}
export function renderGame(view, ui) {
  const status = statusText(view), mine = view.me.color, theirs = mine === 'w' ? 'b' : 'w';
  return el('section', { class: 'game' },
    el('div', { id: 'game-status', class: `status-banner${view.requiredCaptures && view.phase === 'playing' ? ' capture-banner' : ''}${view.result ? ' result-banner' : ''}`, role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true', title: `${status.body} ${status.detail}` },
      el('h1', {}, status.title), el('p', {}, status.body)),
    playerBar(view, theirs, false), renderBoard(view, ui), playerBar(view, mine, true),
    el('div', { class: 'game-toolbar', 'aria-label': 'Game controls' },
      view.phase === 'game_result' ? (view.me.host ? button('PLAY AGAIN ↗', 'play-again', { class: 'button primary', disabled: ui.pending }) : el('span', { class: 'rematch-note' }, 'Waiting for the host’s rematch')) :
        button('CLEAR', 'cancel-selection', { class: 'button secondary', disabled: !ui.selected || Boolean(view.continuation) || ui.pending, 'aria-label': 'Clear selection' }),
      button('CHAT', 'open-chat', { class: 'button secondary', 'aria-label': 'Open room chat' }),
      button('MOVES', 'open-moves', { class: 'button secondary', 'aria-label': 'Open move history' }),
      button('TABLE', 'open-table', { class: 'button secondary', 'aria-label': 'Open table controls' })),
    null);
}
export function renderSide(view, pending) {
  if (!view || view.phase === 'lobby') return el('section', { class: 'panel table-note' }, el('h2', {}, 'At the table'), el('p', {}, settingsText(view.settings)));
  const turns = new Map();
  for (const move of view.history) { const number = Math.ceil(move.ply / 2); if (!turns.has(number)) turns.set(number, {}); turns.get(number)[move.color] = move.notation; }
  return el('div', { class: 'side-details' },
    el('section', { class: 'panel moves-panel' }, el('div', { class: 'moves-heading' }, el('h2', {}, 'Move history'), el('span', {}, `${view.ply} plies`)),
      el('div', { class: 'move-history', tabindex: 0, 'aria-label': 'Move history' }, view.history.length ? el('table', {}, el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, '#'), el('th', { scope: 'col' }, 'White'), el('th', { scope: 'col' }, 'Black'))), el('tbody', {}, [...turns].map(([number, moves]) => el('tr', { class: number === Math.ceil(view.ply / 2) ? 'latest-move' : '' }, el('th', { scope: 'row' }, number), el('td', {}, moves.w ?? '…'), el('td', {}, moves.b ?? '—'))))) : el('p', { class: 'muted' }, 'Every good game begins with a first move.'))),
    view.phase === 'playing' ? el('section', { class: 'panel game-actions' }, el('h2', {}, 'At the table'), el('p', { class: 'small-note' }, settingsText(view.settings)),
      view.drawOffer ? el('div', { class: 'draw-offer', role: 'status' }, el('p', {}, view.drawOffer === view.me.id ? 'Your draw offer is pending.' : 'Your opponent offers a draw.'), view.drawOffer !== view.me.id ? [button('ACCEPT DRAW', 'accept-draw', { class: 'button secondary', disabled: pending }), button('KEEP PLAYING', 'decline-draw', { class: 'button text-button', disabled: pending })] : null) : button('OFFER A DRAW', 'offer-draw', { class: 'button secondary', disabled: pending }),
      button('Resign game', 'resign', { class: 'button text-button resign-button', disabled: pending })) : el('section', { class: 'panel game-actions' }, el('h2', {}, 'Game finished'), el('p', {}, statusText(view).body), el('p', { class: 'small-note' }, 'The host can start another game from the lobby.')));
}
export function renderRules() {
  return el('div',{class:'rules-copy'},eyebrow('8×8 · BRAZILIAN-STYLE DRAUGHTS'),el('h2',{},'Every capture counts.'),
    el('p',{},'Two players, 12 pieces each, dark squares only. White starts. The host chooses White, Black or random colors. There is no clock. Your own pieces are always nearest you.'),
    el('h3',{},'Select, then move'),el('p',{},'Only pieces with a legal move are highlighted. Select one and choose a marked destination. Men move one square diagonally forwards. Kings move any distance along a clear diagonal.'),
    el('h3',{},'Capturing is compulsory'),el('p',{},'Men capture forwards and backwards by jumping over an adjacent opponent into the empty square beyond. Kings jump over one opposing piece along a clear diagonal and may land on any empty square beyond it. If any capture exists, quiet moves are forbidden. Choose a sequence taking the greatest number of pieces; any equally long sequence is allowed. Kings and men have equal value when counting captures.'),
    el('h3',{},'Finish every capture'),el('p',{},'After a jump, continue with the same piece until the sequence finishes. The next legal landing squares are marked automatically. Jumped pieces remain as faded blockers until the whole sequence ends. You cannot jump the same victim twice or pass through it again; empty squares may be revisited.'),
    el('h3',{},'Becoming a king'),el('p',{},'A man is crowned only when its completed turn ends on the opposite back rank. Passing through that rank during a capture does not crown it. Kings are double-stacked counters with a crown mark.'),
    el('h3',{},'Winning and draws'),el('p',{},'Win by taking every opposing piece or leaving your opponent with no legal move. A blocked player loses. You can resign or agree to a draw. Three repeated positions, or 25 moves per player using only kings without a capture or a man moving, end this casual game in a draw.'),
    el('h3',{},'Stay connected'),el('p',{},'Keep the host’s tab open. A lost connection stops the match. The host can return to the lobby to invite a replacement. Chat and the same room are kept for a rematch.'));
}
