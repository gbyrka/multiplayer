import { GameSound } from '../../shared/sound.mjs';

/** Quiet wooden taps, tiny squeaks and a golden-treat chime, all synthesized. */
export class HamsterSound extends GameSound {
  receive(state, own) {
    if (this.arenaId !== state.id) { this.arenaId = state.id; this.lastEvent = 0; }
    for (const event of state.events) {
      if (event.id <= this.lastEvent) continue;
      this.lastEvent = event.id;
      if (state.phase !== 'playing' || state.tick - event.tick > 45) continue;
      if (event.slot === own || ['bump', 'squeak', 'bloom'].includes(event.type)) this.note(event.type, event.slot === own);
    }
  }
  note(kind, own) {
    if (!this.enabled || document.hidden || this.context?.state !== 'running') return;
    try {
      const profiles = { collect: [680, 1050, .1], eat: [400, 900, .23], drink: [600, 420, .17], dash: [180, 90, .14],
        bump: [150, 65, .16], squeak: [1500, 2400, .16], bloom: [780, 1560, .48], 'wheel-bonus': [520, 1040, .3] };
      const profile = profiles[kind]; if (!profile) return;
      const oscillator = this.context.createOscillator(), gain = this.context.createGain(), now = this.context.currentTime;
      oscillator.type = kind === 'bump' || kind === 'dash' ? 'triangle' : 'sine';
      oscillator.frequency.setValueAtTime(profile[0], now); oscillator.frequency.exponentialRampToValueAtTime(profile[1], now + profile[2]);
      gain.gain.setValueAtTime(.0001, now); gain.gain.exponentialRampToValueAtTime(own ? .08 : .025, now + .012);
      gain.gain.exponentialRampToValueAtTime(.0001, now + profile[2]);
      oscillator.connect(gain).connect(this.master); this.sources.add(oscillator);
      oscillator.onended = () => { this.sources.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
      oscillator.start(); oscillator.stop(now + profile[2]);
    } catch { /* Optional audio must not affect the round. */ }
  }
}
