import { loadPeerJS } from '../../shared/peer-loader.mjs';
import { normalizeRoomCode, validateName, isValidRoomCode } from '../../shared/random.mjs';
import { el } from '../../shared/dom.mjs';
import { RaceSession } from './session.mjs';
import { Prediction } from './prediction.mjs';
import { RaceScene, COLORS } from './scene.mjs';
import { STEP, INPUT, clamp } from './physics.mjs';
import { COUNTDOWN_TICKS } from './race.mjs';
import { RaceSound } from './sound.mjs';

const $ = id => document.getElementById(id), scene = new RaceScene($('game'), $('minimap'));
const sound = new RaceSound();
const params = new URLSearchParams(location.search), keys = new Set(), pointers = new Map();
document.documentElement.classList.toggle('has-touch', navigator.maxTouchPoints > 0);
const keyBits = { ArrowUp: INPUT.UP, ArrowDown: INPUT.DOWN, ArrowLeft: INPUT.LEFT, ArrowRight: INPUT.RIGHT, Space: INPUT.BRAKE };
let joining = params.has('room'), session = null, screen = 'home', lobby = null, state = null, prediction = null;
let attempt = 0, toastTimer, previous = performance.now(), lastInputSend = 0, lastHUD = 0, overlayPhase = '';

try { $('your-name').value = localStorage.getItem('multiplayer:name') ?? ''; } catch { /* Optional storage. */ }
$('room-code-input').value = normalizeRoomCode(params.get('room')).slice(0, 8);

function showScreen(next) {
  screen = next;
  for (const id of ['home', 'connecting', 'lobby', 'race', 'disconnected']) $(id).hidden = id !== next;
  $('leave').hidden = !session || ['home', 'connecting', 'disconnected'].includes(next);
  if (next === 'race') scene.resize();
  else sound.stop();
}
function setMode(join) {
  joining = join; $('code-field').hidden = !join;
  $('create-tab').setAttribute('aria-pressed', String(!join)); $('join-tab').setAttribute('aria-pressed', String(join));
  $('connect').textContent = join ? 'JOIN GAME' : 'CREATE GAME'; $('form-error').textContent = '';
}
function status(text) { $('connection-status').textContent = text; $('connecting-detail').textContent = text; }
function toast(text) { $('toast').textContent = text; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 5000); }
function inviteLink() { const url = new URL(location.origin + location.pathname); url.searchParams.set('room', session.roomCode); return url.href; }
function updateURL(inRoom) {
  const url = new URL(location.origin + location.pathname);
  if (inRoom) url.searchParams.set('room', session.roomCode);
  history.replaceState(null, '', url);
}
function clearKeys() {
  keys.clear(); pointers.clear();
  for (const button of document.querySelectorAll('[data-key]')) button.classList.remove('pressed');
  if (session) session.mask = INPUT.BRAKE;
  updateHorn();
}
function hornPressed() {
  return screen === 'race' && !document.hidden && ['countdown', 'racing'].includes(state?.phase) &&
    (keys.has('KeyH') || [...pointers.values()].includes('KeyH'));
}
function updateHorn() { const pressed = hornPressed(); sound.horn(pressed); session?.horn(pressed); }
function inputMask() {
  if (document.hidden || screen !== 'race' || !['countdown', 'racing'].includes(state?.phase)) return INPUT.BRAKE;
  let mask = 0;
  for (const key of keys) mask |= keyBits[key] ?? 0;
  for (const key of pointers.values()) mask |= keyBits[key] ?? 0;
  return mask;
}

function renderLobby(view) {
  const entered = screen !== 'lobby';
  lobby = view; state = null; prediction = null; clearKeys(); overlayPhase = '';
  showScreen('lobby'); updateURL(true); $('room-code').textContent = view.roomCode; $('invite-link').value = inviteLink();
  const players = view.players.map((player, i) => el('li', {}, el('span', { class: 'driver-dot', style: `background:${COLORS[i]}` }),
    el('strong', {}, `${player.name}${i === session.slot ? ' (you)' : ''}`), el('small', {}, i === 0 ? 'HOST · READY' : player.ready ? 'READY' : 'NOT READY')));
  if (players.length < 2) players.push(el('li', { class: 'waiting' }, '2 · Waiting for your friend…'));
  $('players').replaceChildren(...players); $('ready').hidden = session.isHost; $('start').hidden = !session.isHost;
  $('ready').disabled = !view.fast; $('ready').textContent = view.players[1]?.ready ? 'NOT READY' : 'READY';
  $('start').disabled = view.players.length !== 2 || !view.players.every(p => p.ready) || !view.fast;
  $('lobby-title').textContent = session.isHost ? 'Bring a friend.' : 'You are on the grid.';
  $('lobby-hint').textContent = view.players.length < 2 ? 'Share the invite link to fill the second spot.' :
    !view.fast ? 'Establishing the racing connection…' : session.isHost ? 'Start when your friend is ready.' : 'Choose READY, then wait for the host.';
  if (entered) (session.isHost ? $('copy-link') : $('ready')).focus({ preventScroll: true });
}

function receiveSnapshot(next, at) {
  if (!session) return;
  const fresh = state?.id !== next.id;
  if (fresh) prediction = new Prediction(session.slot);
  if (!prediction.receive(next, at, session.rtt, inputMask())) return;
  state = next;
  sound.receive(next, session.slot);
  if (fresh) { overlayPhase = ''; clearKeys(); showScreen('race'); scene.configure(prediction.track); $('game').focus({ preventScroll: true }); }
  updateOverlay(); updateHUD(at);
}

function formatTime(seconds) { const minutes = Math.floor(seconds / 60), rest = Math.max(0, seconds - minutes * 60); return `${minutes}:${rest.toFixed(1).padStart(4, '0')}`; }
function updateHUD(now) {
  if (!state || !prediction) return;
  const slot = session.slot, car = (session.isHost ? session.race.rigs : prediction.rigs)[slot].car;
  $('speed').textContent = String(Math.round(Math.abs(car.speed) * 4.5 / 64 * 3.6));
  $('gear').textContent = car.speed < -1 ? 'R' : car.speed > 1 ? 'D' : 'N'; $('brake-indicator').classList.toggle('active', car.braking);
  const fraction = clamp((state.progress[slot] - prediction.track.start) / (prediction.track.finish - prediction.track.start), 0, 1);
  $('progress-fill').style.transform = `scaleX(${fraction})`; $('progress-label').textContent = `${Math.round(fraction * 100)}% OF ROUTE`;
  const other = 1 - slot;
  const ahead = state.finished[slot] !== null ? state.finished[other] === null || state.finished[slot] <= state.finished[other] : state.finished[other] === null && state.progress[slot] >= state.progress[other];
  $('position').textContent = `${ahead ? 1 : 2} / 2`;
  $('race-clock').textContent = formatTime(state.finished[slot] ?? Math.max(0, state.tick - COUNTDOWN_TICKS) * STEP);
  $('mission').textContent = state.finished[slot] !== null ? 'Finished! Waiting for the other driver.' : state.phase === 'paused' ? 'Race paused by the host.' :
    state.penalties[slot] ? `Follow the arrows · reset penalty +${state.penalties[slot]}s` : 'Follow the arrows to the finish.';
  $('ping').textContent = !session.isHost && now - prediction.receivedAt > 1000 ? 'Waiting for race updates…' :
    `PING ${Math.round(session.rtt)} ms${session.delay || session.loss ? ` · test: +${session.delay} ms / ${session.loss}% loss` : ''}`;
  $('reset').disabled = state.phase !== 'racing' || state.finished[slot] !== null;
  $('pause').hidden = !session.isHost; $('pause').disabled = !['countdown', 'racing'].includes(state.phase);
  const number = Math.ceil((COUNTDOWN_TICKS - state.tick) * STEP);
  $('countdown').hidden = state.phase !== 'countdown';
  if (state.phase === 'countdown' && $('countdown').textContent !== String(number)) $('countdown').textContent = String(Math.max(1, number));
}

function updateOverlay() {
  if (overlayPhase === state.phase) return;
  overlayPhase = state.phase;
  $('race-overlay').hidden = !['paused', 'results'].includes(state.phase); $('resume').hidden = true; $('rematch').hidden = true; $('results').replaceChildren();
  if (state.phase === 'paused') {
    clearKeys(); $('overlay-eyebrow').textContent = 'A MOMENT IN THE PIT'; $('overlay-title').textContent = 'Race paused.';
    $('overlay-copy').textContent = session.isHost ? 'Both cars and the race clock are paused. Resume when you are ready.' : 'Waiting for the host to resume.';
    $('resume').hidden = !session.isHost; if (session.isHost && !document.hidden) $('resume').focus({ preventScroll: true });
  }
  if (state.phase === 'results') {
    clearKeys();
    const ranked = [0, 1].sort((a, b) => (state.finished[a] ?? Infinity) - (state.finished[b] ?? Infinity) || state.progress[b] - state.progress[a]);
    const winner = ranked[0], tie = state.finished.every(t => t !== null) && Math.abs(state.finished[0] - state.finished[1]) <= STEP;
    $('overlay-eyebrow').textContent = 'THE FINISHING LINE';
    $('overlay-title').textContent = state.finished[winner] === null ? 'Time is up.' : tie ? 'A shared finish.' : `${session.players[winner].name} wins!`;
    $('overlay-copy').textContent = session.isHost ? 'Race again on a freshly generated road.' : 'Wait for the host to start a new race.';
    $('results').replaceChildren(...ranked.map((i, place) => el('li', {}, el('span', {}, `${place + 1}. ${session.players[i].name}`),
      el('strong', {}, state.finished[i] === null ? 'DNF' : formatTime(state.finished[i])))));
    $('rematch').hidden = !session.isHost; if (session.isHost) $('rematch').focus({ preventScroll: true });
  }
  if (state.phase === 'racing' && screen === 'race' && document.activeElement !== $('game')) $('game').focus({ preventScroll: true });
}

async function connect(event) {
  event.preventDefault();
  let name, code;
  try {
    name = validateName($('your-name').value); code = normalizeRoomCode($('room-code-input').value);
    if (joining && !isValidRoomCode(code)) throw new Error('Enter the 8-character room code from your friend.');
  } catch (error) { $('form-error').textContent = error.message; return; }
  try { localStorage.setItem('multiplayer:name', name); } catch { /* Optional storage. */ }
  const token = ++attempt; session?.close(); session = null; state = null; prediction = null;
  showScreen('connecting'); status('Connecting…');
  try {
    const Peer = await loadPeerJS(); if (token !== attempt) return;
    session = new RaceSession({ Peer, version: document.documentElement.dataset.appVersion,
      onLobby: view => { if (token === attempt) renderLobby(view); },
      onSnapshot: (next, at) => { if (token === attempt) receiveSnapshot(next, at); },
      onStatus: text => { if (token === attempt) status(text); },
      onNotice: text => { if (token === attempt) toast(text); },
      onEnded: reason => { if (token === attempt) { session = null; clearKeys(); state = null; prediction = null; $('end-reason').textContent = reason; status('Disconnected'); showScreen('disconnected'); $('back-home').focus(); } },
    });
    session.delay = Number($('delay').value); session.loss = Number($('loss').value);
    if (joining) await session.join(name, code); else await session.create(name);
  } catch (error) {
    if (token !== attempt) return;
    session?.close(); session = null; showScreen('home'); status('Connection unavailable'); $('form-error').textContent = error.message;
  }
}

function leave() {
  ++attempt; session?.sendControl('RETURN_TO_LOBBY'); session?.close(); session = null; state = null; prediction = null; lobby = null;
  clearKeys(); overlayPhase = ''; updateURL(false); showScreen('home'); status('Private test track');
}

$('connect-form').addEventListener('submit', connect);
$('create-tab').addEventListener('click', () => setMode(false)); $('join-tab').addEventListener('click', () => setMode(true));
$('room-code-input').addEventListener('input', event => { event.target.value = normalizeRoomCode(event.target.value); });
$('leave').addEventListener('click', leave); $('cancel').addEventListener('click', leave); $('back-home').addEventListener('click', leave);
$('ready').addEventListener('click', () => session?.ready(!lobby.players[1].ready));
$('start').addEventListener('click', () => session?.start()); $('rematch').addEventListener('click', () => session?.start());
$('pause').addEventListener('click', () => session?.pause()); $('resume').addEventListener('click', () => session?.resume()); $('reset').addEventListener('click', () => session?.reset());
$('copy-link').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('invite-link').value); toast('Invite link copied.'); }
  catch { $('invite-link').focus(); $('invite-link').select(); toast('Copy the selected link and send it to your friend.'); }
});
for (const id of ['delay', 'loss']) $(id).addEventListener('change', () => { if (session) session[id] = Number($(id).value); });
function updateSoundButton() {
  $('sound-toggle').textContent = sound.enabled ? 'SOUND ON' : 'SOUND OFF';
  $('sound-toggle').setAttribute('aria-label', sound.enabled ? 'Mute sounds' : 'Enable sounds');
  $('sound-toggle').setAttribute('aria-pressed', String(sound.enabled));
}
$('sound-toggle').addEventListener('click', () => { sound.setEnabled(!sound.enabled); updateSoundButton(); });
for (const name of ['pointerdown', 'keydown']) document.addEventListener(name, () => sound.unlock(), { capture: true });

document.addEventListener('keydown', event => {
  if (screen !== 'race' || event.target.closest('input,select,textarea,summary')) return;
  if (Object.hasOwn(keyBits, event.code)) { event.preventDefault(); keys.add(event.code); }
  if (event.code === 'KeyH') { event.preventDefault(); keys.add(event.code); updateHorn(); }
  if (event.code === 'KeyR' && !event.repeat) { event.preventDefault(); session?.reset(); }
  if (event.code === 'Escape' && !event.repeat && session?.isHost) { event.preventDefault(); state?.phase === 'paused' ? session.resume() : session.pause(); }
});
document.addEventListener('keyup', event => {
  if ((Object.hasOwn(keyBits, event.code) || event.code === 'KeyH') && screen === 'race') event.preventDefault();
  keys.delete(event.code); if (event.code === 'KeyH') updateHorn();
});
window.addEventListener('blur', clearKeys); document.addEventListener('visibilitychange', clearKeys);
document.addEventListener('visibilitychange', () => { if (document.hidden) sound.stop(); });
window.addEventListener('pagehide', () => { sound.stop(); session?.close(); });
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
window.addEventListener('resize', () => { if (screen === 'race') scene.resize(); });
for (const button of document.querySelectorAll('[data-key]')) {
  button.addEventListener('pointerdown', event => { event.preventDefault(); button.setPointerCapture(event.pointerId); pointers.set(event.pointerId, button.dataset.key); button.classList.add('pressed'); if (button.dataset.key === 'KeyH') updateHorn(); });
  const release = event => { pointers.delete(event.pointerId); if (![...pointers.values()].includes(button.dataset.key)) button.classList.remove('pressed'); if (button.dataset.key === 'KeyH') updateHorn(); };
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(name, release);
}

function frame(now) {
  const dt = Math.min(.1, (now - previous) / 1000); previous = now;
  if (screen === 'race' && state && prediction && session) {
    const mask = inputMask(); session.mask = mask;
    updateHorn();
    if (!session.isHost) {
      prediction.update(dt, mask);
      if (now - lastInputSend >= 30 && ['countdown', 'racing'].includes(state.phase)) { lastInputSend = now; session.sendFast(prediction.packet()); }
    }
    const rigs = session.isHost ? session.race.rigs : prediction.display(now);
    scene.draw(rigs, session.slot, session.players.map(p => p.name), state, dt);
    sound.update(rigs, session.slot, state, mask, dt);
    if (now - lastHUD > 80) { lastHUD = now; updateHUD(now); }
  }
  requestAnimationFrame(frame);
}
setMode(joining); updateSoundButton(); $('boot').hidden = true; showScreen('home'); requestAnimationFrame(frame);
