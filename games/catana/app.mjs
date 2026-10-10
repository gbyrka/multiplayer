import { GameRoom } from '../../shared/room.mjs';
import { loadPeerJS, checkMultiplayerSupport, MULTIPLAYER_TEST_WARNING } from '../../shared/peer-loader.mjs';
import { normalizeRoomCode, validateName, isValidRoomCode } from '../../shared/random.mjs';
import { el, button, patchChildren } from '../../shared/dom.mjs';
import { renderConnecting, renderConnectionError, renderDisconnected } from '../../shared/screens.mjs';
import { ChatPanel } from '../../shared/chat-ui.mjs';
import { GameSound } from '../../shared/sound.mjs';
import { catanaGame } from './game-core.mjs';
import { RESOURCES, resourceBag, resourceCount } from './constants.mjs';
import { renderHome, renderLobby, renderGame, renderRules, turnAnnouncement } from './ui.mjs';

const $ = id => document.getElementById(id), params = new URLSearchParams(location.search), sound = new GameSound();
let room = null, view = null, pending = false, pendingTimer, attempt = 0, screen = 'home', connectionStatus = 'An island for good company.', endedReason = '', toastTimer;
const ui = { joining: params.has('room'), code: normalizeRoomCode(params.get('room')).slice(0, 8), name: '', error: '', panel: 'build', buildMode: 'road', selection: null, resourceDraft: resourceBag(), tradeDraft: { give: resourceBag(), want: resourceBag(), target: '' } };
try { ui.name = localStorage.getItem('multiplayer:name') ?? ''; } catch { /* Storage is optional. */ }
const chat = new ChatPanel((text, requestId) => room?.sendChat(text, requestId)); $('chat-root').append(chat.element);
const support = { error: null, testMode: false };
void checkMultiplayerSupport().then(connected => { support.testMode = !connected; }, error => {
  support.error = error.message; ui.error = error.message; if (screen === 'home') render();
});

function inviteURL(inRoom = true) {
  const url = new URL(location.origin + location.pathname); if (inRoom && room) url.searchParams.set('room', room.roomCode); return url.href;
}
function toast(text) {
  $('toast').textContent = text; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 6000);
}
function status(text) { connectionStatus = text; $('connection-status').textContent = text; if ($('connecting-detail')) $('connecting-detail').textContent = text; }
function render() {
  $('boot').hidden = true;
  const node = screen === 'home' ? renderHome(ui) : screen === 'connecting' ? renderConnecting(connectionStatus, false) :
    screen === 'error' ? renderConnectionError(endedReason) : screen === 'disconnected' ? renderDisconnected({ view: view?.phase === 'disconnected' ? view : null, reason: endedReason, host: room?.isHost }) :
    view?.phase === 'lobby' ? renderLobby(view, room.roomCode, inviteURL(), pending) : renderGame(view, ui, pending);
  patchChildren($('main'), node);
  if (ui.reviewResult) $('main').querySelector('.result-overlay')?.remove();
  $('leave').hidden = !room || screen === 'connecting';
  $('sound-toggle').textContent = sound.enabled ? 'SOUND ON' : 'SOUND OFF'; $('sound-toggle').setAttribute('aria-pressed', String(sound.enabled));
  $('chat-container').hidden = !room || !view || ['home', 'error', 'connecting'].includes(screen);
  chat.setConnected(Boolean(room && view && screen !== 'disconnected'), view?.me.id);
  window.MoDITAds?.setVisible($('catana-ad'), ['home', 'game'].includes(screen));
  if (view) $('announcer').textContent = view.phase === 'lobby' ? `${view.players.length} players in the lobby.` : turnAnnouncement(view);
}
function clearPending() { pending = false; clearTimeout(pendingTimer); }
function receive(next) {
  const previous = view; view = next; clearPending(); ui.selection = null;
  if (previous?.phase !== next.phase) ui.resourceDraft = resourceBag();
  if (next.phase === 'setup_settlement' && previous?.phase !== 'setup_road') { ui.reviewResult = false; ui.inspectedHex = undefined; }
  screen = next.phase === 'disconnected' ? 'disconnected' : next.phase === 'lobby' ? 'lobby' : 'game';
  history.replaceState(null, '', inviteURL());
  if (previous && next.log.at(-1)?.text !== previous.log.at(-1)?.text && !['lobby', 'disconnected'].includes(next.phase)) sound.play('card');
  if (next.phase === 'game_result' && previous?.phase !== 'game_result' && next.winnerId === next.me.id) sound.play('victory');
  render();
}
function send(type, payload = {}) {
  if (pending || !room) return;
  pending = true; render();
  pendingTimer = setTimeout(() => { clearPending(); toast('Still waiting for the host. Check your connection.'); render(); }, 12000);
  room.act(type, payload);
}
const action = (name, payload = {}) => send('CATANA_ACTION', { action: name, ...payload });

async function connect(form) {
  if (support.error) { ui.error = support.error; render(); return; }
  let name, code;
  try { name = validateName(new FormData(form).get('name')); code = normalizeRoomCode(new FormData(form).get('room')); if (ui.joining && !isValidRoomCode(code)) throw new Error('Enter the 8-character room code.'); }
  catch (error) { ui.error = error.message; render(); return; }
  ui.name = name; ui.code = code; ui.error = ''; const currentAttempt = ++attempt; screen = 'connecting'; status('Opening the room…'); render();
  try {
    const Peer = await loadPeerJS(); if (currentAttempt !== attempt) return;
    const currentRoom = new GameRoom({ Peer, game: catanaGame, appVersion: document.documentElement.dataset.appVersion ?? 'development',
      onView: next => { if (room === currentRoom) receive(next); }, onStatus: text => { if (room === currentRoom) status(text); },
      onError: text => { if (room !== currentRoom) return; clearPending(); toast(text); render(); },
      onEnded: reason => { if (room !== currentRoom) return; clearPending(); endedReason = reason; screen = 'disconnected'; chat.setConnected(false); render(); },
      onChat: (snapshot, requestId) => { if (room === currentRoom) chat.update(snapshot, requestId); },
      onChatError: (text, requestId) => { if (room === currentRoom) chat.fail(text, requestId); },
    });
    room = currentRoom;
    if (ui.joining) await room.join(name, code); else await room.create(name);
    if (currentAttempt !== attempt) { currentRoom.close(); return; }
    status('Connected · your table is ready'); try { localStorage.setItem('multiplayer:name', name); } catch { /* Optional. */ }
    if (support.testMode) toast(MULTIPLAYER_TEST_WARNING);
  } catch (error) {
    if (currentAttempt !== attempt) return;
    room?.close(); room = null; view = null; endedReason = error.message; screen = 'error'; render();
  }
}
function leave() {
  attempt++; room?.close(); room = null; view = null; clearPending(); chat.reset(); sound.stop(); ui.error = ''; ui.reviewResult = false;
  screen = 'home'; history.replaceState(null, '', inviteURL(false)); status('An island for good company.'); render();
}
function dialog(content) { $('dialog-content').replaceChildren(content); $('dialog').showModal(); }
function captureEntry() { if ($('your-name')) ui.name = $('your-name').value; if ($('room-code-input')) ui.code = $('room-code-input').value; }
async function handleButton(node) {
  const name = node.dataset.action;
  if (!name || node.disabled) return;
  sound.unlock();
  switch (name) {
    case 'rules': dialog(renderRules()); break;
    case 'close-dialog': $('dialog').close(); break;
    case 'leave': dialog(el('div', {}, el('h2', {}, 'Leave the island?'), el('p', {}, room?.isHost ? 'Leaving closes the room for everyone.' : 'Leaving stops this match for the table.'), button('LEAVE ROOM', 'confirm-leave', { class: 'button primary' }))); break;
    case 'confirm-leave': $('dialog').close(); leave(); break;
    case 'home': case 'cancel-connect': leave(); break;
    case 'retry': screen = 'home'; ui.error = ''; render(); break;
    case 'reload': location.reload(); break;
    case 'switch-mode': captureEntry(); ui.joining = !ui.joining; ui.error = ''; render(); break;
    case 'toggle-sound': sound.setEnabled(!sound.enabled); render(); break;
    case 'copy-invite': try { await navigator.clipboard.writeText(inviteURL()); toast('Invite link copied.'); } catch { $('invite-link').select(); toast('Select and copy the invite link.'); } break;
    case 'start': send('START_GAME'); break;
    case 'ready': send('SET_READY', { ready: !view.me.ready }); break;
    case 'return-lobby': send('RETURN_TO_LOBBY'); break;
    case 'play-again': ui.reviewResult = false; send('PLAY_AGAIN'); break;
    case 'review-result': ui.reviewResult = true; render(); break;
    case 'show-result': ui.reviewResult = false; render(); break;
    case 'panel': ui.panel = node.dataset.panel; ui.selection = null; render(); break;
    case 'build-mode': ui.buildMode = node.dataset.kind; ui.selection = null; render(); break;
    case 'trade-mode': ui.tradeMode = node.dataset.mode; render(); break;
    case 'select-road': if (!pending && view.legal.roads.includes(Number(node.dataset.edge))) { ui.selection = { kind: 'road', id: Number(node.dataset.edge) }; render(); } break;
    case 'select-vertex': {
      const kind = view.phase === 'setup_settlement' ? 'settlement' : ui.buildMode;
      const legal = kind === 'city' ? view.legal.cities : view.legal.settlements;
      if (!pending && legal.includes(Number(node.dataset.vertex))) { ui.selection = { kind, id: Number(node.dataset.vertex) }; render(); } break;
    }
    case 'select-hex': if (!pending && view.legal.robberHexes.includes(Number(node.dataset.hex))) { ui.selection = { kind: 'robber', id: Number(node.dataset.hex) }; render(); } break;
    case 'inspect-hex': if (view?.board) { ui.inspectedHex = Number(node.dataset.hex); render(); } break;
    case 'cancel-placement': ui.selection = null; render(); break;
    case 'confirm-placement': if (ui.selection) { const { kind, id } = ui.selection; action({ road: 'BUILD_ROAD', settlement: 'BUILD_SETTLEMENT', city: 'BUILD_CITY', robber: 'MOVE_ROBBER' }[kind], { [{ road: 'edge', settlement: 'vertex', city: 'vertex', robber: 'hex' }[kind]]: id }); } break;
    case 'roll': action('ROLL'); break;
    case 'end-turn': action('END_TURN'); break;
    case 'buy-development': action('BUY_DEVELOPMENT'); break;
    case 'play-development': action('PLAY_DEVELOPMENT', { card: node.dataset.card }); break;
    case 'monopoly': action('CHOOSE_MONOPOLY', { resource: node.dataset.resource }); break;
    case 'steal': action('STEAL', { victim: node.dataset.victim }); break;
    case 'finish-roads': action('FINISH_ROADS'); break;
    case 'accept-trade': action('ACCEPT_TRADE', { offer: view.trade.id }); break;
    case 'cancel-trade': action('CANCEL_TRADE'); break;
    case 'counteroffer': ui.panel = 'trade'; ui.tradeMode = 'offer'; ui.tradeDraft = { give: { ...view.trade.want }, want: { ...view.trade.give }, target: view.trade.proposer }; render(); break;
  }
}
document.addEventListener('click', event => { const node = event.target.closest('[data-action]'); if (node) void handleButton(node); });
document.addEventListener('keydown', event => { if (event.target instanceof SVGElement && ['Enter', ' '].includes(event.key) && event.target.dataset.action) { event.preventDefault(); void handleButton(event.target); } });
document.addEventListener('submit', event => {
  const form = event.target; if (!form.dataset.form) return; event.preventDefault(); sound.unlock();
  const data = new FormData(form), mode = form.dataset.form;
  if (mode === 'connect') { void connect(form); return; }
  if (pending) return;
  if (mode === 'discard' || mode === 'plenty') action(mode === 'discard' ? 'DISCARD' : 'TAKE_PLENTY', { resources: Object.fromEntries(RESOURCES.map(resource => [resource, Number(data.get(resource))])) });
  else if (mode === 'bank') action('BANK_TRADE', { give: data.get('give'), receive: data.get('receive'), quantity: Number(data.get('quantity')) });
  else if (mode === 'offer') action('OFFER_TRADE', { give: Object.fromEntries(RESOURCES.map(resource => [resource, Number(data.get(`give-${resource}`))])), want: Object.fromEntries(RESOURCES.map(resource => [resource, Number(data.get(`want-${resource}`))])), target: data.get('target') || null });
});
document.addEventListener('input', event => {
  const input = event.target, kind = input.dataset.draft, value = Number(input.value);
  if (kind === 'resources') { ui.resourceDraft[input.name] = value; const sum = resourceCount(ui.resourceDraft), required = Number($('selection-count').dataset.required); $('selection-count').textContent = `${sum} / ${required} selected`; $('submit-resources').disabled = sum !== required || pending || !$('resource-picker').checkValidity(); }
  if (kind === 'trade-give' || kind === 'trade-want') ui.tradeDraft[kind === 'trade-give' ? 'give' : 'want'][input.dataset.resource] = value;
  if (kind === 'bank-quantity') ui.bankQuantity = value;
});
document.addEventListener('change', event => {
  const input = event.target;
  if (input.dataset.draft === 'bank-give') { ui.bankGive = input.value; render(); }
  if (input.dataset.draft === 'bank-receive') ui.bankReceive = input.value;
  if (input.dataset.draft === 'trade-target') ui.tradeDraft.target = input.value;
});
window.addEventListener('pagehide', () => room?.close());
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
window.addEventListener('beforeunload', event => { if (room && view && !['lobby', 'game_result', 'disconnected'].includes(view.phase)) { event.preventDefault(); event.returnValue = ''; } });
document.addEventListener('visibilitychange', () => { if (document.hidden) sound.stop(); });
$('dialog').addEventListener('click', event => { if (event.target === $('dialog')) $('dialog').close(); });
render();
