import { GAMES, getGame } from './games/registry.mjs';
import { GameRoom } from './shared/room.mjs';
import { loadPeerJS } from './shared/peer-loader.mjs';
import { normalizeRoomCode, validateName, isValidRoomCode } from './shared/random.mjs';
import { el, button } from './shared/dom.mjs';
import { renderHeader, renderCollection, renderGameHome, renderConnecting, renderConnectionError, renderLobby, renderDisconnected } from './shared/screens.mjs';
import { GameSound } from './shared/sound.mjs';
import { getViewEffects } from './shared/effects.mjs';
import { VictoryCelebration } from './shared/celebration.mjs';

const main = document.querySelector('#main');
const header = document.querySelector('#site-header');
const modal = document.querySelector('#modal');
const modalBody = document.querySelector('#modal-body');
const params = new URLSearchParams(location.search);
const sound = new GameSound();
const celebration = new VictoryCelebration();
let game = getGame(params.get('game'));
let screen = params.has('room') || params.has('game') ? 'game-home' : 'collection';
let code = normalizeRoomCode(params.get('room')).slice(0, 8);
let joining = params.has('room');
let name = '';
try { name = localStorage.getItem('multiplayer:name') ?? ''; } catch { /* Storage is optional. */ }
let room = null;
let view = null;
let status = 'Connecting...';
let pending = false;
let pendingTimer;
let toastTimer;
let attempt = 0;
let lastAttempt;
let errorMessage = '';
let libraryError = false;
let endedHost = false;
let dialogKind = '';
let renderedHand = '';

function inviteLink() {
  const url = new URL(window.location.origin + window.location.pathname);
  url.searchParams.set('room', room.roomCode);
  url.searchParams.set('game', game.id);
  return url.href;
}

function updateURL(inRoom = false) {
  const url = new URL(location.origin + location.pathname);
  if (screen !== 'collection') url.searchParams.set('game', game.id);
  if (inRoom && room) url.searchParams.set('room', room.roomCode);
  if (params.get('debug') === '1') url.searchParams.set('debug', '1');
  history.replaceState(null, '', url);
}

function render() {
  const active = document.activeElement;
  const focusAction = active?.dataset?.action;
  const focusCard = active?.dataset?.cardId;
  const focusBid = active?.dataset?.bid;
  const focusInMain = main.contains(active) || header.contains(active);
  header.replaceChildren(renderHeader({ game: screen === 'collection' ? null : game, room, view, status, soundEnabled: sound.enabled }));
  let content;
  switch (screen) {
    case 'collection': content = renderCollection(GAMES); break;
    case 'game-home': content = renderGameHome(game, { name, code, join: joining }); break;
    case 'connecting': content = renderConnecting(status, Boolean(lastAttempt?.retrying)); break;
    case 'error': content = renderConnectionError(errorMessage, libraryError); break;
    case 'ended': content = renderDisconnected({ reason: errorMessage, host: endedHost }); break;
    case 'room':
      content = view.phase === 'lobby' ? renderLobby(view, room.roomCode, inviteLink(), pending) :
        view.phase === 'disconnected' ? renderDisconnected({ view }) : game.renderGame(view, { pending });
      break;
    default: content = renderCollection(GAMES);
  }
  main.replaceChildren(content);
  const handKey = view ? `${view.handNumber}-${view.phase === 'bidding' ? 'deal' : 'play'}` : '';
  if (view?.phase === 'bidding' && renderedHand !== handKey) main.querySelector('.my-cards')?.classList.add('dealing');
  renderedHand = handKey;
  if (focusInMain && focusAction) {
    const target = [...document.querySelectorAll('[data-action]')].find(node => node.dataset.action === focusAction && node.dataset.cardId === focusCard && node.dataset.bid === focusBid && !node.disabled);
    if (target) target.focus({ preventScroll: true });
  }
  if (dialogKind === 'scoreboard' && modal.open && view) modalBody.replaceChildren(game.renderScoreboard(view));
  const announcement = view ? game.turnAnnouncement(view) : '';
  const announcer = document.querySelector('#announcement');
  if (announcement && announcer.textContent !== announcement) announcer.textContent = announcement;
  document.title = screen === 'collection' ? 'Multiplayer — Good games. Good company.' : `${game.title} — ${view && view.handNumber ? `Hand ${view.handNumber} · ` : ''}Multiplayer`;
}

function showToast(text, error = false) {
  const toast = document.querySelector('#toast');
  toast.textContent = text;
  toast.classList.toggle('toast-error', error);
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, error ? 8000 : 4000);
}

function updateStatus(text) {
  status = text;
  const indicator = document.querySelector('#connection-status span');
  if (indicator) indicator.textContent = text;
  const detail = document.querySelector('#connecting-detail');
  if (detail) detail.textContent = text;
}

function rememberForm() {
  const input = document.querySelector('#your-name');
  if (input) name = input.value;
  const roomInput = document.querySelector('#room-code-input');
  if (roomInput) code = normalizeRoomCode(roomInput.value);
}

function clearPending() { pending = false; clearTimeout(pendingTimer); }

async function connect(mode, retrying = false) {
  rememberForm();
  try {
    name = validateName(name);
    if (mode === 'join' && !isValidRoomCode(code)) throw new Error('Enter the 8-character room code using letters A–Z (except I and O) and numbers 2–9.');
  } catch (error) {
    const message = document.querySelector('#form-error');
    if (message) message.textContent = error.message; else showToast(error.message, true);
    return;
  }
  try { localStorage.setItem('multiplayer:name', name); } catch { /* Storage is optional. */ }
  const token = ++attempt;
  room?.close();
  celebration.cancel();
  sound.stop();
  room = null;
  view = null;
  clearPending();
  status = 'Connecting...';
  screen = 'connecting';
  lastAttempt = { mode, retrying };
  render();
  try {
    const Peer = await loadPeerJS();
    if (token !== attempt) return;
    const session = new GameRoom({
      Peer, game, appVersion: document.documentElement.dataset.appVersion, debug: params.get('debug') === '1',
      onStatus: text => { if (token === attempt) updateStatus(text); },
      onView: next => {
        if (token !== attempt) return;
        const effects = getViewEffects(view, next);
        const oldPhase = view?.phase;
        view = next;
        screen = 'room';
        clearPending();
        updateURL(true);
        render();
        if (oldPhase !== next.phase && ['hand_result', 'game_result', 'disconnected'].includes(next.phase)) {
          main.focus({ preventScroll: true });
          window.scrollTo({ top: 0, behavior: 'instant' });
        }
        if (next.phase !== 'game_result') celebration.cancel();
        for (const effect of effects) {
          if (effect.type === 'card') sound.play('card', effect.own);
          if (effect.type === 'victory') {
            celebration.play(effect.winners, effect.own);
            if (effect.own) sound.play('victory');
          }
        }
      },
      onError: text => { if (token === attempt) { clearPending(); render(); showToast(text, true); } },
      onEnded: text => {
        if (token !== attempt) return;
        clearPending();
        celebration.cancel();
        sound.stop();
        endedHost = Boolean(room?.isHost);
        room = null;
        view = null;
        screen = 'ended';
        errorMessage = text;
        closeDialog();
        render();
      },
    });
    room = session;
    if (mode === 'create') await session.create(name); else await session.join(name, code);
  } catch (error) {
    if (token !== attempt) return;
    room?.close();
    room = null;
    view = null;
    errorMessage = error.message;
    libraryError = error.code === 'LIBRARY_UNAVAILABLE';
    screen = 'error';
    render();
  }
}

function act(type, payload = {}) {
  if (pending || !room) return;
  pending = true;
  render();
  pendingTimer = setTimeout(() => {
    clearPending();
    render();
    showToast('Still waiting for the host. Check your connection before trying again.', true);
  }, 12000);
  room.act(type, payload);
}

function openDialog(title, content, kind) {
  document.querySelector('#modal-title').textContent = title;
  modalBody.replaceChildren(content);
  dialogKind = kind;
  if (!modal.open) modal.showModal();
  modal.scrollTop = 0;
}
function closeDialog() { modal.close(); dialogKind = ''; }

function goHome(collection = false) {
  ++attempt;
  room?.close();
  celebration.cancel();
  sound.stop();
  room = null;
  view = null;
  clearPending();
  closeDialog();
  screen = collection ? 'collection' : 'game-home';
  joining = false;
  updateURL();
  render();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function leave(collection = false) {
  if (view && view.phase !== 'lobby') {
    openDialog('Leave this game?', el('div', { class: 'confirm-content' },
      el('p', {}, room.isHost ? 'Leaving will end the game for everyone.' : 'Leaving will stop this game for everyone. The host can return the remaining players to the lobby.'),
      el('div', { class: 'confirm-actions' }, button('STAY AT THE TABLE', 'close-modal', { class: 'button primary', autofocus: true }),
        button('LEAVE GAME', collection ? 'confirm-collection' : 'confirm-leave', { class: 'button danger' }))), 'confirm');
  } else goHome(collection);
}

document.addEventListener('submit', event => {
  if (event.target.id !== 'entry-form') return;
  event.preventDefault();
  sound.unlock();
  void connect(event.target.dataset.mode);
});

document.addEventListener('pointerdown', () => sound.unlock(), { passive: true });

document.addEventListener('click', async event => {
  const target = event.target.closest('[data-action]');
  if (!target || target.disabled) return;
  const action = target.dataset.action;
  switch (action) {
    case 'toggle-sound': sound.setEnabled(!sound.enabled); render(); showToast(sound.enabled ? 'Sounds on.' : 'Sounds muted.'); break;
    case 'select-game': game = getGame(target.dataset.game); screen = 'game-home'; joining = false; updateURL(); render(); window.scrollTo({ top: 0 }); break;
    case 'collection': rememberForm(); leave(true); break;
    case 'home': goHome(); break;
    case 'show-join': rememberForm(); joining = true; render(); document.querySelector(name ? '#room-code-input' : '#your-name').focus(); break;
    case 'show-create': rememberForm(); joining = false; render(); break;
    case 'cancel-connect': goHome(); break;
    case 'retry': await connect(lastAttempt?.mode ?? 'join', true); break;
    case 'reload': location.reload(); break;
    case 'rules': openDialog(`How to play ${game.title}`, game.renderRules(), 'rules'); break;
    case 'scoreboard': if (view) openDialog('Scoreboard', game.renderScoreboard(view), 'scoreboard'); break;
    case 'close-modal': closeDialog(); break;
    case 'leave': leave(); break;
    case 'confirm-leave': goHome(); break;
    case 'confirm-collection': goHome(true); break;
    case 'copy-invite': {
      if (!room) break;
      const link = inviteLink();
      try {
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(link);
        showToast('Invite link copied. Send it to your friends.');
      } catch {
        const input = document.querySelector('#invite-link');
        input?.focus(); input?.select(); input?.setSelectionRange(0, input.value.length);
        showToast('Select and copy the invite link below the room code.');
      }
      break;
    }
    case 'select-invite': { const input = document.querySelector('#invite-link'); input.focus(); input.select(); input.setSelectionRange(0, input.value.length); break; }
    case 'ready': act('SET_READY', { ready: !view.me.ready }); break;
    case 'start': act('START_GAME'); break;
    case 'bid': act('PLACE_BID', { bid: Number(target.dataset.bid) }); break;
    case 'play-card': act('PLAY_CARD', { cardId: target.dataset.cardId }); break;
    case 'play-blind': act('PLAY_BLIND_CARD'); break;
    case 'next-hand': act('NEXT_HAND'); break;
    case 'play-again': act('PLAY_AGAIN'); break;
    case 'return-lobby': act('RETURN_TO_LOBBY'); break;
  }
});

modal.addEventListener('close', () => { dialogKind = ''; });
modal.addEventListener('click', event => { if (event.target === modal) { const rect = modal.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeDialog(); } });
window.addEventListener('beforeunload', event => {
  if (room && view && !['lobby', 'game_result', 'disconnected'].includes(view.phase)) { event.preventDefault(); event.returnValue = ''; }
});
window.addEventListener('pagehide', () => { room?.close(); celebration.cancel(); sound.stop(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) sound.stop(); });
window.addEventListener('pageshow', event => { if (event.persisted) { goHome(screen === 'collection'); location.reload(); } });

render();
