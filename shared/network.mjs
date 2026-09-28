import { message, isMessage } from './protocol.mjs';
import { randomToken } from './random.mjs';

const CONNECT_TIMEOUT = 20000;
const HEARTBEAT_INTERVAL = 8000;
const DEAD_CONNECTION = 60000;

export function connectionError(error) {
  const messages = {
    'peer-unavailable': 'Room not found. Check the code and try again.',
    'browser-incompatible': 'This browser does not support WebRTC. Please try a current browser.',
    'unavailable-id': 'This room code is already in use.',
    'network': 'Connection failed. Check your internet connection and try again.',
    'timeout': 'Connection failed. The room or network did not respond. Try again, or try another network.',
  };
  const result = new Error(messages[error?.type] ?? 'Connection failed. Please try again.');
  result.code = error?.type ?? 'connection-failed';
  return result;
}

/** Generic STAR transport. It knows peers and health, never hands, bids or scores. */
export class StarNetwork {
  constructor({ Peer, namespace, onConnection, onData, onLost, onStatus, onFatal }) {
    Object.assign(this, { Peer, namespace, onConnection, onData, onLost, onStatus, onFatal });
    this.connections = new Map();
    this.disposed = false;
    this.lastTick = Date.now();
  }

  async open(host, roomCode) {
    this.host = host;
    this.onStatus('Connecting...');
    await new Promise((resolve, reject) => {
      let opened = false;
      let settled = false;
      const finish = error => {
        if (settled) return;
        settled = true;
        clearTimeout(this.openTimeout);
        this.cancelOpen = null;
        if (error) reject(error); else resolve();
      };
      this.cancelOpen = () => finish(new Error('Connection cancelled.'));
      this.openTimeout = setTimeout(() => finish(connectionError({ type: 'timeout' })), CONNECT_TIMEOUT);
      const id = host ? `${this.namespace}${roomCode}` : `guest-${randomToken(24)}`;
      // PeerJS defaults to the public PeerServer Cloud and its built-in ICE settings.
      this.peer = new this.Peer(id, { debug: 0 });
      this.peer.on('open', () => {
        if (this.disposed) return;
        opened = true;
        clearTimeout(this.retryTimer);
        this.retryTimer = null;
        this.retryCount = 0;
        this.onStatus('Connected');
        finish();
      });
      this.peer.on('connection', connection => {
        if (this.disposed || !this.host || this.connections.size >= 12) { connection.close(); return; }
        this.#watch(connection);
      });
      this.peer.on('call', call => call.close());
      this.peer.on('disconnected', () => {
        if (!this.disposed && opened) this.#retrySignaling();
      });
      this.peer.on('error', error => {
        if (this.disposed) return;
        if (!opened) { finish(connectionError(error)); return; }
        if (error.type === 'peer-unavailable' && this.joinReject) {
          this.joinReject(connectionError(error));
        } else if (['network', 'socket-error', 'socket-closed', 'disconnected'].includes(error.type) && !this.peer.destroyed) {
          this.#retrySignaling();
        } else if (error.type !== 'webrtc' && error.type !== 'peer-unavailable') {
          this.onFatal(connectionError(error));
        }
      });
      this.peer.on('close', () => {
        if (!this.disposed) this.onFatal(new Error('Connection lost.'));
      });
    });
    if (this.disposed) throw new Error('Connection cancelled.');
    this.heartbeat = setInterval(() => this.#healthCheck(), HEARTBEAT_INTERVAL);
    if (!host) {
      await new Promise((resolve, reject) => {
        let settled = false;
        const finish = error => {
          if (settled) return;
          settled = true;
          clearTimeout(this.joinTimeout);
          this.joinReject = null;
          if (error) reject(error); else resolve();
        };
        this.joinReject = error => finish(error);
        this.joinTimeout = setTimeout(() => finish(connectionError({ type: 'timeout' })), CONNECT_TIMEOUT);
        const connection = this.peer.connect(`${this.namespace}${roomCode}`, {
          reliable: true, serialization: 'json', label: 'multiplayer-v1',
        });
        this.hostConnection = connection;
        this.#watch(connection, finish);
      });
    }
  }

  #watch(connection, onOpen) {
    const record = { lastSeen: Date.now(), windowStart: Date.now(), count: 0, active: false };
    this.connections.set(connection, record);
    record.timeout = setTimeout(() => {
      if (!record.active) { onOpen?.(connectionError({ type: 'timeout' })); this.drop(connection); }
    }, CONNECT_TIMEOUT);
    connection.on('open', () => {
      if (this.disposed || !this.connections.has(connection)) { connection.close(); return; }
      clearTimeout(record.timeout);
      // No partial reliability and no unordered delivery are permitted.
      const channel = connection.dataChannel;
      if (channel && (!channel.ordered || channel.maxRetransmits != null || channel.maxPacketLifeTime != null)) {
        onOpen?.(new Error('A reliable connection could not be established.'));
        this.drop(connection);
        return;
      }
      record.active = true;
      record.lastSeen = Date.now();
      this.onConnection(connection);
      onOpen?.();
    });
    connection.on('data', data => {
      if (this.disposed || !this.connections.has(connection)) return;
      const now = Date.now();
      if (now - record.windowStart > 10000) { record.windowStart = now; record.count = 0; }
      if (++record.count > 100) { this.drop(connection); return; }
      if (!isMessage(data, this.host ? 1024 : 32768)) return;
      record.lastSeen = now;
      if (data.type === 'PING') { this.send(connection, message('PONG', {}, data.requestId)); return; }
      if (data.type === 'PONG') return;
      this.onData(connection, data);
    });
    connection.on('close', () => {
      onOpen?.(new Error('Connection lost.'));
      this.#lost(connection);
    });
    connection.on('error', () => {
      onOpen?.(new Error('Connection failed. Please try again.'));
      this.drop(connection);
    });
  }

  #retrySignaling() {
    if (this.disposed || this.retryTimer) return;
    this.onStatus('Retrying...');
    this.retryCount = (this.retryCount ?? 0) + 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.disposed || this.peer.destroyed) return;
      if (this.peer.disconnected) {
        try { this.peer.reconnect(); } catch { /* Next bounded retry handles this. */ }
      }
      if (this.retryCount < 5) this.#retrySignaling();
      else this.onStatus('Connection service unavailable. Existing players can keep playing.');
    }, Math.min(this.retryCount * 2000, 10000));
  }

  #healthCheck() {
    const now = Date.now();
    const wakingUp = now - this.lastTick > HEARTBEAT_INTERVAL * 3;
    this.lastTick = now;
    for (const [connection, record] of this.connections) {
      if (wakingUp) record.lastSeen = now;
      if (now - record.lastSeen > DEAD_CONNECTION) this.drop(connection);
      else if (record.active) this.send(connection, message('PING'));
    }
  }

  #lost(connection) {
    const record = this.connections.get(connection);
    if (!record) return;
    clearTimeout(record.timeout);
    this.connections.delete(connection);
    if (!this.disposed) this.onLost(connection);
  }

  send(connection, data) {
    if (this.disposed || !connection?.open || !this.connections.has(connection)) return false;
    try { connection.send(data); return true; } catch { this.drop(connection); return false; }
  }

  drop(connection) {
    this.#lost(connection);
    try { connection.close(); } catch { /* Already closed. */ }
  }

  destroy() {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelOpen?.();
    this.joinReject?.(new Error('Connection cancelled.'));
    clearTimeout(this.openTimeout);
    clearTimeout(this.joinTimeout);
    clearTimeout(this.retryTimer);
    clearInterval(this.heartbeat);
    for (const [connection, record] of this.connections) {
      clearTimeout(record.timeout);
      try { connection.close(); } catch { /* Already closed. */ }
    }
    this.connections.clear();
    this.peer?.destroy();
  }
}
