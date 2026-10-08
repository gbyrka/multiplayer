import { loadPeerJS } from '../../shared/peer-loader.mjs';
import { normalizeRoomCode, validateName, isValidRoomCode } from '../../shared/random.mjs';
import { el } from '../../shared/dom.mjs';
import { HamsterSession } from './session.mjs';
import { HamsterScene } from './scene.mjs';
import { HamsterSound } from './sound.mjs';
import { Prediction } from './prediction.mjs';
import { INPUT, nearWater } from './physics.mjs';
import { COLORS, FOOD_TYPES, COUNTDOWN_TICKS, MIN_PLAYERS, MAX_PLAYERS, rankArena, winners, snapshot } from './game-core.mjs';

const $ = id => document.getElementById(id), params = new URLSearchParams(location.search);
const sound = new HamsterSound(), keys = new Set(), pointers = new Map();
const keyBits = { KeyW: INPUT.UP, ArrowUp: INPUT.UP, KeyS: INPUT.DOWN, ArrowDown: INPUT.DOWN,
  KeyA: INPUT.LEFT, ArrowLeft: INPUT.LEFT, KeyD: INPUT.RIGHT, ArrowRight: INPUT.RIGHT,
  ShiftLeft: INPUT.WALK, ShiftRight: INPUT.WALK, Space: INPUT.EAT, KeyQ: INPUT.DASH, KeyE: INPUT.WHEEL, KeyH: INPUT.SQUEAK };
const tapKeys = new Set(['KeyQ', 'KeyE', 'KeyH']);
let joining = params.has('room'), session = null, scene = null, screen = 'home', lobby = null, state = null, prediction = null;
let attempt = 0, toastTimer, feedbackTimer, previous = performance.now(), lastInputSend = 0, lastHUD = 0, lastRender = 0, overlayPhase = '', lastEvent = 0;
document.documentElement.classList.toggle('has-touch', navigator.maxTouchPoints > 0);
try { $('your-name').value = localStorage.getItem('multiplayer:name') ?? ''; } catch { /* Optional storage. */ }
$('room-code-input').value = normalizeRoomCode(params.get('room')).slice(0, 8);

function showScreen(next) {
  screen = next;
  for (const id of ['home', 'connecting', 'lobby', 'picnic', 'disconnected']) $(id).hidden = id !== next;
  window.MoDITAds?.setVisible($('hamster-ad'), ['home', 'picnic'].includes(next));
  $('leave').hidden = !session || ['home', 'connecting', 'disconnected'].includes(next);
  if (next === 'picnic') scene?.resize(); else sound.stop();
}
function setMode(join) {
  joining = join; $('code-field').hidden = !join; $('room-code-input').required = join;
  $('mode-switch').textContent = join ? 'Start a new room' : 'Use a room code';
  $('connect').textContent = join ? 'JOIN GAME ↗' : 'CREATE GAME ↗'; $('form-error').textContent = '';
}
function status(text) { $('connection-status').textContent = text; $('connecting-detail').textContent = text; }
function toast(text) {
  $('toast').textContent = text; $('toast').hidden = false; clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 5000);
}
function feedback(text) {
  $('action-feedback').textContent = text; $('action-feedback').hidden = false; clearTimeout(feedbackTimer);
  feedbackTimer = setTimeout(() => { $('action-feedback').hidden = true; }, 1700);
}
function roomURL(inRoom = true) {
  const url = new URL(location.origin + location.pathname);
  if (inRoom) url.searchParams.set('room', session.roomCode);
  return url;
}
function clearKeys() {
  keys.clear(); pointers.clear(); document.querySelectorAll('[data-key]').forEach(button => button.classList.remove('pressed'));
  if (session) session.mask = 0;
  if (session && prediction && !session.isHost && ['countdown', 'playing'].includes(state?.phase)) session.sendFast(prediction.packet(0));
}
function inputMask() {
  if (document.hidden || screen !== 'picnic' || !['countdown', 'playing'].includes(state?.phase)) return 0;
  let mask = 0;
  for (const key of keys) mask |= keyBits[key] ?? 0;
  for (const key of pointers.values()) mask |= keyBits[key] ?? 0;
  return mask;
}
function sendInput() {
  if (!session || !state || !['countdown', 'playing'].includes(state.phase)) return;
  const mask = inputMask(); session.mask = mask;
  if (!session.isHost && prediction) session.sendFast(prediction.packet(mask));
}
function dot(slot) { return el('span', { class: 'player-dot', style: `background:${COLORS[slot]}`, 'aria-hidden': 'true' }, 'ω'); }

function renderLobby(view) {
  const entered = screen !== 'lobby';
  lobby = view; state = null; prediction = null; clearKeys(); overlayPhase = '';
  showScreen('lobby'); history.replaceState(null, '', roomURL());
  $('room-code').textContent = view.roomCode; $('invite-link').value = roomURL().href;
  const players = view.players.map((player, slot) => el('li', {}, dot(slot),
    el('strong', {}, `${player.name}${slot === session.slot ? ' (you)' : ''}`),
    el('small', {}, slot === 0 ? 'HOST · READY' : player.ready ? 'READY' : 'NOT READY')));
  for (let i = players.length; i < MAX_PLAYERS; i++) players.push(el('li', { class: 'waiting' }, `${i + 1} · A spot for another friend…`));
  $('players').replaceChildren(...players); $('ready').hidden = session.isHost; $('start').hidden = !session.isHost;
  $('ready').disabled = !view.fast; $('ready').textContent = view.players[session.slot]?.ready ? 'NOT READY' : 'READY';
  $('start').disabled = view.players.length < MIN_PLAYERS || !view.players.every(player => player.ready) || !view.fast;
  $('lobby-title').textContent = session.isHost ? 'Save a spot for your friends.' : 'Your little crew is here.';
  $('lobby-hint').textContent = view.players.length < MIN_PLAYERS ? 'Invite at least one friend. Up to four can join the picnic.' :
    !view.fast ? 'Connecting your little worlds…' : session.isHost ? `${view.players.length} / 4 friends. Start when everyone is ready.` : 'Choose READY, then wait for the host.';
  if (entered) (session.isHost ? $('copy-link') : $('ready')).focus({ preventScroll: true });
}

function receiveSnapshot(next, at) {
  if (!session) return;
  const fresh = state?.id !== next.id;
  if (fresh) { prediction = new Prediction(session.slot); lastEvent = 0; }
  if (!prediction.receive(next, at, session.rtt, inputMask())) return;
  const previousPhase = state?.phase; state = next; sound.receive(next, session.slot);
  if (fresh) {
    overlayPhase = ''; clearKeys(); showScreen('picnic'); $('game').focus({ preventScroll: true });
    window.gtag?.('event', 'game_start', { game_name: 'hamster_multiplayer', player_count: next.hamsters.length });
  }
  if (previousPhase === 'paused' && next.phase !== 'paused') { clearKeys(); $('game').focus({ preventScroll: true }); }
  for (const event of next.events) {
    if (event.id <= lastEvent) continue;
    lastEvent = event.id;
    if (next.tick - event.tick > 60 || next.phase !== 'playing') continue;
    if (event.slot === session.slot) {
      if (event.type === 'eat') feedback(`Yum! +${event.points} points · ${event.count} treats`);
      if (event.type === 'drink') feedback('A tiny sip. +2 points');
      if (event.type === 'wheel-bonus') feedback('+10 points · happy little legs!');
      if (event.type === 'wheel-busy') feedback('A friend is using the wheel. Try again in a moment.');
      if (event.type === 'bump') feedback(event.dropped ? 'A playful nudge! One treat spilled.' : 'Boop!');
    }
    if (event.type === 'bump' && event.target === session.slot) feedback(event.dropped ? 'Boop! A treat slipped out. Your points are safe.' : 'Boop! A little room, please.');
    if (event.type === 'bloom') feedback(`Golden snacks on the ${['bedding', 'wooden loft', 'lookout deck'][event.level]}!`);
  }
  updateOverlay(); updateHUD(at);
}
function formatTime(seconds) { const remaining = Math.max(0, Math.ceil(seconds)); return `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`; }
function updateHUD(now) {
  if (!state || !session) return;
  const p = state.hamsters[session.slot], elapsed = Math.max(0, state.tick - COUNTDOWN_TICKS) / 60;
  $('score').textContent = String(p.score); $('round-clock').textContent = formatTime(180 - elapsed);
  $('round-clock').classList.toggle('urgent', elapsed >= 160);
  $('energy-value').textContent = `${Math.round(p.energy)}%`; $('energy-fill').style.transform = `scaleX(${p.energy / 100})`;
  $('pouch-value').textContent = `${p.pouch.length} / 5`;
  $('pouch').replaceChildren(...Array.from({ length: 5 }, (_, i) => {
    const type = FOOD_TYPES[p.pouch[i]];
    return el('i', { class: type ? 'filled' : '', style: type ? `color:${type.color}` : null, 'aria-label': type ? `${type.name}, ${type.points} points` : 'Empty pouch slot' }, type?.symbol ?? '·');
  }));
  const waitingPoints = p.pouch.reduce((sum, type) => sum + FOOD_TYPES[type].points, 0);
  $('pouch-hint').textContent = p.eat > 0 ? `Nibbling… ${Math.min(100, Math.round(p.eat / .85 * 100))}%` : p.pouch.length ? `${waitingPoints} points to nibble · hold Space` : 'Find a treat. Make a little picnic.';
  $('dash-status').textContent = p.dashCooldown ? `Q · DASH IN ${p.dashCooldown.toFixed(1)}s` : p.energy < 12 ? 'WALK TO REST · SHIFT' : 'Q · DASH READY';
  $('mission').textContent = state.phase === 'paused' ? 'A little breather. The host has paused the picnic.' : state.phase === 'results' ? 'Full cheeks. Happy memories.' : elapsed >= 165 ? 'Last bites! Eat your pouch before time runs out.' : 'Fill your cheeks. Remember to nibble.';
  const occupied = state.hamsters.some((other, slot) => slot !== session.slot && (other.wheel || other.wheelTransition));
  $('interaction').textContent = p.wheelTransition ? 'Little steps onto / off the wheel…' : p.wheel ? `W / S · run to recharge · ${p.bonuses} / 3 bonuses · E leave` :
    p.tube ? 'Bubble trail · W forward · S turn around · A / D pick a branch · Space nibble' : nearWater(p) ? p.drinkCooldown ? `Next sip in ${p.drinkCooldown.toFixed(1)}s` : 'Hold Space · take a tiny sip (+2 points, +8 energy)' :
      p.y < .5 && Math.hypot(p.x - 6, p.z - 3.65) < 1.8 ? occupied ? 'A friend is on the wheel. There are treats to find!' : 'E · climb into the wheel to recharge' :
        p.shield ? 'A little breathing room · protected from spills for a moment' : p.pouch.length === 5 ? 'Full cheeks! Hold Space to eat all five treats.' : 'Hold Space to nibble · Q dash · H squeak hello';
  $('standings').replaceChildren(...rankArena(state).map(slot => {
    const hamster = state.hamsters[slot];
    return el('li', { class: slot === session.slot ? 'own' : '' }, dot(slot), el('div', { class: 'standing-name' },
      el('strong', {}, `${session.players[slot].name}${slot === session.slot ? ' · YOU' : ''}`),
      el('span', {}, `${hamster.pouch.length} IN CHEEKS${hamster.wheel ? ' · WHEEL' : hamster.tube ? ' · TUBE' : ''}`)),
    el('strong', { class: 'standing-score' }, String(hamster.score)));
  }));
  const golden = state.foods.filter(food => food.type === 3 && !food.dropped && food.expires > state.tick);
  $('bloom-banner').hidden = !golden.length;
  if (golden.length) {
    const place = ['bedding', 'wooden loft', 'lookout deck'][golden[0].level];
    $('bloom-banner').textContent = `✦ GOLDEN SNACKS · ${formatTime((golden[0].expires - state.tick) / 60)}`;
    $('snack-title').textContent = 'Golden snacks are here!';
    $('snack-copy').textContent = `${golden.length} treats on the ${place}. Grab one, then nibble for 50 points.`;
  } else {
    $('snack-title').textContent = elapsed >= 150 ? 'Time for the last bites.' : `Golden snacks in ${Math.ceil(30 - elapsed % 30)}s.`;
    $('snack-copy').textContent = elapsed >= 150 ? 'Eat what is in your cheeks before the picnic ends.' : `Next stop: ${['the bedding', 'the wooden loft', 'the lookout deck'][state.bloom % 3]}. Each golden treat is worth 50 points.`;
  }
  $('ping').textContent = !session.isHost && now - prediction.receivedAt > 1000 ? 'Waiting for your friends’ world…' : `PING ${Math.round(session.rtt)} ms · ${state.hamsters.length} FRIENDS CONNECTED`;
  $('pause').hidden = !session.isHost; $('pause').disabled = !['countdown', 'playing'].includes(state.phase);
  $('countdown').hidden = state.phase !== 'countdown';
  if (state.phase === 'countdown') $('countdown').textContent = String(Math.max(1, Math.ceil((COUNTDOWN_TICKS - state.tick) / 60)));
}
function updateOverlay() {
  if (overlayPhase === state.phase) return;
  overlayPhase = state.phase; $('picnic-overlay').hidden = !['paused', 'results'].includes(state.phase);
  for (const id of ['resume', 'rematch', 'return-lobby']) $(id).hidden = true;
  $('results').replaceChildren();
  if (state.phase === 'paused') {
    clearKeys(); sound.stop(); $('overlay-eyebrow').textContent = 'EVEN LITTLE PAWS NEED A BREAK'; $('overlay-title').textContent = 'A little breather.';
    $('overlay-copy').textContent = session.isHost ? 'The clock, treats and all your friends are paused. Resume when everyone is ready.' : 'The host has paused the picnic. Your treats are waiting.';
    $('resume').hidden = !session.isHost; if (session.isHost && !document.hidden) $('resume').focus({ preventScroll: true });
  }
  if (state.phase === 'results') {
    clearKeys(); const won = winners(state), winnerNames = won.map(slot => session.players[slot].name);
    $('overlay-eyebrow').textContent = 'FULL CHEEKS. HAPPY MEMORIES.';
    $('overlay-title').textContent = won.length > 1 ? 'A picnic worth sharing.' : `${winnerNames[0]} wins!`;
    $('overlay-copy').textContent = won.length > 1 ? `${winnerNames.join(' & ')} share the win. ${session.isHost ? 'Another little adventure?' : 'Wait for the host to start again.'}` : session.isHost ? 'A little mischief. A lovely time. Another picnic?' : 'Wait for the host to start another picnic.';
    $('results').replaceChildren(...rankArena(state).map((slot, place) => {
      const p = state.hamsters[slot];
      return el('li', { class: won.includes(slot) ? 'winner' : '' }, dot(slot), el('div', { class: 'result-name' },
        `${won.includes(slot) ? '✦' : `${place + 1}.`} ${session.players[slot].name}${slot === session.slot ? ' (you)' : ''}`,
        el('small', {}, `${p.eaten} treats eaten · ${p.bumpCount} playful nudges`)), el('strong', {}, `${p.score} pts`));
    }));
    $('rematch').hidden = $('return-lobby').hidden = !session.isHost;
    if (won.includes(session.slot)) sound.play('victory');
    if (session.isHost) $('rematch').focus({ preventScroll: true });
    window.gtag?.('event', 'game_end', { game_name: 'hamster_multiplayer', player_count: state.hamsters.length, score: state.hamsters[session.slot].score });
  }
}
async function connect(event) {
  event.preventDefault(); let name, code;
  try {
    name = validateName($('your-name').value); code = normalizeRoomCode($('room-code-input').value);
    if (joining && !isValidRoomCode(code)) throw new Error('Enter the 8-character room code from your friend.');
    if (!scene) scene = new HamsterScene($('game'), $('map'));
  } catch (error) { $('form-error').textContent = error.message; return; }
  try { localStorage.setItem('multiplayer:name', name); } catch { /* Optional storage. */ }
  const token = ++attempt; session?.close(); session = null; state = null; prediction = null;
  showScreen('connecting'); status('Preparing your little world…');
  try {
    await scene.warmup(); if (token !== attempt) return;
    status('Connecting…');
    const Peer = await loadPeerJS(); if (token !== attempt) return;
    session = new HamsterSession({ Peer, version: document.documentElement.dataset.appVersion,
      onLobby: view => { if (token === attempt) renderLobby(view); },
      onSnapshot: (next, at) => { if (token === attempt) receiveSnapshot(next, at); },
      onStatus: text => { if (token === attempt) status(text); }, onNotice: text => { if (token === attempt) toast(text); },
      onEnded: reason => { if (token === attempt) { session = null; clearKeys(); state = null; prediction = null;
        $('end-reason').textContent = reason; status('Disconnected'); showScreen('disconnected'); $('back-home').focus(); } },
    });
    if (joining) await session.join(name, code); else await session.create(name);
  } catch (error) {
    if (token !== attempt) return;
    session?.close(); session = null; showScreen('home'); status('Connection unavailable'); $('form-error').textContent = error.message;
  }
}
function leave() {
  ++attempt; session?.sendControl('RETURN_TO_LOBBY'); session?.close(); session = null; state = null; prediction = null; lobby = null;
  clearKeys(); sound.stop(); overlayPhase = ''; clearTimeout(feedbackTimer); clearTimeout(toastTimer);
  $('action-feedback').hidden = $('toast').hidden = true;
  history.replaceState(null, '', roomURL(false)); setMode(false); showScreen('home'); status('Little paws. Big company.'); $('your-name').focus({ preventScroll: true });
}
$('connect-form').addEventListener('submit', connect); $('mode-switch').addEventListener('click', () => setMode(!joining));
$('room-code-input').addEventListener('input', event => { event.target.value = normalizeRoomCode(event.target.value); });
for (const id of ['leave', 'cancel', 'back-home']) $(id).addEventListener('click', leave);
$('ready').addEventListener('click', () => session?.ready(!lobby.players[session.slot].ready));
for (const id of ['start', 'rematch']) $(id).addEventListener('click', () => session?.start());
$('return-lobby').addEventListener('click', () => session?.returnLobby());
$('pause').addEventListener('click', () => session?.pause()); $('resume').addEventListener('click', () => session?.resume());
$('camera').addEventListener('click', () => scene?.camera());
$('copy-link').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('invite-link').value); toast('Invite link copied. Send it to your friends!'); }
  catch { $('invite-link').focus(); $('invite-link').select(); toast('Copy the selected link and send it to your friends.'); }
});
function updateSoundButton() {
  $('sound-toggle').textContent = sound.enabled ? 'SOUND ON' : 'SOUND OFF';
  $('sound-toggle').setAttribute('aria-label', sound.enabled ? 'Mute sounds' : 'Enable sounds');
  $('sound-toggle').setAttribute('aria-pressed', String(sound.enabled));
}
$('sound-toggle').addEventListener('click', () => { sound.setEnabled(!sound.enabled); updateSoundButton(); });
for (const name of ['pointerdown', 'keydown']) document.addEventListener(name, () => sound.unlock(), { capture: true });
document.addEventListener('keydown', event => {
  if (screen !== 'picnic' || event.target.closest('input,select,textarea,summary')) return;
  if (Object.hasOwn(keyBits, event.code)) {
    event.preventDefault(); keys.add(event.code);
    if (!event.repeat) { if (tapKeys.has(event.code)) session?.tap(keyBits[event.code]); sendInput(); }
  }
  if (event.code === 'KeyC' && !event.repeat) { event.preventDefault(); scene?.camera(); }
  if (event.code === 'Escape' && !event.repeat && session?.isHost) { event.preventDefault(); state?.phase === 'paused' ? session.resume() : session.pause(); }
});
document.addEventListener('keyup', event => { if (Object.hasOwn(keyBits, event.code) && screen === 'picnic') event.preventDefault(); keys.delete(event.code); sendInput(); });
window.addEventListener('blur', clearKeys); document.addEventListener('visibilitychange', () => { clearKeys(); if (document.hidden) sound.stop(); });
window.addEventListener('pagehide', () => { sound.stop(); session?.close(); });
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
$('game').addEventListener('webglcontextlost', event => {
  event.preventDefault(); ++attempt; session?.close(); session = null; state = null; prediction = null; clearKeys(); sound.stop();
  scene?.dispose(); scene = null; $('end-reason').textContent = 'Graphics were interrupted. Reload this page to rejoin a new picnic.'; showScreen('disconnected');
});
for (const button of document.querySelectorAll('[data-key]')) {
  button.addEventListener('pointerdown', event => {
    event.preventDefault(); button.setPointerCapture(event.pointerId); pointers.set(event.pointerId, button.dataset.key); button.classList.add('pressed');
    if (tapKeys.has(button.dataset.key)) session?.tap(keyBits[button.dataset.key]); sendInput();
  });
  const release = event => { pointers.delete(event.pointerId); if (![...pointers.values()].includes(button.dataset.key)) button.classList.remove('pressed'); sendInput(); };
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(name, release);
}
function frame(now) {
  const dt = Math.min(.1, (now - previous) / 1000); previous = now;
  if (screen === 'picnic' && state && session && prediction && scene) {
    const mask = inputMask(); session.mask = mask;
    if (!session.isHost) {
      prediction.update(dt, mask);
      if (now - lastInputSend >= 30 && ['countdown', 'playing'].includes(state.phase)) { lastInputSend = now; session.sendFast(prediction.packet(mask)); }
    }
    if (now - lastRender >= 1000 / 30) {
      const drawDT = Math.min(.1, (now - lastRender) / 1000), visible = session.isHost ? snapshot(session.arena) : state;
      lastRender = now;
      scene.draw(session.isHost ? visible.hamsters : prediction.display(now), session.slot, session.players.map(p => p.name), visible, drawDT);
    }
    if (now - lastHUD >= 100) { lastHUD = now; updateHUD(now); }
  }
  requestAnimationFrame(frame);
}
setMode(joining); updateSoundButton(); $('boot').hidden = true; showScreen('home'); requestAnimationFrame(frame);
