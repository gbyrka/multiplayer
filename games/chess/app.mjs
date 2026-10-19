import { GameRoom } from '../../shared/room.mjs';
import { loadPeerJS, checkMultiplayerSupport, MULTIPLAYER_TEST_WARNING } from '../../shared/peer-loader.mjs';
import { normalizeRoomCode, validateName, isValidRoomCode } from '../../shared/random.mjs';
import { el, button, patchChildren } from '../../shared/dom.mjs';
import { ChatPanel } from '../../shared/chat-ui.mjs';
import { GameSound } from '../../shared/sound.mjs';
import { chessGame } from './game-core.mjs';
import { renderHome, renderLobby, renderGame, renderSide, renderRules, statusText, formatTime } from './ui.mjs';

const $ = id => document.getElementById(id), params = new URLSearchParams(location.search), sound = new GameSound();
const ui = { joining: params.has('room'), code: normalizeRoomCode(params.get('room')).slice(0, 8), name: '', error: '', selected: null, promotion: null, pending: false, settingsDirty: false };
try { ui.name = localStorage.getItem('multiplayer:name') ?? ''; } catch { /* Optional storage. */ }
let room = null, view = null, screen = 'home', attempt = 0, pendingTimer, toastTimer, receivedAt = performance.now(), supportError = '', testMode = false;
const chat = new ChatPanel((text, requestId) => room?.sendChat(text, requestId)); $('chat-root').append(chat.element);
void checkMultiplayerSupport().then(ok => { testMode = !ok; }, error => { supportError = error.message; if (screen === 'home') { ui.error = supportError; render(); } });
const inviteURL = (inRoom = true) => { const url = new URL(location.origin + location.pathname); if (inRoom && room) url.searchParams.set('room', room.roomCode); return url.href; };
function toast(text) { $('toast').textContent = text; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 6500); }
function status(text) { $('connection-status').textContent = text; if ($('connecting-detail')) $('connecting-detail').textContent = text; }
function clearPending() { ui.pending = false; clearTimeout(pendingTimer); }
function render() {
  $('boot').hidden = true;
  const inRoom = Boolean(room && view && !['home', 'connecting', 'error'].includes(screen));
  $('page-layout').classList.toggle('in-room', inRoom); $('sidebar').hidden = !inRoom;
  let node;
  if (screen === 'home') node = renderHome(ui);
  else if (screen === 'connecting') node = el('section', { class: 'connection-panel panel' }, eyebrow('A TABLE IS WAITING'), el('h1', {}, 'Pulling up a chair…'), el('p', { id: 'connecting-detail' }, $('connection-status').textContent), button('CANCEL', 'cancel-connect', { class: 'button secondary' }));
  else if (screen === 'error' || screen === 'disconnected') node = el('section', { class: 'connection-panel panel' }, el('h1', {}, screen === 'error' ? 'Let’s reconnect.' : 'The table is paused.'), el('p', {}, ui.error || 'Your opponent disconnected. This game has stopped.'),
    view?.me.host && view.phase === 'disconnected' ? button('RETURN TO LOBBY', 'return-lobby', { class: 'button primary', disabled: ui.pending }) : button('BACK TO THE START', 'home', { class: 'button primary' }));
  else node = view.phase === 'lobby' ? renderLobby(view, room.roomCode, inviteURL(), ui) : renderGame(view, ui);
  patchChildren($('main'), node);
  patchChildren($('match-info'), ...(inRoom ? [renderSide(view, ui.pending)] : []));
  $('leave').hidden = !room || screen === 'connecting';
  $('sound-toggle').textContent = sound.enabled ? 'SOUND ON' : 'SOUND OFF'; $('sound-toggle').setAttribute('aria-pressed', String(sound.enabled));
  chat.setConnected(inRoom && screen !== 'disconnected', view?.me.id);
  window.MoDITAds?.setVisible($('chess-ad'), ['home', 'lobby', 'game'].includes(screen));
  if (view && screen === 'game') $('announcer').textContent = `${statusText(view).title}. ${statusText(view).body}`;
  updateClocks();
}
function eyebrow(text) { return el('p', { class: 'eyebrow' }, text); }
function updateClocks() {
  if (!view?.clock) return;
  for (const node of document.querySelectorAll('[data-clock]')) {
    const color = node.dataset.clock;
    const elapsed = view.phase === 'playing' && view.clock.running === color ? Math.max(0, performance.now() - receivedAt) : 0;
    const remaining = Math.max(0, view.clock[color] - elapsed);
    node.textContent = formatTime(remaining); node.classList.toggle('low-time', remaining <= 30000);
    node.title = remaining === 0 && view.phase === 'playing' ? 'Waiting for the host to confirm the clock.' : '';
  }
}
setInterval(updateClocks, 100);
function receive(next) {
  const previous = view; if (next.phase === 'game_result' && previous?.phase !== 'game_result') $('dialog').close(); view = next; receivedAt = performance.now(); clearPending(); ui.selected = null; ui.promotion = null; ui.settingsDirty = false;
  screen = next.phase === 'disconnected' ? 'disconnected' : next.phase === 'lobby' ? 'lobby' : 'game';
  if (next.phase === 'disconnected') ui.error = `${next.disconnectedNames.join(', ')} disconnected. This game has stopped; its clock is frozen.`;
  history.replaceState(null, '', inviteURL());
  if (previous && next.ply > previous.ply) sound.play('card');
  if (next.phase === 'game_result' && previous?.phase !== 'game_result' && next.result.winnerId === next.me.id) sound.play('victory');
  if (previous?.phase === 'lobby' && next.phase === 'playing') window.gtag?.('event', 'game_start', { game_name: 'chess', timed: Boolean(next.clock) });
  if (next.phase === 'game_result' && previous?.phase !== 'game_result') window.gtag?.('event', 'game_end', { game_name: 'chess', ending: next.result.reason });
  render();
}
function send(type, payload = {}) {
  if (!room || ui.pending) return;
  ui.pending = true; render();
  pendingTimer = setTimeout(() => { clearPending(); toast('Still waiting for the host. Check your connection.'); render(); }, 12000);
  room.act(type, payload);
}
const action = (name, payload = {}) => send('CHESS_ACTION', { action: name, ...payload });
async function connect(form) {
  let name, code;
  try {
    if (supportError) throw new Error(supportError);
    const data = new FormData(form); name = validateName(data.get('name')); code = normalizeRoomCode(data.get('room'));
    if (ui.joining && !isValidRoomCode(code)) throw new Error('Enter the 8-character room code.');
  } catch (error) { ui.error = error.message; render(); return; }
  ui.name = name; ui.code = code; ui.error = ''; screen = 'connecting'; const current = ++attempt; status('Opening your table…'); render();
  try {
    const Peer = await loadPeerJS(); if (current !== attempt) return;
    const nextRoom = new GameRoom({ Peer, game: chessGame, appVersion: document.documentElement.dataset.appVersion ?? 'development',
      onView: next => { if (room === nextRoom) receive(next); }, onStatus: text => { if (room === nextRoom) status(text); },
      onError: text => { if (room === nextRoom) { clearPending(); ui.promotion = null; toast(text); render(); } },
      onEnded: text => { if (room === nextRoom) { clearPending(); screen = 'disconnected'; ui.error = text; render(); } },
      onChat: (snapshot, requestId) => { if (room === nextRoom) chat.update(snapshot, requestId); },
      onChatError: (text, requestId) => { if (room === nextRoom) chat.fail(text, requestId); },
    });
    room = nextRoom;
    if (ui.joining) await nextRoom.join(name, code); else await nextRoom.create(name);
    if (current !== attempt) { nextRoom.close(); return; }
    status('Connected · a table for two'); try { localStorage.setItem('multiplayer:name', name); } catch { /* Optional. */ }
    if (testMode) toast(MULTIPLAYER_TEST_WARNING);
  } catch (error) {
    if (current !== attempt) return;
    room?.close(); room = null; view = null; screen = 'error'; ui.error = error.message; render();
  }
}
function leave() {
  attempt++; room?.close(); room = null; view = null; clearPending(); chat.reset(); sound.stop(); ui.error = ''; ui.selected = null; ui.promotion = null; ui.settingsDirty = false;
  screen = 'home'; history.replaceState(null, '', inviteURL(false)); status('A classic. A table for two.'); render();
}
function dialog(content) { $('dialog-content').replaceChildren(content); $('dialog').showModal(); }
function selectSquare(square) {
  if (!view?.myTurn || ui.pending || ui.promotion) return;
  if (ui.selected) {
    const moves = view.legalMoves.filter(m => m.from === ui.selected && m.to === square);
    if (moves.length) {
      if (moves.some(m => m.promotion)) { ui.promotion = { from: ui.selected, to: square }; render(); setTimeout(() => document.querySelector('.promotion-choice')?.focus(), 0); }
      else action('MOVE', { from: ui.selected, to: square });
      return;
    }
  }
  ui.selected = ui.selected === square ? null : view.legalMoves.some(m => m.from === square) ? square : null; render();
}
async function handle(name, node) {
  sound.unlock();
  switch (name) {
    case 'switch-mode': ui.name = $('your-name')?.value ?? ui.name; ui.code = $('room-code-input')?.value ?? ui.code; ui.joining = !ui.joining; ui.error = ''; render(); break;
    case 'copy-invite': try { await navigator.clipboard.writeText(inviteURL()); toast('Invite link copied.'); } catch { $('invite-link').select(); toast('Select and copy the invitation.'); } break;
    case 'start': if (!ui.settingsDirty) send('START_GAME'); break;
    case 'ready': send('SET_READY', { ready: !view.me.ready }); break;
    case 'promote': if (ui.promotion) action('MOVE', { ...ui.promotion, promotion: node.dataset.piece }); break;
    case 'cancel-selection': ui.selected = null; ui.promotion = null; render(); break;
    case 'offer-draw': action('OFFER_DRAW'); break;
    case 'accept-draw': action('ACCEPT_DRAW'); break;
    case 'decline-draw': action('DECLINE_DRAW'); break;
    case 'claim-draw': action('CLAIM_DRAW'); break;
    case 'resign': dialog(el('div', {}, eyebrow('ONE LAST THOUGHT'), el('h2', {}, 'Resign this game?'), el('p', {}, 'Your opponent wins. You can play another game from the same room.'), button('YES, RESIGN', 'confirm-resign', { class: 'button primary' }), button('KEEP PLAYING', 'close-dialog', { class: 'button text-button' }))); break;
    case 'confirm-resign': $('dialog').close(); action('RESIGN'); break;
    case 'return-lobby': send('RETURN_TO_LOBBY'); break;
    case 'play-again': send('PLAY_AGAIN'); break;
    case 'rules': dialog(renderRules()); break;
    case 'close-dialog': $('dialog').close(); break;
    case 'toggle-sound': sound.setEnabled(!sound.enabled); render(); break;
    case 'leave': dialog(el('div', {}, el('h2', {}, 'Leave the table?'), el('p', {}, room?.isHost ? 'Leaving closes the room for both players.' : 'Leaving stops this game for both players.'), button('LEAVE ROOM', 'confirm-leave', { class: 'button primary' }), button('STAY', 'close-dialog', { class: 'button text-button' }))); break;
    case 'confirm-leave': $('dialog').close(); leave(); break;
    case 'home': case 'cancel-connect': leave(); break;
  }
}
document.addEventListener('click', event => {
  const square = event.target.closest('[data-square]'); if (square && !square.disabled) { sound.unlock(); selectSquare(square.dataset.square); return; }
  const node = event.target.closest('[data-action]'); if (node && !node.disabled) void handle(node.dataset.action, node);
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !$('dialog').open && (ui.selected || ui.promotion)) { ui.selected = null; ui.promotion = null; render(); }
});
document.addEventListener('submit', event => {
  const form = event.target; if (!form.dataset.form) return; event.preventDefault(); sound.unlock();
  if (form.dataset.form === 'connect') { void connect(form); return; }
  if (form.dataset.form === 'settings' && !ui.pending) {
    const data = new FormData(form), minutes = data.has('clock') ? Number(data.get('minutes')) : 0;
    if (data.has('clock') && (!Number.isInteger(minutes) || minutes < 1 || minutes > 180)) { toast('Choose a whole number from 1 to 180 minutes.'); return; }
    action('SETTINGS', { hostColor: data.get('hostColor'), minutes });
  }
});
function settingsChanged(event) {
  if (!event.target.closest('#settings-form')) return;
  ui.settingsDirty = true;
  const input = $('clock-minutes'); input.disabled = !$('use-clock').checked;
  const start = document.querySelector('[data-action="start"]'); if (start) start.disabled = true;
  const status = document.querySelector('.lobby-status'); if (status) status.textContent = 'Save your settings to continue.';
}
document.addEventListener('input', settingsChanged); document.addEventListener('change', settingsChanged);
render();
