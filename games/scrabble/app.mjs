import { GameRoom } from '../../shared/room.mjs';
import { SoloSession } from '../boggle/solo-session.mjs';
import { loadPeerJS } from '../../shared/peer-loader.mjs';
import { normalizeRoomCode, isValidRoomCode, validateName, randomInt } from '../../shared/random.mjs';
import { el, button, patchChildren } from '../../shared/dom.mjs';
import { ChatPanel } from '../../shared/chat-ui.mjs';
import { GameSound } from '../../shared/sound.mjs';
import { createScrabbleGame } from './game-core.mjs';
import { loadDictionary } from './dictionary.mjs';
import { draftMove } from './editor.mjs';
import { evaluateMove } from './rules.mjs';
import { coordinate, shuffle } from './constants.mjs';
import { renderHome, renderLobby, renderGame, renderRules } from './ui.mjs';

const $ = id => document.getElementById(id), params = new URLSearchParams(location.search), sound = new GameSound();
const ui = { name: '', joining: params.has('room'), code: normalizeRoomCode(params.get('room')).slice(0,8), error: '', pending: false, loading: false,
  dictionary: null, dictionaryError: '', settingsDraft: null, customClock: false, start: null, vertical: false, draft: '', blankSquares: [], preview: { placements: [], cells: [] },
  rackOrder: [], exchange: false, exchangeIds: [], feedback: '', feedbackError: false, expired: false };
try { ui.name = localStorage.getItem('multiplayer:name') ?? ''; } catch { /* Optional storage. */ }
let room = null, view = null, screen = 'home', attempt = 0, dictionaryRequest = 0, dictionaryLanguage = null, deadline = null, pendingTimer, toastTimer;
const chat = new ChatPanel((text,id) => room?.sendChat?.(text,id)); $('chat-root').append(chat.element);
chat.empty.replaceChildren('No messages.'); chat.input.placeholder = 'Message';
chat.element.querySelector('.chat-heading').replaceChildren(el('h2', {id:'chat-title'}, 'Room chat'));
const inviteURL = (includeRoom = true) => { const url = new URL(location.origin + location.pathname); if (includeRoom && room && !room.isSolo) url.searchParams.set('room',room.roomCode); return url.href; };
function toast(text) { $('toast').textContent = text; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; },6000); }
function clearPending() { ui.pending = false; clearTimeout(pendingTimer); }
function resetDraft() { Object.assign(ui, { start: null, draft: '', blankSquares: [], exchange: false, exchangeIds: [], feedback: '', feedbackError: false }); }
function preview() {
  if (!view || view.phase === 'lobby') return;
  ui.preview = draftMove(view.board, view.rack, ui.start, ui.vertical, ui.draft, view.settings.language, ui.blankSquares);
  if (!ui.draft || ui.preview.error || !ui.preview.placements.length) return;
  try { ui.preview.scored = evaluateMove(view.board,view.rack,ui.preview.placements,view.settings.language,ui.dictionary); }
  catch(error) { ui.preview.error = error.message; }
}
function render() {
  $('boot').hidden = true; document.body.dataset.screen = screen; preview();
  let content;
  if (screen === 'home') content = renderHome(ui);
  else if (screen === 'connecting') content = el('section', { class: 'panel home' }, el('h1', {}, 'Connecting…'), el('p', { id: 'connecting-detail', role: 'status' }, 'Opening game room…'), button('Cancel','home'));
  else if (screen === 'error' || screen === 'disconnected') content = el('section', { class: 'panel home' }, el('h1', {}, screen === 'error' ? 'Unable to connect' : 'Game disconnected'), el('p', { role: 'alert' }, ui.error),
    view?.me.host && view.phase === 'disconnected' ? button('Return to lobby','return-lobby') : button('Back','home'));
  else content = view.phase === 'lobby' ? renderLobby(view,room.roomCode,inviteURL(),ui) : renderGame(view,ui);
  patchChildren($('main'),content);
  const input = $('word-input');
  if (input && input.value !== ui.draft) {
    const { selectionStart, selectionEnd } = input;
    input.value = ui.draft;
    input.setSelectionRange(Math.min(selectionStart ?? ui.draft.length,ui.draft.length),Math.min(selectionEnd ?? ui.draft.length,ui.draft.length));
  }
  const settings = $('settings-form');
  if (settings) { const values = ui.settingsDraft ?? view.settings; settings.elements.language.value = values.language; settings.elements.clock.value = String(ui.customClock ? -1 : values.seconds); settings.elements.seconds.value = String(values.seconds || 60); }
  const connected = Boolean(room && view && !['home','connecting','error'].includes(screen));
  $('leave').hidden = !connected; $('chat-section').hidden = !connected || Boolean(view?.solo);
  chat.setConnected(connected && !view?.solo && screen !== 'disconnected',view?.me.id);
  $('sound-toggle').textContent = sound.enabled ? 'Sound on' : 'Sound off'; $('sound-toggle').setAttribute('aria-pressed',String(sound.enabled));
  tick();
}
async function ensureDictionary(language, force = false) {
  if (!force && dictionaryLanguage === language) return;
  dictionaryLanguage = language; const request = ++dictionaryRequest, current = room;
  ui.dictionary = null; ui.dictionaryError = ''; ui.loading = true; render();
  try {
    const dictionary = await loadDictionary(language);
    if (request !== dictionaryRequest || room !== current) return;
    ui.dictionary = dictionary; room?.game.stageDictionary(dictionary,language);
  } catch(error) { if (request === dictionaryRequest && room === current) { ui.dictionaryError = error.message; toast(error.message); } }
  finally { if (request === dictionaryRequest && room === current) { ui.loading = false; render(); } }
}
function receive(next) {
  const previous = view, turnChanged = previous?.turnSerial !== next.turnSerial || previous?.phase !== next.phase;
  const typing = document.activeElement?.id === 'word-input';
  view = next; clearPending(); deadline = next.remainingMs === null ? null : performance.now() + next.remainingMs;
  ui.expired = false;
  ui.rackOrder = [...ui.rackOrder.filter(id => next.rack.some(t => t.id === id)),...next.rack.filter(t => !ui.rackOrder.includes(t.id)).map(t => t.id)];
  if (turnChanged) { resetDraft(); $('dialog').close(); if (previous?.phase === 'playing' && next.history.at(-1)?.kind === 'play') sound.play('card'); }
  if (ui.settingsDraft && ui.settingsDraft.language === next.settings.language && ui.settingsDraft.seconds === next.settings.seconds) ui.settingsDraft = null;
  if (!ui.settingsDraft) ui.customClock = ![0,30,60,120,180].includes(next.settings.seconds);
  screen = next.phase === 'disconnected' ? 'disconnected' : next.phase === 'lobby' ? 'lobby' : 'game';
  if (next.phase === 'disconnected') ui.error = `${next.disconnectedNames.join(', ')} disconnected. The host can reopen the lobby.`;
  if (next.phase === 'game_result' && previous?.phase !== 'game_result' && next.result.winnerIds.includes(next.me.id)) sound.play('victory');
  if (turnChanged) $('announcer').textContent = next.phase === 'playing' ? next.myTurn ? 'Your turn.' : `${next.players.find(p => p.id === next.turnId).name}’s turn.` : next.phase === 'game_result' ? 'Game complete.' : '';
  history.replaceState(null,'',inviteURL()); render();
  void ensureDictionary(next.settings.language);
  if (typing && !turnChanged && next.myTurn) focusInput();
}
function focusInput() { if (view?.myTurn && !ui.expired && !$('dialog').open) $('word-input')?.focus({preventScroll:true}); }
function send(type,payload = {}) {
  if (!room || ui.pending) return;
  sound.unlock(); ui.pending = true; ui.feedback = ''; ui.feedbackError = false;
  pendingTimer = setTimeout(() => { clearPending(); toast('Still waiting for the host. Check your connection.'); render(); },12000);
  render(); room.act(type,payload);
}
const action = (name,payload = {}) => send('SCRABBLE_ACTION',{ action: name, turn: view.turnSerial, ...payload });
function dialog(content) { $('dialog-content').replaceChildren(content); if (!$('dialog').open) $('dialog').showModal(); }
function confirm(text,label,actionName) { dialog(el('div', {}, el('h2', {},text), el('div', {class:'actions'}, button(label,actionName,{class:'button primary'}),button('Cancel','close-dialog')))); }
async function connect(form,solo) {
  let name,code;
  try { const data = new FormData(form); name = validateName(data.get('name')); code = normalizeRoomCode(data.get('room')); if (!solo && ui.joining && !isValidRoomCode(code)) throw new Error('Enter the 8-character room code.'); }
  catch(error) { ui.error = error.message; render(); return; }
  ui.name = name; ui.code = code; ui.error = ''; screen = 'connecting'; const current = ++attempt; render();
  try {
    const Peer = solo ? null : await loadPeerJS(); if (attempt !== current) return;
    const Session = solo ? SoloSession : GameRoom;
    const nextRoom = new Session({ Peer, game: createScrabbleGame({solo}), appVersion: document.documentElement.dataset.appVersion ?? 'development',
      onView: next => { if (room === nextRoom) receive(next); }, onStatus: text => { if (room === nextRoom && $('connecting-detail')) $('connecting-detail').textContent = text; },
      onError: text => { if (room === nextRoom) { clearPending(); ui.feedback = text; ui.feedbackError = true; toast(text); render(); } },
      onEnded: text => { if (room === nextRoom) { clearPending(); screen = 'disconnected'; ui.error = text; render(); } },
      onChat: (snapshot,id) => { if (room === nextRoom) chat.update(snapshot,id); }, onChatError: (text,id) => { if (room === nextRoom) chat.fail(text,id); },
    });
    room = nextRoom; if (!solo && ui.joining) await room.join(name,code); else await room.create(name);
    if (current !== attempt) { nextRoom.close(); return; }
    try { localStorage.setItem('multiplayer:name',name); } catch { /* Optional storage. */ }
  } catch(error) { if (current !== attempt) return; const old = room; room = null; old?.close(); view = null; screen = 'error'; ui.error = error.message; render(); }
}
function leave() {
  attempt++; dictionaryRequest++; const previous = room; room = null; previous?.close(); view = null; clearPending(); chat.reset(); sound.stop();
  dictionaryLanguage = null; Object.assign(ui,{ dictionary:null,loading:false,dictionaryError:'',settingsDraft:null,error:'',rackOrder:[] }); resetDraft();
  screen = 'home'; $('dialog').close(); history.replaceState(null,'',inviteURL(false)); render();
}
function submitWord() {
  if (!view?.myTurn || ui.pending || ui.expired || ui.exchange) return;
  preview(); if (ui.preview.error || !ui.preview.scored || !ui.dictionary) { toast(ui.preview.error || 'Choose a square and enter a valid word.'); return; }
  action('PLAY',{placements:ui.preview.placements});
}
function showBlanks() {
  const rows = ui.preview.placements.map(p => {
    const blank = !view.rack.find(t => t.id === p.tileId).letter;
    return el('div', {class:'blank-row'},el('strong', {},`${coordinate(p.index)} · ${p.letter.toUpperCase()}`),
      button(ui.blankSquares.includes(p.index) ? 'Use automatic choice' : blank ? 'Automatic blank' : 'Use blank', 'blank-toggle', { 'data-index':p.index, 'data-blank':String(ui.blankSquares.includes(p.index)), disabled:!ui.blankSquares.includes(p.index) && (blank || !view.rack.some(t => !t.letter)) }));
  });
  dialog(el('div', {},el('h2', {},'Blank tiles'),el('p', {class:'muted'},'A dot marks a blank. Its value remains zero.'),...rows));
}
async function handle(name,node) {
  sound.unlock();
  switch(name) {
    case 'switch-mode': ui.joining = !ui.joining; ui.error = ''; render(); break;
    case 'home': leave(); break;
    case 'copy-invite': try { await navigator.clipboard.writeText(inviteURL()); toast('Invite link copied.'); } catch { $('invite-link')?.select(); toast('Select and copy the invite link.'); } break;
    case 'start': if (ui.dictionary && !ui.settingsDraft) send('START_GAME'); break;
    case 'ready': if (!ui.loading && ui.dictionary) send('SET_READY',{ready:!view.me.ready}); break;
    case 'square': {
      const index = Number(node.dataset.index);
      if (ui.start === index) ui.vertical = !ui.vertical; else ui.start = index;
      ui.blankSquares = []; ui.feedback = ''; ui.exchange = false; ui.exchangeIds = []; render(); focusInput(); break;
    }
    case 'direction': ui.vertical = !ui.vertical; ui.blankSquares = []; render(); focusInput(); break;
    case 'clear': resetDraft(); render(); break;
    case 'blanks': showBlanks(); break;
    case 'blank-toggle': {
      const index = Number(node.dataset.index);
      ui.blankSquares = node.dataset.blank === 'true' ? ui.blankSquares.filter(i => i !== index) : [...new Set([...ui.blankSquares,index])];
      render(); showBlanks(); break;
    }
    case 'rack-tile': {
      const id = node.dataset.tileId;
      if (ui.exchange) ui.exchangeIds = ui.exchangeIds.includes(id) ? ui.exchangeIds.filter(i => i !== id) : [...ui.exchangeIds,id];
      else if (view.myTurn && !ui.pending && !ui.expired) {
        const tile = view.rack.find(t => t.id === id);
        if (tile.letter) { ui.draft = (ui.draft + tile.letter).slice(0,15); ui.feedback = ''; }
        else toast('Type the letter the blank will represent, then use Blanks if needed.');
      }
      render(); if (!ui.exchange) focusInput(); break;
    }
    case 'shuffle': ui.rackOrder = shuffle(ui.rackOrder,randomInt); render(); break;
    case 'exchange': resetDraft(); ui.exchange = true; render(); break;
    case 'cancel-exchange': ui.exchange = false; ui.exchangeIds = []; render(); break;
    case 'confirm-exchange': action('EXCHANGE',{tileIds:ui.exchangeIds}); break;
    case 'pass': confirm('Pass this turn?','Pass','confirm-pass'); break;
    case 'confirm-pass': $('dialog').close(); action('PASS'); break;
    case 'end-practice': confirm('End practice?','End practice','confirm-end'); break;
    case 'confirm-end': $('dialog').close(); action('END_PRACTICE'); break;
    case 'play-again': send('PLAY_AGAIN'); break;
    case 'return-lobby': send('RETURN_TO_LOBBY'); break;
    case 'retry-dictionary': await ensureDictionary(view.settings.language,true); break;
    case 'rules': dialog(renderRules()); break;
    case 'about': dialog(el('div', {},el('h2', {},'Scrabble'),el('p', {},'An independent browser word game. Not affiliated with Mattel or Hasbro.'),el('p', {},'Game dictionaries: Polish SGJP; English SCOWL/ESDB (UK + US). These are not official tournament word lists.'),
      el('p', {},el('a', {href:'../boggle/data/README.md'},'Dictionary sources and filtering'),' · ',el('a', {href:'../boggle/data/LICENSE-SGJP.txt'},'SGJP license'),' · ',el('a', {href:'../boggle/data/LICENSE-ESDB.txt'},'SCOWL/ESDB licenses')))); break;
    case 'close-dialog': $('dialog').close(); focusInput(); break;
    case 'toggle-sound': sound.setEnabled(!sound.enabled); render(); break;
    case 'leave': confirm(room?.isSolo ? 'End this session?' : room?.isHost ? 'Close the room for everyone?' : 'Leave the room?','Leave','confirm-leave'); break;
    case 'confirm-leave': leave(); break;
  }
}
document.addEventListener('click',event => { const node = event.target.closest('[data-action]'); if (node && !node.disabled) void handle(node.dataset.action,node); });
document.addEventListener('submit',event => {
  const kind = event.target.dataset.form; if (!kind) return; event.preventDefault();
  if (kind === 'connect') void connect(event.target,event.submitter?.value === 'solo');
  else if (kind === 'word') submitWord();
  else if (kind === 'settings' && ui.settingsDraft) send('SCRABBLE_ACTION',{ action:'SETTINGS', ...ui.settingsDraft });
});
function settingsChanged(form) {
  const data = new FormData(form), clock = Number(data.get('clock')); ui.customClock = clock === -1;
  ui.settingsDraft = { language:data.get('language'),seconds:ui.customClock ? Number(form.elements.seconds.value) : clock }; render();
}
document.addEventListener('input',event => {
  if (event.target.id === 'your-name') ui.name = event.target.value;
  if (event.target.id === 'room-code') ui.code = event.target.value;
  if (event.target.id === 'word-input') { ui.draft = event.target.value.normalize('NFC').toLowerCase(); ui.feedback = ''; ui.feedbackError = false; if (!event.isComposing) render(); }
  if (event.target.closest('#settings-form') && event.target.name === 'seconds') settingsChanged(event.target.form);
});
document.addEventListener('change',event => { if (event.target.closest('#settings-form') && event.target.tagName === 'SELECT') settingsChanged(event.target.form); });
document.addEventListener('compositionend',event => { if (event.target.id === 'word-input') { ui.draft = event.target.value.normalize('NFC').toLowerCase(); render(); } });
document.addEventListener('keydown',event => {
  if (event.target.id !== 'word-input' || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key === 'Escape') { event.preventDefault(); resetDraft(); render(); }
  else if (event.key === ' ') { event.preventDefault(); ui.vertical = !ui.vertical; ui.blankSquares = []; render(); }
});
function tick() {
  const clock = $('turn-clock'); if (!clock || deadline === null || view?.phase !== 'playing') return;
  const remaining = Math.max(0,deadline-performance.now()), seconds = Math.ceil(remaining/1000);
  clock.textContent = `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`; clock.classList.toggle('urgent',seconds<=10);
  if (!remaining && !ui.expired) { ui.expired = true; $('dialog').close(); render(); }
}
document.addEventListener('visibilitychange',tick);
setInterval(tick,100); render();
