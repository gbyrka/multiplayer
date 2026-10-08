import { StarNetwork } from '../../shared/network.mjs';
import { message } from '../../shared/protocol.mjs';
import { createRoomCode, randomToken, validateName, isValidRoomCode } from '../../shared/random.mjs';
import { createArena, advanceArena, snapshot, validSnapshot, acceptInput, MIN_PLAYERS, MAX_PLAYERS } from './game-core.mjs';
import { RequestCache } from '../../shared/protocol.mjs';
import { STEP, INPUT } from './physics.mjs';

const FAST_LABEL = 'hamster-state-v1';
const TAP_KEYS = [INPUT.DASH, INPUT.WHEEL, INPUT.SQUEAK];
const TAP_MASK = TAP_KEYS.reduce((sum, bit) => sum | bit, 0);

/** PLAN's star topology: one reliable and one transient channel per guest. */
export class HamsterSession {
  constructor({ Peer, version, onLobby, onSnapshot, onStatus, onEnded, onNotice = () => {} }) {
    Object.assign(this, { Peer, version, onLobby, onSnapshot, onStatus, onEnded, onNotice });
    this.closed = false; this.players = []; this.links = new Map(); this.fast = null; this.arena = null;
    this.mask = 0; this.pausedPhase = null;
    this.pendingTaps = Array(MAX_PLAYERS).fill(0);
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
    const network = new StarNetwork({ Peer: this.Peer, namespace: 'hamster-v1-',
      onConnection: connection => {
        if (this.closed || this.network !== network) return;
        if (this.isHost && (this.arena || this.links.size >= MAX_PLAYERS - 1)) {
          this.reject(connection, this.arena ? 'A picnic is already in progress. Join when everyone returns to the lobby.' : 'This room already has four players.');
          return;
        }
        const link = { connection, slot: null, accepted: false, fast: null, seq: 0, requests: new RequestCache(), mask: 0,
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
          if (this.arena) this.sendControl('STATE_UPDATE', { kind: 'arena', state: snapshot(this.arena) }, connection); else this.publishLobby();
          return;
        }
        try {
          if (this.arena) throw new Error('A picnic is already in progress.');
          if (this.players.length >= MAX_PLAYERS) throw new Error('This room already has four players.');
          if (payload.appVersion !== this.version) throw new Error('Different game versions. Everyone should reload.');
          link.player = { name: validateName(payload.nickname), ready: false };
          link.slot = this.players.length; this.players.push(link.player);
          link.accepted = true; clearTimeout(link.handshakeTimer);
          this.sendControl('JOIN_ACCEPTED', { slot: link.slot }, connection);
          this.watchFast(connection.peerConnection.createDataChannel(FAST_LABEL, { ordered: false, maxRetransmits: 0 }), link);
          this.publishLobby();
        } catch (error) { this.reject(connection, error.message); }
        return;
      }
      if (!link.accepted || link.requests.has(data.requestId)) return;
      link.requests.add(data.requestId);
      if (data.type === 'SET_READY' && !this.arena && typeof payload.ready === 'boolean') { link.player.ready = payload.ready; this.publishLobby(); }
      if (data.type === 'PLAY_AGAIN' && payload.action === 'tap' && this.arena?.phase === 'playing' &&
          payload.id === this.arena.id && payload.epoch === this.arena.epoch && TAP_KEYS.includes(payload.key)) this.pendingTaps[link.slot] |= payload.key;
      if (data.type === 'RETURN_TO_LOBBY') this.network.drop(connection);
    } else {
      if (data.type === 'JOIN_ACCEPTED' && Number.isInteger(payload.slot) && payload.slot > 0 && payload.slot < MAX_PLAYERS) {
        this.slot = payload.slot; link.slot = payload.slot; link.accepted = true; clearTimeout(link.handshakeTimer);
      }
      if (data.type === 'JOIN_REJECTED') { this.joinReject?.(new Error(payload.message || 'Unable to join.')); return; }
      if (!link.accepted) return;
      if (data.type === 'STATE_UPDATE') {
        if (payload.kind === 'lobby' && this.validLobby(payload)) {
          this.arena = null; this.remoteArenaId = null; this.remotePhase = null; this.lastRemote = null;
          this.players = payload.players; this.slot = payload.slot; link.slot = payload.slot; this.lobby = payload;
          this.guestLobby();
          clearTimeout(this.joinTimer); this.joinResolve?.(); this.joinResolve = this.joinReject = null;
        }
        if (payload.kind === 'arena' && validSnapshot(payload.state) && payload.state.hamsters.length === this.players.length) {
          this.deliver(payload.state, performance.now());
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
      if (this.isHost && !this.arena) this.publishLobby();
      else if (!this.isHost && !this.remoteArenaId) this.guestLobby();
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
      // The channel's assigned slot owns the input; packets cannot choose a hamster.
      if (this.isHost && this.arena) acceptInput(this.arena, link, data, now);
      if (!this.isHost && data.kind === 'snapshot' && validSnapshot(data.state) && data.state.hamsters.length === this.players.length && data.state.id === this.remoteArenaId) {
        if (this.remotePhase === 'results' || this.remotePhase === 'paused') return;
        this.deliver(data.state, now);
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

  /** Short button presses survive rendering stalls and transient packet loss. */
  tap(key) {
    if (!TAP_KEYS.includes(key)) return;
    if (this.isHost) {
      if (this.arena?.phase === 'playing') this.pendingTaps[0] |= key;
    } else if (this.remotePhase === 'playing') this.sendControl('PLAY_AGAIN', {
      action: 'tap', id: this.remoteArenaId, epoch: this.lastRemote.epoch, key,
    });
  }

  clearInputs() {
    this.pendingTaps.fill(0);
    for (const link of this.links.values()) { link.mask = 0; link.lastInput = 0; }
  }

  start() {
    if (!this.isHost || this.players.length < MIN_PLAYERS || this.players.length > MAX_PLAYERS || !this.players.every(p => p.ready) ||
        !this.guests().every(link => link.fast?.readyState === 'open') || [...this.links.values()].some(link => !link.accepted) ||
        (this.arena && this.arena.phase !== 'results')) return false;
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    this.arena = createArena(seed, randomToken(), this.players.length); this.clearInputs(); this.mask = 0;
    this.guests().forEach(link => { link.seq = 0; });
    this.pausedPhase = null; this.accumulator = 0; this.previous = performance.now();
    this.publishArena(true); return true;
  }

  publishArena(reliable = false) {
    const state = snapshot(this.arena);
    if (reliable) this.sendControl('STATE_UPDATE', { kind: 'arena', state });
    else this.sendFast({ kind: 'snapshot', state });
    this.onSnapshot(state, performance.now());
  }

  deliver(state, at) {
    const previous = this.lastRemote;
    if (previous?.id === state.id && (state.epoch < previous.epoch || (state.epoch === previous.epoch && state.tick <= previous.tick))) return;
    this.lastRemote = state;
    this.remoteArenaId = state.id; this.remotePhase = state.phase;
    this.onSnapshot(state, at);
  }

  returnLobby() {
    if (!this.isHost || !this.arena || this.arena.phase !== 'results') return;
    this.arena = null; this.mask = 0; this.clearInputs();
    this.players.forEach((player, i) => { player.ready = i === 0; });
    this.publishLobby();
  }

  pause() {
    if (!this.isHost || !this.arena || !['countdown', 'playing'].includes(this.arena.phase)) return;
    this.pausedPhase = this.arena.phase; this.arena.phase = 'paused'; this.arena.epoch++; this.mask = 0;
    this.clearInputs(); this.publishArena(true);
  }
  resume() {
    if (!this.isHost || this.arena?.phase !== 'paused' || document.hidden) return;
    this.arena.phase = this.pausedPhase; this.arena.epoch++; this.clearInputs();
    this.accumulator = 0; this.previous = performance.now(); this.publishArena(true);
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
    if (!this.isHost || !this.arena || !['countdown', 'playing'].includes(this.arena.phase)) return;
    // First visible frames may compile a new GPU program. Keep the countdown
    // bounded instead of interpreting that preparation as a suspended match.
    if (delta > 3 && this.arena.phase === 'playing') { this.pause(); return; }
    this.accumulator += Math.min(delta, this.arena.phase === 'countdown' ? .5 : .25);
    let changed = false;
    while (this.accumulator >= STEP) {
      const phase = this.arena.phase, masks = Array(this.players.length).fill(0);
      masks[0] = this.mask;
      for (const link of this.guests()) masks[link.slot] = now - link.lastInput > 350 ? 0 : link.mask;
      for (let slot = 0; slot < masks.length; slot++) {
        masks[slot] = (masks[slot] & ~TAP_MASK) | this.pendingTaps[slot];
        this.pendingTaps[slot] = 0;
      }
      advanceArena(this.arena, masks); this.accumulator -= STEP;
      changed ||= this.arena.phase !== phase;
      if (this.arena.phase === 'results') { this.accumulator = 0; break; }
    }
    if (changed || now - this.lastSnapshot >= 50) { this.lastSnapshot = now; this.publishArena(changed); }
  }

  lost(connection) {
    const link = this.links.get(connection);
    if (!link) return;
    this.links.delete(connection); clearTimeout(link.handshakeTimer);
    const fast = link.fast; link.fast = null; fast?.close();
    if (this.isHost) {
      if (!link.accepted) return;
      const wasRacing = !!this.arena; this.arena = null; this.clearInputs();
      const guests = this.guests();
      for (let i = 0; i < guests.length; i++) { guests[i].slot = i + 1; if (wasRacing) guests[i].player.ready = false; }
      this.players = [this.players[0], ...guests.map(guest => guest.player)];
      this.publishLobby();
      const notice = wasRacing ? `${link.player.name} disconnected. Everyone is back in the lobby; choose READY for a new picnic.` :
        `${link.player.name} left the room. You can invite another friend.`;
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
