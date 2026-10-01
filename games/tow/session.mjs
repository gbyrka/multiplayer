import { StarNetwork } from '../../shared/network.mjs';
import { message } from '../../shared/protocol.mjs';
import { createRoomCode, randomToken, validateName, isValidRoomCode } from '../../shared/random.mjs';
import { createRace, advanceRace, resetRig, snapshot, validSnapshot, acceptInputFrames, setHorn, MIN_PLAYERS, MAX_PLAYERS } from './race.mjs';
import { STEP, INPUT } from './physics.mjs';

const FAST_LABEL = 'tow-state-v1';

/** PLAN's star topology: one reliable and one transient channel per guest. */
export class RaceSession {
  constructor({ Peer, version, onLobby, onSnapshot, onStatus, onEnded, onNotice = () => {} }) {
    Object.assign(this, { Peer, version, onLobby, onSnapshot, onStatus, onEnded, onNotice });
    this.closed = false; this.players = []; this.links = new Map(); this.fast = null; this.race = null;
    this.mask = 0; this.pausedPhase = null;
    this.rtt = 0; this.delay = 0; this.loss = 0; this.lastSnapshot = 0;
    this.pendingTimers = new Set();
    this.visibilityHandler = () => { if (document.hidden && this.isHost) this.pause(); };
    document.addEventListener('visibilitychange', this.visibilityHandler);
  }

  reject(connection, reason) {
    this.network.send(connection, message('JOIN_REJECTED', { message: reason }));
    const timer = setTimeout(() => { this.pendingTimers.delete(timer); this.network.drop(connection); }, 250);
    this.pendingTimers.add(timer);
  }

  networkFor() {
    const network = new StarNetwork({ Peer: this.Peer, namespace: 'tow-v1-',
      onConnection: connection => {
        if (this.closed || this.network !== network) return;
        if (this.isHost && (this.race || this.links.size >= MAX_PLAYERS - 1)) {
          this.reject(connection, this.race ? 'A race is already in progress. Join when the drivers return to the lobby.' : 'This room already has four players.');
          return;
        }
        const link = { connection, slot: null, accepted: false, fast: null, inputQueue: new Map(), mask: INPUT.BRAKE,
          lastInput: 0, rtt: 0, lastPing: 0, pingAt: 0 };
        this.links.set(connection, link);
        if (!this.isHost) this.connection = connection;
        const peerConnection = connection.peerConnection, peerHandler = peerConnection.ondatachannel;
        // PeerJS must keep ownership of its reliable DataConnection channel.
        peerConnection.ondatachannel = event => {
          if (event.channel.label === FAST_LABEL && !this.isHost) this.watchFast(event.channel, link);
          else peerHandler?.call(peerConnection, event);
        };
        link.handshakeTimer = setTimeout(() => { if (!link.accepted) network.drop(connection); }, 15000);
      },
      onData: (connection, data) => { if (!this.closed && this.network === network) this.receiveControl(connection, data); },
      onLost: connection => { if (!this.closed && this.network === network) this.lost(connection); },
      onStatus: text => { if (!this.closed && this.network === network) this.onStatus(text); },
      onFatal: error => { if (!this.closed && this.network === network) this.end(error.message); },
    });
    this.network = network;
    return network;
  }

  async create(name) {
    this.isHost = true; this.slot = 0; this.name = validateName(name);
    this.players = [{ name: this.name, ready: true }];
    for (let attempt = 0; attempt < 5; attempt++) {
      this.roomCode = createRoomCode(); const network = this.networkFor();
      try { await network.open(true, this.roomCode); this.publishLobby(); this.startClock(); return; }
      catch (error) { network.destroy(); if (error.code !== 'unavailable-id' || attempt === 4) throw error; }
    }
  }

  async join(name, code) {
    this.isHost = false; this.name = validateName(name);
    if (!isValidRoomCode(code)) throw new Error('Enter the 8-character room code.');
    this.roomCode = code;
    await this.networkFor().open(false, code);
    if (this.closed) return;
    await new Promise((resolve, reject) => {
      this.joinResolve = resolve; this.joinReject = reject;
      this.joinTimer = setTimeout(() => reject(new Error('The host did not respond. Please try again.')), 15000);
      this.sendControl('JOIN_REQUEST', { nickname: this.name, appVersion: this.version });
    });
    this.startClock();
  }

  guests() { return [...this.links.values()].filter(link => link.accepted); }

  sendControl(type, payload = {}, connection = null) {
    const targets = connection ? [connection] : this.isHost ? this.guests().map(link => link.connection) : [this.connection];
    let sent = false;
    for (const target of targets) sent = this.network?.send(target, message(type, payload)) || sent;
    return sent;
  }

  receiveControl(connection, data) {
    const link = this.links.get(connection);
    if (!link) return;
    const payload = data.payload;
    if (this.isHost) {
      if (data.type === 'JOIN_REQUEST') {
        if (link.accepted) {
          this.sendControl('JOIN_ACCEPTED', { slot: link.slot }, connection);
          if (this.race) this.sendControl('STATE_UPDATE', { kind: 'race', state: snapshot(this.race) }, connection); else this.publishLobby();
          return;
        }
        try {
          if (this.race) throw new Error('A race is already in progress.');
          if (this.players.length >= MAX_PLAYERS) throw new Error('This room already has four players.');
          if (payload.appVersion !== this.version) throw new Error('Different game versions. All drivers should reload.');
          link.player = { name: validateName(payload.nickname), ready: false };
          link.slot = this.players.length; this.players.push(link.player);
          link.accepted = true; clearTimeout(link.handshakeTimer);
          this.sendControl('JOIN_ACCEPTED', { slot: link.slot }, connection);
          this.watchFast(connection.peerConnection.createDataChannel(FAST_LABEL, { ordered: false, maxRetransmits: 0 }), link);
          this.publishLobby();
        } catch (error) { this.reject(connection, error.message); }
        return;
      }
      if (!link.accepted) return;
      if (data.type === 'SET_READY' && !this.race && typeof payload.ready === 'boolean') { link.player.ready = payload.ready; this.publishLobby(); }
      if (data.type === 'PLAY_AGAIN' && payload.action === 'reset' && this.race && payload.id === this.race.id) this.reset(link.slot);
      if (data.type === 'PLAY_AGAIN' && payload.action === 'horn' && this.race && payload.id === this.race.id && typeof payload.pressed === 'boolean') {
        if (setHorn(this.race, link.slot, payload.pressed)) this.publishRace(true);
      }
      if (data.type === 'RETURN_TO_LOBBY') this.network.drop(connection);
    } else {
      if (data.type === 'JOIN_ACCEPTED' && Number.isInteger(payload.slot) && payload.slot > 0 && payload.slot < MAX_PLAYERS) {
        this.slot = payload.slot; link.slot = payload.slot; link.accepted = true; clearTimeout(link.handshakeTimer);
      }
      if (data.type === 'JOIN_REJECTED') { this.joinReject?.(new Error(payload.message || 'Unable to join.')); return; }
      if (!link.accepted) return;
      if (data.type === 'STATE_UPDATE') {
        if (payload.kind === 'lobby' && this.validLobby(payload)) {
          this.race = null; this.remoteRaceId = null; this.remotePhase = null;
          this.players = payload.players; this.slot = payload.slot; link.slot = payload.slot; this.lobby = payload;
          this.guestLobby();
          clearTimeout(this.joinTimer); this.joinResolve?.(); this.joinResolve = this.joinReject = null;
        }
        if (payload.kind === 'race' && validSnapshot(payload.state) && payload.state.rigs.length === this.players.length) {
          this.remoteRaceId = payload.state.id; this.remotePhase = payload.state.phase;
          this.onSnapshot(payload.state, performance.now());
        }
      }
      if (data.type === 'ERROR' && typeof payload.message === 'string') this.onNotice(payload.message);
    }
  }

  validLobby(payload) {
    return Array.isArray(payload.players) && payload.players.length <= MAX_PLAYERS && payload.players.length > 1 &&
      payload.players.every(p => p && typeof p.name === 'string' && p.name.length > 0 && p.name.length <= 16 && typeof p.ready === 'boolean') &&
      Number.isInteger(payload.slot) && payload.slot > 0 && payload.slot < payload.players.length && typeof payload.fast === 'boolean';
  }

  guestLobby() {
    if (this.lobby) this.onLobby({ ...this.lobby, roomCode: this.roomCode, fast: this.lobby.fast && this.fast?.readyState === 'open' });
  }

  watchFast(channel, link) {
    if (this.closed || this.links.get(link.connection) !== link || link.fast) { channel.close(); return; }
    if (channel.ordered || channel.maxRetransmits !== 0) { channel.close(); this.network.drop(link.connection); return; }
    link.fast = channel;
    if (!this.isHost) this.fast = channel;
    channel.addEventListener('open', () => {
      if (this.closed || this.links.get(link.connection) !== link) return;
      this.onStatus('Connected');
      if (this.isHost && !this.race) this.publishLobby();
      else if (!this.isHost && !this.remoteRaceId) this.guestLobby();
    });
    channel.addEventListener('message', event => {
      if (this.closed || this.links.get(link.connection) !== link || !link.accepted || typeof event.data !== 'string' || event.data.length > 16000) return;
      let data; try { data = JSON.parse(event.data); } catch { return; }
      if (!data || typeof data !== 'object') return;
      const now = performance.now();
      if (data.kind === 'ping' && Number.isFinite(data.at)) { this.sendFastTo(link, { kind: 'pong', at: data.at }); return; }
      if (data.kind === 'pong' && Number.isFinite(data.at) && data.at === link.pingAt) {
        const sample = now - data.at; link.rtt = link.rtt ? link.rtt * .75 + sample * .25 : sample;
        this.rtt = Math.max(0, ...this.guests().map(guest => guest.rtt)); return;
      }
      // The channel's accepted slot owns this queue; packet fields cannot choose a driver.
      if (this.isHost && this.race && acceptInputFrames(this.race, link.inputQueue, data)) link.lastInput = now;
      if (!this.isHost && data.kind === 'snapshot' && validSnapshot(data.state) && data.state.rigs.length === this.players.length && data.state.id === this.remoteRaceId) {
        if (this.remotePhase === 'results' || this.remotePhase === 'paused') return;
        this.onSnapshot(data.state, now);
      }
    });
    const lost = () => {
      if (!this.closed && this.links.get(link.connection) === link && link.fast === channel) this.network.drop(link.connection);
    };
    channel.addEventListener('close', lost); channel.addEventListener('error', lost);
  }

  sendFastTo(link, data) {
    const channel = link?.fast;
    if (this.closed || !link?.accepted || channel?.readyState !== 'open' || channel.bufferedAmount > 32768) return false;
    if (this.loss && Math.random() * 100 < this.loss) return false;
    const encoded = JSON.stringify(data);
    const send = () => {
      if (!this.closed && this.links.get(link.connection) === link && channel.readyState === 'open' && channel.bufferedAmount < 32768) {
        try { channel.send(encoded); } catch { /* Channel events handle closure. */ }
      }
    };
    if (this.delay) {
      const timer = setTimeout(() => { this.pendingTimers.delete(timer); send(); }, this.delay); this.pendingTimers.add(timer);
    } else send();
    return true;
  }

  sendFast(data) {
    let sent = false;
    for (const link of this.guests()) sent = this.sendFastTo(link, data) || sent;
    return sent;
  }

  publishLobby() {
    if (this.closed) return;
    const guests = this.guests(), fast = guests.length > 0 && guests.every(link => link.fast?.readyState === 'open');
    const lobby = { kind: 'lobby', players: this.players.map(p => ({ ...p })), fast };
    for (const link of guests) this.sendControl('STATE_UPDATE', { ...lobby, slot: link.slot }, link.connection);
    this.onLobby({ ...lobby, slot: 0, roomCode: this.roomCode });
  }

  ready(value) { if (!this.isHost) this.sendControl('SET_READY', { ready: value }); }

  clearInputs() {
    for (const link of this.links.values()) { link.inputQueue.clear(); link.mask = INPUT.BRAKE; link.lastInput = performance.now(); }
  }

  start() {
    if (!this.isHost || this.players.length < MIN_PLAYERS || this.players.length > MAX_PLAYERS || !this.players.every(p => p.ready) ||
        !this.guests().every(link => link.fast?.readyState === 'open') || [...this.links.values()].some(link => !link.accepted) ||
        (this.race && this.race.phase !== 'results')) return false;
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    this.race = createRace(seed, randomToken(), this.players.length); this.clearInputs(); this.mask = 0;
    this.hornPressed = false; this.lastHornSend = 0;
    this.pausedPhase = null; this.accumulator = 0; this.previous = performance.now();
    this.publishRace(true); return true;
  }

  publishRace(reliable = false) {
    const state = snapshot(this.race);
    if (reliable) this.sendControl('STATE_UPDATE', { kind: 'race', state });
    else this.sendFast({ kind: 'snapshot', state });
    this.onSnapshot(state, performance.now());
  }

  reset(slot = this.slot) {
    if (!this.isHost) { this.sendControl('PLAY_AGAIN', { action: 'reset', id: this.remoteRaceId }); return; }
    if (this.race && resetRig(this.race, slot)) this.publishRace(true);
    else if (slot === 0) this.onNotice('Reset available every 8 seconds during the race (+3 seconds).');
    else {
      const link = this.guests().find(guest => guest.slot === slot);
      if (link) this.sendControl('ERROR', { message: 'Reset available every 8 seconds during the race (+3 seconds).' }, link.connection);
    }
  }

  horn(pressed) {
    const now = performance.now();
    if (this.closed || (pressed === this.hornPressed && (!pressed || now - this.lastHornSend < 400))) return;
    this.hornPressed = pressed; this.lastHornSend = now;
    if (this.isHost) {
      if (this.race && setHorn(this.race, 0, pressed)) this.publishRace(true);
    } else if (this.remoteRaceId) this.sendControl('PLAY_AGAIN', { action: 'horn', id: this.remoteRaceId, pressed });
  }

  pause() {
    if (!this.isHost || !this.race || !['countdown', 'racing'].includes(this.race.phase)) return;
    this.pausedPhase = this.race.phase; this.race.phase = 'paused'; this.race.epoch++; this.mask = INPUT.BRAKE;
    for (let slot = 0; slot < this.race.rigs.length; slot++) setHorn(this.race, slot, false);
    this.hornPressed = false; this.clearInputs(); this.publishRace(true);
  }
  resume() {
    if (!this.isHost || this.race?.phase !== 'paused' || document.hidden) return;
    this.race.phase = this.pausedPhase; this.race.epoch++; this.clearInputs();
    this.accumulator = 0; this.previous = performance.now(); this.publishRace(true);
  }

  startClock() {
    this.previous = performance.now(); this.accumulator = 0;
    this.clock = setInterval(() => this.clockTick(), 8);
  }
  clockTick() {
    if (this.closed) return;
    const now = performance.now(), delta = (now - this.previous) / 1000; this.previous = now;
    for (const link of this.guests()) if (now - link.lastPing > 1000 && link.fast?.readyState === 'open') {
      link.lastPing = now; link.pingAt = now; this.sendFastTo(link, { kind: 'ping', at: now });
    }
    if (!this.isHost || !this.race || !['countdown', 'racing'].includes(this.race.phase)) return;
    if (delta > .5) { this.pause(); return; }
    this.accumulator += delta;
    let changed = false;
    while (this.accumulator >= STEP) {
      const phase = this.race.phase, tick = this.race.tick + 1, masks = Array(this.players.length).fill(INPUT.BRAKE);
      masks[0] = this.mask;
      for (const link of this.guests()) {
        if (link.inputQueue.has(tick)) link.mask = link.inputQueue.get(tick);
        link.inputQueue.delete(tick);
        masks[link.slot] = now - link.lastInput > 350 ? INPUT.BRAKE : link.mask;
      }
      advanceRace(this.race, masks); this.accumulator -= STEP;
      changed ||= this.race.phase !== phase;
      if (this.race.phase === 'results') { this.accumulator = 0; break; }
    }
    if (changed || now - this.lastSnapshot >= 50) { this.lastSnapshot = now; this.publishRace(changed); }
  }

  lost(connection) {
    const link = this.links.get(connection);
    if (!link) return;
    this.links.delete(connection); clearTimeout(link.handshakeTimer);
    const fast = link.fast; link.fast = null; fast?.close();
    if (this.isHost) {
      if (!link.accepted) return;
      const wasRacing = !!this.race; this.race = null; this.clearInputs();
      const guests = this.guests();
      for (let i = 0; i < guests.length; i++) { guests[i].slot = i + 1; if (wasRacing) guests[i].player.ready = false; }
      this.players = [this.players[0], ...guests.map(guest => guest.player)];
      this.publishLobby();
      const notice = wasRacing ? `${link.player.name} disconnected. The drivers are back in the lobby; choose READY for a new race.` :
        `${link.player.name} left the room. You can invite another driver.`;
      this.onNotice(notice); this.sendControl('ERROR', { message: notice });
    } else {
      this.connection = null; this.fast = null;
      this.end('The host disconnected. Create or join a new room.');
    }
  }

  end(reason) { if (this.closed) return; this.close(); this.onEnded(reason); }
  close() {
    if (this.closed) return;
    this.closed = true; clearInterval(this.clock); clearTimeout(this.joinTimer);
    for (const timer of this.pendingTimers) clearTimeout(timer); this.pendingTimers.clear();
    document.removeEventListener('visibilitychange', this.visibilityHandler);
    this.joinReject?.(new Error('Connection cancelled.')); this.joinResolve = this.joinReject = null;
    for (const link of this.links.values()) { clearTimeout(link.handshakeTimer); link.fast?.close(); }
    this.links.clear(); this.fast = null; this.network?.destroy();
  }
}
