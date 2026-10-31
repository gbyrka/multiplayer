import { GameRoom } from '../../shared/room.mjs';
import { loadPeerJS, checkMultiplayerSupport, MULTIPLAYER_TEST_WARNING } from '../../shared/peer-loader.mjs';
import { normalizeRoomCode, validateName, isValidRoomCode } from '../../shared/random.mjs';
import { el, button, patchChildren } from '../../shared/dom.mjs';
import { ChatPanel } from '../../shared/chat-ui.mjs';
import { GameSound } from '../../shared/sound.mjs';
import { createBoggleGame } from './game-core.mjs';
import { SoloSession } from './solo-session.mjs';
import { findPath, normalizeWord, isWord, neighbors } from './dictionary.mjs';
import { renderHome, renderLobby, renderGame, renderRules } from './ui.mjs';

const $ = id => document.getElementById(id), params = new URLSearchParams(location.search), sound = new GameSound();
const ui = { joining: params.has('room'), code: normalizeRoomCode(params.get('room')).slice(0, 8), name: '', error: '', pending: false, preparing: false,
  settingsDraft: null, draft: '', path: [], feedback: '', feedbackError: false, resultWord: null, expired: false, nextLocked: false, mobileTyping: false };
try { ui.name = localStorage.getItem('multiplayer:name') ?? ''; ui.mobileTyping = localStorage.getItem('boggle:mobile-typing') === 'on'; } catch { /* Optional storage. */ }
let room = null, view = null, screen = 'home', attempt = 0, supportError = '', testWarning = false;
let pendingWord = null, pendingTimer, toastTimer, roundDeadline = 0, nextDeadline = 0, drag = null, worker = null, workerTask = null, workerSerial = 0;
const chat = new ChatPanel((text, requestId) => room?.sendChat?.(text, requestId)); $('chat-root').append(chat.element);
void checkMultiplayerSupport().then(ok => { testWarning = !ok; }, error => { supportError = error.message; if (screen === 'home') { ui.error = supportError; render(); } });
const inviteURL = (inRoom = true) => {
  const url = new URL(location.origin + location.pathname);
  if (inRoom && room && !room.isSolo) url.searchParams.set('room', room.roomCode);
  return url.href;
};
function toast(text) {
  $('toast').textContent = text; $('toast').hidden = false; clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 6500);
}
function status(text) { $('connection-status').textContent = text; if ($('connecting-detail')) $('connecting-detail').textContent = text; }
function clearPending() { ui.pending = false; pendingWord = null; clearTimeout(pendingTimer); }
function feedback(text, error = false) { ui.feedback = text; ui.feedbackError = error; }
function render() {
  $('boot').hidden = true; document.body.dataset.screen = screen;
  let content;
  if (screen === 'home') content = renderHome(ui);
  else if (screen === 'connecting') content = el('section', { class: 'connection-panel panel' }, el('p', { class: 'eyebrow' }, 'GOOD COMPANY AHEAD'), el('h1', {}, 'Finding your people…'),
    el('p', { id: 'connecting-detail' }, $('connection-status').textContent), button('CANCEL', 'home', { class: 'button secondary' }));
  else if (screen === 'error' || screen === 'disconnected') content = el('section', { class: 'connection-panel panel' }, el('h1', {}, screen === 'error' ? 'Let’s reconnect.' : 'The trail is paused.'),
    el('p', {}, ui.error || 'A player disconnected. The game has stopped.'), view?.me.host && view.phase === 'disconnected' ?
      button('RETURN TO LOBBY', 'return-lobby', { class: 'button primary', disabled: ui.pending }) : button('BACK TO THE START', 'home', { class: 'button primary' }));
  else content = view.phase === 'lobby' ? renderLobby(view, room.roomCode, inviteURL(), ui) : renderGame(view, ui);
  patchChildren($('main'), content);
  const input = $('word-input');
  if (input && input.value !== ui.draft) input.value = ui.draft;
  // patchChildren preserves active form controls. Select values need their live property too.
  if ($('settings-form')) for (const [key, value] of Object.entries(ui.settingsDraft ?? view.settings)) $('settings-form').elements[key].value = String(value);
  const connected = Boolean(room && view && !['connecting', 'error', 'home'].includes(screen));
  $('leave').hidden = !connected; $('chat-section').hidden = !connected || Boolean(view?.solo);
  chat.setConnected(connected && !view?.solo && screen !== 'disconnected', view?.me.id);
  $('sound-toggle').textContent = sound.enabled ? 'SOUND ON' : 'SOUND OFF'; $('sound-toggle').setAttribute('aria-pressed', String(sound.enabled));
  $('mobile-typing-toggle').textContent = ui.mobileTyping ? 'MOBILE TYPING ON' : 'MOBILE TYPING OFF';
  $('mobile-typing-toggle').setAttribute('aria-pressed', String(ui.mobileTyping));
  window.MoDITAds?.setVisible($('boggle-ad'), $('about-dialog').open);
  tick();
}
function receive(next) {
  const previous = view, phaseChanged = next.phase !== previous?.phase || next.round !== previous?.round;
  view = next;
  roundDeadline = performance.now() + next.remainingMs; nextDeadline = performance.now() + next.nextInMs;
  ui.expired = next.phase === 'playing' && next.remainingMs <= 0; ui.nextLocked = next.nextInMs > 0;
  const wordAccepted = pendingWord && next.myWords.includes(pendingWord);
  if (wordAccepted) {
    const accepted = pendingWord;
    if (normalizeWord(ui.draft) === accepted) { ui.draft = ''; ui.path = []; }
    clearPending(); feedback(`${accepted.toUpperCase()} · found!`); sound.play('card');
  } else if (!pendingWord || phaseChanged) clearPending();
  if (phaseChanged) {
    drag = null; ui.path = []; ui.draft = ''; ui.resultWord = next.result?.longest[0]?.word ?? null;
    if (!['round_result', 'game_result'].includes(next.phase)) feedback('');
    $('dialog').close();
    if (next.phase === 'game_result' && next.winnerIds.includes(next.me.id)) sound.play('victory');
    if (next.phase === 'countdown') window.gtag?.('event', 'game_start', { game_name: 'boggle', round: next.round });
    if (next.phase === 'game_result') window.gtag?.('event', 'game_end', { game_name: 'boggle' });
    $('announcer').textContent = next.phase === 'playing' ? 'The round has started.' : next.phase === 'countdown' ? `Round ${next.round} starts in four seconds.` : next.result ? 'Time is up. Round results are ready.' : '';
  }
  if (ui.settingsDraft && Object.entries(ui.settingsDraft).every(([key, value]) => next.settings[key] === value)) ui.settingsDraft = null;
  screen = next.phase === 'disconnected' ? 'disconnected' : next.phase === 'lobby' ? 'lobby' : 'game';
  if (next.phase === 'disconnected') ui.error = `${next.disconnectedNames.join(', ')} disconnected. The host can reopen the lobby.`;
  history.replaceState(null, '', inviteURL()); render();
  if ((phaseChanged || wordAccepted) && next.phase === 'playing') focusWordInput();
}
function focusWordInput() {
  if (view?.phase !== 'playing' || ui.expired || $('dialog').open || $('about-dialog').open ||
      (!ui.mobileTyping && matchMedia('(any-pointer: coarse)').matches) || document.activeElement?.closest('#chat-section')) return;
  $('word-input')?.focus({ preventScroll: true });
}
function send(type, payload = {}) {
  if (!room || ui.pending) return;
  ui.pending = true;
  pendingTimer = setTimeout(() => { clearPending(); feedback('Still waiting for the host. Check your connection.', true); render(); }, 12000);
  render(); room.act(type, payload);
}
const action = (name, payload = {}) => send('BOGGLE_ACTION', { action: name, ...payload });

function stopWorker() {
  workerTask?.reject(new Error('Board preparation cancelled.')); workerTask = null;
  worker?.terminate(); worker = null;
}
function prepare(settings) {
  if (!worker) {
    worker = new Worker(new URL('./dictionary-worker.mjs' + new URL(import.meta.url).search, import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      if (workerTask?.id !== data.id) return;
      const task = workerTask; workerTask = null;
      if (data.error) { worker.terminate(); worker = null; task.reject(new Error(data.error)); }
      else task.resolve(data.result);
    };
    worker.onerror = () => { const task = workerTask; workerTask = null; worker.terminate(); worker = null; task?.reject(new Error('The dictionary worker could not load. Reload the page and try again.')); };
  }
  return new Promise((resolve, reject) => {
    const id = ++workerSerial;
    const timer = setTimeout(() => { if (workerTask?.id === id) stopWorker(); }, 75000);
    workerTask = { id, resolve: data => { clearTimeout(timer); resolve(data); }, reject: error => { clearTimeout(timer); reject(error); } };
    worker.postMessage({ id, settings });
  });
}
async function startRound(type) {
  if (!room?.isHost || ui.pending || ui.preparing || ui.settingsDraft || (type === 'NEXT_HAND' && ui.nextLocked)) return;
  const currentRoom = room, settings = { ...view.settings }, round = view.round, phase = view.phase;
  ui.preparing = true; render();
  try {
    const prepared = await prepare(settings);
    if (room !== currentRoom || view.phase !== phase || view.round !== round || !Object.entries(settings).every(([key, value]) => view.settings[key] === value)) return;
    currentRoom.game.stageRound(prepared); ui.preparing = false; send(type);
  } catch (error) { if (room === currentRoom) toast(error.message); }
  finally { if (room === currentRoom) { ui.preparing = false; render(); } }
}

async function connect(form, solo = false) {
  let name, code;
  try {
    if (supportError && !solo) throw new Error(supportError);
    const data = new FormData(form); name = validateName(data.get('name')); code = normalizeRoomCode(data.get('room'));
    if (!solo && ui.joining && !isValidRoomCode(code)) throw new Error('Enter the 8-character room code.');
  } catch (error) { ui.error = error.message; render(); return; }
  ui.name = name; ui.code = code; ui.error = ''; screen = 'connecting'; const current = ++attempt; status('Opening your room…'); render();
  try {
    const Peer = solo ? null : await loadPeerJS(); if (current !== attempt) return;
    const Session = solo ? SoloSession : GameRoom;
    const nextRoom = new Session({ Peer, game: createBoggleGame({ solo }), appVersion: document.documentElement.dataset.appVersion ?? 'development',
      onView: next => { if (room === nextRoom) receive(next); }, onStatus: text => { if (room === nextRoom) status(text); },
      onError: text => { if (room === nextRoom) { const wordError = Boolean(pendingWord); clearPending(); if (wordError) feedback(text, true); else toast(text); render(); } },
      onEnded: text => { if (room === nextRoom) { stopWorker(); clearPending(); ui.preparing = false; screen = 'disconnected'; ui.error = text; render(); } },
      onChat: (snapshot, requestId) => { if (room === nextRoom) chat.update(snapshot, requestId); },
      onChatError: (text, requestId) => { if (room === nextRoom) chat.fail(text, requestId); },
    });
    room = nextRoom;
    if (!solo && ui.joining) await nextRoom.join(name, code); else await nextRoom.create(name);
    if (current !== attempt) { nextRoom.close(); return; }
    status(solo ? 'Solo practice · your own pace, your own words' : 'Connected · words are better together');
    try { localStorage.setItem('multiplayer:name', name); } catch { /* Optional storage. */ }
    if (testWarning && !solo) toast(MULTIPLAYER_TEST_WARNING);
  } catch (error) {
    if (current !== attempt) return;
    room?.close(); room = null; view = null; screen = 'error'; ui.error = error.message; render();
  }
}
function leave() {
  attempt++; stopWorker(); room?.close(); room = null; view = null; clearPending(); chat.reset(); sound.stop();
  Object.assign(ui, { error: '', preparing: false, settingsDraft: null, draft: '', path: [], feedback: '', resultWord: null, expired: false }); drag = null;
  screen = 'home'; $('chat-section').open = false; history.replaceState(null, '', inviteURL(false)); status('Good words. Good company.'); render();
}
function submitWord() {
  if (view?.phase !== 'playing' || ui.pending || performance.now() >= roundDeadline) return;
  const word = normalizeWord(ui.draft);
  if (!isWord(word)) { feedback('Use letters only, keeping Polish accents.', true); render(); return; }
  if (word.length < view.settings.minLength) { feedback(`Use at least ${view.settings.minLength} letters.`, true); render(); return; }
  if (view.myWords.includes(word)) { feedback('You already found that word.', true); render(); return; }
  sound.unlock(); pendingWord = word; action('SUBMIT', { word, round: view.roundSerial });
}
function selectTile(index) {
  if (view?.phase !== 'playing' || ui.pending || ui.expired || !Number.isInteger(index) || !view.board[index]) return;
  const path = [...ui.path];
  if (path.length > 1 && index === path.at(-2)) path.pop();
  else if (!path.includes(index) && (!path.length || neighbors(view.settings.size)[path.at(-1)].includes(index))) path.push(index);
  else return;
  ui.path = path; ui.draft = path.map(tile => view.board[tile]).join(''); feedback(''); render();
}
function dialog(content) { $('dialog-content').replaceChildren(content); $('dialog').showModal(); }
async function handle(name, node) {
  sound.unlock();
  switch (name) {
    case 'switch-mode': ui.joining = !ui.joining; ui.error = ''; render(); break;
    case 'copy-invite': try { await navigator.clipboard.writeText(inviteURL()); toast('Invite link copied.'); } catch { $('invite-link').select(); toast('Select and copy the invitation.'); } break;
    case 'start': await startRound('START_GAME'); break;
    case 'next-round': await startRound('NEXT_HAND'); break;
    case 'ready': send('SET_READY', { ready: !view.me.ready }); break;
    case 'play-again': send('PLAY_AGAIN'); break;
    case 'return-lobby': send('RETURN_TO_LOBBY'); break;
    case 'clear-word': ui.path = []; ui.draft = ''; feedback(''); render(); focusWordInput(); break;
    case 'show-path': ui.resultWord = node.dataset.word; render(); break;
    case 'rules': dialog(renderRules()); break;
    case 'close-dialog': $('dialog').close(); break;
    case 'about': $('about-dialog').showModal(); window.MoDITAds?.setVisible($('boggle-ad'), true); break;
    case 'close-about': $('about-dialog').close(); break;
    case 'toggle-sound': sound.setEnabled(!sound.enabled); render(); break;
    case 'toggle-mobile-typing': ui.mobileTyping = !ui.mobileTyping; try { localStorage.setItem('boggle:mobile-typing', ui.mobileTyping ? 'on' : 'off'); } catch { /* Optional. */ } render(); if (ui.mobileTyping) focusWordInput(); break;
    case 'leave': dialog(el('div', {}, el('h2', {}, room?.isSolo ? 'End practice?' : 'Leave the room?'), el('p', {}, room?.isSolo ? 'Leaving ends this practice session.' : room?.isHost ? 'Leaving closes the room for everyone.' : 'Leaving stops this game for everyone.'), button(room?.isSolo ? 'END PRACTICE' : 'LEAVE ROOM', 'confirm-leave', { class: 'button primary' }), button('STAY', 'close-dialog', { class: 'button secondary' }))); break;
    case 'confirm-leave': $('dialog').close(); leave(); break;
    case 'home': leave(); break;
  }
}
document.addEventListener('click', event => {
  const tile = event.target.closest('[data-tile]');
  if (tile && event.detail === 0 && !tile.disabled) { selectTile(Number(tile.dataset.tile)); return; }
  const node = event.target.closest('[data-action]');
  if (node && !node.disabled) void handle(node.dataset.action, node);
});
document.addEventListener('submit', event => {
  const form = event.target, kind = form.dataset.form; if (!kind) return;
  event.preventDefault();
  if (kind === 'connect') void connect(form, event.submitter?.value === 'solo');
  else if (kind === 'word') submitWord();
  else if (kind === 'settings') {
    const data = new FormData(form);
    action('SETTINGS', { language: data.get('language'), ...Object.fromEntries(['size', 'minLength', 'seconds', 'rounds'].map(key => [key, Number(data.get(key))])) });
  }
});
document.addEventListener('input', event => {
  if (event.target.id === 'your-name') ui.name = event.target.value;
  if (event.target.id === 'room-code-input') ui.code = event.target.value;
  if (event.target.id !== 'word-input' || !view) return;
  ui.draft = event.target.value;
  if (event.isComposing) return;
  const word = normalizeWord(ui.draft);
  ui.path = isWord(word) ? findPath(view.board, view.settings.size, word) ?? [] : [];
  feedback(''); render();
});
document.addEventListener('compositionend', event => {
  if (event.target.id === 'word-input') event.target.dispatchEvent(new Event('input', { bubbles: true }));
});
document.addEventListener('change', event => {
  if (!event.target.closest('#settings-form')) return;
  const form = $('settings-form'), data = new FormData(form);
  ui.settingsDraft = { language: data.get('language'), ...Object.fromEntries(['size', 'minLength', 'seconds', 'rounds'].map(key => [key, Number(data.get(key))])) }; render();
});
document.addEventListener('keydown', event => {
  if ($('dialog').open || $('about-dialog').open) return;
  const input = $('word-input'), editing = document.activeElement?.closest('input,textarea,select,[contenteditable="true"]');
  if (ui.mobileTyping && view?.phase === 'playing' && !ui.pending && !ui.expired && input && !editing && !event.isComposing &&
      /^[a-ząćęłńóśźż]$/iu.test(event.key) && !event.metaKey && ((!event.ctrlKey && !event.altKey) || event.getModifierState('AltGraph'))) {
    event.preventDefault(); input.focus({ preventScroll: true });
    input.setRangeText(event.key, input.selectionStart, input.selectionEnd, 'end');
    input.dispatchEvent(new Event('input', { bubbles: true })); return;
  }
  if (event.key === 'Escape' && !ui.pending && (ui.draft || ui.path.length)) { ui.path = []; ui.draft = ''; feedback(''); render(); }
});
document.addEventListener('pointerdown', event => {
  const tile = event.target.closest('[data-tile]');
  if (!tile || tile.disabled || !event.isPrimary || event.button !== 0 || ui.pending || view?.phase !== 'playing') return;
  event.preventDefault(); sound.unlock();
  if (event.pointerType === 'touch' && document.activeElement?.matches('input, textarea')) document.activeElement.blur();
  drag = { id: event.pointerId, x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, moved: false };
  $('letter-board').setPointerCapture(event.pointerId); selectTile(Number(tile.dataset.tile));
});
function tracePointer(event) {
  if (!drag || event.pointerId !== drag.id) return;
  if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 8) drag.moved = true;
  const coalesced = event.getCoalescedEvents?.(), samples = coalesced?.length ? coalesced : [event];
  const spacing = Math.max(8, $('letter-board').getBoundingClientRect().width / view.settings.size / 3);
  for (const sample of samples) {
    const fromX = drag.lastX, fromY = drag.lastY;
    const steps = Math.min(256, Math.max(1, Math.ceil(Math.hypot(sample.clientX - fromX, sample.clientY - fromY) / spacing)));
    // Mobile browsers can deliver a fast swipe with several tiles between events.
    for (let step = 1; step <= steps; step++) {
      const tile = document.elementFromPoint(fromX + (sample.clientX - fromX) * step / steps, fromY + (sample.clientY - fromY) * step / steps)?.closest('[data-tile]');
      if (tile && !tile.disabled) selectTile(Number(tile.dataset.tile));
    }
    drag.lastX = sample.clientX; drag.lastY = sample.clientY;
  }
}
document.addEventListener('pointermove', tracePointer);
document.addEventListener('pointerup', event => {
  if (!drag || event.pointerId !== drag.id) return;
  tracePointer(event);
  const submit = drag.moved; drag = null;
  if (submit && ui.draft.length >= (view?.settings.minLength ?? 3)) submitWord();
});
document.addEventListener('pointercancel', () => { drag = null; });
addEventListener('orientationchange', () => { drag = null; });
document.addEventListener('visibilitychange', () => { if (document.hidden) drag = null; else tick(); });
$('about-dialog').addEventListener('close', () => window.MoDITAds?.setVisible($('boggle-ad'), false));
addEventListener('pagehide', () => { stopWorker(); room?.close(); });
function tick() {
  if (!view) return;
  const remaining = Math.max(0, roundDeadline - performance.now()), seconds = Math.ceil(remaining / 1000);
  if ($('countdown-number')) $('countdown-number').textContent = String(Math.max(1, seconds));
  if ($('round-clock')) {
    $('round-clock').textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    $('round-clock').parentElement.classList.toggle('clock-low', seconds <= 15);
  }
  if (view.phase === 'playing' && !remaining && !ui.expired) { ui.expired = true; feedback('Time’s up. Waiting for the host’s results.'); drag = null; render(); }
  ui.nextLocked = performance.now() < nextDeadline;
  const next = document.querySelector('.next-round');
  if (next) {
    next.disabled = ui.pending || ui.preparing || ui.nextLocked;
    next.textContent = ui.preparing ? 'PREPARING…' : ui.nextLocked ? `TAKE A BREATH · ${Math.ceil((nextDeadline - performance.now()) / 1000)}` : next.dataset.nextLabel;
  }
}
setInterval(tick, 100); render();
