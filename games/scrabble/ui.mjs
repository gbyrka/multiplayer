import { el, button } from '../../shared/dom.mjs';
import { LANGUAGES, PREMIUMS, CENTER, coordinate, letterValue, tileValue } from './constants.mjs';
const field = (label, input) => el('label', {}, el('span', {}, label), input);
const option = (value, text, selected) => el('option', { value, selected }, text);
const control = (text, action, props = {}) => button(text, action, props);
export function renderHome(ui) {
  return el('section', { class: 'home panel' }, el('h1', {}, 'Scrabble'), el('p', { class: 'muted' }, '1–4 players · Polish / English'),
    el('form', { 'data-form': 'connect' }, field('Your name', el('input', { id: 'your-name', name: 'name', value: ui.name, maxlength: 16, autocomplete: 'nickname', required: true })),
      ui.joining ? field('Room code', el('input', { id: 'room-code', name: 'room', value: ui.code, maxlength: 8, autocapitalize: 'characters', required: true })) : null,
      ui.error ? el('p', { class: 'error', role: 'alert' }, ui.error) : null,
      el('div', { class: 'actions' }, el('button', { type: 'submit', class: 'button primary' }, ui.joining ? 'Join game' : 'Create game'),
        !ui.joining ? el('button', { type: 'submit', name: 'mode', value: 'solo', class: 'button' }, 'Play alone') : null)),
    control(ui.joining ? 'Create a game instead' : 'Join a game', 'switch-mode', { class: 'button quiet' }));
}
export function renderLobby(view, code, invite, ui) {
  const settings = ui.settingsDraft ?? view.settings;
  return el('section', { class: 'lobby panel' }, el('h1', {}, view.solo ? 'Solo practice' : 'Game room'),
    !view.solo ? el('div', { class: 'invite' }, el('strong', { class: 'room-code' }, code), field('Invite link', el('input', { id: 'invite-link', value: invite, readonly: true })), control('Copy link', 'copy-invite')) : null,
    el('ul', { class: 'lobby-players' }, view.players.map(p => el('li', { 'data-render-key': p.id }, el('span', {}, p.name, p.host ? ' · host' : ''), el('span', { class: 'muted' }, p.ready ? 'Ready' : 'Not ready')))),
    view.me.host ? el('form', { 'data-form': 'settings', id: 'settings-form' },
      el('div', { class: 'settings-grid' }, field('Dictionary', el('select', { name: 'language' }, Object.entries(LANGUAGES).map(([key, language]) => option(key, language.name, key === settings.language)))),
        field('Time per move', el('select', { name: 'clock' }, [0,30,60,120,180,-1].map(seconds => option(seconds, seconds === 0 ? 'No time limit' : seconds === -1 ? 'Custom…' : `${seconds} seconds`, seconds === (ui.customClock ? -1 : settings.seconds))))),
        field('Custom limit (seconds)', el('input', { name: 'seconds', type: 'number', min: 1, max: 3600, value: settings.seconds || 60, disabled: !ui.customClock }))),
      el('div', { class: 'actions' }, el('button', { type: 'submit', class: 'button', disabled: ui.pending || ui.loading || !ui.settingsDraft }, 'Save settings'))) :
      el('p', {}, `${LANGUAGES[view.settings.language].name} · ${view.settings.seconds ? `${view.settings.seconds} seconds per move` : 'No time limit'}`),
    el('div', { class: 'actions' }, view.me.host ? control(ui.loading ? 'Loading dictionary…' : 'Start game', 'start', { class: 'button primary', disabled: !view.canStart || Boolean(ui.settingsDraft) || ui.pending || ui.loading || !ui.dictionary }) :
      control(view.me.ready ? 'Not ready' : 'Ready', 'ready', { class: 'button primary', disabled: ui.pending || ui.loading || !ui.dictionary })),
    ui.settingsDraft ? el('p', { class: 'muted' }, 'Save settings before starting.') : null,
    ui.dictionaryError ? el('div', { class: 'error' }, el('p', {}, ui.dictionaryError), control('Retry dictionary', 'retry-dictionary')) : null,
    !view.solo ? el('p', { class: 'small muted' }, 'Keep the host’s tab open and devices awake.') : null);
}
function renderBoard(view, ui) {
  const drafts = new Map(ui.preview.placements.map(p => [p.index, { ...p, blank: !view.rack.find(tile => tile.id === p.tileId)?.letter }]));
  const last = new Set(view.history.at(-1)?.indices ?? []);
  return el('div', { class: 'board-frame' }, el('div', { class: 'column-labels', 'aria-hidden': 'true' }, Array.from({ length: 15 }, (_, i) => el('span', {}, String.fromCharCode(65+i)))),
    el('div', { class: 'row-labels', 'aria-hidden': 'true' }, Array.from({ length: 15 }, (_, i) => el('span', {}, i+1))),
    el('div', { id: 'board', class: 'board', role: 'group', 'aria-label': 'Scrabble board' }, view.board.map((fixed, index) => {
      const draft = drafts.get(index), tile = fixed ?? draft, premium = PREMIUMS[index], selected = ui.start === index;
      return control('', 'square', { 'data-index': index, 'data-render-key': `square-${index}`, class: `square ${premium.toLowerCase()}${tile ? ' occupied' : ''}${draft ? ' draft' : ''}${selected ? ' selected' : ''}${!draft && last.has(index) ? ' last-move' : ''}${ui.preview.cells.includes(index) ? ' trail' : ''}`,
        disabled: !view.myTurn || ui.pending || ui.expired,
        'aria-label': `${coordinate(index)}${tile ? ` ${tile.letter.toUpperCase()}${tile.blank ? ' blank' : ''}` : index === CENTER ? ' centre double word' : ` ${premium === '..' ? 'empty' : premium}`}${selected ? ui.vertical ? ', down' : ', across' : ''}`,
      });
    }).map((node,index) => {
      const tile = view.board[index] ?? drafts.get(index), selected = ui.start === index;
      if (tile) {
        node.append(el('span', { class: 'letter' }, tile.letter.toUpperCase()), el('small', { class: 'tile-points' }, tileValue(view.settings.language,tile)));
        if (tile.blank) node.append(el('span', { class: 'blank-mark', title: 'Blank tile' }, '•'));
      }
      else node.append(el('span', { class: 'premium-label' }, index === CENTER ? '★' : PREMIUMS[index] === '..' ? '' : PREMIUMS[index]));
      if (selected) node.append(el('span', { class: 'direction', 'aria-hidden': 'true' }, ui.vertical ? '↓' : '→'));
      return node;
    })));
}
function renderRack(view, ui) {
  const used = new Set(ui.preview.placements.map(p => p.tileId)), order = ui.rackOrder;
  const tiles = [...view.rack].sort((a,b) => order.indexOf(a.id) - order.indexOf(b.id));
  return el('div', { class: 'rack-row' }, el('div', { class: 'rack', 'aria-label': 'Your tiles' }, tiles.map(tile => control('', 'rack-tile', {
    class: `rack-tile${used.has(tile.id) ? ' used' : ''}${ui.exchangeIds.includes(tile.id) ? ' exchange-selected' : ''}`, 'data-tile-id': tile.id, 'data-render-key': tile.id,
    disabled: ui.pending || (ui.exchange && !view.myTurn), 'aria-label': `${tile.letter ? tile.letter.toUpperCase() : 'Blank'}, ${letterValue(view.settings.language, tile.letter)} points`, 'aria-pressed': String(ui.exchangeIds.includes(tile.id)),
  })).map((node,i) => { node.append(el('span', {}, tiles[i].letter.toUpperCase() || '◇'), el('small', {}, letterValue(view.settings.language,tiles[i].letter))); return node; })),
    control('⇄', 'shuffle', { class: 'button shuffle', title: 'Shuffle your rack', 'aria-label': 'Shuffle your rack' }));
}
export function renderGame(view, ui) {
  const ended = view.phase === 'game_result', current = view.players.find(p => p.id === view.turnId);
  return el('section', { class: 'game' }, el('div', { class: 'game-bar' }, el('h1', {}, ended ? view.solo ? 'Practice complete' : `${view.players.filter(p => view.result.winnerIds.includes(p.id)).map(p => p.name).join(' & ')} ${view.result.winnerIds.length > 1 ? 'tie' : 'wins'}` : view.myTurn ? 'Your turn' : `${current.name}’s turn`),
    el('div', { class: 'game-meta' }, el('span', {}, LANGUAGES[view.settings.language].name), el('span', {}, `${view.bagCount} tiles in bag`), el('strong', { id: 'turn-clock', role: 'timer', 'aria-label': 'Time remaining' }, view.remainingMs === null ? 'No clock' : ''))),
    el('div', { class: 'play-layout' }, el('div', { class: 'board-column' }, renderBoard(view, ui), renderRack(view,ui),
      !ended ? el('section', { class: 'move-editor' }, el('form', { 'data-form': 'word', id: 'word-form' },
        control(ui.start === null ? '→' : `${coordinate(ui.start)} ${ui.vertical ? '↓' : '→'}`, 'direction', { class: 'button direction-toggle', title: 'Change direction', disabled: !view.myTurn || ui.pending || ui.expired }),
        el('input', { id: 'word-input', name: 'word', value: ui.draft, maxlength: 15, autocomplete: 'off', autocorrect: 'off', autocapitalize: 'none', spellcheck: false, inputmode: 'none', lang: view.settings.language,
          placeholder: view.myTurn ? 'Select a square, then type a word' : 'Waiting for your turn', 'aria-label': 'Complete word', 'aria-describedby': 'move-feedback', disabled: !view.myTurn || ui.pending || ui.expired || ui.exchange, readonly: ui.pending }),
        el('button', { type: 'submit', class: 'button primary', disabled: !view.myTurn || ui.pending || ui.expired || ui.exchange || !ui.preview.scored || Boolean(ui.preview.error) || !ui.dictionary }, ui.preview.scored ? `Play · ${ui.preview.scored.points} pts` : 'Play')),
        el('div', { class: 'feedback-row' }, el('p', { id: 'move-feedback', role: 'status', class: `feedback${ui.feedbackError || ui.preview.error ? ' error' : ''}` },
          ui.feedback || ui.preview.error || (ui.loading ? 'Loading dictionary…' : ui.preview.scored ? ui.preview.scored.words.map(w => `${w.word.toUpperCase()} ${w.points}`).join(' · ') + (ui.preview.scored.bonus ? ' · +50 bonus' : '') : 'Enter: play · Esc: clear · Space: direction')),
          control('Clear', 'clear', { class: 'button quiet', disabled: !ui.draft || ui.pending }), control('Blanks', 'blanks', { class: 'button quiet', disabled: !ui.preview.placements.length || ui.pending || ui.exchange })),
        ui.exchange ? el('div', { class: 'exchange-controls' }, el('span', {}, 'Select tiles on your rack.'), control(`Exchange ${ui.exchangeIds.length || ''}`, 'confirm-exchange', { disabled: !ui.exchangeIds.length || ui.pending || ui.expired }), control('Cancel', 'cancel-exchange')) : null,
        el('div', { class: 'turn-actions' }, control('Pass', 'pass', { disabled: !view.myTurn || ui.pending || ui.expired }), control('Exchange tiles', 'exchange', { disabled: !view.myTurn || ui.pending || ui.expired || view.bagCount < 7 }),
          view.solo ? control('End practice', 'end-practice', { class: 'button quiet', disabled: ui.pending || ui.expired }) : null)) :
      el('section', { class: 'result panel' }, el('p', {}, view.result.reason === 'emptied' ? 'All tiles played.' : view.result.reason === 'scoreless' ? 'Six consecutive turns without points.' : 'Practice ended.'),
        el('p', { class: 'muted' }, 'Unused tile values have been deducted from the final scores.'), view.me.host ? control('Play again', 'play-again', { class: 'button primary', disabled: ui.pending }) : el('p', {}, 'Waiting for the host.'))),
      el('aside', { class: 'sidebar' }, el('section', { class: 'panel standings' }, el('h2', {}, 'Scores'), el('ol', {}, view.players.map(p => el('li', { class: p.id === view.turnId && !ended ? 'on-turn' : '', 'data-render-key': p.id },
        el('span', {}, p.name, p.id === view.me.id ? ' · you' : '', el('small', {}, `${p.tileCount} tiles`)), el('strong', {}, p.score))))),
        el('section', { class: 'panel history-panel' }, el('h2', {}, 'Moves'), el('ol', { class: 'history', reversed: true }, [...view.history].reverse().map(entry => el('li', { 'data-render-key': `move-${entry.serial}` },
          el('div', {}, el('strong', {}, view.players.find(p => p.id === entry.playerId)?.name ?? ''), el('b', {}, entry.kind === 'play' ? `+${entry.points}` : '0')),
          el('span', {}, entry.kind === 'play' ? entry.words.map(w => w.word.toUpperCase()).join(' · ') : entry.kind === 'timeout' ? 'Time expired · pass' : entry.kind === 'exchange' ? `${entry.count} tiles exchanged` : 'Pass')))),
          !view.history.length ? el('p', { class: 'muted' }, 'No moves yet.') : null),
        ui.dictionaryError ? el('div', { class: 'panel error' }, el('p', {}, ui.dictionaryError), control('Retry dictionary', 'retry-dictionary')) : null)));
}
export function renderRules() {
  return el('div', { class: 'rules' }, el('h2', {}, 'How to play'),
    el('p', {}, 'Play with 2–4 people or choose Play alone to practise on your own score. Polish and English use separate 100-tile sets and letter values.'),
    el('h3', {}, 'Placing words'), el('p', {}, 'Select a starting square and type the complete word, including letters already on the board. Select the same square again or press Space in the word field to switch direction. Enter plays; Escape clears the preview. Existing letters must match. All new tiles must form one continuous row or column and connect to the board. The first word must cover the centre star.'),
    el('p', {}, 'The preview uses letters from your rack, then blanks if needed. Blank tiles show a dot and score zero for the whole game. Open Blanks to choose where to spend a blank even when you have the ordinary letter. Click rack letters to append them to the word; shuffle only changes their display order.'),
    el('h3', {}, 'Scoring'), el('p', {}, 'Every word formed, including perpendicular words, must be in the selected dictionary. DL/TL multiply the value of a newly placed letter; DW/TW multiply each word using that newly covered square. Premiums apply only on the turn they are covered. Seven new tiles earn 50 extra points. Blanks can activate word premiums.'),
    el('h3', {}, 'Turns and time'), el('p', {}, 'Choose no clock, a preset, or 1–3600 seconds per move. Time runs while you edit, use chat or try an invalid move. Your move must reach the host before the deadline. Expiry discards the preview and passes your turn. Passing and exchanging also use a turn. You can exchange selected tiles only while at least seven remain in the bag.'),
    el('h3', {}, 'End of game'), el('p', {}, 'The game ends when the bag is empty and a player empties their rack, or after six consecutive turns with no points. Remaining tile values are deducted. In multiplayer, a player who goes out also receives the other players’ unused points. Highest final score wins; ties are shared. Solo also has an End practice button.'),
    el('h3', {}, 'Dictionaries and connections'), el('p', {}, 'These are the same SGJP Polish and SCOWL/ESDB British/American English word lists used by Boggle, including two-letter words and inflections. They are not official tournament Scrabble lists. Words are checked automatically, without challenges. Keep the host’s tab open and devices awake. A disconnected player stops the game; the host can reopen the lobby. Refreshing leaves the game.'));
}
