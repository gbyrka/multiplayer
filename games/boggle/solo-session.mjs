/** Local practice uses the same authoritative rules, views and timers, without PeerJS. */
export class SoloSession {
  #state = null;
  constructor({ game, onView, onError }) {
    Object.assign(this, { game, onView, onError, isHost: true, isSolo: true, playerId: 'solo', closed: false });
  }
  async create(name) {
    if (this.closed) return;
    this.#state = this.game.adapter.createLobby(this.playerId, name);
    this.#publish();
  }
  act(type, payload = {}) {
    if (this.closed || !this.#state) return;
    try {
      this.#state = this.game.adapter.applyAction(this.#state, this.playerId, type, payload);
      this.#publish();
    } catch (error) { this.onError(error.message); }
  }
  #publish() {
    if (this.closed || !this.#state) return;
    clearTimeout(this.transitionTimer);
    const snapshot = this.#state;
    this.view = this.game.adapter.buildViewForPlayer(snapshot, this.playerId);
    this.revision = this.view.revision;
    this.onView(this.view);
    if (this.closed || this.#state !== snapshot) return;
    const transition = this.game.adapter.automaticTransition(snapshot);
    if (transition) this.transitionTimer = setTimeout(() => {
      if (!this.closed && this.#state === snapshot) {
        this.#state = transition.apply(snapshot);
        this.#publish();
      }
    }, transition.delay);
  }
  close() {
    this.closed = true;
    clearTimeout(this.transitionTimer);
    this.#state = null;
  }
}
