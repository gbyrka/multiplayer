import { StarNetwork } from './network.mjs';
import { ACTION_TYPES, RequestCache, acceptRevision, isClientMessage, isMessage, message } from './protocol.mjs';
import { createRoomCode, isValidRoomCode, randomToken, validateName } from './random.mjs';

/** A reusable authoritative room. A game adapter owns every game-specific rule. */
export class GameRoom {
  #state = null;
  constructor({ Peer, game, onView, onStatus, onError, onEnded, debug = false, Network = StarNetwork }) {
    Object.assign(this, { Peer, game, onView, onStatus, onError, onEnded, debug, Network });
    this.bindings = new Map();
    this.localRequests = new RequestCache();
    this.revision = -1;
    this.closed = false;
  }

  #network() {
    const network = new this.Network({
      Peer: this.Peer, namespace: this.game.peerNamespace,
      onConnection: connection => {
        if (this.network !== network || this.closed) return;
        if (this.isHost) {
          const binding = { playerId: null, requests: new RequestCache() };
          binding.timeout = setTimeout(() => network.drop(connection), 15000);
          this.bindings.set(connection, binding);
        }
      },
      onData: (connection, data) => { if (this.network === network && !this.closed) this.#receive(connection, data); },
      onLost: connection => { if (this.network === network && !this.closed) this.#lost(connection); },
      onStatus: status => { if (this.network === network && !this.closed) this.onStatus(status); },
      onFatal: error => { if (this.network === network && !this.closed) this.#end(error.message); },
    });
    this.network = network;
    return network;
  }

  async create(name) {
    name = validateName(name);
    this.isHost = true;
    this.playerId = randomToken();
    for (let attempt = 0; attempt < 5; attempt++) {
      this.roomCode = createRoomCode();
      const network = this.#network();
      try {
        await network.open(true, this.roomCode);
        if (this.closed) throw new Error('Connection cancelled.');
        this.#state = this.game.adapter.createLobby(this.playerId, name);
        this.#publish();
        return;
      } catch (error) {
        network.destroy();
        if (error.code !== 'unavailable-id' || attempt === 4 || this.closed) throw error;
        this.onStatus('Retrying...');
      }
    }
  }

  async join(name, roomCode) {
    name = validateName(name);
    if (!isValidRoomCode(roomCode)) throw new Error('Enter the 8-character room code.');
    this.isHost = false;
    this.roomCode = roomCode;
    const network = this.#network();
    await network.open(false, roomCode);
    if (this.closed) throw new Error('Connection cancelled.');
    this.onStatus('Waiting for host...');
    await new Promise((resolve, reject) => {
      this.joinResolve = resolve;
      this.joinReject = reject;
      this.joinTimer = setTimeout(() => {
        this.joinReject = this.joinResolve = null;
        reject(new Error('Connection failed. The host did not respond. Please try again.'));
      }, 15000);
      network.send(network.hostConnection, message('JOIN_REQUEST', { nickname: name }));
    });
  }

  #receive(connection, data) {
    if (this.isHost) {
      if (!isClientMessage(data)) {
        if (isMessage(data, 1024)) this.#error(connection, data.requestId, 'Invalid request.');
        return;
      }
      const binding = this.bindings.get(connection);
      if (!binding || binding.rejected) return;
      if (data.type === 'JOIN_REQUEST') { this.#joinRequest(connection, binding, data); return; }
      if (!binding.playerId || !ACTION_TYPES.has(data.type)) return;
      this.#action(binding.playerId, data, binding.requests, connection);
    } else {
      if (connection !== this.network.hostConnection || !isMessage(data)) return;
      const { type, payload } = data;
      if (type === 'JOIN_ACCEPTED' && typeof payload.playerId === 'string' && payload.roomCode === this.roomCode && payload.gameId === this.game.id) {
        this.playerId = payload.playerId;
      } else if (type === 'JOIN_REJECTED') {
        const error = new Error(typeof payload.message === 'string' ? payload.message : 'Unable to join this room.');
        clearTimeout(this.joinTimer);
        this.joinReject?.(error);
        this.joinReject = this.joinResolve = null;
      } else if (type === 'STATE_UPDATE') {
        const view = payload.view;
        if (!this.playerId || !view || view.me?.id !== this.playerId || !Array.isArray(view.players) ||
            !this.game.phases.includes(view.phase) || !acceptRevision(this.revision, view.revision)) return;
        this.revision = view.revision;
        this.view = view;
        this.onView(view);
        this.#log(view);
        if (this.joinResolve) {
          clearTimeout(this.joinTimer);
          this.onStatus('Connected');
          this.joinResolve();
          this.joinReject = this.joinResolve = null;
        }
      } else if (type === 'ERROR') {
        this.onError(typeof payload.message === 'string' ? payload.message : 'That move could not be made.');
      }
    }
  }

  #joinRequest(connection, binding, data) {
    if (binding.playerId) {
      this.network.send(connection, message('JOIN_ACCEPTED', { playerId: binding.playerId, roomCode: this.roomCode, gameId: this.game.id }, data.requestId));
      this.#sendView(connection, binding.playerId);
      return;
    }
    try {
      const nickname = validateName(data.payload.nickname);
      const id = randomToken();
      this.#state = this.game.adapter.addPlayer(this.#state, id, nickname);
      binding.playerId = id;
      clearTimeout(binding.timeout);
      this.network.send(connection, message('JOIN_ACCEPTED', { playerId: id, roomCode: this.roomCode, gameId: this.game.id }, data.requestId));
      this.#publish();
    } catch (error) {
      binding.rejected = true;
      this.network.send(connection, message('JOIN_REJECTED', { message: error.message }, data.requestId));
      clearTimeout(binding.timeout);
      binding.timeout = setTimeout(() => this.network.drop(connection), 500);
    }
  }

  #error(connection, requestId, text) {
    if (connection) this.network.send(connection, message('ERROR', { message: text }, requestId));
    else this.onError(text);
  }

  #action(playerId, data, requests, connection = null) {
    if (requests.has(data.requestId)) return;
    requests.add(data.requestId);
    try {
      if (data.type !== 'SET_READY' && data.baseRevision !== this.#state.revision) {
        throw new Error('The table changed. Please try your move again.');
      }
      this.#state = this.game.adapter.applyAction(this.#state, playerId, data.type, data.payload);
      this.#publish();
    } catch (error) {
      this.#error(connection, data.requestId, error.message);
      if (connection) this.#sendView(connection, playerId);
    }
  }

  act(type, payload = {}) {
    if (this.closed || !this.view || !ACTION_TYPES.has(type)) return;
    const data = { ...message(type, payload), baseRevision: this.revision };
    if (this.isHost) this.#action(this.playerId, data, this.localRequests);
    else if (!this.network.send(this.network.hostConnection, data)) this.#end('Connection lost.');
  }

  #sendView(connection, playerId) {
    this.network.send(connection, message('STATE_UPDATE', { view: this.game.adapter.buildViewForPlayer(this.#state, playerId) }));
  }

  #publish() {
    if (this.closed || !this.#state) return;
    clearTimeout(this.transitionTimer);
    const snapshot = this.#state;
    // Each send builds an independent view. The host UI follows the same privacy boundary.
    this.view = this.game.adapter.buildViewForPlayer(snapshot, this.playerId);
    this.revision = this.view.revision;
    this.onView(this.view);
    this.#log(this.view);
    for (const [connection, binding] of this.bindings) {
      if (binding.playerId && connection.open) this.#sendView(connection, binding.playerId);
      // A send failure can synchronously disconnect someone and publish a newer state.
      if (this.#state !== snapshot) return;
    }
    const transition = this.game.adapter.automaticTransition(snapshot);
    if (transition) this.transitionTimer = setTimeout(() => {
      if (!this.closed && this.#state === snapshot) {
        this.#state = transition.apply(snapshot);
        this.#publish();
      }
    }, transition.delay);
  }

  #lost(connection) {
    if (this.isHost) {
      const binding = this.bindings.get(connection);
      if (!binding) return;
      clearTimeout(binding.timeout);
      this.bindings.delete(connection);
      if (binding.playerId && this.#state) {
        this.#state = this.game.adapter.removePlayer(this.#state, binding.playerId);
        this.#publish();
      }
    } else this.#end('The game has ended because the host connection was lost.');
  }

  #log(view) {
    if (this.debug) console.debug('[multiplayer]', { phase: view.phase, revision: view.revision });
  }

  #end(reason) {
    if (this.closed) return;
    const wasJoined = Boolean(this.view);
    this.joinReject?.(new Error(reason));
    this.close();
    if (wasJoined) this.onEnded(reason);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.transitionTimer);
    clearTimeout(this.joinTimer);
    this.joinReject?.(new Error('Connection cancelled.'));
    this.joinResolve = this.joinReject = null;
    for (const binding of this.bindings.values()) clearTimeout(binding.timeout);
    this.bindings.clear();
    this.network?.destroy();
    this.#state = null;
  }
}
