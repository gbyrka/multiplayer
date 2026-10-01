import { INPUT, clamp } from './physics.mjs';
import { seededRandom } from './track.mjs';
import { engineGear, spatialMix, vehicleSound, SoundTimeline } from './audio-model.mjs';

function makeBuffer(context, duration, sample) {
  const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate), data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = sample(i / context.sampleRate, i, data.length);
  return buffer;
}

/** Four uneven combustion strokes in one 720-degree cycle, with intake/exhaust grit. */
export function combustionBuffer(context, seed = 123) {
  const random = seededRandom(seed), weights = [1, .91, 1.03, .96];
  const buffer = makeBuffer(context, 16384 / context.sampleRate, (t, i, length) => {
    const stroke = i / length * 4, phase = stroke % 1;
    return weights[Math.floor(stroke)] * Math.min(1, phase * 40) * Math.exp(-phase * 8) *
      (Math.sin(phase * Math.PI * 2.6) + .42 * Math.sin(phase * Math.PI * 7.4) + (random() * 2 - 1) * .16);
  });
  const data = buffer.getChannelData(0), mean = data.reduce((sum, value) => sum + value, 0) / data.length;
  for (let i = 0; i < data.length; i++) data[i] -= mean;
  return buffer;
}

export function noiseBuffer(context, pink = false) {
  const random = seededRandom(pink ? 397 : 981); let previous = 0;
  return makeBuffer(context, 2, () => {
    const white = random() * 2 - 1; previous = previous * .965 + white * .035;
    return pink ? previous * 3 : white;
  });
}

export function effectBuffer(context, kind, strength = .5, material = 'vehicle') {
  const random = seededRandom(931 + Math.round(strength * 1000)), tau = Math.PI * 2;
  if (kind === 'impact') {
    const duration = .23 + strength * .32; let bassNoise = 0;
    return makeBuffer(context, duration, t => {
      const noise = random() * 2 - 1; bassNoise += .16 * (noise - bassNoise);
      const attack = Math.min(1, t / .002), fade = Math.min(1, (duration - t) / .04);
      const body = Math.sin(tau * (74 * t - 28 * t * t)) * .42 * Math.exp(-t * 23);
      const crunch = (noise * .14 + bassNoise * .45) * Math.exp(-t * (16 - strength * 7));
      const metal = material === 'curb' ? .025 : .12;
      const ring = (Math.sin(tau * 437 * t) + .55 * Math.sin(tau * 791 * t) + .3 * Math.sin(tau * 1271 * t)) * metal * Math.exp(-t * 13);
      return (body + crunch + ring) * attack * fade;
    });
  }
  if (kind === 'rattle') return makeBuffer(context, 1, t => {
    const age = (t + .019) % .137;
    return Math.min(1, age / .002) * Math.exp(-age * 85) * (.12 * Math.sin(tau * 1087 * age) + .08 * (random() * 2 - 1));
  });
  const notes = {
    countdown: [[0, 880, .12]], go: [[0, 1320, .25], [0, 1760, .19]],
    checkpoint: [[0, 1046.5, .07], [.08, 1318.5, .05]],
    finish: [[0, 659.25, .16], [.16, 830.6, .16], [.32, 987.77, .23], [.47, 1318.5, .23]],
    reset: [[0, 440, .11], [.12, 330, .13]], reverse: [[0, 1050, .11]],
  }[kind] ?? [];
  const duration = kind === 'finish' ? .85 : kind === 'go' ? .3 : .28;
  return makeBuffer(context, duration, t => {
    let value = 0;
    for (const [start, frequency, length] of notes) {
      const age = t - start;
      if (age < 0 || age > length) continue;
      const envelope = Math.min(1, age / .008) * Math.min(1, (length - age) / .035);
      value += envelope * (.29 * Math.sin(tau * frequency * age) + .035 * Math.sin(tau * frequency * 2 * age));
    }
    return value;
  });
}

const smooth = (parameter, value, context, time = .045) => parameter.setTargetAtTime(value, context.currentTime, time);
function filter(context, type, frequency, q = .7) {
  const node = context.createBiquadFilter(); node.type = type; node.frequency.value = frequency; node.Q.value = q; return node;
}

class VehicleVoice {
  constructor(audio, slot) {
    const context = audio.context;
    this.context = context; this.slot = slot; this.gear = 1; this.rpm = 900; this.nodes = []; this.sources = [];
    this.hornUntil = 0; this.lastHorn = false; this.reverseAt = 0;
    this.gain = this.keep(context.createGain()); this.gain.gain.value = 0;
    this.pan = this.keep(context.createStereoPanner()); this.gain.connect(this.pan).connect(audio.master);
    const loop = (buffer, filters, volume) => {
      const source = this.keep(context.createBufferSource()), gain = this.keep(context.createGain());
      source.buffer = buffer; source.loop = true; gain.gain.value = volume;
      let node = source;
      for (const f of filters) { this.keep(f); node.connect(f); node = f; }
      node.connect(gain).connect(this.gain); source.start(); this.sources.push(source);
      return { source, gain };
    };
    this.exhaustFilter = filter(context, 'lowpass', 1000);
    const combustion = combustionBuffer(context, 123 + slot * 61);
    this.exhaust = loop(combustion, [this.exhaustFilter], .17);
    this.intakeFilter = filter(context, 'bandpass', 1100, .8);
    this.intake = loop(combustion, [this.intakeFilter], .035);
    this.grit = loop(audio.white, [filter(context, 'bandpass', 1800, .7)], .006);
    this.rollingFilter = filter(context, 'lowpass', 850);
    this.rolling = loop(audio.pink, [this.rollingFilter], 0);
    this.skidFilter = filter(context, 'bandpass', 1650, 6);
    this.skid = loop(audio.white, [this.skidFilter], 0);
    this.skidHigh = loop(audio.white, [filter(context, 'bandpass', 2700, 3.5)], 0);
    this.squealGain = this.keep(context.createGain()); this.squealGain.gain.value = 0;
    this.squeal = this.keep(context.createOscillator()); this.squeal.type = 'triangle'; this.squeal.frequency.value = 1200;
    this.squealFilter = this.keep(filter(context, 'lowpass', 3800));
    this.squeal.connect(this.squealGain).connect(this.squealFilter).connect(this.gain); this.squeal.start(); this.sources.push(this.squeal);
    this.rattle = loop(audio.rattle, [filter(context, 'highpass', 500)], 0);
    this.wind = loop(audio.pink, [filter(context, 'highpass', 700), filter(context, 'lowpass', 3600)], 0);
    this.hornGain = this.keep(context.createGain()); this.hornGain.gain.value = 0;
    this.hornFilter = this.keep(filter(context, 'lowpass', 1900)); this.hornGain.connect(this.hornFilter).connect(this.gain);
    this.hornOscillators = [350 + slot * 18, 440 + slot * 24].map(frequency => {
      const oscillator = this.keep(context.createOscillator()); oscillator.type = 'sawtooth'; oscillator.frequency.value = frequency;
      oscillator.connect(this.hornGain); oscillator.start(); this.sources.push(oscillator); return oscillator;
    });
  }
  keep(node) { this.nodes.push(node); return node; }
  honk() { this.hornUntil = Math.max(this.hornUntil, this.context.currentTime + .15); }
  update(audio, rig, mask, listener, own, heldHorn, dt) {
    const context = this.context, mix = spatialMix(rig.car, listener, own);
    this.gear = engineGear(rig.car.speed, this.gear);
    const model = vehicleSound(rig, mask, this.gear);
    this.rpm += (model.rpm - this.rpm) * (1 - Math.exp(-9 * dt));
    const rate = this.exhaust.source.buffer.duration * this.rpm / 120 * mix.doppler;
    smooth(this.gain.gain, mix.gain, context); smooth(this.pan.pan, mix.pan, context);
    smooth(this.exhaust.source.playbackRate, rate, context, .025); smooth(this.intake.source.playbackRate, rate, context, .025);
    smooth(this.exhaustFilter.frequency, 600 + this.rpm * .36 + model.throttle * 1000, context);
    smooth(this.exhaust.gain.gain, .15 + model.throttle * .11 + model.rolling * .05, context);
    smooth(this.intakeFilter.frequency, 700 + this.rpm * .21, context);
    smooth(this.intake.gain.gain, .02 + model.throttle * .055, context);
    smooth(this.grit.gain.gain, .004 + model.throttle * .015 + model.rolling * .007, context);
    smooth(this.rollingFilter.frequency, 450 + model.rolling * 1000, context);
    smooth(this.rolling.gain.gain, .045 * model.rolling, context);
    smooth(this.skidFilter.frequency, 1200 + model.skid * 950 + Math.sin(context.currentTime * 13) * 100, context);
    smooth(this.skid.gain.gain, .09 * model.skid, context, .025); smooth(this.skidHigh.gain.gain, .047 * model.skid, context, .025);
    smooth(this.squeal.frequency, 1050 + model.skid * 700 + model.rolling * 200 + Math.sin(context.currentTime * 17) * 35, context, .025);
    smooth(this.squealGain.gain, .045 * model.skid, context, .025);
    smooth(this.rattle.gain.gain, .38 * model.rattle, context); smooth(this.wind.gain.gain, own ? .055 * model.rolling ** 2 : 0, context);
    if (heldHorn && !this.lastHorn) this.honk(); this.lastHorn = heldHorn;
    smooth(this.hornGain.gain, heldHorn || context.currentTime < this.hornUntil ? .072 : 0, context, .012);
    this.hornOscillators.forEach((oscillator, i) => smooth(oscillator.frequency, (i ? 440 + this.slot * 24 : 350 + this.slot * 18) * mix.doppler, context));
    if (model.reversing && context.currentTime > this.reverseAt) {
      this.reverseAt = context.currentTime + .78;
      audio.play('reverse', rig.car, own, .12);
    }
  }
  stop() {
    for (const source of this.sources) { try { source.stop(); } catch { /* Already stopped. */ } }
    for (const node of this.nodes) node.disconnect(); this.nodes = []; this.sources = [];
  }
}

/** Original procedural audio: combustion, tyres, road, hitch, horns and impacts. */
export class RaceSound {
  constructor() {
    this.enabled = true; this.context = null; this.voices = []; this.oneShots = new Set(); this.buffers = new Map();
    this.timeline = new SoundTimeline(); this.pending = []; this.localHorn = false; this.localHornUntil = 0;
    try { this.enabled = localStorage.getItem('tow:sound') !== 'off'; } catch { /* Optional storage. */ }
  }
  unlock() {
    if (!this.enabled) return;
    try {
      if (!this.context) {
        const Audio = window.AudioContext ?? window.webkitAudioContext; if (!Audio) return;
        this.context = new Audio({ latencyHint: 'interactive' });
        const context = this.context;
        this.master = context.createGain(); this.master.gain.value = .68;
        this.compressor = context.createDynamicsCompressor(); this.compressor.threshold.value = -14;
        this.compressor.knee.value = 12; this.compressor.ratio.value = 5; this.compressor.attack.value = .004; this.compressor.release.value = .16;
        this.master.connect(this.compressor).connect(context.destination);
        this.white = noiseBuffer(context); this.pink = noiseBuffer(context, true); this.rattle = effectBuffer(context, 'rattle');
      }
      if (this.context.state !== 'running' && this.context.state !== 'closed') void this.context.resume().catch(() => {});
    } catch { /* An unavailable sound device must not interrupt racing. */ }
  }
  setEnabled(enabled) {
    this.enabled = enabled;
    try { localStorage.setItem('tow:sound', enabled ? 'on' : 'off'); } catch { /* Optional storage. */ }
    if (enabled) this.unlock(); else this.stop();
  }
  receive(state, slot) {
    if (this.state?.id !== state.id) { this.stop(); this.localHorn = false; }
    this.state = state; this.slot = slot;
    const events = this.timeline.receive(state);
    if (this.enabled && !document.hidden && this.context?.state === 'running') this.pending.push(...events);
    if (state.phase === 'paused') this.stop();
  }
  horn(pressed) {
    if (pressed && !this.localHorn && this.enabled && !document.hidden && this.context?.state === 'running') {
      this.localHornUntil = this.context.currentTime + .15; this.voices[this.slot]?.honk();
    }
    this.localHorn = pressed;
  }
  update(rigs, slot, state, mask, dt) {
    if (!this.enabled || document.hidden || this.context?.state !== 'running') return;
    try {
      this.listener = rigs[slot].car; this.slot = slot;
      if (['countdown', 'racing'].includes(state.phase)) {
        if (!this.voices.length) this.voices = rigs.map((rig, i) => new VehicleVoice(this, i));
        this.voices.forEach((voice, i) => voice.update(this, rigs[i], i === slot ? mask : state.masks[i], this.listener, i === slot,
          i === slot ? this.localHorn || this.context.currentTime < this.localHornUntil : state.horns[i], dt));
      } else if (this.voices.length) this.stopLoops();
      const pending = this.pending.splice(0);
      for (const event of pending) {
        if (event.type === 'horn') { if (event.slot !== slot) this.voices[event.slot]?.honk(); }
        else if (event.type === 'impact') this.play('impact', event, event.slots.includes(slot), .17 + Math.sqrt(event.speed / 1400) * .6, event);
        else if (event.type === 'finish') this.play('finish', rigs[event.slot].car, event.slot === slot, event.slot === slot ? .62 : .3);
        else if (event.type === 'checkpoint' || event.type === 'reset') { if (event.slot === slot) this.play(event.type, this.listener, true, .18); }
        else this.play(event.type, this.listener, true, event.type === 'go' ? .52 : .4);
      }
    } catch { this.stop(); /* Audio failure does not terminate the room. */ }
  }
  play(kind, position, own, volume, impact = null) {
    if (!this.enabled || document.hidden || this.context?.state !== 'running' || !this.listener || this.oneShots.size >= 16) return;
    const context = this.context, mix = spatialMix(position, this.listener, own);
    if (mix.gain < .001) return;
    const source = context.createBufferSource(), gain = context.createGain(), pan = context.createStereoPanner();
    if (impact) source.buffer = effectBuffer(context, 'impact', clamp(impact.speed / 600, 0, 1), impact.kind);
    else {
      if (!this.buffers.has(kind)) this.buffers.set(kind, effectBuffer(context, kind));
      source.buffer = this.buffers.get(kind);
    }
    source.playbackRate.value = mix.doppler; gain.gain.value = volume * mix.gain; pan.pan.value = mix.pan;
    source.connect(gain).connect(pan).connect(this.master); this.oneShots.add(source);
    source.onended = () => { this.oneShots.delete(source); source.disconnect(); gain.disconnect(); pan.disconnect(); };
    source.start();
  }
  stopLoops() { this.voices.forEach(voice => voice.stop()); this.voices = []; }
  stop() {
    this.pending = []; this.localHornUntil = 0; this.stopLoops();
    for (const source of this.oneShots) { try { source.stop(); } catch { /* Already stopped. */ } }
    this.oneShots.clear();
  }
}
