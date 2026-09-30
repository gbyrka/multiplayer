/** Small, original sounds synthesized locally. No downloads or audio dependencies. */
export function createSoundBuffer(context, kind) {
  const victory = kind === 'victory';
  const duration = victory ? 2.35 : .19;
  const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
  const samples = buffer.getChannelData(0);
  const notes = [[0, 523.25, .14], [.16, 659.25, .13], [.32, 783.99, .12], [.54, 1046.50, .11], [.54, 261.63, .05]];
  let softenedNoise = 0;
  for (let i = 1; i < samples.length; i++) {
    const t = i / context.sampleRate;
    if (victory) {
      for (const [start, frequency, volume] of notes) {
        const age = t - start;
        if (age < 0) continue;
        const envelope = Math.min(1, age / .012) * Math.exp(-age * 3.2);
        const phase = 2 * Math.PI * frequency * age;
        samples[i] += volume * envelope * (Math.sin(phase) + .12 * Math.sin(phase * 2) + .025 * Math.sin(phase * 3));
      }
      samples[i] *= Math.min(1, (duration - t) / .15);
    } else {
      // A soft paper brush and a low wooden tap, with no sharp initial click.
      softenedNoise += .14 * ((Math.random() * 2 - 1) - softenedNoise);
      const attack = Math.min(1, t / .006);
      const paper = softenedNoise * .26 * Math.exp(-t * 27);
      const tap = Math.sin(2 * Math.PI * (245 * t - 150 * t * t)) * .09 * Math.exp(-t * 42);
      samples[i] = attack * (paper + tap) * Math.min(1, (duration - t) / .035);
    }
  }
  return buffer;
}

export class GameSound {
  constructor() {
    this.enabled = true;
    this.context = null;
    this.buffers = new Map();
    this.sources = new Set();
    try { this.enabled = localStorage.getItem('multiplayer:sound') !== 'off'; } catch { /* Storage is optional. */ }
  }

  /** Called only from a user gesture, including taps on the entry form. */
  unlock() {
    if (!this.enabled) return;
    try {
      if (!this.context) {
        const Audio = window.AudioContext ?? window.webkitAudioContext;
        if (!Audio) return;
        this.context = new Audio({ latencyHint: 'interactive' });
        this.master = this.context.createGain();
        this.master.gain.value = .8;
        this.master.connect(this.context.destination);
      }
      if (this.context.state === 'suspended') void this.context.resume().catch(() => {});
    } catch { /* Audio must never interrupt a game. */ }
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    try { localStorage.setItem('multiplayer:sound', enabled ? 'on' : 'off'); } catch { /* Storage is optional. */ }
    if (!enabled) this.stop();
    if (enabled) this.unlock();
  }

  play(kind, ownCard = false) {
    if (!this.enabled || document.hidden || this.context?.state !== 'running') return;
    try {
      if (!this.buffers.has(kind)) this.buffers.set(kind, createSoundBuffer(this.context, kind));
      const source = this.context.createBufferSource();
      const gain = this.context.createGain();
      source.buffer = this.buffers.get(kind);
      gain.gain.value = kind === 'victory' ? .62 : ownCard ? .72 : .48;
      source.connect(gain).connect(this.master);
      this.sources.add(source);
      source.onended = () => { this.sources.delete(source); source.disconnect(); gain.disconnect(); };
      source.start();
    } catch { /* An unavailable audio device is not a connection failure. */ }
  }

  stop() {
    for (const source of this.sources) { try { source.stop(); } catch { /* Already stopped. */ } }
    this.sources.clear();
  }
}
