import { StarNetwork } from '../../shared/network.mjs';
import { message } from '../../shared/protocol.mjs';
import { createRoomCode, randomToken, validateName, isValidRoomCode } from '../../shared/random.mjs';
import { createRace, advanceRace, resetRig, snapshot, validSnapshot, acceptInputFrames, setHorn } from './race.mjs';
import { STEP, INPUT } from './physics.mjs';

const FAST_LABEL = 'tow-state-v1';

/** PLAN's room discovery, with a separate unordered channel for transient data. */
export class RaceSession {
  constructor({ Peer, version, onLobby, onSnapshot, onStatus, onEnded, onNotice = () => {} }) {
    Object.assign(this, { Peer, version, onLobby, onSnapshot, onStatus, onEnded, onNotice });
    this.closed = false; this.players = []; this.fast = null; this.race = null;
    this.inputQueue = new Map(); this.mask = 0; this.guestMask = 0; this.pausedPhase = null;
    this.lastInput = 0; this.rtt = 0; this.delay = 0; this.loss = 0; this.lastSnapshot = 0;
    this.pendingTimers = new Set(); this.lastPing = 0;
    this.visibilityHandler = () => { if (document.hidden && this.isHost) this.pause(); };
    document.addEventListener('visibilitychange', this.visibilityHandler);
  }

  networkFor() {
    const network = new StarNetwork({ Peer: this.Peer, namespace: 'tow-v1-',
      onConnection: connection => {
        if (this.closed || this.network !== network) return;
        if (this.isHost && this.connection) {
          network.send(connection, message('JOIN_REJECTED', { message: 'This room already has two players.' }));
          const timer = setTimeout(() => { this.pendingTimers.delete(timer); network.drop(connection); }, 250);
          this.pendingTimers.add(timer); return;
        }
        this.connection = connection;
        const peerConnection = connection.peerConnection, peerHandler = peerConnection.ondatachannel;
        // PeerJS adopts every incoming channel as its DataConnection. Keep its
        // reliable channel intact and take ownership only of our extra channel.
        peerConnection.ondatachannel = event => {
          if (event.channel.label === FAST_LABEL && !this.isHost) this.watchFast(event.channel);
          else peerHandler?.call(peerConnection, event);
        };
        this.handshakeTimer = setTimeout(() => { if (!this.accepted) network.drop(connection); }, 15000);
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
    this.isHost = false; this.slot = 1; this.name = validateName(name);
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

  sendControl(type, payload = {}) { return this.network?.send(this.connection, message(type, payload)); }

  receiveControl(connection, data) {
    if (connection !== this.connection) return;
    const payload = data.payload;
    if (this.isHost) {
      if (data.type === 'JOIN_REQUEST') {
        if (this.accepted) {
          this.sendControl('JOIN_ACCEPTED', { slot: 1 });
          if (this.race) this.sendControl('STATE_UPDATE', { kind: 'race', state: snapshot(this.race) }); else this.publishLobby();
          return;
        }
        try {
          if (this.race || this.players.length !== 1) throw new Error('This room already has two players.');
          if (payload.appVersion !== this.version) throw new Error('Different game versions. Both players should reload.');
          this.players.push({ name: validateName(payload.nickname), ready: false });
          this.accepted = true; clearTimeout(this.handshakeTimer);
          this.sendControl('JOIN_ACCEPTED', { slot: 1 });
          this.watchFast(connection.peerConnection.createDataChannel(FAST_LABEL, { ordered: false, maxRetransmits: 0 }));
          this.publishLobby();
        } catch (error) { this.sendControl('JOIN_REJECTED', { message: error.message }); }
        return;
      }
      if (!this.accepted) return;
      if (data.type === 'SET_READY' && !this.race && typeof payload.ready === 'boolean') { this.players[1].ready = payload.ready; this.publishLobby(); }
      if (data.type === 'PLAY_AGAIN' && payload.action === 'reset' && payload.id === this.race?.id) this.reset(1);
      if (data.type === 'PLAY_AGAIN' && payload.action === 'horn' && payload.id === this.race?.id && typeof payload.pressed === 'boolean') {
        if (setHorn(this.race, 1, payload.pressed)) this.publishRace(true);
      }
      if (data.type === 'RETURN_TO_LOBBY') this.network.drop(connection);
    } else {
      if (data.type === 'JOIN_ACCEPTED' && payload.slot === 1) { this.accepted = true; clearTimeout(this.handshakeTimer); }
      if (data.type === 'JOIN_REJECTED') { this.joinReject?.(new Error(payload.message || 'Unable to join.')); return; }
      if (!this.accepted) return;
      if (data.type === 'STATE_UPDATE') {
        if (payload.kind === 'lobby' && this.validLobby(payload)) {
          this.race = null; this.players = payload.players;
          this.onLobby({ ...payload, slot: 1, roomCode: this.roomCode, fast: this.fast?.readyState === 'open' });
          clearTimeout(this.joinTimer); this.joinResolve?.(); this.joinResolve = this.joinReject = null;
        }
        if (payload.kind === 'race' && validSnapshot(payload.state)) {
          this.remoteRaceId = payload.state.id; this.remotePhase = payload.state.phase;
          this.onSnapshot(payload.state, performance.now());
        }
      }
      if (data.type === 'ERROR' && typeof payload.message === 'string') this.onNotice(payload.message);
    }
  }

  validLobby(payload) {
    return Array.isArray(payload.players) && payload.players.length <= 2 && payload.players.length > 0 &&
      payload.players.every(p => p && typeof p.name === 'string' && p.name.length <= 16 && typeof p.ready === 'boolean');
  }

  watchFast(channel) {
    if (this.closed || this.fast) { channel.close(); return; }
    if (channel.ordered || channel.maxRetransmits !== 0) { channel.close(); this.end('The racing connection could not be established.'); return; }
    this.fast = channel;
    channel.addEventListener('open', () => {
      if (this.closed) return;
      this.onStatus('Connected');
      if (this.isHost) this.publishLobby();
      else if (this.players.length && !this.remoteRaceId) this.onLobby({ players: this.players, slot: 1, roomCode: this.roomCode, fast: true });
    });
    channel.addEventListener('message', event => {
      if (this.closed || typeof event.data !== 'string' || event.data.length > 16000) return;
      let data; try { data = JSON.parse(event.data); } catch { return; }
      if (!data || typeof data !== 'object') return;
      const now = performance.now();
      // Delay/loss settings model this browser's outgoing path; ping sees both paths.
      if (data.kind === 'ping' && Number.isFinite(data.at)) { this.sendFast({ kind: 'pong', at: data.at }); return; }
      if (data.kind === 'pong' && Number.isFinite(data.at) && data.at === this.pingAt) {
        const sample = now - data.at; this.rtt = this.rtt ? this.rtt * .75 + sample * .25 : sample; return;
      }
      if (this.isHost && this.race && acceptInputFrames(this.race, this.inputQueue, data)) this.lastInput = now;
      if (!this.isHost && data.kind === 'snapshot' && validSnapshot(data.state) && data.state.id === this.remoteRaceId) {
        if (this.remotePhase === 'results' || this.remotePhase === 'paused') return;
        this.onSnapshot(data.state, now);
      }
    });
    channel.addEventListener('close', () => {
      if (this.closed || this.fast !== channel || !this.accepted) return;
      if (this.isHost) this.network.drop(this.connection);
      else this.end('The racing connection was lost. Create a new room to reconnect.');
    });
    channel.addEventListener('error', () => {
      if (this.closed || this.fast !== channel || !this.accepted) return;
      if (this.isHost) this.network.drop(this.connection);
      else this.end('The racing connection failed.');
    });
  }

  sendFast(data) {
    const channel = this.fast;
    if (this.closed || channel?.readyState !== 'open' || channel.bufferedAmount > 32768) return false;
    if (this.loss && Math.random() * 100 < this.loss) return false;
    const encoded = JSON.stringify(data);
    const send = () => { if (!this.closed && channel.readyState === 'open' && channel.bufferedAmount < 32768) { try { channel.send(encoded); } catch { /* Closure is handled by the channel event. */ } } };
    if (this.delay) {
      const timer = setTimeout(() => { this.pendingTimers.delete(timer); send(); }, this.delay); this.pendingTimers.add(timer);
    } else send();
    return true;
  }

  publishLobby() {
    if (this.closed) return;
    const lobby = { kind: 'lobby', players: this.players.map(p => ({ ...p })), fast: this.fast?.readyState === 'open' };
    this.sendControl('STATE_UPDATE', lobby);
    this.onLobby({ ...lobby, slot: 0, roomCode: this.roomCode });
  }

  ready(value) { if (!this.isHost) this.sendControl('SET_READY', { ready: value }); }

  start() {
    if (!this.isHost || this.players.length !== 2 || !this.players.every(p => p.ready) || this.fast?.readyState !== 'open' || (this.race && this.race.phase !== 'results')) return false;
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    this.race = createRace(seed, randomToken()); this.inputQueue.clear(); this.guestMask = 0; this.mask = 0;
    this.hornPressed = false; this.lastHornSend = 0;
    this.pausedPhase = null; this.lastInput = performance.now(); this.accumulator = 0; this.previous = performance.now();
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
    else this.sendControl('ERROR', { message: 'Reset available every 8 seconds during the race (+3 seconds).' });
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
    setHorn(this.race, 0, false); setHorn(this.race, 1, false); this.hornPressed = false;
    this.inputQueue.clear(); this.publishRace(true);
  }
  resume() {
    if (!this.isHost || this.race?.phase !== 'paused' || document.hidden) return;
    this.race.phase = this.pausedPhase; this.race.epoch++; this.inputQueue.clear(); this.guestMask = INPUT.BRAKE; this.lastInput = performance.now();
    this.accumulator = 0; this.previous = performance.now(); this.publishRace(true);
  }

  startClock() {
    this.previous = performance.now(); this.accumulator = 0;
    this.clock = setInterval(() => this.clockTick(), 8);
  }
  clockTick() {
    if (this.closed) return;
    const now = performance.now(), delta = (now - this.previous) / 1000; this.previous = now;
    if (now - this.lastPing > 1000 && this.fast?.readyState === 'open') { this.lastPing = now; this.pingAt = now; this.sendFast({ kind: 'ping', at: now }); }
    if (!this.isHost || !this.race || !['countdown', 'racing'].includes(this.race.phase)) return;
    if (delta > .5) { this.pause(); return; }
    this.accumulator += delta;
    let changed = false;
    while (this.accumulator >= STEP) {
      const phase = this.race.phase, tick = this.race.tick + 1;
      if (this.inputQueue.has(tick)) this.guestMask = this.inputQueue.get(tick);
      this.inputQueue.delete(tick);
      const guestMask = now - this.lastInput > 350 ? INPUT.BRAKE : this.guestMask;
      advanceRace(this.race, [this.mask, guestMask]); this.accumulator -= STEP;
      changed ||= this.race.phase !== phase;
      if (this.race.phase === 'results') { this.accumulator = 0; break; }
    }
    if (changed || now - this.lastSnapshot >= 50) { this.lastSnapshot = now; this.publishRace(changed); }
  }

  lost(connection) {
    if (connection !== this.connection) return;
    this.connection = null; this.accepted = false;
    clearTimeout(this.handshakeTimer);
    if (this.isHost) {
      const fast = this.fast; this.fast = null; fast?.close();
      this.race = null; this.players = this.players.slice(0, 1); this.inputQueue.clear(); this.publishLobby();
      this.onNotice('The other player disconnected. Share the room link to join again.');
    } else this.end('The host disconnected. Create or join a new room.');
  }

  end(reason) { if (this.closed) return; this.close(); this.onEnded(reason); }
  close() {
    if (this.closed) return;
    this.closed = true; clearInterval(this.clock); clearTimeout(this.joinTimer); clearTimeout(this.handshakeTimer);
    for (const timer of this.pendingTimers) clearTimeout(timer); this.pendingTimers.clear();
    document.removeEventListener('visibilitychange', this.visibilityHandler);
    this.joinReject?.(new Error('Connection cancelled.')); this.joinResolve = this.joinReject = null;
    this.fast?.close(); this.network?.destroy();
  }
}
